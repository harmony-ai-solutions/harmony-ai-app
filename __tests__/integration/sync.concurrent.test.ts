/**
 * Concurrent Sync Session Integration Tests
 *
 * Verifies that SyncService correctly serializes sync requests:
 *  - Second sync is rejected (silently skipped) while one is in progress
 *  - Subsequent sync succeeds after current sync completes
 *
 * Note: SyncService.initiateSync() currently returns void — when a sync is already
 * in progress, it logs "Sync already in progress, skipping" and returns without
 * throwing. The guard is at lines 265-268 of SyncService.ts.
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
describe('sync concurrent sessions', () => {
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
  // Test 1: Rejects (silently skips) a second sync while one is in progress
  // -------------------------------------------------------------------------
  it('silently skips second sync while one is in progress', async () => {
    // Use manual mode so we can control when the first sync completes
    mockServer.setManualMode(true);
    mockServer.startAutoResponder();

    // Start first sync — manual mode means the server won't auto-respond
    syncService.initiateSync();
    await new Promise(r => setTimeout(r, 100));

    // Verify first SYNC_REQUEST was sent
    const syncRequestsSent = mockServer.receivedEvents.filter(
      (e: any) => e.event_type === 'SYNC_REQUEST',
    );
    expect(syncRequestsSent.length).toBe(1);

    // The session starts as 'pending' until SYNC_ACCEPT is received.
    // Transition it to 'in_progress' manually to test the concurrent guard.
    // (In real life, SyncService.handleSyncAccept sets status to 'in_progress')
    const sessionId = (syncService as any).currentSession?.sessionId;
    expect(sessionId).toBeTruthy();
    (syncService as any).currentSession.status = 'in_progress';

    // Attempt second sync — should be silently skipped (guard: status === 'in_progress')
    await syncService.initiateSync();
    await new Promise(r => setTimeout(r, 100));

    // Verify: only one SYNC_REQUEST was sent (second was skipped)
    const syncRequestsAfter = mockServer.receivedEvents.filter(
      (e: any) => e.event_type === 'SYNC_REQUEST',
    );
    expect(syncRequestsAfter.length).toBe(1);

    // Clean up: null out the session directly (the afterEach teardown also handles this)
    (syncService as any).currentSession = null;
  }, 10000);

  // -------------------------------------------------------------------------
  // Test 2: Subsequent sync succeeds after current sync completes
  // -------------------------------------------------------------------------
  it('allows new sync after previous one completes', async () => {
    mockServer.startAutoResponder();

    // Run first sync to completion
    const firstCompleted = new Promise<void>(resolve => {
      syncService.once('sync:completed', () => resolve());
    });
    syncService.initiateSync();
    await firstCompleted;
    await new Promise(r => setTimeout(r, 200));

    // Verify session is cleaned up
    expect((syncService as any).currentSession).toBeNull();

    // Run second sync — should succeed
    const serverChar = sampleCharacter({
      id: 'char-concurrent-2',
      name: 'Second Sync Character',
      created_at: new Date(Date.now() - 5000).toISOString(),
      updated_at: new Date(Date.now() - 5000).toISOString(),
    });
    mockServer.setServerData('character_profiles', [serverChar]);

    const secondCompleted = new Promise<void>(resolve => {
      syncService.once('sync:completed', () => resolve());
    });
    syncService.initiateSync();
    await secondCompleted;
    await new Promise(r => setTimeout(r, 200));

    // VERIFY: Second sync's data was applied
    const [result] = await db.executeSql(
      "SELECT id, name FROM character_profiles WHERE id = 'char-concurrent-2'",
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows.item(0).name).toBe('Second Sync Character');
  }, 15000);
});
