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
 * Reads: the engine's chat-list (`GET /api/entities/:id/chat-list`) folds
 * pinned/archived/reply_mode per conversation; the adapter composes the
 * participant-key-scoped reads from it.
 */

import { engineApiClient } from '../EngineApiClient';

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

/** Find one conversation's settings by scanning an entity's chat-list. */
async function settingsFromChatList(
  entityId: string,
  participantKey: string,
): Promise<ChatConversationSettings | null> {
  const res = await engineApiClient.entityChatList(entityId, { limit: 200 });
  const row = (res.conversations ?? []).find(c => c.participant_key === participantKey);
  if (!row) return null;
  return {
    participantKey: row.participant_key,
    entityId,
    pinned: !!row.pinned,
    archived: !!row.archived,
    replyMode: row.reply_mode === 'instant' ? 'instant' : 'realistic',
  };
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

/** Settings for many conversations (used by the chat list). */
export async function getChatConversationSettingsBatch(
  participantKeys: string[],
  entityId?: string | null,
): Promise<Map<string, ChatConversationSettings>> {
  const result = new Map<string, ChatConversationSettings>();
  if (participantKeys.length === 0) return result;
  const wanted = new Set(participantKeys);
  const entityIds = new Set<string>();
  if (entityId) entityIds.add(entityId);
  for (const key of participantKeys) for (const id of entitiesInKey(key)) entityIds.add(id);

  for (const id of entityIds) {
    try {
      const res = await engineApiClient.entityChatList(id, { limit: 200 });
      for (const row of res.conversations ?? []) {
        if (!wanted.has(row.participant_key)) continue;
        result.set(row.participant_key, {
          participantKey: row.participant_key,
          entityId: id,
          pinned: !!row.pinned,
          archived: !!row.archived,
          replyMode: row.reply_mode === 'instant' ? 'instant' : 'realistic',
        });
      }
    } catch {
      // A failed entity read must not break the batch.
    }
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
    const res = await engineApiClient.entityChatList(entityId, { limit: 200 });
    return (res.conversations ?? []).some(c => c.pinned || c.archived);
  } catch {
    return false;
  }
}

/** List conversations matching a flag predicate (pinned / archived only). */
export async function listConversationsByFlag(
  flag: 'pinned' | 'archived',
  entityId?: string | null,
): Promise<ChatConversationSettings[]> {
  const list: ChatConversationSettings[] = [];
  const entityIds = entityId ? [entityId] : [];
  for (const id of entityIds) {
    const res = await engineApiClient.entityChatList(id, { limit: 200 });
    for (const row of res.conversations ?? []) {
      if (row[flag]) {
        list.push({
          participantKey: row.participant_key,
          entityId: id,
          pinned: !!row.pinned,
          archived: !!row.archived,
          replyMode: row.reply_mode === 'instant' ? 'instant' : 'realistic',
        });
      }
    }
  }
  return list;
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
