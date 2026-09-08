/**
 * DatabaseContext boot-window wipe tests (phase 3-2 / D61).
 *
 * The one-time wipe check is the FIRST step of `DatabaseContext.initializeDb`
 * — the pre-render boot window gated by `isLoading` → `DatabaseLoadingScreen`.
 * This test exercises the REAL `runWipeRebuildIfPending` sequence (real flag
 * module + real AsyncStorage) wired into the context, with only the native/
 * service boundaries mocked:
 *
 *   - the wipe runs before `initializeDatabase()` (no screen can query a
 *     half-wiped DB),
 *   - the persisted flag is consumed exactly once (a second mount does not
 *     wipe again),
 *   - the D58 rebuild gate (`isRebuilding`) is ON while the wipe runs and OFF
 *     when the wipe completes — not when the first pull finalizes,
 *   - the D19 prefs sweep runs in the same boot flow,
 *   - a failed wipe surfaces the error and leaves the flag set for retry.
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {DatabaseProvider, useDatabase} from '../DatabaseContext';

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

const mockInitializeDatabase: jest.Mock = jest.fn(async () => undefined);
const mockIsDatabaseReady: jest.Mock = jest.fn(() => true);
const mockCloseDatabase: jest.Mock = jest.fn(async () => undefined);

jest.mock('../../database', () => ({
  initializeDatabase: (...args: any[]) => mockInitializeDatabase(...args),
  isDatabaseReady: (...args: any[]) => mockIsDatabaseReady(...args),
  closeDatabase: (...args: any[]) => mockCloseDatabase(...args),
}));

const mockCloseSyncDatabase: jest.Mock = jest.fn(async () => undefined);
const mockWipeDatabaseCompletely: jest.Mock = jest.fn(async () => undefined);

jest.mock('../../database/connection', () => ({
  closeSyncDatabase: (...args: any[]) => mockCloseSyncDatabase(...args),
  wipeDatabaseCompletely: (...args: any[]) => mockWipeDatabaseCompletely(...args),
}));

const mockAbortSync: jest.Mock = jest.fn();
jest.mock('../../services/SyncService', () => ({
  __esModule: true,
  SyncService: {
    getInstance: () => ({abortSync: mockAbortSync}),
  },
  default: {getInstance: () => ({abortSync: mockAbortSync})},
}));

const mockSweepWipePreferences: jest.Mock = jest.fn(async () => undefined);
jest.mock('../../services/ChatPreferencesService', () => ({
  __esModule: true,
  default: {sweepWipePreferences: (...args: any[]) => mockSweepWipePreferences(...args)},
}));

// --- probe: records isRebuilding on every render ------------------------------

const seenRebuilding: boolean[] = [];
function Probe() {
  const {isRebuilding} = useDatabase();
  seenRebuilding.push(isRebuilding);
  return null;
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockStore.clear();
  seenRebuilding.length = 0;
  mockWipeDatabaseCompletely.mockResolvedValue(undefined);
});

const FLAG_KEY = '@harmony_wipe_rebuild_pending';

describe('DatabaseContext boot-window wipe (D61)', () => {
  it('runs the wipe as the FIRST step, before initializeDatabase, and consumes the flag', async () => {
    await mockStore.set(FLAG_KEY, 'true');

    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <DatabaseProvider>
          <Probe />
        </DatabaseProvider>,
      );
      // Flush microtasks: flag read → wipe starts → wipeDatabaseCompletely
      // (mocked, resolves immediately) → sweep → flag clear → init.
    });

    // The full boot sequence ran exactly once.
    expect(mockWipeDatabaseCompletely).toHaveBeenCalledTimes(1);
    expect(mockCloseSyncDatabase).toHaveBeenCalledTimes(1);
    expect(mockAbortSync).toHaveBeenCalledTimes(1);
    expect(mockSweepWipePreferences).toHaveBeenCalledTimes(1);
    expect(mockInitializeDatabase).toHaveBeenCalledTimes(1);

    // Wipe ran BEFORE initializeDatabase (no screen can query a half-wiped DB).
    const wipeIdx = mockWipeDatabaseCompletely.mock.invocationCallOrder[0];
    const initIdx = mockInitializeDatabase.mock.invocationCallOrder[0];
    expect(wipeIdx).toBeLessThan(initIdx);

    // The persisted flag is consumed by the wipe.
    expect(mockStore.has(FLAG_KEY)).toBe(false);

    renderer.unmount();
  });

  it('does NOT wipe again on a second boot (one-time persisted flag)', async () => {
    await mockStore.set(FLAG_KEY, 'true');

    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <DatabaseProvider>
          <Probe />
        </DatabaseProvider>,
      );
    });
    renderer.unmount();
    expect(mockWipeDatabaseCompletely).toHaveBeenCalledTimes(1);

    // Second boot: the flag was cleared by the first wipe → no second wipe.
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <DatabaseProvider>
          <Probe />
        </DatabaseProvider>,
      );
    });
    expect(mockWipeDatabaseCompletely).toHaveBeenCalledTimes(1);
    expect(mockInitializeDatabase).toHaveBeenCalledTimes(2);
    renderer.unmount();
  });

  it('does nothing when no flag is pending (normal boot path unchanged)', async () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <DatabaseProvider>
          <Probe />
        </DatabaseProvider>,
      );
    });

    expect(mockWipeDatabaseCompletely).not.toHaveBeenCalled();
    expect(mockSweepWipePreferences).not.toHaveBeenCalled();
    expect(mockInitializeDatabase).toHaveBeenCalledTimes(1);

    renderer.unmount();
  });

  it('shows the rebuild gate while the wipe runs and clears it when the WIPE completes', async () => {
    await mockStore.set(FLAG_KEY, 'true');

    // Hold the wipe open so we can observe the in-progress gate state.
    let releaseWipe!: () => void;
    mockWipeDatabaseCompletely.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          releaseWipe = resolve;
        }),
    );

    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <DatabaseProvider>
          <Probe />
        </DatabaseProvider>,
      );
    });

    // Wipe is in progress: the gate is ON and initializeDatabase has NOT been
    // called yet (no screen renders against a half-wiped DB).
    expect(seenRebuilding).toContain(true);
    expect(mockInitializeDatabase).not.toHaveBeenCalled();

    // Complete the WIPE (NOT the first pull) — the gate must clear.
    await ReactTestRenderer.act(async () => {
      releaseWipe();
    });

    expect(mockInitializeDatabase).toHaveBeenCalledTimes(1);
    expect(seenRebuilding[seenRebuilding.length - 1]).toBe(false);

    renderer.unmount();
  });

  it('surfaces a wipe failure and leaves the flag set for the next boot', async () => {
    await mockStore.set(FLAG_KEY, 'true');
    mockWipeDatabaseCompletely.mockRejectedValueOnce(new Error('wipe boom'));

    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <DatabaseProvider>
          <Probe />
        </DatabaseProvider>,
      );
    });

    // The provider enters the error state (error surfaced through the context
    // the loading screen renders) and the flag survives for retry.
    expect(mockStore.has(FLAG_KEY)).toBe(true);
    expect(mockInitializeDatabase).not.toHaveBeenCalled();
    // The gate state was released so the loading screen can show the error.
    expect(seenRebuilding[seenRebuilding.length - 1]).toBe(false);

    renderer.unmount();
  });
});