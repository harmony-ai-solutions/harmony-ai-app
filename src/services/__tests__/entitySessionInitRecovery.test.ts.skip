// TODO(followup Track E): implement INIT_ENTITY recovery per this spec; re-enable by renaming back. See .current_work/senju-rebase-integration/02-Followup-Stub-Plan.md §Track E.
/**
 * EntitySessionService — INIT_ENTITY engine-rejection recovery tests.
 *
 * Regression test for the reported bug: opening a conversation with a
 * freshly-created AI partner showed "Session initialization failed" / the AI
 * offline, even though the sync connection (settings screen) was healthy.
 *
 * Root cause: `handleInitEntityResponse` tore the session down on ANY
 * INIT_ENTITY ERROR. CreateAIScreen syncs the new entity to the engine
 * fire-and-forget, so when the chat is opened before the engine ingested it,
 * the engine rejects INIT_ENTITY with an "entity not defined"-class error —
 * and the app gave up instantly (and the context-level retries re-sent
 * INIT_ENTITY WITHOUT syncing, failing identically every time).
 *
 * Fix: on an entity-ingestion error, re-sync (best-effort) and re-send
 * INIT_ENTITY, bounded by MAX_INIT_ENTITY_RETRIES. Only after exhausting the
 * retries (or for non-ingestion errors) does the session fail with
 * session:error.
 */
import { EntitySessionService } from '../EntitySessionService';
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

// SyncService is a NAMED export; mock syncAndWait + initiateSync so the
// recovery path can be observed.
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
  deriveParticipantKey: jest.fn().mockReturnValue('pk'),
}));

jest.mock('../../database/repositories/conversation_messages', () => ({
  messageExists: jest.fn(),
  createConversationMessage: jest.fn(),
  updateConversationMessage: jest.fn(),
  getConversationMessage: jest.fn(),
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

function makeSession(interactionId = 'ix-recover') {
  return {
    interactionId,
    interaction: null,
    participantIds: ['claire', 'user'],
    ownEntityId: 'user',
    connections: new Map<any, any>([
      ['claire', { connectionId: 'entity-claire-x', status: 'connecting' }],
      ['user', { connectionId: 'entity-user-x', status: 'connecting' }],
    ]),
    pendingTranscriptions: new Map(),
  } as any;
}

const initEntityError = (error: string) => ({
  event_type: 'INIT_ENTITY',
  status: 'ERROR',
  payload: { error },
});

describe('EntitySessionService INIT_ENTITY engine-rejection recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSyncAndWait.mockClear().mockResolvedValue(undefined);
    mockInitiateSync.mockClear().mockResolvedValue(undefined);
    mockConnectionManager.removeAllListeners();
    mockConnectionManager.sendEvent.mockClear().mockResolvedValue(undefined);
    mockConnectionManager.isConnected.mockClear().mockReturnValue(true);
    mockConnectionManager.disconnectConnection.mockClear();
    mockConnectionManager.createConnection.mockClear().mockResolvedValue(undefined);
    resetSingleton();
  });

  it('re-syncs and re-sends INIT_ENTITY when the engine rejects with entity_not_defined, instead of failing immediately', async () => {
    const svc = EntitySessionService.getInstance();
    const session = makeSession();
    (svc as any).sessions.set(session.interactionId, session);

    const errors: string[] = [];
    svc.on('session:error', (_id: string, err: string) => errors.push(err));

    await (svc as any).handleInitEntityResponse(
      'claire',
      initEntityError('entity_not_defined'),
      null,
      session,
      session.interactionId,
    );

    // The recovery is fire-and-forget; flush its microtask chain.
    await new Promise<void>(resolve => setImmediate(resolve));

    // The session must NOT have been torn down nor errored.
    expect((svc as any).sessions.has(session.interactionId)).toBe(true);
    expect(errors).toHaveLength(0);

    // A recovery sync ran + a fresh connection was created + INIT_ENTITY re-sent.
    expect(mockSyncAndWait).toHaveBeenCalledTimes(1);
    expect(mockConnectionManager.createConnection).toHaveBeenCalledWith(
      'entity-claire-x',
      'entity',
      expect.any(String),
      'unencrypted',
      'claire',
    );
    const sentEvents = mockConnectionManager.sendEvent.mock.calls.map(
      (c: any[]) => c[1],
    );
    const initEvents = sentEvents.filter(
      (e: any) => e && e.event_type === 'INIT_ENTITY',
    );
    expect(initEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('surfaces session:error and tears down after the retry cap when the engine keeps rejecting', async () => {
    const svc = EntitySessionService.getInstance();
    const session = makeSession();
    (svc as any).sessions.set(session.interactionId, session);

    const errors: string[] = [];
    svc.on('session:error', (_id: string, err: string) => errors.push(err));

    // Simulate that the engine has already rejected twice (2 prior retries
    // performed). The next rejection must hit the cap (MAX_INIT_ENTITY_RETRIES
    // = 2) and fail normally — no recovery, no new connection.
    session.initRetryCount = 2;

    await (svc as any).handleInitEntityResponse(
      'claire',
      initEntityError('entity_not_defined'),
      null,
      session,
      session.interactionId,
    );

    expect(errors).toEqual(['entity_not_defined']);
    expect((svc as any).sessions.has(session.interactionId)).toBe(false);
    expect(mockSyncAndWait).not.toHaveBeenCalled();
    expect(mockConnectionManager.createConnection).not.toHaveBeenCalled();
  });

  it('does NOT trigger recovery for non-ingestion INIT_ENTITY errors (falls through to normal failure)', async () => {
    const svc = EntitySessionService.getInstance();
    const session = makeSession();
    (svc as any).sessions.set(session.interactionId, session);

    const errors: string[] = [];
    svc.on('session:error', (_id: string, err: string) => errors.push(err));

    await (svc as any).handleInitEntityResponse(
      'claire',
      initEntityError('session limit reached'),
      null,
      session,
      session.interactionId,
    );

    expect(errors).toEqual(['session limit reached']);
    expect((svc as any).sessions.has(session.interactionId)).toBe(false);
    expect(mockSyncAndWait).not.toHaveBeenCalled();
    expect(mockConnectionManager.createConnection).not.toHaveBeenCalled();
  });

  it('does not tear down when the transport error storm delivers an INIT_ENTITY app-level error', async () => {
    // BaseWebSocketConnection.handleMessage emits BOTH 'event' and 'error' for
    // an ERROR-status message: the error object carries the harmony event under
    // `error.event`. The error path must defer to the event-path recovery
    // instead of tearing the session down (the bug that defeated recovery).
    const svc = EntitySessionService.getInstance();
    const session = makeSession();
    (svc as any).sessions.set(session.interactionId, session);

    const errors: string[] = [];
    svc.on('session:error', (_id: string, err: string) => errors.push(err));

    // Simulate the transport error storm: the error carries an INIT_ENTITY
    // event (app-level). The guard must skip the fatal teardown.
    await (svc as any).handleEntityConnectionError(
      'claire',
      { message: 'entity_not_defined', event: { event_type: 'INIT_ENTITY' } },
    );

    expect((svc as any).sessions.has(session.interactionId)).toBe(true);
    expect(errors).toHaveLength(0);

    // A genuine transport error (no attached event) is still fatal.
    await (svc as any).handleEntityConnectionError(
      'claire',
      { message: 'Connection reset by peer', code: 'ECONNRESET' },
    );
    expect(errors.length).toBeGreaterThan(0);
    expect((svc as any).sessions.has(session.interactionId)).toBe(false);
  });
});