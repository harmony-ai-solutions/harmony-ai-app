# 3-1 — App Read-Flags & Derived Unread

> Phase 3 / repo: **harmony-ai-app**. Contract: `21-Engine-Contract` Q1/Q3; sync-side facts from research
> (unread seams; the sync-arrived-messages badge bug). Prerequisite: Phase 1 + 2 landed.

## Objective

`is_read` becomes the single source of read-state; `unread_count` (already dropped from the schema) and the
`chat_last_read_*` AsyncStorage system die; unread badges derive from message rows — including for messages that
arrive via sync (fixes: synced messages never bump any badge today, because the increment only lives in the live-WS
path, `EntitySessionService.ts:1879-1898`).

## Changes

1. **Repo layer** — `src/database/repositories/conversation_messages.ts`:
   - `updateConversationMessage` already pattern-exists; add `markConversationMessagesRead(participantKey, ownEntityId,
     upToMessageId?)` — bulk `UPDATE … SET is_read = 1, updated_at = ? WHERE` partner-sent (`sender_entity_id != own`)
     AND `is_read = 0` (AND `created_at <= upTo` when given); returns count.
   - New read query: `getUnreadCountByParticipantKeys(keys[], ownEntityId)` — batched (300-key chunks, mirrors
     `getChatConversationSettingsBatch`) GROUP BY participant_key count of unread partner-sent rows
     (`deleted_at IS NULL`). Used by the list seam.
   - `is_read` added to the booleanFields sync map (`src/database/sync.ts:193`).
2. **Open-conversation marking** — ChatDetail: on focus/message-render, `markConversationMessagesRead(...)` fire-and-forget
   (replaces `persistMarkAsRead`, `ChatDetailScreen.tsx:1636-1648`). "New" divider = position of first unread message
   at open (derive from the loaded page; no AsyncStorage). "Mark unread" (F10 menu action) →
   `setConversationUnread`-replacement: `markConversationMessagesUnread(participantKey, ownEntityId, count=1)` — set
   `is_read = 0` on the LAST partner-sent message only (set-to-1 semantics preserved).
3. **The three badge seams** (ChatListScreen):
   - list load (`:371-383`): unread map ← `getUnreadCountByParticipantKeys` instead of settings batch.
   - live update (`message:received` handler, `:559-590`): incremental — if conversation open in this list's POV and
     not muted-suppressed (partner `is_muted` check via entities map — O10, now entity-level per Q8), bump the row's
     derived count; the guard set `openConversationKeys` (`EntitySessionService.ts:1319-1329`) stays (open conv → the
     app marks read anyway).
   - bubble badge (`:84-92`): recompute from the same derived map.
   - Sync-apply hook: `applyBufferedSyncData` end (`SyncService.ts` around :1083 where emoji caches invalidate) →
     emit a `sync:messages-applied` event (or reuse an existing invalidation) that ChatList subscribes to → debounced
     unread recount. This is the fix for synced-in messages never badging.
4. **Deletions**:
   - `ChatPreferencesService`: delete `LAST_READ_PREFIX`/`chat_last_read_*` family (get/set/clear + all call sites
     in ChatDetail `:462-466,1643`); keep `REPLY_MODE_PREFIX` (dies in 4-4) + `GLOBAL_ENTITY_KEY` + sweep helper for
     `chat_entity_pref_*` (Q14 — add `sweepLegacyEntityPrefs()` called once from App bootstrap or settings open).
   - `chatConversationSettings.ts`: delete `incrementConversationUnread`/`clearConversationUnread`/
     `setConversationUnread` remnants if still referenced (schema already dropped the column in 1-2; this phase
     removes the last behavioral references).
   - `EntitySessionService.handleIncomingMessage` (`:1879-1898`): the unread-increment block is DELETED — derivation
     replaces it; keep the disabled-drop check but move it to the entity-level gate (partner `is_disabled` → drop,
     defense-in-depth; primary enforcement is engine-side INIT rejection, 4-3).
5. **ArchivedChatsScreen** (`:310-316`): clear-on-open → `markConversationMessagesRead`; badge columns from the same map.

## Tests

- Repo tests: mark-read bulk semantics (own vs partner sent, deleted excluded, upTo boundary), unread counts batch,
  mark-unread sets exactly 1. Service/screen tests: badge seam rendering with derived map; muted partner suppresses
  badge (O10); sync-apply recount event fires handler.

## Verification

- [ ] `npx tsc --noEmit` = 0; `npm test` green (unit + integration)
- [ ] Grep gates: `chat_last_read_|getKeyLastRead|incrementConversationUnread|unread_count` → zero in `src/`
- [ ] `gitnexus_impact` on `getChatConversationSettings`-consumers + `ChatListScreen` before editing;
      `gitnexus_detect_changes()` before committing
