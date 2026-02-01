import { getDatabase } from '../connection';
import { ChatMessage } from '../models';

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
 */
export async function getChatMessagesBetween(
  entityA: string,
  entityB: string,
  limit: number = 20,
  beforeTimestamp?: number
): Promise<ChatMessage[]> {
  const db = getDatabase();
  
  let query = `
    SELECT * FROM chat_messages 
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
  
  const messages: ChatMessage[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    messages.push(mapRowToChatMessage(row));
  }
  return messages;
}

/**
 * Get most recent chat messages between two entities (for initial load)
 * Ordered chronologically (oldest first of the batch)
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
  
  // Now fetch full records in chronological order
  const placeholders = ids.map(() => '?').join(',');
  const [results] = await db.executeSql(
    `SELECT * FROM chat_messages 
     WHERE id IN (${placeholders})
     ORDER BY created_at ASC`,
    ids
  );
  
  const messages: ChatMessage[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    messages.push(mapRowToChatMessage(row));
  }
  return messages;
}

/**
 * Get last message for chat list preview
 */
export async function getLastChatMessage(
  entityA: string,
  entityB: string
): Promise<ChatMessage | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT * FROM chat_messages 
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
  return mapRowToChatMessage(results.rows.item(0));
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
