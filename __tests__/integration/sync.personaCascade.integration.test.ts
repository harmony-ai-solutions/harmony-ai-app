/**
 * Persona-cascade Sync Integration Tests (3-2-A, engine 1-2 parity).
 *
 * Simulates the engine's persona delete cascade (1-2) arriving over the sync
 * protocol: a single SYNC_DATA batch carrying tombstones for the persona's
 * `entities` row, its `character_profiles` row, and its `character_image`
 * rows. Proves the mock-server harness applies the tombstones AND that
 * `cleanupSoftDeletedRecords` purges them — no ghost rows remain.
 *
 * Two phases are pinned:
 *   - APPLY: tombstones land (rows soft-deleted, read surfaces exclude them).
 *   - PURGE: `cleanupSoftDeletedRecords` physically removes the tombstones.
 *     `entities.character_profile_id` is FK-RESTRICT-gated
 *     (migration 000002, ON DELETE RESTRICT) and `character_image` rides a
 *     CASCADE — the purge order is `entities` → `character_image` →
 *     `character_profiles` so a persona cascade is physically gone in ONE
 *     cycle (3-4 fix; previously `character_profiles` was iterated first and
 *     its purge was deferred one cycle by the still-present entity).
 */

import {SyncService} from '../../src/services/SyncService';
import type {NodeDatabase} from '../../src/database/__test_utils__/nodeDatabase';
import {createInMemoryDatabase} from '../../src/database/__test_utils__/testDatabase';
import {runMigrations} from '../../src/database/migrations';
import {resetSyncServiceSingleton} from './helpers/resetSyncService';
import {HarmonyLinkMockServer} from './helpers/HarmonyLinkMockServer';
import {sampleEntity, sampleCharacter} from './helpers/fixtures';
import {runFullSync} from './helpers/runFullSync';
import {createUserPersona, getUserEntities} from '../../src/database/repositories/userEntities';
import {
  createCharacterImage,
  getCharacterImage,
  getCharacterImages,
  getCharacterProfile,
  getAllCharacterProfiles,
} from '../../src/database/repositories/characters';
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

describe('persona-cascade sync (entity + profile + images)', () => {
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

  /** Create a persona with a primary avatar + a gallery image. */
  async function seedPersonaWithImages(name: string): Promise<{
    personaId: string;
    profileId: string;
    imageIds: string[];
  }> {
    const persona = await createUserPersona({
      name,
      avatar: {image_data: 'cHJpbWFyeQ==', mime_type: 'image/png'},
    });
    const entity = await getEntity(persona.id);
    const profileId = entity!.character_profile_id!;
    await createCharacterImage({
      character_profile_id: profileId,
      image_data: 'Z2FsbGVyeQ==',
      mime_type: 'image/jpeg',
      description: 'gallery',
      is_primary: false,
      display_order: 1,
      vl_model_interpretation: '',
      vl_model: '',
      updated_at: new Date(),
    });
    const images = await getCharacterImages(profileId);
    return {personaId: persona.id, profileId, imageIds: images.map(i => i.id)};
  }

  function seedCascadeTombstones(
    personaId: string,
    profileId: string,
    imageIds: string[],
    deletedAt: string,
  ): void {
    mockServer.setServerData('entities', [
      sampleEntity({
        id: personaId,
        alias: personaId,
        character_profile_id: profileId,
        lifecycle_config: '{}',
        deleted_at: deletedAt,
        updated_at: deletedAt,
      }),
    ]);
    mockServer.setServerData('character_profiles', [
      sampleCharacter({
        id: profileId,
        name: personaId,
        deleted_at: deletedAt,
        updated_at: deletedAt,
      }),
    ]);
    mockServer.setServerData(
      'character_image',
      imageIds.map(id => ({
        id,
        character_profile_id: profileId,
        deleted_at: deletedAt,
        updated_at: deletedAt,
        created_at: new Date(Date.now() - 60000).toISOString(),
      })),
    );
    mockServer.startAutoResponder();
  }

  it('applies entity + profile + image tombstones (soft-delete state) from one batch', async () => {
    const {personaId, profileId, imageIds} = await seedPersonaWithImages('Cascade Apply');
    expect((await getUserEntities()).some(p => p.id === personaId)).toBe(true);

    // Future deleted_at: cleanupSoftDeletedRecords keeps the rows so the test
    // can assert the tombstone APPLY state (soft-deleted but still present).
    const tombstoneAt = new Date(Date.now() + 3600000).toISOString();
    seedCascadeTombstones(personaId, profileId, imageIds, tombstoneAt);

    await runFullSync(syncService);
    await new Promise(r => setTimeout(r, 200));

    // (a) persona no longer returned by the persona list.
    expect((await getUserEntities()).some(p => p.id === personaId)).toBe(false);
    // (b) profile excluded from AI-partner surfaces.
    expect((await getAllCharacterProfiles()).some(p => p.id === profileId)).toBe(false);
    // (c) all three tables soft-deleted (visible only with includeDeleted).
    expect((await getEntity(personaId, true))!.deleted_at).not.toBeNull();
    expect((await getCharacterProfile(profileId, true))!.deleted_at).not.toBeNull();
    for (const imageId of imageIds) {
      expect((await getCharacterImage(imageId, true))!.deleted_at).not.toBeNull();
    }
    // Live image getter hides every tombstoned image.
    expect(await getCharacterImages(profileId)).toEqual([]);
  }, 20000);

  it('purges persona-cascade tombstones in ONE cycle — no ghost rows remain (3-4)', async () => {
    const {personaId, profileId, imageIds} = await seedPersonaWithImages('Cascade Purge');

    // Past deleted_at → cleanupSoftDeletedRecords purges after each sync.
    const tombstoneAt = new Date(Date.now() - 5000).toISOString();
    seedCascadeTombstones(personaId, profileId, imageIds, tombstoneAt);

    await runFullSync(syncService);
    await new Promise(r => setTimeout(r, 200));

    // Sync 1 ALONE physically purges all three tables: cleanup deletes
    // `entities` BEFORE `character_profiles` (3-4), so the RESTRICT FK no
    // longer defers the profile purge to a second cycle.
    expect(await getEntity(personaId, true)).toBeNull();
    expect(await getCharacterProfile(profileId, true)).toBeNull();
    for (const imageId of imageIds) {
      expect(await getCharacterImage(imageId, true)).toBeNull();
    }
    const countBy = async (table: string, id: string): Promise<number> => {
      const [res] = await db.executeSql(
        `SELECT COUNT(*) AS count FROM ${table} WHERE id = ?`,
        [id],
      );
      return res.rows.item(0).count;
    };
    expect(await countBy('entities', personaId)).toBe(0);
    expect(await countBy('character_profiles', profileId)).toBe(0);
    for (const imageId of imageIds) {
      expect(await countBy('character_image', imageId)).toBe(0);
    }

    // Read surfaces stay clean too.
    expect((await getUserEntities()).some(p => p.id === personaId)).toBe(false);
    expect((await getAllCharacterProfiles()).some(p => p.id === profileId)).toBe(false);
  }, 20000);
});