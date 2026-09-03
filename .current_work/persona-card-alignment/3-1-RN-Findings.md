# 3-1 — RN Persona Surface Investigation: Findings

> Phase 3-1 of `persona-card-alignment` (decision 5). Research-only — no production code changed, no commits.
> Branch: `senju-design-updates-rebase`. Author: general research agent. Date: 2026-09-03.
> Companion plan doc: `3-1-RNPersonaSurfaceInvestigation.md` (deliverable note points here).

---

## 0. Executive summary

The RN app **already implements the persona-as-user-entity model** (entity `entity_type='user'` + linked `character_profiles` row + `character_image` avatar) via `src/database/repositories/userEntities.ts` (migration 000042 + commit `4db2ab7` "user-entity identity surface final — screens, from-card, shim deleted, A3 picker audit (5-4)"). The engine's new capabilities (1-1 write guards, 1-2 delete cascade, 1-3 duplicate endpoint) therefore land on top of an app that is *mostly aligned already on the read side*:

- **Read-side card filtering already exists**: `getAllCharacterProfiles()` excludes profiles referenced by any `entity_type='user'` entity (`NOT EXISTS` subquery, `characters.ts:235-308`), and every AI-partner listing surface (Characters tab, chat partner picker, AI card picker, Discover via marketplace stub) flows through it. `ForwardPickerModal` additionally skips `entity_type === 'user'` entities.
- **The persona editor touches only 3 identity fields + avatar** (`PersonaEditScreen` → `userEntities` repo) — exactly the gap decision 11 targets ("3-field modal fully replaced by the full editor").
- **The "create persona from this card" flow is identity-only prefill (P1 semantics)** (`CharactersScreen.handleCreatePersonaFromCard` → `PersonaEdit` `prefill` route param) — decision 4/7 require a **full-card copy** instead. This is the single biggest app-side semantic change.
- **The RN app calls NO management REST API** for entities/profiles/images — everything flows through the WS sync protocol (SYNC_TABLES). The engine 1-3 duplicate endpoint is engine-FE (Wails) oriented; the RN app needs an equivalent **local** full-copy helper, not an HTTP client.
- **Sync delete propagation is tombstone-based and sound**: engine 1-2 must soft-delete (tombstone) profile + images for the app to cleanly vanish them (the plan says it will). Two app-side gaps to close in 3-2: `deleteUserPersona` does not soft-delete the persona's own `character_image` rows nor trigger a sync after delete.
- **Chat-target gates are already closed** (verified across every AI-selection list).
- **No dedicated rename UI exists**; rename today is the PersonaEdit name field (profile name + entity alias, id frozen). No persona export UI exists (export exists only in CreateAI edit mode for AI cards).

---

## 1. Persona surface map

Legend: R = read, W = write, D = delete, S = switch (set active persona).

