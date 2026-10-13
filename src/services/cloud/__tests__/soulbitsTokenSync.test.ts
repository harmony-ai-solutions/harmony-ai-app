/**
 * Soulbits Token Sync Tests
 *
 * Verifies:
 *  - `startSoulbitsTokenSync()` subscribes to `auth:changed` and pushes the new
 *    PASETO into every non-deleted soulbitscloud provider row.
 *  - `syncCurrentToken()` refreshes once with the currently-cached token.
 *  - `injectSoulbitsToken()` seeds the api_key for NEW soulbitscloud provider
 *    configs only (never updates, never touches other providers).
 */

import AuthService from '../../auth/AuthService';
import { startSoulbitsTokenSync, syncCurrentToken, injectSoulbitsToken } from '../soulbitsTokenSync';
import * as repo from '../../../services/engine/repositories/providers';

jest.mock('../../auth/AuthService', () => ({
  __esModule: true,
  default: {
    on: jest.fn(),
    off: jest.fn(),
    getToken: jest.fn(),
  },
}));

jest.mock('../../../services/engine/repositories/providers', () => ({
  __esModule: true,
  updateAllSoulbitsCloudApiKeys: jest.fn(() => Promise.resolve()),
}));

const mockedAuth = AuthService as jest.Mocked<typeof AuthService>;
const mockedRepo = repo as jest.Mocked<typeof repo>;

beforeEach(() => {
  jest.clearAllMocks();
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

  it('returns a stop() that unsubscribes the exact handler', () => {
    const stop = startSoulbitsTokenSync();
    const handler = mockedAuth.on.mock.calls[0][1];
    stop();
    expect(mockedAuth.off).toHaveBeenCalledWith('auth:changed', handler);
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
