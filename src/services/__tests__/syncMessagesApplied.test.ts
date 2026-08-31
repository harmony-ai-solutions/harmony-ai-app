/**
 * SyncService — `sync:messages-applied` recount event (3-1).
 *
 * The badge fix: synced-in partner messages never bumped a badge because the
 * unread increment only lived in the live-WS path. After an inbound sync apply
 * COMMITS, `applyBufferedSyncData` must emit `sync:messages-applied` carrying
 * the applied table list so ChatListScreen can recount derived unread badges.
 *
 * This test drives the apply to a successful commit with a mocked sync DB and
 * asserts the event fires with the expected payload.
 */

import { SyncService } from '../SyncService';
import { EventEmitter } from 'eventemitter3';

let mockConnectionManager: EventEmitter & { sendEvent: jest.Mock; isConnected: jest.Mock };

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

// A sync DB whose transaction immediately runs the tx callback (pushing every
// buffered item through the apply loop) then COMMITS.
jest.mock('../../database/connection', () => ({
  getDatabase: jest.fn(),
  getSyncDatabase: jest.fn().mockResolvedValue({
    transaction: jest.fn(
      (fn: (tx: any) => void, onError: (e: any) => void, onSuccess: () => void) => {
        const tx = {
          executeSql: jest.fn(
            (
              sql: string,
              params: any[],
              cb?: (_: any, result: any) => void,
              errCb?: (_: any, err: any) => void,
            ) => {
              if (typeof cb !== 'function') return;
              // SELECT with no matching row → the INSERT path (no LWW branch).
              if (sql.includes('SELECT updated_at')) {
                cb(null, { rows: { length: 0, item: () => ({}) } });
              } else {
                cb(null, { rows: { length: 0 } });
              }
            },
          ),
        };
        try {
          fn(tx);
          onSuccess();
        } catch (e) {
          onError(e);
        }
      },
    ),
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
  default: { invalidateAllCaches: jest.fn() },
}));

jest.mock('../connection/ConnectionManager', () => {
  const { EventEmitter: EE } = require('eventemitter3');
  const cm: EventEmitter & { sendEvent: jest.Mock; isConnected: jest.Mock } = new EE();
  cm.sendEvent = jest.fn().mockResolvedValue(undefined);
  cm.isConnected = jest.fn().mockReturnValue(true);
  mockConnectionManager = cm;
  return { __esModule: true, default: cm };
});

function resetSingleton(): void {
  (SyncService as any).instance = null;
}

describe('SyncService sync:messages-applied emission (3-1)', () => {
  beforeEach(() => {
    mockConnectionManager.removeAllListeners();
    jest.clearAllMocks();
    resetSingleton();
  });

  it('emits sync:messages-applied with the applied tables after a successful commit', async () => {
    const svc = SyncService.getInstance();
    const handler = jest.fn();
    svc.on('sync:messages-applied', handler);

    (svc as any).incomingDataBuffer = [
      {
        table: 'conversation_messages',
        operation: 'insert',
        record: { id: 'm-1', updated_at: new Date().toISOString() },
      },
      {
        table: 'entities',
        operation: 'insert',
        record: { id: 'e-1', updated_at: new Date().toISOString() },
      },
    ];
    (svc as any).serverRecordIds = new Set();

    await (svc as any).applyBufferedSyncData();

    expect(handler).toHaveBeenCalledTimes(1);
    // Both applied tables are carried (generalizable to sync:data-applied).
    const tables = handler.mock.calls[0][0].tables as string[];
    expect(tables).toContain('conversation_messages');
    expect(tables).toContain('entities');
  });

  it('does NOT emit when the buffered data is empty', async () => {
    const svc = SyncService.getInstance();
    const handler = jest.fn();
    svc.on('sync:messages-applied', handler);

    (svc as any).incomingDataBuffer = [];

    await (svc as any).applyBufferedSyncData();

    expect(handler).not.toHaveBeenCalled();
  });
});