| # | Surface | File | Op | Profile fields touched | Mechanism / service | Sync impact |
|---|---------|------|----|------------------------|----------------------|-------------|
| 1 | My Profile tab — persona list + active chip + "new persona" | `src/screens/MyProfileScreen.tsx` (personas tab, `loadPersonas`) | R, S | `name`, `description`, `avatarUri` (primary image), `isActive` | `getUserEntities()` (`userEntities.ts:85` — LEFT JOIN `character_profiles` + `getPrimaryImage`); active id via `ChatPreferencesService.getGlobalImpersonatedEntity()` | n/a (reads local SQLite) |
| 2 | Persona row component | `src/components/profile/PersonaRow.tsx` | R (presentation) | `name`, `description`, `avatarUri`, `isActive` | Props from MyProfileScreen | n/a |
| 3 | Persona create / edit / delete | `src/screens/PersonaEditScreen.tsx` | R, W, D | `name`, `description`, `personality`, avatar (`character_image` primary) | `createUserPersona` / `getUserPersona` / `updateUserPersona` / `deleteUserPersona` (`userEntities.ts`); save triggers `syncService.syncAndWait`; delete does NOT sync | Profile + entity + image rows sync via SYNC_TABLES |
| 4 | Persona switcher (chat "chatting as") | `src/components/modals/PersonaSwitcherModal.tsx` | R, S | `name`, `personality`, `avatarUri` | `getUserEntities()`; `ChatPreferencesService` | n/a |
| 5 | Voice input settings (global shared STT) | `src/screens/settings/VoiceInputSettingsScreen.tsx` | R, W | None (persona profile untouched) — canonical `user` entity `entity_module_mappings.stt_config_id` | `getEntity`, `getEntityModuleMapping`, `createOrUpdateEntityModuleMapping`, `getAllSTTConfigs`, `updateSTTConfig`, `resolveVoiceInputState` | STT config + `user` mapping rows sync |
| 6 | STT/VAD test panels | `src/services/voiceInput/moduleTestSessionService.ts` + `SttTestPanel` | R (transient eventserver `debug` session) | None (INITs persona entity over WS, engine runs synced STT config) | `moduleTestSessionService` — explicitly NOT HTTP | n/a (transient WS) |
| 7 | Characters tab (AI library) | `src/screens/CharactersScreen.tsx` | R, W, D, import, duplicate, from-card | Full profile list; persona-from-card uses only identity fields (prefill) | `getAllCharacterProfiles()` (filtered), `createCharacterProfile`, `deleteCharacterProfileCascade`, `mapCardToProfile` import, `handleCreatePersonaFromCard` → PersonaEdit prefill | Import triggers `syncService.initiateSync` |
| 8 | AI create / edit / duplicate | `src/screens/CreateAIScreen.tsx` | R, W, D (AI profiles) | Full V3 profile + images + entity module mapping; export (JSON/PNG) in edit mode | characters / entities / modules repos; `exportProfileToCardV3`, `exportToJSON`, `exportToPNG` | `syncService.initiateSync` after save/edit |
| 9 | AI profile page | `src/screens/AIProfileScreen.tsx` | R | Full profile by id (`getCharacterProfile` — UNFILTERED single-row getter) | `getCharacterProfile(profileId)`, `getSiblingCharacterProfiles` (filtered) | n/a |
| 10 | Chat list (new-chat partner picker) | `src/screens/ChatListScreen.tsx` + `src/components/chat/ChatPartnerPickerModal.tsx` | R | Full profile list (filtered) | `getAllCharacterProfiles()` | n/a |
| 11 | Chat detail (partner avatar/name + persona switcher) | `src/screens/ChatDetailScreen.tsx` | R | Partner profile by entity (`getCharacterProfile(entity.character_profile_id)`); persona via `getUserPersona` | entities/characters/userEntities repos | n/a |
| 12 | Message forward picker | `src/components/chat/ForwardPickerModal.tsx` | R | Entities; **skips `entity_type === 'user'`** (line 101) | `getAllEntities` + guard | n/a |
| 13 | Settings — disabled AIs / archived chats | `src/screens/settings/DisabledAIsScreen.tsx`, `ArchivedChatsScreen.tsx` | R | Profile by entity id | `getCharacterProfile(entity.character_profile_id)` (entity-driven) | n/a |
| 14 | My Profile — AI Characters stat | `MyProfileScreen.loadCharacters` → `getUserCharacterProfiles()` | R | Count of filtered profiles | `getUserCharacterProfiles` = `getAllCharacterProfiles` (filtered) | n/a |
| 15 | Marketplace publish / content-asset apply | `MarketplacePublishScreen.tsx`, `ContentAssetScreen.tsx` | R | `getUserCharacterProfiles()` (filtered) | filtered getter | n/a |

**Profile columns the persona surfaces touch**: `name`, `description`, `personality`, plus the primary `character_image` (avatar). All other `character_profiles` columns are written as `minimalProfileColumns()` defaults (`voice_characteristics`, `base_prompt`, `scenario`, `first_mes`, `mes_example`, `alternate_greetings`, `post_history_instructions`, `creator_notes`, `creator`, `character_version`, `nickname`, `tags`, `group_only_greetings`, `extensions`, `assets`, `card_provenance`, `character_book`, `lifecycle_config`, `vision_config_id`, `typing_speed_wpm`, `audio_response_chance_percent`) — untouched until decision 11's full editor lands.

