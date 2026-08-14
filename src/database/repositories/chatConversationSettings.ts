/**
 * Chat Conversation Settings Repository — client-only per-conversation state.
 *
 * Backs the chat-list long-press actions (pin / archive / mute / block) plus
 * per-conversation unread counters, mirroring the `character_favorites` /
 * `character_profile_sources` / `personas` sidecar pattern: everything here
 * lives in CLIENT-ONLY tables (never synced to the engine — strict schema
 * parity, see docs/schema-parity.md).
 *
 * Table: chat_conversation_settings
 *   participant_key TEXT PRIMARY KEY — the stable conversation identifier
 *     (sorted `${entityA}+${entityB}` pair, or the sorted participant set for
 *     groups — same value as `interactions.participant_key`)
 *   entity_id       TEXT — partner entity id (NULL for group chats); lets the
 *     Blocked AIs screen resolve names/avatars without re-parsing the key
 *   pinned / archived / muted / blocked — 0/1 flags
 *   unread_count    INTEGER — incremented on incoming messages while the chat
 *     is not open, reset to 0 on open
 *
 * A conversation with no row simply means "not pinned / not archived / not
 * muted / not blocked / zero unread".
 */

import { getDatabase } from '../connection';

export interface ChatConversationSettings {
  participantKey: string;
  entityId: string | null;
  pinned: boolean;
  archived: boolean;
  muted: boolean;
  blocked: boolean;
  unreadCount: number;
}

interface SettingsRow {
  participant_key: string;
  entity_id: string | null;
  pinned: number;
  archived: number;
  muted: number;
  blocked: number;
  unread_count: number;
}

function mapRow(row: SettingsRow): ChatConversationSettings {
  return {
    participantKey: row.participant_key,
    entityId: row.entity_id ?? null,
    pinned: row.pinned === 1,
    archived: row.archived === 1,
    muted: row.muted === 1,
    blocked: row.blocked === 1,
    unreadCount: row.unread_count ?? 0,
  };
}

/**
 * Get the settings for a conversation. Returns the default (all-off, 0 unread)
 * when no row exists — callers never need a null check.
 */
export async function getChatConversationSettings(
  participantKey: string,
): Promise<ChatConversationSettings> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT * FROM chat_conversation_settings WHERE participant_key = ?',
    [participantKey],
  );
  if (results.rows.length === 0) {
    return {
      participantKey,
      entityId: null,
      pinned: false,
      archived: false,
      muted: false,
      blocked: false,
      unreadCount: 0,
    };
  }
  return mapRow(results.rows.item(0) as SettingsRow);
}

/**
 * Get settings for many conversations (used by the chat list to render
 * pin/archive/mute/block state and unread badges in one query).
 */
export async function getChatConversationSettingsBatch(
  participantKeys: string[],
): Promise<Map<string, ChatConversationSettings>> {
  const result = new Map<string, ChatConversationSettings>();
  if (participantKeys.length === 0) return result;

  const db = getDatabase();
  // Chunk the IN clause to stay well under SQLite's variable limit.
  const chunkSize = 300;
  for (let i = 0; i < participantKeys.length; i += chunkSize) {
    const chunk = participantKeys.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(', ');
    const [results] = await db.executeSql(
      `SELECT * FROM chat_conversation_settings
       WHERE participant_key IN (${placeholders})`,
      chunk,
    );
    for (let j = 0; j < results.rows.length; j++) {
      const settings = mapRow(results.rows.item(j) as SettingsRow);
      result.set(settings.participantKey, settings);
    }
  }
  return result;
}

/** Upsert a row while preserving untouched columns (merged flags). */
async function upsertSettings(
  participantKey: string,
  entityId: string | null,
  patch: Partial<Pick<ChatConversationSettings, 'pinned' | 'archived' | 'muted' | 'blocked' | 'unreadCount'>>,
): Promise<void> {
  const db = getDatabase();
  const existing = await getChatConversationSettings(participantKey);
  const next = {
    pinned: patch.pinned ?? existing.pinned,
    archived: patch.archived ?? existing.archived,
    muted: patch.muted ?? existing.muted,
    blocked: patch.blocked ?? existing.blocked,
    unreadCount: patch.unreadCount ?? existing.unreadCount,
  };
  const now = new Date().toISOString();
  await db.executeSql(
    `INSERT INTO chat_conversation_settings (
       participant_key, entity_id, pinned, archived, muted, blocked,
       unread_count, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(participant_key) DO UPDATE SET
       entity_id = excluded.entity_id,
       pinned = excluded.pinned,
       archived = excluded.archived,
       muted = excluded.muted,
       blocked = excluded.blocked,
       unread_count = excluded.unread_count,
       updated_at = excluded.updated_at`,
    [
      participantKey,
      entityId ?? null,
      next.pinned ? 1 : 0,
      next.archived ? 1 : 0,
      next.muted ? 1 : 0,
      next.blocked ? 1 : 0,
      next.unreadCount,
      now,
      now,
    ],
  );
}

