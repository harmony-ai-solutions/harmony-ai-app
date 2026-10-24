/**
 * ParticipantBroadcastPolicy — the routing seam (design §A, participant-broadcast).
 *
 * ChatroomPolicy is the phone app's trivial rule: a Chatroom where every
 * participant sees every utterance. These tests pin the two halves the relay
 * depends on:
 *  - outgoing → every ACTIVE participant session (including the app's own
 *    `user` session, which triggers the engine's Session Utterance Recorder);
 *  - incoming → every OTHER participant session, and ONLY from a
 *    cognition-bearing origin (the directional loop-safety rule).
 */
import {
  ChatroomPolicy,
  hasCognition,
  COGNITION_CAPABILITY,
} from '../participantBroadcastPolicy';
import type { BroadcastParticipant } from '../participantBroadcastPolicy';

const utterance = { messageId: 'msg-1', senderEntityId: 'claire' };

function participant(
  overrides: Partial<BroadcastParticipant> & Pick<BroadcastParticipant, 'entityId' | 'connectionId'>,
): BroadcastParticipant {
  return {
    status: 'active',
    capabilities: [],
    isOwn: false,
    ...overrides,
  };
}

const userSession = participant({
  entityId: 'user',
  connectionId: 'entity-user-key',
  isOwn: true,
  capabilities: ['stt', 'tts'],
});
const characterSession = participant({
  entityId: 'claire',
  connectionId: 'entity-claire-key',
  capabilities: [COGNITION_CAPABILITY, 'tts'],
});

describe('hasCognition', () => {
  it('is true only when the engine advertised the cognition capability', () => {
    expect(hasCognition(characterSession)).toBe(true);
    expect(hasCognition(userSession)).toBe(false);
    expect(hasCognition(participant({ entityId: 'x', connectionId: 'c' }))).toBe(false);
  });
});

describe('ChatroomPolicy — outgoing', () => {
  const policy = new ChatroomPolicy();

  it('routes to ALL participant sessions, including the app own user session', () => {
    expect(policy.routeOutgoing(utterance, [characterSession, userSession])).toEqual([
      'entity-claire-key',
      'entity-user-key',
    ]);
  });

  it('skips sessions that are not active (nothing to send on)', () => {
    const connecting = participant({
      entityId: 'claire',
      connectionId: 'entity-claire-key',
      status: 'connecting',
      capabilities: [COGNITION_CAPABILITY],
    });
    expect(policy.routeOutgoing(utterance, [connecting, userSession])).toEqual([
      'entity-user-key',
    ]);
  });
});

describe('ChatroomPolicy — incoming relay (directional)', () => {
  const policy = new ChatroomPolicy();

  it('relays a cognition-bearing session utterance to every OTHER local session', () => {
    expect(
      policy.routeIncoming(utterance, characterSession, [characterSession, userSession]),
    ).toEqual(['entity-user-key']);
  });

  it('NEVER relays an utterance that arrived on the own (user) session onward', () => {
    expect(policy.routeIncoming(utterance, userSession, [characterSession, userSession])).toEqual(
      [],
    );
  });

  it('does not relay from a session without cognition (no POV author to fan out)', () => {
    const noCognitionPartner = participant({
      entityId: 'npc',
      connectionId: 'entity-npc-key',
      capabilities: ['tts'],
    });
    expect(
      policy.routeIncoming(utterance, noCognitionPartner, [
        characterSession,
        noCognitionPartner,
        userSession,
      ]),
    ).toEqual([]);
  });

  it('excludes the origin socket itself and disconnected destinations', () => {
    const disconnected = participant({
      entityId: 'marcella',
      connectionId: 'entity-marcella-key',
      status: 'disconnected',
      capabilities: [COGNITION_CAPABILITY],
    });
    expect(
      policy.routeIncoming(utterance, characterSession, [
        characterSession,
        disconnected,
        userSession,
      ]),
    ).toEqual(['entity-user-key']);
  });

  it('queues (returns) a connecting destination so the service can flush it later', () => {
    const connectingUser = participant({
      entityId: 'user',
      connectionId: 'entity-user-key',
      status: 'connecting',
      isOwn: true,
      capabilities: ['stt'],
    });
    expect(
      policy.routeIncoming(utterance, characterSession, [characterSession, connectingUser]),
    ).toEqual(['entity-user-key']);
  });
});
