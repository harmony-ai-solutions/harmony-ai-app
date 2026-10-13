/**
 * EngineDbKey — unit tests (task 4-2).
 */

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import {
  ENGINE_DB_KEY_SERVICE,
  generateEngineDbKeyMaterial,
  getOrCreateEngineDbKey,
  resetEngineDbKey,
} from '../EngineDbKey';
import type { DbKeyStore } from '../EngineDbKey';

function fakeStore(initial: string | null = null): DbKeyStore & { value: string | null } {
  const store = {
    value: initial,
    async get() { return store.value; },
    async set(v: string) { store.value = v; },
    async remove() { store.value = null; },
  };
  return store;
}

describe('generateEngineDbKeyMaterial', () => {
  it('produces a unique 32-byte (44-char base64) key', () => {
    const a = generateEngineDbKeyMaterial();
    const b = generateEngineDbKeyMaterial();
    expect(a).toHaveLength(44);
    expect(a.endsWith('=')).toBe(true);
    expect(a).not.toBe(b);
    expect(Buffer.from(a, 'base64')).toHaveLength(32);
  });
});

describe('getOrCreateEngineDbKey', () => {
  it('returns the existing key without rotating it', async () => {
    const store = fakeStore('existing-key');
    await expect(getOrCreateEngineDbKey(store)).resolves.toBe('existing-key');
  });

  it('generates and persists a key on first use', async () => {
    const store = fakeStore(null);
    const key = await getOrCreateEngineDbKey(store);
    expect(key).not.toBeNull();
    expect(store.value).toBe(key);
  });

  it('returns null (engine runs unencrypted) when persistence fails', async () => {
    const store: DbKeyStore = {
      get: async () => null,
      set: async () => { throw new Error('keychain unavailable'); },
      remove: async () => undefined,
    };
    await expect(getOrCreateEngineDbKey(store)).resolves.toBeNull();
  });

  it('reset removes the stored key', async () => {
    const store = fakeStore('k');
    await resetEngineDbKey(store);
    expect(store.value).toBeNull();
  });

  it('exposes a stable keychain service name', () => {
    expect(ENGINE_DB_KEY_SERVICE).toBe('soulbits.engine.db-key');
  });
});
