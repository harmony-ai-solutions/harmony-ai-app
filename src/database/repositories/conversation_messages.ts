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
      id, entity_id, sender_entity_id, session_id, content,
      audio_duration, message_type, audio_data, audio_mime_type,
      image_data, image_mime_type, vl_model, vl_model_interpretation, 
      vl_model_embedding, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      message.id,
      message.entity_id,
      message.sender_entity_id,
      message.session_id,
      message.content,
      message.audio_duration,
      message.message_type,
      message.audio_data,
      message.audio_mime_type,
      message.image_data,
      message.image_mime_type,
      message.vl_model,
      message.vl_model_interpretation,
      message.vl_model_embedding,
      now,
      now
    ]
  );
}

/**
 * Get chat messages between two entities (bidirectional conversation)
 * Ordered chronologically (oldest first)
 * 
 * Uses two-phase query and chunking to avoid CursorWindow overflow.
 */
export async function getConversationMessagesBetween(
  entityA: string,
  entityB: string,
  limit: number = 20,
  beforeTimestamp?: number
): Promise<ConversationMessage[]> {
  const db = getDatabase();
  
  // Phase 1: Get metadata without BLOBs
  let query = `
    SELECT id, entity_id, sender_entity_id, session_id, content,
           audio_duration, message_type, audio_mime_type,
           image_mime_type, vl_model, vl_model_interpretation,
           created_at, updated_at, deleted_at
    FROM conversation_messages 
    WHERE deleted_at IS NULL 
    AND (
      (entity_id = ? AND sender_entity_id = ?) OR
      (entity_id = ? AND sender_entity_id = ?)
    )
  `;
  const params: any[] = [entityA, entityB, entityB, entityA];
  
  if (beforeTimestamp) {
    query += ` AND CAST(strftime('%s', created_at) AS INTEGER) < ?`;
    params.push(beforeTimestamp);
  }
  
  query += ` ORDER BY created_at ASC LIMIT ?`;
  params.push(limit);
  
  const [results] = await db.executeSql(query, params);
  
  // Phase 2: Load each message's TEXT columns individually with chunking
  const messages: ConversationMessage[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    
    // Load TEXT columns individually with chunking
    const audioData = await loadTextColumn('conversation_messages', row.id, 'audio_data');
    const imageData = await loadTextColumn('conversation_messages', row.id, 'image_data');
    const embeddingData = await loadTextColumn('conversation_messages', row.id, 'vl_model_embedding');

    messages.push({
      id: row.id,
      entity_id: row.entity_id,
      sender_entity_id: row.sender_entity_id,
      session_id: row.session_id,
      content: row.content,
      audio_duration: row.audio_duration,
      message_type: row.message_type,
      audio_data: audioData,
      audio_mime_type: row.audio_mime_type,
      image_data: imageData,
      image_mime_type: row.image_mime_type,
      vl_model: row.vl_model,
      vl_model_interpretation: row.vl_model_interpretation,
      vl_model_embedding: embeddingData,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
    });
  }
  return messages;
}

/**
 * Get most recent chat messages between two entities (for initial load)
 * Ordered chronologically (oldest first of the batch)
 * 
 * Uses two-phase query and chunking to avoid CursorWindow overflow.
 */
export async function getRecentConversationMessages(
  entityA: string,
  entityB: string,
  limit: number = 20
): Promise<ConversationMessage[]> {
  const db = getDatabase();
  
  // First get the IDs ordered by newest first
  const [idResults] = await db.executeSql(
    `SELECT id FROM conversation_messages 
     WHERE deleted_at IS NULL 
     AND (
       (entity_id = ? AND sender_entity_id = ?) OR
       (entity_id = ? AND sender_entity_id = ?)
     )
     ORDER BY created_at DESC 
     LIMIT ?`,
    [entityA, entityB, entityB, entityA, limit]
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
    `SELECT id, entity_id, sender_entity_id, session_id, content,
            audio_duration, message_type, audio_mime_type,
            image_mime_type, vl_model, vl_model_interpretation,
            created_at, updated_at, deleted_at
     FROM conversation_messages 
     WHERE id IN (${placeholders})
     ORDER BY created_at ASC`,
    ids
  );
  
  // Phase 2: Load each message's TEXT columns individually with chunking
  const messages: ConversationMessage[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    
    // Load TEXT columns individually with chunking
    const audioData = await loadTextColumn('conversation_messages', row.id, 'audio_data');
    const imageData = await loadTextColumn('conversation_messages', row.id, 'image_data');
    const embeddingData = await loadTextColumn('conversation_messages', row.id, 'vl_model_embedding');

    messages.push({
      id: row.id,
      entity_id: row.entity_id,
      sender_entity_id: row.sender_entity_id,
      session_id: row.session_id,
      content: row.content,
      audio_duration: row.audio_duration,
      message_type: row.message_type,
      audio_data: audioData,
      audio_mime_type: row.audio_mime_type,
      image_data: imageData,
      image_mime_type: row.image_mime_type,
      vl_model: row.vl_model,
      vl_model_interpretation: row.vl_model_interpretation,
      vl_model_embedding: embeddingData,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
    });
  }
  return messages;
}

/**
 * Get last message for chat list preview
 * 
 * Uses two-phase query and chunking to avoid CursorWindow overflow.
 */
export async function getLastConversationMessage(
  entityA: string,
  entityB: string
): Promise<ConversationMessage | null> {
  const db = getDatabase();
  
  // Phase 1: Get metadata for the last message
  const [results] = await db.executeSql(
    `SELECT id, entity_id, sender_entity_id, session_id, content,
            audio_duration, message_type, audio_mime_type,
            image_mime_type, vl_model, vl_model_interpretation,
            created_at, updated_at, deleted_at
     FROM conversation_messages 
     WHERE deleted_at IS NULL 
     AND (
       (entity_id = ? AND sender_entity_id = ?) OR
       (entity_id = ? AND sender_entity_id = ?)
     )
     ORDER BY created_at DESC 
     LIMIT 1`,
    [entityA, entityB, entityB, entityA]
  );
  
  if (results.rows.length === 0) return null;
  const row = results.rows.item(0);

  // Phase 2: Load TEXT columns with chunking
  const audioData = await loadTextColumn('conversation_messages', row.id, 'audio_data');
  const imageData = await loadTextColumn('conversation_messages', row.id, 'image_data');
  const embeddingData = await loadTextColumn('conversation_messages', row.id, 'vl_model_embedding');

  return {
    id: row.id,
    entity_id: row.entity_id,
    sender_entity_id: row.sender_entity_id,
    session_id: row.session_id,
    content: row.content,
    audio_duration: row.audio_duration,
    message_type: row.message_type,
    audio_data: audioData,
    audio_mime_type: row.audio_mime_type,
    image_data: imageData,
    image_mime_type: row.image_mime_type,
    vl_model: row.vl_model,
    vl_model_interpretation: row.vl_model_interpretation,
    vl_model_embedding: embeddingData,
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

// Helper function to map DB row to ConversationMessage
function mapRowToConversationMessage(row: any): ConversationMessage {
  return {
    id: row.id,
    entity_id: row.entity_id,
    sender_entity_id: row.sender_entity_id,
    session_id: row.session_id,
    content: row.content,
    audio_duration: row.audio_duration,
    message_type: row.message_type,
    audio_data: row.audio_data,
    audio_mime_type: row.audio_mime_type,
    image_data: row.image_data,
    image_mime_type: row.image_mime_type,
    vl_model: row.vl_model,
    vl_model_interpretation: row.vl_model_interpretation,
    vl_model_embedding: row.vl_model_embedding,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}
