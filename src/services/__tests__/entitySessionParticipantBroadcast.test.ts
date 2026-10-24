/**
 * EntitySessionService — participant broadcast + incoming relay (design §A).
 *
 * The app holds one entity session per participant. This suite pins:
 *  - outgoing sends reach the OWN user session too (the recorder's trigger),
 *    with the SAME client message id on every socket;
 *  - an ENTITY_UTTERANCE arriving on a cognition-bearing session is relayed
 *    VERBATIM to the other local sessions (user POV), exactly once per origin;
 *  - an utterance arriving on the user's own session is NEVER relayed onward
 *    (that would re-enter the character's cognition);
 *  - a relay that arrives before the destination finished INIT is queued and
 *    flushed when that session reports active (bounded queue, drop-oldest);
 *  - `message:received` carries the OWN (user-POV) interaction id.
 */
import { EntitySessionService } from '../EntitySessionService';
import type { InteractionSession } from '../EntitySessionService';

import { EventEmitter } from 'eventemitter3';

let mockConnectionManager: EventEmitter & {
  isConnected: jest.Mock;
  createConnection: jest.Mock;
  sendEvent: jest.Mock;
  disconnectConnection: jest.Mock;
};

jest.mock('react-native-device-info', () => ({
  getUniqueId: jest.fn().mockResolvedValue('test-device'),
}));

