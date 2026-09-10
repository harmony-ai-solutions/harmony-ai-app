# 02 — Follow-Up Plan: Stubs, Engine Parity & Streamlining

> Post-rebase work, organized in five tracks. Binding design directives from the senior dev are marked **[directive]**. Open questions for discussion are marked **[Q]**. Nothing here is implemented yet.

> **Close-out notes (post-Phase-4 mends, commits E/F/G on `senju-design-updates-rebase`):**
> - **CLIENT_ONLY_TABLES** — now ruled interim-only (D6); deleted in B5. See B5 below.
> - **Rebase-artifact tsc/test failures** — fixed in commit E (`53b445e`): `Animated`/`ToastAndroid` imports, test-harness provider mocks (ThemeContext/AppToastContext/AuthContext/safe-area/blockedContent/navigation), `flush()` drain, `EntitySessionService` registry mocks. All 84 unit suites green.
> - **Pre-existing tsc errors** on `feat/cloud-lifecycle` (syncApplyFailureClearsSession private access, deviceAuth `MockAPIError` type) — fixed in commit G (`fe1408f`). Note: `feat/cloud-lifecycle` itself still carries them; `senju-design-updates-rebase` supersedes it.
> - **Parity** is back to exactly D3 (conversation_messages) + known-pre-existing drift; the 5 client-only index leaks are closed (commit F). D3 stays open until Track B1 lands the engine-side Go migration.

---

## Track A — Backend-Stub Layer (marketplace, wallet, social, notifications)

**Architecture [per D5 discussion + 03-Pattern-Cheat-Sheet]:** per domain `X` under `src/services/<x>/`:
1. `XService.ts` — app-facing typed API, app-local error types, the **only** import for UI.
2. `XStubBackend.ts` — in-memory fixture store, ~300ms artificial latency, realistic statuses.
3. **Visibility [O5 ruling]: stubs ship in ALL builds — fixtures visible everywhere, no env/visibility gating.** The service-interface seam (`XService` ↔ `XStubBackend`) remains the *only* swap point for the future backend; a config flag may later select the real implementation, but every build shows the stub until the backend concept lands.

**Derived patterns (already in repo):** `soulbitsModelsCatalog.ts` (cache + single-flight + never-throw fallback), `CloudSessionService.ts` (EventEmitter status singleton), `DeviceAuthService.ts` (app-local error mapping), `deviceDeepLink.ts` (pure parser + tests).

