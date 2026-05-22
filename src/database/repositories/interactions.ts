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
 * 0 or 1 → "world", 2 → "private", 3+ → "group"
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
 * Derive the participant key for interaction lookup.
 * - private: sorted pair of entity IDs joined by "+"
 * - group: all sorted participant IDs joined by "+" (unique per participant set)
 * - world: "" (empty string)
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