jest.mock('react-native-track-player', () => ({
  default: { setupPlayer: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
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
  cm.createConnection = jest.fn().mockResolvedValue(undefined);
  cm.sendEvent = jest.fn().mockResolvedValue(undefined);
  cm.disconnectConnection = jest.fn();
  cm.getEntityConnection = jest.fn().mockReturnValue(null);
  mockConnectionManager = cm as any;
  return { __esModule: true, default: cm };
});

jest.mock('../ConnectionStateManager', () => ({
  __esModule: true,
  default: {
    getCurrentSource: jest.fn().mockResolvedValue('selfhosted'),
    getSecurityMode: jest.fn().mockResolvedValue('insecure-ssl'),
    getWSUrl: jest.fn().mockResolvedValue('ws://10.0.2.2:28080/events'),
    getWSSUrl: jest.fn().mockResolvedValue('wss://10.0.2.2:28443/events'),
  },
}));

jest.mock('../../services/engine/repositories/interactions', () => ({
  createInteraction: jest.fn().mockResolvedValue(undefined),
  getSyncedReplyMode: jest.fn().mockResolvedValue('realistic'),
  deriveScopeFromParticipants: jest.fn().mockReturnValue('private'),
  deriveParticipantKey: jest.fn(),
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

const { deriveParticipantKey } = require('../../services/engine/repositories/interactions');

function resetSingleton(): void {
  (EntitySessionService as any).instance = null;
}

/** INIT_ENTITY SUCCESS with the capabilities the engine advertises. */
function initSuccess(
  payload: Record<string, unknown> = {},
  capabilities: string[] = ['cognition'],
) {
  return {
    event_type: 'INIT_ENTITY',
    status: 'SUCCESS',
    payload: { session_id: 'sess', capabilities, ...payload },
  };
}

function incomingUtterance(overrides: Record<string, unknown> = {}) {
  return {
    event_type: 'ENTITY_UTTERANCE',
    status: 'NEW',
    event_id: 'evt-in-1',
    payload: {
      entity_id: 'claire',
      message_id: 'msg-engine-1',
      type: 'verbal',
      content: 'Hello there',
      ...overrides,
    },
  };
}

/** All ENTITY_UTTERANCE sends captured by the ConnectionManager double. */
function utteranceSends(connectionId?: string) {
  return mockConnectionManager.sendEvent.mock.calls
    .map(([cid, event]: [string, any]) => ({ cid, event }))
    .filter(
      ({ cid, event }) =>
        event?.event_type === 'ENTITY_UTTERANCE' && (!connectionId || cid === connectionId),
    );
}

interface Harness {
  svc: EntitySessionService;
  session: InteractionSession;
  userConn: string;
  charConn: string;
}

/**
 * Start a user↔claire session and drive both INIT_ENTITY SUCCESS responses.
 * `userCapabilities` deliberately omits cognition (the persona has STT/VAD
 * only); claire advertises cognition like every AI partner.
 */
async function startStartedSession(
  opts: { initUser?: boolean; initCharacter?: boolean; userInteractionId?: string } = {},
): Promise<Harness> {
  const { initUser = true, initCharacter = true, userInteractionId = 'ix-user-pov' } = opts;
  const svc = EntitySessionService.getInstance();
  const session = await svc.startInteractionSession('user', ['user', 'claire'], 'realistic');

  const userConn = session.connections.get('user')!.connectionId;
  const charConn = session.connections.get('claire')!.connectionId;

  if (initUser) {
    await (svc as any).handleEntityEvent(
      'user',
      initSuccess(
        { interaction_id: userInteractionId },
        ['stt', 'tts'],
      ),
      userConn,
    );
  }
  if (initCharacter) {
    await (svc as any).handleEntityEvent(
      'claire',
      initSuccess({ interaction_id: 'ix-char-pov' }, ['cognition', 'tts']),
      charConn,
    );
  }

  return { svc, session, userConn, charConn };
}

describe('EntitySessionService — outgoing participant broadcast', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConnectionManager.isConnected.mockReturnValue(true);
    mockConnectionManager.createConnection.mockResolvedValue(undefined);
    mockConnectionManager.sendEvent.mockResolvedValue(undefined);
    deriveParticipantKey.mockReturnValue('claire+user');
    resetSingleton();
  });

  it('sends an outgoing text message to EVERY participant, including the own user session, with one shared message id', async () => {
    const { svc, session, userConn, charConn } = await startStartedSession();
    mockConnectionManager.sendEvent.mockClear();

    await svc.sendTextMessage(session.interactionId, 'Hi Claire');

    const sends = utteranceSends();
    expect(sends).toHaveLength(2);
    expect(sends.map(s => s.cid).sort()).toEqual([userConn, charConn].sort());
    const ids = new Set(sends.map(s => s.event.payload.message_id));
    expect(ids.size).toBe(1);
    expect(sends[0].event.payload.entity_id).toBe('user');
  });

  it('sends a combined (voice) utterance to every participant, including the own user session', async () => {
    const { svc, session, userConn, charConn } = await startStartedSession();
    mockConnectionManager.sendEvent.mockClear();

    const utterance = {
      message_id: 'pending-voice-1',
      entity_id: 'user',
      content: 'spoken words',
      type: 'UTTERANCE_COMBINED',
      audio: 'AAA=',
      audio_type: 'audio/mp4',
    };
    await svc.sendCombinedMessage(session.interactionId, utterance);

    const sends = utteranceSends();
    expect(sends.map(s => s.cid).sort()).toEqual([userConn, charConn].sort());
    for (const send of sends) {
      expect(send.event.payload).toEqual(utterance);
    }
  });

  it('still refuses to send when no PARTNER connection is active', async () => {
    const { svc, session } = await startStartedSession({ initCharacter: false });
    mockConnectionManager.sendEvent.mockClear();

    await expect(svc.sendTextMessage(session.interactionId, 'anyone?')).rejects.toThrow(
      /No active partner connections/,
    );
    expect(utteranceSends()).toHaveLength(0);
  });
});

describe('EntitySessionService — incoming relay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConnectionManager.isConnected.mockReturnValue(true);
    mockConnectionManager.createConnection.mockResolvedValue(undefined);
    mockConnectionManager.sendEvent.mockResolvedValue(undefined);
    deriveParticipantKey.mockReturnValue('claire+user');
    resetSingleton();
  });

  it('relays an AI utterance VERBATIM to the user session exactly once', async () => {
    const { svc, userConn, charConn, session } = await startStartedSession();
    const received: Array<{ interactionId: string; payload: any }> = [];
    svc.on('message:received', (interactionId: string, payload: any) => {
      received.push({ interactionId, payload });
    });
    mockConnectionManager.sendEvent.mockClear();

    const event = incomingUtterance({
      content: 'Welcome home hon~',
      audio: 'QUJD',
      audio_type: 'audio/mp3',
      audio_duration: 1.5,
    });
    await (svc as any).handleEntityEvent('claire', event, charConn);

    const sends = utteranceSends(userConn);
    expect(sends).toHaveLength(1);
    // Verbatim: same object shape and values — the MessageID is the recorder's
    // idempotency key, the message_type is preserved for greetings.
    expect(sends[0].event.payload).toEqual(event.payload);
    expect(sends[0].event.payload.message_id).toBe('msg-engine-1');

    // The UI event carries the OWN session id (the user-POV interaction).
    expect(received).toHaveLength(1);
    expect(received[0].interactionId).toBe(session.interactionId);
    expect(received[0].interactionId).toBe('ix-user-pov');
  });

  it('never relays the same origin message id twice (duplicate delivery / sync echo)', async () => {
    const { svc, userConn, charConn } = await startStartedSession();
    mockConnectionManager.sendEvent.mockClear();

    const event = incomingUtterance({ message_id: 'msg-dupe' });
    await (svc as any).handleEntityEvent('claire', event, charConn);
    await (svc as any).handleEntityEvent('claire', event, charConn);

    expect(utteranceSends(userConn)).toHaveLength(1);
  });

  it('does NOT relay an utterance that arrived on the own user session (directional rule)', async () => {
    const { svc, userConn, charConn } = await startStartedSession();
    mockConnectionManager.sendEvent.mockClear();

    const received = jest.fn();
    svc.on('message:received', received);

    // A fan-out/sync echo for the user's own POV row arrives on the user socket.
    await (svc as any).handleEntityEvent(
      'user',
      incomingUtterance({ entity_id: 'user', message_id: 'msg-user-pov-1', content: 'mine' }),
      userConn,
    );

    expect(utteranceSends()).toHaveLength(0);
    expect(utteranceSends(charConn)).toHaveLength(0);
    // The UI still refreshes; only the relay is suppressed.
    expect(received).toHaveBeenCalledTimes(1);
  });

  it('does not relay from a partner session without cognition', async () => {
    const svc = EntitySessionService.getInstance();
    const session = await svc.startInteractionSession('user', ['user', 'claire'], 'realistic');
    const userConn = session.connections.get('user')!.connectionId;
    const charConn = session.connections.get('claire')!.connectionId;

    await (svc as any).handleEntityEvent(
      'user',
      initSuccess({ interaction_id: 'ix-user-pov' }, ['stt']),
      userConn,
    );
    // A no-cognition partner (e.g. an STT-only NPC): nothing authors a POV copy.
    await (svc as any).handleEntityEvent(
      'claire',
      initSuccess({ interaction_id: 'ix-char-pov' }, ['stt']),
      charConn,
    );
    mockConnectionManager.sendEvent.mockClear();

    await (svc as any).handleEntityEvent('claire', incomingUtterance(), charConn);

    expect(utteranceSends()).toHaveLength(0);
  });

  it('queues a relay until the destination user session is started, then flushes it', async () => {
    // Character INIT first: its greeting can arrive while the user's INIT is
    // still in flight (engine pending-event drain).
    const { svc, userConn, charConn } = await startStartedSession({
      initUser: false,
      initCharacter: true,
    });

    const greeting = incomingUtterance({
      message_id: 'msg-greeting-queued',
      message_type: 'greeting',
      content: 'Welcome!',
    });
    await (svc as any).handleEntityEvent('claire', greeting, charConn);

    // Not deliverable yet — queued, nothing sent on the user socket.
    expect(utteranceSends(userConn)).toHaveLength(0);
    const queued = (svc as any).relayQueues.get(userConn);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toEqual(greeting.payload);

    // User INIT completes → flush with the payload untouched (greeting type preserved).
    await (svc as any).handleEntityEvent(
      'user',
      initSuccess({ interaction_id: 'ix-user-pov' }, ['stt', 'tts']),
      userConn,
    );

    const sends = utteranceSends(userConn);
    expect(sends).toHaveLength(1);
    expect(sends[0].event.payload).toEqual(greeting.payload);
    expect(sends[0].event.payload.message_type).toBe('greeting');
    expect((svc as any).relayQueues.has(userConn)).toBe(false);
  });

  it('bounds the readiness queue (drop-oldest) instead of growing without limit', async () => {
    const { svc, userConn, charConn } = await startStartedSession({
      initUser: false,
      initCharacter: true,
    });

    for (let i = 0; i <= 100; i += 1) {
      await (svc as any).handleEntityEvent(
        'claire',
        incomingUtterance({ message_id: `msg-burst-${i}`, content: `line ${i}` }),
        charConn,
      );
    }

    const queued = (svc as any).relayQueues.get(userConn);
    expect(queued).toHaveLength(100);
    // The oldest (msg-burst-0) was dropped.
    expect(queued[0].message_id).toBe('msg-burst-1');
    expect(queued[99].message_id).toBe('msg-burst-100');
  });

  it('emits message:received under the OWN interaction id, never the character POV id', async () => {
    const { svc, charConn } = await startStartedSession();

    const received: string[] = [];
    svc.on('message:received', (interactionId: string) => received.push(interactionId));

    await (svc as any).handleEntityEvent(
      'claire',
      incomingUtterance({ message_id: 'msg-pov-check' }),
      charConn,
    );

    expect(received).toEqual(['ix-user-pov']);
  });
});

