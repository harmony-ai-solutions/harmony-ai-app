/**
 * Interactions — management-API-backed repository adapter (task 3-2).
 *
 * Backed by the 3-1b read endpoint
 * `GET /api/entities/:id/interactions` (+ the chat-list / messages
 * endpoints for the derived reads). Implements the *read* surface of the
 * existing `src/database/repositories/interactions.ts` interface; write paths
 * have no management endpoint yet and throw {@link EngineApiUnsupportedError}.
 */

import type { ConversationMessage, Interaction } from '../../../database/models';
import { engineApiClient } from '../EngineApiClient';
import type {
  ChatListRowDto,
  GlobalChatListResponseDto,
  GlobalChatListRowDto,
  InteractionDto,
} from '../EngineApiClient';
import { mapConversationMessage, mapInteraction } from '../engineApiMappers';
import { EngineApiError, EngineApiUnsupportedError } from '../EngineApiClient';

/** One row of the paginated phone-conversation list (re-homed from the SQLite repo). */
export interface PhoneConversationPageRow {
  interactionId: string;
  interactionScope: string;
  participantKey: string;
  participantIds: string;
  /**
   * Pre-hydrated fields straight off the engine's chat-list row
   * (`GET /api/entities/:id/chat-list`). The screen uses them as-is instead of
   * re-fetching the last message / profile / settings per conversation; they
   * stay OPTIONAL so callers that build rows by hand (tests) still work.
   */
  lastMessage?: ConversationMessage | null;
  lastMessageAt?: string | null;
  unreadCount?: number;
  pinned?: boolean;
  archived?: boolean;
  replyMode?: 'realistic' | 'instant';
  /**
   * GLOBAL inbox extras (`GET /api/entities/chat-list`, task 02-1). The
   * per-entity route leaves them undefined; the global route fills them so the
   * inbox can name/badge a row without another request.
   *
   * `entityId` is the AI companion that owns the thread (NOT the persona the
   * list is pivoted on), `partnerEntityId` is the other side of a 1:1 thread.
   */
  entityId?: string;
  partnerEntityId?: string;
  partnerDisplayName?: string;
  partnerProfileId?: string;
  /** Companion's `entities.is_muted` / `entities.is_disabled`. */
  muted?: boolean;
  entityDisabled?: boolean;
  lastActivityAt?: string | null;
}

/** One global-inbox page: active rows plus the bounded archived array. */
export interface GlobalInboxPage {
  rows: PhoneConversationPageRow[];
  archived: PhoneConversationPageRow[];
  hasMore: boolean;
  nextOffset: number | null;
}

/**
 * Derive the interaction scope from the number of participants:
 * 0/1 → "world", 2 → "private", 3+ → "group" (engine contract).
 */
export function deriveScopeFromParticipants(participantIds: string[]): string {
  const count = participantIds.length;
  if (count <= 1) return 'world';
  if (count === 2) return 'private';
  return 'group';
}

/**
 * Derive the participant key (engine contract): private → sorted own+partner
 * pair; group → sorted full set; world → "".
 */
export function deriveParticipantKey(
  participantIds: string[],
  entityId: string,
  scope: string,
): string {
  const count = participantIds.length;
  if (count <= 1) return '';
  if (scope === 'private' || count === 2) {
    const partner = participantIds.find(id => id !== entityId);
    if (!partner) return '';
    return entityId < partner ? `${entityId}+${partner}` : `${partner}+${entityId}`;
  }
  return [...participantIds].sort().join('+');
}

/** Find an interaction by id across every entity's interaction list. */
export async function getInteractionById(id: string): Promise<Interaction | null> {
  const entities = await engineApiClient.listEntities();
  for (const entityId of Object.keys(entities)) {
    const rows = await listInteractions(entityId, { limit: 200 });
    const match = rows.find(r => r.id === id);
    if (match) return mapInteraction(match);
  }
  return null;
}

