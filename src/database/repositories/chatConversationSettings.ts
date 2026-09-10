/**
 * Chat Conversation Settings Repository — per-conversation pin/archive/state.
 *
 * Backs the chat-list long-press actions (pin / archive) only. Mute/disable
 * moved ONTO the entity itself (entities.is_muted / entities.is_disabled,
 * Q8), unread is DERIVED from conversation_messages.is_read (A5/A2), and the
 * legacy `'blocked'` flag carried in this table is gone.
 * `chat_conversation_settings`
 * loses `unread_count`, `muted`, `blocked` and gains `reply_mode` + `deleted_at`
 * (final shape, mirroring the engine).
 *
 * Joined engine sync in Phase 2 (4-1): PK = participant_key, watermark triple
 * + soft delete; pinned/archived ride as JSON 0/1 (no boolean normalization).
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
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Legacy reply-pacing AsyncStorage key prefix (A6). Before the synced
 * `chat_conversation_settings.reply_mode` column existed, reply pacing was
 * stored client-side under `@harmony_chat_reply_mode_<participantKey>`
 * (ChatPreferencesService). 4-4 migrates those values into the synced column
 * ONCE (read the legacy key, write the settings row, delete the key).
 */
const LEGACY_REPLY_MODE_PREFIX = '@harmony_chat_reply_mode_';

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
    `SELECT * FROM chat_conversation_settings WHERE participant_key = ? AND deleted_at IS NULL`,
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
       WHERE participant_key IN (${placeholders}) AND deleted_at IS NULL`,
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
  patch: Partial<Pick<ChatConversationSettings, 'pinned' | 'archived' | 'replyMode'>>,
): Promise<void> {
  const db = getDatabase();
  const existing = await getChatConversationSettings(participantKey);
  const next = {
    pinned: patch.pinned ?? existing.pinned,
    archived: patch.archived ?? existing.archived,
    replyMode: patch.replyMode ?? existing.replyMode,
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
       updated_at = excluded.updated_at,
       deleted_at = NULL`,
    [
      participantKey,
      entityId ?? null,
      next.pinned ? 1 : 0,
      next.archived ? 1 : 0,
      next.replyMode,
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
    `SELECT 1 FROM chat_conversation_settings WHERE entity_id = ? AND deleted_at IS NULL LIMIT 1`,
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
    `SELECT * FROM chat_conversation_settings WHERE ${flag} = 1 AND deleted_at IS NULL
     ORDER BY updated_at DESC`,
  );
  const list: ChatConversationSettings[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    list.push(mapRow(results.rows.item(i) as SettingsRow));
  }
  return list;
}

// ============================================================================
// Reply mode (A6) — the synced `reply_mode` column
// ============================================================================

/** Read the legacy reply-pacing AsyncStorage value for a participant key. */
async function readLegacyReplyMode(
  participantKey: string,
): Promise<'realistic' | 'instant' | null> {
  try {
    const key = `${LEGACY_REPLY_MODE_PREFIX}${participantKey}`;
    const value = await AsyncStorage.getItem(key);
    if (value === 'instant') return 'instant';
    if (value === 'realistic') return 'realistic';
    return null;
  } catch {
    // Best-effort: an AsyncStorage read failure must never break a read.
    return null;
  }
}

/** Delete the legacy reply-pacing AsyncStorage value (best-effort). */
async function clearLegacyReplyMode(participantKey: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(`${LEGACY_REPLY_MODE_PREFIX}${participantKey}`);
  } catch {
    // Best-effort.
  }
}

/**
 * Read the synced reply-pacing mode for a conversation.
 *
 * Reads the `reply_mode` column; a row REPLACING the default 'realistic' is a
 * synced value and wins over any stale legacy key. On a NO-ROW miss, the
 * legacy AsyncStorage key (`@harmony_chat_reply_mode_<participantKey>`) is
 * consulted ONCE, migrated into a settings row, then deleted — the honest
 * one-time migration from the pre-4-4 client-side storage.
 */
export async function getReplyMode(
  participantKey: string,
): Promise<'realistic' | 'instant'> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    `SELECT reply_mode FROM chat_conversation_settings WHERE participant_key = ? AND deleted_at IS NULL`,
    [participantKey],
  );
  if (results.rows.length > 0) {
    const replyMode = results.rows.item(0).reply_mode;
    return replyMode === 'instant' ? 'instant' : 'realistic';
  }

  // No row → one-time legacy migration.
  const legacyValue = await readLegacyReplyMode(participantKey);
  if (legacyValue !== null) {
    await setReplyMode(participantKey, legacyValue);
    await clearLegacyReplyMode(participantKey);
    return legacyValue;
  }
  return 'realistic';
}

/**
 * Set the synced reply-pacing mode for a conversation. Merge-preserving:
 * never clobbers pinned/archived/entity_id; bumps updated_at.
 */
export async function setReplyMode(
  participantKey: string,
  mode: 'realistic' | 'instant',
): Promise<void> {
  const existing = await getChatConversationSettings(participantKey);
  await upsertSettings(participantKey, existing.entityId, { replyMode: mode });
}
