/**
 * EntitySessionService — terminal `failed` retention (4-3 / D36 + D65).
 *
 * Root cause (the incident): `failInteractionSession` DELETED the session
 * after a terminal INIT_ENTITY failure, and the own-entity WS disconnect
 * handler deleted it with no marker and no `session:error`. The context init
 * timer then found "session no longer exists" and silently stopped retrying,
 * while ChatDetailScreen's `isSessionActive` stayed false forever → the
 * eternal amber "Connecting…" dot + a never-revealing splash.
 *
 * Fix under test: terminal failures FLAG (`failed` marker) + RETAIN the
 * session so the context retry/timer machinery and the UI observe the state;
 * Retry replaces the entry; `closeAllSessions` keeps its deliberate full
 * teardown (background / sync loss are teardown triggers, not failures).
 */
import { EntitySessionService, classifyInitEntityError, isIngestionSessionError } from '../EntitySessionService';
import type { InteractionSession } from '../EntitySessionService';
import { EventEmitter } from 'eventemitter3';

let mockConnectionManager: EventEmitter & {
  sendEvent: jest.Mock;
  isConnected: jest.Mock;
  disconnectConnection: jest.Mock;
  createConnection: jest.Mock;
};
let mockSyncAndWait: jest.Mock;
let mockInitiateSync: jest.Mock;

jest.mock('react-native-device-info', () => ({
  getUniqueId: jest.fn().mockResolvedValue('test-device'),
}));

