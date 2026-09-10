/**
 * lifecycle_state Sync Integration Tests
 *
 * Covers the lifecycle_state table's sync propagation (engine migration
 * 000038 + 000040, app migrations 000038/000040):
 *  - Pull: server sends lifecycle_state records (entity_id PRIMARY KEY — the
 *    emotion_state table shape) and the app applies insert / LWW update /
 *    soft-delete.
 *  - Push: a locally-owned lifecycle_state row is sent to the server keyed by
 *    entity_id with `sleeping` normalized from SQLite 0/1 to a JSON boolean
 *    (the Go engine unmarshals into a bool field).
 */

import {SyncService} from '../../src/services/SyncService';
import type {NodeDatabase} from '../../src/database/__test_utils__/nodeDatabase';
import {createInMemoryDatabase} from '../../src/database/__test_utils__/testDatabase';
import {runMigrations} from '../../src/database/migrations';
import {resetSyncServiceSingleton} from './helpers/resetSyncService';
import {HarmonyLinkMockServer} from './helpers/HarmonyLinkMockServer';
import {sampleEntity, sampleLifecycleState} from './helpers/fixtures';
import {runFullSync} from './helpers/runFullSync';

// ---------------------------------------------------------------------------
// Module-level mutable refs used by hoisted jest.mock calls
// ---------------------------------------------------------------------------
const testDbRef: {current: NodeDatabase | null} = {current: null};

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
// Helper: mock ConnectionManager wired to the mock server
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
// Shared test setup
// ---------------------------------------------------------------------------
async function setupTest(): Promise<{
  db: NodeDatabase;
  mockServer: HarmonyLinkMockServer;
  syncService: SyncService;
}> {
  const db = createInMemoryDatabase();
  await runMigrations(db, true);
  testDbRef.current = db;

  const mockServer = new HarmonyLinkMockServer();
  const mockCm = createMockConnectionManager(mockServer);

  resetSyncServiceSingleton();
  const syncService = SyncService.getInstance();
  (syncService as any).connectionManager.removeAllListeners?.();
  (syncService as any).connectionManager = mockCm;
  (syncService as any).setupConnectionListeners();

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
  if (db) {
    await db.close();
  }
}

/** Seed an entities row (lifecycle_state has an FK on entities.id). */
async function insertEntityRow(db: NodeDatabase, entityId: string): Promise<void> {
  // entities.lifecycle_config is NOT NULL — sampleEntity defaults it to null.
  const entity = sampleEntity({id: entityId, lifecycle_config: '{}'});
  const columns = Object.keys(entity);
  const placeholders = columns.map(() => '?').join(', ');
  await db.executeSql(
    `INSERT INTO entities (${columns.join(', ')}) VALUES (${placeholders})`,
    Object.values(entity),
  );
}

