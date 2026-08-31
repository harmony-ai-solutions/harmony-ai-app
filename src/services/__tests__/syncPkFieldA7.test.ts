/**
 * SyncService — A7 lifecycle_state PK symmetry (4-1).
 *
 * Pre-registry, the send-path ternaries keyed `lifecycle_state` by `id`
 * (SyncService.ts sendSyncDataWithConfirmation / handleIncomingSyncData)
 * while the apply path keyed it by `entity_id` — an asymmetry. Because
 * `lifecycle_state`'s real PK is `entity_id` (migration 000040), a server
 * round-trip keyed the row by a non-existent `id`, so the server-received
 * exclusion set never matched and the row was silently re-sent.
 *
 * After the registry: `getPkField('lifecycle_state')` === 'entity_id', so the
 * incoming record is keyed by its real PK everywhere.
 */

import {SyncService} from '../SyncService';
import {EventEmitter} from 'eventemitter3';

let mockConnectionManager: EventEmitter & {sendEvent: jest.Mock; isConnected: jest.Mock};

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

function resetSingleton(): void {
  (SyncService as any).instance = null;
}

const session = {
  sessionId: 'sess-a7',
  deviceId: 'dev',
  deviceName: 'Test',
  startTime: Date.now(),
  status: 'in_progress' as const,
  recordsSent: 0,
  recordsReceived: 0,
};

describe('SyncService A7 lifecycle_state PK symmetry (4-1)', () => {
  beforeEach(() => {
    mockConnectionManager.removeAllListeners();
    jest.clearAllMocks();
    resetSingleton();
  });

  it('handleIncomingSyncData keys an incoming lifecycle_state row by entity_id', async () => {
    const svc = SyncService.getInstance();
    (svc as any).currentSession = {...session};

    await (svc as any).handleIncomingSyncData({
      table: 'lifecycle_state',
      operation: 'insert',
      sync_session_id: 'sess-a7',
      event_id: 'evt-1',
      record: {
        entity_id: 'entity-42',
        exhaustion: 0.5,
        sleeping: 0,
        created_at: '2026-08-31T00:00:00.000Z',
        updated_at: '2026-08-31T00:00:00.000Z',
        deleted_at: null,
      },
    });

    // The server-record exclusion key must be built from the REAL pk (entity_id),
    // not a non-existent `id`. Pre-registry this added 'lifecycle_state:undefined'.
    expect((svc as any).serverRecordIds.has('lifecycle_state:entity-42')).toBe(true);
    expect((svc as any).incomingDataBuffer).toHaveLength(1);
    expect((svc as any).incomingDataBuffer[0].record.entity_id).toBe('entity-42');
  });

  it('handleIncomingSyncData keys character_favorites by profile_id', async () => {
    const svc = SyncService.getInstance();
    (svc as any).currentSession = {...session};

    await (svc as any).handleIncomingSyncData({
      table: 'character_favorites',
      operation: 'insert',
      sync_session_id: 'sess-a7',
      event_id: 'evt-2',
      record: {
        profile_id: 'pf-9',
        created_at: '2026-08-31T00:00:00.000Z',
        updated_at: '2026-08-31T00:00:00.000Z',
        deleted_at: null,
      },
    });

    expect((svc as any).serverRecordIds.has('character_favorites:pf-9')).toBe(true);
  });

  it('handleIncomingSyncData keys chat_conversation_settings by participant_key', async () => {
    const svc = SyncService.getInstance();
    (svc as any).currentSession = {...session};

    await (svc as any).handleIncomingSyncData({
      table: 'chat_conversation_settings',
      operation: 'insert',
      sync_session_id: 'sess-a7',
      event_id: 'evt-3',
      record: {
        participant_key: 'pk-7',
        entity_id: 'entity-1',
        pinned: 0,
        archived: 1,
        reply_mode: 'realistic',
        created_at: '2026-08-31T00:00:00.000Z',
        updated_at: '2026-08-31T00:00:00.000Z',
        deleted_at: null,
      },
    });

    expect((svc as any).serverRecordIds.has('chat_conversation_settings:pk-7')).toBe(true);
  });
});
