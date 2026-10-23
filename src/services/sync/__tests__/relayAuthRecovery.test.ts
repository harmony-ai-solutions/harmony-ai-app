/**
 * RelayAuthRecovery — the verify-before-PUT gate (2026-10-22/23 incidents).
 *
 * Every gate that protects the engine's `relay_token` write is pinned here:
 *   - a failed/transient refresh NEVER reaches the engine;
 *   - a "successful" refresh that produced the SAME token is a warn, not a PUT;
 *   - a token the engine already holds is never re-sent;
 *   - an already-expired token is never sent;
 *   - exactly ONE PUT happens for a genuinely fresh token, and the success log
 *     belongs to that same verified path;
 *   - concurrent callers (screen + foreground + rotation) share one attempt, so
 *     a single fresh token can never be written twice.
 */

import { engineApiClient } from '../../engine/EngineApiClient';
import AuthService from '../../auth/AuthService';
import {
  getLastAppliedRelayToken,
  isRelaySyncConfigured,
  needsRelayAuth,
  recoverRelayAuth,
  reinjectRotatedRelayToken,
  resetRelayAuthRecoveryForTests,
} from '../relayAuthRecovery';
import type { SyncClientStatusDto } from '../../engine/EngineApiClient';

jest.mock('../../engine/EngineApiClient', () => ({
  engineApiClient: { updateSyncClientConfig: jest.fn() },
}));

jest.mock('../../auth/AuthService', () => ({
  __esModule: true,
  default: {
    getToken: jest.fn(),
    refresh: jest.fn(),
    isTokenExpired: jest.fn(() => false),
  },
}));

// A STABLE logger (createLogger runs at module load; the instance is read back).
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

const mockUpdate = engineApiClient.updateSyncClientConfig as jest.Mock;
const mockGetToken = AuthService.getToken as jest.Mock;
const mockRefresh = AuthService.refresh as jest.Mock;
const mockExpired = AuthService.isTokenExpired as jest.Mock;

/** Warnings about the recovery only (ignores unrelated logger noise). */
function recoveryWarnings(): string[] {
  return mockLog.warn.mock.calls
    .map(c => String(c[0]))
    .filter(m => m.includes('relay auth'));
}

beforeEach(() => {
  jest.clearAllMocks();
  resetRelayAuthRecoveryForTests();
  mockExpired.mockReturnValue(false);
  mockRefresh.mockResolvedValue(true);
  mockUpdate.mockResolvedValue({});
});

// ── Predicates ──────────────────────────────────────────────────────────

describe('needsRelayAuth', () => {
  it('honours BOTH engine signals (client state and the relay bridge flag)', () => {
    expect(needsRelayAuth({ state: 'auth_needed', relay: null } as any)).toBe(true);
    expect(
      needsRelayAuth({
        state: 'backoff',
        relay: { auth_needed: true } as any,
      }),
    ).toBe(true);
  });

  it('is false for a healthy (or LAN) status', () => {
    expect(needsRelayAuth({ state: 'syncing', relay: null } as any)).toBe(false);
    expect(
      needsRelayAuth({ state: 'syncing', relay: { auth_needed: false } as any }),
    ).toBe(false);
  });

  it('accepts the engine status DTO unchanged (single source of truth)', () => {
    const status = {
      state: 'auth_needed',
      relay: null,
    } as Pick<SyncClientStatusDto, 'state' | 'relay'>;
    expect(needsRelayAuth(status)).toBe(true);
  });
});

describe('isRelaySyncConfigured', () => {
  it('requires sync enabled AND the relay transport', () => {
    expect(
      isRelaySyncConfigured({ config: { enabled: true, transport: 'relay' } } as any),
    ).toBe(true);
    expect(
      isRelaySyncConfigured({ config: { enabled: false, transport: 'relay' } } as any),
    ).toBe(false);
    expect(
      isRelaySyncConfigured({ config: { enabled: true, transport: 'lan' } } as any),
    ).toBe(false);
  });
});