**Entity columns touched**: `id` (= original name, FROZEN), `alias` (kept in sync with profile name on rename), `entity_type='user'`, `character_profile_id`, `rag_reindex_required=1`, `lifecycle_config='{}'`.

---

## 2. Card surface leaks (persona-owned cards into AI surfaces)

### Already guarded (read-side filtering in place)
- `getAllCharacterProfiles()` (`characters.ts:235-308`) — the **central read guard**: `WHERE deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM entities e WHERE e.character_profile_id = character_profiles.id AND e.entity_type = 'user')`. Comment `§9-A3` states the intent explicitly. **All** of the following use it: Characters tab, `AICardPickerModal` (duplicate/from-existing picker), `ChatPartnerPickerModal` (new-chat picker), `getSiblingCharacterProfiles`, CreateAI tag suggestions, `getDistinctTags` fallback.
- `getUserCharacterProfiles()` — alias of the filtered getter (My Profile AI-stat, Market publish, ContentAsset).
- `ForwardPickerModal.tsx:101` — `if (entity.entity_type === 'user') continue;` (pinned by `ForwardPickerModal.test.tsx`).
- `openCharacterChat` (`CharacterChatService.ts`) — only ever receives profiles from filtered entry points; also blocks disabled AI entities client-side.
- `resolvePersonaId` (`userEntities.ts:359`) — only `user` entities resolve as impersonation identities; AI entities never.
- Discover (`DiscoverScreen.tsx`) — stub **marketplace fixture feed** (`MarketplaceService.getListings()`), never local `character_profiles`; no persona path.
- `EntitySessionService` INIT — user entities are valid INIT targets (identity side); there is no persona-as-partner path.
- `CreateAI` "From an Existing One" (`prefillProfileId`) — picker is `AICardPickerModal` (filtered); the only way a profile id reaches `CreateAI` as a link target.

### Latent / hardening items (no live leak today)
- **`getCharacterProfile(id)` is an UNFILTERED single-row getter** (`characters.ts:88`). Used by `AIProfileScreen` (route param `profileId`), `ChatDetailScreen`, `DisabledAIsScreen`, `ArchivedChatsScreen` (entity-driven). Every current caller obtains the id from an already-filtered source (Characters/Saved/Chat partner/disabled/archived entities), so no persona-owned profile can be reached in normal flows — but any future surface that passes a raw profile id (deep links, Discover→AIProfile once real) could render a persona card as an AI. **Recommendation (3-2, low):** add a defensive persona-owned check in the AI-profile read path or a filtered variant, mirroring the engine's 1-1 guard intent on the read side.
- **`AIProfileScreen` edit affordance** navigates to `CreateAI {editProfileId}` — if ever reached with a persona profile id it would let a persona card be edited as an AI partner. Same hardening applies.

### Must-change surfaces (decision 4/7)
- **`CharactersScreen.handleCreatePersonaFromCard` (`CharactersScreen.tsx:544`)** — currently prefills ONLY identity fields (name/description/personality/avatarUri) into PersonaEdit create mode (P1 semantics, documented in the code comment). Decision 7 ("immediate full-copy create → editor opens") + decision 4 ("copies the FULL card") require a **full-card copy**: all V3 spec fields + Soulbits fields + **all images with primary flag preserved** (decision 9), then open the editor on the new persona. The RN already has the exact full-fork machinery for AI cards in `CreateAIScreen`'s `duplicateProfileId` flow (profile fields + avatar + gallery + module mapping) — the persona path must reuse that pattern but target a `user` entity via `createUserPersona`-style repo work.
- `AppNavigator.tsx` `PersonaEditPrefill` type + `PersonaEditScreen` prefill handling become obsolete for the from-card flow (full-copy create happens before/during editor open).

---

## 3. API surface used

**The RN app calls NO management-API endpoint for entities, profiles, or images.** Verified by grep (`character-profiles`, `/api/`, `duplicate` in `src/services/`/`src/`) and confirmed by `moduleTestSessionService.ts:7-9`: *"The app must NOT call the engine's management server over HTTP (not cloud-reachable)."* All entity/profile/image data flows over the **WebSocket sync protocol** as table rows.

