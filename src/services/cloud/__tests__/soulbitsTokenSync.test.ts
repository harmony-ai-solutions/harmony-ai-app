/**
 * Soulbits Token Sync Tests (2026-10-23 incident fix)
 *
 * The module no longer pushes the account PASETO into the engine; it drives the
 * long-lived `Soulbits Engine` API-key ensure flow. Verifies:
 *  - `startSoulbitsTokenSync()` subscribes to `auth:changed` and runs the
 *    ensure flow.
 *  - Readiness deferral: an `auth:changed` that lands before the engine
 *    management API connects is parked on the next engine-ready event and
 *    retried; a not-connected failure against a LIVE connection is a genuine
 *    failure (never deferred).
 *  - The engine-connect heal (`syncCurrentToken`) runs once per connection and
 *    `stop()` tears both subscriptions down.
 *  - Signed out (standalone) is a no-op — no key is ever written.
 *  - `injectSoulbitsToken()` seeds the last-applied engine key for NEW
 *    soulbitscloud configs only, never the PASETO.
 */

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import AuthService from '../../auth/AuthService';
import { getEngineConnection, onEngineConnectionChange } from '../../engine/EngineService';
import { ensureCloudEngineKey, getLastAppliedEngineKey } from '../engineKeyEnsure';
import { startSoulbitsTokenSync, syncCurrentToken, injectSoulbitsToken } from '../soulbitsTokenSync';

jest.mock('../../auth/AuthService', () => ({
  __esModule: true,
  default: {
    on: jest.fn(),
    off: jest.fn(),
    getToken: jest.fn(),
  },
}));

jest.mock('../../engine/EngineService', () => ({
  getEngineConnection: jest.fn(),
  onEngineConnectionChange: jest.fn(() => jest.fn()),
}));

jest.mock('../engineKeyEnsure', () => ({
  __esModule: true,
  ensureCloudEngineKey: jest.fn(),
  getLastAppliedEngineKey: jest.fn(),
}));

const mockedAuth = AuthService as jest.Mocked<typeof AuthService>;
const mockedEnsure = ensureCloudEngineKey as jest.Mock;
const mockedGetKey = getLastAppliedEngineKey as jest.Mock;
const mockedGetConnection = getEngineConnection as jest.Mock;
const mockedOnChange = onEngineConnectionChange as jest.Mock;

const CONN = { adminBaseUrl: 'http://127.0.0.1:28081' };
const NOT_CONNECTED =
  'Engine is not connected — start the engine sidecar before using the management-API data layer';

/** Capture every engine-connection listener registered during a test. */
function captureListeners() {
  const listeners: Array<(connection: unknown) => void> = [];
  const unsubscribes: jest.Mock[] = [];
  mockedOnChange.mockImplementation((cb: (connection: unknown) => void) => {
    listeners.push(cb);
    const off = jest.fn();
    unsubscribes.push(off);
    return off;
  });
  return { listeners, unsubscribes };
}

const flush = async () => {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
};

beforeEach(() => {
  jest.clearAllMocks();
  // Default: signed out (standalone), engine down, one connection listener
  // factory per registration.
  mockedAuth.getToken.mockRejectedValue(new Error('AuthExpiredError'));
  mockedEnsure.mockResolvedValue({ status: 'unchanged' } as any);
  mockedGetKey.mockReturnValue(null);
  mockedGetConnection.mockReturnValue(null);
  mockedOnChange.mockImplementation(() => jest.fn());
});

describe('startSoulbitsTokenSync', () => {
  it('subscribes to auth:changed and runs the ensure flow', async () => {
    const stop = startSoulbitsTokenSync();

    expect(mockedAuth.on).toHaveBeenCalledWith('auth:changed', expect.any(Function));

    const handler = mockedAuth.on.mock.calls[0][1] as () => Promise<void>;
    await handler();

    expect(mockedEnsure).toHaveBeenCalledTimes(1);

    stop();
    expect(mockedAuth.off).toHaveBeenCalledWith('auth:changed', handler);
  });

  it('returns a stop() that unsubscribes the exact handler AND the connection listener', () => {
    const { unsubscribes } = captureListeners();
    const stop = startSoulbitsTokenSync();
    const handler = mockedAuth.on.mock.calls[0][1];

    stop();

    expect(mockedAuth.off).toHaveBeenCalledWith('auth:changed', handler);
    expect(unsubscribes[0]).toHaveBeenCalledTimes(1);
  });
});

