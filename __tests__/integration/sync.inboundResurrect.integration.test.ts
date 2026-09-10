/**
 * Inbound-resurrect over a local tombstone (4-1, kept from the old phase).
 *
 * Scenario (D29-shaped engine payload): a local tombstone sits INSIDE the
 * pre-GC window (its `deleted_at` is NOT older than the finalize session's
 * start, so `cleanupSoftDeletedRecords` keeps it). The server then pushes a
 * LIVE row for the same id carrying `deleted_at: null` with a newer
 * `updated_at`. `applyBufferedSyncData` — the REAL apply path — must LWW-update
 * the tombstoned row, clearing `deleted_at` and making the entity live again.
 *
 * This mirrors the personaCascade suite's harness (mock-server protocol round),
 * but exercises the resurrect branch instead of the purge branch. The purge
 * eligibility regression itself stays locked by
 * `sync.personaCascade.integration.test.ts:251-279` (untouched).
 */

import {SyncService} from '../../src/services/SyncService';
import type {NodeDatabase} from '../../src/database/__test_utils__/nodeDatabase';
import {createInMemoryDatabase} from '../../src/database/__test_utils__/testDatabase';
import {runMigrations} from '../../src/database/migrations';
import {resetSyncServiceSingleton} from './helpers/resetSyncService';
import {HarmonyLinkMockServer} from './helpers/HarmonyLinkMockServer';
import {sampleEntity} from './helpers/fixtures';
import {runFullSync} from './helpers/runFullSync';
import {createUserPersona, getUserEntities} from '../../src/database/repositories/userEntities';
import {getEntity} from '../../src/database/repositories/entities';

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

describe('inbound resurrect over a local tombstone (4-1)', () => {
  let db: NodeDatabase;
  let mockServer: HarmonyLinkMockServer;
  let syncService: SyncService;

  beforeEach(async () => {
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
    if (db) {
      await db.close();
    }
  });

  it('applyBufferedSyncData resurrects a local pre-GC-window tombstone via deleted_at: null', async () => {
    const resurrect = await createUserPersona({
      name: 'Resurrect Me',
      avatar: {image_data: 'cHJpbWFyeQ==', mime_type: 'image/png'},
    });
    // A second persona whose tombstone is NOT resurrected — proves the
    // pre-GC-window tombstone SURVIVES the finalize GC in the same sync.
    const survivor = await createUserPersona({
      name: 'Stay Dead',
      avatar: {image_data: 'cHJpbWFyeQ==', mime_type: 'image/png'},
    });
    const entity = await getEntity(resurrect.id);
    const profileId = entity!.character_profile_id!;

    // ── Local tombstones INSIDE the pre-GC window ─────────────────────────
    // `deleted_at` is 1h in the FUTURE relative to the upcoming sync's session
    // start, so the finalize-GC predicate (deleted_at < session start, both in
    // seconds) keeps both rows — exactly the "spent-propagation-record not yet
    // eligible" window. (Direct UPDATE because repo deleteEntity stamps `now`,
    // which would land BEFORE the session start and be purge-eligible.)
    const tombstoneAt = new Date(Date.now() + 3600000).toISOString();
    for (const id of [resurrect.id, survivor.id]) {
      await db.executeSql(
        'UPDATE entities SET deleted_at = ?, updated_at = ? WHERE id = ?',
        [tombstoneAt, tombstoneAt, id],
      );
    }
    expect((await getEntity(resurrect.id, true))!.deleted_at).not.toBeNull();
    expect((await getEntity(survivor.id, true))!.deleted_at).not.toBeNull();
    // Both hidden from the live getter.
    expect(await getEntity(resurrect.id)).toBeNull();

    // ── Server pushes a LIVE row for `resurrect` only ─────────────────────
    // D29-shaped payload: ALWAYS carries the `deleted_at` key (here: null)
    // with an updated_at bump strictly newer than the tombstone's. Timestamps
    // are ISO STRINGS (wire payloads are JSON — never Date objects).
    const liveAt = new Date(Date.now() + 7200000).toISOString();
    mockServer.setServerData('entities', [
      sampleEntity({
        id: resurrect.id,
        alias: resurrect.id,
        character_profile_id: profileId,
        lifecycle_config: '{}',
        created_at: entity!.created_at.toISOString(),
        updated_at: liveAt,
        deleted_at: null,
      }),
    ]);
    mockServer.startAutoResponder();

    await runFullSync(syncService);
    await new Promise(r => setTimeout(r, 200));

    // ── Assertions ────────────────────────────────────────────────────────
    // (a) The tombstoned row is LIVE again — deleted_at cleared by the
    // applyBufferedSyncData LWW update, visible to the live getter.
    const live = await getEntity(resurrect.id);
    expect(live).not.toBeNull();
    expect(live!.deleted_at).toBeNull();
    // (b) The pre-GC-window tombstone WITHOUT an inbound live row survived the
    // finalize GC — still soft-deleted, still hidden from the live getter.
    const stillGone = await getEntity(survivor.id, true);
    expect(stillGone).not.toBeNull();
    expect(stillGone!.deleted_at).not.toBeNull();
    expect(await getEntity(survivor.id)).toBeNull();
    // (c) The live list surfaces the resurrected entity, not the survivor.
    const liveIds = (await getUserEntities()).map(p => p.id);
    expect(liveIds).toContain(resurrect.id);
    expect(liveIds).not.toContain(survivor.id);
  }, 20000);
});