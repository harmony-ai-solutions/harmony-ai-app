/**
 * Soulbits Token Sync Tests
 *
 * Verifies:
 *  - `startSoulbitsTokenSync()` subscribes to `auth:changed` and pushes the new
 *    PASETO into every non-deleted soulbitscloud provider row.
 *  - Readiness deferral: an `auth:changed` that lands before the engine
 *    management API connects is parked on the next engine-ready event and
 *    retried with the LATEST pending token; a not-connected failure against a
 *    LIVE connection is a genuine failure (never deferred).
 *  - The engine-connect heal (`syncCurrentToken`) runs once per connection,
 *    skips an already-expired cached token, and `stop()` tears both
 *    subscriptions down.
 *  - `syncCurrentToken()` refreshes once with the currently-cached token.
 *  - `injectSoulbitsToken()` seeds the api_key for NEW soulbitscloud provider
 *    configs only (never updates, never touches other providers).
 */

import AuthService from '../../auth/AuthService';
import { getEngineConnection, onEngineConnectionChange } from '../../engine/EngineService';
import { startSoulbitsTokenSync, syncCurrentToken, injectSoulbitsToken } from '../soulbitsTokenSync';
import * as repo from '../../../services/engine/repositories/providers';

jest.mock('../../auth/AuthService', () => ({
  __esModule: true,
  default: {
    on: jest.fn(),
    off: jest.fn(),
    getToken: jest.fn(),
    getTokenExpiresAt: jest.fn(),
  },
}));

jest.mock('../../engine/EngineService', () => ({
  getEngineConnection: jest.fn(),
  onEngineConnectionChange: jest.fn(() => jest.fn()),
}));

jest.mock('../../../services/engine/repositories/providers', () => ({
  __esModule: true,
  updateAllSoulbitsCloudApiKeys: jest.fn(() => Promise.resolve()),
}));

const mockedAuth = AuthService as jest.Mocked<typeof AuthService>;
const mockedRepo = repo as jest.Mocked<typeof repo>;
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
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
};

beforeEach(() => {
  jest.clearAllMocks();
  // Default: no cached token (standalone), engine down, one connection listener
  // factory per registration.
  mockedAuth.getToken.mockRejectedValue(new Error('AuthExpiredError'));
  mockedAuth.getTokenExpiresAt.mockReturnValue(0);
  mockedRepo.updateAllSoulbitsCloudApiKeys.mockResolvedValue(undefined);
  mockedGetConnection.mockReturnValue(null);
  mockedOnChange.mockImplementation(() => jest.fn());
});

