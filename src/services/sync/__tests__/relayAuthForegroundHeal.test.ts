/**
 * RelayAuthSelfHeal — the app-wide foreground self-heal (2026-10-23 incident).
 *
 * The relay token can expire while the app is in the background. The FIRST
 * foreground after that must heal it silently:
 *   - ONE look per AppState → 'active' transition, and nothing while a pass is
 *     still running (no re-entrancy, no timer);
 *   - only when the engine is actually running;
 *   - nothing at all when the engine does not report auth_needed;
 *   - silent: failures end in honest logs, never in UI (the Desktop Sync banner
 *     and the Settings chip are the only user-facing surfaces).
 */

import type { AppStateStatus } from 'react-native';
import { engineApiClient } from '../../engine/EngineApiClient';
import type { SyncClientStatusDto } from '../../engine/EngineApiClient';
import { getEngineConnection } from '../../engine/EngineService';
import AuthService from '../../auth/AuthService';
import {
  attachRelayAuthSelfHeal,
  detachRelayAuthSelfHealForTests,
  runRelayAuthForegroundPass,
} from '../relayAuthForegroundHeal';
import { resetRelayAuthRecoveryForTests } from '../relayAuthRecovery';

jest.mock('../../engine/EngineApiClient', () => ({
  engineApiClient: { getSyncClientStatus: jest.fn(), updateSyncClientConfig: jest.fn() },
}));

jest.mock('../../engine/EngineService', () => ({
  getEngineConnection: jest.fn(() => ({ adminBaseUrl: 'http://127.0.0.1:1' })),
}));

