/**
 * Name-Clash Resolution Integration Tests
 *
 * Exercises the SyncService name-clash flow added to
 * `applyBufferedSyncData()`: when an incoming server record's unique `name`
 * (module config tables only) collides with a DIFFERENT local row's name, the
 * sync pauses and emits `sync:nameclash`; the UI resolves via
 * `resolveNameClash(resolution, applyToAll)`:
 *
 *  - overwrite: adopt the server record's id + values, remap local references
 *  - keep:      keep the local values, but still adopt the server id + remap
 *  - rename:    rename the local entry ("X (unix)"), then insert the server row
 *
 * `applyToAll` memorizes the decision for every other clash in the SAME sync
 * session only (never persisted across sessions).
 */

import {SyncService} from '../../src/services/SyncService';
import ConnectionStateManager from '../../src/services/ConnectionStateManager';
import type {NodeDatabase} from '../../src/database/__test_utils__/nodeDatabase';
import {createInMemoryDatabase} from '../../src/database/__test_utils__/testDatabase';
import {runMigrations} from '../../src/database/migrations';
import {resetSyncServiceSingleton} from './helpers/resetSyncService';
import {HarmonyLinkMockServer} from './helpers/HarmonyLinkMockServer';
import {
  sampleBackendConfig,
  sampleProviderConfigSoulbitsCloud,
  sampleSTTConfig,
  sampleVisionConfig,
} from './helpers/fixtures';
import {runFullSync} from './helpers/runFullSync';

// ---------------------------------------------------------------------------
// Module-level mutable refs used by hoisted jest.mock calls
// ---------------------------------------------------------------------------
const testDbRef: {current: NodeDatabase | null} = {current: null};
const mockServerRef: {current: HarmonyLinkMockServer | null} = {current: null};

// ---------------------------------------------------------------------------
// Mock native modules (same as sync.conflict.test.ts)
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
    (syncService as any).pendingNameClash = null;
  }
  mockServer.reset();
  testDbRef.current = null;
  mockServerRef.current = null;
  if (db) {
    await db.close();
  }
}

// ---------------------------------------------------------------------------
// Seeding helpers
// ---------------------------------------------------------------------------
async function seedBackendConfig(
  db: NodeDatabase,
  row: {id: string; name: string; provider_config_id: string; updated_at: string},
): Promise<void> {
  await db.executeSql(
    `INSERT INTO backend_configs (id, name, provider, provider_config_id, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.name,
      'soulbitscloud',
      row.provider_config_id,
      row.updated_at,
      row.updated_at,
      null,
    ],
  );
}

async function seedEntityAndMapping(
  db: NodeDatabase,
  entityId: string,
  backendConfigId: string,
  ts: string,
): Promise<void> {
  await db.executeSql(
    `INSERT INTO entities (id, alias, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?)`,
    [entityId, '', ts, ts, null],
  );
  await db.executeSql(
    `INSERT INTO entity_module_mappings (entity_id, backend_config_id, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?)`,
    [entityId, backendConfigId, ts, ts, null],
  );
}

async function seedProviderConfig(
  db: NodeDatabase,
  row: {id: string; name: string; model: string; updated_at: string},
): Promise<void> {
  await db.executeSql(
    `INSERT INTO provider_config_soulbitscloud
       (id, name, base_url, api_key, model, max_tokens, temperature, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.name,
      'https://api.soulbits.app',
      '',
      row.model,
      4096,
      0.7,
      row.updated_at,
      row.updated_at,
      null,
    ],
  );
}

