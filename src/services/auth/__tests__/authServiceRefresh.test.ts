/**
 * AuthService — proactive startup refresh (`refreshIfExpiring`) + the shared
 * deduplicated refresh (`refreshDeduped`) it routes through.
 *
 * The Keychain token store is mocked so we can seed a cached credential, and
 * `global.fetch` is stubbed to drive refresh outcomes. Covers: a comfortably
 * fresh token is a no-op; a near-expiry token triggers exactly one refresh;
 * concurrent proactive refreshes collapse into ONE network call (dedup); a
 * terminal (401) failure resolves `false` without throwing; a transient failure
 * throws (so the startup caller swallows it) with a single attempt; absent and
 * refresh-less credentials are no-ops.
 */

import AuthService from '../AuthService';
import { AUTH_ENDPOINTS } from '../../../config/cloud';
import { loadTokens, saveTokens, clearTokens } from '../tokenStorage';

jest.mock('../tokenStorage', () => ({
  __esModule: true,
  loadTokens: jest.fn(),
  saveTokens: jest.fn(),
  clearTokens: jest.fn(),
}));

const mockedLoad = loadTokens as jest.Mock;
const mockedSave = saveTokens as jest.Mock;
const mockedClear = clearTokens as jest.Mock;

const HOUR = 60 * 60 * 1000;

/** A cached Keychain blob whose PASETO expires `expiresInMs` from now. */
const blob = (expiresInMs: number, refresh = 'refresh-1') => ({
  paseto: 'cached-paseto',
  refresh,
  expires_at: new Date(Date.now() + expiresInMs).toISOString(),
});

const okTokenResponse = () => ({
  token: 'fresh-paseto',
  refresh_token: 'fresh-refresh',
  expires_at: new Date(Date.now() + HOUR).toISOString(),
});

const flush = async () => {
  for (let i = 0; i < 12; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
};

beforeEach(async () => {
  jest.clearAllMocks();
  mockedSave.mockResolvedValue(undefined);
  mockedClear.mockResolvedValue(undefined);
  (global as any).fetch = jest.fn();
  // Reset the singleton's in-memory cache between tests (the module registry,
  // and therefore the singleton, is shared across tests in this file).
  await AuthService.invalidate().catch(() => undefined);
});

describe('AuthService.refreshIfExpiring', () => {
  it('does not refresh a comfortably-fresh cached token', async () => {
    mockedLoad.mockResolvedValue(blob(30 * 60 * 1000)); // 30 min left
    await AuthService.getToken();

    await expect(AuthService.refreshIfExpiring()).resolves.toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refreshes once when the cached token is within the threshold', async () => {
    mockedLoad.mockResolvedValue(blob(2 * 60 * 1000)); // 2 min left (< 5 min)
    await AuthService.getToken();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => okTokenResponse(),
    });

    await expect(AuthService.refreshIfExpiring()).resolves.toBe(true);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      AUTH_ENDPOINTS.refresh,
      expect.objectContaining({ method: 'POST' }),
    );
    await expect(AuthService.getToken()).resolves.toBe('fresh-paseto');
  });

  it('deduplicates concurrent proactive refreshes into a single network call', async () => {
    mockedLoad.mockResolvedValue(blob(60 * 1000)); // 1 min left
    await AuthService.getToken();

    let resolveFetch!: (value: unknown) => void;
    (global.fetch as jest.Mock).mockImplementation(
      () => new Promise(resolve => { resolveFetch = resolve; }),
    );

    const first = AuthService.refreshIfExpiring();
    const second = AuthService.refreshIfExpiring();
    await flush();

    // Both callers share ONE in-flight refresh.
    expect(global.fetch).toHaveBeenCalledTimes(1);

    resolveFetch({ ok: true, status: 200, json: async () => okTokenResponse() });
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
  });

  it('returns false on a terminal (401) refresh without throwing', async () => {
    mockedLoad.mockResolvedValue(blob(60 * 1000));
    await AuthService.getToken();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    });

    await expect(AuthService.refreshIfExpiring()).resolves.toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('throws on a transient failure with a single attempt (caller swallows)', async () => {
    mockedLoad.mockResolvedValue(blob(60 * 1000));
    await AuthService.getToken();
    (global.fetch as jest.Mock).mockRejectedValue(new Error('offline'));

    await expect(AuthService.refreshIfExpiring()).rejects.toThrow('network error');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when no credential is cached', async () => {
    mockedLoad.mockResolvedValue(null);

    await expect(AuthService.refreshIfExpiring()).resolves.toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not refresh when no refresh token is cached', async () => {
    mockedLoad.mockResolvedValue(blob(-60 * 1000, '')); // expired, no refresh token
    await AuthService.getToken();

    await expect(AuthService.refreshIfExpiring()).resolves.toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
