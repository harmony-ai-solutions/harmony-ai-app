/**
 * EntitySessionService.handleInitEntityResponse — render-only greeting support
 * (§1-10).
 *
 * The INIT_ENTITY SUCCESS payload carries `has_first_mes` (true when the
 * character's card has an authored first_mes). The handler must surface it on
 * the InteractionSession (read by ChatDetailScreen at `session:started` /
 * message-load time) WITHOUT fabricating a greeting — the greeting arrives as
 * a normal `message_type="greeting"` message via the message-load/sync path.
 */
import { EntitySessionService } from '../EntitySessionService';
import type { InteractionSession } from '../EntitySessionService';
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

jest.mock('../SyncService', () => {
  mockInitiateSync = jest.fn().mockResolvedValue(undefined);
  return {
    __esModule: true,
    SyncService: {
      getInstance: () => ({ initiateSync: mockInitiateSync }),
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
    isPurging: jest.fn().mockReturnValue(false),
  },
  default: {},
}));

function resetSingleton(): void {
  (EntitySessionService as any).instance = null;
}

function makeSession(interactionId = 'ix-greeting'): InteractionSession {
  return {
    interactionId,
    interaction: null,
    participantIds: ['char-entity', 'user-entity'],
    ownEntityId: 'user-entity',
    connections: new Map([
      ['char-entity', { connectionId: 'entity-char-x', status: 'connecting' as const }],
      ['user-entity', { connectionId: 'entity-user-x', status: 'connecting' as const }],
    ]),
    pendingTranscriptions: new Map(),
    replyMode: 'realistic',
    initRetryCount: 0,
  };
}

const initEntitySuccess = (payload: Record<string, unknown>) => ({
  event_type: 'INIT_ENTITY',
  status: 'SUCCESS',
  payload,
});

describe('EntitySessionService — has_first_mes surfacing (§1-10)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInitiateSync.mockClear();
    mockInitiateSync.mockResolvedValue(undefined);
    resetSingleton();
  });

  it('stores has_first_mes=true on the session from the partner INIT_ENTITY SUCCESS payload', async () => {
    const svc = EntitySessionService.getInstance();
    const session = makeSession();
    (svc as any).sessions.set(session.interactionId, session);

    await (svc as any).handleInitEntityResponse(
      'char-entity',
      initEntitySuccess({ session_id: 's-char', has_first_mes: true }),
      null,
      session,
      session.interactionId,
    );

    expect(session.hasFirstMes).toBe(true);
  });

  it('stores has_first_mes=false on the session (drives the empty-chat hint)', async () => {
    const svc = EntitySessionService.getInstance();
    const session = makeSession();
    (svc as any).sessions.set(session.interactionId, session);

    await (svc as any).handleInitEntityResponse(
      'char-entity',
      initEntitySuccess({ session_id: 's-char', has_first_mes: false }),
      null,
      session,
      session.interactionId,
    );

    expect(session.hasFirstMes).toBe(false);
  });

  it('maps an ABSENT has_first_mes to false — the engine omits the field when no greeting will be delivered (omitempty)', async () => {
    const svc = EntitySessionService.getInstance();
    const session = makeSession();
    (svc as any).sessions.set(session.interactionId, session);

    await (svc as any).handleInitEntityResponse(
      'char-entity',
      initEntitySuccess({ session_id: 's-char' }), // no has_first_mes key
      null,
      session,
      session.interactionId,
    );

    // Wire contract (engine TestInitEntityResponse_HasFirstMesJSONShape):
    // absent ≡ false — the engine serializes the field with omitempty. The
    // previous "stays undefined" behavior left no-first_mes cards on the
    // ChatDetail splash forever (no message can ever arrive for them).
    expect(session.hasFirstMes).toBe(false);
    // Still no greeting fabrication — no message row was created.
    const { createConversationMessage } = require('../../database/repositories/conversation_messages');
    expect(createConversationMessage).not.toHaveBeenCalled();
  });

  it('leaves the session untouched on ERROR status', async () => {
    const svc = EntitySessionService.getInstance();
    const session = makeSession();
    (svc as any).sessions.set(session.interactionId, session);

    await (svc as any).handleInitEntityResponse(
      'char-entity',
      { event_type: 'INIT_ENTITY', status: 'ERROR', payload: { error: 'boom' } },
      null,
      session,
      session.interactionId,
    );

    expect(session.hasFirstMes).toBeUndefined();
  });
});

describe('EntitySessionService — live greeting delivery keeps message_type (§1-10)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInitiateSync.mockClear();
    mockInitiateSync.mockResolvedValue(undefined);
    resetSingleton();
  });

  it('persists a greeting-flagged ENTITY_UTTERANCE with message_type=greeting — the swiper gate depends on it', async () => {
    const svc = EntitySessionService.getInstance();
    const session = makeSession();
    (svc as any).sessions.set(session.interactionId, session);

    // Engine DeliverGreeting emits the authored first_mes as a plain
    // ENTITY_UTTERANCE flagged with message_type="greeting" on the wire.
    await (svc as any).handleIncomingUtterance(
      session,
      session.interactionId,
      {
        entity_id: 'char-entity',
        message_id: 'msg-engine-greeting',
        type: 'verbal',
        message_type: 'greeting',
        content: 'Hi {{user}}!',
      },
      'evt-greeting-live',
    );

    const {
      createConversationMessage,
    } = require('../../database/repositories/conversation_messages');
    expect(createConversationMessage).toHaveBeenCalledTimes(1);
    expect(createConversationMessage.mock.calls[0][0]).toMatchObject({
      message_type: 'greeting',
      content: 'Hi {{user}}!',
      sender_entity_id: 'char-entity',
    });
  });

  it('persists a plain ENTITY_UTTERANCE as message_type=text (no greeting flag)', async () => {
    const svc = EntitySessionService.getInstance();
    const session = makeSession();
    (svc as any).sessions.set(session.interactionId, session);

    await (svc as any).handleIncomingUtterance(
      session,
      session.interactionId,
      {
        entity_id: 'char-entity',
        message_id: 'msg-engine-text',
        type: 'verbal',
        content: 'regular reply',
      },
      'evt-text-live',
    );

    const {
      createConversationMessage,
    } = require('../../database/repositories/conversation_messages');
    expect(createConversationMessage).toHaveBeenCalledTimes(1);
    expect(createConversationMessage.mock.calls[0][0]).toMatchObject({
      message_type: 'text',
      content: 'regular reply',
    });
  });
});