### A1 Marketplace
- Keep all screens/components verbatim (`MarketScreen`, `MarketplaceItemDetailScreen`, `MarketplacePublishScreen`, `MyListingsScreen`, `MyLibraryScreen`, `ContentAssetScreen`, `src/components/market/*` except dead `MarketListingCard`).
- Replace state layer: stub catalog service (fixtures in `src/constants/`), cache+fallback per `soulbitsModelsCatalog`.
- **Wire-shape pre-matching [directive]:** stub types must match the shapes `@harmony-ai-solutions/soulbits-api-client` already anticipates (`subscription` sub-API, `APIError.isQuotaError`, `soulCreditsAvailable`, `currentTier`, `upgradeUrl`) so the real backend swap is one-file.
- Remove in stub mode: `MarketplaceApiService` **DELETED [O7 ruling]** — the backend concept designs the real client (expected: first-party client pattern); git history preserves the old code. Fake-success fallbacks in publish/delist become honest stub errors; `librarySync`'s broken cleanup keyed to the stub store instead.
- **Publishing model [A4 ruling]:** publishing a character to the marketplace = **upload a copy of the card contents to the marketplace backend** (designed in `20-Backend-Concept`). No local `'marketplace'` visibility state, no local listing rows — the local character and its card stay untouched. Stub phase: publish targets the stub backend.
- **Table policy [directive, proof-read round]: DROP ALL marketplace SQLite tables — including the cache tables (`marketplace_listings_cache`, `marketplace_ownership_cache`, `content_library`) — unless explicitly approved to keep.** Stub state is **in-memory only**. Offline caching is revisited with the backend concept (`20-Backend-Concept`). Every data-model-related path/outcome (repos, services, screens' data flows) gets a stub replacement or removal so no orphaned DB access remains.

### A2 Soul wallet / payments
- Stub `WalletService`: EventEmitter (`idle|syncing|ready|failed`), fixed seeded balance, typed `InsufficientCreditsError`.
- **Remove:** `soul_wallet`, `soul_purchases`, signup-bonus schema + `claimSignupBonus` call in `AuthContext` (per-install mint), dead `confirmPurchaseIfNeeded`.
- **Remove `isChatLocked` gates** from `CharacterChatService`, `ChatDetailScreen`, `ChatListScreen`, `DiscoverScreen`, `AIProfileScreen` (client-side paywall = security theater, 00-Research §4.2 B2). Keep price-pill/lock **icons** as pure UI.
- "Buy/Sell Souls" dropdown already says "Coming soon" — keep as the honest placeholder.

### A3 Social & notifications
- Stub `SocialService` (profiles/follows/posts via fixtures) + `NotificationService` (in-memory list + `EventEmitter<'unread'>`).
- Drop the 9 social tables (000041/000042/000047 equivalents in renumbered block — see Track B migration mechanics for how to remove renumbered migrations cleanly).
- Notifications: model `registerPushToken(token)` in the interface now (engine's `device_push_tokens` + `DeviceAuthService.registerDevice` pushToken param already anticipate it); deep-link parsing per `deviceDeepLink.ts` pattern.

### A4 User profile
- **[directive] Cloud-first:** drop `UserProfileStore` AsyncStorage shadow store; `GET /v1/auth/me` is the read path; optional later: read-through cache with **cloud-wins** precedence.
- **Backend reality check (2026-08-24, cross-verified):** `PATCH /v1/auth/me` **already exists** in soulbits-cloud-backend (`cmd/auth-service/main.go` route → `handlers/me.go UpdateProfile`) but accepts **`display_name` only**, and GET returns `id/email/display_name/email_verified/created_at` (no username/bio/avatar). The backend concept (new doc: `20-Backend-Concept-Marketplace-Profile.md` — **proposed deliverable**) is therefore an **extension** of the existing PATCH (add `username`/`bio`, avatar upload endpoint + `avatar_url` in responses) — not a new-endpoint design.

### A5 Tests
Per 03 §8: unit tests next to services (mock backend module like `deviceAuth.test.ts`), no new integration harness needs.

---

## Track B — Engine-Parity & Streamlining (closes the D3 parity red; unifies app+engine product)

### B1 Message-layer parity → engine
- Go migration mirroring renumbered-46 (`conversation_messages` += `reactions_json`, `is_pinned`) + engine ingestion/persistence + (if applicable) event propagation. **[O4 ruling]** `reply_to_message_id` is **dropped** (reply feature removed deliberately): strip the column from the pre-release renumbered-46 migration, remove the `sendTextMessage` `replyToMessageId` param and the `ChatBubble` `repliedMessage` reply-header remnants app-side.
- **Message read-state [directive, proof-read round]:** add read flag/timestamp to `conversation_messages` (base model has none today — verified). Unread badges/dividers become derived counts; replaces ALL THREE of her parallel unread systems (DB `unread_count`, two AsyncStorage last-read key families — see `04-Preference-Alignment-Inventory.md`). Read-by-AI concept = engine-side, shape **[Q]**.
- Register columns in sync normalization (already half-done: `is_pinned` boolean map exists on her side).
- **End state: parity gate green again** — the only accepted D3 divergence disappears.

### B2 User preferences → synced tables **[directive: unified product]**
Tables: `character_favorites`, `chat_conversation_settings`, `character_profile_sources` (visibility). `character_categories` is replaced by tags-derivation (below).
- Go mirror migrations + app watermark-contract columns (`deleted_at` missing on her tables → real migration design), `SyncService` table-list registration + apply-order entries.
- **`unread_count` [superseded by directive]:** column DROPPED — unread is derived from message read-flags (B1); no per-device stored counter. Full inventory & per-field dispositions: `04-Preference-Alignment-Inventory.md`.
- **Participant-key alignment [O3 ruling]:** the own entity is part of the interaction's participant key **everywhere, matching the engine** — per-persona conversation identity is the intended semantics (settings/unread per persona for pairs AND groups alike). Fix her app-side pair-key derivation + the false docstring to match engine `deriveParticipantKey` exactly; no drift tolerated between app and engine keying.
- **Reply-mode toggle [A6 ruling]:** the `instant`/`realistic` preference returns — UI lives in the **conversation settings menu** (not the immediate chat UI/header). Storage becomes a `chat_conversation_settings` column (synced) with the B2 table redesign; AsyncStorage keyed by participant key as the Phase-1 interim. (Distinct from the reply-to-message feature, which is dropped [O4].)
- **Engine-relevant prefs (contract items):** `muted` (engine suppresses notifications/proactivity), `disabled` (engine stops proactive/lifecycle automations for that AI — note: user entities are excluded from those automations anyway per the persona model). **[O10 ruling]** app-side: muted conversations suppress unread-badge increments.
- **Categories [O6 ruling — lightweight model]:** custom categories live in **AsyncStorage** (transient user-side groupings, no DB tables); assigning a category to a character **writes a native tag on the profile** (synced via `character_profiles.tags`). Filtering derives from profile tags ∪ the AsyncStorage category list. Her `character_categories` + `character_category_members` tables are **dropped** (B5 pass).

### B3 Persona redesign **[directives P1/P2 + two-path model]**

**Target model:**
1. Chat from character card / create AI partner ⇒ **AI Entity** (`entity_type = 'ai'`), linked character profile injected into prompts by the engine (existing mechanism).
2. Persona from scratch **or from character card** ⇒ **User Entity** (`entity_type = 'user'`); persona-from-card **copies** the profile at creation (P1 — reuse her fork machinery: `duplicateProfileId` + `getNextEntityAliasCopy`), so the user's identity never shifts under them when the source card is edited.
3. Personas become a **logical concept** (P2): the `personas` table is **dropped**; "is a persona" = `entity_type = 'user'`; the "chat as XY" preference stays in AsyncStorage (`ChatPreferencesService` pattern, as before for the user-entity selection — "this time it's just more precise").
4. **Default persona = the engine-seeded `user` entity**, materialized and editable; stored `'user'` prefs keep working (literal id preserved).
5. Engine lifecycle/emotion/proactivity automations **process AI entities only**; user entities are excluded (engine side confirms/implements).

**Work items:**
- `entities.entity_type` enum column: Go + RN migrations (parity!), backfill (`'ai'` where `character_profile_id` set… careful with her dev-device persona shim rows — see migration mechanics), values/default naming **[Q P3, deferred]**.
  - *"Dev-device persona shim rows" explained:* her `createPersona` writes a minimal `entities` row per persona (`alias=name`, `character_profile_id NULL`, `lifecycle_config '{}'`, `rag_reindex_required 1`) — the "shim" that lets the engine accept the persona as an interaction actor. These rows exist only on dev installs that ran her branch. During the enum backfill they must be classified `'user'` (they *are* user entities in the target model) — that's the whole data-migration path for old personas.
- Replace her **profile-null inference logic** (i.e., every place that *infers* "is a persona" from `character_profile_id IS NULL` instead of an explicit flag — the persona repo JOINs, `resolvePersonaId`, the leaked-row cleanup migration; nothing to do with AI inference): persona JOINs → enum filters; `PersonaSwitcherModal` lists user entities; `resolvePersonaId` → resolve against user entities; `MyProfileScreen` persona list; character-cards UI gets "Create persona from this card" (copy flow).
- Identity now reaches the engine through the profile link (existing injection path) — **[Q] engine contract:** confirm prompt injection is symmetric for user entities (user persona description enters the prompt the same way an AI partner's does) and that `rag_reindex_required` semantics are correct for user entities.
- Data migration for existing `personas` rows (dev devices only — her branch never shipped): convert each persona → user entity + (optionally) minimal copied profile; her renumbered-44 leaked-row cleanup becomes moot. **[Q] skip-vs-convert.**
- `PersonaEditScreen` becomes "edit user entity + its profile copy" (reuses profile editing).
- Moot items: alias-collision guard (subsumed by entity-alias handling — verify copy flow dedupes), her `000038` cleanup.

### B4 `f45540a` seeding revert **[directive]**
- Revert `ensureSoulbitsDefaultConfigs` auto-fill + save-time call.
- Restore the "Disabled" option in `EntityModuleSelector` (unset slot = no module).
- If "always show a default" UX is kept: **auto-select the engine's synced `"Default SoulbitsCloud"` row** instead of creating parallel rows (name-clash machinery already dedupes engine-seeded defaults cross-device).
- Rationale record: 00-Research §8 (engine seeds defaults; her service = wrong-direction reimplementation, duplicate rows, LWW churn, broken standalone mode).

### B5 Migration mechanics for Track A/B removals **[APPROVED — senior dev, proof-read round: no clarification needed]**
Her migrations (renumbered 41–55) have never shipped beyond dev devices → cleanest: **fold removals into the renumbered files themselves before merge to a shared mainline** (edit pre-release migrations rather than adding inverse migrations). Decide per item: drop table from migration file + drop repo + drop tests. Timing: do removals in one dedicated pass immediately after rebase verification, before anything merges to main.

**B5 also removes `CLIENT_ONLY_TABLES` (decision D6, summary.md).** The mechanism dies with the last sidecar table drop: as each table leaves the exclusion list, delete its entry; when the set is empty, delete the `isClientOnlyEntry` filter + the D6 comment in `scripts/dump-schema.ts` entirely. End state: the parity dump has **no exclusion list** — "app-only SQLite table" is not an allowed category in this architecture. Until then the mechanism stays functional (index-leak fix landed as commit F).

---

## Track C — Editor Consolidation & UI Refactor (D4 step 2)

1. **Port the V3/RP editor suite into her `CreateAI` edit mode** (her form exposes none of the V3 fields today, but the data model is unchanged and her `{...current}` spread preserves V3 columns — clean additive port; 00-Research §7): GreetingEditor (+test-scenario generator), AlternateGreetingsManager, Lorebook (viewer+editor), TagChips, LifecycleConfigEditor, attribution, JSON/PNG export, MacroHighlighter.
2. **UI refactor while porting [directive]:** the senior editor screen is bloated — split into section components (editor-sections/ dir) reused by CreateAI; delete the comparison-only `CharacterProfileEditScreen` afterward.
3. **Restore small lost capabilities:** full-screen zoom viewer (ImageViewerModal), per-image "Set as primary", image captions, pull-to-refresh; numeric validation alerts instead of silent clamping.
4. **Fix image churn:** her save hard-deletes + recreates all image rows on every save → switch to diff-based reconcile (keep ids stable; engine-synced rows shouldn't churn).
5. Route cleanup: remove `CharacterProfileEdit` route + Q-D4a scaffolding once ported.

---

## Track D — Bug Mends (from 00-Research §10 register + ChatListScreen audit; small, cherry-pickable)

**Blanket rule [directive, proof-read round]: every data-model-related path/outcome must be stubbed or removed — no orphaned DB access; all marketplace/social SQLite tables dropped unless explicitly approved (see Track A).**

### D1 Register (original)

| Item | Fix |
|---|---|
| `MarketplaceItemDetailScreen.doAcquire` | move `setOwned(true)` out of `finally` into success path only (or track stub outcome) |
| `MyListingsScreen` / `MarketplacePublishScreen` | fake-success fallbacks removed in Track A stub swap |
| `ChatInputBar` 120s auto-stop | keep the recording (finish + attach) instead of discarding; or stop+save |
| `ChatBubbleService.ts` dead `result === false` | make `ChatBubbleModule.show()` return a real boolean (canDrawOverlays + try/catch) or drop the check |
| Background cloud WS | decide policy with device-auth/purge semantics (20c985a removed background disconnect); guard interaction with `isPurging()` suppression |
| `clearMarketplaceCache` on logout | moot if cache tables are dropped (Track A) — otherwise call in `AuthContext.logout` |
| `cd821db` | restore 3rd "connecting…" indicator state |
| `98d0ec9` | first-message day divider (`i === 0`) |
| Reply feature | **[O4 ruled: removed deliberately]** drop entirely — remove `reply_to_message_id` from renumbered-46 (B1), strip `sendTextMessage` reply param + `ChatBubble` `repliedMessage` header. |
| `chat_reply_mode_*` pref | **[A6 ruled: feature returns]** toggle UI moves into the **conversation settings menu**; re-key by participant key (AsyncStorage interim), becomes synced `chat_conversation_settings` column in B2. (Distinct from the dropped reply-to-message feature.) |
| Legacy persona prefs (P4) | silent fallback → optional "create persona from that card" offer **[Q, deferred]** |
| `getCharacterStats` interactions full-scan | index or aggregate query |

### D2 Register (NEW — ChatListScreen audit, was untracked)

| # | Sev | Finding | Fix direction |
|---|---|---|---|
| F1 | HIGH | **No live reload while list is focused** — no `message:received` subscription; badge/preview/order stale until refocus | subscribe to EntitySessionService events in ChatListScreen |
| F2 | MED | In-chat divider vs list badge disagree (badge resets on open, divider's AsyncStorage last-read never seeded → first open shows "all new") | superseded by read-flags alignment (04 §2) |
| F3 | MED | Deleting a conversation leaves `chat_conversation_settings` orphaned → resurrected conversation returns pinned/muted with stale badge | cascade-delete settings row in `deleteConversationByParticipantKey` |
| F4 | MED | Group `participant_key` embeds `ownEntityId` → settings/unread per persona for groups (docstring claims the opposite) | **[O3 ruled]** engine-aligned keys: own entity in the key everywhere; per-persona semantics intended — fix derivation + docstring |
| F5 | MED | **Blocked Users feature never filters the chat list** (no `blockedContent` references) — blocked users still appear and open | wire filter in list query or accept as stub-gap until cloud moderation (Track A) |
| F6 | MED | Recency window (`interactions.last_activity_at` LIMIT 50) vs sort (last message `created_at`) mismatch; conversations beyond top-50 silently vanish | **[O11 ruled]** unify on last-message `created_at`; replace hard LIMIT-50 with proper pagination |
| F7 | LOW | Fresh-focus double load + brief 'user'-perspective flash before persona loads | await persona before first load |
| F8 | LOW | Bubble unread badge only syncs on list reload | push updates via same event subscription as F1 |
| F9 | LOW | Locked (paywall) conversations keep an unread badge they can never clear (gate returns before clear) | moot after paywall removal (Track A) |
| F10 | LOW | "Mark unread" adds +1 per press (inflates); also writes dead key-last-read | set-to-1 semantics; drop dead writes |
| F11 | INFO | Muted conversations still badge (increment ignores mute) | **[O10 ruled]** muted ⇒ suppress badge increments (conversation stays visible) |
| F12 | INFO | `ArchivedChatsScreen` bubble hardcodes `ownEntityId:'user'` vs live persona in ChatList | pass live persona |
| — | LOW | Dead subsystem: `getKeyLastRead`/`setKeyLastRead`/`markKeyAsRead`/`clearKeyLastRead` write-only (zero readers) | remove with 04 alignment |
| — | LOW | Unused imports (`hasBubblePermission`, `listConversationsByFlag`), dead styles (`timeBadge`), never-rendered `_loading` state | cleanup pass |

---

## Track E — INIT_ENTITY Recovery (executable spec preserved)

The skipped test `src/services/__tests__/entitySessionInitRecovery.test.ts.skip` (D2) is a complete spec. Implement in `EntitySessionService`:

1. `handleInitEntityResponse` ERROR branch: on ingestion-class errors (`entity_not_defined`) **do not tear down** the session.
2. Recovery (fire-and-forget): best-effort **blocking re-sync** (`syncAndWait`) → create fresh entity connection → re-send `INIT_ENTITY`.
3. Bounded by `MAX_INIT_ENTITY_RETRIES = 2` via `session.initRetryCount`; after cap (or on non-ingestion errors) → `session:error` + normal teardown.
4. Transport-error-storm guard: `handleEntityConnectionError` must defer to the event-path recovery when the error carries an app-level event (`error.event.event_type === 'INIT_ENTITY'`); genuine transport errors remain fatal.
5. Re-enable the test by renaming back; it asserts all of the above including the retry-cap and non-ingestion pass-through cases.

Context (from the test's own doc): CreateAIScreen syncs new entities fire-and-forget; opening chat before engine ingestion → engine rejects INIT_ENTITY → old code tore down instantly and context-level retries re-sent **without syncing**, failing identically forever ("Session initialization failed" on fresh partners).

---

## Sequencing **[directive, proof-read round: ENGINE SIDE LAST]**

App-side stubbing and data-model changes must be **final** before any engine-side work starts; the engine track gets its own careful planning round after the rebase is done.

**Phase 1 — App-side only (no engine work):**
1. B5 removal pass (drop marketplace/social tables, stub data models final) + A2 wallet/paywall removal + A1/A3/A4 stub core — smallest safe state: no fake economy, honest stubs.
2. D mends (cherry-pickable; F2/F9 subsumed by 04 alignment + paywall removal).
3. E recovery — app-side only, unblocks fresh-partner chat reliability.
4. C editor consolidation — V3 port + UI refactor (app-side).
5. B4 `f45540a` seeding revert (app-side).
6. App-side prep for Track B where safe (e.g. 04 §4 steps 1–2 could ship app-side only if read flags land with their engine counterpart — otherwise defer to Phase 2).

**Phase 2 — Engine track (LAST; dedicated planning round after rebase + Phase 1, informed by final app data models):**
7. B1 message-layer parity (actions + read-flags) — closes D3 parity red.
8. B3 persona redesign (`entity_type` enum + engine contract: user-entity injection, lifecycle/emotion exclusion, default persona seeding confirmation).
9. B2 preferences sync + tags→categories + engine-side `muted`/`disabled` behavior.
10. Engine-side ChatListScreen consequences of Phase-1 changes (event subscriptions for F1/F8 could be app-side, but anything touching engine events lands here if contract changes are needed).

**Proposed additional deliverables (docs in this dir):** `20-Backend-Concept-Marketplace-Profile.md` (real backend design: marketplace service, wallet ledger, `PATCH /v1/auth/me`, avatar upload, social/notifications), `21-Engine-Contract-Persona-Enums.md` (P3 answers, user-entity injection semantics, lifecycle/emotion exclusion confirmation, read-flag shape, muted/disabled engine behavior) — the latter is the planning artifact for Phase 2.
