/**
 * EntitySessionService.handleInitEntityResponse — session:started de-duplication.
 *
 * Regression test for the duplicate-sync bug observed on device (2026-08-05):
 * starting a 2-participant chat emitted `session:started` (and the on-start
 * `initiateSync`) TWICE. Root cause: `handleInitEntityResponse` checked
 * "all connections active" and emitted with NO guard, so when both participants'
 * INIT_ENTITY SUCCESS responses raced through the own-entity's
 * `await createInteraction(...)` window, BOTH re-entered the all-active check
 * after both connections were already 'active' and BOTH emitted.
 *
 * The fix adds an `InteractionSession.started` flag so the emit (+ on-start
 * sync) fires exactly once per session, no matter how the responses interleave.
 */
import { EntitySessionService } from '../EntitySessionService';
import { EventEmitter } from 'eventemitter3';

let mockConnectionManager: EventEmitter;
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
  const cm = new EE();
  cm.isConnected = jest.fn().mockReturnValue(true);
  cm.sendEvent = jest.fn().mockResolvedValue(undefined);
  cm.disconnectConnection = jest.fn();
  cm.createConnection = jest.fn().mockResolvedValue(undefined);
  cm.getEntityConnection = jest.fn().mockReturnValue(null);
  mockConnectionManager = cm;
  return { __esModule: true, default: cm };
});

// SyncService is a NAMED export; mock the on-start initiateSync so we can count it.
jest.mock('../SyncService', () => {
  mockInitiateSync = jest.fn().mockResolvedValue(undefined);
  return {
    __esModule: true,
    SyncService: {
      getInstance: () => ({ initiateSync: mockInitiateSync }),
    },
  };
});

// interactions repo — only createInteraction would run (own-entity path); mocked
// so the test never touches the DB. derive* are no-ops here (non-own test path).
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

function resetSingleton(): void {
  (EntitySessionService as any).instance = null;
}

function makeSession(status: 'active' | 'connecting', interactionId = 'ix-dedup') {
  return {
    interactionId,
    interaction: null,
    participantIds: ['claire', 'marcella'],
    ownEntityId: 'user', // neither claire nor marcella → avoids the createInteraction DB path
    connections: new Map([
      ['claire', { connectionId: 'entity-claire-x', status }],
      ['marcella', { connectionId: 'entity-marcella-x', status }],
    ]),
    pendingTranscriptions: new Map(),
  };
}

const initEntitySuccess = (sessionId: string) => ({
  event_type: 'INIT_ENTITY',
  status: 'SUCCESS',
  payload: { session_id: sessionId },
});

describe('EntitySessionService session:started de-duplication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInitiateSync.mockClear();
    mockInitiateSync.mockResolvedValue(undefined);
    resetSingleton();
  });

  it('emits session:started + on-start sync only ONCE when both INIT_ENTITY responses arrive after all connections are active (the race)', async () => {
    const svc = EntitySessionService.getInstance();
    const session = makeSession('active');
    (svc as any).sessions.set(session.interactionId, session);

    const startedEvents: string[] = [];
    svc.on('session:started', (id: string) => startedEvents.push(id));

    // Both responses processed AFTER both connections are already 'active'
    // (the on-device race). Without the guard this emits twice.
    await (svc as any).handleInitEntityResponse(
      'claire', initEntitySuccess('s-claire'), null, session, session.interactionId,
    );
    await (svc as any).handleInitEntityResponse(
      'marcella', initEntitySuccess('s-marcella'), null, session, session.interactionId,
    );

    expect(startedEvents).toEqual([session.interactionId]);
    expect(mockInitiateSync).toHaveBeenCalledTimes(1);
  });

  it('still emits session:started once for normal sequential activation (guard does not block the legitimate first emit)', async () => {
    const svc = EntitySessionService.getInstance();
    const session = makeSession('connecting');
    (svc as any).sessions.set(session.interactionId, session);

    const startedEvents: string[] = [];
    svc.on('session:started', (id: string) => startedEvents.push(id));

    // First response: only claire becomes active, marcella still connecting → no emit.
    await (svc as any).handleInitEntityResponse(
      'claire', initEntitySuccess('s-claire'), null, session, session.interactionId,
    );
    expect(startedEvents).toHaveLength(0);

    // Second response: marcella active → all active → emit (exactly once).
    await (svc as any).handleInitEntityResponse(
      'marcella', initEntitySuccess('s-marcella'), null, session, session.interactionId,
    );

    expect(startedEvents).toEqual([session.interactionId]);
    expect(mockInitiateSync).toHaveBeenCalledTimes(1);
  });
});
