/**
 * Per-table initial upload set (4-1, Q7 — app mirror).
 *
 * The engine tracks a per-device exchanged-table set (`sync_devices.synced_tables`,
 * 4-2). The app mirrors this with a persistent AsyncStorage set keyed by sync
 * source: tables not yet in the set are uploaded with `since = 0` (full) exactly
 * once; on SYNC_FINALIZE every registered table is marked done so subsequent
 * syncs are incremental. LWW apply makes any re-send harmless — the set exists
 * to avoid full re-uploads on every sync.
 *
 * This suite pins the persistence (ConnectionStateManager) and the per-table
 * since-resolution (`resolveTableSyncSince`).
 */

import {
  SyncService,
  resolveTableSyncSince,
  SYNC_TABLES,
  TABLE_ORDER,
} from '../SyncService';
import ConnectionStateManager from '../ConnectionStateManager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {EventEmitter} from 'eventemitter3';

let mockConnectionManager: EventEmitter & {sendEvent: jest.Mock; isConnected: jest.Mock};

// In-memory AsyncStorage so get/set actually round-trip.
const mockAsyncStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((key: string) => Promise.resolve(mockAsyncStore.get(key) ?? null)),
  setItem: jest.fn((key: string, val: string) => {
    mockAsyncStore.set(key, val);
    return Promise.resolve();
  }),
  removeItem: jest.fn((key: string) => {
    mockAsyncStore.delete(key);
    return Promise.resolve();
  }),
  clear: jest.fn(() => {
    mockAsyncStore.clear();
    return Promise.resolve();
  }),
}));

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock('../../database/connection', () => ({
  getDatabase: jest.fn(),
  getSyncDatabase: jest.fn().mockResolvedValue({
    transaction: jest.fn(),
  }),
}));

jest.mock('../../database/sync', () => ({
  toUnixTimestamp: jest.fn((v: any) => (typeof v === 'number' ? v : Date.parse(v))),
  getChangedRecords: jest.fn(() => Promise.resolve([])),
  cleanupOrphanEntityModuleMappings: jest.fn(() => Promise.resolve(0)),
  cleanupOrphanedMemories: jest.fn(() => Promise.resolve(0)),
  normalizeRecordTimestamps: jest.fn((r: any) => r),
}));

jest.mock('../EntityEmojiActionService', () => ({
  __esModule: true,
  default: {invalidateAllCaches: jest.fn()},
}));

jest.mock('../connection/ConnectionManager', () => {
  const {EventEmitter: EE} = require('eventemitter3');
  const cm: EventEmitter & {sendEvent: jest.Mock; isConnected: jest.Mock} = new EE();
  cm.sendEvent = jest.fn().mockResolvedValue(undefined);
  cm.isConnected = jest.fn().mockReturnValue(true);
  mockConnectionManager = cm;
  return {__esModule: true, default: cm};
});

describe('per-table initial upload set (4-1, Q7)', () => {
  beforeEach(() => {
    mockAsyncStore.clear();
    mockConnectionManager.removeAllListeners();
    jest.clearAllMocks();
  });

  describe('ConnectionStateManager persistence', () => {
    it('returns [] when no set has been persisted', async () => {
      const tables = await ConnectionStateManager.getInitialUploadDoneTables('selfhosted');
      expect(tables).toEqual([]);
    });

    it('persists and reads back a table set (JSON array)', async () => {
      await ConnectionStateManager.setInitialUploadDoneTables('selfhosted', [
        'entities',
        'conversation_messages',
      ]);
      const tables = await ConnectionStateManager.getInitialUploadDoneTables('selfhosted');
      expect(tables).toEqual(['entities', 'conversation_messages']);
    });

    it('keys the set per source (cloud vs selfhosted are independent)', async () => {
      await ConnectionStateManager.markTablesInitialUploadDone('selfhosted', ['entities']);
      await ConnectionStateManager.markTablesInitialUploadDone('cloud', ['character_profiles']);

      expect(await ConnectionStateManager.getInitialUploadDoneTables('selfhosted')).toEqual([
        'entities',
      ]);
      expect(await ConnectionStateManager.getInitialUploadDoneTables('cloud')).toEqual([
        'character_profiles',
      ]);
    });

    it('markTablesInitialUploadDone is idempotent (merges, no dupes)', async () => {
      await ConnectionStateManager.markTablesInitialUploadDone('selfhosted', [
        'entities',
        'entities',
        'conversation_messages',
      ]);
      const tables = await ConnectionStateManager.getInitialUploadDoneTables('selfhosted');
      expect(tables).toEqual(['entities', 'conversation_messages']);
    });
  });

  describe('resolveTableSyncSince', () => {
    it('a table NOT yet initial-uploaded resolves to since=0 (full upload)', () => {
      expect(resolveTableSyncSince('chat_conversation_settings', 12345, ['entities'])).toBe(0);
    });

    it('a table already initial-uploaded resolves to the incremental watermark', () => {
      expect(
        resolveTableSyncSince('entities', 12345, ['entities', 'conversation_messages']),
      ).toBe(12345);
    });

    it('an empty set forces every table to since=0', () => {
      expect(resolveTableSyncSince('conversation_messages', 999, [])).toBe(0);
    });

    it('a force-full-sync (lastSync=0) stays 0 for both done and pending tables', () => {
      expect(resolveTableSyncSince('entities', 0, ['entities'])).toBe(0);
      expect(resolveTableSyncSince('chat_conversation_settings', 0, ['entities'])).toBe(0);
    });
  });

  describe('SyncService registry', () => {
    it('exposes the same resolver used by the upload path', () => {
      expect(typeof resolveTableSyncSince).toBe('function');
      // Sanity: SyncService module imports resolve cleanly under the mocks.
      expect(SyncService).toBeTruthy();
    });
  });

  // Review fix — single source of truth: TABLE_ORDER must be DERIVED from
  // SYNC_TABLES so the two hand-maintained lists can never drift.
  describe('SYNC_TABLES / TABLE_ORDER derivation (single source of truth)', () => {
    it('every SYNC_TABLES entry has a positive rank in TABLE_ORDER', () => {
      for (const table of SYNC_TABLES) {
        expect(TABLE_ORDER[table]).toBeGreaterThan(0);
      }
    });

    it('ranks are strictly increasing along the SYNC_TABLES array (rank = index + 1)', () => {
      SYNC_TABLES.forEach((table, i) => {
        expect(TABLE_ORDER[table]).toBe(i + 1);
      });
      // Strictly increasing property (redundant with the above, but pins intent).
      let prev = 0;
      for (const table of SYNC_TABLES) {
        const rank = TABLE_ORDER[table];
        expect(rank).toBeGreaterThan(prev);
        prev = rank;
      }
    });

    it('pins the tier invariants (provider configs ... chat settings)', () => {
      const rank = (t: string) => TABLE_ORDER[t];
      const providerRanks = SYNC_TABLES.filter(t => t.startsWith('provider_config_')).map(rank);
      const maxProvider = Math.max(...providerRanks);
      expect(maxProvider).toBeLessThan(rank('backend_configs'));
      expect(rank('backend_configs')).toBeLessThan(rank('character_profiles'));
      expect(rank('character_profiles')).toBeLessThan(rank('entities'));
      expect(rank('entities')).toBeLessThan(rank('entity_module_mappings'));
      expect(rank('entity_module_mappings')).toBeLessThan(rank('interactions'));
      expect(rank('interactions')).toBeLessThan(rank('conversation_messages'));
      expect(rank('conversation_messages')).toBeLessThanOrEqual(
        rank('chat_conversation_settings'),
      );
    });
  });
});
