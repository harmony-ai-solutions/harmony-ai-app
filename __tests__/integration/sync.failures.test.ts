/**
 * Partial Failure Integration Tests
 *
 * Verifies SyncService behavior when individual records fail during sync:
 *  - Single record failure doesn't abort the entire batch
 *  - Buffered data is rolled back if SYNC_COMPLETE never arrives (transactional integrity)
 *
 * Note: The NodeDatabase test helper wraps better-sqlite3 which is synchronous.
 * Foreign key violations throw synchronously. The callback-based error handling
 * in applyBufferedSyncData logs the error but the transaction continues in test
 * environment. In production (react-native-sqlite-storage), the behavior may differ.
 */

import {SyncService} from '../../src/services/SyncService';
import type {NodeDatabase} from '../../src/database/__test_utils__/nodeDatabase';
import {createInMemoryDatabase} from '../../src/database/__test_utils__/testDatabase';
import {runMigrations} from '../../src/database/migrations';
import {resetSyncServiceSingleton} from './helpers/resetSyncService';
import {HarmonyLinkMockServer} from './helpers/HarmonyLinkMockServer';
import {sampleCharacter, sampleEntity} from './helpers/fixtures';

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
// Helper: mock ConnectionManager
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
// Test setup/teardown
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
  if (db) await db.close();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('sync partial failures', () => {
  let db: NodeDatabase;
  let mockServer: HarmonyLinkMockServer;
  let syncService: SyncService;

  beforeEach(async () => {
    const setup = await setupTest();
    db = setup.db;
    mockServer = setup.mockServer;
    syncService = setup.syncService;
  });

  afterEach(async () => {
    await teardownTest(db, syncService, mockServer);
  });

  // -------------------------------------------------------------------------
  // Test 1: Continues syncing other records when one fails FK constraint
  // -------------------------------------------------------------------------
  it('continues processing valid records when one record fails FK constraint', async () => {
    // Strategy: Use auto-responder's natural flow. The server sends records
    // from multiple tables. A record in 'entities' with a non-existent
    // character_profile_id will trigger a FK violation.
    //
    // The client's applyBufferedSyncData sorts records by TABLE_ORDER:
    // character_profiles (order 3) then entities (order 5).
    // Valid characters are applied, the failing entity is skipped by the error handler.

    const validChar1 = sampleCharacter({
      id: 'char-fail-valid-1',
      name: 'Valid Character One',
      created_at: new Date(Date.now() - 10000).toISOString(),
      updated_at: new Date(Date.now() - 10000).toISOString(),
    });

    // Entity with FK violation — character_profile_id points to non-existent record
    const invalidEntity = sampleEntity({
      id: 'entity-fail-invalid',
      character_profile_id: 'no-such-character',
      created_at: new Date(Date.now() - 10000).toISOString(),
      updated_at: new Date(Date.now() - 10000).toISOString(),
    });

    const validChar2 = sampleCharacter({
      id: 'char-fail-valid-2',
      name: 'Valid Character Two',
      created_at: new Date(Date.now() - 10000).toISOString(),
      updated_at: new Date(Date.now() - 10000).toISOString(),
    });

    // Use auto-responder with manual mode for precise control
    mockServer.setManualMode(true);
    mockServer.startAutoResponder();

    // Initiate sync
    const completedPromise = new Promise<void>((resolve) => {
      syncService.on('sync:completed', () => resolve());
    });

    syncService.initiateSync();
    await new Promise(r => setTimeout(r, 100));

    // Manually send SYNC_ACCEPT
    const sessionId = `fail-test-${Date.now()}`;
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
        sync_session_id: sessionId,
        last_sync_timestamp: 0,
      },
    });
    await new Promise(r => setTimeout(r, 100));

    // Client sends SYNC_START
    await new Promise(r => setTimeout(r, 200));

    // Send server data in dependency-safe order:
    // 1. valid character (table: character_profiles, order 3)
    // 2. invalid entity (table: entities, order 5) — will trigger FK error
    // 3. valid character (table: character_profiles, order 3)
    mockServer.send({
      event_type: 'SYNC_DATA', status: 'NEW',
      payload: {sync_session_id: sessionId, event_id: 'evt_1', table: 'character_profiles', operation: 'insert', record: validChar1},
    });
    await new Promise(r => setTimeout(r, 50));
    mockServer.send({
      event_type: 'SYNC_DATA', status: 'NEW',
      payload: {sync_session_id: sessionId, event_id: 'evt_2', table: 'entities', operation: 'insert', record: invalidEntity},
    });
    await new Promise(r => setTimeout(r, 50));
    mockServer.send({
      event_type: 'SYNC_DATA', status: 'NEW',
      payload: {sync_session_id: sessionId, event_id: 'evt_3', table: 'character_profiles', operation: 'insert', record: validChar2},
    });

    // Send SYNC_COMPLETE to trigger buffer application
    await new Promise(r => setTimeout(r, 100));
    mockServer.send({
      event_type: 'SYNC_COMPLETE', status: 'NEW',
      payload: {sync_session_id: sessionId},
    });

    // Client applies buffer, then starts CLIENT_SENDING phase.
    // Since no local changes, client sends SYNC_COMPLETE to signal done.
    // Auto-responder processes client's SYNC_COMPLETE but manual mode prevents response.
    // We need to manually send SYNC_COMPLETE with SUCCESS back, then SYNC_FINALIZE.

    await new Promise(r => setTimeout(r, 500));

    // Check if the client sent SYNC_COMPLETE (it has received SYNC_COMPLETE from us
    // and should respond). Send acknowledgment.
    mockServer.send({
      event_type: 'SYNC_COMPLETE', status: 'SUCCESS',
      payload: {sync_session_id: sessionId},
    });
    await new Promise(r => setTimeout(r, 200));

    // Client sends SYNC_FINALIZE. Acknowledge it.
    mockServer.send({
      event_type: 'SYNC_FINALIZE', status: 'SUCCESS',
      payload: {sync_session_id: sessionId},
    });
    await new Promise(r => setTimeout(r, 300));

    // VERIFY: Valid character 1 was applied
    const [r1] = await db.executeSql(
      "SELECT id, name FROM character_profiles WHERE id = 'char-fail-valid-1'",
    );
    expect(r1.rows.length).toBe(1);
    expect(r1.rows.item(0).name).toBe('Valid Character One');

    // VERIFY: Invalid entity was NOT applied (FK violation prevented insert)
    const [r2] = await db.executeSql(
      "SELECT id FROM entities WHERE id = 'entity-fail-invalid'",
    );
    expect(r2.rows.length).toBe(0);

    // VERIFY: Valid character 2 was applied
    const [r3] = await db.executeSql(
      "SELECT id, name FROM character_profiles WHERE id = 'char-fail-valid-2'",
    );
    expect(r3.rows.length).toBe(1);
    expect(r3.rows.item(0).name).toBe('Valid Character Two');
  }, 15000);

  // -------------------------------------------------------------------------
  // Test 2: Sends SYNC_DATA_CONFIRM with ERROR status on handler failure
  // -------------------------------------------------------------------------
  // TODO: This test requires a way to force handleIncomingSyncData to throw,
  // which triggers the ERROR confirmation path (lines 825-836 of SyncService.ts).
  // The current mock infrastructure doesn't easily simulate the specific network
  // error that would cause this. To implement, one would need to make the mock
  // ConnectionManager throw on sendEvent for certain event types, or inject a
  // failure into the incomingDataBuffer push that throws synchronously.
  // See: https://github.com/harmony-ai-solutions/harmony-ai-app/issues/sync-error-confirm
  it.skip('sends SYNC_DATA_CONFIRM with ERROR status when handleIncomingSyncData fails', () => {
    // Skipped: requires mocking sendEvent to throw for SYNC_DATA_CONFIRM
  });

  // -------------------------------------------------------------------------
  // Test 3: Buffered data is rolled back if SYNC_COMPLETE never arrives
  // -------------------------------------------------------------------------
  it('rolls back buffered data if SYNC_COMPLETE never arrives', async () => {
    // Simulate partial data received but connection lost before SYNC_COMPLETE
    mockServer.setManualMode(true);
    mockServer.startAutoResponder();

    syncService.initiateSync();
    await new Promise(r => setTimeout(r, 100));

    const sessionId = `rollback-${Date.now()}`;
    mockServer.send({
      event_type: 'SYNC_ACCEPT', status: 'NEW',
      payload: {
        device_id: 'harmony_link', device_name: 'Harmony Link',
        device_type: 'harmony_link', device_platform: 'server',
        current_utc_timestamp: Math.floor(Date.now() / 1000),
        clock_drift_seconds: 0,
        sync_session_id: sessionId,
        last_sync_timestamp: 0,
      },
    });
    await new Promise(r => setTimeout(r, 100));
    await new Promise(r => setTimeout(r, 200));

    // Send one SYNC_DATA record (valid)
    const char = sampleCharacter({
      id: 'char-rollback-3',
      name: 'Should Not Persist',
      created_at: new Date(Date.now() - 5000).toISOString(),
      updated_at: new Date(Date.now() - 5000).toISOString(),
    });
    mockServer.send({
      event_type: 'SYNC_DATA', status: 'NEW',
      payload: {
        sync_session_id: sessionId, event_id: 'evt_rollback',
        table: 'character_profiles', operation: 'insert', record: char,
      },
    });
    await new Promise(r => setTimeout(r, 200));

    // DROP connection before SYNC_COMPLETE
    mockServer.dropConnection();
    await new Promise(r => setTimeout(r, 200));

    // VERIFY: Character was NOT inserted (buffer never flushed to DB)
    const [result] = await db.executeSql(
      "SELECT id FROM character_profiles WHERE id = 'char-rollback-3'",
    );
    expect(result.rows.length).toBe(0);
  }, 10000);
});
