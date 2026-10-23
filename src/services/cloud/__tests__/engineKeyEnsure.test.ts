/**
 * Engine key ensure — unit tests (2026-10-23 incident fix).
 *
 * Verifies the long-lived `Soulbits Engine` API-key flow:
 *  - find-and-reuse when the engine row already holds the active named key
 *    (no mint, no write);
 *  - mint-on-missing + write through the existing bulk-refresh path;
 *  - newest-wins when several keys carry the name;
 *  - write-once (no write when the row is unchanged);
 *  - the 5-active-key cap (409) is an honest outcome with NO retry loop;
 *  - signed-out is a true no-op (nothing is read or written);
 *  - concurrent callers share ONE single-flight attempt.
 */

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import AuthService from '../../auth/AuthService';
import * as repo from '../../../database/repositories';
import { buildSoulbitsClient } from '../soulbitsClient';
import {
  CLOUD_ENGINE_KEY_NAME,
  ensureCloudEngineKey,
  getLastAppliedEngineKey,
  resetEngineKeyEnsureForTests,
} from '../engineKeyEnsure';

jest.mock('../../auth/AuthService', () => ({
  __esModule: true,
  default: { getToken: jest.fn() },
}));

jest.mock('../../../database/repositories', () => ({
  __esModule: true,
  listAccounts: jest.fn(),
  updateAllSoulbitsCloudApiKeys: jest.fn(),
}));

jest.mock('../soulbitsClient', () => ({
  __esModule: true,
  buildSoulbitsClient: jest.fn(),
}));

const auth = AuthService as unknown as { getToken: jest.Mock };
const r = repo as unknown as {
  listAccounts: jest.Mock;
  updateAllSoulbitsCloudApiKeys: jest.Mock;
};
const mockedBuildClient = buildSoulbitsClient as jest.Mock;

const apiKeys = {
  listAPIKeysOrThrow: jest.fn(),
  createAPIKeyOrThrow: jest.fn(),
};

const PASETO = 'v4.local.paseto-account';
const KEY_A = 'sb_cloud_aaaaaaaaaaaaaaaa';
const KEY_B = 'sb_cloud_bbbbbbbbbbbbbbbb';
const PREFIX_A = KEY_A.slice(0, 12);
const PREFIX_B = KEY_B.slice(0, 12);

const account = (apiKey: string) => ({
  id: 'acct-1',
  type: 'soulbitscloud',
  name: 'Soulbits Cloud',
  api_key: apiKey,
  base_url: 'https://inference.example',
  extra: '{}',
  created_at: null,
  updated_at: null,
  deleted_at: null,
});

const listedKey = (over: Record<string, unknown> = {}) => ({
  id: 'key-1',
  name: CLOUD_ENGINE_KEY_NAME,
  prefix: PREFIX_A,
  created_at: '2026-10-01T00:00:00Z',
  last_used_at: null,
  ...over,
});

const flush = async () => {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
};

beforeEach(() => {
  jest.clearAllMocks();
  resetEngineKeyEnsureForTests();

  auth.getToken.mockResolvedValue(PASETO);
  r.listAccounts.mockResolvedValue([account('')]);
  r.updateAllSoulbitsCloudApiKeys.mockResolvedValue(undefined);

  mockedBuildClient.mockReturnValue({ apiKeys } as any);
  apiKeys.listAPIKeysOrThrow.mockResolvedValue([]);
  apiKeys.createAPIKeyOrThrow.mockResolvedValue({
    id: 'key-new',
    name: CLOUD_ENGINE_KEY_NAME,
    key: KEY_A,
    prefix: PREFIX_A,
    created_at: '2026-10-23T00:00:00Z',
  });
});

describe('ensureCloudEngineKey — reuse', () => {
  it('reuses the key the engine row already holds (no mint, no write)', async () => {
    r.listAccounts.mockResolvedValue([account(KEY_A)]);
    apiKeys.listAPIKeysOrThrow.mockResolvedValue([listedKey()]);

    const result = await ensureCloudEngineKey();

    expect(result).toMatchObject({ status: 'reused', key: KEY_A, keyId: 'key-1' });
    expect(apiKeys.createAPIKeyOrThrow).not.toHaveBeenCalled();
    expect(r.updateAllSoulbitsCloudApiKeys).not.toHaveBeenCalled();
  });

  it('picks the newest key when several carry the name', async () => {
    r.listAccounts.mockResolvedValue([account(KEY_B)]);
    apiKeys.listAPIKeysOrThrow.mockResolvedValue([
      listedKey({ id: 'key-old', prefix: PREFIX_A, created_at: '2026-09-01T00:00:00Z' }),
      listedKey({ id: 'key-new', prefix: PREFIX_B, created_at: '2026-10-22T00:00:00Z' }),
    ]);

    const result = await ensureCloudEngineKey();

    expect(result).toMatchObject({ status: 'reused', key: KEY_B, keyId: 'key-new' });
    expect(apiKeys.createAPIKeyOrThrow).not.toHaveBeenCalled();
    expect(r.updateAllSoulbitsCloudApiKeys).not.toHaveBeenCalled();
  });
});

