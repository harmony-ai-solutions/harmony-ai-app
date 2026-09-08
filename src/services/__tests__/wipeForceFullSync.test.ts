/**
 * Post-wipe pull-not-push verification (phase 3-2, review-3 rewrite).
 *
 * The guarantee behind the one-time wipe + rebuild is the CLEARED-WATERMARK →
 * `force_full_sync` escalation in `initiateSync` (`SyncService.ts:505-517`):
 * when `getLastSyncTimestamp()` returns 0 (the wipe's
 * `clearAllLastSyncTimestamps` removed the per-source watermark), the FIRST
 * post-wipe `initiateSync` sends `force_full_sync: true`, and the engine
 * re-sends everything.
 *
 * The `@harmony_sync_initial_upload_done:{source}` flag is NOT cleared by
 * either wipe helper and NEVER gates pulls — it only shapes upload
 * `since`-values, which `forceFullSync` zeroes anyway; an empty DB uploads
 * zero SYNC_DATA events regardless. Its post-wipe inconsistency is harmless.
 */

import {SyncService} from '../SyncService';
import {EventEmitter} from 'eventemitter3';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ConnectionStateManager from '../ConnectionStateManager';

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

let mockConnectionManager: EventEmitter & {
  sendEvent: jest.Mock;
  isConnected: jest.Mock;
};

jest.mock('../connection/ConnectionManager', () => {
  const {EventEmitter: EE} = require('eventemitter3');
  const cm: EventEmitter & {sendEvent: jest.Mock; isConnected: jest.Mock} = new EE();
  cm.sendEvent = jest.fn().mockResolvedValue(undefined);
  cm.isConnected = jest.fn().mockReturnValue(true);
  mockConnectionManager = cm;
  return {__esModule: true, default: cm};
});

function resetSingleton(): void {
  (SyncService as any).instance = null;
}

function sentSyncRequests(): any[] {
  return mockConnectionManager.sendEvent.mock.calls
    .map(([type, event]: [string, any]) => ({type, event}))
    .filter(c => c.type === 'sync' && c.event?.event_type === 'SYNC_REQUEST')
    .map(c => c.event);
}

beforeEach(async () => {
  mockStore.clear();
  mockConnectionManager.sendEvent.mockClear();
  mockConnectionManager.removeAllListeners();
  (mockConnectionManager as any).syncServiceListenersInstalled = false;
  (mockConnectionManager as any).syncServiceEventTarget = null;
  resetSingleton();
});

describe('first post-wipe initiateSync (watermark escalation)', () => {
  it('sends force_full_sync: true when the watermark is cleared (post-wipe)', async () => {
    // Simulate the post-wipe state: the wipe helper cleared the per-source
    // watermark (clearAllLastSyncTimestamps), so getLastSyncTimestamp() → 0.
    await ConnectionStateManager.clearAllLastSyncTimestamps();
    expect(mockStore.has('last_sync_timestamp:selfhosted')).toBe(false);

    const svc = SyncService.getInstance();
    await svc.initiateSync();

    const requests = sentSyncRequests();
    expect(requests.length).toBe(1);
    expect(requests[0].payload.force_full_sync).toBe(true);
    expect(requests[0].payload.last_sync_timestamp).toBe(0);
  });

  it('the surviving @harmony_sync_initial_upload_done flag does NOT gate the pull', async () => {
    // The wipe helpers never clear the per-table initial-upload set. It only
    // shapes upload `since`-values — a pull is unaffected.
    await AsyncStorage.setItem(
      '@harmony_sync_initial_upload_done:selfhosted',
      JSON.stringify(['entities', 'character_profiles']),
    );
    expect(await AsyncStorage.getItem('@harmony_sync_initial_upload_done:selfhosted')).toBe(
      JSON.stringify(['entities', 'character_profiles']),
    );

    const svc = SyncService.getInstance();
    await svc.initiateSync();

    const requests = sentSyncRequests();
    expect(requests.length).toBe(1);
    expect(requests[0].payload.force_full_sync).toBe(true);
  });

  it('a stored watermark does NOT escalate (normal incremental pull)', async () => {
    // Control: with a watermark present, initiateSync must NOT force a full
    // pull — the escalation is strictly `storedLastSync === 0`.
    await ConnectionStateManager.setLastSync('selfhosted', 1750000000);

    const svc = SyncService.getInstance();
    await svc.initiateSync();

    const requests = sentSyncRequests();
    expect(requests.length).toBe(1);
    expect(requests[0].payload.force_full_sync).toBe(false);
    expect(requests[0].payload.last_sync_timestamp).toBe(1750000000);
  });
});