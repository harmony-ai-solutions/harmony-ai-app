/**
 * RelayTokenRotationReinject — a rotated cloud PASETO is pushed to the engine
 * proactively (2026-10-23 incident follow-up).
 *
 * Pinned here:
 *   - the seam is AuthService's existing `auth:changed` event (subscribe/stop);
 *   - a rotation reaches the engine through the shared verify-before-PUT path
 *     when cloud-relay sync is enabled, and NOTHING is written when sync is off,
 *     when the transport is LAN, or when the engine is not running;
 *   - no duplicate writes: a repeated event with the same token, an
 *     already-applied token, and a recovery whose own refresh emits
 *     `auth:changed` all end in exactly ONE PUT.
 */

import type { SyncClientStatusDto } from '../../engine/EngineApiClient';
import { engineApiClient } from '../../engine/EngineApiClient';
import { getEngineConnection } from '../../engine/EngineService';
import AuthService from '../../auth/AuthService';
import {
  attachRelayTokenRotationReinject,
  detachRelayTokenRotationReinjectForTests,
  runRelayTokenRotationReinject,
} from '../relayTokenRotationReinject';
import {
  recoverRelayAuth,
  resetRelayAuthRecoveryForTests,
} from '../relayAuthRecovery';

// The controllable auth:changed registry (only touched when `on` is called).
const mockAuthHandlers = new Set<(token: string) => void>();

jest.mock('../../auth/AuthService', () => ({
  __esModule: true,
  default: {
    getToken: jest.fn(),
    refresh: jest.fn(),
    isTokenExpired: jest.fn(() => false),
    on: jest.fn((event: string, handler: (token: string) => void) => {
      if (event === 'auth:changed') mockAuthHandlers.add(handler);
    }),
    off: jest.fn((event: string, handler: (token: string) => void) => {
      if (event === 'auth:changed') mockAuthHandlers.delete(handler);
    }),
  },
}));

jest.mock('../../engine/EngineApiClient', () => ({
  engineApiClient: { getSyncClientStatus: jest.fn(), updateSyncClientConfig: jest.fn() },
}));

jest.mock('../../engine/EngineService', () => ({
  getEngineConnection: jest.fn(() => ({ adminBaseUrl: 'http://127.0.0.1:1' })),
}));

jest.mock('../../../utils/logger', () => {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { createLogger: () => logger, __mockLogger: logger };
});
const mockLog = jest.requireMock('../../../utils/logger').__mockLogger as {
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
  debug: jest.Mock;
};

const mockStatus = engineApiClient.getSyncClientStatus as jest.Mock;
const mockUpdate = engineApiClient.updateSyncClientConfig as jest.Mock;
const mockConnection = getEngineConnection as jest.Mock;
const mockGetToken = AuthService.getToken as jest.Mock;
const mockRefresh = AuthService.refresh as jest.Mock;

function status(over: Record<string, unknown> = {}): SyncClientStatusDto {
  return {
    enabled: true,
    state: 'syncing',
    last_error: null,
    local_authoritative: false,
    baseline_path: null,
    dataset_id: 'ds-1',
    pending_writes: 0,
    sync_group: 'member',
    rotation_required: false,
    cognition_authority: null,
    narration_paused: false,
    relay: null,
    config: {
      enabled: true,
      transport: 'relay',
      peer_address: '',
      peer_wss_address: '',
      security_mode: 'secure',
      relay_url: 'wss://sync.test/v1/sync/ws',
      relay_token: '',
      device_id: 'device-1',
      dataset_id: 'ds-1',
      group_join_pending: false,
      device_name: 'Pixel',
      device_type: 'embedded_engine',
      device_platform: 'android',
    },
    ...over,
  } as SyncClientStatusDto;
}

/** Emit `auth:changed` to every subscribed handler (AuthService's behaviour). */
function emitAuthChanged(token: string) {
  for (const handler of Array.from(mockAuthHandlers)) handler(token);
}

/** Flush pending microtasks/macrotasks so fire-and-forget work settles. */
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthHandlers.clear();
  detachRelayTokenRotationReinjectForTests();
  resetRelayAuthRecoveryForTests();
  mockConnection.mockReturnValue({ adminBaseUrl: 'http://127.0.0.1:1' });
  mockStatus.mockResolvedValue(status());
  mockGetToken.mockResolvedValue('PASETO-OLD');
  mockRefresh.mockResolvedValue(true);
  mockUpdate.mockResolvedValue({});
});

