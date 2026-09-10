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
 * Tests for the sync estimate confirmation limit contract.
 *
 * Semantics:
 *  - getSyncEstimateLimitMB() returns a number (the MB threshold) or null
 *    for "Unlimited".
 *  - The DEFAULT is 5 MB whenever the key is unset, empty, or invalid.
 *  - "Unlimited" is persisted as the string 'unlimited'.
 *  - Numeric limits are persisted as String(n).
 */
describe('ConnectionStateManager sync estimate limit', () => {
  const csm = ConnectionStateManager.getInstance();

  beforeEach(async () => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await csm.clearSyncEstimateLimitMB();
  });

  // ── getSyncEstimateLimitMB ──────────────────────────────────────────────

  it('returns 5 (default) when the key is unset', async () => {
    expect(await csm.getSyncEstimateLimitMB()).toBe(5);
  });

  it('returns 5 (default) when the key is empty', async () => {
    await AsyncStorage.setItem('sync_estimate_limit_mb', '');
    expect(await csm.getSyncEstimateLimitMB()).toBe(5);
  });

  it('returns 5 (default) when the key holds an invalid value', async () => {
    await AsyncStorage.setItem('sync_estimate_limit_mb', 'not-a-number');
    expect(await csm.getSyncEstimateLimitMB()).toBe(5);
  });

  it('returns the parsed number for a numeric limit', async () => {
    await AsyncStorage.setItem('sync_estimate_limit_mb', '20');
    expect(await csm.getSyncEstimateLimitMB()).toBe(20);
  });

  it('returns null for Unlimited', async () => {
    await AsyncStorage.setItem('sync_estimate_limit_mb', 'unlimited');
    expect(await csm.getSyncEstimateLimitMB()).toBeNull();
  });

  // ── setSyncEstimateLimitMB ──────────────────────────────────────────────

  it('persists a numeric limit as String(n) and reads it back', async () => {
    await csm.setSyncEstimateLimitMB(50);
    expect(await AsyncStorage.getItem('sync_estimate_limit_mb')).toBe('50');
    expect(await csm.getSyncEstimateLimitMB()).toBe(50);
  });

  it('persists Unlimited as the string "unlimited" and reads it back as null', async () => {
    await csm.setSyncEstimateLimitMB(null);
    expect(await AsyncStorage.getItem('sync_estimate_limit_mb')).toBe('unlimited');
    expect(await csm.getSyncEstimateLimitMB()).toBeNull();
  });

  it('overwrites a previous numeric limit with Unlimited', async () => {
    await csm.setSyncEstimateLimitMB(100);
    await csm.setSyncEstimateLimitMB(null);
    expect(await csm.getSyncEstimateLimitMB()).toBeNull();
  });

  // ── clearSyncEstimateLimitMB ────────────────────────────────────────────

  it('removes the key so the default (5) applies again', async () => {
    await csm.setSyncEstimateLimitMB(100);
    await csm.clearSyncEstimateLimitMB();
    expect(await AsyncStorage.getItem('sync_estimate_limit_mb')).toBeNull();
    expect(await csm.getSyncEstimateLimitMB()).toBe(5);
  });

  it('does not affect other AsyncStorage keys', async () => {
    await AsyncStorage.setItem('harmony_jwt', 'abc');
    await AsyncStorage.setItem('harmony_security_mode', 'secure');
    await csm.setSyncEstimateLimitMB(20);
    expect(await AsyncStorage.getItem('harmony_jwt')).toBe('abc');
    expect(await AsyncStorage.getItem('harmony_security_mode')).toBe('secure');
  });
});