- **Sync tables involved (SYNC_TABLES, `SyncService.ts:81-122`):** `character_profiles`, `character_image`, `entities`, `entity_module_mappings` (plus module/provider configs).
- **Cloud REST usage is unrelated to card management**: `POST /v1/auth/*` (AuthService), `POST /v1/session/*` (CloudSessionService), `GET /v1/models` (catalog), inference URL. No `/v1/character-profiles` or similar.

### What the new engine capabilities require app-side

| Engine capability | RN requirement |
|---|---|
| **1-1 write guards** (AI entity cannot take persona-owned profile; persona↔profile 1:1) | Already satisfied read-side by the filtered getters. Defense-in-depth option (3-2, code-expert): a guard in the app's `createEntity`/`updateEntityFields` paths (like `assertEntityFlagTarget` at `entities.ts:370`) so no app code path can ever link a persona-owned profile to an AI entity. No UI change needed (no AI-side profile-link UI exists — `CreateAI` creates its own profile). |
| **1-2 persona delete cascade** (entity + profile + images) | Sync-tombstone propagation (see §4). App-side parity work in `deleteUserPersona` (`userEntities.ts:333`): also soft-delete the persona's `character_image` rows and trigger `syncService.initiateSync()` after delete. |
| **1-3 duplicate endpoint** (`POST /api/character-profiles/{id}/duplicate`) | **Not consumed by RN** (engine-FE oriented). RN needs a **local** full-copy helper for persona-from-card (reuse the CreateAI duplicate pattern; copy `card_provenance` as-is per decision 6, reset `is_favorite`/`lifecycle_config` per the engine's field matrix, preserve primary flag per decision 9). |
| **RenameEntity** (engine decision 3, type-preserving, built-in protected) | RN already renames via profile name + alias update (id frozen) — sync-compatible, no REST dependency. See §6. |
| **Import / export** | Import exists (`CharacterCardImportService` + `parseCardFile` in CharactersScreen). Export exists only for AI cards (`CreateAIScreen` edit mode). **Persona export does not exist today** — decision 2-4 parity requires adding it to the persona editor (3-2, ui-ux). |

---

## 4. Sync propagation (persona cascade delete → app state)

### Mechanism
- Two-way WS sync, **row-level LWW**, **soft-delete tombstones**. Inbound apply (`SyncService.applyBufferedSyncData`, `SyncService.ts:900-1080`): `operation === 'delete'` sets `deleted_at` on the local row. Records are buffered and applied atomically in FK-safe `TABLE_ORDER` (character_profiles → character_image → entities → entity_module_mappings → …).
- On `SYNC_FINALIZE`, `cleanupSoftDeletedRecords` (`SyncService.ts:1551`) **hard-deletes** rows whose `deleted_at` predates the session start for all relevant tables (incl. `character_profiles`, `character_image`, `entities`, `entity_module_mappings`). So tombstones that have been synced get physically purged.
- Outbound: `getChangedRecords` (`database/sync.ts:304`) uploads rows changed since the watermark, **including tombstones** (`deleted_at` newer than watermark). `character_image` rides `TEXT_TABLES` two-phase query.

### Cascade-delete analysis (would it leave ghosts?)
- **Engine 1-2 (per plan `1-2-EnginePersonaDeleteCascade.md`) soft-deletes the profile + images** → tombstones sync down → app applies them → `cleanupSoftDeletedRecords` purges. **Clean vanish, no visible ghosts.**
- **Risk — hard-delete on the engine**: if the engine physically `DELETE`s the profile/images (no tombstone), the app's local copies stay forever. The persona list would still clear (entity tombstone) and `getAllCharacterProfiles()` would still hide the profile (the `NOT EXISTS` filter does NOT check `entities.deleted_at`, so even a soft-deleted user entity hides its profile). Ghosts would be invisible but occupy storage and stay on disk. **Gate for Phase 1: engine 1-2 must emit tombstones** (plan says it will; the app should NOT rely on hard-delete).
- **App-side gap 1**: `deleteUserPersona` (`userEntities.ts:333`) soft-deletes the entity + profile but **NOT the persona's `character_image` rows**. Immediately after local delete, image rows remain live locally until the engine's cascade tombstones round-trip. Eventually clean; recommend mirroring the cascade locally (3-2, code-expert).
- **App-side gap 2**: `PersonaEditScreen.handleDelete` does **not** trigger a sync after `deleteUserPersona` (the save path does `syncAndWait`; delete doesn't). Tombstones only reach the engine on the next opportunistic sync. Recommend `syncService.initiateSync()` after delete (3-2).

### Sync test harness that can prove it
- `__tests__/integration/helpers/HarmonyLinkMockServer.ts` — classifies records by `deleted_at` (`record.deleted_at ? 'delete' : …`, line ~405) and `setServerData(table, records)` pushes arbitrary rows.
- `__tests__/integration/helpers/fixtures.ts` — `sampleEntity`, `sampleCharacter`, `insertCharacterProfile` factories.
- **Existing proof points**: `syncService.integration.test.ts` Test 5 ("propagates soft-deleted records from server", line 380) — soft-delete propagation for `character_profiles`; `sync.conflict.integration.test.ts` Test 3 ("server soft-delete overrides local update", line 265); `sync.lifecycleState.integration.test.ts` (entity-keyed soft-delete).
- **Missing (3-2, code-expert): a persona-cascade integration test** that pushes entity + profile + image tombstones in one SYNC_DATA batch (simulating engine 1-2) and asserts: (a) `getUserEntities` no longer returns the persona, (b) `getAllCharacterProfiles` excludes the profile, (c) images are soft-deleted then purged by `cleanupSoftDeletedRecords`, (d) no ghost rows remain.
- Local repo tests that already pin cascade semantics: `userEntities.test.ts` (delete → entity + profile soft-deleted), `personas.test.ts` (entity_type defense), `characters.test.ts` (profile delete cascade), `cross-repo.test.ts` (FK cascade profile → images).

---

## 5. Chat-target gates (persona-owned profiles never offered as AI targets)

**Status: CLOSED.** Verified every AI-selection surface:

| Surface | Data source | Guard |
|---|---|---|
| New-chat partner picker | `ChatPartnerPickerModal.tsx:93` → `getAllCharacterProfiles()` | Filtered (user-referenced profiles excluded) |
| Message forward picker | `ForwardPickerModal.tsx:101` | `entity_type !== 'user'` skip (test-pinned) |
| AI card picker (duplicate / from-existing) | `AICardPickerModal.tsx:100` → `getAllCharacterProfiles()` | Filtered |
| Characters tab cards | `CharactersScreen.tsx:318` → `getAllCharacterProfiles()` | Filtered |
| `openCharacterChat` entry points | Characters / ChatList / AIProfile / Discover / Market | Only receive filtered profiles; also blocks disabled AI entities |
| Impersonation resolution | `resolvePersonaId` (`userEntities.ts:359`) | Only `user` entities are identities — AI entities never impersonated |
| Persona switcher | `PersonaSwitcherModal` → `getUserEntities()` | Only `user` entities listed |
| INIT_ENTITY | `EntitySessionService` | User entities valid INIT targets (identity side); no persona-as-partner path |

No surface can offer a persona-owned `character_profiles` row as an AI chat target today. The engine 1-1 write guard is defense-in-depth for the engine-FE; the RN app already has equivalent read-side filtering (stronger, since it's at the repository layer). The only latent hole is the unfiltered `getCharacterProfile(id)` single-row getter (§2) — worth a defensive guard in 3-2.

---

## 6. Rename surfaces

- **Persona rename TODAY = the PersonaEditScreen name field** (`updateUserPersona` → profile `name` + entity `alias` updated; entity **id FROZEN** — `userEntities.ts:247-287`, pinned by test "renames (profile + alias) but keeps the entity id FROZEN"). No dedicated "rename" affordance — rename is just editing.
- **Built-in `user`**: editable name/description/personality/avatar (after the engine seeder syncs its profile — `updateUserPersona` throws "no linked profile" if `character_profile_id` is null), **delete blocked** (`isBuiltIn` gate + `deleteUserPersona('user')` throws; `userEntities.ts:334`).
- **Active-persona delete gate**: `PersonaEditScreen` blocks deleting the currently-active global impersonated entity (review 2a), resets pref to `'user'` after delete.
- **AI entity rename**: `CreateAIScreen` edit mode renames via `updateEntityFields(editEntityId, { alias })` when the name changes (`CreateAIScreen.tsx:1180-1194`), with UNIQUE-alias conflict handling. Id frozen.
- **Engine `RenameEntity` (decision 3)**: id-changing, type-preserving, built-in protected — **engine-FE (Wails) oriented**. The RN app does not call it; the RN frozen-id + alias/profile rename is sync-compatible (row sync keys on id) and needs no change beyond parity UX.
- **No persona export UI today** (export = `CreateAIScreen` edit-mode ExportSection for AI cards only). **No duplicate-persona UI today** (CreateAI `duplicateProfileId` forks AI cards only). Both land in 3-2 (ui-ux for the UI, code-expert for the underlying copy/export helpers).

---

## 7. 3-2+ phase proposal (seam split)

Standing seam (user, 2026-09-03): **stores/services/sync → code-expert; screens/components → ui-ux-expert.** Mixed items get split at that boundary. All phases share the RN gate: `npx.cmd tsc --noEmit` = 0, targeted jest + full `npm.cmd test` green, `gitnexus_impact` before edits, `gitnexus_detect_changes` before commits, no merges/pushes.

### Phase 3-2 — Persona full-card editor + from-card full-copy (core decision 4/7/11)

**3-2-A — code-expert (stores/services/repos)**
- Extend `userEntities.ts` with full-profile persona writes: `createUserPersona`/`updateUserPersona` accept the full V3 profile field set (+ gallery images beyond the primary) instead of `minimalProfileColumns()`; keep entity id frozen, alias synced, built-in `user` still editable-once-seeded / delete-protected.
- New local **full-card copy helper** for persona-from-card (mirrors engine 1-3 field matrix): all spec fields + Soulbits fields copied, `id` fresh, `name` deduped (`getNextEntityAliasCopy`), `is_favorite` reset 0, `lifecycle_config` reset `{}`, `card_provenance` **copied as-is** (decision 6), **all images copied with primary flag preserved** (decision 9), then a `user` entity created. Unit tests in `personas.test.ts`/new `personaFromCard.test.ts`.
- `deleteUserPersona` parity: also soft-delete the persona's `character_image` rows; guard with the same 1-1 semantics (throw on AI entity, protect `user`).
- New **persona-cascade sync integration test** (§4) proving entity+profile+image tombstones apply + purge cleanly.
- Defensive read guard (low): filtered single-profile getter or persona-owned assertion for AI-profile contexts (`AIProfileScreen` path).

**3-2-B — ui-ux-expert (screens/components)**
- Replace the 3-field `PersonaEditScreen` form with the full editor. The RN already has the full editor machinery in `CreateAIScreen` edit mode (Greeting/Lorebook/Images/Tags/Lifecycle/Attribution/Export sections via `src/components/character-card/editor-sections/*`). Extract/reuse those sections in `personaMode` (hide lifecycle + advanced per decision 2; keep lorebook + greetings per decision 2 — note decision 2 says "Only lifecycle + advanced hidden for personas", so Lorebook/Greetings/Images/Attribution/Tags stay).
- Rewire `CharactersScreen.handleCreatePersonaFromCard` to the **immediate full-copy create → editor opens** flow (decision 7); retire the identity-only `prefill` path.
- Built-in `user` row gets the same full editor with rename/delete locked (decision 8).
- Persona export (JSON/PNG) in the persona editor (parity with 2-4), plus persona rename UX parity.

### Phase 3-3 — Character-tab + AI-entity filter hardening (defense-in-depth, decision 1)
- **code-expert**: guard app-side entity write paths (`createEntity`/`updateEntityFields`) so a persona-owned profile can never be linked to an `entity_type='ai'` entity (mirrors engine 1-1); unit tests.
- **ui-ux-expert**: verify/refresh copy on any AI surfaces that could hint at persona cards ("stale hint" parity with 2-2 if any surface is ever reached with a persona card); no functional change expected given §2.

### Phase 3-4 — Sync-surface polish (parity with 1-2)
- **code-expert**: post-delete `syncService.initiateSync()` in `PersonaEditScreen` delete path (or better: inside `deleteUserPersona`/a service wrapper so all callers get it); verify `sync:data-applied` consumers include `entities`/`character_image` reload triggers where persona list/avatar could be stale (currently only `character_profiles` triggers CharactersScreen reload).
- **ui-ux-expert**: none expected.

### Gates per phase
- 3-2-A: `npx.cmd tsc --noEmit` 0; `npx jest --selectProjects unit --testPathPatterns "persona|userEntities|characters"` green; new tests RED→GREEN.
- 3-2-B: same typecheck gate; targeted component tests for `PersonaEditScreen`/`CharactersScreen`; `npm.cmd test` full green; manual smoke on device list.
- 3-3/3-4: typecheck + full unit/integration green; schema parity `compare-schemas.py` exit 0 (no schema changes expected).

### Open questions for the user
1. **RN from-card UX**: decision 7 says "immediate full-copy create → editor opens." Should the RN flow create the full copy *silently* on menu tap then open the editor on the new persona (engine-FE parity), or keep a lightweight confirmation sheet (RN pattern) before persisting? (Proposal: parity — create + open, with the editor offering delete if unwanted.)
2. **Editor depth for personas on RN**: decision 2 hides lifecycle + advanced only; confirm the RN full editor reuses `CreateAIScreen`'s section components as-is (including the images tab and greeting-test flow that needs an entity + interaction) or a slimmed persona variant (greeting test requires a chat context — personas don't chat as partners). (Proposal: reuse sections; disable greeting test in personaMode.)
3. **Built-in `user` full editor**: decision 8 grants the full editor with rename/delete locked. On RN, pre-seeder the built-in `user` has NO profile (`updateUserPersona` throws); confirm the editor shows a disabled/empty state until the engine seeds "You" (Proposal: yes, with the existing pre-seed empty state).
4. **App-side delete parity**: confirm `deleteUserPersona` should also trigger a sync immediately after delete (Proposal: yes — `initiateSync`, not blocking `syncAndWait`).

---

## Appendix — key files

- Persona repo: `src/database/repositories/userEntities.ts` (369 lines)
- Persona screens: `src/screens/PersonaEditScreen.tsx`, `src/screens/MyProfileScreen.tsx`, `src/components/profile/PersonaRow.tsx`, `src/components/modals/PersonaSwitcherModal.tsx`
- AI surfaces: `src/screens/CharactersScreen.tsx`, `src/screens/CreateAIScreen.tsx`, `src/screens/AIProfileScreen.tsx`, `src/components/characters/AICardPickerModal.tsx`, `src/components/chat/ChatPartnerPickerModal.tsx`, `src/components/chat/ForwardPickerModal.tsx`
- Character repo (filtered getters): `src/database/repositories/characters.ts`
- Entities repo (entity_type, guards): `src/database/repositories/entities.ts`
- Sync: `src/services/SyncService.ts` (SYNC_TABLES, apply, cleanupSoftDeletedRecords), `src/database/sync.ts`
- Voice input: `src/screens/settings/VoiceInputSettingsScreen.tsx`, `src/services/voiceInput/{resolveVoiceInputState,moduleTestSessionService}.ts`
- Tests: `src/database/__tests__/repositories/{personas,userEntities,characters,entities,cross-repo}.test.ts`, `__tests__/integration/{syncService,sync.conflict,sync.lifecycleState}.integration.test.ts`, `src/components/chat/__tests__/ForwardPickerModal.test.tsx`
- Migrations: `000041_consolidate_senju_features.ts`, `000042_entity_type_and_flags.ts`