describe('startSoulbitsTokenSync', () => {
  it('subscribes to auth:changed and updates all rows', async () => {
    const stop = startSoulbitsTokenSync();

    expect(mockedAuth.on).toHaveBeenCalledWith('auth:changed', expect.any(Function));

    // Simulate a token refresh emitting auth:changed.
    const handler = mockedAuth.on.mock.calls[0][1] as (paseto: string) => Promise<void>;
    await handler('paseto-v4.local.refreshed');

    expect(mockedRepo.updateAllSoulbitsCloudApiKeys).toHaveBeenCalledWith(
      'paseto-v4.local.refreshed',
    );

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
    mockedRepo.updateAllSoulbitsCloudApiKeys.mockRejectedValueOnce(new Error(NOT_CONNECTED));

    const stop = startSoulbitsTokenSync();
    const handler = mockedAuth.on.mock.calls[0][1] as (paseto: string) => Promise<void>;

    await handler('paseto-v4.local.boot');

    // The write was attempted, failed on the boot race, and was NOT retried yet.
    expect(mockedRepo.updateAllSoulbitsCloudApiKeys).toHaveBeenCalledTimes(1);
    expect(mockedRepo.updateAllSoulbitsCloudApiKeys).toHaveBeenCalledWith('paseto-v4.local.boot');
    // One subscription for the engine-connect heal + one armed retry.
    expect(listeners).toHaveLength(2);

    // Engine becomes ready → the deferred retry writes the pending token.
    listeners.forEach(listener => listener(CONN));
    await flush();

    expect(mockedRepo.updateAllSoulbitsCloudApiKeys).toHaveBeenCalledTimes(2);
    expect(mockedRepo.updateAllSoulbitsCloudApiKeys).toHaveBeenLastCalledWith(
      'paseto-v4.local.boot',
    );
    stop();
  });

  it('lets a newer token win while a deferral is armed (one armed retry)', async () => {
    const { listeners } = captureListeners();
    mockedGetConnection.mockReturnValue(null);
    mockedRepo.updateAllSoulbitsCloudApiKeys
      .mockRejectedValueOnce(new Error(NOT_CONNECTED))
      .mockRejectedValueOnce(new Error(NOT_CONNECTED));

    const stop = startSoulbitsTokenSync();
    const handler = mockedAuth.on.mock.calls[0][1] as (paseto: string) => Promise<void>;

    await handler('paseto-v4.local.old');
    await handler('paseto-v4.local.new');

    expect(mockedRepo.updateAllSoulbitsCloudApiKeys).toHaveBeenCalledTimes(2);
    // Still ONE deferral subscription (the second failure replaced the task).
    expect(listeners).toHaveLength(2);

    listeners.forEach(listener => listener(CONN));
    await flush();

    expect(mockedRepo.updateAllSoulbitsCloudApiKeys).toHaveBeenCalledTimes(3);
    expect(mockedRepo.updateAllSoulbitsCloudApiKeys).toHaveBeenLastCalledWith(
      'paseto-v4.local.new',
    );
    stop();
  });

  it('does NOT defer a not-connected error against a LIVE engine (genuine failure)', async () => {
    const { listeners } = captureListeners();
    mockedGetConnection.mockReturnValue(CONN);
    mockedRepo.updateAllSoulbitsCloudApiKeys.mockRejectedValueOnce(new Error(NOT_CONNECTED));

    const stop = startSoulbitsTokenSync();
    const handler = mockedAuth.on.mock.calls[0][1] as (paseto: string) => Promise<void>;

    // The handler swallows (warn) — assert no retry was armed.
    await handler('paseto-v4.local.broken');
    expect(mockedRepo.updateAllSoulbitsCloudApiKeys).toHaveBeenCalledTimes(1);
    // Only the engine-connect heal subscribed; no deferral was armed.
    expect(listeners).toHaveLength(1);

    listeners.forEach(listener => listener(CONN));
    await flush();
    expect(mockedRepo.updateAllSoulbitsCloudApiKeys).toHaveBeenCalledTimes(1);
    stop();
  });
});

// ── Engine-connect heal (the "safety net on app start") ─────────────────────

describe('startSoulbitsTokenSync — engine-connect heal', () => {
  it('heals the engine rows from the cached token once the engine connects', async () => {
    const { listeners } = captureListeners();
    mockedGetConnection.mockReturnValue(null);
    mockedAuth.getToken.mockResolvedValue('paseto-v4.local.cached');
    mockedAuth.getTokenExpiresAt.mockReturnValue(Date.now() + 60 * 60 * 1000);

    const stop = startSoulbitsTokenSync();
    expect(mockedRepo.updateAllSoulbitsCloudApiKeys).not.toHaveBeenCalled();

    // A connection burst must not duplicate the heal (in-flight guard).
    listeners.forEach(listener => listener(CONN));
    listeners.forEach(listener => listener(CONN));
    await flush();

    expect(mockedRepo.updateAllSoulbitsCloudApiKeys).toHaveBeenCalledTimes(1);
    expect(mockedRepo.updateAllSoulbitsCloudApiKeys).toHaveBeenCalledWith(
      'paseto-v4.local.cached',
    );
    stop();
  });

  it('heals immediately when the engine is already connected at start', async () => {
    mockedGetConnection.mockReturnValue(CONN);
    mockedAuth.getToken.mockResolvedValue('paseto-v4.local.already');
    mockedAuth.getTokenExpiresAt.mockReturnValue(Date.now() + 60 * 60 * 1000);

    const stop = startSoulbitsTokenSync();
    await flush();

    expect(mockedRepo.updateAllSoulbitsCloudApiKeys).toHaveBeenCalledWith(
      'paseto-v4.local.already',
    );
    stop();
  });

  it('skips the heal when the cached token is already expired', async () => {
    const { listeners } = captureListeners();
    mockedGetConnection.mockReturnValue(null);
    mockedAuth.getToken.mockResolvedValue('paseto-v4.local.stale');
    mockedAuth.getTokenExpiresAt.mockReturnValue(Date.now() - 1000);

    const stop = startSoulbitsTokenSync();
    listeners.forEach(listener => listener(CONN));
    await flush();

    expect(mockedRepo.updateAllSoulbitsCloudApiKeys).not.toHaveBeenCalled();
    stop();
  });
});

