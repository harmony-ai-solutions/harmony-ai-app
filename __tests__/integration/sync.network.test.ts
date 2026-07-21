/**
 * Network Resilience Integration Tests
 *
 * Verifies SyncService behavior under network disruptions:
 *  - Connection drop mid-sync (cleanup + retry)
 *  - Timeout when server is unresponsive (handshake timeout)
 *  - Data integrity when connection drops during server data transmission
 *
 * Note: Since the mock server is in-process (no real WebSocket), "dropping"
 * means clearing the event handler and stopping the auto-responder.
 * Recovery means re-wiring a fresh server and retrying.
 */

import {SyncService} from '../../src/services/SyncService';
import type {NodeDatabase} from '../../src/database/__test_utils__/nodeDatabase';
import {createInMemoryDatabase} from '../../src/database/__test_utils__/testDatabase';
import {runMigrations} from '../../src/database/migrations';
import {resetSyncServiceSingleton} from './helpers/resetSyncService';
import {HarmonyLinkMockServer} from './helpers/HarmonyLinkMockServer';
import {sampleCharacter} from './helpers/fixtures';

// ---------------------------------------------------------------------------
// Module-level mutable refs used by hoisted jest.mock calls
// ---------------------------------------------------------------------------
const testDbRef: {current: NodeDatabase | null} = {current: null};
const mockServerRef: {current: HarmonyLinkMockServer | null} = {current: null};

