/**
 * 4-2 / D13 + D34: typed sync-apply errors + `critical` syncAndWait mode.
 *
 * Covers:
 *  - SYNC_DATA_CONFIRM error classification via the structured `error_code`
 *    (`sync_conflict` / `apply_failed` → SyncConflictError with the offending
 *    table + entity id; string-only payload from an old engine → plain Error).
 *  - `critical: true` REJECTS on sync failure (best-effort default unchanged
 *    for background syncs).
 *  - Critical mode rejects when the internal `initiateSync` throws.
 *  - The shared-wait composition (D34): a critical waiter attaching to a
 *    background-initiated best-effort wait still receives the rejection.
 */

import { SyncService, SyncConflictError } from '../SyncService';
import { EventEmitter } from 'eventemitter3';

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

jest.mock('../../database/connection', () => ({
  getDatabase: jest.fn(),
  getSyncDatabase: jest.fn(),
}));

// Minimal SyncHelpers surface — the confirm path never reaches the DB, but the
// module import must resolve.
jest.mock('../../database/sync', () => ({
  toUnixTimestamp: jest.fn((v: any) => (typeof v === 'number' ? v : Date.parse(v))),
  getChangedRecords: jest.fn(() => Promise.resolve([])),
  cleanupOrphanEntityModuleMappings: jest.fn(() => Promise.resolve(0)),
  cleanupOrphanedMemories: jest.fn(() => Promise.resolve(0)),
  normalizeRecordTimestamps: jest.fn((r: any) => r),
}));

jest.mock('../EntityEmojiActionService', () => ({
  __esModule: true,
  default: { invalidateAllCaches: jest.fn() },
}));

jest.mock('../connection/ConnectionManager', () => {
  const { EventEmitter: EE } = require('eventemitter3');
  const cm: EventEmitter & { sendEvent: jest.Mock; isConnected: jest.Mock } = new EE();
  cm.sendEvent = jest.fn().mockResolvedValue(undefined);
  cm.isConnected = jest.fn().mockReturnValue(true);
  mockConnectionManager = cm;
  return { __esModule: true, default: cm };
});

function resetSingleton(): void {
  (SyncService as any).instance = null;
}

function fakeSession(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'sync_critical_1',
    deviceId: 'dev-1',
    deviceName: 'Test Device',
    startTime: Math.floor(Date.now() / 1000),
    status: 'in_progress',
    recordsSent: 0,
    recordsReceived: 0,
    forceFullSync: false,
    ...overrides,
  };
}

