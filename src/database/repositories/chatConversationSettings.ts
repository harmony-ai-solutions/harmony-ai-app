/**
 * Chat Conversation Settings Repository — client-only per-conversation state.
 *
 * Backs the chat-list long-press actions (pin / archive) only. Mute/disable
 * moved ONTO the entity itself (entities.is_muted / entities.is_disabled,
 * Q8), unread is DERIVED from conversation_messages.is_read (A5/A2), and the
 * `'blocked'` store of disabled state is dead. `chat_conversation_settings`
 * loses `unread_count`, `muted`, `blocked` and gains `reply_mode` + `deleted_at`
 * (final shape, mirroring the engine).
 *
 * Table: chat_conversation_settings
 *   participant_key TEXT PRIMARY KEY — the stable conversation identifier
 *     (sorted `${entityA}+${entityB}` pair, or the sorted participant set for
 *     groups — same value as `interactions.participant_key`)
 *   entity_id       TEXT — the POV entity (Q6: the user-entity persona the
 *     conversation is chatted AS; NULL for groups). NEVER the partner —
 *     partner resolution happens via participant-key derivation where needed.
 *     (A6: today callers passed the PARTNER id; all surviving writers now pass
 *     the POV id.)
 *   pinned / archived — 0/1 flags
 *   reply_mode      TEXT NOT NULL DEFAULT 'realistic' — chat reply pacing
 *     (A6). Persisted via ChatPreferencesService; the column carries the value
 *     for sync-consistency.
 *
 * ⚠️ DATA NOTE (F4/O3): participant_key is derived by
 * `interactions.deriveParticipantKey` — the ENGINE contract where the own
 * entity is part of the key EVERYWHERE. Rows keyed by any OLDER derivation
 * (e.g. pair-key without the own persona entity) are ACCEPTED-LOSS on dev
 * devices: do NOT write a re-key migration. Old rows simply never match a
 * newly-derived key → default (all-off) settings — the same state as a fresh
 * install.
 *
 * A conversation with no row simply means "not pinned / not archived".
 */

import { getDatabase } from '../connection';

export interface ChatConversationSettings {
  participantKey: string;
  entityId: string | null;
  pinned: boolean;
  archived: boolean;
  replyMode: 'realistic' | 'instant';
}

interface SettingsRow {
  participant_key: string;
  entity_id: string | null;
  pinned: number;
  archived: number;
  reply_mode: string;
}

function mapRow(row: SettingsRow): ChatConversationSettings {
  return {
    participantKey: row.participant_key,
    entityId: row.entity_id ?? null,
    pinned: row.pinned === 1,
    archived: row.archived === 1,
    replyMode: row.reply_mode === 'instant' ? 'instant' : 'realistic',
  };
}

/**
 * Get the settings for a conversation. Returns the default (all-off, realistic
 * reply mode) when no row exists — callers never need a null check.
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
      replyMode: 'realistic',
    };
  }
  return mapRow(results.rows.item(0) as SettingsRow);
}

/**
 * Get settings for many conversations (used by the chat list to render
 * pin/archive state in one query).
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
  patch: Partial<Pick<ChatConversationSettings, 'pinned' | 'archived'>>,
): Promise<void> {
  const db = getDatabase();
  const existing = await getChatConversationSettings(participantKey);
  const next = {
    pinned: patch.pinned ?? existing.pinned,
    archived: patch.archived ?? existing.archived,
  };
  const now = new Date().toISOString();
  await db.executeSql(
    `INSERT INTO chat_conversation_settings (
       participant_key, entity_id, pinned, archived, reply_mode, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(participant_key) DO UPDATE SET
       entity_id = excluded.entity_id,
       pinned = excluded.pinned,
       archived = excluded.archived,
       reply_mode = excluded.reply_mode,
       updated_at = excluded.updated_at`,
    [
      participantKey,
      entityId ?? null,
      next.pinned ? 1 : 0,
      next.archived ? 1 : 0,
      existing.replyMode,
      now,
      now,
    ],
  );
}

// ============================================================================
// Pin / Archive
// ============================================================================

/** Pin / unpin a conversation. `entityId` is the POV entity (Q6). */
export async function setConversationPinned(
  participantKey: string,
  entityId: string | null,
  pinned: boolean,
): Promise<void> {
  await upsertSettings(participantKey, entityId, { pinned });
}

/** Archive / unarchive a conversation. `entityId` is the POV entity (Q6). */
export async function setConversationArchived(
  participantKey: string,
  entityId: string | null,
  archived: boolean,
): Promise<void> {
  await upsertSettings(participantKey, entityId, { archived });
}

/**
 * True when any conversation settings exist with the given entity — used to
 * decide whether the chat list's archive section should be shown.
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
 * List conversations matching a flag predicate (pinned / archived only).
 * mute/disable/unread lived on this table historically; they are GONE.
 */
export async function listConversationsByFlag(
  flag: 'pinned' | 'archived',
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