// ============================================================================
// Pin / Archive / Mute / Block
// ============================================================================

export async function setConversationPinned(
  participantKey: string,
  entityId: string | null,
  pinned: boolean,
): Promise<void> {
  await upsertSettings(participantKey, entityId, { pinned });
}

export async function setConversationArchived(
  participantKey: string,
  entityId: string | null,
  archived: boolean,
): Promise<void> {
  await upsertSettings(participantKey, entityId, { archived });
}

export async function setConversationMuted(
  participantKey: string,
  entityId: string | null,
  muted: boolean,
): Promise<void> {
  await upsertSettings(participantKey, entityId, { muted });
}

export async function setConversationBlocked(
  participantKey: string,
  entityId: string | null,
  blocked: boolean,
): Promise<void> {
  await upsertSettings(participantKey, entityId, { blocked });
}

// ============================================================================
// Unread counters
// ============================================================================

/**
 * Increment the unread counter for a conversation (incoming message while the
 * chat is not open). Creates the row if it does not exist.
 */
export async function incrementConversationUnread(
  participantKey: string,
  entityId: string | null,
): Promise<void> {
  const db = getDatabase();
  await db.executeSql(
    `INSERT INTO chat_conversation_settings (
       participant_key, entity_id, unread_count, created_at, updated_at
     ) VALUES (?, ?, 1, ?, ?)
     ON CONFLICT(participant_key) DO UPDATE SET
       unread_count = chat_conversation_settings.unread_count + 1,
       updated_at = excluded.updated_at`,
    [participantKey, entityId ?? null, new Date().toISOString(), new Date().toISOString()],
  );
}

/**
 * Reset the unread counter for a conversation (opened / marked read).
 */
export async function clearConversationUnread(participantKey: string): Promise<void> {
  const db = getDatabase();
  await db.executeSql(
    `UPDATE chat_conversation_settings SET unread_count = 0, updated_at = ?
     WHERE participant_key = ?`,
    [new Date().toISOString(), participantKey],
  );
}

/**
 * True when any conversation settings exist with the given flags — used to
 * decide whether the chat list's archive / block sections should be shown.
 */
export async function conversationSettingsExistForEntity(
  entityId: string,
): Promise<boolean> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT 1 FROM chat_conversation_settings WHERE entity_id = ? LIMIT 1',
    [entityId],
  );
  return results.rows.length > 0;
}

/**
 * List conversations matching a predicate on flags (used by the Blocked AIs
 * screen — `blocked = 1` — and the archived section of the chat list).
 */
export async function listConversationsByFlag(
  flag: 'pinned' | 'archived' | 'muted' | 'blocked',
): Promise<ChatConversationSettings[]> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    `SELECT * FROM chat_conversation_settings WHERE ${flag} = 1
     ORDER BY updated_at DESC`,
  );
  const list: ChatConversationSettings[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    list.push(mapRow(results.rows.item(i) as SettingsRow));
  }
  return list;
}

/** Get a single blocked conversation (or null). */
export async function getBlockedConversation(
  participantKey: string,
): Promise<ChatConversationSettings | null> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    `SELECT * FROM chat_conversation_settings
     WHERE participant_key = ? AND blocked = 1`,
    [participantKey],
  );
  if (results.rows.length === 0) return null;
  return mapRow(results.rows.item(0) as SettingsRow);
}

/**
 * All blocked conversations that reference a known partner entity — used by
 * the Blocked AIs screen to render names/avatars.
 */
export async function getBlockedEntityIds(): Promise<string[]> {
  const settings = await listConversationsByFlag('blocked');
  return settings
    .map(s => s.entityId)
    .filter((id): id is string => Boolean(id));
}
