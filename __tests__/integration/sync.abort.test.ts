/**
 * Sync Abort-on-Disconnect Integration Tests
 *
 * Verifies that SyncService self-heals when the sync connection drops or is
 * replaced mid-session:
 *  - a disconnect while a sync is in_progress aborts the session (clears
 *    currentSession / syncPhase / buffer) so the in-progress guard can never
 *    permanently block future syncs
 *  - after abort, a subsequent initiateSync() starts a fresh session
 *
 * This covers the observed production bug: the ws→wss upgrade killed the
 * unencrypted connection mid-sync, leaving `currentSession.status =
 * 'in_progress'` forever ("Sync already in progress, skipping").
 */

import {SyncService} from '../../src/services/SyncService';
import type {NodeDatabase} from '../../src/database/__test_utils__/nodeDatabase';
import {createInMemoryDatabase} from '../../src/database/__test_utils__/testDatabase';
import {runMigrations} from '../../src/database/migrations';
import {resetSyncServiceSingleton} from './helpers/resetSyncService';
import {HarmonyLinkMockServer} from './helpers/HarmonyLinkMockServer';
import {sampleCharacter} from './helpers/fixtures';

// ---------------------------------------------------------------------------
// Module-level mutable refs
// ---------------------------------------------------------------------------
const testDbRef: {current: NodeDatabase | null} = {current: null};
const mockServerRef: {current: HarmonyLinkMockServer | null} = {current: null};

// ---------------------------------------------------------------------------
// Mock native modules
// ---------------------------------------------------------------------------
jest.mock('react-native-device-info', () => ({
  getUniqueId: jest.fn(() => Promise.resolve('test-device-001')),
  getDeviceName: jest.fn(() => Promise.resolve('Test Device')),
}));

jest.mock('@react-native-async-storage/async-storage', () => {
  const store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => Promise.resolve(store[key] ?? null)),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
      return Promise.resolve();
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
      return Promise.resolve();
    }),
    clear: jest.fn(() => {
      Object.keys(store).forEach(k => delete store[k]);
      return Promise.resolve();
    }),
  };
});

jest.mock('../../src/utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock('../../src/database/connection', () => ({
  getDatabase: () => {
    if (!testDbRef.current) throw new Error('Test DB not initialized');
    return testDbRef.current;
  },
  getSyncDatabase: async () => {
    if (!testDbRef.current) throw new Error('Test DB not initialized');
    return testDbRef.current;
  },
}));

// ---------------------------------------------------------------------------
// Helper: mock ConnectionManager that can EMIT lifecycle events
// (disconnected:sync / error:sync) to drive the abort path.
// ---------------------------------------------------------------------------
function createMockConnectionManager(server: HarmonyLinkMockServer) {
  let eventHandler: ((event: any) => void) | null = null;
  let disconnectedHandler: (() => void) | null = null;
  let errorHandler: ((error: any) => void) | null = null;

  server.setEventHandler((event: any) => {
    if (eventHandler) {
      setImmediate(() => eventHandler!(event));
    }
  });

  return {
    on(event: string, handler: (...args: any[]) => void) {
      if (event === 'event:sync') {
        eventHandler = handler;
      } else if (event === 'disconnected:sync') {
        disconnectedHandler = handler;
      } else if (event === 'error:sync') {
        errorHandler = handler;
      }
    },
    removeListener(event: string, handler: any) {
      if (event === 'event:sync' && eventHandler === handler) {
        eventHandler = null;
      } else if (event === 'disconnected:sync' && disconnectedHandler === handler) {
        disconnectedHandler = null;
      } else if (event === 'error:sync' && errorHandler === handler) {
        errorHandler = null;
      }
    },
    removeAllListeners() {
      eventHandler = null;
      disconnectedHandler = null;
      errorHandler = null;
    },
    async sendEvent(_connectionType: string, event: any) {
      server.handleClientEvent(event);
    },
    isConnected(_type: string) {
      return true;
    },
    // Test driver: simulate the sync connection dropping
    emitDisconnected() {
      disconnectedHandler?.();
    },
    emitError(error: any) {
      errorHandler?.(error);
    },
  };
}

// ---------------------------------------------------------------------------
// Test setup/teardown
// ---------------------------------------------------------------------------
async function setupTest(): Promise<{
  db: NodeDatabase;
  mockServer: HarmonyLinkMockServer;
  syncService: SyncService;
  mockCm: ReturnType<typeof createMockConnectionManager>;
}> {
  const db = createInMemoryDatabase();
  await runMigrations(db, true);
  testDbRef.current = db;

  const AsyncStorage = require('@react-native-async-storage/async-storage');
  await AsyncStorage.clear();

  const mockServer = new HarmonyLinkMockServer();
  const mockCm = createMockConnectionManager(mockServer);

  resetSyncServiceSingleton();
  const syncService = SyncService.getInstance();
  (syncService as any).connectionManager.removeAllListeners?.();
  (syncService as any).connectionManager = mockCm;
  (syncService as any).setupConnectionListeners();

  mockServerRef.current = mockServer;
  return {db, mockServer, syncService, mockCm};
}

async function teardownTest(
  db: NodeDatabase,
  syncService: SyncService,
  mockServer: HarmonyLinkMockServer,
): Promise<void> {
  if (syncService) {
    syncService.removeAllListeners();
    (syncService as any).currentSession = null;
    (syncService as any).pendingHandshake = null;
    (syncService as any).pendingSyncConfirmation = null;
  }
  mockServer.reset();
  testDbRef.current = null;
  mockServerRef.current = null;
  if (db) await db.close();
}

