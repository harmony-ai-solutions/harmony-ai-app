/**
 * Regression tests for sync-event listener idempotency.
 *
 * BACKGROUND: SyncService.ts default-exports a module-scope singleton and
 * registers its ConnectionManager listeners in the constructor. Under Metro
 * Fast Refresh (hot reload) the SyncService module re-executes, creating a NEW
 * SyncService instance that registers ANOTHER listener set on the RETAINED
 * ConnectionManager singleton. Old instances are orphaned but their listeners
 * persist, so every sync event is delivered once PER INSTANCE — observed 8-10x
 * on-device ("Aborting sync session: sync connection replaced" x7-9, "Received
 * SYNC_ACCEPT but no current session" x10). This multiplies log output and GC
 * garbage and, under load, starves the JS thread mid-sync.
 *
 * These tests pin the fix: exactly ONE listener set per ConnectionManager
 * lifetime, delegating to whatever SyncService instance is CURRENT, and
 * abortSync is a no-op when nothing is in flight (so N legacy listeners can
 * never run it N times).
 */

import { SyncService } from '../SyncService';
import { EventEmitter } from 'eventemitter3';

// The ConnectionManager singleton SURVIVES hot reloads — mock it with a real
// EventEmitter so the test can count listener registrations and emit events.
let mockConnectionManager: EventEmitter & { sendEvent: jest.Mock; isConnected: jest.Mock };

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
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

function fakeSession(sessionId: string) {
  return {
    sessionId,
    status: 'in_progress',
    startTime: Date.now(),
    forceFullSync: false,
    recordsReceived: 0,
    recordsSent: 0,
  };
}

function fakeSyncDataEvent(table: string, recordId: string, syncSessionId: string) {
  return {
    event_type: 'SYNC_DATA',
    status: 'NEW',
    payload: {
      sync_session_id: syncSessionId,
      event_id: `data_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      table,
      operation: 'insert',
      record: { id: recordId, name: `${table}-${recordId}` },
    },
  };
}

describe('SyncService listener idempotency', () => {
  beforeEach(() => {
    // Reset the idempotency guard + target that live ON the ConnectionManager
    // singleton, plus the emitter listeners themselves.
    (mockConnectionManager as any).syncServiceListenersInstalled = false;
    (mockConnectionManager as any).syncServiceEventTarget = null;
    mockConnectionManager.removeAllListeners();
    mockConnectionManager.sendEvent.mockClear();
    resetSingleton();
  });

  it('registers exactly ONE listener set even when the singleton is re-created (simulated hot reload)', () => {
    // Instance #1 (the "old" one from a previous bundle)
    resetSingleton();
    const svc1 = SyncService.getInstance();
    svc1.on('sync:aborted', () => {});

    // Instance #2 (the "current" one after a reload)
    resetSingleton();
    const svc2 = SyncService.getInstance();
    svc2.on('sync:aborted', () => {});

    // The surviving ConnectionManager must carry exactly one listener per event
    expect(mockConnectionManager.listeners('event:sync').length).toBe(1);
    expect(mockConnectionManager.listeners('disconnected:sync').length).toBe(1);
    expect(mockConnectionManager.listeners('error:sync').length).toBe(1);
    expect(mockConnectionManager.listeners('sync:connection_replaced').length).toBe(1);
  });

  it('delivers events to the CURRENT instance only, never the stale one', () => {
    resetSingleton();
    const svc1 = SyncService.getInstance();
    resetSingleton();
    const svc2 = SyncService.getInstance();

    (svc1 as any).currentSession = fakeSession('s1');
    (svc2 as any).currentSession = fakeSession('s2');

    mockConnectionManager.emit('event:sync', fakeSyncDataEvent('backend_configs', 'cfg-1', 's2'));

    // With the duplication bug BOTH instances buffer the record; with the fix
    // only the current (svc2) instance does.
    expect((svc1 as any).incomingDataBuffer.length).toBe(0);
    expect((svc2 as any).incomingDataBuffer.length).toBe(1);
  });

  it('runs abortSync exactly once per disconnect, on the current instance only', () => {
    resetSingleton();
    const svc1 = SyncService.getInstance();
    resetSingleton();
    const svc2 = SyncService.getInstance();

    (svc1 as any).currentSession = fakeSession('s1');
    (svc2 as any).currentSession = fakeSession('s2');

    const aborted1 = jest.fn();
    const aborted2 = jest.fn();
    svc1.on('sync:aborted', aborted1);
    svc2.on('sync:aborted', aborted2);

    mockConnectionManager.emit('disconnected:sync');

    expect(aborted1).not.toHaveBeenCalled(); // stale instance must not react
    expect(aborted2).toHaveBeenCalledTimes(1); // current instance reacts once
  });

  it('abortSync is a no-op when no session is in flight (duplicate/legacy aborts)', () => {
    resetSingleton();
    const svc = SyncService.getInstance();
    const aborted = jest.fn();
    svc.on('sync:aborted', aborted);

    (svc as any).abortSync('test');
    (svc as any).abortSync('test');
    (svc as any).abortSync('test');

    expect(aborted).not.toHaveBeenCalled();
  });
});
