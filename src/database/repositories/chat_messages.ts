import { getDatabase } from '../connection';
import { ChatMessage } from '../models';
import { loadBlobColumn } from '../sync';

/**
 * Create a new chat message
 */
export async function createChatMessage(
  message: Omit<ChatMessage, 'created_at' | 'updated_at' | 'deleted_at'>
): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();
  
  await db.executeSql(
    `INSERT INTO chat_messages (
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
export async function getChatMessagesBetween(
  entityA: string,
  entityB: string,
  limit: number = 20,
  beforeTimestamp?: number
): Promise<ChatMessage[]> {
  const db = getDatabase();
  
  // Phase 1: Get metadata without BLOBs
  let query = `
    SELECT id, entity_id, sender_entity_id, session_id, content,
           audio_duration, message_type, audio_mime_type,
           image_mime_type, vl_model, vl_model_interpretation,
           created_at, updated_at, deleted_at
    FROM chat_messages 
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
  
  // Phase 2: Load each message's BLOBs individually with chunking
  const messages: ChatMessage[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const metadata = results.rows.item(i);
    
    // Load BLOBs individually with chunking
    const audioData = await loadBlobColumn('chat_messages', metadata.id, 'audio_data');
    const imageData = await loadBlobColumn('chat_messages', metadata.id, 'image_data');
    const embeddingData = await loadBlobColumn('chat_messages', metadata.id, 'vl_model_embedding');

    messages.push({
      id: metadata.id,
      entity_id: metadata.entity_id,
      sender_entity_id: metadata.sender_entity_id,
      session_id: metadata.session_id,
      content: metadata.content,
      audio_duration: metadata.audio_duration,
      message_type: metadata.message_type,
      audio_data: audioData,
      audio_mime_type: metadata.audio_mime_type,
      image_data: imageData,
      image_mime_type: metadata.image_mime_type,
      vl_model: metadata.vl_model,
      vl_model_interpretation: metadata.vl_model_interpretation,
      vl_model_embedding: embeddingData,
      created_at: new Date(metadata.created_at),
      updated_at: new Date(metadata.updated_at),
      deleted_at: metadata.deleted_at ? new Date(metadata.deleted_at) : null,
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
export async function getRecentChatMessages(
  entityA: string,
  entityB: string,
  limit: number = 20
): Promise<ChatMessage[]> {
  const db = getDatabase();
  
  // First get the IDs ordered by newest first
  const [idResults] = await db.executeSql(
    `SELECT id FROM chat_messages 
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
     FROM chat_messages 
     WHERE id IN (${placeholders})
     ORDER BY created_at ASC`,
    ids
  );
  
  // Phase 2: Load each message's BLOBs individually with chunking
  const messages: ChatMessage[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const metadata = results.rows.item(i);
    
    // Load BLOBs individually with chunking
    const audioData = await loadBlobColumn('chat_messages', metadata.id, 'audio_data');
    const imageData = await loadBlobColumn('chat_messages', metadata.id, 'image_data');
    const embeddingData = await loadBlobColumn('chat_messages', metadata.id, 'vl_model_embedding');

    messages.push({
      id: metadata.id,
      entity_id: metadata.entity_id,
      sender_entity_id: metadata.sender_entity_id,
      session_id: metadata.session_id,
      content: metadata.content,
      audio_duration: metadata.audio_duration,
      message_type: metadata.message_type,
      audio_data: audioData,
      audio_mime_type: metadata.audio_mime_type,
      image_data: imageData,
      image_mime_type: metadata.image_mime_type,
      vl_model: metadata.vl_model,
      vl_model_interpretation: metadata.vl_model_interpretation,
      vl_model_embedding: embeddingData,
      created_at: new Date(metadata.created_at),
      updated_at: new Date(metadata.updated_at),
      deleted_at: metadata.deleted_at ? new Date(metadata.deleted_at) : null,
    });
  }
  return messages;
}

/**
 * Get last message for chat list preview
 * 
 * Uses two-phase query and chunking to avoid CursorWindow overflow.
 */
export async function getLastChatMessage(
  entityA: string,
  entityB: string
): Promise<ChatMessage | null> {
  const db = getDatabase();
  
  // Phase 1: Get metadata for the last message
  const [results] = await db.executeSql(
    `SELECT id, entity_id, sender_entity_id, session_id, content,
            audio_duration, message_type, audio_mime_type,
            image_mime_type, vl_model, vl_model_interpretation,
            created_at, updated_at, deleted_at
     FROM chat_messages 
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
  const metadata = results.rows.item(0);

  // Phase 2: Load BLOBs with chunking
  const audioData = await loadBlobColumn('chat_messages', metadata.id, 'audio_data');
  const imageData = await loadBlobColumn('chat_messages', metadata.id, 'image_data');
  const embeddingData = await loadBlobColumn('chat_messages', metadata.id, 'vl_model_embedding');

  return {
    id: metadata.id,
    entity_id: metadata.entity_id,
    sender_entity_id: metadata.sender_entity_id,
    session_id: metadata.session_id,
    content: metadata.content,
    audio_duration: metadata.audio_duration,
    message_type: metadata.message_type,
    audio_data: audioData,
    audio_mime_type: metadata.audio_mime_type,
    image_data: imageData,
    image_mime_type: metadata.image_mime_type,
    vl_model: metadata.vl_model,
    vl_model_interpretation: metadata.vl_model_interpretation,
    vl_model_embedding: embeddingData,
    created_at: new Date(metadata.created_at),
    updated_at: new Date(metadata.updated_at),
    deleted_at: metadata.deleted_at ? new Date(metadata.deleted_at) : null,
  };
}

/**
 * Check if message exists (for duplicate prevention)
 */
export async function messageExists(id: string): Promise<boolean> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT 1 FROM chat_messages WHERE id = ?',
    [id]
  );
  return results.rows.length > 0;
}

/**
 * Update an existing chat message
 * Used primarily for adding transcription to audio messages
 */
export async function updateChatMessage(
  messageId: string,
  updates: Partial<ChatMessage>
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
    UPDATE chat_messages 
    SET ${updateFields.join(', ')}
    WHERE id = ?
  `;

  await db.executeSql(sql, values);
}

/**
 * Get a single chat message by ID
 */
export async function getChatMessage(
  messageId: string
): Promise<ChatMessage | null> {
  const db = getDatabase();

  const [result] = await db.executeSql(
    'SELECT * FROM chat_messages WHERE id = ? AND deleted_at IS NULL',
    [messageId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows.item(0);
  return mapRowToChatMessage(row);
}

/**
 * Delete chat message (soft delete)
 */
export async function deleteChatMessage(id: string): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();
  await db.executeSql(
    'UPDATE chat_messages SET deleted_at = ?, updated_at = ? WHERE id = ?',
    [now, now, id]
  );
}

// Helper function to map DB row to ChatMessage
function mapRowToChatMessage(row: any): ChatMessage {
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