jest.mock('../../auth/AuthService', () => ({
  __esModule: true,
  default: {
    getToken: jest.fn(),
    refresh: jest.fn(),
    isTokenExpired: jest.fn(() => false),
  },
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

/** A minimal engine status (only the fields the self-heal reads). */
function status(over: Record<string, unknown> = {}): SyncClientStatusDto {
  return {
    enabled: true,
    state: 'syncing',
    last_error: null,
    local_authoritative: false,
    baseline_path: null,
    dataset_id: 'ds-1',
    pending_writes: 0,
    sync_group: 'uninitialized',
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

/** A fake AppState surface (same shape the service consumes). */
function fakeAppState() {
  const handlers: Array<(s: AppStateStatus) => void> = [];
  return {
    currentState: 'active' as AppStateStatus,
    addEventListener: jest.fn((_t: 'change', h: (s: AppStateStatus) => void) => {
      handlers.push(h);
      return {
        remove: () => {
          const i = handlers.indexOf(h);
          if (i >= 0) handlers.splice(i, 1);
        },
      };
    }),
    fire: (s: AppStateStatus) => handlers.forEach(h => h(s)),
    get listenerCount() {
      return handlers.length;
    },
  };
}

/** Flush pending microtasks/macrotasks so the fire-and-forget pass settles. */
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

beforeEach(() => {
  jest.clearAllMocks();
  detachRelayAuthSelfHealForTests();
  resetRelayAuthRecoveryForTests();
  mockConnection.mockReturnValue({ adminBaseUrl: 'http://127.0.0.1:1' });
  mockStatus.mockResolvedValue(status());
  mockGetToken.mockResolvedValue('PASETO-CACHED');
  mockRefresh.mockResolvedValue(true);
  mockUpdate.mockResolvedValue({});
});

// ── The pass itself ─────────────────────────────────────────────────────

describe('runRelayAuthForegroundPass', () => {
  it('runs the recovery when the engine reports auth_needed', async () => {
    const recover = jest.fn(async () => 'recovered' as const);

    await runRelayAuthForegroundPass({
      isEngineRunning: () => true,
      getStatus: async () => status({ state: 'auth_needed' }),
      recover,
    });

    expect(recover).toHaveBeenCalledTimes(1);
    expect(mockLog.info).toHaveBeenCalledWith('relay auth self-healed on foreground');
  });

  it('also heals when only the relay bridge flags auth_needed', async () => {
    const recover = jest.fn(async () => 'recovered' as const);

    await runRelayAuthForegroundPass({
      isEngineRunning: () => true,
      getStatus: async () =>
        status({ state: 'backoff', relay: { auth_needed: true } as any }),
      recover,
    });

    expect(recover).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the relay is healthy', async () => {
    const recover = jest.fn(async () => 'recovered' as const);

    await runRelayAuthForegroundPass({
      isEngineRunning: () => true,
      getStatus: async () => status(),
      recover,
    });

    expect(recover).not.toHaveBeenCalled();
  });

  it('skips the status read entirely when the engine is not running', async () => {
    const getStatus = jest.fn();
    const recover = jest.fn();

    await runRelayAuthForegroundPass({
      isEngineRunning: () => false,
      getStatus,
      recover,
    });

    expect(getStatus).not.toHaveBeenCalled();
    expect(recover).not.toHaveBeenCalled();
  });

  it('swallows a status read failure (never intrudes)', async () => {
    const recover = jest.fn();

    await expect(
      runRelayAuthForegroundPass({
        isEngineRunning: () => true,
        getStatus: async () => {
          throw new Error('engine unreachable');
        },
        recover,
      }),
    ).resolves.toBeUndefined();
    expect(recover).not.toHaveBeenCalled();
    expect(mockLog.warn).toHaveBeenCalledWith(
      'foreground self-heal skipped: status read failed:',
      'engine unreachable',
    );
  });

  it('swallows a thrown recovery and logs honestly', async () => {
    await expect(
      runRelayAuthForegroundPass({
        isEngineRunning: () => true,
        getStatus: async () => status({ state: 'auth_needed' }),
        recover: async () => {
          throw new Error('boom');
        },
      }),
    ).resolves.toBeUndefined();
    expect(mockLog.warn).toHaveBeenCalledWith('foreground self-heal failed:', 'boom');
  });

  it('logs a non-recovering outcome without surfacing anything', async () => {
    await runRelayAuthForegroundPass({
      isEngineRunning: () => true,
      getStatus: async () => status({ state: 'auth_needed' }),
      recover: async () => 'signed_out' as const,
    });

    expect(mockLog.warn).toHaveBeenCalledWith(
      'foreground self-heal could not recover the relay token (signed_out)',
    );
  });
});

// ── The AppState trigger ────────────────────────────────────────────────

describe('attachRelayAuthSelfHeal', () => {
  it('runs ONE pass per AppState → active transition', async () => {
    const appState = fakeAppState();
    const getStatus = jest.fn(async () => status());
    attachRelayAuthSelfHeal({ appState, isEngineRunning: () => true, getStatus });

    appState.fire('background');
    expect(getStatus).not.toHaveBeenCalled();

    appState.fire('active');
    await flush();
    expect(getStatus).toHaveBeenCalledTimes(1);

    // A new foreground transition looks again.
    appState.fire('background');
    appState.fire('active');
    await flush();
    expect(getStatus).toHaveBeenCalledTimes(2);
  });

  it('ignores a second active while the first pass is still running', async () => {
    const appState = fakeAppState();
    let release: (() => void) | undefined;
    const getStatus = jest.fn(
      () =>
        new Promise<SyncClientStatusDto>(resolve => {
          release = () => resolve(status());
        }),
    );
    attachRelayAuthSelfHeal({ appState, isEngineRunning: () => true, getStatus });

    appState.fire('active');
    appState.fire('active');
    expect(getStatus).toHaveBeenCalledTimes(1);
    release?.();
    await flush();
  });

  it('is idempotent (one listener however often it is attached)', () => {
    const appState = fakeAppState();
    attachRelayAuthSelfHeal({ appState });
    attachRelayAuthSelfHeal({ appState });
    expect(appState.listenerCount).toBe(1);
  });

  it('heals end-to-end through the shared verified recovery', async () => {
    const appState = fakeAppState();
    let token = 'PASETO-STALE';
    mockStatus.mockResolvedValue(status({ state: 'auth_needed' }));
    mockGetToken.mockImplementation(async () => token);
    mockRefresh.mockImplementation(async () => {
      token = 'PASETO-FRESH';
      return true;
    });
    attachRelayAuthSelfHeal({ appState });

    appState.fire('active');
    await flush();
    await flush();

    expect(mockStatus).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({ relay_token: 'PASETO-FRESH' });
  });

  it('does not touch the engine on a healthy foreground', async () => {
    const appState = fakeAppState();
    attachRelayAuthSelfHeal({ appState });

    appState.fire('active');
    await flush();

    expect(mockStatus).toHaveBeenCalledTimes(1);
    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
