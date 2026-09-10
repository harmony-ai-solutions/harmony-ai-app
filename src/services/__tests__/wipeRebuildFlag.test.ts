/**
 * Wipe-rebuild flag module tests (phase 3-2 / D61).
 *
 * Pins the generic one-time wipe flag flow built here and reused by phase 4-5
 * (D76 purge-floor rebuild reaction — that phase only calls `setWipeRebuildFlag`
 * before a process restart; the boot window performs the wipe):
 *   - flag persistence round-trip (set / check / clear),
 *   - the boot sequence runs ONLY when the flag is pending,
 *   - the wipe order is belt-and-braces: close lazy syncDb → reset SyncService
 *     in-memory state → production wipe → D19 prefs sweep → clear flag,
 *   - the D58 gate state callback flips on at wipe start and off at completion
 *     (the loading-screen label clears when the WIPE completes),
 *   - a FAILED wipe leaves the flag set so the next boot retries (crash-safety;
 *     the wipe helper's own `initializeDatabase` re-init is exercised by the
 *     integration test instead of here).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getWipeRebuildFlag,
  setWipeRebuildFlag,
  clearWipeRebuildFlag,
  runWipeRebuildIfPending,
  hasRebuildCompletedInProcess,
  _resetRebuildCompletedInProcessForTests,
} from '../WipeRebuildFlag';

// --- module-level refs for hoisted jest.mock factories -----------------------

const mockStore = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStore.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStore.delete(key);
    }),
    multiRemove: jest.fn(async (keys: string[]) => {
      keys.forEach(key => mockStore.delete(key));
    }),
    getAllKeys: jest.fn(async () => Array.from(mockStore.keys())),
    clear: jest.fn(async () => {
      mockStore.clear();
    }),
  },
}));

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

const mockCloseSyncDatabase: jest.Mock = jest.fn(async () => undefined);
const mockWipeDatabaseCompletely: jest.Mock = jest.fn(async () => undefined);

jest.mock('../../database/connection', () => ({
  closeSyncDatabase: (...args: any[]) => mockCloseSyncDatabase(...args),
  wipeDatabaseCompletely: (...args: any[]) => mockWipeDatabaseCompletely(...args),
}));

const mockAbortSync: jest.Mock = jest.fn();
jest.mock('../SyncService', () => ({
  __esModule: true,
  SyncService: {
    getInstance: () => ({abortSync: mockAbortSync}),
  },
  default: {getInstance: () => ({abortSync: mockAbortSync})},
}));

const mockSweepWipePreferences: jest.Mock = jest.fn(async () => undefined);
jest.mock('../ChatPreferencesService', () => ({
  __esModule: true,
  default: {sweepWipePreferences: (...args: any[]) => mockSweepWipePreferences(...args)},
}));

beforeEach(async () => {
  jest.clearAllMocks();
  mockStore.clear();
  _resetRebuildCompletedInProcessForTests();
});

const FLAG_KEY = '@harmony_wipe_rebuild_pending';

describe('WipeRebuildFlag — flag persistence', () => {
  it('round-trips set → check → clear', async () => {
    expect(await getWipeRebuildFlag()).toBe(false);
    await setWipeRebuildFlag();
    expect(await getWipeRebuildFlag()).toBe(true);
    expect(mockStore.get(FLAG_KEY)).toBe('true');
    await clearWipeRebuildFlag();
    expect(await getWipeRebuildFlag()).toBe(false);
  });

  it('returns false when storage read fails (never wedges the boot)', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('boom'));
    expect(await getWipeRebuildFlag()).toBe(false);
  });
});

describe('WipeRebuildFlag — boot sequence (D61)', () => {
  it('does nothing when no flag is pending', async () => {
    const state: boolean[] = [];
    const wiped = await runWipeRebuildIfPending(s => state.push(s));

    expect(wiped).toBe(false);
    expect(state).toEqual([]);
    expect(mockWipeDatabaseCompletely).not.toHaveBeenCalled();
    expect(mockCloseSyncDatabase).not.toHaveBeenCalled();
    expect(mockAbortSync).not.toHaveBeenCalled();
    expect(mockSweepWipePreferences).not.toHaveBeenCalled();
  });

  it('runs the full wipe sequence exactly once and clears the flag', async () => {
    await setWipeRebuildFlag();

    const state: boolean[] = [];
    const wiped = await runWipeRebuildIfPending(s => state.push(s));

    expect(wiped).toBe(true);

    // Belt-and-braces order: close lazy syncDb → reset SyncService in-memory
    // state → production wipe → D19 prefs sweep → clear flag.
    expect(mockCloseSyncDatabase).toHaveBeenCalledTimes(1);
    expect(mockAbortSync).toHaveBeenCalledTimes(1);
    expect(mockWipeDatabaseCompletely).toHaveBeenCalledTimes(1);
    expect(mockSweepWipePreferences).toHaveBeenCalledTimes(1);

    // Order assertion: wipe before sweep before clear.
    const closeIdx = mockCloseSyncDatabase.mock.invocationCallOrder[0];
    const abortIdx = mockAbortSync.mock.invocationCallOrder[0];
    const wipeIdx = mockWipeDatabaseCompletely.mock.invocationCallOrder[0];
    const sweepIdx = mockSweepWipePreferences.mock.invocationCallOrder[0];
    expect(closeIdx).toBeLessThan(wipeIdx);
    expect(abortIdx).toBeLessThan(wipeIdx);
    expect(wipeIdx).toBeLessThan(sweepIdx);

    // Flag cleared — the NEXT boot does not wipe again.
    expect(await getWipeRebuildFlag()).toBe(false);
    expect(mockStore.has(FLAG_KEY)).toBe(false);
  });

  it('flips the gate state on at wipe start and off at completion (D58/D61 label)', async () => {
    await setWipeRebuildFlag();
    const state: boolean[] = [];
    await runWipeRebuildIfPending(s => state.push(s));

    // True while the wipe runs, false when it completes — the
    // "Rebuilding from Soulbits Engine…" label clears with the WIPE, not with
    // the first post-wipe pull.
    expect(state).toEqual([true, false]);
  });

  it('leaves the flag SET when the wipe fails (retried next boot), and still clears the gate state', async () => {
    await setWipeRebuildFlag();
    mockWipeDatabaseCompletely.mockRejectedValueOnce(new Error('wipe boom'));

    const state: boolean[] = [];
    await expect(runWipeRebuildIfPending(s => state.push(s))).rejects.toThrow(
      'wipe boom',
    );

    // Crash-safety: the flag survives so the next boot retries the wipe.
    expect(await getWipeRebuildFlag()).toBe(true);
    // The gate state is still released so the UI can surface the error.
    expect(state).toEqual([true, false]);
  });
});

describe('WipeRebuildFlag — in-process rebuild-completed marker (4-5 / D82 loop guard)', () => {
  it('is false on a fresh module (a new process has no completed rebuild)', () => {
    expect(hasRebuildCompletedInProcess()).toBe(false);
  });

  it('becomes true when the boot wipe completes (the rebuild happened this process)', async () => {
    await setWipeRebuildFlag();
    await runWipeRebuildIfPending();

    expect(hasRebuildCompletedInProcess()).toBe(true);
  });

  it('stays false when the wipe FAILS (no completed rebuild → a later signal still restarts)', async () => {
    await setWipeRebuildFlag();
    mockWipeDatabaseCompletely.mockRejectedValueOnce(new Error('wipe boom'));
    await expect(runWipeRebuildIfPending()).rejects.toThrow('wipe boom');

    expect(hasRebuildCompletedInProcess()).toBe(false);
  });
});