// ── Readiness deferral (cold-start boot race) ───────────────────────────────

describe('startSoulbitsTokenSync — engine readiness deferral', () => {
  it('defers an auth:changed that beats the engine and retries on connect', async () => {
    const { listeners } = captureListeners();
    mockedGetConnection.mockReturnValue(null);
    mockedEnsure.mockRejectedValueOnce(new Error(NOT_CONNECTED));

    const stop = startSoulbitsTokenSync();
    const handler = mockedAuth.on.mock.calls[0][1] as () => Promise<void>;

    await handler();

    // The ensure was attempted, failed on the boot race, and was NOT retried yet.
    expect(mockedEnsure).toHaveBeenCalledTimes(1);
    // One subscription for the engine-connect heal + one armed retry.
    expect(listeners).toHaveLength(2);

    // Engine becomes ready → the connect heal AND the deferred retry run the
    // ensure flow (the heal is a second trigger, not a duplicate of the retry).
    listeners.forEach(listener => listener(CONN));
    await flush();

    expect(mockedEnsure).toHaveBeenCalledTimes(3);
    stop();
  });

  it('keeps ONE armed retry while newer triggers arrive (latest state wins)', async () => {
    const { listeners } = captureListeners();
    mockedGetConnection.mockReturnValue(null);
    mockedEnsure
      .mockRejectedValueOnce(new Error(NOT_CONNECTED))
      .mockRejectedValueOnce(new Error(NOT_CONNECTED));

    const stop = startSoulbitsTokenSync();
    const handler = mockedAuth.on.mock.calls[0][1] as () => Promise<void>;

    await handler();
    await handler();

    expect(mockedEnsure).toHaveBeenCalledTimes(2);
    // Still ONE deferral subscription (the second failure replaced the task).
    expect(listeners).toHaveLength(2);

    listeners.forEach(listener => listener(CONN));
    await flush();

    expect(mockedEnsure).toHaveBeenCalledTimes(4);
    stop();
  });

  it('does NOT defer a not-connected error against a LIVE engine (genuine failure)', async () => {
    const { listeners } = captureListeners();
    mockedGetConnection.mockReturnValue(CONN);
    mockedEnsure
      .mockResolvedValueOnce({ status: 'unchanged' } as any) // the startup heal
      .mockRejectedValueOnce(new Error(NOT_CONNECTED)); // the auth:changed attempt

    const stop = startSoulbitsTokenSync();
    const handler = mockedAuth.on.mock.calls[0][1] as () => Promise<void>;
    // The engine is already live → the connect heal runs once at start.
    await flush();
    expect(mockedEnsure).toHaveBeenCalledTimes(1);

    // The handler swallows (warn) — assert no retry was armed.
    await handler();
    expect(mockedEnsure).toHaveBeenCalledTimes(2);
    // Only the engine-connect heal subscribed; no deferral was armed.
    expect(listeners).toHaveLength(1);

    listeners.forEach(listener => listener(CONN));
    await flush();
    // Only the connect heal reacts (a second connection event re-runs it);
    // the failed auth:changed ensure was never parked for a retry.
    expect(mockedEnsure).toHaveBeenCalledTimes(3);
    stop();
  });
});

// ── Engine-connect heal (the "safety net on app start") ─────────────────────

