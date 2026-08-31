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
   `_new`-table rebuild** — **identical SQL to engine 1-1 INCLUDING the timestamp labels: the app adopts
   `created_at TIMESTAMP NOT NULL, updated_at DATETIME NOT NULL, deleted_at DATETIME` per amendment §9-A9
   (supersedes A1)**; includes `reply_to_message_id` + `is_read`; NO timestamp defaults either side (the actual
   000025 hazard — RN reads by storage class, ISO strings stay TEXT storage under NUMERIC affinity).
3. Replace `character_favorites` with the synced shape (watermark triple, `favorited_at` dropped).
4. Replace `chat_conversation_settings` with the slimmed shape (drop `unread_count`, `muted`, `blocked`; add
   `reply_mode TEXT NOT NULL DEFAULT 'realistic'`, `deleted_at`).
5. **§9-A9 reconciliation rebuilds (app-side only, engine untouched, Q12 intact)** — same migration, four more
   `_new`-table rebuilds adopting the engine's stored text so the post-migration dumps MATCH after comment
   normalization (§9-A8):
   - `emotion_state`: `deleted_at TEXT DEFAULT NULL` → `deleted_at DATETIME DEFAULT NULL` (only real diff).
   - `entity_emoji_actions`: `created_at/updated_at/deleted_at` TEXT → `DATETIME NOT NULL DEFAULT
     CURRENT_TIMESTAMP` / `DATETIME DEFAULT NULL` (defaults dormant — every writer supplies explicit timestamps;
     `normalizeTimestampForSync` covers strays).
   - `sync_history`: add the engine's `updated_at DATETIME DEFAULT CURRENT_TIMESTAMP` **in the engine's column
     position** (before `deleted_at`) — ALTER-append would land it last and keep the drift; use a rebuild.
   - `interactions`: `started_at/last_activity_at/ended_at/deleted_at/created_at/updated_at` TEXT → DATETIME;
     `memory_id`/`continued_interaction_id` gain explicit `NULL`; add the engine's trailing
     `FOREIGN KEY (entity_id) REFERENCES entities(id)` clause.
6. Update the header comments: rationale, `000039` reserved-placeholder note (keep), **extended dev-DB-wipe note**
   (devices that ran ANY earlier build of this branch — old 000041, old settings shape, personas table, shim
   entities — need the one-time wipe; the edited migration never re-runs for them).

## Implementation notes

- **TDD for the CODE in this change set (full-TDD ruling 2026-08-31; the migration SQL itself stays
  snapshot-based)**: write the tests RED before each implementation block lands in the same commit —
  repo bulk-semantics tests before `markConversationMessagesRead`/`getUnreadCountByParticipantKeys` (A2
  entity-scoping assertions); entity-flag tests before `setEntityMuted`/`setEntityDisabled` (A3 throw-for-user
  cases); `userEntities` repo suite before the repo (create/update/delete guards, `resolvePersonaId`
  sanitization); settings-repo tests before the slimmed surface.
- **PRAGMA foreign_keys**: the rebuild drops `conversation_messages` (referenced by nothing via FK app-side, but be
  safe) — wrap like `000037` did (`PRAGMA foreign_keys = OFF` before, `ON` after; rationale documented at
  `000037:10-19`). The §9-A9 rebuilds of `emotion_state`/`entity_emoji_actions`/`interactions` are FK-CHILD tables
  (they reference `entities`; nothing references them) — plain rebuilds, but keep them inside the same
  `PRAGMA foreign_keys = OFF` window for uniformity. (The `entities` rebuild itself is 1-3, not this doc.)
- The app INSERT SELECT source list = the app's current columns (includes `reactions_json`, `reply_to_message_id`,
  `is_pinned` already present from the restored reply feature); the engine's list (1-1) differs — both must produce
  identical final DDL text **except the A1 timestamp labels**.
