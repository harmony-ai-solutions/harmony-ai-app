/**
 * Regression test: a failed applyBufferedSyncData must clear the session so
 * future syncs are not permanently blocked.
 *
 * BACKGROUND (observed on-device): when applyBufferedSyncData() rejects (e.g.
 * the database was never initialized after a failed migration), the catch in
 * handleSyncComplete cleared the buffer + serverRecordIds and emitted
 * sync:error, but left `currentSession` with status 'in_progress' and
 * syncPhase = 'SERVER_SENDING'. The initiateSync guard then rejected every
 * future sync with "Sync already in progress (or awaiting acceptance),
 * skipping" — the app was permanently stuck until a process restart, and a
 * user-initiated force re-sync did nothing.
 *
 * This test pins the fix: after a failed apply, currentSession is cleared,
 * syncPhase resets to IDLE, and a subsequent initiateSync proceeds normally.
 */

import {SyncService} from '../SyncService';
import {EventEmitter} from 'eventemitter3';

// ConnectionManager singleton — real EventEmitter so tests can emit sync events.
let mockConnectionManager: EventEmitter & {
  sendEvent: jest.Mock;
  isConnected: jest.Mock;
};

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

// Mock the sync database so applyBufferedSyncData fails deterministically at
// getSyncDatabase() — the exact failure mode seen on-device when the app ran
// with db === null (failed migration).
jest.mock('../../database/connection', () => ({
  getDatabase: jest.fn(),
  getSyncDatabase: jest.fn().mockRejectedValue(
    new Error('Main database not initialized. Call initializeDatabase() first.'),
  ),
}));

// Minimal SyncHelpers surface — the apply path only reaches getSyncDatabase()
// before throwing, but the import must resolve.
jest.mock('../../database/sync', () => ({
  toUnixTimestamp: jest.fn((v: any) => (typeof v === 'number' ? v : Date.parse(v))),
  getChangedRecords: jest.fn(() => Promise.resolve([])),
  cleanupOrphanEntityModuleMappings: jest.fn(() => Promise.resolve(0)),
  cleanupOrphanedMemories: jest.fn(() => Promise.resolve(0)),
  normalizeRecordTimestamps: jest.fn((r: any) => r),
}));

// EntityEmojiActionService — invalidateAllCaches is only called on the success
// path; stub it so the module import resolves.
jest.mock('../EntityEmojiActionService', () => ({
  __esModule: true,
  default: {invalidateAllCaches: jest.fn()},
}));

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

function fakeInProgressSession() {
  return {
    sessionId: 'sync_failed_apply_1',
    deviceId: 'dev-1',
    deviceName: 'Test Device',
    startTime: Math.floor(Date.now() / 1000),
    status: 'in_progress',
    recordsSent: 0,
    recordsReceived: 8,
    forceFullSync: false,
  };
}

function syncCompleteEvent(sessionId: string) {
  return {
    event_type: 'SYNC_COMPLETE',
    status: 'NEW',
    payload: {sync_session_id: sessionId},
  };
}

describe('SyncService apply-failure session cleanup', () => {
  beforeEach(() => {
    (mockConnectionManager as any).syncServiceListenersInstalled = false;
    (mockConnectionManager as any).syncServiceEventTarget = null;
    mockConnectionManager.removeAllListeners();
    mockConnectionManager.sendEvent.mockClear();
    resetSingleton();
  });

  it('clears currentSession + resets syncPhase when applyBufferedSyncData fails', async () => {
    const svc = SyncService.getInstance();

    // Simulate the stuck state: server finished sending, buffered data present.
    (svc as any).currentSession = fakeInProgressSession();
    (svc as any).syncPhase = 'SERVER_SENDING';
    (svc as any).incomingDataBuffer = [
      {
        table: 'character_profiles',
        operation: 'insert',
        record: {id: 'cp-1', name: 'Test Character'},
      },
    ];
    (svc as any).serverRecordIds = new Set(['character_profiles:cp-1']);

    const errorListener = jest.fn();
    svc.on('sync:error', errorListener);

    // SYNC_COMPLETE (NEW) routes to handleSyncComplete → applyBufferedSyncData
    // → getSyncDatabase rejects → the SERVER_SENDING catch path runs.
    mockConnectionManager.emit('event:sync', syncCompleteEvent('sync_failed_apply_1'));

    // handleSyncComplete is async — flush the microtask queue.
    await new Promise(resolve => setImmediate(resolve));

    // The session must NOT be left orphaned.
    expect((svc as any).currentSession).toBeNull();
    expect((svc as any).syncPhase).toBe('IDLE');
    expect((svc as any).incomingDataBuffer).toEqual([]);
    expect(errorListener).toHaveBeenCalledWith('Failed to apply server data');
  });

  it('does not block a subsequent initiateSync after a failed apply', async () => {
    const svc = SyncService.getInstance();

    // First: a failed apply leaves a session behind (pre-fix this stuck).
    (svc as any).currentSession = fakeInProgressSession();
    (svc as any).syncPhase = 'SERVER_SENDING';
    (svc as any).incomingDataBuffer = [
      {
        table: 'character_profiles',
        operation: 'insert',
        record: {id: 'cp-1', name: 'Test Character'},
      },
    ];

    mockConnectionManager.emit('event:sync', syncCompleteEvent('sync_failed_apply_1'));
    await new Promise(resolve => setImmediate(resolve));

    // Second: a new sync must proceed (guard must not see an in-progress
    // session). It should send a SYNC_REQUEST, not log "already in progress".
    await svc.initiateSync();

    const sentEvents = mockConnectionManager.sendEvent.mock.calls.map(c => c[1]);
    const syncRequests = sentEvents.filter(e => e.event_type === 'SYNC_REQUEST');
    expect(syncRequests.length).toBe(1);
    // Test-only inspection of private session state (the suite asserts the
    // guard's view of the session, which is not exposed publicly).
    const session = (svc as any).currentSession as {status: string} | null;
    expect(session).not.toBeNull();
    expect(session!.status).toBe('pending');
  });
});