/**
 * Interaction Repository
 *
 * Provides CRUD operations for the interactions table.
 * Mirrors the Go implementation in harmony-link-private/database/repository/interaction/
 */

import { getDatabase } from '../connection';
import { Interaction, ConversationMessage } from '../models';
import { loadTextColumn } from '../sync';

// ============================================================================
// Derivation Functions (mirroring server-side logic)
// ============================================================================

/**
 * Derive the interaction scope from the number of participants:
 * 0 or 1 → "world", 2 → "private", 3+ → "group".
 *
 * ENGINE CONTRACT (mirrors harmony-link-private `DeriveScopeFromParticipants`,
 * interaction_controller.go): `participantIds` is the FULL participant set
 * INCLUDING the own entity. The own entity is part of the participant key
 * EVERYWHERE (O3 ruling) — private/group scopes embed it; world has no key.
 */
export function deriveScopeFromParticipants(participantIds: string[]): string {
  const count = participantIds.length;
  if (count <= 1) {
    return 'world';
  } else if (count === 2) {
    return 'private';
  }
  return 'group';
}

/**
 * Derive the participant key for interaction lookup — EXACT engine contract
 * (harmony-link-private `DeriveParticipantKey`, interaction_controller.go):
 * - private: sorted pair of "own entity + partner" joined by "+" (the own
 *   entity is ALWAYS in the key — per-persona semantics: two personas are
 *   distinct entity ids, so each persona derives its OWN pair key and its
 *   own conversation with the same partner)
 * - group: ALL sorted participant IDs joined by "+" (unique per participant
 *   set — the set ALWAYS includes the own entity; overlapping groups like
 *   own+alice+bob vs own+alice+dave must NOT collide)
 * - world: "" (empty string)
 *
 * CALLER CONVENTION: `participantIds` MUST include the own entity (`entityId`)
 * — every app caller passes the full participant set (session.participantIds,
 * or route params built as [ownEntityId, ...partners]) exactly like the engine
 * (FindActiveInteractionForPartner passes []string{entityID, partnerEntityID};
 * ResolveInteraction receives sets that include the own entity). The function
 * tolerates the own entity being absent (pairs own with the first other —
 * engine parity, see engine TestDeriveParticipantKey_OwnEntityNotInSet), but
 * that is NOT the caller convention.
 */
