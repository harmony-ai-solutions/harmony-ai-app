/**
 * Conflict Resolution Integration Tests
 *
 * Exercises the Last-Write-Wins (LWW) conflict strategy implemented in
 * SyncService.applyBufferedSyncData() (which mirrors src/database/sync.ts:applySyncRecord).
 *
 * Key behavior verified:
 *  - When server record has newer updated_at, server version wins
 *  - When client record has newer updated_at, client version is preserved
 *  - Soft-delete operations always apply (no LWW check)
 */

import {SyncService} from '../../src/services/SyncService';
import type {NodeDatabase} from '../../src/database/__test_utils__/nodeDatabase';
import {createInMemoryDatabase} from '../../src/database/__test_utils__/testDatabase';
import {runMigrations} from '../../src/database/migrations';
import {resetSyncServiceSingleton} from './helpers/resetSyncService';
import {HarmonyLinkMockServer} from './helpers/HarmonyLinkMockServer';
import {sampleCharacter} from './helpers/fixtures';
import {runFullSync} from './helpers/runFullSync';

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
describe('sync conflict resolution (LWW)', () => {
  let db: NodeDatabase;
  let mockServer: HarmonyLinkMockServer;
  let syncService: SyncService;

  beforeEach(async () => {
    const setup = await setupTest();
    db = setup.db;
    mockServer = setup.mockServer;
    syncService = setup.syncService;

    // Clear AsyncStorage
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
  });

  afterEach(async () => {
    await teardownTest(db, syncService, mockServer);
  });

  // -------------------------------------------------------------------------
  // Test 1: Server overwrites client when server timestamp is newer
  // -------------------------------------------------------------------------
  it('server overwrites client when server timestamp is newer (LWW)', async () => {
    // Seed local DB with a character at an old timestamp
    const oldTimestamp = new Date(Date.now() - 5000).toISOString();
    const localChar = sampleCharacter({
      id: 'char-conflict-1',
      name: 'Local Name',
      description: 'Local description',
      created_at: oldTimestamp,
      updated_at: oldTimestamp,
    });
    await db.executeSql(
      `INSERT INTO character_profiles (id, name, description, personality, appearance, backstory, voice_characteristics, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        localChar.id, localChar.name, localChar.description,
        localChar.personality, localChar.appearance, localChar.backstory,
        localChar.voice_characteristics, localChar.created_at,
        localChar.updated_at, localChar.deleted_at,
      ],
    );

    // Verify seed
    const [seedResult] = await db.executeSql(
      "SELECT name FROM character_profiles WHERE id = 'char-conflict-1'",
    );
    expect(seedResult.rows.item(0).name).toBe('Local Name');

    // Server has same record with newer timestamp
    const serverTimestamp = new Date(Date.now() - 1000).toISOString();
    const serverChar = sampleCharacter({
      id: 'char-conflict-1',
      name: 'Server Name',
      description: 'Server description',
      created_at: oldTimestamp,
      updated_at: serverTimestamp, // newer
    });
    mockServer.setServerData('character_profiles', [serverChar]);
    mockServer.startAutoResponder();

    // Run full sync
    await runFullSync(syncService);
    // Allow buffered data application to settle
    await new Promise(r => setTimeout(r, 200));

    // VERIFY: Server version won (newer timestamp)
    const [result] = await db.executeSql(
      "SELECT name, description FROM character_profiles WHERE id = 'char-conflict-1'",
    );
    expect(result.rows.item(0).name).toBe('Server Name');
    expect(result.rows.item(0).description).toBe('Server description');
  }, 15000);

  // -------------------------------------------------------------------------
  // Test 2: Client overwrites server when client timestamp is newer
  // -------------------------------------------------------------------------
  it('client version preserved when client timestamp is newer (LWW)', async () => {
    // Seed local DB with a character at a RECENT timestamp
    const recentTimestamp = new Date(Date.now() - 1000).toISOString();
    const localChar = sampleCharacter({
      id: 'char-conflict-2',
      name: 'Local Newer Name',
      description: 'Local newer description',
      created_at: new Date(Date.now() - 20000).toISOString(),
      updated_at: recentTimestamp, // newer
    });
    await db.executeSql(
      `INSERT INTO character_profiles (id, name, description, personality, appearance, backstory, voice_characteristics, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        localChar.id, localChar.name, localChar.description,
        localChar.personality, localChar.appearance, localChar.backstory,
        localChar.voice_characteristics, localChar.created_at,
        localChar.updated_at, localChar.deleted_at,
      ],
    );

    // Server has same record with OLDER timestamp
    const oldTimestamp = new Date(Date.now() - 5000).toISOString();
    const serverChar = sampleCharacter({
      id: 'char-conflict-2',
      name: 'Server Older Name',
      description: 'Server older description',
      created_at: new Date(Date.now() - 20000).toISOString(),
      updated_at: oldTimestamp, // older than client's
    });
    mockServer.setServerData('character_profiles', [serverChar]);
    mockServer.startAutoResponder();

    // Run full sync
    await runFullSync(syncService);
    await new Promise(r => setTimeout(r, 200));

    // VERIFY: Client version preserved (local timestamp is newer, so LWW keeps local)
    const [result] = await db.executeSql(
      "SELECT name, description FROM character_profiles WHERE id = 'char-conflict-2'",
    );
    expect(result.rows.item(0).name).toBe('Local Newer Name');
    expect(result.rows.item(0).description).toBe('Local newer description');
  }, 15000);

  // -------------------------------------------------------------------------
  // Test 3: Soft-deleted record on server overrides local update
  // -------------------------------------------------------------------------
  it('server soft-delete overrides local update (delete always wins)', async () => {
    // Seed local DB with a non-deleted record
    const localChar = sampleCharacter({
      id: 'char-conflict-3',
      name: 'About To Be Deleted',
      description: 'This will be deleted by server',
      created_at: new Date(Date.now() - 20000).toISOString(),
      updated_at: new Date(Date.now() - 1000).toISOString(), // recently updated
    });
    await db.executeSql(
      `INSERT INTO character_profiles (id, name, description, personality, appearance, backstory, voice_characteristics, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        localChar.id, localChar.name, localChar.description,
        localChar.personality, localChar.appearance, localChar.backstory,
        localChar.voice_characteristics, localChar.created_at,
        localChar.updated_at, localChar.deleted_at,
      ],
    );

    // Server sends a delete operation for the same record.
    // Use a FUTURE deleted_at so cleanupSoftDeletedRecords doesn't hard-delete it
    // (cleanup only removes records where deleted_at < sessionStartTime).
    const deleteTimestamp = new Date(Date.now() + 3600000).toISOString();
    const serverDelete = sampleCharacter({
      id: 'char-conflict-3',
      name: 'Deleted By Server',
      description: 'Server version',
      updated_at: deleteTimestamp,
      deleted_at: deleteTimestamp, // signals soft-delete
    });
    mockServer.setServerData('character_profiles', [serverDelete]);
    mockServer.startAutoResponder();

    // Run full sync
    await runFullSync(syncService);
    await new Promise(r => setTimeout(r, 200));

    // VERIFY: Record has been soft-deleted (deleted_at is set)
    const [result] = await db.executeSql(
      "SELECT deleted_at, name FROM character_profiles WHERE id = 'char-conflict-3'",
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows.item(0).deleted_at).toBeTruthy();
  }, 15000);
});
