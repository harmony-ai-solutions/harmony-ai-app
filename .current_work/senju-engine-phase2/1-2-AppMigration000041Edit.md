# 1-2 — App Migration 000041 Edit (Final Form, Personas Removed)

> Phase 1 / repo: **harmony-ai-app** (branch `senju-design-updates-rebase`).
> Contract: `21-Engine-Contract-Persona-Enums.md` §3.1–3.3, Q4/Q5/Q6/Q8/Q15.
> Pairs with 1-1: the two commits must land in lockstep (local parity compare green between them).

## Objective

Edit the **pre-mainline** `src/database/migrations/000041_consolidate_senju_features.ts` (B5 precedent — folding
into pre-release migrations is approved; only dev devices ever ran it) into its FINAL form:

1. Replace the `personas` CREATE with **nothing** (table dies; Q10 — personas become user entities; conversion
   skipped, wipe note covers).
2. Replace the three `ALTER TABLE conversation_messages ADD COLUMN …` + pinned index with the **canonical
   `_new`-table rebuild** (identical SQL to engine 1-1 **except the timestamp labels — app keeps
   `created_at/updated_at TEXT NOT NULL, deleted_at TEXT` per amendment A1**; includes `reply_to_message_id` +
   `is_read`).
3. Replace `character_favorites` with the synced shape (watermark triple, `favorited_at` dropped).
4. Replace `chat_conversation_settings` with the slimmed shape (drop `unread_count`, `muted`, `blocked`; add
   `reply_mode TEXT NOT NULL DEFAULT 'realistic'`, `deleted_at`).
5. Update the header comments: rationale, `000039` reserved-placeholder note (keep), **extended dev-DB-wipe note**
   (devices that ran ANY earlier build of this branch — old 000041, old settings shape, personas table, shim
   entities — need the one-time wipe; the edited migration never re-runs for them).

## Implementation notes

- **PRAGMA foreign_keys**: the rebuild drops `conversation_messages` (referenced by nothing via FK app-side, but be
  safe) — wrap like `000037` did (`PRAGMA foreign_keys = OFF` before, `ON` after; rationale documented at
  `000037:10-19`).
- The app INSERT SELECT source list = the app's current columns (includes `reactions_json`, `reply_to_message_id`,
  `is_pinned` already present from the restored reply feature); the engine's list (1-1) differs — both must produce
  identical final DDL text **except the A1 timestamp labels**.