describe('lifecycle_state sync (entity_id PK)', () => {
  let db: NodeDatabase;
  let mockServer: HarmonyLinkMockServer;
  let syncService: SyncService;

  beforeEach(async () => {
    const setup = await setupTest();
    db = setup.db;
    mockServer = setup.mockServer;
    syncService = setup.syncService;

    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
  });

  afterEach(async () => {
    await teardownTest(db, syncService, mockServer);
  });

  it('applies an incoming lifecycle_state insert keyed by entity_id', async () => {
    await insertEntityRow(db, 'entity-ls-1');

    const serverState = sampleLifecycleState({
      entity_id: 'entity-ls-1',
      exhaustion: 0.8,
      sleeping: true,
      inner_monologue: '["I should text them back"]',
    });
    mockServer.setServerData('lifecycle_state', [serverState]);
    mockServer.startAutoResponder();

    await runFullSync(syncService);
    await new Promise(r => setTimeout(r, 200));

    const [result] = await db.executeSql(
      "SELECT * FROM lifecycle_state WHERE entity_id = 'entity-ls-1'",
    );
    expect(result.rows.length).toBe(1);
    const row = result.rows.item(0);
    expect(row.exhaustion).toBe(0.8);
    // Go sends sleeping as a JSON boolean; SQLite stores it as 1.
    expect(row.sleeping).toBe(1);
    expect(row.inner_monologue).toBe('["I should text them back"]');
    expect(row.last_beat_at).toBe(serverState.last_beat_at);
    expect(row.deleted_at).toBeNull();
  }, 15000);

  it('applies an incoming lifecycle_state LWW update when the server row is newer', async () => {
    await insertEntityRow(db, 'entity-ls-2');

    const oldTimestamp = new Date(Date.now() - 5000).toISOString();
    await db.executeSql(
      `INSERT INTO lifecycle_state (entity_id, exhaustion, sleeping, inner_monologue, created_at, updated_at, deleted_at)
       VALUES ('entity-ls-2', 0.1, 0, '["stale"]', ?, ?, NULL)`,
      [oldTimestamp, oldTimestamp],
    );

    const serverState = sampleLifecycleState({
      entity_id: 'entity-ls-2',
      exhaustion: 0.6,
      sleeping: false,
      created_at: oldTimestamp,
      updated_at: new Date(Date.now() - 1000).toISOString(), // newer than local
    });
    mockServer.setServerData('lifecycle_state', [serverState]);
    mockServer.startAutoResponder();

    await runFullSync(syncService);
    await new Promise(r => setTimeout(r, 200));

    const [result] = await db.executeSql(
      "SELECT exhaustion FROM lifecycle_state WHERE entity_id = 'entity-ls-2'",
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows.item(0).exhaustion).toBe(0.6);
  }, 15000);

  it('applies an incoming lifecycle_state soft-delete', async () => {
    await insertEntityRow(db, 'entity-ls-3');

    const oldTimestamp = new Date(Date.now() - 5000).toISOString();
    await db.executeSql(
      `INSERT INTO lifecycle_state (entity_id, exhaustion, sleeping, inner_monologue, created_at, updated_at, deleted_at)
       VALUES ('entity-ls-3', 0.3, 0, '[]', ?, ?, NULL)`,
      [oldTimestamp, oldTimestamp],
    );

    // Future deleted_at so cleanupSoftDeletedRecords keeps the row (same trick
    // as the character_profiles conflict tests).
    const serverState = sampleLifecycleState({
      entity_id: 'entity-ls-3',
      deleted_at: new Date(Date.now() + 3600000).toISOString(),
      updated_at: new Date(Date.now() - 1000).toISOString(),
    });
    mockServer.setServerData('lifecycle_state', [serverState]);
    mockServer.startAutoResponder();

    await runFullSync(syncService);
    await new Promise(r => setTimeout(r, 200));

    const [result] = await db.executeSql(
      "SELECT deleted_at FROM lifecycle_state WHERE entity_id = 'entity-ls-3'",
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows.item(0).deleted_at).not.toBeNull();
  }, 15000);

  it('pushes a local lifecycle_state row keyed by entity_id with sleeping as a boolean', async () => {
    await insertEntityRow(db, 'entity-ls-4');

    // Simulate a previous sync so the push path filters by watermark.
    const lastSyncTime = Math.floor((Date.now() - 10000) / 1000);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.setItem('last_sync_timestamp:selfhosted', String(lastSyncTime));

    await db.executeSql(
      `INSERT INTO lifecycle_state (entity_id, exhaustion, sleeping, sleep_start_time, last_beat_at, last_outreach_at, inner_monologue, created_at, updated_at, deleted_at)
       VALUES ('entity-ls-4', 0.45, 1, NULL, 100, 200, '["local thought"]', ?, ?, NULL)`,
      [new Date().toISOString(), new Date().toISOString()],
    );

    mockServer.setServerData('character_profiles', []);
    mockServer.startAutoResponder();

    await runFullSync(syncService);
    await new Promise(r => setTimeout(r, 300));

    const clientSyncDataEvents = mockServer.receivedEvents.filter(
      (e: any) => e.event_type === 'SYNC_DATA' && e.payload?.table === 'lifecycle_state',
    );
    expect(clientSyncDataEvents.length).toBeGreaterThanOrEqual(1);

    const sentRecord = clientSyncDataEvents[0].payload.record;
    expect(sentRecord.entity_id).toBe('entity-ls-4');
    // SQLite stores the boolean as 0/1; the wire format must be a JSON boolean
    // (the Go engine's LifecycleStateSync.Sleeping is a bool).
    expect(sentRecord.sleeping).toBe(true);
    expect(sentRecord.exhaustion).toBe(0.45);
    expect(sentRecord.inner_monologue).toBe('["local thought"]');
  }, 15000);
});
