/**
 * Post-cloud-purge full forced re-sync (cloud-data-deletion.md §7 follow-up).
 *
 * Pins the agreed contract — the SIMPLIFIED core:
 *  1. `markFullResyncRequired()` (called by the purge-completion observer in
 *     SyncConnectionContext on purge:done) clears the per-source sync
 *     watermarks → the NEXT `initiateSync` (auto-on-connect OR manual,
 *     in-session or after an app restart) escalates to `force_full_sync: true`
 *     via the SAME cleared-watermark mechanism the boot wipe relies on
 *     (SyncService initiateSync) — with no user action.
 *  2. It stops forcing automatically: the first completed sync rewrites the
 *     watermark on SYNC_FINALIZE, so the sync after that is incremental again.
 *  3. `forceFullSync()` stays the simple `initiateSync(true)` — after a purge
 *     the watermark is 0, so the on-connect auto-sync is already forced and
 *     the purge success dialog's "Re-sync now" needs no extra machinery.
 *
 * The purge:done → mark + auto-reconnect / purge:failed → no reconnect
 * behaviour is pinned in SyncConnectionContext.purgeBlocking.test.tsx.
 */

import {SyncService} from '../SyncService';
import {EventEmitter} from 'eventemitter3';
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
  mockConnectionManager.isConnected.mockClear().mockReturnValue(true);
  mockConnectionManager.removeAllListeners();
  (mockConnectionManager as any).syncServiceListenersInstalled = false;
  (mockConnectionManager as any).syncServiceEventTarget = null;
  resetSingleton();
});

describe('post-purge markFullResyncRequired → next sync forces', () => {
  it('clears the per-source watermarks so the next initiateSync sends force_full_sync: true', async () => {
    // Normal state before the purge: a recent watermark exists.
    await ConnectionStateManager.setLastSync('selfhosted', 1750000000);

    const svc = SyncService.getInstance();
    await svc.markFullResyncRequired();
    expect(mockStore.has('last_sync_timestamp:selfhosted')).toBe(false);

    await svc.initiateSync();
    const requests = sentSyncRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0].payload.force_full_sync).toBe(true);
    expect(requests[0].payload.last_sync_timestamp).toBe(0);
  });

  it('survives an app restart (the user may restart before the first post-purge sync)', async () => {
    await ConnectionStateManager.setLastSync('selfhosted', 1750000000);
    await SyncService.getInstance().markFullResyncRequired();

    // Simulate a process restart: a NEW SyncService instance reads the same
    // persisted AsyncStorage — the escalation must still fire.
    resetSingleton();
    const svc = SyncService.getInstance();
    await svc.initiateSync();

    const requests = sentSyncRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0].payload.force_full_sync).toBe(true);
  });

  it('does NOT force forever: once the first sync completes, the watermark rewrite makes the next sync incremental', async () => {
    await SyncService.getInstance().markFullResyncRequired();

    // First sync — forced (the marker).
    let svc = SyncService.getInstance();
    await svc.initiateSync();
    expect(sentSyncRequests()[0].payload.force_full_sync).toBe(true);

    // SYNC_FINALIZE writes the watermark (same code path handleSyncFinalize
    // uses: ConnectionStateManager.setLastSync with the session start).
    await ConnectionStateManager.setLastSync('selfhosted', 1750000000);

    // Next sync — incremental again.
    resetSingleton();
    svc = SyncService.getInstance();
    await svc.initiateSync();
    const requests = sentSyncRequests();
    expect(requests).toHaveLength(2);
    expect(requests[1].payload.force_full_sync).toBe(false);
    expect(requests[1].payload.last_sync_timestamp).toBe(1750000000);
  });
});

describe('forceFullSync stays the simple initiateSync(true)', () => {
  it('the purge success dialog path forces a full sync regardless of the watermark', async () => {
    // A recent watermark exists (a sync already ran post-purge) — the user
    // taps "Re-sync now": initiateSync(true) must send force_full_sync: true.
    await ConnectionStateManager.setLastSync('selfhosted', 1750000000);

    const svc = SyncService.getInstance();
    await svc.forceFullSync();

    const requests = sentSyncRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0].payload.force_full_sync).toBe(true);
  });
});

describe('full-before-incremental ordering after a purge', () => {
  it('while the post-purge forced sync is in flight, competing incremental triggers are silent no-ops', async () => {
    await SyncService.getInstance().markFullResyncRequired();
    const svc = SyncService.getInstance();

    // Trigger 1 (on-connect auto-sync) — forced via the cleared watermark.
    await svc.initiateSync();
    (svc as any).currentSession.status = 'in_progress';
    expect(sentSyncRequests()).toHaveLength(1);
    expect(sentSyncRequests()[0].payload.force_full_sync).toBe(true);

    // Triggers 2..n (token sync, entity-session kicks, user "Sync now", ...)
    // fire while the forced session is in flight — initiateSync's guard
    // serializes them: nothing new is sent, and NONE of them can start an
    // incremental sync before the forced one completes.
    await svc.initiateSync();
    await svc.initiateSync();
    expect(sentSyncRequests()).toHaveLength(1);
  });

  it('an ABORTED forced sync does not rewrite the watermark — the next sync is still forced', async () => {
    await SyncService.getInstance().markFullResyncRequired();
    const svc = SyncService.getInstance();

    await svc.initiateSync();
    expect(sentSyncRequests()[0].payload.force_full_sync).toBe(true);

    // The forced session dies (connection lost, engine abort, ...) — no
    // SYNC_FINALIZE ran, so the watermark stays cleared.
    svc.abortSync('connection lost mid-forced-sync');

    // The next trigger (reconnect auto-sync) re-runs the FULL re-sync.
    await svc.initiateSync();
    const requests = sentSyncRequests();
    expect(requests).toHaveLength(2);
    expect(requests[1].payload.force_full_sync).toBe(true);
  });
});