jest.mock('react-native-track-player', () => ({
  default: {
    setupPlayer: jest.fn().mockResolvedValue(undefined),
    add: jest.fn().mockResolvedValue(undefined),
    play: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock('../AudioPlayer', () => ({
  __esModule: true,
  default: { stop: jest.fn().mockResolvedValue(undefined) },
  AudioPlayer: class {},
}));

jest.mock('../connection/ConnectionManager', () => {
  const { EventEmitter: EE } = require('eventemitter3');
  const cm: EventEmitter & {
    sendEvent: jest.Mock;
    isConnected: jest.Mock;
    disconnectConnection: jest.Mock;
    createConnection: jest.Mock;
  } = new EE();
  cm.sendEvent = jest.fn().mockResolvedValue(undefined);
  cm.isConnected = jest.fn().mockReturnValue(true);
  cm.disconnectConnection = jest.fn();
  cm.createConnection = jest.fn().mockResolvedValue(undefined);
  mockConnectionManager = cm;
  return { __esModule: true, default: cm };
});

jest.mock('../SyncService', () => {
  mockSyncAndWait = jest.fn().mockResolvedValue(undefined);
  mockInitiateSync = jest.fn().mockResolvedValue(undefined);
  return {
    __esModule: true,
    SyncService: {
      getInstance: () => ({
        syncAndWait: mockSyncAndWait,
        initiateSync: mockInitiateSync,
      }),
    },
  };
});

jest.mock('../../database/repositories/interactions', () => ({
  createInteraction: jest.fn().mockResolvedValue(undefined),
  deriveScopeFromParticipants: jest.fn().mockReturnValue('one_on_one'),
  deriveParticipantKey: jest.fn().mockReturnValue('claire+user'),
}));

jest.mock('../../database/repositories/conversation_messages', () => ({
  messageExists: jest.fn(),
  createConversationMessage: jest.fn(),
  updateConversationMessage: jest.fn(),
  getConversationMessage: jest.fn(),
}));

jest.mock('../../database/repositories/entities', () => ({
  getEntity: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../database/repositories/chatConversationSettings', () => ({
  getReplyMode: jest.fn().mockResolvedValue('realistic'),
}));

jest.mock('../../database/connection', () => ({
  getDatabase: jest.fn(),
  getSyncDatabase: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../cloud/CloudSessionService', () => ({
  cloudSessionService: {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    getStatus: jest.fn().mockReturnValue('idle'),
    isPurging: jest.fn().mockReturnValue(false),
  },
  default: {},
}));

jest.mock('../ConnectionStateManager', () => ({
  __esModule: true,
  default: {
    getCurrentSource: jest.fn().mockResolvedValue('selfhosted'),
    getSecurityMode: jest.fn().mockResolvedValue('unencrypted'),
    getWSUrl: jest.fn().mockResolvedValue('ws://localhost:28080'),
    getWSSUrl: jest.fn().mockResolvedValue('wss://localhost:28443'),
  },
}));

function resetSingleton(): void {
  (EntitySessionService as any).instance = null;
}

function makeSession(interactionId = 'ix-failed', failed = false): InteractionSession {
  return {
    interactionId,
    interaction: null,
    participantIds: ['claire', 'user'],
    ownEntityId: 'user',
    connections: new Map<any, any>([
      ['claire', { connectionId: 'entity-claire-pk', status: 'active' }],
      ['user', { connectionId: 'entity-user-pk', status: 'active' }],
    ]),
    pendingTranscriptions: new Map(),
    replyMode: 'realistic',
    initRetryCount: 0,
    ...(failed ? { failed: { error: 'entity_not_defined', at: 1 } } : {}),
  } as InteractionSession;
}

describe('EntitySessionService — terminal failure retention (4-3 / D36)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSyncAndWait.mockClear().mockResolvedValue(undefined);
    mockInitiateSync.mockClear().mockResolvedValue(undefined);
    mockConnectionManager.sendEvent.mockClear().mockResolvedValue(undefined);
    mockConnectionManager.isConnected.mockClear().mockReturnValue(true);
    mockConnectionManager.disconnectConnection.mockClear();
    mockConnectionManager.createConnection.mockClear().mockResolvedValue(undefined);
    resetSingleton();
  });

  it('failInteractionSession FLAGS + retains the session, disconnects sockets, resets statuses', async () => {
    const svc = EntitySessionService.getInstance();
    const session = makeSession();
    (svc as any).sessions.set(session.interactionId, session);

    const errors: string[] = [];
    const stopped: string[] = [];
    svc.on('session:error', (_id: string, err: string) => errors.push(err));
    svc.on('session:stopped', (id: string) => stopped.push(id));

    (svc as any).failInteractionSession(session.interactionId, session, 'entity_not_defined');

    // Retained (the context retry/timer machinery must see it), flagged...
    expect((svc as any).sessions.has(session.interactionId)).toBe(true);
    expect(session.failed).toMatchObject({ error: 'entity_not_defined' });
    // ...surfaced via session:error (NOT session:stopped — ChatDetail does not
    // listen to stopped, which is why the old path stuck at "connecting").
    expect(errors).toEqual(['entity_not_defined']);
    expect(stopped).toEqual([]);
    // Sockets are still torn down; statuses reset so no all-active check can
    // ever pass on a dead session.
    expect(mockConnectionManager.disconnectConnection).toHaveBeenCalledWith('entity-claire-pk');
    expect(mockConnectionManager.disconnectConnection).toHaveBeenCalledWith('entity-user-pk');
    expect([...session.connections.values()].every(c => c.status === 'disconnected')).toBe(true);
  });

  it('own-entity WS disconnect FLAGS + retains instead of silently deleting (D65)', () => {
    const svc = EntitySessionService.getInstance();
    const session = makeSession('ix-live');
    (svc as any).sessions.set(session.interactionId, session);

    const errors: string[] = [];
    const stopped: string[] = [];
    svc.on('session:error', (_id: string, err: string) => errors.push(err));
    svc.on('session:stopped', (id: string) => stopped.push(id));

    (svc as any).handleEntityDisconnected('user');

    // D65: no silent delete — the entry is retained and flagged so the
    // retry/timer machinery sees it, and session:error is emitted so the
    // ChatDetail error banner appears instead of the eternal amber dot.
    expect((svc as any).sessions.has('ix-live')).toBe(true);
    expect(session.failed).toMatchObject({ error: 'Connection lost' });
    expect(errors).toEqual(['Connection lost']);
    expect(stopped).toEqual([]);
  });

  it('partner WS disconnect still keeps the session live and schedules a reconnect', async () => {
    const svc = EntitySessionService.getInstance();
    const session = makeSession('ix-live');
    (svc as any).sessions.set(session.interactionId, session);

    const errors: string[] = [];
    svc.on('session:error', (_id: string, err: string) => errors.push(err));

    jest.useFakeTimers();
    try {
      (svc as any).handleEntityDisconnected('claire');

      expect(errors).toEqual([]);
      expect(session.failed).toBeUndefined();
      expect((svc as any).sessions.has('ix-live')).toBe(true);
      // Reconnect timer scheduled (exponential backoff starts at 1s). Advance
      // asynchronously so reconnectPartner's await chain settles.
      await jest.advanceTimersByTimeAsync(1000);
      expect(mockConnectionManager.createConnection).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('startInteractionSession REUSES a live session for the same participant set', async () => {
    const svc = EntitySessionService.getInstance();
    const live = makeSession('ix-live');
    (svc as any).sessions.set('ix-live', live);

    const result = await svc.startInteractionSession('user', ['claire', 'user'], 'realistic');

    expect(result).toBe(live);
    expect((svc as any).sessions.has('ix-live')).toBe(true);
    expect(mockConnectionManager.createConnection).not.toHaveBeenCalled();
  });

  it('startInteractionSession REPLACES a flagged session for the same participant set (Retry replaces the entry)', async () => {
    const svc = EntitySessionService.getInstance();
    const failed = makeSession('ix-failed', true);
    (svc as any).sessions.set('ix-failed', failed);

    const result = await svc.startInteractionSession('user', ['claire', 'user'], 'realistic');

    // A FRESH session replaced the flagged one — never reuse a terminal one.
    expect(result.interactionId).not.toBe('ix-failed');
    expect(result.failed).toBeUndefined();
    expect((svc as any).sessions.has('ix-failed')).toBe(false);
    expect((svc as any).sessions.has(result.interactionId)).toBe(true);
    // Fresh connections were dialed for the replacement.
    expect(mockConnectionManager.createConnection).toHaveBeenCalled();
  });

  it('closeAllSessions keeps its deliberate FULL teardown even for flagged sessions', async () => {
    const svc = EntitySessionService.getInstance();
    const failed = makeSession('ix-failed', true);
    (svc as any).sessions.set('ix-failed', failed);

    const stopped: string[] = [];
    svc.on('session:stopped', (id: string) => stopped.push(id));

    await svc.closeAllSessions();

    // Background / sync loss remain teardown triggers, not failures: flagged
    // entries are wiped wholesale (the GC point for off-screen chats).
    expect(stopped).toEqual(['ix-failed']);
    expect((svc as any).sessions.has('ix-failed')).toBe(false);
  });

  it('a late INIT_ENTITY SUCCESS clears the failed marker', async () => {
    const svc = EntitySessionService.getInstance();
    const session = makeSession('ix-recover', true);
    (svc as any).sessions.set(session.interactionId, session);

    await (svc as any).handleInitEntityResponse(
      'claire',
      { event_type: 'INIT_ENTITY', status: 'SUCCESS', payload: { session_id: 's-1', has_first_mes: false } },
      null,
      session,
      session.interactionId,
    );

    expect(session.failed).toBeUndefined();
  });
});

describe('INIT_ENTITY error classification (4-3 / D35)', () => {
  it('prefers the structured error_code when present', () => {
    // Even when the free-text copy changed, the code classifies.
    expect(
      classifyInitEntityError({ error: 'rewritten copy', error_code: 'entity_not_defined' }, 'rewritten copy'),
    ).toEqual({ isIngestionError: true, isDisabledError: false });
    expect(
      classifyInitEntityError({ error: 'off', error_code: 'entity_disabled' }, 'off'),
    ).toEqual({ isIngestionError: false, isDisabledError: true });
    expect(
      classifyInitEntityError({ error: 'gone', error_code: 'entity_exists_deleted' }, 'gone'),
    ).toEqual({ isIngestionError: false, isDisabledError: true });
  });

  it('falls back to string equality when no error_code is present (old engines)', () => {
    expect(classifyInitEntityError({ error: 'entity_not_defined' }, 'entity_not_defined')).toEqual({
      isIngestionError: true,
      isDisabledError: false,
    });
    expect(classifyInitEntityError({ error: 'entity_disabled' }, 'entity_disabled')).toEqual({
      isIngestionError: false,
      isDisabledError: true,
    });
    expect(classifyInitEntityError({}, 'session limit reached')).toEqual({
      isIngestionError: false,
      isDisabledError: false,
    });
    // Unknown structured codes classify as "recognized but generic".
    expect(classifyInitEntityError({ error_code: 'something_new' }, 'x')).toEqual({
      isIngestionError: false,
      isDisabledError: false,
    });
  });

  it('isIngestionSessionError matches only the ingestion code', () => {
    expect(isIngestionSessionError('entity_not_defined')).toBe(true);
    expect(isIngestionSessionError('entity_disabled')).toBe(false);
    expect(isIngestionSessionError('Connection lost')).toBe(false);
  });
});