describe('ensureCloudEngineKey — mint', () => {
  it('mints the one key and writes it when the account has none', async () => {
    r.listAccounts.mockResolvedValue([account('')]);

    const result = await ensureCloudEngineKey();

    expect(apiKeys.createAPIKeyOrThrow).toHaveBeenCalledWith(CLOUD_ENGINE_KEY_NAME);
    expect(r.updateAllSoulbitsCloudApiKeys).toHaveBeenCalledWith(KEY_A);
    expect(result).toMatchObject({ status: 'applied', key: KEY_A, minted: true });
    expect(getLastAppliedEngineKey()).toBe(KEY_A);
  });

  it('replaces a legacy PASETO row with the long-lived key', async () => {
    r.listAccounts.mockResolvedValue([account(PASETO)]);
    apiKeys.listAPIKeysOrThrow.mockResolvedValue([]);

    const result = await ensureCloudEngineKey();

    expect(result.status).toBe('applied');
    expect(apiKeys.createAPIKeyOrThrow).toHaveBeenCalledTimes(1);
    expect(r.updateAllSoulbitsCloudApiKeys).toHaveBeenCalledWith(KEY_A);
  });

  it('writes once and never again while the row keeps the key', async () => {
    r.listAccounts.mockResolvedValue([account('')]);

    const first = await ensureCloudEngineKey();
    expect(first.status).toBe('applied');

    r.listAccounts.mockResolvedValue([account(KEY_A)]);
    const second = await ensureCloudEngineKey();

    expect(second).toMatchObject({ status: 'unchanged', key: KEY_A });
    expect(apiKeys.createAPIKeyOrThrow).toHaveBeenCalledTimes(1);
    expect(r.updateAllSoulbitsCloudApiKeys).toHaveBeenCalledTimes(1);
  });

  it('re-applies the resolved key when the row lost it', async () => {
    r.listAccounts.mockResolvedValue([account('')]);
    await ensureCloudEngineKey();

    r.listAccounts.mockResolvedValue([account('')]);
    const second = await ensureCloudEngineKey();

    expect(second.status).toBe('applied');
    expect(apiKeys.createAPIKeyOrThrow).toHaveBeenCalledTimes(1);
    expect(r.updateAllSoulbitsCloudApiKeys).toHaveBeenCalledTimes(2);
  });
});

describe('ensureCloudEngineKey — cap', () => {
  it('reports the 5-key cap honestly with no write and no retry', async () => {
    r.listAccounts.mockResolvedValue([account(PASETO)]);
    apiKeys.listAPIKeysOrThrow.mockResolvedValue([]);
    apiKeys.createAPIKeyOrThrow.mockRejectedValue(
      Object.assign(new Error('maximum number of active API keys reached'), { status: 409 }),
    );

    const result = await ensureCloudEngineKey();

    expect(result).toEqual({ status: 'cap_reached' });
    expect(apiKeys.createAPIKeyOrThrow).toHaveBeenCalledTimes(1);
    expect(r.updateAllSoulbitsCloudApiKeys).not.toHaveBeenCalled();
  });
});

describe('ensureCloudEngineKey — signed out', () => {
  it('is a true no-op without a cloud credential (standalone mode)', async () => {
    auth.getToken.mockRejectedValue(new Error('AuthExpiredError'));

    const result = await ensureCloudEngineKey();

    expect(result).toEqual({ status: 'signed_out' });
    expect(mockedBuildClient).not.toHaveBeenCalled();
    expect(r.listAccounts).not.toHaveBeenCalled();
    expect(r.updateAllSoulbitsCloudApiKeys).not.toHaveBeenCalled();
    expect(apiKeys.createAPIKeyOrThrow).not.toHaveBeenCalled();
  });
});

describe('ensureCloudEngineKey — single flight', () => {
  it('shares one attempt between concurrent callers', async () => {
    r.listAccounts.mockResolvedValue([account('')]);
    let release: (keys: unknown[]) => void = () => undefined;
    apiKeys.listAPIKeysOrThrow.mockReturnValue(
      new Promise(resolve => {
        release = resolve;
      }),
    );

    const first = ensureCloudEngineKey();
    const second = ensureCloudEngineKey();
    await flush();

    expect(apiKeys.listAPIKeysOrThrow).toHaveBeenCalledTimes(1);

    release([]);
    const [a, b] = await Promise.all([first, second]);

    expect(a).toEqual(b);
    expect(a.status).toBe('applied');
    expect(apiKeys.createAPIKeyOrThrow).toHaveBeenCalledTimes(1);
    expect(r.updateAllSoulbitsCloudApiKeys).toHaveBeenCalledTimes(1);
  });
});
