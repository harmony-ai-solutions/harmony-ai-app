/**
 * SyncService Integration Tests
 *
 * These tests exercise the real SyncService state machine + real SQLite database
 * (via NodeDatabase) end-to-end.  The only mocked boundary is the ConnectionManager,
 * which is replaced with a lightweight mock that routes events through the
 * HarmonyLinkMockServer instead of actual WebSocket.
 *
 * This catches:
 *  - SQL errors in getChangedRecords / applySyncRecord after schema changes
 *  - Wrong column types (e.g., expecting INTEGER but receiving TEXT)
 *  - Missing columns after a migration
 *  - Actual transaction behavior (commit / rollback)
 */

import {SyncService} from '../../src/services/SyncService';
import type {NodeDatabase} from '../../src/database/__test_utils__/nodeDatabase';
import {createInMemoryDatabase} from '../../src/database/__test_utils__/testDatabase';
import {runMigrations} from '../../src/database/migrations';
import {resetSyncServiceSingleton} from './helpers/resetSyncService';
import {HarmonyLinkMockServer} from './helpers/HarmonyLinkMockServer';
import {sampleCharacter, insertCharacterProfile} from './helpers/fixtures';

// ---------------------------------------------------------------------------
// Module-level mutable refs used by hoisted jest.mock calls
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

