/**
 * Conversation messages — management-API-backed repository adapter (task 3-2).
 *
 * Backed by `GET /api/entities/:id/conversations/:participantKey/messages`
 * (paginated, blob-free, chronological) and the chat-list endpoint for derived
 * unread counts. The `before` cursor is OPAQUE — pass the previous response's
 * `next_cursor`; never synthesize it from a parsed Date (the engine stores
 * timestamps in mixed formats). Message audio/image bytes ride the dedicated
 * byte endpoints via `engineApiClient.fetchMessageAudioBase64` /
 * `fetchMessageImageBase64`.
 *
 * Write surface (3-1b):
 *   - update   → `PATCH /api/messages/:id` (content / is_pinned / reactions_json
 *                / is_edited / edit_of_message_id only — the engine rejects
 *                message_type / audio_duration / blobs / interaction_id)
 *   - delete   → `DELETE /api/messages/:id`
 *   - clear    → `DELETE /api/entities/:id/conversations/:participantKey/messages`
 *   - read     → `POST /api/entities/:id/conversations/:participantKey/read`
 *
 * `createConversationMessage` / `getConversationMessage(id)` / `messageExists(id)`
 * remain unsupported: the ENGINE authors conversation_messages (there is no
 * app-facing create route, and no id-only message GET route). See the 3-2
 * report's write audit.
 *
 * Full-conversation image scan
 * ----------------------------
 * `getConversationImageMessages` walks EVERY page of a conversation (opaque
 * `next_cursor`, same ordering/pagination the chat screen uses) and returns
 * LIGHTWEIGHT metadata only — never a base64 `image_data` string. Display
 * surfaces that need the bytes for one image fetch it lazily by message id via
 * `getConversationMessageImageBase64` (the dedicated
 * `GET /api/messages/:id/image` byte route), which keeps a 3-year chat from
 * parking megabytes of base64 in JS memory.
 */

import type { ConversationMessage } from '../../../database/models';
import { engineApiClient } from '../EngineApiClient';
import { EngineApiUnsupportedError } from '../EngineApiClient';
import type { MessagePatchDto } from '../EngineApiClient';
import { mapConversationMessage } from '../engineApiMappers';

/**
 * Paginated message window (chronological, oldest-first). `before` is the
 * opaque cursor from a previous `next_cursor` (empty = newest page).
 */
export async function getConversationMessagesByParticipantKey(
  entityId: string,
  participantKey: string,
  limit: number = 20,
  before?: string,
): Promise<ConversationMessage[]> {
  const res = await engineApiClient.entityMessages(entityId, participantKey, {
    limit,
    before: before || undefined,
  });
  return (res.messages ?? []).map(mapConversationMessage);
}

/** The N most recent messages in chronological order. */
export async function getRecentConversationMessages(
  entityId: string,
  participantKey: string,
  limit: number = 20,
): Promise<ConversationMessage[]> {
  const res = await engineApiClient.entityMessages(entityId, participantKey, { limit });
  return (res.messages ?? []).map(mapConversationMessage);
}

/** The last message in a conversation, or null. */
export async function getLastConversationMessage(
  entityId: string,
  participantKey: string,
): Promise<ConversationMessage | null> {
  const res = await engineApiClient.entityMessages(entityId, participantKey, { limit: 1 });
  const rows = res.messages ?? [];
  if (rows.length === 0) return null;
  return mapConversationMessage(rows[rows.length - 1]);
}

/** One message page plus its opaque pagination cursor. */
export interface ConversationMessagePage {
  /** The page's messages, chronological (oldest-first) — engine order. */
  messages: ConversationMessage[];
  hasMore: boolean;
  /** Opaque cursor for the NEXT (older) page; null when exhausted. */
  nextCursor: string | null;
}

/**
 * A page of messages WITH its pagination cursor. Unlike
 * {@link getConversationMessagesByParticipantKey} this keeps `has_more` /
 * `next_cursor`, which a backwards full scan needs. Pass the previous page's
 * `nextCursor` VERBATIM as `before` (the cursor is opaque — never synthesize it
 * from a parsed date).
 */
