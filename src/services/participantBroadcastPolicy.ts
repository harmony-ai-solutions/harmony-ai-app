/**
 * Participant broadcast policy — where "which participant sessions may see this
 * utterance?" lives (design §A, participant-broadcast).
 *
 * The app holds ONE entity session (WebSocket) per participant of the open
 * interaction. An utterance produced here must reach every participant's POV:
 * the AI partner's session feeds cognition (which authors that POV), and the
 * user persona's session feeds the engine's Session Utterance Recorder (which
 * authors the user POV). Symmetrically, an AI reply that arrives on a
 * cognition-bearing session must be relayed onto the other local participant
 * sessions so their POV copies are authored too.
 *
 * This seam is deliberately tiny: the shipped {@link ChatroomPolicy} is the
 * trivial "everyone in the conversation sees it" rule. Game plugins can supply
 * their own implementation later (visibility gates, spectators, hidden speech)
 * without touching EntitySessionService.
 */

/** Engine capability flag advertised in INIT_ENTITY SUCCESS for cognition. */
export const COGNITION_CAPABILITY = 'cognition';

/**
 * One participant session of the current interaction, in the shape the policy
 * needs. `capabilities` comes from the engine's INIT_ENTITY SUCCESS payload
 * (empty while unknown — that session is not relay-readable yet).
 */
export interface BroadcastParticipant {
  entityId: string;
  connectionId: string;
  status: 'connecting' | 'active' | 'disconnected';
  /** Engine-advertised capabilities (`'cognition'` = the entity authors its POV). */
  capabilities: string[];
  /** True for the app's own POV entity (the impersonated persona, e.g. 'user'). */
  isOwn: boolean;
}

/** The utterance facts a routing decision may depend on. */
export interface RoutedUtterance {
  /** Wire message id — the cross-POV idempotency key (client- or engine-minted). */
  messageId: string;
  /** Who spoke (payload.entity_id). */
  senderEntityId: string;
  /** Wire message type, when the payload carries one (e.g. 'greeting'). */
  messageType?: string;
}

/**
 * Routing seam: given an outgoing utterance (or an utterance that just arrived
 * on `origin`), return the connection ids of the participant sessions that must
 * receive it.
 */
export interface ParticipantBroadcastPolicy {
  /** Outgoing: the user spoke in the app. */
  routeOutgoing(
    utterance: RoutedUtterance,
    participants: BroadcastParticipant[],
  ): string[];

  /**
   * Incoming relay: an ENTITY_UTTERANCE was emitted by the engine on `origin`'s
   * session (normally a cognition-bearing AI response or greeting). Return the
   * OTHER local participant sessions that must receive the same payload.
   */
  routeIncoming(
    utterance: RoutedUtterance,
    origin: BroadcastParticipant,
    participants: BroadcastParticipant[],
  ): string[];
}

/** True when the engine reported cognition for this participant's session. */
export function hasCognition(participant: BroadcastParticipant): boolean {
  return participant.capabilities.includes(COGNITION_CAPABILITY);
}

/**
 * The phone app's default policy: a Chatroom. Everyone in the interaction sees
 * every utterance; the AI POV is authored by cognition on its own session and
 * the user POV by the engine recorder on the user session.
 *
 * Loop safety is structural, not optional:
 *  - outgoing goes to every ACTIVE participant (including the app's own
 *    `user` session, which triggers the recorder);
 *  - incoming is relayed ONLY from a cognition-bearing, non-own session. An
 *    utterance arriving on the user's own session is never relayed onward —
 *    forwarding it to the character would re-enter cognition and duplicate
 *    AI responses.
 */
export class ChatroomPolicy implements ParticipantBroadcastPolicy {
  routeOutgoing(
    _utterance: RoutedUtterance,
    participants: BroadcastParticipant[],
  ): string[] {
    return participants
      .filter(participant => participant.status === 'active')
      .map(participant => participant.connectionId);
  }

  routeIncoming(
    _utterance: RoutedUtterance,
    origin: BroadcastParticipant,
    participants: BroadcastParticipant[],
  ): string[] {
    // Directional rule: only a cognition-bearing participant authors a POV copy
    // worth relaying, and the app's own session must never be relayed onward
    // (it would re-enter the character's cognition and produce a second reply).
    if (origin.isOwn || !hasCognition(origin)) {
      return [];
    }
    return participants
      .filter(
        participant =>
          participant.connectionId !== origin.connectionId &&
          participant.status !== 'disconnected',
      )
      .map(participant => participant.connectionId);
  }
}