export function deriveParticipantKey(
  participantIds: string[],
  entityId: string,
  scope: string
): string {
  const count = participantIds.length;
  if (count <= 1) {
    return '';
  }

  if (scope === 'private' || count === 2) {
    // Private: sorted pair of own entity + partner
    const partner = participantIds.find(id => id !== entityId);
    if (!partner) {
      return '';
    }
    // Sort alphabetically for deterministic key
    return entityId < partner ? `${entityId}+${partner}` : `${partner}+${entityId}`;
  }

  // Group: sorted full participant set joined by "+"
  const sorted = [...participantIds].sort();
  return sorted.join('+');
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Get a single interaction by ID
 */
export async function getInteractionById(
  id: string
): Promise<Interaction | null> {
  const db = getDatabase();

  const [results] = await db.executeSql(
    'SELECT * FROM interactions WHERE id = ?',
    [id]
  );

  if (results.rows.length === 0) {
    return null;
  }

  return mapRowToInteraction(results.rows.item(0));
}

/**
 * Get all active (non-deleted, status='active') interactions for an entity
 */
export async function getActiveInteractionsByEntity(
  entity_id: string
): Promise<Interaction[]> {
  const db = getDatabase();

  const [results] = await db.executeSql(
    `SELECT * FROM interactions
     WHERE entity_id = ? AND status = 'active' AND deleted_at IS NULL`,
    [entity_id]
  );

  const interactions: Interaction[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    interactions.push(mapRowToInteraction(results.rows.item(i)));
  }

  return interactions;
}

/**
 * Find the most recent active interaction for an entity by participant_key
 */
export async function getInteractionByParticipantKey(
  entity_id: string,
  participant_key: string
): Promise<Interaction | null> {
  const db = getDatabase();

  const [results] = await db.executeSql(
    `SELECT * FROM interactions
     WHERE entity_id = ? AND participant_key = ? AND status = 'active' AND deleted_at IS NULL
     ORDER BY last_activity_at DESC LIMIT 1`,
    [entity_id, participant_key]
  );

  if (results.rows.length === 0) {
    return null;
  }

  return mapRowToInteraction(results.rows.item(0));
}

/**
 * Create a new interaction
 */
export async function createInteraction(
  interaction: Interaction
): Promise<void> {
  const db = getDatabase();

  await db.executeSql(
    `INSERT INTO interactions (
      id, entity_id, interaction_scope, participant_key, participant_ids,
      status, started_at, last_activity_at, ended_at,
      memory_id, continued_interaction_id, metadata, summary, presence_type,
      created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      interaction.id,
      interaction.entity_id,
      interaction.interaction_scope,
      interaction.participant_key,
      interaction.participant_ids,
      interaction.status,
      interaction.started_at,
      interaction.last_activity_at,
      interaction.ended_at,
      interaction.memory_id,
      interaction.continued_interaction_id,
      interaction.metadata,
      interaction.summary,
      interaction.presence_type,
      interaction.created_at,
      interaction.updated_at,
      interaction.deleted_at,
    ]
  );
}

/**
 * Update an existing interaction
 */
export async function updateInteraction(
  interaction: Interaction
): Promise<void> {
  const db = getDatabase();

  await db.executeSql(
    `UPDATE interactions SET
      entity_id = ?, interaction_scope = ?, participant_key = ?, participant_ids = ?,
      status = ?, started_at = ?, last_activity_at = ?, ended_at = ?,
      memory_id = ?, continued_interaction_id = ?, metadata = ?, summary = ?,
      presence_type = ?, updated_at = ?, deleted_at = ?
     WHERE id = ?`,
    [
      interaction.entity_id,
      interaction.interaction_scope,
      interaction.participant_key,
      interaction.participant_ids,
      interaction.status,
      interaction.started_at,
      interaction.last_activity_at,
      interaction.ended_at,
      interaction.memory_id,
      interaction.continued_interaction_id,
      interaction.metadata,
      interaction.summary,
      interaction.presence_type,
      interaction.updated_at,
      interaction.deleted_at,
      interaction.id,
    ]
  );
}

/**
 * Get recent phone interactions for an entity (used for chat list)
 */
export async function getRecentPhoneInteractions(
  entity_id: string,
  limit: number = 50
): Promise<Interaction[]> {
  const db = getDatabase();

  const [results] = await db.executeSql(
    `SELECT * FROM interactions
     WHERE entity_id = ? AND presence_type = 'phone' AND deleted_at IS NULL
     ORDER BY last_activity_at DESC LIMIT ?`,
    [entity_id, limit]
  );

  const interactions: Interaction[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    interactions.push(mapRowToInteraction(results.rows.item(i)));
  }

  return interactions;
}

/**
 * One row per phone conversation (deduped by participant_key) for the chat
 * list's paginated load-more. Recency is the conversation's LAST MESSAGE
 * `created_at` (not `interactions.last_activity_at`), so a conversation whose
 * interaction row is old but which just received a message sorts/pages by the
 * message, matching the in-list sort (F6/O11).
 *
 * Conversations without any message sort last (NULL `last_message_at`).
 * `interaction_id` is the lexicographically-greatest interaction id of the
 * participant_key group (all rows of a key share scope/participants, so any
 * id navigates to the same conversation — ChatDetail resolves via
 * participantKey).
 */
export interface PhoneConversationPageRow {
  interactionId: string;
  interactionScope: string;
  participantKey: string;
  participantIds: string;
}

export async function getPhoneConversationsPage(
  entity_id: string,
  options: { limit: number; offset: number },
): Promise<PhoneConversationPageRow[]> {
  const db = getDatabase();

  const [results] = await db.executeSql(
    `SELECT MAX(i.id) AS interaction_id,
            i.interaction_scope AS interaction_scope,
            i.participant_key AS participant_key,
            i.participant_ids AS participant_ids
     FROM interactions i
     LEFT JOIN conversation_messages cm
            ON cm.interaction_id = i.id AND cm.deleted_at IS NULL
     WHERE i.entity_id = ?
       AND i.presence_type = 'phone'
       AND i.deleted_at IS NULL
       AND i.participant_key IS NOT NULL
       AND i.participant_key != ''
     GROUP BY i.participant_key
     ORDER BY MAX(cm.created_at) DESC, MAX(i.updated_at) DESC
     LIMIT ? OFFSET ?`,
    [entity_id, options.limit, options.offset],
  );

  const rows: PhoneConversationPageRow[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    rows.push({
      interactionId: row.interaction_id,
      interactionScope: row.interaction_scope,
      participantKey: row.participant_key,
      participantIds: row.participant_ids,
    });
  }
  return rows;
}

/**
 * Check if an entity has any phone interactions (regardless of status or messages).
 * Used to determine if an entity should be shown in the "no messages yet" section.
 *
 * @param entityId - The entity to check
 * @param partnerEntityId - The potential chat partner
 * @returns true if a phone interaction exists between these entities
 */
export async function entityHasPhoneInteraction(
  entityId: string,
  partnerEntityId: string
): Promise<boolean> {
  const db = getDatabase();
  
  // Derive the participant key (same logic as deriveParticipantKey)
  const participantKey = entityId < partnerEntityId
    ? `${entityId}+${partnerEntityId}`
    : `${partnerEntityId}+${entityId}`;

  const [results] = await db.executeSql(
    `SELECT 1 FROM interactions
     WHERE entity_id = ?
       AND participant_key = ?
       AND presence_type = 'phone'
       AND deleted_at IS NULL
     LIMIT 1`,
    [entityId, participantKey]
  );

  return results.rows.length > 0;
}

/**
 * Get the last conversation message for an interaction identified by
 * entity_id and participant_key with presence_type = 'phone'.
 * Used for chat list preview.
 *
 * Uses two-phase TEXT column loading for large audio/image data.
 */
export async function getLastInteractionMessage(
  entity_id: string,
  participant_key: string
): Promise<ConversationMessage | null> {
  const db = getDatabase();

  const [results] = await db.executeSql(
    `SELECT cm.id, cm.entity_id, cm.sender_entity_id, cm.interaction_id,
            cm.content, cm.audio_duration, cm.message_type,
            cm.audio_mime_type, cm.image_mime_type,
            cm.vl_model, cm.vl_model_interpretation,
            cm.emotional_state_bits,
            cm.is_recon_followup, cm.is_edited, cm.edit_of_message_id,
            cm.created_at, cm.updated_at, cm.deleted_at
     FROM conversation_messages cm
     JOIN interactions i ON cm.interaction_id = i.id
     WHERE i.entity_id = ?
       AND i.participant_key = ?
       AND i.presence_type = 'phone'
       AND cm.deleted_at IS NULL
     ORDER BY cm.created_at DESC LIMIT 1`,
    [entity_id, participant_key]
  );

  if (results.rows.length === 0) {
    return null;
  }

  const row = results.rows.item(0);

  // Load TEXT columns individually with chunking
  const audioData = await loadTextColumn('conversation_messages', row.id, 'audio_data');
  const imageData = await loadTextColumn('conversation_messages', row.id, 'image_data');

  return {
    id: row.id,
    entity_id: row.entity_id,
    sender_entity_id: row.sender_entity_id,
    interaction_id: row.interaction_id,
    content: row.content,
    audio_duration: row.audio_duration,
    message_type: row.message_type,
    audio_data: audioData,
    audio_mime_type: row.audio_mime_type,
    image_data: imageData,
    image_mime_type: row.image_mime_type,
    vl_model: row.vl_model,
    vl_model_interpretation: row.vl_model_interpretation,
    emotional_state_bits: row.emotional_state_bits ?? 0,
    is_recon_followup: row.is_recon_followup === 1,
    is_edited: row.is_edited === 1,
    edit_of_message_id: row.edit_of_message_id || null,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Map a database row to an Interaction model
 */
function mapRowToInteraction(row: any): Interaction {
  return {
    id: row.id,
    entity_id: row.entity_id,
    interaction_scope: row.interaction_scope,
    participant_key: row.participant_key ?? null,
    participant_ids: row.participant_ids,
    status: row.status,
    started_at: row.started_at,
    last_activity_at: row.last_activity_at,
    ended_at: row.ended_at ?? null,
    memory_id: row.memory_id ?? null,
    continued_interaction_id: row.continued_interaction_id ?? null,
    metadata: row.metadata ?? null,
    summary: row.summary ?? null,
    presence_type: row.presence_type,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at ?? null,
  };
}