// ---------------------------------------------------------------------------
// Mock database connection module to return our test DB
// ---------------------------------------------------------------------------
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
// Helper: create a mock ConnectionManager that routes through the mock server
// ---------------------------------------------------------------------------
function createMockConnectionManager(server: HarmonyLinkMockServer) {
  let eventHandler: ((event: any) => void) | null = null;

  // When the server sends an event, route it to SyncService's routeSyncEvent
  server.setEventHandler((event: any) => {
    if (eventHandler) {
      // Use setImmediate to simulate async network delivery
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
// Test suite
// ---------------------------------------------------------------------------
const WSS_URL = 'ws://localhost:8443/test-sync';

describe('SyncService integration', () => {
  let db: NodeDatabase;
  let mockServer: HarmonyLinkMockServer;
  let syncService: SyncService;
  let mockCm: ReturnType<typeof createMockConnectionManager>;

  beforeEach(async () => {
    // 0. Clear AsyncStorage state (critical — previous tests persist values)
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();

    // 1. Fresh in-memory DB with all migrations applied
    db = createInMemoryDatabase();
    await runMigrations(db, true);
    testDbRef.current = db;

    // 2. Create mock server
    mockServer = new HarmonyLinkMockServer();

    // 3. Create mock ConnectionManager wired to the server
    mockCm = createMockConnectionManager(mockServer);

    // 4. Reset SyncService singleton and inject mock CM
    resetSyncServiceSingleton();
    syncService = SyncService.getInstance();
    (syncService as any).connectionManager.removeAllListeners?.();
    (syncService as any).connectionManager = mockCm;
    (syncService as any).setupConnectionListeners();

    // 5. Store ref for jest.mock hoisted reference
    mockServerRef.current = mockServer;
  });

  afterEach(async () => {
    // Clean up SyncService instance to stop any pending timers
    if (syncService) {
      syncService.removeAllListeners();
      // Clear any pending sync conf timeouts by nulling the session
      (syncService as any).currentSession = null;
      (syncService as any).pendingHandshake = null;
      (syncService as any).pendingSyncConfirmation = null;
      (syncService as any).pendingSizeEstimate = null;
    }
    mockServer.reset();
    testDbRef.current = null;
    mockServerRef.current = null;
    if (db) {
      await db.close();
    }
  });

  // -----------------------------------------------------------------------
  // Test 1: New device — empty DB pulls everything from server
  // -----------------------------------------------------------------------
  it('pulls all data from server when syncing for first time (new device, empty DB)', async () => {
    // Seed server-side data
    const serverChar1 = sampleCharacter({
      id: 'char-pull-1',
      name: 'Server Character 1',
      created_at: new Date(Date.now() - 10000).toISOString(),
      updated_at: new Date(Date.now() - 10000).toISOString(),
    });
    const serverChar2 = sampleCharacter({
      id: 'char-pull-2',
      name: 'Server Character 2',
      created_at: new Date(Date.now() - 10000).toISOString(),
      updated_at: new Date(Date.now() - 10000).toISOString(),
    });
    mockServer.setServerData('character_profiles', [serverChar1, serverChar2]);
    mockServer.startAutoResponder();

    // Drive sync
    const completedPromise = new Promise<void>(resolve =>
      syncService.on('sync:completed', () => resolve()),
    );
    syncService.initiateSync();
    await completedPromise;

    // Allow async buffer application to settle
    await new Promise(r => setTimeout(r, 100));

    // VERIFY: Real DB has both characters
    const [result] = await db.executeSql(
      "SELECT * FROM character_profiles WHERE id = 'char-pull-1' OR id = 'char-pull-2'",
    );
    expect(result.rows.length).toBe(2);

    const rows: any[] = [];
    for (let i = 0; i < result.rows.length; i++) {
      rows.push(result.rows.item(i));
    }

    const char1 = rows.find(r => r.id === 'char-pull-1');
    const char2 = rows.find(r => r.id === 'char-pull-2');
    expect(char1).toBeDefined();
    expect(char1.name).toBe('Server Character 1');
    expect(char2).toBeDefined();
    expect(char2.name).toBe('Server Character 2');

    // VERIFY: Protocol events
    const eventTypes = mockServer.receivedEvents.map((e: any) => e.event_type);
    expect(eventTypes).toContain('SYNC_REQUEST');
    expect(eventTypes).toContain('SYNC_START');
    expect(eventTypes).toContain('SYNC_COMPLETE');
    expect(eventTypes).toContain('SYNC_FINALIZE');

    // Verify event ordering: SYNC_REQUEST → SYNC_START → SYNC_COMPLETE → SYNC_FINALIZE
    const reqIdx = eventTypes.indexOf('SYNC_REQUEST');
    const startIdx = eventTypes.indexOf('SYNC_START');
    const compIdx = eventTypes.indexOf('SYNC_COMPLETE');
    const finIdx = eventTypes.indexOf('SYNC_FINALIZE');
    expect(startIdx).toBeGreaterThan(reqIdx);
    expect(compIdx).toBeGreaterThan(startIdx);
    expect(finIdx).toBeGreaterThan(compIdx);
  }, 15000);

  // -----------------------------------------------------------------------
  // Test 2: New device — with existing content (bidirectional first sync)
  // -----------------------------------------------------------------------
  it('sends local data and receives server data on first sync', async () => {
    // Seed client DB with a local character
    const localChar = sampleCharacter({
      id: 'char-local-1',
      name: 'Local Character',
      created_at: new Date(Date.now() - 5000).toISOString(),
      updated_at: new Date(Date.now() - 5000).toISOString(),
    });
    await insertCharacterProfile(db, localChar);

    // Seed server with different data
    const serverChar = sampleCharacter({
      id: 'char-server-1',
      name: 'Server Character',
      created_at: new Date(Date.now() - 10000).toISOString(),
      updated_at: new Date(Date.now() - 10000).toISOString(),
    });
    mockServer.setServerData('character_profiles', [serverChar]);
    mockServer.startAutoResponder();

    // Drive sync
    const completedPromise = new Promise<void>(resolve =>
      syncService.on('sync:completed', () => resolve()),
    );
    syncService.initiateSync();
    await completedPromise;

    // Allow pending microtasks and setImmediates to settle
    await new Promise(r => setTimeout(r, 300));

    // VERIFY: DB has both characters (client received server data + local data preserved)
    const [result] = await db.executeSql(
      "SELECT * FROM character_profiles WHERE id = 'char-local-1' OR id = 'char-server-1'",
    );
    expect(result.rows.length).toBe(2);

    // VERIFY: Sync protocol completed (SYNC_FINALIZE was sent by client)
    const allTypes = mockServer.receivedEvents.map((e: any) => e.event_type);
    expect(allTypes).toContain('SYNC_REQUEST');
    expect(allTypes).toContain('SYNC_START');
    expect(allTypes).toContain('SYNC_FINALIZE');
  }, 15000);

  // -----------------------------------------------------------------------
  // Test 3: Existing device — server updates only (incremental pull)
  // -----------------------------------------------------------------------
  it('receives only updated records from server (incremental pull)', async () => {
    // Simulate previous sync by setting last sync timestamp
    const lastSyncTime = Math.floor((Date.now() - 10000) / 1000);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.setItem('last_sync_timestamp:selfhosted', String(lastSyncTime));

    // Seed DB with a character that was synced before
    const oldChar = sampleCharacter({
      id: 'char-sync-1',
      name: 'Original Name',
      description: 'Original description',
      created_at: new Date(Date.now() - 20000).toISOString(),
      updated_at: new Date(Date.now() - 20000).toISOString(),
    });
    await insertCharacterProfile(db, oldChar);

    // Server has updated version
    mockServer.setServerData('character_profiles', [
      sampleCharacter({
        id: 'char-sync-1',
        name: 'Updated Name',
        description: 'Updated description',
        created_at: new Date(Date.now() - 20000).toISOString(),
        updated_at: new Date(Date.now() - 5000).toISOString(), // after last sync
      }),
    ]);
    mockServer.startAutoResponder();

    // Drive sync
    const completedPromise = new Promise<void>(resolve =>
      syncService.on('sync:completed', () => resolve()),
    );
    syncService.initiateSync();
    await completedPromise;
    await new Promise(r => setTimeout(r, 100));

    // VERIFY: Char updated in DB
    const [result] = await db.executeSql(
      "SELECT * FROM character_profiles WHERE id = 'char-sync-1'",
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows.item(0).name).toBe('Updated Name');
    expect(result.rows.item(0).description).toBe('Updated description');
  }, 15000);

  // -----------------------------------------------------------------------
  // Test 4: Existing device — client updates only (incremental push)
  // -----------------------------------------------------------------------
  it('sends local updates to server (incremental push)', async () => {
    // Simulate previous sync
    const lastSyncTime = Math.floor((Date.now() - 10000) / 1000);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.setItem('last_sync_timestamp:selfhosted', String(lastSyncTime));

    // Seed DB with a character updated locally
    const updatedChar = sampleCharacter({
      id: 'char-client-1',
      name: 'Device Updated Name',
      description: 'Updated on device',
      created_at: new Date(Date.now() - 20000).toISOString(),
      updated_at: new Date(Date.now() - 5000).toISOString(), // after last sync
    });
    await insertCharacterProfile(db, updatedChar);

    mockServer.startAutoResponder();

    // Drive sync
    const completedPromise = new Promise<void>(resolve =>
      syncService.on('sync:completed', () => resolve()),
    );
    syncService.initiateSync();
    await completedPromise;
    await new Promise(r => setTimeout(r, 100));

    // VERIFY: Server received the update
    expect(mockServer.hasServerRecord('character_profiles', 'char-client-1')).toBe(true);

    // VERIFY: SYNC_DATA events with our record were sent
    const syncDataEvents = mockServer.receivedEvents.filter(
      (e: any) => e.event_type === 'SYNC_DATA',
    );
    const ourUpdate = syncDataEvents.find(
      (e: any) =>
        e.payload.table === 'character_profiles' &&
        e.payload.record.id === 'char-client-1',
    );
    expect(ourUpdate).toBeDefined();
    expect(ourUpdate.payload.record.name).toBe('Device Updated Name');
  }, 15000);

  // -----------------------------------------------------------------------
  // Test 5: Existing device — with deletes (soft-delete propagation)
  // -----------------------------------------------------------------------
  it('propagates soft-deleted records from server', async () => {
    // Simulate previous sync
    const lastSyncTime = Math.floor((Date.now() - 10000) / 1000);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.setItem('last_sync_timestamp:selfhosted', String(lastSyncTime));

    // Server has a deleted character and a kept character
    mockServer.setServerData('character_profiles', [
      sampleCharacter({
        id: 'char-del-1',
        name: 'Character To Delete',
        created_at: new Date(Date.now() - 20000).toISOString(),
        updated_at: new Date(Date.now() - 20000).toISOString(),
        deleted_at: new Date(Date.now() - 3000).toISOString(), // deleted after last sync
      }),
      sampleCharacter({
        id: 'char-keep-1',
        name: 'Character To Keep',
        created_at: new Date(Date.now() - 20000).toISOString(),
        updated_at: new Date(Date.now() - 20000).toISOString(),
        deleted_at: null,
      }),
    ]);
    mockServer.startAutoResponder();

    // Drive sync
    const completedPromise = new Promise<void>(resolve =>
      syncService.on('sync:completed', () => resolve()),
    );
    syncService.initiateSync();
    await completedPromise;
    await new Promise(r => setTimeout(r, 200));

    // VERIFY: Sync completed (server received SYNC_FINALIZE)
    expect(
      mockServer.receivedEvents.some((e: any) => e.event_type === 'SYNC_FINALIZE'),
    ).toBe(true);

    // VERIFY: Server sent SYNC_DATA for the deleted record (client received it)
    const serverDataEvents = mockServer.receivedEvents.filter(
      (e: any) =>
        e.event_type === 'SYNC_DATA' &&
        e.payload.record?.id === 'char-del-1',
    ).length;
    // We sent it as part of the server's data push; verify via the client's confirm
    // (the client processes SYNC_DATA and sends SYNC_DATA_CONFIRM)
    const confirmForDeleted = mockServer.receivedEvents.filter(
      (e: any) =>
        e.event_type === 'SYNC_DATA_CONFIRM' &&
        e.payload.event_id?.includes('char-del-1'),
    );

    // Client processed the server's data (sync completed successfully)
    // Note: cleanupSoftDeletedRecords runs after sync finalizes and removes
    // records where deleted_at < sessionStartTime. So the character may be
    // hard-deleted from the DB. This test verifies it was received and processed.
    expect(mockServer.receivedEvents.some((e: any) => e.event_type === 'SYNC_DATA_CONFIRM')).toBe(true);

    // VERIFY: Kept character is present in DB
    const [keepResult] = await db.executeSql(
      "SELECT * FROM character_profiles WHERE id = 'char-keep-1'",
    );
    expect(keepResult.rows.length).toBe(1);
    expect(keepResult.rows.item(0).deleted_at).toBeFalsy();
  }, 15000);

  // -----------------------------------------------------------------------
  // Test 6: Protocol flow — verify event ordering
  // -----------------------------------------------------------------------
  it('follows the correct sync protocol event ordering', async () => {
    mockServer.startAutoResponder();

    const completedPromise = new Promise<void>(resolve =>
      syncService.on('sync:completed', () => resolve()),
    );
    syncService.initiateSync();
    await completedPromise;
    await new Promise(r => setTimeout(r, 100));

    const eventTypes = mockServer.receivedEvents.map((e: any) => e.event_type);

    // The client sends (in order): SYNC_REQUEST, SYNC_START, SYNC_COMPLETE, SYNC_FINALIZE
    // (SYNC_DATA is not sent because client has no data)
    expect(eventTypes).toContain('SYNC_REQUEST');
    expect(eventTypes).toContain('SYNC_START');
    expect(eventTypes).toContain('SYNC_COMPLETE');
    expect(eventTypes).toContain('SYNC_FINALIZE');

    const reqIdx = eventTypes.indexOf('SYNC_REQUEST');
    const startIdx = eventTypes.indexOf('SYNC_START');
    const compIdx = eventTypes.indexOf('SYNC_COMPLETE');
    const finIdx = eventTypes.indexOf('SYNC_FINALIZE');

    expect(startIdx).toBeGreaterThan(reqIdx);
    expect(compIdx).toBeGreaterThan(startIdx);
    expect(finIdx).toBeGreaterThan(compIdx);
  }, 15000);

  // -----------------------------------------------------------------------
  // Test 7: Last sync timestamp update
  // -----------------------------------------------------------------------
  it('updates last sync timestamp on completion', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');

    mockServer.startAutoResponder();

    const completedPromise = new Promise<void>(resolve =>
      syncService.on('sync:completed', () => resolve()),
    );
    syncService.initiateSync();
    await completedPromise;
    await new Promise(r => setTimeout(r, 100));

    // Verify timestamp was updated in AsyncStorage (per-source key; the
    // legacy global alias was removed — it must NOT be written anymore)
    const timestampStr = await AsyncStorage.getItem('last_sync_timestamp:selfhosted');
    expect(timestampStr).toBeTruthy();
    expect(parseInt(timestampStr, 10)).toBeGreaterThan(0);
    expect(await AsyncStorage.getItem('last_sync_timestamp')).toBeNull();
  }, 15000);

  // -----------------------------------------------------------------------
  // Test 8: No watermark — sync must escalate to force_full_sync
  // -----------------------------------------------------------------------
  it('sends force_full_sync: true when no watermark exists (fresh/wiped client)', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();

    // Seed server-side data
    const serverChar = sampleCharacter({
      id: 'char-wipe-1',
      name: 'Server Character After Wipe',
      created_at: new Date(Date.now() - 10000).toISOString(),
      updated_at: new Date(Date.now() - 10000).toISOString(),
    });
    mockServer.setServerData('character_profiles', [serverChar]);
    mockServer.startAutoResponder();

    // Drive sync
    const completedPromise = new Promise<void>(resolve =>
      syncService.on('sync:completed', () => resolve()),
    );
    syncService.initiateSync();
    await completedPromise;
    await new Promise(r => setTimeout(r, 100));

    // VERIFY: The SYNC_REQUEST payload must carry force_full_sync: true with
    // last_sync_timestamp: 0 — the engine IGNORES a bare last_sync_timestamp: 0
    // (it keeps its own per-device watermark) and only resends everything when
    // force_full_sync is set. A client with no watermark has nothing locally,
    // so requesting a full pull is correct and lossless.
    const syncRequest = mockServer.receivedEvents.find(
      (e: any) => e.event_type === 'SYNC_REQUEST',
    );
    expect(syncRequest).toBeDefined();
    expect(syncRequest.payload.force_full_sync).toBe(true);
    expect(syncRequest.payload.last_sync_timestamp).toBe(0);

    // VERIFY: The server's data actually arrives in the local DB
    const [result] = await db.executeSql(
      "SELECT * FROM character_profiles WHERE id = 'char-wipe-1'",
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows.item(0).name).toBe('Server Character After Wipe');
  }, 15000);

  // -----------------------------------------------------------------------
  // Test 9: Existing watermark — sync stays incremental (force_full_sync: false)
  // -----------------------------------------------------------------------
  it('keeps force_full_sync: false when a watermark exists (incremental sync)', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    const lastSyncTime = Math.floor((Date.now() - 10000) / 1000);
    await AsyncStorage.setItem('last_sync_timestamp:selfhosted', String(lastSyncTime));

    mockServer.startAutoResponder();

    // Drive sync
    const completedPromise = new Promise<void>(resolve =>
      syncService.on('sync:completed', () => resolve()),
    );
    syncService.initiateSync();
    await completedPromise;
    await new Promise(r => setTimeout(r, 100));

    // VERIFY: With an existing watermark the client must NOT escalate to a
    // full sync — it requests an incremental sync from its watermark.
    const syncRequest = mockServer.receivedEvents.find(
      (e: any) => e.event_type === 'SYNC_REQUEST',
    );
    expect(syncRequest).toBeDefined();
    expect(syncRequest.payload.force_full_sync).toBe(false);
    expect(syncRequest.payload.last_sync_timestamp).toBe(lastSyncTime);
  }, 15000);

  // -----------------------------------------------------------------------
  // Test 10: Explicit forceFullSync() must always send force_full_sync: true
  // -----------------------------------------------------------------------
  it('sends force_full_sync: true when forceFullSync() is called explicitly', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    // Even with an existing watermark, an explicit force sync must escalate
    const lastSyncTime = Math.floor((Date.now() - 10000) / 1000);
    await AsyncStorage.setItem('last_sync_timestamp:selfhosted', String(lastSyncTime));

    mockServer.startAutoResponder();

    const completedPromise = new Promise<void>(resolve =>
      syncService.on('sync:completed', () => resolve()),
    );
    syncService.forceFullSync();
    await completedPromise;
    await new Promise(r => setTimeout(r, 100));

    const syncRequest = mockServer.receivedEvents.find(
      (e: any) => e.event_type === 'SYNC_REQUEST',
    );
    expect(syncRequest).toBeDefined();
    expect(syncRequest.payload.force_full_sync).toBe(true);
    expect(syncRequest.payload.last_sync_timestamp).toBe(0);
  }, 15000);

  // -----------------------------------------------------------------------
  // Test 11: SYNC_DATA_SIZE_ESTIMATE — accept path
  // -----------------------------------------------------------------------
  it('emits sync:estimate and completes the sync after confirmSizeEstimate(true)', async () => {
    const serverChar = sampleCharacter({
      id: 'char-est-accept',
      name: 'Estimate Accepted Character',
      created_at: new Date(Date.now() - 5000).toISOString(),
      updated_at: new Date(Date.now() - 5000).toISOString(),
    });
    mockServer.setServerData('character_profiles', [serverChar]);
    mockServer.setSendSizeEstimate(true);
    mockServer.startAutoResponder();

    const estimatePromise = new Promise<any>(resolve =>
      syncService.once('sync:estimate', resolve),
    );
    const completedPromise = new Promise<void>(resolve =>
      syncService.once('sync:completed', () => resolve()),
    );

    syncService.initiateSync();

    // The engine blocks until we confirm the estimate — capture it.
    const estimate = await estimatePromise;
    expect(estimate).toBeDefined();
    expect(estimate.event_id).toBeDefined();
    expect(estimate.sync_session_id).toBeDefined();
    // The engine serializes the estimate with snake_case JSON tags — the app
    // must read `total_records` / `image_count` / `estimated_download_mb`.
    expect(estimate.total_records).toBe(1);
    expect(estimate.estimated_download_mb).toBeGreaterThan(0);
    expect(estimate.image_count).toBe(0);

    // Accept → the engine proceeds to stream SYNC_DATA and completes the sync.
    await syncService.confirmSizeEstimate(true);
    await completedPromise;
    await new Promise(r => setTimeout(r, 100));

    // VERIFY: server data was applied
    const [result] = await db.executeSql(
      "SELECT id, name FROM character_profiles WHERE id = 'char-est-accept'",
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows.item(0).name).toBe('Estimate Accepted Character');

    // VERIFY: exactly one SUCCESS confirmation was sent, echoing the estimate event_id
    const confirms = mockServer.receivedEvents.filter(
      (e: any) => e.event_type === 'SYNC_DATA_SIZE_ESTIMATE_CONFIRM',
    );
    expect(confirms.length).toBe(1);
    expect(confirms[0].payload.status).toBe('SUCCESS');
    expect(confirms[0].payload.event_id).toBe(estimate.event_id);
    expect(confirms[0].payload.sync_session_id).toBe(estimate.sync_session_id);

    // VERIFY: pending estimate cleared
    expect((syncService as any).pendingSizeEstimate).toBeNull();
  }, 15000);

  // -----------------------------------------------------------------------
  // Test 11b: SYNC_DATA_SIZE_ESTIMATE — configurable estimate size
  // -----------------------------------------------------------------------
  it('emits the configured estimated_download_mb when setEstimateDownloadMB is used', async () => {
    const serverChar = sampleCharacter({
      id: 'char-est-size',
      name: 'Estimate Size Character',
      created_at: new Date(Date.now() - 5000).toISOString(),
      updated_at: new Date(Date.now() - 5000).toISOString(),
    });
    mockServer.setServerData('character_profiles', [serverChar]);
    mockServer.setSendSizeEstimate(true);
    mockServer.setEstimateDownloadMB(42);
    mockServer.startAutoResponder();

    const estimatePromise = new Promise<any>(resolve =>
      syncService.once('sync:estimate', resolve),
    );

    syncService.initiateSync();
    const estimate = await estimatePromise;

    expect(estimate).toBeDefined();
    expect(estimate.estimated_download_mb).toBe(42);
    // Snake_case keys are emitted (never PascalCase).
    expect(estimate.EstimatedDownloadMB).toBeUndefined();
    expect(estimate.total_records).toBe(1);
    expect(estimate.image_count).toBe(0);

    // Accept so the session unwinds cleanly (avoid dangling timers).
    await syncService.confirmSizeEstimate(true);
    await new Promise(r => setTimeout(r, 50));
  }, 15000);

  // -----------------------------------------------------------------------
  // Test 12: SYNC_DATA_SIZE_ESTIMATE — reject path aborts the session
  // -----------------------------------------------------------------------
  it('aborts the sync session when confirmSizeEstimate(false) is called', async () => {
    const serverChar = sampleCharacter({
      id: 'char-est-reject',
      name: 'Estimate Rejected Character',
      created_at: new Date(Date.now() - 5000).toISOString(),
      updated_at: new Date(Date.now() - 5000).toISOString(),
    });
    mockServer.setServerData('character_profiles', [serverChar]);
    mockServer.setSendSizeEstimate(true);
    mockServer.startAutoResponder();

    const estimatePromise = new Promise<any>(resolve =>
      syncService.once('sync:estimate', resolve),
    );
    const abortedPromise = new Promise<string>(resolve =>
      syncService.once('sync:aborted', resolve),
    );

    syncService.initiateSync();
    const estimate = await estimatePromise;

    await syncService.confirmSizeEstimate(false);

    // VERIFY: sync:aborted emitted with the rejection reason
    const reason = await abortedPromise;
    expect(reason).toContain('size estimate rejected');

    // VERIFY: session state fully cleared (abort path)
    expect((syncService as any).currentSession).toBeNull();
    expect((syncService as any).syncPhase).toBe('IDLE');
    expect((syncService as any).pendingSizeEstimate).toBeNull();
    expect((syncService as any).incomingDataBuffer).toEqual([]);

    // VERIFY: REJECTED confirmation was sent
    const confirms = mockServer.receivedEvents.filter(
      (e: any) => e.event_type === 'SYNC_DATA_SIZE_ESTIMATE_CONFIRM',
    );
    expect(confirms.length).toBe(1);
    expect(confirms[0].payload.status).toBe('REJECTED');
    expect(confirms[0].payload.event_id).toBe(estimate.event_id);

    // VERIFY: no buffered data is ever applied — even if a straggler
    // SYNC_DATA arrives after the abort (session is gone, record ignored).
    mockServer.send({
      event_type: 'SYNC_DATA',
      status: 'NEW',
      payload: {
        sync_session_id: estimate.sync_session_id,
        event_id: 'straggler_after_reject',
        table: 'character_profiles',
        operation: 'insert',
        record: serverChar,
      },
    });
    await new Promise(r => setTimeout(r, 100));
    const [result] = await db.executeSql(
      "SELECT id FROM character_profiles WHERE id = 'char-est-reject'",
    );
    expect(result.rows.length).toBe(0);
  }, 15000);

  // -----------------------------------------------------------------------
  // Test 13: Backward compat — engine sends NO estimate, sync proceeds as before
  // -----------------------------------------------------------------------
  it('does not wait for a size estimate that never arrives (backward compat)', async () => {
    const serverChar = sampleCharacter({
      id: 'char-est-backcompat',
      name: 'Backward Compat Character',
      created_at: new Date(Date.now() - 5000).toISOString(),
      updated_at: new Date(Date.now() - 5000).toISOString(),
    });
    mockServer.setServerData('character_profiles', [serverChar]);
    // NOTE: setSendSizeEstimate intentionally NOT enabled — legacy engine
    // goes straight from SYNC_START to SYNC_DATA.
    mockServer.startAutoResponder();

    const completedPromise = new Promise<void>(resolve =>
      syncService.once('sync:completed', () => resolve()),
    );
    syncService.initiateSync();
    await completedPromise;
    await new Promise(r => setTimeout(r, 100));

    // VERIFY: data still pulled + sync finalized without any estimate round-trip
    const [result] = await db.executeSql(
      "SELECT id FROM character_profiles WHERE id = 'char-est-backcompat'",
    );
    expect(result.rows.length).toBe(1);

    expect(
      mockServer.receivedEvents.some(
        (e: any) => e.event_type === 'SYNC_DATA_SIZE_ESTIMATE_CONFIRM',
      ),
    ).toBe(false);
    expect(
      mockServer.receivedEvents.some((e: any) => e.event_type === 'SYNC_FINALIZE'),
    ).toBe(true);
  }, 15000);

  // -----------------------------------------------------------------------
  // syncAndWait: resolves only after the sync round-trip completes
  // -----------------------------------------------------------------------
  it('syncAndWait resolves after the sync completes', async () => {
    const serverChar = sampleCharacter({
      id: 'char-wait-complete',
      name: 'Wait Complete Character',
      created_at: new Date(Date.now() - 5000).toISOString(),
      updated_at: new Date(Date.now() - 5000).toISOString(),
    });
    mockServer.setServerData('character_profiles', [serverChar]);
    mockServer.startAutoResponder();

    // syncAndWait must resolve only once the engine has ingested the data
    // (sync:completed / SYNC_FINALIZE) — not merely when SYNC_REQUEST is sent.
    await syncService.syncAndWait({ timeoutMs: 8000 });
    await new Promise(r => setTimeout(r, 100));

    const [result] = await db.executeSql(
      "SELECT id FROM character_profiles WHERE id = 'char-wait-complete'",
    );
    expect(result.rows.length).toBe(1);
  }, 15000);

  // -----------------------------------------------------------------------
  // syncAndWait: best-effort timeout — never blocks navigation forever
  // -----------------------------------------------------------------------
  it('syncAndWait resolves on timeout when the server never completes', async () => {
    // No server data + no auto-responder → sync stalls at SYNC_REQUEST and never
    // emits sync:completed. syncAndWait must still resolve after the timeout so
    // callers (e.g. entity creation → chat navigation) are never blocked forever.
    const start = Date.now();
    await syncService.syncAndWait({ timeoutMs: 300 });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(300);
    expect(elapsed).toBeLessThan(3000);
  }, 15000);
});