export async function getConversationMessagePage(
  entityId: string,
  participantKey: string,
  limit: number = 20,
  before?: string,
): Promise<ConversationMessagePage> {
  const res = await engineApiClient.entityMessages(entityId, participantKey, {
    limit,
    before: before || undefined,
  });
  return {
    messages: (res.messages ?? []).map(mapConversationMessage),
    hasMore: res.has_more === true,
    nextCursor: res.next_cursor ?? null,
  };
}

/**
 * Lightweight metadata for one image-bearing message — the picker's list item.
 * Deliberately carries NO base64: tiles fetch their own bytes lazily.
 */
export interface ConversationImageMessageRef {
  messageId: string;
  mimeType: string;
  /** Approx. decoded byte size; 0 when the page did not inline the blob. */
  byteLength: number;
  createdAt: Date;
}

/** Page size used by the full image scan (matches the chat screen's window). */
export const CONVERSATION_IMAGE_SCAN_PAGE_SIZE = 200;

/** Safety cap for the image scan (50 × 200 = 10k messages). */
export const CONVERSATION_IMAGE_SCAN_MAX_PAGES = 50;

function isImageMessage(message: ConversationMessage): boolean {
  if (message.message_type === 'image') return true;
  return typeof message.image_data === 'string' && message.image_data.length > 0;
}

/**
 * FULL scan of a conversation for image messages, newest-first.
 *
 * Walks pages with the engine's opaque cursor until the history is exhausted
 * (or {@link CONVERSATION_IMAGE_SCAN_MAX_PAGES} is hit), extracting only the
 * metadata for image-bearing messages. Each page is dropped as soon as its
 * metadata is extracted, so the transient memory ceiling is ONE page rather
 * than the whole conversation.
 *
 * Byte-identical re-sends collapse into one entry (the old tile-dedupe
 * behaviour) without keeping the blobs: the fingerprint uses the base64 length
 * plus a head/tail sample, which is enough to recognise the same picture.
 * `seenMessages` de-duplicates overlapping pages defensively.
 */
export async function getConversationImageMessages(
  entityId: string,
  participantKey: string,
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<ConversationImageMessageRef[]> {
  const pageSize = options.pageSize ?? CONVERSATION_IMAGE_SCAN_PAGE_SIZE;
  const maxPages = options.maxPages ?? CONVERSATION_IMAGE_SCAN_MAX_PAGES;
  const images: ConversationImageMessageRef[] = [];
  const seenMessages = new Set<string>();
  const seenFingerprints = new Set<string>();

  let before: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await getConversationMessagePage(
      entityId,
      participantKey,
      pageSize,
      before,
    );

    // Pages arrive oldest-first; walk each one backwards so the accumulated
    // list is globally newest-first without re-sorting (the engine stores
    // timestamps in mixed formats — order comes from the pages themselves).
    for (let i = result.messages.length - 1; i >= 0; i -= 1) {
      const message = result.messages[i];
      if (!isImageMessage(message)) continue;
      if (seenMessages.has(message.id)) continue;
      seenMessages.add(message.id);

      const base64 = message.image_data ?? '';
      if (base64) {
        const fingerprint = `${base64.length}:${base64.slice(0, 64)}:${base64.slice(-64)}`;
        if (seenFingerprints.has(fingerprint)) continue;
        seenFingerprints.add(fingerprint);
      }

      images.push({
        messageId: message.id,
        mimeType: message.image_mime_type || 'image/jpeg',
        // base64 is ~4/3 of the decoded size; an approximation is all a
        // "lightweight metadata" list needs.
        byteLength: base64 ? Math.floor((base64.length * 3) / 4) : 0,
        createdAt: message.created_at,
      });
    }

    if (!result.hasMore || !result.nextCursor) break;
    before = result.nextCursor;
  }

  return images;
}

/**
 * Base64 bytes of ONE message's image (`GET /api/messages/:id/image`). Empty
 * string when the message has no image blob; transport errors still throw so
 * the caller can degrade (a preview tile must not crash the grid).
 */