describe('EntitySessionService — post-send reconciliation (unchanged)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConnectionManager.isConnected.mockReturnValue(true);
    mockConnectionManager.createConnection.mockResolvedValue(undefined);
    mockConnectionManager.sendEvent.mockResolvedValue(undefined);
    deriveParticipantKey.mockReturnValue('claire+user');
    resetSingleton();
  });

  it('drops the optimistic row once the engine returns the persisted user-POV row on re-read', async () => {
    const { svc, session } = await startStartedSession();
    await svc.sendTextMessage(session.interactionId, 'Hi Claire');

    const pending = svc.getPendingMessages(session.interactionId);
    expect(pending).toHaveLength(1);

    // The engine now authors the user-POV row (relay → recorder) and the next
    // read returns it; type + sender + content + timing match.
    svc.reconcilePendingMessages(session.interactionId, [
      {
        message_type: 'text',
        content: 'Hi Claire',
        sender_entity_id: 'user',
        created_at: new Date(pending[0].created_at.getTime() + 1000),
      },
    ]);

    expect(svc.getPendingMessages(session.interactionId)).toHaveLength(0);
  });
});

describe('EntitySessionService — relay ack → post-persist UI nudge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConnectionManager.isConnected.mockReturnValue(true);
    mockConnectionManager.createConnection.mockResolvedValue(undefined);
    mockConnectionManager.sendEvent.mockResolvedValue(undefined);
    deriveParticipantKey.mockReturnValue('claire+user');
    resetSingleton();
  });

  /**
   * Drive an AI utterance in on the character socket (arrival emit + relay to
   * the user socket), then return everything the test needs: the recorded
   * message:received emissions and the event_id the relay generated.
   */
  async function relayOne(harness: Harness) {
    const { svc, userConn, charConn } = harness;
    const received: Array<{ interactionId: string; payload: any }> = [];
    svc.on('message:received', (interactionId: string, payload: any) => {
      received.push({ interactionId, payload });
    });
    mockConnectionManager.sendEvent.mockClear();

    await (svc as any).handleEntityEvent('claire', incomingUtterance(), charConn);

    const relaySend = utteranceSends(userConn)[0];
    expect(relaySend).toBeDefined();
    return { received, relayEventId: relaySend.event.event_id as string };
  }

  it('re-emits message:received AFTER the engine ack, with the ORIGINAL utterance payload', async () => {
    const harness = await startStartedSession();
    const { svc } = harness;
    const { received, relayEventId } = await relayOne(harness);

    // One emit at arrival (races the persist)…
    expect(received).toHaveLength(1);

    // …and the engine ack (SUCCESS = recorder committed the POV row) triggers
    // the post-persist nudge. The ack carries the handler's RESULT payload —
    // the nudge must pass the original utterance, and the OWN interaction id.
    await (svc as any).handleEntityEvent('user', {
      event_type: 'ENTITY_UTTERANCE',
      status: 'SUCCESS',
      event_id: relayEventId,
      payload: { recorded: true },
    }, harness.userConn);

    expect(received).toHaveLength(2);
    expect(received[1].interactionId).toBe('ix-user-pov');
    expect(received[1].payload.message_id).toBe('msg-engine-1');
    expect(received[1].payload.content).toBe('Hello there');

    // A repeated/duplicate ack never emits again (waiter consumed).
    await (svc as any).handleEntityEvent('user', {
      event_type: 'ENTITY_UTTERANCE',
      status: 'SUCCESS',
      event_id: relayEventId,
      payload: { recorded: true },
    }, harness.userConn);
    expect(received).toHaveLength(2);
  });

  it('does NOT nudge on an ERROR ack (the POV row was not persisted)', async () => {
    const harness = await startStartedSession();
    const { svc } = harness;
    const { received, relayEventId } = await relayOne(harness);
    expect(received).toHaveLength(1);

    await (svc as any).handleEntityEvent('user', {
      event_type: 'ENTITY_UTTERANCE',
      status: 'ERROR',
      event_id: relayEventId,
      payload: { error: 'boom' },
    }, harness.userConn);

    expect(received).toHaveLength(1);
  });

  it('ignores non-NEW utterance events that are not relay acks (e.g. acks of our own sends)', async () => {
    const harness = await startStartedSession();
    const { svc, charConn } = harness;
    const received: Array<{ interactionId: string; payload: any }> = [];
    svc.on('message:received', (interactionId: string, payload: any) => {
      received.push({ interactionId, payload });
    });

    // An ack of an outgoing send on the character socket: SUCCESS with an
    // event_id we never registered as a relay — must not leak the handler's
    // result payload into the UI.
    await (svc as any).handleEntityEvent('claire', {
      event_type: 'ENTITY_UTTERANCE',
      status: 'SUCCESS',
      event_id: 'evt-outgoing-send-ack',
      payload: { processed: true },
    }, charConn);

    expect(received).toHaveLength(0);
  });

  it('emits the ack nudge under the CANONICAL interaction id when the swap landed between relay and ack', async () => {
    const harness = await startStartedSession({ userInteractionId: 'ix-temp' });
    const { svc, session } = harness;
    const { received, relayEventId } = await relayOne(harness);
    expect(received).toHaveLength(1);

    // The canonical swap happens on the own entity's INIT SUCCESS — after a
    // queued relay flushed under the temp id. Simulate it: mutate the session
    // (the waiter holds the session reference, not the id).
    session.interactionId = 'ix-user-pov';

    await (svc as any).handleEntityEvent('user', {
      event_type: 'ENTITY_UTTERANCE',
      status: 'SUCCESS',
      event_id: relayEventId,
      payload: { recorded: true },
    }, harness.userConn);

    expect(received).toHaveLength(2);
    expect(received[1].interactionId).toBe('ix-user-pov');
  });
});
