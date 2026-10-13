/**
 * Interactions — management-API-backed repository adapter (task 3-2).
 *
 * Backed by the 3-1b read endpoint
 * `GET /api/entities/:id/interactions` (+ the chat-list / messages
 * endpoints for the derived reads). Implements the *read* surface of the
 * existing `src/database/repositories/interactions.ts` interface; write paths
 * have no management endpoint yet and throw {@link EngineApiUnsupportedError}.
 */

import type { ConversationMessage, Interaction } from '../../../database/models';
import { engineApiClient } from '../EngineApiClient';
import type { InteractionDto } from '../EngineApiClient';
import { mapConversationMessage, mapInteraction } from '../engineApiMappers';
import { EngineApiUnsupportedError } from '../EngineApiClient';

/** One row of the paginated phone-conversation list (re-homed from the SQLite repo). */
export interface PhoneConversationPageRow {
  interactionId: string;
  interactionScope: string;
  participantKey: string;
  participantIds: string;
}

/**
 * Derive the interaction scope from the number of participants:
 * 0/1 → "world", 2 → "private", 3+ → "group" (engine contract).
 */
export function deriveScopeFromParticipants(participantIds: string[]): string {
  const count = participantIds.length;
  if (count <= 1) return 'world';
  if (count === 2) return 'private';
  return 'group';
}

/**
 * Derive the participant key (engine contract): private → sorted own+partner
 * pair; group → sorted full set; world → "".
 */
export function deriveParticipantKey(
  participantIds: string[],
  entityId: string,
  scope: string,
): string {
  const count = participantIds.length;
  if (count <= 1) return '';
  if (scope === 'private' || count === 2) {
    const partner = participantIds.find(id => id !== entityId);
    if (!partner) return '';
    return entityId < partner ? `${entityId}+${partner}` : `${partner}+${entityId}`;
  }
  return [...participantIds].sort().join('+');
}

/** Find an interaction by id across every entity's interaction list. */
export async function getInteractionById(id: string): Promise<Interaction | null> {
  const entities = await engineApiClient.listEntities();
  for (const entityId of Object.keys(entities)) {
    const rows = await listInteractions(entityId, { limit: 200 });
    const match = rows.find(r => r.id === id);
    if (match) return mapInteraction(match);
  }
  return null;
}

/** Derive the sorted-pair participant key (mirrors the app/engine convention). */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}+${b}` : `${b}+${a}`;
}

async function listInteractions(
  entityId: string,
  filters: Parameters<typeof engineApiClient.entityInteractions>[1],
): Promise<InteractionDto[]> {
  const res = await engineApiClient.entityInteractions(entityId, filters);
  return res.interactions ?? [];
}

export async function getRecentPhoneInteractions(
  entity_id: string,
  limit: number = 50,
): Promise<Interaction[]> {
  const rows = await listInteractions(entity_id, { presence_type: 'phone', limit });
  return rows.map(mapInteraction);
}

export async function getActiveInteractionsByEntity(
  entity_id: string,
): Promise<Interaction[]> {
  const rows = await listInteractions(entity_id, { status: 'active', limit: 200 });
  return rows.map(mapInteraction);
}

export async function getInteractionByParticipantKey(
  entity_id: string,
  participant_key: string,
): Promise<Interaction | null> {
  const rows = await listInteractions(entity_id, {
    participant_key,
    status: 'active',
    limit: 1,
  });
  return rows.length > 0 ? mapInteraction(rows[0]) : null;
}

export async function getPhoneConversationsPage(
  entity_id: string,
  options: { limit: number; offset: number },
): Promise<PhoneConversationPageRow[]> {
  const res = await engineApiClient.entityChatList(entity_id, {
    limit: options.limit,
    offset: options.offset,
  });
  return (res.conversations ?? []).map(row => ({
    interactionId: row.interaction_id,
    interactionScope: row.interaction_scope,
    participantKey: row.participant_key,
    participantIds: row.participant_ids,
  }));
}

export async function entityHasPhoneInteraction(
  entityId: string,
  partnerEntityId: string,
): Promise<boolean> {
  const rows = await listInteractions(entityId, {
    presence_type: 'phone',
    participant_key: pairKey(entityId, partnerEntityId),
    limit: 1,
  });
  return rows.length > 0;
}

export async function getLastInteractionMessage(
  entity_id: string,
  participant_key: string,
): Promise<ConversationMessage | null> {
  // limit 1 with no `before` returns the newest message (the endpoint reverses
  // its newest-first page to chronological).
  const res = await engineApiClient.entityMessages(entity_id, participant_key, { limit: 1 });
  const rows = res.messages ?? [];
  if (rows.length === 0) return null;
  return mapConversationMessage(rows[rows.length - 1]);
}

export async function createInteraction(_interaction: Interaction): Promise<void> {
  throw new EngineApiUnsupportedError('createInteraction');
}

export async function updateInteraction(_interaction: Interaction): Promise<void> {
  throw new EngineApiUnsupportedError('updateInteraction');
}