// ── The recovery (auth_needed) path ─────────────────────────────────────

describe('recoverRelayAuth — verify before PUT', () => {
  it('PUTs exactly one genuinely fresh token and only then logs success', async () => {
    let token = 'PASETO-STALE';
    mockGetToken.mockImplementation(async () => token);
    mockRefresh.mockImplementation(async () => {
      token = 'PASETO-FRESH';
      return true;
    });

    await expect(recoverRelayAuth()).resolves.toBe('recovered');

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({ relay_token: 'PASETO-FRESH' });
    expect(mockLog.info).toHaveBeenCalledWith('relay auth refreshed');
    expect(recoveryWarnings()).toHaveLength(0);
    expect(getLastAppliedRelayToken()).toBe('PASETO-FRESH');
  });

  it('never PUTs anything when the refresh throws (transient failure)', async () => {
    mockGetToken.mockResolvedValue('PASETO-STALE');
    mockRefresh.mockRejectedValue(new Error('network error'));

    await expect(recoverRelayAuth()).resolves.toBe('failed');

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockLog.info).not.toHaveBeenCalledWith('relay auth refreshed');
    expect(mockLog.warn).toHaveBeenCalledWith(
      'relay auth recovery failed: refresh error:',
      'network error',
    );
  });

  it('reports signed_out when the refresh token was rejected (terminal)', async () => {
    mockGetToken.mockResolvedValue('PASETO-STALE');
    mockRefresh.mockResolvedValue(false);

    await expect(recoverRelayAuth()).resolves.toBe('signed_out');

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockLog.warn).toHaveBeenCalledWith(
      'relay auth recovery failed: cloud sign-in expired (refresh rejected)',
    );
  });

  it('reports signed_out when no token can be read after a successful refresh', async () => {
    mockGetToken
      .mockResolvedValueOnce('PASETO-STALE')
      .mockRejectedValueOnce(new Error('no credential'));

    await expect(recoverRelayAuth()).resolves.toBe('signed_out');

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockLog.warn).toHaveBeenCalledWith(
      'relay auth recovery failed: no cloud token after refresh:',
      'no credential',
    );
  });

  it('skips the PUT when the refresh produced an empty token', async () => {
    mockGetToken.mockResolvedValue('');

    await expect(recoverRelayAuth()).resolves.toBe('failed');

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockLog.warn).toHaveBeenCalledWith(
      'relay auth recovery skipped: refresh produced an empty token',
    );
  });

  it('skips the PUT when a "successful" refresh leaves the token unchanged', async () => {
    mockGetToken.mockResolvedValue('PASETO-SAME');

    await expect(recoverRelayAuth()).resolves.toBe('failed');

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockLog.warn).toHaveBeenCalledWith(
      'relay auth recovery skipped: the token is unchanged after the refresh',
    );
    expect(mockLog.info).not.toHaveBeenCalledWith('relay auth refreshed');
  });

  it('skips the PUT when the token is already applied to the engine', async () => {
    // First recovery applies FRESH…
    let token = 'STALE';
    mockGetToken.mockImplementation(async () => token);
    mockRefresh.mockImplementation(async () => {
      token = 'FRESH';
      return true;
    });
    await expect(recoverRelayAuth()).resolves.toBe('recovered');
    jest.clearAllMocks();
    mockExpired.mockReturnValue(false);

    // …a later episode yields the SAME fresh token (a different "previous"):
    // already applied → never re-sent.
    token = 'STALE-2';
    mockGetToken.mockImplementation(async () => token);
    mockRefresh.mockImplementation(async () => {
      token = 'FRESH';
      return true;
    });

    await expect(recoverRelayAuth()).resolves.toBe('failed');

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockLog.warn).toHaveBeenCalledWith(
      'relay auth recovery skipped: this token is already applied to the engine',
    );
  });

  it('skips the PUT when the refreshed token is already expired', async () => {
    let token = 'STALE';
    mockGetToken.mockImplementation(async () => token);
    mockRefresh.mockImplementation(async () => {
      token = 'FRESH-BUT-EXPIRED';
      return true;
    });
    mockExpired.mockReturnValue(true);

    await expect(recoverRelayAuth()).resolves.toBe('failed');

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockLog.warn).toHaveBeenCalledWith(
      'relay auth recovery skipped: the refreshed token is already expired',
    );
  });

  it('reports failed (and forgets the token) when the engine rejects the write', async () => {
    let token = 'STALE';
    mockGetToken.mockImplementation(async () => token);
    mockRefresh.mockImplementation(async () => {
      token = 'FRESH';
      return true;
    });
    mockUpdate.mockRejectedValue(new Error('engine unreachable'));

    await expect(recoverRelayAuth()).resolves.toBe('failed');

    expect(mockLog.warn).toHaveBeenCalledWith(
      'relay auth recovery failed: relay token update rejected:',
      'engine unreachable',
    );
    expect(getLastAppliedRelayToken()).toBeNull();
  });

  it('shares ONE attempt between concurrent callers (single PUT)', async () => {
    let token = 'STALE';
    let releaseRefresh: (() => void) | undefined;
    mockGetToken.mockImplementation(async () => token);
    mockRefresh.mockImplementation(
      () =>
        new Promise<boolean>(resolve => {
          releaseRefresh = () => {
            token = 'FRESH';
            resolve(true);
          };
        }),
    );

    const first = recoverRelayAuth();
    const second = recoverRelayAuth();
    // Let the attempt reach the (held) refresh before releasing it.
    for (let i = 0; i < 50 && !releaseRefresh; i++) await Promise.resolve();
    expect(releaseRefresh).toBeDefined();
    releaseRefresh?.();

    await expect(first).resolves.toBe('recovered');
    await expect(second).resolves.toBe('recovered');
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });
});