- **Code that breaks at this commit and must be updated in the SAME commit** (green-commit rule; **amendment A5:
  the mute/disable/unread consumer rewiring lands HERE, not in Phase 4 — no UI goes dark mid-phase. Land 1-2 + 1-3
  app-side as ONE change set** so the entity-flag functions exist when the settings functions die):
  - `src/database/models.ts` — remove `unread_count`/`muted`/`blocked` from the settings model; add `reply_mode`;
    keep message model (already has all fields; add `is_read?: boolean`).
  - `src/database/repositories/chatConversationSettings.ts` — drop mute/disable/unread functions and columns from
    mapping/upsert; keep pinned/archived/get/batch (final surface, not interim); **all surviving writers pass the
    POV entity id in `entity_id` (A6 — today callers pass the PARTNER id: `ChatListScreen.tsx:713-714`,
    `ChatDetailScreen.tsx:1375`, `ArchivedChatsScreen.tsx:233`)**; document Q6 in the header.
  - `src/database/repositories/characters.ts` favorites fns — add `updated_at`/`deleted_at` handling to
    add/remove (soft-delete tombstones now; `removeCharacterFavorite` sets `deleted_at`, `addCharacterFavorite`
    clears it on resurrect). Note: the `TIMESTAMP DEFAULT CURRENT_TIMESTAMP` labels on the two new synced tables
    are dormant (every writer supplies explicit timestamps; `normalizeTimestampForSync` covers strays on upload) —
    keep it that way (A1 invariant: never rely on timestamp defaults app-side).
  - `src/database/repositories/entities.ts` (with 1-3) — `setEntityMuted`/`setEntityDisabled` via `updateEntityFields`
    (**A3 guard: throw for `entity_type='user'`**), `getDisabledEntityIds()`/`getMutedEntityIds()`.
  - Mute/disable UI rewiring (LOGIC ONLY — labels/i18n polish stays in 4-4): ChatListScreen `handleToggleMute`
    (:734-744) + `handleToggleDisable` (:785-815), ArchivedChatsScreen (:246-252, :322-352), ChatDetailScreen
    `handleDisableToggle` (:1357-1407) → entity repo. **DisabledAIsScreen is KEPT and rewired** from
    `listConversationsByFlag('blocked')` to disabled AI entities (`entity_type='ai' AND is_disabled=1`) — A5 (it is
    the existing management UI: `AccountSettingsScreen.tsx:72` → `AppNavigator.tsx:206`; the earlier "ArchivedChats
    disabled filter" reference was wrong). ChatList disabled-row filtering = social-blocked
    (`SocialService.getBlockedUserIds`, **UNCHANGED — A4**) ∪ disabled entities — never a replacement.
  - `EntitySessionService` — retire `setDisabledOverride`/`isSessionDisabled` (:1342-1376) in favor of entity-flag
    checks; the unread-increment block (:1892-1899) is DELETED (derivation replaces it); muted-suppression reads
    partner `is_muted` from the entities map.
  - Derived-unread CORE pulled forward from 3-1 (A5 — `is_read` exists after this migration): `is_read` → boolean
    fields sync map (`sync.ts:193`); repo `markConversationMessagesRead` / `markConversationMessagesUnread` /
    `getUnreadCountByParticipantKeys` — **every query scoped `entity_id = own POV` (A2: engine-perspective copies
    sync in under per-side uuids and join the same `interaction_id`; unscoped queries double-render/double-count)**;
    ChatList badge seams (:371-383 list load, :539-599 live handler, :84-91 bubble), ArchivedChats (:307-320), and
    ChatDetail `persistMarkAsRead` (:1676-1688) read/write derived state. `chat_last_read_*` removal, the
    `sync:messages-applied` recount event and divider derivation stay in 3-1 (harmless interim: the legacy divider
    keys keep working until then).
  - `src/database/repositories/personas.ts` + screens importing it — **Phase 5 rewires these**; to stay green NOW,
    keep the `personas` repo compiling by having it create/access the table ONLY if it exists → NOT acceptable
    (orphaned DB access rule). Instead: minimum viable bridge — the repo's create/list functions switch to the
    entities-backed implementation in Phase 5; for THIS commit, delete the personas table access and stub the repo
    surface (`getAllPersonas` returns `[]`, create throws "personas are user entities now") with TODO(5-4) —
    persona UI is explicitly broken-until-Phase-5 (acceptable: dev branch, documented).
  - Migration snapshot tests: regenerate (`npx jest --selectProjects unit --testPathPatterns migrations -u`).
- Update `scripts/dump-schema.ts` — delete `personas`, `character_favorites`, `chat_conversation_settings` from
  `CLIENT_ONLY_TABLES` and (with 1-4) the whole mechanism; do the entry deletions HERE so the dump reflects
  reality the moment the mirror exists.

## Files

- Modify: `src/database/migrations/000041_consolidate_senju_features.ts`, `src/database/migrations.ts` (description
  string), `src/database/models.ts`, `src/database/repositories/chatConversationSettings.ts`,
  `src/database/repositories/characters.ts`, `src/database/repositories/entities.ts` (with 1-3),
  `src/database/repositories/conversation_messages.ts`, `src/database/sync.ts`,
  `src/database/repositories/personas.ts`, `src/services/EntitySessionService.ts`, `src/screens/ChatListScreen.tsx`,
  `src/screens/ArchivedChatsScreen.tsx`, `src/screens/ChatDetailScreen.tsx`,
  `src/screens/settings/DisabledAIsScreen.tsx`, `scripts/dump-schema.ts`
- Regenerate: `src/database/__tests__/__snapshots__/migrations.*.snap`, `schema/rn-schema.json`

## Verification

- [ ] `npx tsc --noEmit` = 0; `npm test` green (snapshots updated)
- [ ] `npm run schema:dump -- --output schema/rn-schema.json`; local compare vs engine branch dump:
      the three objects MATCH; `personas` absent from the dump; no new divergences
- [ ] Wipe note present in the migration header; personas repo stub TODO(5-4) documented
- [ ] UI stays live through the change set: mute/disable/mark-unread menu actions work against entity flags;
      DisabledAIsScreen lists disabled AIs; badges derive from `is_read` (manual smoke)
- [ ] Grep: `setDisabledOverride|isSessionDisabled|listConversationsByFlag\('blocked'\)` → zero in `src/`
- [ ] `gitnexus_impact` on touched symbols (e.g. `getChatConversationSettings`) before editing;
      `gitnexus_detect_changes()` before committing
