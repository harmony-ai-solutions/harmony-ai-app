import AsyncStorage from '@react-native-async-storage/async-storage';
import { ConnectionStateManager } from '../ConnectionStateManager';

// The global AsyncStorage mock in jest.setup.js always resolves null for
// getItem, which would make seeding/verification meaningless. Give this test
// a real in-memory store so we exercise the actual key names.
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (AsyncStorage.getItem as jest.Mock).mockImplementation(async (k: string) => store.get(k) ?? null);
  (AsyncStorage.setItem as jest.Mock).mockImplementation(async (k: string, v: string) => {
    store.set(k, v);
  });
  (AsyncStorage.removeItem as jest.Mock).mockImplementation(async (k: string) => {
    store.delete(k);
  });
});

/**
 * Tests for the sync watermark contract.
 *
 * Context: wiping the app DB previously only removed the legacy
 * `last_sync_timestamp` key, while the per-source keys
 * (`last_sync_timestamp:selfhosted` / `:cloud`) that getLastSync() actually
 * reads survived. Result: after a wipe the app believed it was already synced
 * up to a recent timestamp, so the next sync requested nothing from the
 * engine ("no data transferred during sync").
 *
 * Decision (Option B): the legacy global alias is dropped entirely. There are
 * no long-lived installs from before the per-source migration, so:
 *  - setLastSync() writes ONLY the per-source key (no dual write)
 *  - getLastSync() reads ONLY the per-source key (no legacy fallback)
 *  - clearAllLastSyncTimestamps() clears the per-source keys (no legacy key)
 */
describe('ConnectionStateManager sync watermark (per-source only)', () => {
  const csm = ConnectionStateManager.getInstance();

  beforeEach(async () => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await csm.clearAllLastSyncTimestamps();
  });

  // ── setLastSync / getLastSync ──────────────────────────────────────────────

  it('setLastSync writes only the per-source key, never the legacy alias', async () => {
    await csm.setLastSync('selfhosted', 111);
    expect(await AsyncStorage.getItem('last_sync_timestamp:selfhosted')).toBe('111');
    expect(await AsyncStorage.getItem('last_sync_timestamp')).toBeNull();
  });

  it('getLastSync reads the per-source key for the given source', async () => {
    await csm.setLastSync('selfhosted', 111);
    await csm.setLastSync('cloud', 222);
    expect(await csm.getLastSync('selfhosted')).toBe(111);
    expect(await csm.getLastSync('cloud')).toBe(222);
  });

  it('getLastSync returns 0 when the per-source key is missing (no legacy fallback)', async () => {
    // Seed ONLY the legacy key — it must be ignored entirely.
    await AsyncStorage.setItem('last_sync_timestamp', '999');
    expect(await csm.getLastSync('selfhosted')).toBe(0);
    expect(await csm.getLastSync('cloud')).toBe(0);
  });

  // ── clearAllLastSyncTimestamps ─────────────────────────────────────────────

  it('clears the selfhosted per-source key', async () => {
    await csm.setLastSync('selfhosted', 111);
    expect(await csm.getLastSync('selfhosted')).toBe(111);
    await csm.clearAllLastSyncTimestamps();
    expect(await csm.getLastSync('selfhosted')).toBe(0);
  });

  it('clears the cloud per-source key', async () => {
    await csm.setLastSync('cloud', 222);
    expect(await csm.getLastSync('cloud')).toBe(222);
    await csm.clearAllLastSyncTimestamps();
    expect(await csm.getLastSync('cloud')).toBe(0);
  });

  it('is idempotent (safe to call when no watermark exists)', async () => {
    await expect(csm.clearAllLastSyncTimestamps()).resolves.toBeUndefined();
    expect(await csm.getLastSync('selfhosted')).toBe(0);
  });

  it('does not affect other AsyncStorage keys (credentials untouched)', async () => {
    await AsyncStorage.setItem('harmony_jwt', 'abc');
    await AsyncStorage.setItem('harmony_security_mode', 'insecure-ssl');
    await csm.setLastSync('cloud', 222);
    await csm.clearAllLastSyncTimestamps();
    expect(await AsyncStorage.getItem('harmony_jwt')).toBe('abc');
    expect(await AsyncStorage.getItem('harmony_security_mode')).toBe('insecure-ssl');
    expect(await csm.getLastSync('cloud')).toBe(0);
  });
});