// ── The proactive rotation path ─────────────────────────────────────────

describe('reinjectRotatedRelayToken — rotation-aware, same gates', () => {
  it('PUTs the rotated token WITHOUT refreshing again', async () => {
    mockGetToken.mockResolvedValue('PASETO-ROTATED');

    await expect(reinjectRotatedRelayToken('PASETO-ROTATED')).resolves.toBe('recovered');

    expect(mockRefresh).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({ relay_token: 'PASETO-ROTATED' });
    expect(mockLog.info).toHaveBeenCalledWith('relay auth token re-injected after rotation');
  });

  it('is idempotent: the same token is never re-sent', async () => {
    await expect(reinjectRotatedRelayToken('PASETO-ROTATED')).resolves.toBe('recovered');
    await expect(reinjectRotatedRelayToken('PASETO-ROTATED')).resolves.toBe('failed');

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockLog.warn).toHaveBeenCalledWith(
      'relay auth re-inject skipped: this token is already applied to the engine',
    );
  });

  it('never re-PUTs the token a recovery just applied', async () => {
    let token = 'STALE';
    mockGetToken.mockImplementation(async () => token);
    mockRefresh.mockImplementation(async () => {
      token = 'FRESH';
      return true;
    });

    await expect(recoverRelayAuth()).resolves.toBe('recovered');
    // The recovery's own refresh emits a rotation → the hook asks again.
    await expect(reinjectRotatedRelayToken('FRESH')).resolves.toBe('failed');

    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it('skips an empty / expired rotated token', async () => {
    await expect(reinjectRotatedRelayToken('')).resolves.toBe('failed');
    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();

    mockExpired.mockReturnValue(true);
    await expect(reinjectRotatedRelayToken('EXPIRED-TOKEN')).resolves.toBe('failed');
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockLog.warn).toHaveBeenCalledWith(
      'relay auth re-inject skipped: the rotated token is already expired',
    );
  });

  it('reports signed_out when no token can be read', async () => {
    mockGetToken.mockRejectedValue(new Error('no credential'));

    await expect(reinjectRotatedRelayToken()).resolves.toBe('signed_out');
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