// ── The trigger ─────────────────────────────────────────────────────────

describe('attachRelayTokenRotationReinject', () => {
  it('subscribes to auth:changed and stops cleanly', () => {
    const stop = attachRelayTokenRotationReinject();

    expect(AuthService.on).toHaveBeenCalledWith('auth:changed', expect.any(Function));
    expect(mockAuthHandlers.size).toBe(1);

    stop();
    expect(AuthService.off).toHaveBeenCalledWith('auth:changed', expect.any(Function));
    expect(mockAuthHandlers.size).toBe(0);
  });

  it('re-injects a rotated token when relay sync is enabled (exactly one PUT)', async () => {
    attachRelayTokenRotationReinject();

    emitAuthChanged('PASETO-ROTATED');
    await flush();
    await flush();

    expect(mockStatus).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({ relay_token: 'PASETO-ROTATED' });
    // The rotated token is new by construction: no extra refresh.
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(mockLog.info).toHaveBeenCalledWith(
      'relay token re-injected after a cloud sign-in rotation',
    );
  });

  it('writes nothing when sync is disabled', async () => {
    mockStatus.mockResolvedValue(status({ config: { ...status().config, enabled: false } }));
    attachRelayTokenRotationReinject();

    emitAuthChanged('PASETO-ROTATED');
    await flush();

    expect(mockStatus).toHaveBeenCalledTimes(1);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('writes nothing for a LAN-only sync client', async () => {
    mockStatus.mockResolvedValue(status({ config: { ...status().config, transport: 'lan' } }));
    attachRelayTokenRotationReinject();

    emitAuthChanged('PASETO-ROTATED');
    await flush();

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('writes nothing while the engine is not running', async () => {
    mockConnection.mockReturnValue(null);
    attachRelayTokenRotationReinject();

    emitAuthChanged('PASETO-ROTATED');
    await flush();

    expect(mockStatus).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('ignores a repeated event carrying the same token', async () => {
    attachRelayTokenRotationReinject();

    emitAuthChanged('PASETO-ROTATED');
    await flush();
    emitAuthChanged('PASETO-ROTATED');
    await flush();

    expect(mockStatus).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it('never re-PUTs the token a recovery just applied (no loop)', async () => {
    // A real refresh rotates the PASETO and emits auth:changed from inside
    // AuthService — the hook fires WHILE the recovery is still running.
    let token = 'PASETO-OLD';
    mockGetToken.mockImplementation(async () => token);
    mockRefresh.mockImplementation(async () => {
      token = 'PASETO-FRESH';
      emitAuthChanged(token);
      return true;
    });
    mockStatus.mockResolvedValue(status({ state: 'auth_needed' }));
    attachRelayTokenRotationReinject();

    await expect(recoverRelayAuth()).resolves.toBe('recovered');
    await flush();
    await flush();

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({ relay_token: 'PASETO-FRESH' });
  });
});

// ── The pass itself ─────────────────────────────────────────────────────

describe('runRelayTokenRotationReinject', () => {
  it('is total (a status read failure is swallowed)', async () => {
    await expect(
      runRelayTokenRotationReinject('PASETO-ROTATED', {
        isEngineRunning: () => true,
        getStatus: async () => {
          throw new Error('engine unreachable');
        },
      }),
    ).resolves.toBeUndefined();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockLog.warn).toHaveBeenCalledWith(
      'rotation re-inject skipped: status read failed:',
      'engine unreachable',
    );
  });

  it('is idempotent for a token the engine already has', async () => {
    const reinject = jest.fn(async () => 'failed' as const);
    await runRelayTokenRotationReinject('PASETO-ROTATED', {
      isEngineRunning: () => true,
      getStatus: async () => status(),
      reinject,
    });

    expect(reinject).toHaveBeenCalledWith('PASETO-ROTATED');
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockLog.debug).toHaveBeenCalledWith(
      'rotation re-inject did not write a token (failed)',
    );
  });
});