async function seedSTTConfig(
  db: NodeDatabase,
  row: {
    id: string;
    name: string;
    transcriptionProviderId: string;
    vadProviderId: string;
    updated_at: string;
  },
): Promise<void> {
  await db.executeSql(
    `INSERT INTO stt_configs
       (id, name, transcription_provider, transcription_provider_config_id,
        vad_provider, vad_provider_config_id, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.name,
      'soulbitscloud',
      row.transcriptionProviderId,
      'soulbitscloud',
      row.vadProviderId,
      row.updated_at,
      row.updated_at,
      null,
    ],
  );
}

// ---------------------------------------------------------------------------
// Driving helpers
// ---------------------------------------------------------------------------

/** Start a sync and resolve with the FIRST emitted name clash. */
function startSyncAndCaptureClash(syncService: SyncService): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('sync:nameclash never emitted')),
      10_000,
    );
    const onClash = (clash: any) => {
      clearTimeout(timeout);
      syncService.removeListener('sync:nameclash', onClash);
      resolve(clash);
    };
    syncService.once('sync:nameclash', onClash);
    syncService.initiateSync().catch((err: unknown) => {
      clearTimeout(timeout);
      syncService.removeListener('sync:nameclash', onClash);
      reject(err);
    });
  });
}

/** Wait for the sync round-trip to complete (or fail). */
function waitForSyncComplete(
  syncService: SyncService,
  timeoutMs: number = 10_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('sync did not complete in time')),
      timeoutMs,
    );
    const cleanup = () => {
      clearTimeout(timeout);
      syncService.removeListener('sync:completed', onComplete);
      syncService.removeListener('sync:error', onError);
    };
    const onComplete = () => {
      cleanup();
      resolve();
    };
    const onError = (err: string) => {
      cleanup();
      reject(new Error(err));
    };
    syncService.once('sync:completed', onComplete);
    syncService.once('sync:error', onError);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('sync name-clash resolution', () => {
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

  // -------------------------------------------------------------------------
  // Overwrite
  // -------------------------------------------------------------------------
  it('overwrite adopts the server id + values and remaps local references', async () => {
    const localTs = new Date(Date.now() - 60_000).toISOString();
    await seedBackendConfig(db, {
      id: 'local-backend',
      name: 'Default SoulbitsCloud',
      provider_config_id: 'local-prov',
      updated_at: localTs,
    });
    await seedEntityAndMapping(db, 'local-entity', 'local-backend', localTs);

    const serverTs = new Date(Date.now() - 1_000).toISOString();
    mockServer.setServerData('backend_configs', [
      sampleBackendConfig({
        id: 'server-backend',
        name: 'Default SoulbitsCloud',
        provider_config_id: 'server-prov',
        created_at: serverTs,
        updated_at: serverTs,
      }),
    ]);
    mockServer.startAutoResponder();

    const clash = await startSyncAndCaptureClash(syncService);
    expect(clash).toMatchObject({
      table: 'backend_configs',
      name: 'Default SoulbitsCloud',
      localId: 'local-backend',
      incomingId: 'server-backend',
    });

    await syncService.resolveNameClash('overwrite', false);
    await waitForSyncComplete(syncService);
    await new Promise(r => setTimeout(r, 200));

    // Server id adopted with server values
    const [adopted] = await db.executeSql(
      "SELECT id, name, provider_config_id FROM backend_configs WHERE id = 'server-backend'",
    );
    expect(adopted.rows.length).toBe(1);
    expect(adopted.rows.item(0).name).toBe('Default SoulbitsCloud');
    expect(adopted.rows.item(0).provider_config_id).toBe('server-prov');

    // Old local id is gone
    const [oldRow] = await db.executeSql(
      "SELECT id FROM backend_configs WHERE id = 'local-backend'",
    );
    expect(oldRow.rows.length).toBe(0);

    // Local reference remapped to the adopted id
    const [mapping] = await db.executeSql(
      "SELECT backend_config_id FROM entity_module_mappings WHERE entity_id = 'local-entity'",
    );
    expect(mapping.rows.item(0).backend_config_id).toBe('server-backend');
  }, 15_000);

  // -------------------------------------------------------------------------
  // Keep
  // -------------------------------------------------------------------------
  it('keep preserves local values but still adopts the server id + remaps', async () => {
    const localTs = new Date(Date.now() - 60_000).toISOString();
    await seedBackendConfig(db, {
      id: 'local-backend',
      name: 'Default SoulbitsCloud',
      provider_config_id: 'local-prov',
      updated_at: localTs,
    });
    await seedEntityAndMapping(db, 'local-entity', 'local-backend', localTs);

    const serverTs = new Date(Date.now() - 1_000).toISOString();
    mockServer.setServerData('backend_configs', [
      sampleBackendConfig({
        id: 'server-backend',
        name: 'Default SoulbitsCloud',
        provider_config_id: 'server-prov',
        created_at: serverTs,
        updated_at: serverTs,
      }),
    ]);
    mockServer.startAutoResponder();

    await startSyncAndCaptureClash(syncService);
    await syncService.resolveNameClash('keep', false);
    await waitForSyncComplete(syncService);
    await new Promise(r => setTimeout(r, 200));

    // Id adopted, but LOCAL values preserved; provider_config_id is re-pointed
    // at the SERVER's provider config so the re-sent record references an id
    // that exists on the engine too.
    const [adopted] = await db.executeSql(
      "SELECT id, provider_config_id FROM backend_configs WHERE id = 'server-backend'",
    );
    expect(adopted.rows.length).toBe(1);
    expect(adopted.rows.item(0).provider_config_id).toBe('server-prov');

    const [oldRow] = await db.executeSql(
      "SELECT id FROM backend_configs WHERE id = 'local-backend'",
    );
    expect(oldRow.rows.length).toBe(0);

    const [mapping] = await db.executeSql(
      "SELECT backend_config_id FROM entity_module_mappings WHERE entity_id = 'local-entity'",
    );
    expect(mapping.rows.item(0).backend_config_id).toBe('server-backend');
  }, 15_000);

  // -------------------------------------------------------------------------
  // Rename
  // -------------------------------------------------------------------------
  it('rename keeps the local id (renamed) and inserts the server entry', async () => {
    const localTs = new Date(Date.now() - 60_000).toISOString();
    await seedBackendConfig(db, {
      id: 'local-backend',
      name: 'Default SoulbitsCloud',
      provider_config_id: 'local-prov',
      updated_at: localTs,
    });
    await seedEntityAndMapping(db, 'local-entity', 'local-backend', localTs);

    const serverTs = new Date(Date.now() - 1_000).toISOString();
    mockServer.setServerData('backend_configs', [
      sampleBackendConfig({
        id: 'server-backend',
        name: 'Default SoulbitsCloud',
        provider_config_id: 'server-prov',
        created_at: serverTs,
        updated_at: serverTs,
      }),
    ]);
    mockServer.startAutoResponder();

    await startSyncAndCaptureClash(syncService);
    await syncService.resolveNameClash('rename', false);
    await waitForSyncComplete(syncService);
    await new Promise(r => setTimeout(r, 200));

    // Local row kept its id but was renamed with a unix timestamp
    const [localRow] = await db.executeSql(
      "SELECT id, name FROM backend_configs WHERE id = 'local-backend'",
    );
    expect(localRow.rows.length).toBe(1);
    expect(localRow.rows.item(0).name).toMatch(/^Default SoulbitsCloud \(\d+\)$/);

    // Server row inserted under its own id with the original name
    const [serverRow] = await db.executeSql(
      "SELECT id, name FROM backend_configs WHERE id = 'server-backend'",
    );
    expect(serverRow.rows.length).toBe(1);
    expect(serverRow.rows.item(0).name).toBe('Default SoulbitsCloud');

    // Local reference still points at the (renamed) local id — no remap
    const [mapping] = await db.executeSql(
      "SELECT backend_config_id FROM entity_module_mappings WHERE entity_id = 'local-entity'",
    );
    expect(mapping.rows.item(0).backend_config_id).toBe('local-backend');
  }, 15_000);

  // -------------------------------------------------------------------------
  // Keep — the adopted record must be RE-SENT (final version)
  // -------------------------------------------------------------------------
  it('keep re-sends the adopted record with a bumped updated_at and the server provider_config_id', async () => {
    // Persist a sync watermark so the upload phase behaves like a real
    // incremental sync (local row created BEFORE the watermark → the kept
    // record is re-sent as an 'update').
    const lastSync = Math.floor(Date.now() / 1000) - 60;
    await ConnectionStateManager.setLastSync('selfhosted', lastSync);

    const localTs = new Date((lastSync - 60) * 1000).toISOString();
    await seedBackendConfig(db, {
      id: 'local-backend',
      name: 'Default SoulbitsCloud',
      provider_config_id: 'local-prov',
      updated_at: localTs,
    });
    await seedEntityAndMapping(db, 'local-entity', 'local-backend', localTs);

    const serverTs = new Date(Date.now() - 1_000).toISOString();
    mockServer.setServerData('backend_configs', [
      sampleBackendConfig({
        id: 'server-backend',
        name: 'Default SoulbitsCloud',
        provider_config_id: 'server-prov',
        created_at: serverTs,
        updated_at: serverTs,
      }),
    ]);
    mockServer.startAutoResponder();

    await startSyncAndCaptureClash(syncService);
    await syncService.resolveNameClash('keep', false);
    await waitForSyncComplete(syncService);
    await new Promise(r => setTimeout(r, 200));

    // The adopted row: server id + server provider_config_id (so the re-sent
    // record references an id that exists on the engine too) + bumped
    // updated_at (so it is detected as a local change for upload).
    const [adopted] = await db.executeSql(
      "SELECT id, provider_config_id, updated_at FROM backend_configs WHERE id = 'server-backend'",
    );
    expect(adopted.rows.length).toBe(1);
    expect(adopted.rows.item(0).provider_config_id).toBe('server-prov');
    expect(new Date(adopted.rows.item(0).updated_at).getTime()).toBeGreaterThan(
      new Date(localTs).getTime(),
    );

    // The kept record must be re-sent in the app's upload phase so the server
    // learns the kept (final) version.
    const resent = mockServer.receivedEvents.filter(
      (e: any) =>
        e.event_type === 'SYNC_DATA' &&
        e.payload?.table === 'backend_configs' &&
        e.payload?.record?.id === 'server-backend',
    );
    expect(resent.length).toBe(1);
    expect(resent[0].payload.operation).toBe('update');
    expect(resent[0].payload.record.provider_config_id).toBe('server-prov');
    expect(
      new Date(resent[0].payload.record.updated_at).getTime(),
    ).toBeGreaterThan(new Date(localTs).getTime());
  }, 15_000);

  // -------------------------------------------------------------------------
  // Keep — provider config cascade (the COMPLETE setup is preserved)
  // -------------------------------------------------------------------------
  it('keep renames the local provider config to the server id and re-sends it', async () => {
    const lastSync = Math.floor(Date.now() / 1000) - 60;
    await ConnectionStateManager.setLastSync('selfhosted', lastSync);

    const localTs = new Date((lastSync - 60) * 1000).toISOString();
    // Local provider config with a distinctive local value.
    await seedProviderConfig(db, {
      id: 'local-prov',
      name: 'Default SoulbitsCloud (Chat)',
      model: 'local-model',
      updated_at: localTs,
    });
    // Local module config referencing the local provider config.
    await seedBackendConfig(db, {
      id: 'local-backend',
      name: 'Default SoulbitsCloud',
      provider_config_id: 'local-prov',
      updated_at: localTs,
    });
    // A second, NON-clashing local module config that ALSO references the
    // local provider config — its reference must be re-pointed too.
    await seedBackendConfig(db, {
      id: 'local-other',
      name: 'Other Config',
      provider_config_id: 'local-prov',
      updated_at: localTs,
    });
    await seedEntityAndMapping(db, 'local-entity', 'local-backend', localTs);

    const serverTs = new Date(Date.now() - 1_000).toISOString();
    mockServer.setServerData('provider_config_soulbitscloud', [
      sampleProviderConfigSoulbitsCloud({
        id: 'server-prov',
        name: 'Default SoulbitsCloud (Chat)',
        model: 'server-model',
        created_at: serverTs,
        updated_at: serverTs,
      }),
    ]);
    mockServer.setServerData('backend_configs', [
      sampleBackendConfig({
        id: 'server-backend',
        name: 'Default SoulbitsCloud',
        provider_config_id: 'server-prov',
        created_at: serverTs,
        updated_at: serverTs,
      }),
    ]);
    mockServer.startAutoResponder();

    await startSyncAndCaptureClash(syncService);
    await syncService.resolveNameClash('keep', false);
    await waitForSyncComplete(syncService);
    await new Promise(r => setTimeout(r, 200));

    // The server provider config id now holds the LOCAL provider config row
    // (renamed: values + created_at preserved) with a bumped updated_at, so
    // the app's provider setup survives under the server id.
    const [merged] = await db.executeSql(
      "SELECT id, model, updated_at FROM provider_config_soulbitscloud WHERE id = 'server-prov'",
    );
    expect(merged.rows.length).toBe(1);
    expect(merged.rows.item(0).model).toBe('local-model');
    expect(new Date(merged.rows.item(0).updated_at).getTime()).toBeGreaterThan(
      new Date(localTs).getTime(),
    );

    // The old local provider config id is gone (the row was renamed).
    const [oldProv] = await db.executeSql(
      "SELECT id FROM provider_config_soulbitscloud WHERE id = 'local-prov'",
    );
    expect(oldProv.rows.length).toBe(0);

    // The kept module config references the server provider config.
    const [kept] = await db.executeSql(
      "SELECT provider_config_id FROM backend_configs WHERE id = 'server-backend'",
    );
    expect(kept.rows.item(0).provider_config_id).toBe('server-prov');

    // A non-clashing local module config that referenced the local provider
    // config was re-pointed at the server provider config too.
    const [other] = await db.executeSql(
      "SELECT provider_config_id FROM backend_configs WHERE id = 'local-other'",
    );
    expect(other.rows.item(0).provider_config_id).toBe('server-prov');

    // The merged provider config is RE-SENT in the upload phase so the engine
    // learns the app-local provider values.
    const resent = mockServer.receivedEvents.filter(
      (e: any) =>
        e.event_type === 'SYNC_DATA' &&
        e.payload?.table === 'provider_config_soulbitscloud' &&
        e.payload?.record?.id === 'server-prov',
    );
    expect(resent.length).toBe(1);
    expect(resent[0].payload.record.model).toBe('local-model');
    expect(
      new Date(resent[0].payload.record.updated_at).getTime(),
    ).toBeGreaterThan(new Date(localTs).getTime());
  }, 15_000);

  // -------------------------------------------------------------------------
  // Keep — stt_configs cascades BOTH provider references (transcription + VAD)
  // -------------------------------------------------------------------------
  it('keep cascades BOTH stt_configs provider references (transcription + vad) to the server ids and re-sends them', async () => {
    const lastSync = Math.floor(Date.now() / 1000) - 60;
    await ConnectionStateManager.setLastSync('selfhosted', lastSync);

    const localTs = new Date((lastSync - 60) * 1000).toISOString();
    // Local provider configs for both stt streams, each with a distinctive
    // local value.
    await seedProviderConfig(db, {
      id: 'local-transcription-prov',
      name: 'Default SoulbitsCloud (STT Transcription)',
      model: 'local-tts-model',
      updated_at: localTs,
    });
    await seedProviderConfig(db, {
      id: 'local-vad-prov',
      name: 'Default SoulbitsCloud (STT VAD)',
      model: 'local-vad-model',
      updated_at: localTs,
    });
    // Local stt_configs referencing both provider configs.
    await seedSTTConfig(db, {
      id: 'local-stt',
      name: 'Default SoulbitsCloud',
      transcriptionProviderId: 'local-transcription-prov',
      vadProviderId: 'local-vad-prov',
      updated_at: localTs,
    });

    const serverTs = new Date(Date.now() - 1_000).toISOString();
    mockServer.setServerData('provider_config_soulbitscloud', [
      sampleProviderConfigSoulbitsCloud({
        id: 'server-transcription-prov',
        name: 'Default SoulbitsCloud (STT Transcription)',
        model: 'server-tts-model',
        created_at: serverTs,
        updated_at: serverTs,
      }),
      sampleProviderConfigSoulbitsCloud({
        id: 'server-vad-prov',
        name: 'Default SoulbitsCloud (STT VAD)',
        model: 'server-vad-model',
        created_at: serverTs,
        updated_at: serverTs,
      }),
    ]);
    mockServer.setServerData('stt_configs', [
      sampleSTTConfig({
        id: 'server-stt',
        name: 'Default SoulbitsCloud',
        transcription_provider_config_id: 'server-transcription-prov',
        vad_provider_config_id: 'server-vad-prov',
        created_at: serverTs,
        updated_at: serverTs,
      }),
    ]);
    mockServer.startAutoResponder();

    await startSyncAndCaptureClash(syncService);
    await syncService.resolveNameClash('keep', false);
    await waitForSyncComplete(syncService);
    await new Promise(r => setTimeout(r, 200));

    // Both local provider configs renamed to the server ids, keeping the
    // LOCAL values + a bumped updated_at.
    const [tx] = await db.executeSql(
      "SELECT id, model, updated_at FROM provider_config_soulbitscloud WHERE id = 'server-transcription-prov'",
    );
    expect(tx.rows.length).toBe(1);
    expect(tx.rows.item(0).model).toBe('local-tts-model');
    expect(new Date(tx.rows.item(0).updated_at).getTime()).toBeGreaterThan(
      new Date(localTs).getTime(),
    );
    const [vad] = await db.executeSql(
      "SELECT id, model, updated_at FROM provider_config_soulbitscloud WHERE id = 'server-vad-prov'",
    );
    expect(vad.rows.length).toBe(1);
    expect(vad.rows.item(0).model).toBe('local-vad-model');

    // Old local provider ids gone.
    const [oldTx] = await db.executeSql(
      "SELECT id FROM provider_config_soulbitscloud WHERE id = 'local-transcription-prov'",
    );
    const [oldVad] = await db.executeSql(
      "SELECT id FROM provider_config_soulbitscloud WHERE id = 'local-vad-prov'",
    );
    expect(oldTx.rows.length).toBe(0);
    expect(oldVad.rows.length).toBe(0);

    // The kept stt_configs references BOTH server provider ids.
    const [stt] = await db.executeSql(
      "SELECT transcription_provider_config_id, vad_provider_config_id FROM stt_configs WHERE id = 'server-stt'",
    );
    expect(stt.rows.length).toBe(1);
    expect(stt.rows.item(0).transcription_provider_config_id).toBe('server-transcription-prov');
    expect(stt.rows.item(0).vad_provider_config_id).toBe('server-vad-prov');

    // Both provider configs re-sent so the engine learns the app-local values.
    const resentTx = mockServer.receivedEvents.filter(
      (e: any) =>
        e.event_type === 'SYNC_DATA' &&
        e.payload?.table === 'provider_config_soulbitscloud' &&
        e.payload?.record?.id === 'server-transcription-prov',
    );
    expect(resentTx.length).toBe(1);
    expect(resentTx[0].payload.record.model).toBe('local-tts-model');

    const resentVad = mockServer.receivedEvents.filter(
      (e: any) =>
        e.event_type === 'SYNC_DATA' &&
        e.payload?.table === 'provider_config_soulbitscloud' &&
        e.payload?.record?.id === 'server-vad-prov',
    );
    expect(resentVad.length).toBe(1);
    expect(resentVad[0].payload.record.model).toBe('local-vad-model');
  }, 15_000);
  it('rename avoids colliding with an existing renamed-looking name', async () => {
    const localTs = new Date(Date.now() - 60_000).toISOString();
    await seedBackendConfig(db, {
      id: 'local-backend',
      name: 'Default SoulbitsCloud',
      provider_config_id: 'local-prov',
      updated_at: localTs,
    });
    // A row that already has the exact name our rename would generate.
    const nowSeconds = Math.floor(Date.now() / 1000);
    await seedBackendConfig(db, {
      id: 'local-occupied',
      name: `Default SoulbitsCloud (${nowSeconds})`,
      provider_config_id: 'local-prov-2',
      updated_at: localTs,
    });

    const serverTs = new Date(Date.now() - 1_000).toISOString();
    mockServer.setServerData('backend_configs', [
      sampleBackendConfig({
        id: 'server-backend',
        name: 'Default SoulbitsCloud',
        provider_config_id: 'server-prov',
        created_at: serverTs,
        updated_at: serverTs,
      }),
    ]);
    mockServer.startAutoResponder();

    await startSyncAndCaptureClash(syncService);
    await syncService.resolveNameClash('rename', false);
    await waitForSyncComplete(syncService);
    await new Promise(r => setTimeout(r, 200));

    // The renamed local row must NOT collide with the pre-existing name.
    const [renamed] = await db.executeSql(
      "SELECT name FROM backend_configs WHERE id = 'local-backend'",
    );
    const renamedName = renamed.rows.item(0).name;
    expect(renamedName).not.toBe(`Default SoulbitsCloud (${nowSeconds})`);
    expect(renamedName).toMatch(/^Default SoulbitsCloud \(\d+\)/);

    // Both the occupied row and the server row still exist.
    const [occupied] = await db.executeSql(
      "SELECT id FROM backend_configs WHERE id = 'local-occupied'",
    );
    const [serverRow] = await db.executeSql(
      "SELECT id FROM backend_configs WHERE id = 'server-backend'",
    );
    expect(occupied.rows.length).toBe(1);
    expect(serverRow.rows.length).toBe(1);
  }, 15_000);

  // -------------------------------------------------------------------------
  // Apply to all — one decision, multiple clashes, single popup
  // -------------------------------------------------------------------------
  it('apply to all resolves every clash in the same sync with one decision', async () => {
    const localTs = new Date(Date.now() - 60_000).toISOString();
    await seedBackendConfig(db, {
      id: 'local-a',
      name: 'Config A',
      provider_config_id: 'local-a-prov',
      updated_at: localTs,
    });
    await seedBackendConfig(db, {
      id: 'local-b',
      name: 'Config B',
      provider_config_id: 'local-b-prov',
      updated_at: localTs,
    });

    const serverTs = new Date(Date.now() - 1_000).toISOString();
    mockServer.setServerData('backend_configs', [
      sampleBackendConfig({
        id: 'server-a',
        name: 'Config A',
        provider_config_id: 'server-a-prov',
        created_at: serverTs,
        updated_at: serverTs,
      }),
      sampleBackendConfig({
        id: 'server-b',
        name: 'Config B',
        provider_config_id: 'server-b-prov',
        created_at: serverTs,
        updated_at: serverTs,
      }),
    ]);
    mockServer.startAutoResponder();

    const emittedClashes: any[] = [];
    syncService.on('sync:nameclash', (c: any) => emittedClashes.push(c));

    const first = await startSyncAndCaptureClash(syncService);
    expect(first.name).toBe('Config A');

    await syncService.resolveNameClash('overwrite', true);
    await waitForSyncComplete(syncService);
    await new Promise(r => setTimeout(r, 200));

    // ONLY one popup for two clashes.
    expect(emittedClashes.length).toBe(1);

    // Both server ids adopted, both local ids gone.
    const [aRes] = await db.executeSql(
      "SELECT id FROM backend_configs WHERE id = 'server-a'",
    );
    const [bRes] = await db.executeSql(
      "SELECT id FROM backend_configs WHERE id = 'server-b'",
    );
    const [aOld] = await db.executeSql(
      "SELECT id FROM backend_configs WHERE id = 'local-a'",
    );
    const [bOld] = await db.executeSql(
      "SELECT id FROM backend_configs WHERE id = 'local-b'",
    );
    expect(aRes.rows.length).toBe(1);
    expect(bRes.rows.length).toBe(1);
    expect(aOld.rows.length).toBe(0);
    expect(bOld.rows.length).toBe(0);
  }, 15_000);

  // -------------------------------------------------------------------------
  // Session scope — decision must NOT leak into the next sync session
  // -------------------------------------------------------------------------
  it('does not carry the apply-to-all decision into the next sync session', async () => {
    const localTs = new Date(Date.now() - 60_000).toISOString();
    await seedBackendConfig(db, {
      id: 'local-a',
      name: 'Config A',
      provider_config_id: 'local-a-prov',
      updated_at: localTs,
    });

    const serverTs = new Date(Date.now() - 1_000).toISOString();
    mockServer.setServerData('backend_configs', [
      sampleBackendConfig({
        id: 'server-a',
        name: 'Config A',
        provider_config_id: 'server-a-prov',
        created_at: serverTs,
        updated_at: serverTs,
      }),
    ]);
    mockServer.startAutoResponder();

    // Session 1: resolve with apply-to-all.
    const clash1 = await startSyncAndCaptureClash(syncService);
    expect(clash1.name).toBe('Config A');
    await syncService.resolveNameClash('overwrite', true);
    await waitForSyncComplete(syncService);
    await new Promise(r => setTimeout(r, 200));

    // Session 2: a fresh clash appears; the app must prompt again.
    const clashTs = new Date(Date.now() + 5_000).toISOString();
    await seedBackendConfig(db, {
      id: 'local-c',
      name: 'Config C',
      provider_config_id: 'local-c-prov',
      updated_at: localTs,
    });
    mockServer.setServerData('backend_configs', [
      sampleBackendConfig({
        id: 'server-c',
        name: 'Config C',
        provider_config_id: 'server-c-prov',
        created_at: clashTs,
        updated_at: clashTs,
      }),
    ]);

    const clash2 = await startSyncAndCaptureClash(syncService);
    expect(clash2.name).toBe('Config C');
    await syncService.resolveNameClash('rename', false);
    await waitForSyncComplete(syncService);
    await new Promise(r => setTimeout(r, 200));

    const [cRes] = await db.executeSql(
      "SELECT id, name FROM backend_configs WHERE id = 'server-c'",
    );
    expect(cRes.rows.length).toBe(1);
    expect(cRes.rows.item(0).name).toBe('Config C');
  }, 20_000);

  // -------------------------------------------------------------------------
  // Same id → normal LWW update, no clash popup
  // -------------------------------------------------------------------------
  it('does not emit a name clash when the incoming id already exists (LWW path)', async () => {
    const localTs = new Date(Date.now() - 60_000).toISOString();
    await seedBackendConfig(db, {
      id: 'same-backend',
      name: 'Default SoulbitsCloud',
      provider_config_id: 'local-prov',
      updated_at: localTs,
    });

    const serverTs = new Date(Date.now() - 1_000).toISOString();
    mockServer.setServerData('backend_configs', [
      sampleBackendConfig({
        id: 'same-backend',
        name: 'Default SoulbitsCloud',
        provider_config_id: 'server-prov',
        created_at: localTs,
        updated_at: serverTs,
      }),
    ]);
    mockServer.startAutoResponder();

    const clashSpy = jest.fn();
    syncService.on('sync:nameclash', clashSpy);

    await runFullSync(syncService);
    await new Promise(r => setTimeout(r, 200));

    expect(clashSpy).not.toHaveBeenCalled();

    // Normal LWW: server wins because its updated_at is newer.
    const [res] = await db.executeSql(
      "SELECT provider_config_id FROM backend_configs WHERE id = 'same-backend'",
    );
    expect(res.rows.length).toBe(1);
    expect(res.rows.item(0).provider_config_id).toBe('server-prov');
  }, 15_000);

  // -------------------------------------------------------------------------
  // Non-unique-name table → both rows coexist, no popup
  // -------------------------------------------------------------------------
  it('never treats same-name records on non-unique tables as clashes', async () => {
    const localTs = new Date(Date.now() - 60_000).toISOString();
    // character_profiles.name is NOT unique (unlike the module config tables).
    await db.executeSql(
      `INSERT INTO character_profiles (id, name, vision_config_id, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['local-profile', 'Test Profile', null, localTs, localTs, null],
    );

    const serverTs = new Date(Date.now() - 1_000).toISOString();
    mockServer.setServerData('character_profiles', [
      {
        id: 'server-profile',
        name: 'Test Profile',
        vision_config_id: null,
        created_at: serverTs,
        updated_at: serverTs,
        deleted_at: null,
      },
    ]);
    mockServer.startAutoResponder();

    const clashSpy = jest.fn();
    syncService.on('sync:nameclash', clashSpy);

    await runFullSync(syncService);
    await new Promise(r => setTimeout(r, 200));

    expect(clashSpy).not.toHaveBeenCalled();

    const [res] = await db.executeSql(
      "SELECT id FROM character_profiles WHERE name = 'Test Profile'",
    );
    expect(res.rows.length).toBe(2);
  }, 15_000);

  // -------------------------------------------------------------------------
  // vision_configs is now a unique-name table → clash + character_profiles remap
  // -------------------------------------------------------------------------
  it('treats same-name vision_configs records as clashes and remaps character_profiles', async () => {
    const localTs = new Date(Date.now() - 60_000).toISOString();
    await db.executeSql(
      `INSERT INTO vision_configs (id, name, provider, provider_config_id, resolution_width, resolution_height, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['local-vision', 'Vision', 'soulbitscloud', 'local-prov', 640, 480, localTs, localTs, null],
    );
    // Local character profile that references the local vision config via the
    // vision_configs(id) FK — must be remapped when the clash is overwritten.
    await db.executeSql(
      `INSERT INTO character_profiles (id, name, vision_config_id, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['local-profile', 'Local Profile', 'local-vision', localTs, localTs, null],
    );

    const serverTs = new Date(Date.now() - 1_000).toISOString();
    mockServer.setServerData('vision_configs', [
      sampleVisionConfig({
        id: 'server-vision',
        name: 'Vision',
        provider_config_id: 'server-prov',
        created_at: serverTs,
        updated_at: serverTs,
      }),
    ]);
    mockServer.startAutoResponder();

    const clash = await startSyncAndCaptureClash(syncService);
    expect(clash).toMatchObject({
      table: 'vision_configs',
      name: 'Vision',
      localId: 'local-vision',
      incomingId: 'server-vision',
    });

    await syncService.resolveNameClash('overwrite', false);
    await waitForSyncComplete(syncService);
    await new Promise(r => setTimeout(r, 200));

    // Server id adopted with server values
    const [adopted] = await db.executeSql(
      "SELECT id, name, provider_config_id FROM vision_configs WHERE id = 'server-vision'",
    );
    expect(adopted.rows.length).toBe(1);
    expect(adopted.rows.item(0).name).toBe('Vision');
    expect(adopted.rows.item(0).provider_config_id).toBe('server-prov');

    // Old local id is gone
    const [oldRow] = await db.executeSql(
      "SELECT id FROM vision_configs WHERE id = 'local-vision'",
    );
    expect(oldRow.rows.length).toBe(0);

    // Local character_profiles reference remapped to the adopted id
    const [profile] = await db.executeSql(
      "SELECT vision_config_id FROM character_profiles WHERE id = 'local-profile'",
    );
    expect(profile.rows.length).toBe(1);
    expect(profile.rows.item(0).vision_config_id).toBe('server-vision');
  }, 15_000);
});