// ---------------------------------------------------------------------------
// Mock native modules (same as syncService.integration.test.ts)
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
// Helper: create mock ConnectionManager wired to the mock server
// ---------------------------------------------------------------------------
function createMockConnectionManager(server: HarmonyLinkMockServer) {
  let eventHandler: ((event: any) => void) | null = null;

  server.setEventHandler((event: any) => {
    if (eventHandler) {
      setImmediate(() => eventHandler!(event));
    }
  });

  return {
    on(event: string, handler: (data: any) => void) {
      if (event === 'event:sync') {
        eventHandler = handler;
      }
    },
    removeListener(event: string, handler: any) {
      if (event === 'event:sync' && eventHandler === handler) {
        eventHandler = null;
      }
    },
    removeAllListeners() {
      eventHandler = null;
    },
    async sendEvent(_connectionType: string, event: any) {
      server.handleClientEvent(event);
    },
    isConnected(_type: string) {
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// Shared test setup/teardown
// ---------------------------------------------------------------------------
async function setupTest(): Promise<{
  db: NodeDatabase;
  mockServer: HarmonyLinkMockServer;
  syncService: SyncService;
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
  return {db, mockServer, syncService};
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
  if (db) {
    await db.close();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('sync network resilience', () => {
  let db: NodeDatabase;
  let mockServer: HarmonyLinkMockServer;
  let syncService: SyncService;

  beforeEach(async () => {
    const setup = await setupTest();
    db = setup.db;
    mockServer = setup.mockServer;
    syncService = setup.syncService;

    // Use a short timeout for test responsiveness
    syncService.setSyncTimeoutMs(2000);
  });

  afterEach(async () => {
    await teardownTest(db, syncService, mockServer);
  });

  // -------------------------------------------------------------------------
  // Test 1: Connection drop — retry with fresh server succeeds
  // -------------------------------------------------------------------------
  it('recovers after connection drop and retry with fresh server', async () => {
    // Start a sync and let it make progress
    const serverChar = sampleCharacter({
      id: 'char-net-1',
      name: 'Network Test Character',
      created_at: new Date(Date.now() - 10000).toISOString(),
      updated_at: new Date(Date.now() - 10000).toISOString(),
    });
    mockServer.setServerData('character_profiles', [serverChar]);
    mockServer.startAutoResponder();

    // Initiate sync
    syncService.initiateSync();

    // Allow the sync to partially process
    await new Promise(r => setTimeout(r, 500));

    // Drop the connection mid-sync
    mockServer.dropConnection();

    // Wait briefly for any in-flight messages to settle
    await new Promise(r => setTimeout(r, 200));

    // Clean up the stale session (simulates app recovery logic)
    syncService.removeAllListeners();
    (syncService as any).currentSession = null;
    (syncService as any).syncPhase = 'IDLE';
    (syncService as any).incomingDataBuffer = [];

    // Set up a FRESH mock server with a NEW connection manager.
    // The createMockConnectionManager correctly wires the server's event
    // handler to the connection manager's internal event handler.
    const newServer = new HarmonyLinkMockServer();
    const newCm = createMockConnectionManager(newServer);
    (syncService as any).connectionManager.removeAllListeners?.();
    (syncService as any).connectionManager = newCm;
    (syncService as any).setupConnectionListeners();

    // Seed the new server with data
    const freshChar = sampleCharacter({
      id: 'char-net-2',
      name: 'Fresh Server Character',
      created_at: new Date(Date.now() - 10000).toISOString(),
      updated_at: new Date(Date.now() - 10000).toISOString(),
    });
    newServer.setServerData('character_profiles', [freshChar]);
    newServer.startAutoResponder();

    // Retry sync with fresh server — should succeed
    const completedPromise = new Promise<void>((resolve) => {
      syncService.once('sync:completed', () => resolve());
    });
    syncService.initiateSync();
    await completedPromise;
    await new Promise(r => setTimeout(r, 200));

    // VERIFY: Data from the fresh server was received
    const [result] = await db.executeSql(
      "SELECT id, name FROM character_profiles WHERE id = 'char-net-2'",
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows.item(0).name).toBe('Fresh Server Character');
  }, 15000);

  // -------------------------------------------------------------------------
  // Test 2: Handshake timeout when server does not respond
  // -------------------------------------------------------------------------
  it('times out handshake when server does not respond', async () => {
    // requestHandshakeWithWait has a configurable timeoutMs parameter.
    // Test that it rejects when the server never responds.
    // We prevent the server from responding by dropping the connection first.
    mockServer.dropConnection();

    // Also clear the auto-responder
    mockServer.stopAutoResponder();

    // Call requestHandshakeWithWait with a short timeout
    await expect(
      syncService.requestHandshakeWithWait(500),
    ).rejects.toThrow(/timeout/i);
  }, 5000);

  // -------------------------------------------------------------------------
  // Test 3: Data buffered but not applied if SYNC_COMPLETE never arrives
  // -------------------------------------------------------------------------
  it('rolls back buffered data if SYNC_COMPLETE never arrives', async () => {
    // Use manual mode to control protocol precisely
    mockServer.setManualMode(true);
    mockServer.startAutoResponder();

    // Start sync — client sends SYNC_REQUEST
    syncService.initiateSync();
    await new Promise(r => setTimeout(r, 100));

    // Manually respond with SYNC_ACCEPT
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
        sync_session_id: 'test-session-network-3',
        last_sync_timestamp: 0,
      },
    });
    await new Promise(r => setTimeout(r, 100));

    // Client sends SYNC_START
    // Wait for client to process SYNC_ACCEPT and send SYNC_START
    await new Promise(r => setTimeout(r, 200));

    // Send one SYNC_DATA record
    const serverChar = sampleCharacter({
      id: 'char-rollback-1',
      name: 'Should Not Be Applied',
      created_at: new Date(Date.now() - 5000).toISOString(),
      updated_at: new Date(Date.now() - 5000).toISOString(),
    });
    mockServer.send({
      event_type: 'SYNC_DATA',
      status: 'NEW',
      payload: {
        sync_session_id: 'test-session-network-3',
        event_id: 'server_data_char_rollback_1',
        table: 'character_profiles',
        operation: 'insert',
        record: serverChar,
      },
    });
    await new Promise(r => setTimeout(r, 200));

    // DROP connection before SYNC_COMPLETE arrives
    mockServer.dropConnection();

    // Wait for any pending microtasks
    await new Promise(r => setTimeout(r, 200));

    // VERIFY: The character was NOT inserted into the DB (buffer was never flushed)
    const [result] = await db.executeSql(
      "SELECT id FROM character_profiles WHERE id = 'char-rollback-1'",
    );
    expect(result.rows.length).toBe(0);
  }, 10000);
});