- **Code that breaks at this commit and must be updated in the SAME commit** (green-commit rule; **amendment A5:
  the mute/disable/unread consumer rewiring lands HERE, not in Phase 4 — no UI goes dark mid-phase. Land 1-2 + 1-3
  app-side as ONE change set** so the entity-flag functions exist when the settings functions die):
  - `src/database/models.ts` — message model only (already has all fields; add `is_read?: boolean`). The settings
    model (`ChatConversationSettings` + `SettingsRow`) lives in
    `src/database/repositories/chatConversationSettings.ts:35-52` — remove `unread_count`/`muted`/`blocked`
    (physical `blocked` column + `SettingsRow` entries) and add `reply_mode` THERE.
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
  - `src/database/repositories/userEntities.ts` — **NEW, §9-A10 (pulls 5-4 §1 forward; no stub debt)**: the
    entities-backed identity repo (`getUserEntities()` filtering `entity_type='user'` — the column exists from
    1-3 in this same change set; `createUserPersona`, `updateUserPersona`, `deleteUserPersona` with the
    `'user'`-delete guard, `resolvePersonaId` validating stored ids against non-deleted user entities with
    `'user'` fallback). `src/database/repositories/personas.ts` becomes a **thin re-export shim** of it (same
    export surface: `Persona` shape, `getAllPersonas`/`createPersona`/`updatePersona`/`deletePersona`/
    `resolvePersonaId`) so every consumer (`ChatListScreen`, `CharactersScreen`, `ArchivedChatsScreen`,
    `CharacterChatService`, persona screens) keeps compiling and functional — the shim is deleted in 5-4.
    **Interim note (document in the shim header): the built-in `user` entity has no linked profile until 5-3's
    engine seeder lands, so the persona switcher's default row shows the raw `'user'` id until Phase 5.**
  - Migration snapshot tests: regenerate (`npx jest --selectProjects unit --testPathPatterns migrations -u`).
- Update `scripts/dump-schema.ts` — delete `personas`, `character_favorites`, `chat_conversation_settings` from
  `CLIENT_ONLY_TABLES` and (with 1-4) the whole mechanism; do the entry deletions HERE so the dump reflects
  reality the moment the mirror exists.

## Files

- Modify: `src/database/migrations/000041_consolidate_senju_features.ts`, `src/database/migrations.ts` (description
  string), `src/database/models.ts`, `src/database/repositories/chatConversationSettings.ts`,
  `src/database/repositories/characters.ts`, `src/database/repositories/entities.ts` (with 1-3),
  `src/database/repositories/conversation_messages.ts`, `src/database/sync.ts`,
  `src/database/repositories/personas.ts` (→ re-export shim), `src/services/EntitySessionService.ts`,
  `src/screens/ChatListScreen.tsx`, `src/screens/settings/ArchivedChatsScreen.tsx`,
  `src/screens/ChatDetailScreen.tsx`, `src/screens/settings/DisabledAIsScreen.tsx`, `scripts/dump-schema.ts`
- Create: `src/database/repositories/userEntities.ts` (§9-A10)
- Regenerate: `src/database/__tests__/__snapshots__/migrations.*.snap`, `schema/rn-schema.json`

## Verification

- [ ] `npx tsc --noEmit` = 0; `npm test` green (snapshots updated)
- [ ] `npm run schema:dump -- --output schema/rn-schema.json`; local compare vs engine branch dump
      (run once BOTH sides of the 1-1/1-2 pair exist locally — §9-A11): `character_favorites`,
      `chat_conversation_settings`, `conversation_messages`, `emotion_state`, `entity_emoji_actions`,
      `sync_history`, `interactions` ALL MATCH (after comment normalization §9-A8; `conversation_messages`
      byte-identical per §9-A9); `personas` absent from the dump; RN-only index leaks: zero; no new divergences
- [ ] Wipe note present in the migration header; userEntities repo + personas shim landed (§9-A10) with the
      interim `'user'`-raw-id note documented
- [ ] UI stays live through the change set: mute/disable/mark-unread menu actions work against entity flags;
      DisabledAIsScreen lists disabled AIs; badges derive from `is_read` (manual smoke)
- [ ] Grep: `setDisabledOverride|isSessionDisabled|listConversationsByFlag\('blocked'\)` → zero in `src/`
- [ ] `gitnexus_impact` on touched symbols (e.g. `getChatConversationSettings`) before editing;
      `gitnexus_detect_changes()` before committing
