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


jest.mock('../../services/engine/repositories/interactions', () => ({
  createInteraction: jest.fn().mockResolvedValue(undefined),
  deriveScopeFromParticipants: jest.fn().mockReturnValue('one_on_one'),
  deriveParticipantKey: jest.fn().mockReturnValue('pk'),
}));

jest.mock('../../services/engine/repositories/conversation_messages', () => ({
  messageExists: jest.fn(),
  createConversationMessage: jest.fn(),
  updateConversationMessage: jest.fn(),
  getConversationMessage: jest.fn(),
}));

jest.mock('../../services/engine/repositories/entities', () => ({
  getEntity: jest.fn().mockResolvedValue(null),
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
    const { createConversationMessage } = require('../../services/engine/repositories/conversation_messages');
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

describe('EntitySessionService — D-35 incoming utterance no longer persists', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSingleton();
  });

  it('emits message:received for an incoming ENTITY_UTTERANCE without writing a message row (engine authors it)', async () => {
    const svc = EntitySessionService.getInstance();
    const session = makeSession();
    (svc as any).sessions.set(session.interactionId, session);

    const received: any[] = [];
    svc.on('message:received', (interactionId: string, payload: any) => {
      received.push({ interactionId, payload });
    });

    // Engine DeliverGreeting emits the authored first_mes as a plain
    // ENTITY_UTTERANCE flagged with message_type="greeting" on the wire; the
    // app no longer mirrors it — the event drives a UI refresh that re-reads
    // the engine-authored row (which carries message_type=greeting).
    await (svc as any).handleIncomingMessage(session, session.interactionId, {
      event_type: 'ENTITY_UTTERANCE',
      entity_id: 'char-entity',
      event_id: 'evt-greeting-live',
      payload: {
        entity_id: 'char-entity',
        message_id: 'msg-engine-greeting',
        type: 'verbal',
        message_type: 'greeting',
        content: 'Hi {{user}}!',
      },
    });

    const {
      createConversationMessage,
    } = require('../../services/engine/repositories/conversation_messages');
    expect(createConversationMessage).not.toHaveBeenCalled();
    expect(received).toHaveLength(1);
    expect(received[0].payload).toMatchObject({
      message_type: 'greeting',
      content: 'Hi {{user}}!',
    });
  });
});