describe('startSoulbitsTokenSync — engine-connect heal', () => {
  it('heals once the engine connects (a connection burst does not duplicate it)', async () => {
    const { listeners } = captureListeners();
    mockedGetConnection.mockReturnValue(null);

    const stop = startSoulbitsTokenSync();
    expect(mockedEnsure).not.toHaveBeenCalled();

    listeners.forEach(listener => listener(CONN));
    listeners.forEach(listener => listener(CONN));
    await flush();

    expect(mockedEnsure).toHaveBeenCalledTimes(1);
    stop();
  });

  it('heals immediately when the engine is already connected at start', async () => {
    mockedGetConnection.mockReturnValue(CONN);

    const stop = startSoulbitsTokenSync();
    await flush();

    expect(mockedEnsure).toHaveBeenCalledTimes(1);
    stop();
  });

  it('signed out is a no-op: the ensure flow reports it and nothing is written', async () => {
    const { listeners } = captureListeners();
    mockedGetConnection.mockReturnValue(null);
    mockedEnsure.mockResolvedValue({ status: 'signed_out' } as any);

    const stop = startSoulbitsTokenSync();
    listeners.forEach(listener => listener(CONN));
    await flush();

    expect(mockedEnsure).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe('syncCurrentToken', () => {
  it('runs the ensure flow', async () => {
    await syncCurrentToken();

    expect(mockedEnsure).toHaveBeenCalledTimes(1);
  });

  it('resolves cleanly when signed out (no cached credential)', async () => {
    mockedEnsure.mockResolvedValue({ status: 'signed_out' } as any);

    await expect(syncCurrentToken()).resolves.toBeUndefined();
    expect(mockedEnsure).toHaveBeenCalledTimes(1);
  });

  it('never throws (the failed ensure is logged)', async () => {
    mockedEnsure.mockRejectedValue(new Error('transport down'));

    await expect(syncCurrentToken()).resolves.toBeUndefined();
  });
});

describe('injectSoulbitsToken', () => {
  it('injects the cached engine key into a NEW soulbitscloud config', async () => {
    mockedAuth.getToken.mockResolvedValue('v4.local.paseto');
    mockedGetKey.mockReturnValue('sb_cloud_cachedkey');

    const result = await injectSoulbitsToken({
      providerType: 'soulbitscloud',
      isCreate: true,
      providerConfig: { name: 'sb', base_url: 'https://api.soulbits.app', api_key: '' },
    });

    expect(result.api_key).toBe('sb_cloud_cachedkey');
    expect(result.api_key).not.toContain('v4.local');
  });

  it('seeds an empty key when signed in but no key is cached yet', async () => {
    mockedAuth.getToken.mockResolvedValue('v4.local.paseto');
    mockedGetKey.mockReturnValue(null);

    const result = await injectSoulbitsToken({
      providerType: 'soulbitscloud',
      isCreate: true,
      providerConfig: { name: 'sb', base_url: 'https://api.soulbits.app', api_key: 'user-key' },
    });

    expect(result.api_key).toBe('');
  });

  it('never touches existing soulbitscloud configs (updates)', async () => {
    mockedAuth.getToken.mockResolvedValue('v4.local.paseto');
    mockedGetKey.mockReturnValue('sb_cloud_cachedkey');

    const result = await injectSoulbitsToken({
      providerType: 'soulbitscloud',
      isCreate: false,
      providerConfig: { name: 'sb', base_url: 'https://api.soulbits.app', api_key: 'user-key' },
    });

    expect(result.api_key).toBe('user-key');
  });

  it('never injects into non-soulbits providers', async () => {
    mockedAuth.getToken.mockResolvedValue('v4.local.paseto');
    mockedGetKey.mockReturnValue('sb_cloud_cachedkey');

    const result = await injectSoulbitsToken({
      providerType: 'openai',
      isCreate: true,
      providerConfig: { name: 'oa', api_key: 'sk-user' },
    });

    expect(result.api_key).toBe('sk-user');
  });

  it('keeps the user-entered key when no cloud credential exists (standalone)', async () => {
    mockedAuth.getToken.mockRejectedValue(new Error('AuthExpiredError'));

    const result = await injectSoulbitsToken({
      providerType: 'soulbitscloud',
      isCreate: true,
      providerConfig: { name: 'sb', base_url: 'https://api.soulbits.app', api_key: 'standalone-key' },
    });

    expect(result.api_key).toBe('standalone-key');
  });
});