describe('syncCurrentToken', () => {
  it('updates all rows with the cached paseto', async () => {
    mockedAuth.getToken.mockResolvedValue('paseto-v4.local.cached');

    await syncCurrentToken();

    expect(mockedRepo.updateAllSoulbitsCloudApiKeys).toHaveBeenCalledWith(
      'paseto-v4.local.cached',
    );
  });

  it('is a no-op when no token is cached', async () => {
    mockedAuth.getToken.mockRejectedValue(new Error('AuthExpiredError'));

    await expect(syncCurrentToken()).resolves.toBeUndefined();
    expect(mockedRepo.updateAllSoulbitsCloudApiKeys).not.toHaveBeenCalled();
  });

  it('skips an expired cached token (the refresh path emits a fresh one)', async () => {
    mockedAuth.getToken.mockResolvedValue('paseto-v4.local.expired');
    mockedAuth.getTokenExpiresAt.mockReturnValue(Date.now() - 1000);

    await syncCurrentToken();

    expect(mockedRepo.updateAllSoulbitsCloudApiKeys).not.toHaveBeenCalled();
  });
});

describe('injectSoulbitsToken', () => {
  it('injects the paseto into a NEW soulbitscloud config', async () => {
    mockedAuth.getToken.mockResolvedValue('paseto-v4.local.new');

    const result = await injectSoulbitsToken({
      providerType: 'soulbitscloud',
      isCreate: true,
      providerConfig: { name: 'sb', base_url: 'https://api.soulbits.app', api_key: '' },
    });

    expect(result.api_key).toBe('paseto-v4.local.new');
  });

  it('never touches existing soulbitscloud configs (updates)', async () => {
    mockedAuth.getToken.mockResolvedValue('paseto-v4.local.new');

    const result = await injectSoulbitsToken({
      providerType: 'soulbitscloud',
      isCreate: false,
      providerConfig: { name: 'sb', base_url: 'https://api.soulbits.app', api_key: 'user-key' },
    });

    expect(result.api_key).toBe('user-key');
  });

  it('never injects into non-soulbits providers', async () => {
    mockedAuth.getToken.mockResolvedValue('paseto-v4.local.new');

    const result = await injectSoulbitsToken({
      providerType: 'openai',
      isCreate: true,
      providerConfig: { name: 'oa', api_key: 'sk-user' },
    });

    expect(result.api_key).toBe('sk-user');
  });

  it('keeps the user-entered key when no cloud token exists (standalone)', async () => {
    mockedAuth.getToken.mockRejectedValue(new Error('AuthExpiredError'));

    const result = await injectSoulbitsToken({
      providerType: 'soulbitscloud',
      isCreate: true,
      providerConfig: { name: 'sb', base_url: 'https://api.soulbits.app', api_key: 'standalone-key' },
    });

    expect(result.api_key).toBe('standalone-key');
  });
});