// ---------------------------------------------------------------------------
// Test driver helpers
// ---------------------------------------------------------------------------

/**
 * Drive a sync session to the in_progress / SERVER_SENDING phase using a
 * manually-driven mock server (the auto-responder is paused, so the server
 * never delivers SYNC_DATA/SYNC_COMPLETE — simulating a connection that was
 * killed mid-stream before the pull phase finished).
 *
 * Returns once `sync:started` has fired (session in_progress).
 */
async function driveSyncToInProgress(
  mockServer: HarmonyLinkMockServer,
  syncService: SyncService,
): Promise<void> {
  mockServer.setManualMode(true);
  mockServer.startAutoResponder();

  const syncStarted = new Promise<void>(resolve => {
    syncService.once('sync:started', () => resolve());
  });
  syncService.initiateSync();

  // Manually deliver SYNC_ACCEPT (auto-responder is paused in manual mode).
  // The session id the client uses is the one from this payload.
  mockServer.send({
    event_type: 'SYNC_ACCEPT',
    status: 'NEW',
    payload: {
      device_id: 'harmony_link',
      device_name: 'Harmony Link',
      device_type: 'harmony_link',
      device_platform: 'server',
      current_utc_timestamp: Math.floor(Date.now() / 1000),
      clock_drift_seconds: 0,
      sync_session_id: 'sync_manual_drive',
      last_sync_timestamp: 0,
    },
  });

  await syncStarted;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('sync abort on connection loss', () => {
  let db: NodeDatabase;
  let mockServer: HarmonyLinkMockServer;
  let syncService: SyncService;
  let mockCm: ReturnType<typeof createMockConnectionManager>;

  beforeEach(async () => {
    const setup = await setupTest();
    db = setup.db;
    mockServer = setup.mockServer;
    syncService = setup.syncService;
    mockCm = setup.mockCm;
  });

  afterEach(async () => {
    await teardownTest(db, syncService, mockServer);
  });

  it('aborts an in-progress sync when the connection disconnects mid-session', async () => {
    await driveSyncToInProgress(mockServer, syncService);

    // Sanity: session is now in_progress (the stuck state in production)
    expect((syncService as any).currentSession?.status).toBe('in_progress');
    expect((syncService as any).currentSession?.sessionId).toBe('sync_manual_drive');

    // Simulate the sync connection being torn down (ws→wss upgrade, drop, etc.)
    mockCm.emitDisconnected();

    // Allow the abort handler to run
    await new Promise(r => setTimeout(r, 50));

    // VERIFY: session cleared, guard released, buffer empty
    expect((syncService as any).currentSession).toBeNull();
    expect((syncService as any).syncPhase).toBe('IDLE');
    expect((syncService as any).incomingDataBuffer).toEqual([]);

    // A subsequent sync must now start a fresh session (not be silently skipped)
    mockServer.setManualMode(false);
    mockServer.startAutoResponder();

    const secondSyncStarted = new Promise<void>(resolve => {
      syncService.once('sync:started', () => resolve());
    });
    syncService.initiateSync();
    await secondSyncStarted;
    await new Promise(r => setTimeout(r, 100));

    // VERIFY: a second SYNC_REQUEST was actually sent (guard released)
    const syncRequests = mockServer.receivedEvents.filter(
      (e: any) => e.event_type === 'SYNC_REQUEST',
    );
    expect(syncRequests.length).toBe(2);
  }, 15000);

  it('aborts an in-progress sync when the connection errors mid-session', async () => {
    await driveSyncToInProgress(mockServer, syncService);

    expect((syncService as any).currentSession?.status).toBe('in_progress');

    mockCm.emitError(new Error('TLS handshake failed'));

    await new Promise(r => setTimeout(r, 50));

    expect((syncService as any).currentSession).toBeNull();
    expect((syncService as any).syncPhase).toBe('IDLE');
  }, 15000);

  it('aborts a session and the buffered server data is discarded (never applied)', async () => {
    // Pre-populate server data that WOULD be applied if sync completed
    const serverChar = sampleCharacter({
      id: 'char-abort-discard',
      name: 'Should Not Persist',
      created_at: new Date(Date.now() - 5000).toISOString(),
      updated_at: new Date(Date.now() - 5000).toISOString(),
    });
    mockServer.setServerData('character_profiles', [serverChar]);

    // Drive sync to the buffering phase, then kill the connection before
    // SYNC_COMPLETE is delivered (this is exactly the production race).
    await driveSyncToInProgress(mockServer, syncService);

    // Manually deliver SYNC_DATA to put a record in the buffer
    // (server is paused, so this is the only record and SYNC_COMPLETE never comes)
    mockServer.send({
      event_type: 'SYNC_DATA',
      status: 'NEW',
      payload: {
        sync_session_id: 'sync_manual_drive',
        event_id: 'server_data_1',
        table: 'character_profiles',
        operation: 'insert',
        record: serverChar,
      },
    });

    await new Promise(r => setTimeout(r, 50));
    expect((syncService as any).incomingDataBuffer.length).toBe(1);

    // Connection dies before SYNC_COMPLETE arrives
    mockCm.emitDisconnected();
    await new Promise(r => setTimeout(r, 50));

    // VERIFY: buffer discarded, session cleared
    expect((syncService as any).incomingDataBuffer).toEqual([]);
    expect((syncService as any).currentSession).toBeNull();

    // VERIFY: data was NOT applied to the DB (no partial/atomic commit)
    const [result] = await db.executeSql(
      "SELECT id FROM character_profiles WHERE id = 'char-abort-discard'",
    );
    expect(result.rows.length).toBe(0);
  }, 15000);
});
