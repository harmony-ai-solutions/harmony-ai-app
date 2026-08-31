import { getDatabase } from '../connection';
import { ConversationMessage } from '../models';
import { loadTextColumn } from '../sync';

/**
 * Create a new chat message
 */
export async function createConversationMessage(
  message: Omit<ConversationMessage, 'created_at' | 'updated_at' | 'deleted_at'>
): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();

  await db.executeSql(
    `INSERT INTO conversation_messages (
      id, entity_id, sender_entity_id, interaction_id, content,
      audio_duration, message_type, audio_data, audio_mime_type,
      image_data, image_mime_type, vl_model, vl_model_interpretation,
      emotional_state_bits,
      is_recon_followup, is_edited, edit_of_message_id,
      reactions_json, reply_to_message_id, is_pinned,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      message.id,
      message.entity_id,
      message.sender_entity_id,
      message.interaction_id,
      message.content,
      message.audio_duration,
      message.message_type,
      message.audio_data,
      message.audio_mime_type,
      message.image_data,
      message.image_mime_type,
      message.vl_model,
      message.vl_model_interpretation,
      message.emotional_state_bits ?? 0,
      message.is_recon_followup ? 1 : 0,
      message.is_edited ? 1 : 0,
      message.edit_of_message_id ?? null,
      message.reactions_json ?? null,
      message.reply_to_message_id ?? null,
      message.is_pinned ? 1 : 0,
      now,
      now,
    ]
  );
}

/**
 * Get conversation messages for a specific interaction by participant_key.
 * Used for ChatDetailScreen for both initial load and scrollback.
 *
 * Queries via JOIN on interactions table using participant_key scope.
 * Ordered chronologically (oldest first) for paginated results.
 *
 * Uses two-phase query and chunking to avoid CursorWindow overflow.
 */
export async function getConversationMessagesByParticipantKey(
  entityId: string,
  participantKey: string,
  limit: number = 20,
  beforeTimestamp?: string
): Promise<ConversationMessage[]> {
  const db = getDatabase();

  // Phase 1: Get metadata without BLOBs via JOIN
  let query = `
    SELECT cm.id, cm.entity_id, cm.sender_entity_id, cm.interaction_id, cm.content,
           cm.audio_duration, cm.message_type, cm.audio_mime_type,
           cm.image_mime_type, cm.vl_model, cm.vl_model_interpretation,
           cm.emotional_state_bits,
           cm.is_recon_followup, cm.is_edited, cm.edit_of_message_id,
           cm.reactions_json, cm.reply_to_message_id, cm.is_pinned, cm.is_read,
           cm.created_at, cm.updated_at, cm.deleted_at
    FROM conversation_messages cm
    JOIN interactions i ON cm.interaction_id = i.id
    WHERE i.entity_id = ?
      AND i.participant_key = ?
      AND i.presence_type = 'phone'
      AND cm.deleted_at IS NULL
  `;
  const params: any[] = [entityId, participantKey];

  if (beforeTimestamp) {
    query += ` AND CAST(strftime('%s', cm.created_at) AS INTEGER) < ?`;
    params.push(beforeTimestamp);
  }

  query += ` ORDER BY cm.created_at DESC LIMIT ?`;
  params.push(limit);

  const [results] = await db.executeSql(query, params);

  // Phase 2: Load each message's TEXT columns individually with chunking
  const messages: ConversationMessage[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);

    // Load TEXT columns individually with chunking
    const audioData = await loadTextColumn('conversation_messages', row.id, 'audio_data');
    const imageData = await loadTextColumn('conversation_messages', row.id, 'image_data');

    messages.push({
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
      reactions_json: row.reactions_json || null,
      reply_to_message_id: row.reply_to_message_id || null,
      is_pinned: row.is_pinned === 1,
      is_read: row.is_read === 1,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
    });
  }

  // Return in chronological order (oldest first) for display
  return messages.reverse();
}

/**
 * Get most recent conversation messages for a participant_key (for initial load).
 * Returns the N most recent messages in chronological order.
 *
 * Uses two-phase query and chunking to avoid CursorWindow overflow.
 * Replaced the old getRecentConversationMessages which used OR-pattern.
 */
export async function getRecentConversationMessages(
  entityId: string,
  participantKey: string,
  limit: number = 20
): Promise<ConversationMessage[]> {
  const db = getDatabase();

  // First get the IDs ordered by newest first via JOIN
  const [idResults] = await db.executeSql(
    `SELECT cm.id FROM conversation_messages cm
     JOIN interactions i ON cm.interaction_id = i.id
     WHERE i.entity_id = ?
       AND i.participant_key = ?
       AND i.presence_type = 'phone'
       AND cm.deleted_at IS NULL
     ORDER BY cm.created_at DESC
     LIMIT ?`,
    [entityId, participantKey, limit]
  );

  if (idResults.rows.length === 0) return [];

  // Extract IDs
  const ids: string[] = [];
  for (let i = 0; i < idResults.rows.length; i++) {
    ids.push(idResults.rows.item(i).id);
  }

  // Now fetch full records (metadata) in chronological order
  const placeholders = ids.map(() => '?').join(',');
  const [results] = await db.executeSql(
    `SELECT cm.id, cm.entity_id, cm.sender_entity_id, cm.interaction_id, cm.content,
            cm.audio_duration, cm.message_type, cm.audio_mime_type,
            cm.image_mime_type, cm.vl_model, cm.vl_model_interpretation,
            cm.emotional_state_bits,
            cm.is_recon_followup, cm.is_edited, cm.edit_of_message_id,
            cm.reactions_json, cm.reply_to_message_id, cm.is_pinned, cm.is_read,
            cm.created_at, cm.updated_at, cm.deleted_at
     FROM conversation_messages cm
     WHERE cm.id IN (${placeholders})
     ORDER BY cm.created_at ASC`,
    ids
  );

  // Phase 2: Load each message's TEXT columns individually with chunking
  const messages: ConversationMessage[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);

    // Load TEXT columns individually with chunking
    const audioData = await loadTextColumn('conversation_messages', row.id, 'audio_data');
    const imageData = await loadTextColumn('conversation_messages', row.id, 'image_data');

    messages.push({
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
      reactions_json: row.reactions_json || null,
      reply_to_message_id: row.reply_to_message_id || null,
      is_pinned: row.is_pinned === 1,
      is_read: row.is_read === 1,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
    });
  }
  return messages;
}

/**
 * Get last message for chat list preview using JOIN-based query.
 * Replaced the old getLastConversationMessage which used OR-pattern.
 *
 * Uses two-phase query and chunking to avoid CursorWindow overflow.
 */
export async function getLastConversationMessage(
  entityId: string,
  participantKey: string
): Promise<ConversationMessage | null> {
  const db = getDatabase();

  // Phase 1: Get metadata for the last message via JOIN
  const [results] = await db.executeSql(
    `SELECT cm.id, cm.entity_id, cm.sender_entity_id, cm.interaction_id, cm.content,
            cm.audio_duration, cm.message_type, cm.audio_mime_type,
            cm.image_mime_type, cm.vl_model, cm.vl_model_interpretation,
            cm.emotional_state_bits,
            cm.is_recon_followup, cm.is_edited, cm.edit_of_message_id,
            cm.reactions_json, cm.reply_to_message_id, cm.is_pinned, cm.is_read,
            cm.created_at, cm.updated_at, cm.deleted_at
     FROM conversation_messages cm
     JOIN interactions i ON cm.interaction_id = i.id
     WHERE i.entity_id = ?
       AND i.participant_key = ?
       AND i.presence_type = 'phone'
       AND cm.deleted_at IS NULL
     ORDER BY cm.created_at DESC
     LIMIT 1`,
    [entityId, participantKey]
  );

  if (results.rows.length === 0) return null;
  const row = results.rows.item(0);

  // Phase 2: Load TEXT columns with chunking
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
    reactions_json: row.reactions_json || null,
    reply_to_message_id: row.reply_to_message_id || null,
    is_pinned: row.is_pinned === 1,
    is_read: row.is_read === 1,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

/**
 * Check if message exists (for duplicate prevention)
 */
export async function messageExists(id: string): Promise<boolean> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT 1 FROM conversation_messages WHERE id = ?',
    [id]
  );
  return results.rows.length > 0;
}

/**
 * Update an existing chat message
 * Used primarily for adding transcription to audio messages
 */
export async function updateConversationMessage(
  messageId: string,
  updates: Partial<ConversationMessage>
): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();

  // Build SET clause dynamically based on provided fields
  const updateFields: string[] = [];
  const values: any[] = [];

  if (updates.content !== undefined) {
    updateFields.push('content = ?');
    values.push(updates.content);
  }

  if (updates.message_type !== undefined) {
    updateFields.push('message_type = ?');
    values.push(updates.message_type);
  }

  if (updates.audio_data !== undefined) {
    updateFields.push('audio_data = ?');
    values.push(updates.audio_data);
  }

  if (updates.audio_mime_type !== undefined) {
    updateFields.push('audio_mime_type = ?');
    values.push(updates.audio_mime_type);
  }

  if (updates.audio_duration !== undefined) {
    updateFields.push('audio_duration = ?');
    values.push(updates.audio_duration);
  }

  if (updates.image_data !== undefined) {
    updateFields.push('image_data = ?');
    values.push(updates.image_data);
  }

  if (updates.image_mime_type !== undefined) {
    updateFields.push('image_mime_type = ?');
    values.push(updates.image_mime_type);
  }

  if (updates.interaction_id !== undefined) {
    updateFields.push('interaction_id = ?');
    values.push(updates.interaction_id);
  }

  if (updates.is_recon_followup !== undefined) {
    updateFields.push('is_recon_followup = ?');
    values.push(updates.is_recon_followup ? 1 : 0);
  }

  if (updates.is_edited !== undefined) {
    updateFields.push('is_edited = ?');
    values.push(updates.is_edited ? 1 : 0);
  }

  if (updates.edit_of_message_id !== undefined) {
    updateFields.push('edit_of_message_id = ?');
    values.push(updates.edit_of_message_id ?? null);
  }

  if (updates.reactions_json !== undefined) {
    updateFields.push('reactions_json = ?');
    values.push(updates.reactions_json ?? null);
  }

  if (updates.reply_to_message_id !== undefined) {
    updateFields.push('reply_to_message_id = ?');
    values.push(updates.reply_to_message_id ?? null);
  }

  if (updates.is_pinned !== undefined) {
    updateFields.push('is_pinned = ?');
    values.push(updates.is_pinned ? 1 : 0);
  }

  if (updateFields.length === 0) {
    throw new Error('No fields to update');
  }

  updateFields.push('updated_at = ?');
  values.push(now);

  // Add message ID to values
  values.push(messageId);

  const sql = `
    UPDATE conversation_messages 
    SET ${updateFields.join(', ')}
    WHERE id = ?
  `;

  await db.executeSql(sql, values);
}

/**
 * Get a single chat message by ID
 */
export async function getConversationMessage(
  messageId: string
): Promise<ConversationMessage | null> {
  const db = getDatabase();

  const [result] = await db.executeSql(
    'SELECT * FROM conversation_messages WHERE id = ? AND deleted_at IS NULL',
    [messageId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows.item(0);
  return mapRowToConversationMessage(row);
}

/**
 * Delete chat message (soft delete)
 */
export async function deleteConversationMessage(id: string): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();
  await db.executeSql(
    'UPDATE conversation_messages SET deleted_at = ?, updated_at = ? WHERE id = ?',
    [now, now, id]
  );
}

/**
 * Delete an entire conversation (soft delete) by participant_key + entity_id.
 *
 * Soft-deletes the messages AND the owning interaction row so the chat
 * disappears from the chat list. Used by the chat-list "Delete" long-press
 * action. Deleting the interaction's messages with the entity scope predicate
 * matches the deleteEntity cascade convention (never touch conversations
 * rooted at another entity).
 *
 * F3 cascade: also DELETEs the `chat_conversation_settings` row for the key so
 * no stale pinned/muted/archived/disabled/unread state resurrects when the
 * conversation is re-created (the settings table has no FK to interactions, so
 * this is an explicit repo-level cascade).
 */
export async function deleteConversationByParticipantKey(
  entityId: string,
  participantKey: string,
): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();

  const [interactions] = await db.executeSql(
    'SELECT id FROM interactions WHERE entity_id = ? AND participant_key = ? AND deleted_at IS NULL',
    [entityId, participantKey],
  );

  const interactionIds: string[] = [];
  for (let i = 0; i < interactions.rows.length; i++) {
    interactionIds.push(interactions.rows.item(i).id as string);
  }

  for (const interactionId of interactionIds) {
    await db.executeSql(
      `UPDATE conversation_messages SET deleted_at = ?, updated_at = ?
       WHERE interaction_id = ? AND deleted_at IS NULL`,
      [now, now, interactionId],
    );
    await db.executeSql(
      `UPDATE interactions SET deleted_at = ?, updated_at = ?
       WHERE id = ?`,
      [now, now, interactionId],
    );
  }

  // F3: drop the client-only settings row (pinned / archived / muted /
  // disabled / unread_count) so deleted conversations never resurrect stale
  // badge or preference state.
  await db.executeSql(
    'DELETE FROM chat_conversation_settings WHERE participant_key = ?',
    [participantKey],
  );
}

// ============================================================================
// Derived unread (A5 pull-forward) — is_read is the single source of read state
// ============================================================================
// Every query scopes `cm.entity_id = own POV` (A2): engine-perspective copies
// sync in under different uuids joining the same interaction_id; unscoped
// queries double-count / double-render. Own-sent messages always stay is_read=0.

/**
 * Mark every partner-sent, unread, non-deleted message in the conversation
 * (identified by participant_key scoped to the POV entity) as read. Returns the
 * number of rows updated.
 *
 * @param participantKey the conversation key (interactions.participant_key)
 * @param ownEntityId   the POV entity id (A2 scope)
 * @param upToMessageId optional boundary — only messages created at-or-before
 *                      this message's created_at are marked
 */
export async function markConversationMessagesRead(
  participantKey: string,
  ownEntityId: string,
  upToMessageId?: string,
): Promise<number> {
  const db = getDatabase();
  const now = new Date().toISOString();

  let sql = `
    UPDATE conversation_messages
    SET is_read = 1, updated_at = ?
    WHERE id IN (
      SELECT cm.id
      FROM conversation_messages cm
      JOIN interactions i ON cm.interaction_id = i.id
      WHERE i.entity_id = ?
        AND i.participant_key = ?
        AND cm.entity_id = ?
        AND cm.sender_entity_id != ?
        AND cm.is_read = 0
        AND cm.deleted_at IS NULL
    `;
  const params: any[] = [now, ownEntityId, participantKey, ownEntityId, ownEntityId];

  if (upToMessageId) {
    sql += ` AND cm.created_at <= (
        SELECT created_at FROM conversation_messages WHERE id = ?
      )`;
    params.push(upToMessageId);
  }

  sql += ')';

  const [result] = await db.executeSql(sql, params);
  return result.rowsAffected ?? 0;
}

/**
 * Mark the LAST partner-sent message in the conversation as unread (set-to-1
 * semantics: exactly `count` messages, default 1). Used by the "mark unread"
 * context-menu action.
 *
 * @returns number of rows updated (0 or count)
 */
export async function markConversationMessagesUnread(
  participantKey: string,
  ownEntityId: string,
  count: number = 1,
): Promise<number> {
  const db = getDatabase();
  const now = new Date().toISOString();

  const [result] = await db.executeSql(
    `UPDATE conversation_messages
     SET is_read = 0, updated_at = ?
     WHERE id IN (
       SELECT cm.id
       FROM conversation_messages cm
       JOIN interactions i ON cm.interaction_id = i.id
       WHERE i.entity_id = ?
         AND i.participant_key = ?
         AND cm.entity_id = ?
         AND cm.sender_entity_id != ?
         AND cm.deleted_at IS NULL
       ORDER BY cm.created_at DESC
       LIMIT ?
     )`,
    [now, ownEntityId, participantKey, ownEntityId, ownEntityId, count],
  );
  return result.rowsAffected ?? 0;
}

/**
 * Batched unread counts (unread partner-sent, non-deleted, POV-scoped) keyed by
 * participant_key. Mirrors getChatConversationSettingsBatch's 300-key chunking.
 *
 * @param keys         conversation participant keys
 * @param ownEntityId  the POV entity id (A2 scope)
 */
export async function getUnreadCountByParticipantKeys(
  keys: string[],
  ownEntityId: string,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (keys.length === 0) return result;

  const db = getDatabase();
  const chunkSize = 300;
  for (let i = 0; i < keys.length; i += chunkSize) {
    const chunk = keys.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(', ');
    const [results] = await db.executeSql(
      `SELECT i.participant_key AS participant_key, COUNT(*) AS cnt
       FROM conversation_messages cm
       JOIN interactions i ON cm.interaction_id = i.id
       WHERE i.entity_id = ?
         AND i.participant_key IN (${placeholders})
         AND cm.entity_id = ?
         AND cm.sender_entity_id != ?
         AND cm.is_read = 0
         AND cm.deleted_at IS NULL
       GROUP BY i.participant_key`,
      [ownEntityId, ...chunk, ownEntityId, ownEntityId],
    );
    for (let j = 0; j < results.rows.length; j++) {
      const row = results.rows.item(j);
      result.set(row.participant_key, Number(row.cnt) || 0);
    }
  }
  return result;
}

// Helper function to map DB row to ConversationMessage
function mapRowToConversationMessage(row: any): ConversationMessage {
  return {
    id: row.id,
    entity_id: row.entity_id,
    sender_entity_id: row.sender_entity_id,
    interaction_id: row.interaction_id,
    content: row.content,
    audio_duration: row.audio_duration,
    message_type: row.message_type,
    audio_data: row.audio_data,
    audio_mime_type: row.audio_mime_type,
    image_data: row.image_data,
    image_mime_type: row.image_mime_type,
    vl_model: row.vl_model,
    vl_model_interpretation: row.vl_model_interpretation,
    emotional_state_bits: row.emotional_state_bits ?? 0,
    is_recon_followup: row.is_recon_followup === 1,
    is_edited: row.is_edited === 1,
    edit_of_message_id: row.edit_of_message_id || null,
    reactions_json: row.reactions_json || null,
    reply_to_message_id: row.reply_to_message_id || null,
    is_pinned: row.is_pinned === 1,
    is_read: row.is_read === 1,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}