export async function getConversationMessageImageBase64(
  messageId: string,
): Promise<string> {
  return engineApiClient.fetchMessageImageBase64(messageId);
}

/**
 * Batched unread counts keyed by participant_key, scoped to the POV entity.
 * Derived from the chat-list endpoint (unread_count per conversation), which is
 * paginated — we walk pages until exhausted or a safety cap is hit.
 */
export async function getUnreadCountByParticipantKeys(
  keys: string[],
  ownEntityId: string,
): Promise<Map<string, number>> {
  const wanted = new Set(keys);
  const result = new Map<string, number>();
  if (keys.length === 0) return result;

  const pageSize = 200;
  const maxPages = 25; // safety cap: 5000 conversations
  let offset = 0;
  for (let page = 0; page < maxPages; page++) {
    const res = await engineApiClient.entityChatList(ownEntityId, {
      limit: pageSize,
      offset,
    });
    for (const row of res.conversations ?? []) {
      if (wanted.has(row.participant_key)) {
        result.set(row.participant_key, row.unread_count ?? 0);
      }
    }
    if (!res.has_more || res.next_offset == null) break;
    offset = res.next_offset;
  }
  return result;
}

// ── Writes ───────────────────────────────────────────────────────────────

/** Message fields the engine's PATCH route accepts. */
const PATCHABLE_FIELDS = [
  'content',
  'is_pinned',
  'reactions_json',
  'is_edited',
  'edit_of_message_id',
] as const;

/**
 * Update a message. Only the engine-patchable fields are sent; a call that
 * carries ONLY engine-unpatchable fields (message_type / audio_duration /
 * blobs / interaction_id) is rejected loudly rather than silently dropped
 * (see the 3-2 write audit — the engine authors those).
 */
export async function updateConversationMessage(
  messageId: string,
  updates: Partial<ConversationMessage>,
): Promise<void> {
  const patch: MessagePatchDto = {};
  for (const field of PATCHABLE_FIELDS) {
    if (updates[field] !== undefined) {
      (patch as Record<string, unknown>)[field] = updates[field];
    }
  }
  if (Object.keys(patch).length === 0) {
    const requested = Object.keys(updates).join(', ');
    throw new EngineApiUnsupportedError(
      `updateConversationMessage [${requested}] — the engine PATCH route accepts only ` +
        `${PATCHABLE_FIELDS.join(', ')}`,
    );
  }
  await engineApiClient.patchMessage(messageId, patch);
}

/** Soft-delete a single message. */
export async function deleteConversationMessage(id: string): Promise<void> {
  await engineApiClient.deleteMessage(id);
}

/** Clear an entire conversation (messages + interactions + settings). */
export async function deleteConversationByParticipantKey(
  entityId: string,
  participantKey: string,
): Promise<void> {
  await engineApiClient.clearConversation(entityId, participantKey);
}

/** Mark every partner-sent unread message read (optionally up to a boundary). */
export async function markConversationMessagesRead(
  participantKey: string,
  ownEntityId: string,
  upToMessageId?: string,
): Promise<number> {
  const res = await engineApiClient.markConversationRead(ownEntityId, participantKey, {
    read: true,
    up_to_message_id: upToMessageId,
  });
  return res.updated ?? 0;
}

/** Mark the last partner-sent message unread (set-to-1 semantics). */
export async function markConversationMessagesUnread(
  participantKey: string,
  ownEntityId: string,
  _count: number = 1,
): Promise<number> {
  const res = await engineApiClient.markConversationRead(ownEntityId, participantKey, {
    read: false,
  });
  return res.updated ?? 0;
}

// ── Write paths without a management endpoint (engine authors these) ─────

export async function createConversationMessage(
  _message: Omit<ConversationMessage, 'created_at' | 'updated_at' | 'deleted_at'>,
): Promise<void> {
  throw new EngineApiUnsupportedError('createConversationMessage');
}

export async function getConversationMessage(
  _messageId: string,
): Promise<ConversationMessage | null> {
  throw new EngineApiUnsupportedError('getConversationMessage');
}

export async function messageExists(_id: string): Promise<boolean> {
  throw new EngineApiUnsupportedError('messageExists');
}