function flush(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

/** Send a SYNC_DATA via the real confirm path and return { promise, eventId }. */
function pushRecord(svc: SyncService, table: string, record: any) {
  const pending = (svc as any).sendSyncDataWithConfirmation(table, 'insert', record);
  const sentEvents = mockConnectionManager.sendEvent.mock.calls.map(c => c[1]);
  const dataEvent = sentEvents.find(e => e.event_type === 'SYNC_DATA');
  const eventId = dataEvent.payload.event_id;
  return { pending, eventId };
}

function confirmErrorEvent(eventId: string, extra: Record<string, unknown> = {}) {
  return {
    event_type: 'SYNC_DATA_CONFIRM',
    status: 'ERROR',
    payload: {
      event_id: eventId,
      sync_session_id: 'sync_critical_1',
      status: 'ERROR',
      error_message: 'Sync failed',
      ...extra,
    },
  };
}

describe('4-2 — typed confirm-error classification', () => {
  beforeEach(() => {
    (mockConnectionManager as any).syncServiceListenersInstalled = false;
    (mockConnectionManager as any).syncServiceEventTarget = null;
    mockConnectionManager.removeAllListeners();
    mockConnectionManager.sendEvent.mockClear();
    mockConnectionManager.sendEvent.mockResolvedValue(undefined);
    mockConnectionManager.isConnected.mockReturnValue(true);
    resetSingleton();
  });

  it('classifies error_code=sync_conflict as SyncConflictError with table + entityId', async () => {
    const svc = SyncService.getInstance();
    (svc as any).currentSession = fakeSession();

    const { pending, eventId } = pushRecord(svc, 'entities', {
      id: 'Isabella-20260905123514',
      updated_at: '2026-09-05T12:35:14.000Z',
      created_at: '2026-09-05T12:35:14.000Z',
    });

    mockConnectionManager.emit(
      'event:sync',
      confirmErrorEvent(eventId, {
        error_code: 'sync_conflict',
        error_message: 'UNIQUE constraint failed: entities.id',
      }),
    );

    const err = await pending.catch((e: any) => e);
    expect(err).toBeInstanceOf(SyncConflictError);
    expect((err as SyncConflictError).name).toBe('SyncConflictError');
    expect((err as SyncConflictError).table).toBe('entities');
    expect((err as SyncConflictError).entityId).toBe('Isabella-20260905123514');
    expect((err as SyncConflictError).code).toBe('sync_conflict');
    expect((err as SyncConflictError).message).toBe('UNIQUE constraint failed: entities.id');
  });

  it('classifies error_code=apply_failed as SyncConflictError (non-constraint code)', async () => {
    const svc = SyncService.getInstance();
    (svc as any).currentSession = fakeSession();

    const { pending, eventId } = pushRecord(svc, 'entities', {
      id: 'Isabella-20260905123514',
      updated_at: '2026-09-05T12:35:14.000Z',
      created_at: '2026-09-05T12:35:14.000Z',
    });

    mockConnectionManager.emit(
      'event:sync',
      confirmErrorEvent(eventId, { error_code: 'apply_failed', error_message: 'FK violation' }),
    );

    const err = await pending.catch((e: any) => e);
    expect(err).toBeInstanceOf(SyncConflictError);
    expect((err as SyncConflictError).table).toBe('entities');
    expect((err as SyncConflictError).entityId).toBe('Isabella-20260905123514');
    expect((err as SyncConflictError).code).toBe('apply_failed');
  });

  it('falls back to a plain Error when the payload is string-only (old engine)', async () => {
    const svc = SyncService.getInstance();
    (svc as any).currentSession = fakeSession();

    const { pending, eventId } = pushRecord(svc, 'entities', {
      id: 'Isabella-20260905123514',
      updated_at: '2026-09-05T12:35:14.000Z',
      created_at: '2026-09-05T12:35:14.000Z',
    });

    // Old engine: no error_code field rides the confirm error payload.
    mockConnectionManager.emit(
      'event:sync',
      confirmErrorEvent(eventId, { error_message: 'Old-engine sync failure' }),
    );

    const err = await pending.catch((e: any) => e);
    expect(err).not.toBeInstanceOf(SyncConflictError);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Old-engine sync failure');
  });
});

describe('4-2 / D34 — critical syncAndWait mode', () => {
  beforeEach(() => {
    (mockConnectionManager as any).syncServiceListenersInstalled = false;
    (mockConnectionManager as any).syncServiceEventTarget = null;
    mockConnectionManager.removeAllListeners();
    mockConnectionManager.sendEvent.mockClear();
    mockConnectionManager.sendEvent.mockResolvedValue(undefined);
    mockConnectionManager.isConnected.mockReturnValue(true);
    resetSingleton();
  });

  it('non-critical syncAndWait keeps best-effort resolve on sync:error (background unchanged)', async () => {
    const svc = SyncService.getInstance();
    (svc as any).currentSyncWait = null;
    (svc as any).currentSyncWaitCritical = false;

    const wait = svc.syncAndWait({ timeoutMs: 50_000 });
    await flush(); // runSyncAndWait kicks initiateSync

    svc.emit('sync:error', 'boom');
    await expect(wait).resolves.toBeUndefined();
  });

  it('critical syncAndWait REJECTS on sync:error', async () => {
    const svc = SyncService.getInstance();
    (svc as any).currentSyncWait = null;
    (svc as any).currentSyncWaitCritical = false;

    const wait = svc.syncAndWait({ critical: true, timeoutMs: 50_000 });
    await flush();

    svc.emit('sync:error', 'push rejected');
    await expect(wait).rejects.toThrow('push rejected');
  });

  it('critical syncAndWait rejects when initiateSync itself throws (previously swallowed)', async () => {
    const svc = SyncService.getInstance();
    (svc as any).currentSyncWait = null;
    (svc as any).currentSyncWaitCritical = false;

    mockConnectionManager.isConnected.mockReturnValue(true);
    mockConnectionManager.sendEvent.mockRejectedValueOnce(new Error('ws down'));

    const wait = svc.syncAndWait({ critical: true, timeoutMs: 50_000 });
    // The internal initiateSync emits sync:error and re-throws — the critical
    // wait must surface the failure instead of resolving best-effort.
    await expect(wait).rejects.toThrow('ws down');
  });

  it('shared-wait composition: critical waiter attaching to a background best-effort wait gets the rejection (D34)', async () => {
    const svc = SyncService.getInstance();
    (svc as any).currentSyncWait = null;
    (svc as any).currentSyncWaitCritical = false;

    // Background best-effort waiter creates the shared wait + kicks initiateSync.
    const bg = svc.syncAndWait({ timeoutMs: 50_000 });
    await flush();

    // Critical caller attaches to the SAME in-flight wait (the incident's
    // timing: on-connect background sync + user taps a chat).
    const critical = svc.syncAndWait({ critical: true, timeoutMs: 50_000 });
    await flush();

    svc.emit('sync:error', 'shared failure');

    await expect(critical).rejects.toThrow('shared failure');
    // The shared promise settles once — both awaiters receive the rejection.
    await expect(bg).rejects.toThrow('shared failure');
  });
});