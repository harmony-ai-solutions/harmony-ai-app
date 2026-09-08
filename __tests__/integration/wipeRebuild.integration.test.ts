/**
 * Wipe & Rebuild integration tests (phase 3-2).
 *
 * After the one-time boot wipe (D61) the app holds an EMPTY database and the
 * first on-connect pull repopulates it from the already-migrated engine. These
 * tests pin:
 *
 *   1. The engine's `user` entity row INSERTs cleanly on that first sync —
 *      there is NO local seeder (production never creates the `user` row; it
 *      arrives via pull), so the pull is a simple insert-into-empty-DB — no
 *      LWW merge is possible or needed.
 *   2. The FIRST post-wipe sync escalates to `force_full_sync: true` via the
 *      cleared-watermark mechanism (SyncService.ts:505-517) — the wipe helper
 *      removed the per-source watermark, so `getLastSyncTimestamp()` returns 0
 *      and the engine re-sends everything.
 */

import {SyncService} from '../../src/services/SyncService';
import type {NodeDatabase} from '../../src/database/__test_utils__/nodeDatabase';
import {createInMemoryDatabase} from '../../src/database/__test_utils__/testDatabase';
import {runMigrations} from '../../src/database/migrations';
import {resetSyncServiceSingleton} from './helpers/resetSyncService';
import {HarmonyLinkMockServer} from './helpers/HarmonyLinkMockServer';
import {sampleEntity} from './helpers/fixtures';

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
// Helper: mock ConnectionManager that routes through the mock server
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
// Test suite
// ---------------------------------------------------------------------------
describe('wipe & rebuild first sync', () => {
  let db: NodeDatabase;
  let mockServer: HarmonyLinkMockServer;
  let syncService: SyncService;

  beforeEach(async () => {
    // Post-wipe state: AsyncStorage has no sync watermark (the wipe helper's
    // clearAllLastSyncTimestamps removed it) and the DB is empty.
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();

    db = createInMemoryDatabase();
    await runMigrations(db, true);
    testDbRef.current = db;

    mockServer = new HarmonyLinkMockServer();

    const mockCm = createMockConnectionManager(mockServer);
    resetSyncServiceSingleton();
    syncService = SyncService.getInstance();
    (syncService as any).connectionManager.removeAllListeners?.();
    (syncService as any).connectionManager = mockCm;
    (syncService as any).setupConnectionListeners();

    mockServerRef.current = mockServer;
  });

  afterEach(async () => {
    if (syncService) {
      syncService.removeAllListeners();
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

  it('engine `user` row inserts cleanly on first sync (no local seeder exists)', async () => {
    // The migrated engine sends the built-in `user` entity row on the full
    // pull. No local seeder creates it — the pull INSERTs it into the empty DB.
    const userRow = sampleEntity({
      id: 'user',
      alias: '',
      character_profile_id: null,
      lifecycle_config: '{}',
      entity_type: 'user',
      is_muted: 0,
      is_disabled: 0,
      created_at: new Date(Date.now() - 10000).toISOString(),
      updated_at: new Date(Date.now() - 10000).toISOString(),
    });
    mockServer.setServerData('entities', [userRow]);
    mockServer.startAutoResponder();

    const completedPromise = new Promise<void>(resolve =>
      syncService.on('sync:completed', () => resolve()),
    );
    syncService.initiateSync();
    await completedPromise;
    await new Promise(r => setTimeout(r, 300));

    // The user row is present, live, and carries the user entity_type.
    const [result] = await db.executeSql(
      "SELECT * FROM entities WHERE id = 'user'",
    );
    expect(result.rows.length).toBe(1);
    const row = result.rows.item(0);
    expect(row.id).toBe('user');
    expect(row.entity_type).toBe('user');
    expect(row.deleted_at).toBeNull();
  });

  it('first post-wipe initiateSync sends force_full_sync: true (cleared-watermark escalation)', async () => {
    mockServer.startAutoResponder();

    const completedPromise = new Promise<void>(resolve =>
      syncService.on('sync:completed', () => resolve()),
    );
    syncService.initiateSync();
    await completedPromise;
    await new Promise(r => setTimeout(r, 200));

    // The wiped client has no stored watermark → storedLastSync === 0 →
    // effectiveForceFullSync === true (SyncService.ts:505-517).
    const syncRequests = mockServer.receivedEvents.filter(
      (e: any) => e.event_type === 'SYNC_REQUEST',
    );
    expect(syncRequests.length).toBe(1);
    expect(syncRequests[0].payload.force_full_sync).toBe(true);
    expect(syncRequests[0].payload.last_sync_timestamp).toBe(0);
  });
});