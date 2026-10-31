/**
 * Chat conversation settings — management-API-backed repository adapter
 * (task 3-2 writes, task 3-4 reads).
 *
 * Writes: pin / archive ride `PUT /api/entities/:id/chat-settings/:participantKey`
 * (merge-preserving partial upsert). `reply_mode` is NOT writable here — it
 * flows via the WS `SET_REPLY_MODE` path (`EntitySessionService.setReplyMode`),
 * so {@link setReplyMode} is a deliberate no-op on the repo layer (the engine
 * stores the mode when the WS event lands).
 *
 * Reads: the engine's GLOBAL inbox (`GET /api/entities/chat-list`) folds
 * pinned/archived/reply_mode/unread per conversation; the adapter composes the
 * participant-key-scoped reads from it (active rows plus the separate archived
 * array). There is no per-entity chat-list route anymore.
 */

import { engineApiClient } from '../EngineApiClient';
import { getGlobalInboxPage, type PhoneConversationPageRow } from './interactions';

export interface ChatConversationSettings {
  participantKey: string;
  entityId: string | null;
  pinned: boolean;
  archived: boolean;
  replyMode: 'realistic' | 'instant';
}

function defaultSettings(participantKey: string): ChatConversationSettings {
  return {
    participantKey,
    entityId: null,
    pinned: false,
    archived: false,
    replyMode: 'realistic',
  };
}

function requireEntityId(entityId: string | null, op: string): string {
  if (!entityId) {
    throw new Error(
      `Management API chat-settings for "${op}" needs the POV entity id, but none was supplied`,
    );
  }
  return entityId;
}

/** Entity ids embedded in a participant key (`a+b` sorted pair, or a set). */
function entitiesInKey(participantKey: string): string[] {
  return participantKey.split('+').map(s => s.trim()).filter(Boolean);
}

/**
 * Every conversation row the settings read needs: active rows plus the
 * separate bounded archived array, from ONE global-inbox call. `entityId` is
 * the POV; omit it for the unpivoted companion view.
 */
async function readConversationRows(
  entityId?: string | null,
): Promise<PhoneConversationPageRow[]> {
  const page = await getGlobalInboxPage(entityId ?? undefined, {
    limit: 200,
    offset: 0,
    includeArchived: true,
  });
  return [...page.rows, ...page.archived];
}

function toSettings(
  row: PhoneConversationPageRow,
  entityId: string | null,
): ChatConversationSettings {
  return {
    participantKey: row.participantKey,
    entityId: entityId ?? row.entityId ?? null,
    pinned: !!row.pinned,
    archived: !!row.archived,
    replyMode: row.replyMode === 'instant' ? 'instant' : 'realistic',
  };
}

/** Find one conversation's settings by scanning the global inbox. */
async function settingsFromChatList(
  entityId: string,
  participantKey: string,
): Promise<ChatConversationSettings | null> {
  const rows = await readConversationRows(entityId);
  const row = rows.find(r => r.participantKey === participantKey);
  return row ? toSettings(row, entityId) : null;
}

/** Settings for a conversation; the default (all-off) when none exist. */
export async function getChatConversationSettings(
  participantKey: string,
  entityId?: string | null,
): Promise<ChatConversationSettings> {
  const candidates = entityId ? [entityId, ...entitiesInKey(participantKey)] : entitiesInKey(participantKey);
  for (const candidate of candidates) {
    try {
      const found = await settingsFromChatList(candidate, participantKey);
      if (found) return found;
    } catch {
      // Try the next candidate entity.
    }
  }
  return defaultSettings(participantKey);
}

/**
 * Settings for many conversations (used by the chat list).
 *
 * `entityId` is the POV entity: its global inbox already folds pinned/archived
 * per conversation, so ONE read resolves every wanted key. Any key the pivoted
 * read did not cover is resolved from the single unpivoted global page (every
 * thread) — never a per-partner fan-out.
 */
export async function getChatConversationSettingsBatch(
  participantKeys: string[],
  entityId?: string | null,
): Promise<Map<string, ChatConversationSettings>> {
  const result = new Map<string, ChatConversationSettings>();
  if (participantKeys.length === 0) return result;
  const wanted = new Set(participantKeys);
  const unmatched = new Set(participantKeys);

  const absorb = (id: string | null, rows: readonly PhoneConversationPageRow[]): void => {
    for (const row of rows) {
      if (!wanted.has(row.participantKey)) continue;
      unmatched.delete(row.participantKey);
      result.set(row.participantKey, toSettings(row, id));
    }
  };

  // 1. The POV entity's global inbox covers every conversation it participates
  //    in (all of them in practice) — one request, no partner fan-out.
  if (entityId) {
    try {
      absorb(entityId, await readConversationRows(entityId));
    } catch {
      // A failed POV read must not break the batch — the unpivoted read below
      // still has a chance.
    }
    if (unmatched.size === 0) return result;
  }

  // 2. Resolve whatever is left from the SINGLE unpivoted view (every thread),
  //    filtered by participant key — still one request, never one per partner.
  try {
    absorb(null, await readConversationRows(undefined));
  } catch {
    // A failed read must not break the batch — unresolved keys stay absent.
  }
  return result;
}

/** Pin / unpin a conversation. `entityId` is the POV entity (Q6). */
export async function setConversationPinned(
  participantKey: string,
  entityId: string | null,
  pinned: boolean,
): Promise<void> {
  await engineApiClient.upsertChatSettings(requireEntityId(entityId, 'pin'), participantKey, {
    pinned,
  });
}

/** Archive / unarchive a conversation. `entityId` is the POV entity (Q6). */
export async function setConversationArchived(
  participantKey: string,
  entityId: string | null,
  archived: boolean,
): Promise<void> {
  await engineApiClient.upsertChatSettings(
    requireEntityId(entityId, 'archive'),
    participantKey,
    { archived },
  );
}

/** True when any conversation settings exist for the entity (archive section gate). */
export async function conversationSettingsExistForEntity(entityId: string): Promise<boolean> {
  try {
    const rows = await readConversationRows(entityId);
    return rows.some(row => row.pinned || row.archived);
  } catch {
    return false;
  }
}

/** List conversations matching a flag predicate (pinned / archived only). */
export async function listConversationsByFlag(
  flag: 'pinned' | 'archived',
  entityId?: string | null,
): Promise<ChatConversationSettings[]> {
  if (!entityId) return [];
  const rows = await readConversationRows(entityId);
  return rows.filter(row => !!row[flag]).map(row => toSettings(row, entityId));
}

/** Read the synced reply-pacing mode for a conversation. */
export async function getReplyMode(
  participantKey: string,
  entityId?: string | null,
): Promise<'realistic' | 'instant'> {
  return (await getChatConversationSettings(participantKey, entityId)).replyMode;
}

/**
 * Set the reply-pacing mode. Deliberately a no-op on the repo layer: the engine
 * has no `reply_mode` write route — the mode is persisted engine-side when the
 * WS `SET_REPLY_MODE` event lands (`EntitySessionService.setReplyMode`, which
 * callers invoke alongside this).
 */
export async function setReplyMode(
  _participantKey: string,
  _mode: 'realistic' | 'instant',
): Promise<void> {
  // No-op by design — see the doc comment.
}
