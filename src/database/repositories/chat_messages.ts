import { getDatabase } from '../connection';
import { ChatMessage } from '../models';

export async function createChatMessage(message: Omit<ChatMessage, 'created_at' | 'updated_at' | 'deleted_at'>): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();
  
  await db.executeSql(
    `INSERT INTO chat_messages (
      id, entity_id, sender_entity_id, session_id, content,
      audio_file, audio_duration, message_type, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      message.id,
      message.entity_id,
      message.sender_entity_id,
      message.session_id,
      message.content,
      message.audio_file,
      message.audio_duration,
      message.message_type,
      now,
      now
    ]
  );
}

export async function getChatMessage(id: string, includeDeleted = false): Promise<ChatMessage | null> {
  const db = getDatabase();
  const query = includeDeleted
    ? 'SELECT * FROM chat_messages WHERE id = ?'
    : 'SELECT * FROM chat_messages WHERE id = ? AND deleted_at IS NULL';
    
  const [results] = await db.executeSql(query, [id]);
  
  if (results.rows.length === 0) return null;
  
  const row = results.rows.item(0);
  return {
    ...row,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function updateChatMessage(message: ChatMessage): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();
  
  await db.executeSql(
    `UPDATE chat_messages SET
      entity_id = ?, sender_entity_id = ?, session_id = ?, content = ?,
      audio_file = ?, audio_duration = ?, message_type = ?, updated_at = ?
    WHERE id = ?`,
    [
      message.entity_id,
      message.sender_entity_id,
      message.session_id,
      message.content,
      message.audio_file,
      message.audio_duration,
      message.message_type,
      now,
      message.id
    ]
  );
}

export async function deleteChatMessage(id: string, soft = true): Promise<void> {
  const db = getDatabase();
  if (soft) {
    const now = new Date().toISOString();
    await db.executeSql('UPDATE chat_messages SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, id]);
  } else {
    await db.executeSql('DELETE FROM chat_messages WHERE id = ?', [id]);
  }
}

export async function getChatMessages(entityId: string, limit = 50, offset = 0): Promise<ChatMessage[]> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT * FROM chat_messages WHERE entity_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [entityId, limit, offset]
  );
  
  const messages: ChatMessage[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    messages.push({
      ...row,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
    });
  }
  return messages;
}

export async function getChatMessagesBySession(sessionId: string, limit = 50, offset = 0): Promise<ChatMessage[]> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT * FROM chat_messages WHERE session_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [sessionId, limit, offset]
  );
  
  const messages: ChatMessage[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    messages.push({
      ...row,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
    });
  }
  return messages;
}