/** Derive the sorted-pair participant key (mirrors the app/engine convention). */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}+${b}` : `${b}+${a}`;
}

async function listInteractions(
  entityId: string,
  filters: Parameters<typeof engineApiClient.entityInteractions>[1],
): Promise<InteractionDto[]> {
  const res = await engineApiClient.entityInteractions(entityId, filters);
  return res.interactions ?? [];
}

export async function getRecentPhoneInteractions(
  entity_id: string,
  limit: number = 50,
): Promise<Interaction[]> {
  const rows = await listInteractions(entity_id, { presence_type: 'phone', limit });
  return rows.map(mapInteraction);
}

export async function getActiveInteractionsByEntity(
  entity_id: string,
): Promise<Interaction[]> {
  const rows = await listInteractions(entity_id, { status: 'active', limit: 200 });
  return rows.map(mapInteraction);
}

export async function getInteractionByParticipantKey(
  entity_id: string,
  participant_key: string,
): Promise<Interaction | null> {
  const rows = await listInteractions(entity_id, {
    participant_key,
    status: 'active',
    limit: 1,
  });
  return rows.length > 0 ? mapInteraction(rows[0]) : null;
}

/**
 * Map one engine chat-list row onto the shape the screen consumes. Shared by
 * the per-entity and global routes so the two paths cannot drift.
 */
function mapChatListRow(row: ChatListRowDto): PhoneConversationPageRow {
  return {
    interactionId: row.interaction_id,
    interactionScope: row.interaction_scope,
    participantKey: row.participant_key,
    participantIds: row.participant_ids,
    lastMessage: row.last_message ? mapConversationMessage(row.last_message) : null,
    lastMessageAt: row.last_message_at ?? null,
    unreadCount: row.unread_count ?? 0,
    pinned: Boolean(row.pinned),
    archived: Boolean(row.archived),
    replyMode: row.reply_mode === 'instant' ? 'instant' : 'realistic',
  };
}

/** Same mapping plus the global-inbox companion metadata (task 02-1). */
function mapGlobalChatListRow(row: GlobalChatListRowDto): PhoneConversationPageRow {
  return {
    ...mapChatListRow(row),
    entityId: row.entity_id || undefined,
    partnerEntityId: row.partner_entity_id || undefined,
    partnerDisplayName: row.partner_display_name || undefined,
    partnerProfileId: row.partner_profile_id || undefined,
    muted: typeof row.muted === 'boolean' ? row.muted : undefined,
    entityDisabled: typeof row.entity_disabled === 'boolean' ? row.entity_disabled : undefined,
    lastActivityAt: row.last_activity_at ?? null,
  };
}

export async function getPhoneConversationsPage(
  entity_id: string,
  options: { limit: number; offset: number },
): Promise<PhoneConversationPageRow[]> {
  const res = await engineApiClient.entityChatList(entity_id, {
    limit: options.limit,
    offset: options.offset,
  });
  // The engine's chat-list row is already fully hydrated (last message, unread
  // count, pin/archive, reply mode) — carry every field through so the chat
  // list never re-fetches them one conversation at a time.
  return (res.conversations ?? []).map(mapChatListRow);
}

/**
 * One page of the GLOBAL inbox (`GET /api/entities/chat-list`, task 02-1):
 * every conversation across every companion in a single call, ordered by the
 * engine (pinned DESC, last activity DESC, deduped by participant_key) and
 * pivoted on `povEntityId` for the dedupe/unread count.
 *
 * Archived threads arrive in a SEPARATE bounded array (only when
 * `includeArchived` is set — callers should ask for it on the first page
 * only). Both arrays carry the same fully-hydrated row shape, so the screen's
 * Phase-B hydration fallbacks stay no-ops.
 *
 * Contract mismatch (an older embedded engine without the route, i.e. 404, or
 * a response without a `conversations` array) throws
 * {@link EngineApiUnsupportedError} — the caller's cue to fall back to the
 * per-entity path. Any other error propagates unchanged.
 */
export async function getGlobalInboxPage(
  povEntityId: string,
  options: { limit: number; offset: number; includeArchived?: boolean },
): Promise<GlobalInboxPage> {
  let res: GlobalChatListResponseDto;
  try {
    res = await engineApiClient.globalChatList({
      povEntityId,
      limit: options.limit,
      offset: options.offset,
      includeArchived: options.includeArchived,
    });
  } catch (error) {
    if (error instanceof EngineApiUnsupportedError) throw error;
    if (error instanceof EngineApiError && error.isNotFound) {
      throw new EngineApiUnsupportedError('getGlobalInboxPage (global chat-list route absent)');
    }
    throw error;
  }

  // A 200 alone is not proof of support: a route that answers with some other
  // JSON shape is just as unusable as a 404.
  if (!Array.isArray(res?.conversations)) {
    throw new EngineApiUnsupportedError('getGlobalInboxPage (unexpected response shape)');
  }

  return {
    rows: res.conversations.map(mapGlobalChatListRow),
    archived: (res.archived ?? []).map(row => ({
      ...mapGlobalChatListRow(row),
      archived: true,
    })),
    hasMore: Boolean(res.has_more),
    nextOffset:
      typeof res.next_offset === 'number' && Number.isFinite(res.next_offset)
        ? res.next_offset
        : null,
  };
}

export async function entityHasPhoneInteraction(
  entityId: string,
  partnerEntityId: string,
): Promise<boolean> {
  const rows = await listInteractions(entityId, {
    presence_type: 'phone',
    participant_key: pairKey(entityId, partnerEntityId),
    limit: 1,
  });
  return rows.length > 0;
}

export async function getLastInteractionMessage(
  entity_id: string,
  participant_key: string,
): Promise<ConversationMessage | null> {
  // limit 1 with no `before` returns the newest message (the endpoint reverses
  // its newest-first page to chronological).
  const res = await engineApiClient.entityMessages(entity_id, participant_key, { limit: 1 });
  const rows = res.messages ?? [];
  if (rows.length === 0) return null;
  return mapConversationMessage(rows[rows.length - 1]);
}

export async function createInteraction(_interaction: Interaction): Promise<void> {
  throw new EngineApiUnsupportedError('createInteraction');
}

export async function updateInteraction(_interaction: Interaction): Promise<void> {
  throw new EngineApiUnsupportedError('updateInteraction');
}
