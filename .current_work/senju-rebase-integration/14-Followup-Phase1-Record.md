# 14 — Followup Phase 1 Record (app-side)

> D5-convention execution record for the app-side follow-up phase (`.current_work/senju-followup-phase1/`, phase docs 1–9).
> Companion to the running logbook `13-Phase-1-Logbook.md` (the primary per-phase source — this record condenses it)
> and to the execution records `10`/`11`/`12` of the preceding rebase integration. Branch: `senju-design-updates-rebase`.
> **Sibling repos untouched this phase:** `harmony-link-private` was only *read* (schema dump for parity verification,
> wire-shape cross-checks); no engine-side changes were made. Engine work is Phase 2 (own planning round, see §Phase-2 outline).

## Status

| Phase | State | Commit(s) |
|---|---|---|
| 1 — Stub service layer | ✅ committed | `1455b6e` |
| 2 — Marketplace & wallet rewiring | ✅ committed | `82143b7` |
| 3 — Social/notifications/profile rewiring | ✅ committed | `20d70c9` |
| 4 — Schema surgery | ✅ committed | `a0992be` |
| 5 — B4 seeding revert | ✅ committed | `29871ab` |
| 6 — D-register bug mends | ✅ committed | `ba97e9a` + `4fc4ab0` + `77518e5` + `40553b3` |
| 7 — INIT_ENTITY recovery | ✅ committed | `ec0aaca` |
| 8 — Editor consolidation | ✅ committed | `ca48bd5` + `3310dde` + `7352034` |
| 9 — Verification, records & docs | ✅ committed | `ab0c635` |
| R — Review corrections (post-phase) | ✅ committed | `755c117` |

Docs commits that landed during the phase: `3839fcc` (phase-6 logbook record), `18fb1a5` (phase-8 logbook record), `ab0c635` (record/outlines/CHANGELOG/memory bank).
The logbook (`13-Phase-1-Logbook.md`) was kept up to date per phase; this record, `20-Backend-Concept-Marketplace-Profile.md`,
the CHANGELOG wave, the memory-bank entries and the summary.md tick are Phase 9's own output.

---

## Per-phase what changed & why

### Phase 1 — Stub service layer (A1/A2/A3 core) — `1455b6e`
New-files-only by design: a first-party, in-memory **stub backend** behind service seams whose types pre-match the
future backend, so screens stay verbatim and only the data layer swaps.
- `src/services/stub/StubServiceError.ts` — app-local error base that pre-matches the client `APIError` observable
  surface (`status`, `code`, `upgradeUrl`, `currentTier`, `requiredTier`, `soulCreditsAvailable`, `taskId`;
  getters `isAuthError`/`isQuotaError`/`isRateLimited`/`isServerError`) + domain subclasses
  (`MarketplaceError`, `WalletError`, `SocialError`, `NotificationError`, `InsufficientCreditsError` → 402
  `quota_exceeded` with remaining balance; placeholder `upgradeUrl = https://harmony.ai/souls`).
- `stubBackendUtils.ts` — `simulateLatency()` (~300 ms ±100 ms) + seeded FNV-1a `simulateTransientFailure()`.
- `MarketplaceService.ts` + `marketplaceStubBackend.ts` + `marketplaceFixtures.ts` — listings/search/acquire/
  publish/delist/my-listings/library/content-asset/refresh; publish = upload-copy (A4); `acquire` debits the wallet
  and throws `InsufficientCreditsError` when short; honest 503 on seeded transient failures.
- `WalletService.ts` + `walletStubBackend.ts` — singleton EventEmitter, status `idle|syncing|ready|failed`,
  seeded 50 souls, no persistence; `SubscriptionStatus {tier, soulCreditsAvailable, currentTier?, upgradeUrl?}`.
- `SocialService.ts` + `socialStubBackend.ts` + `socialFixtures.ts` — profiles/follows, posts + comments,
  character social, image social, block list, creators.
- `NotificationService.ts` — read-only fixture feed with `EventEmitter<'unread'>`, list/markRead/markAllRead,
  `registerPushToken()` async no-op (interface-only, anticipates engine `device_push_tokens`).
- `utils/blockedContentFilters.ts` — PURE filters (no DB): `filterBlockedCharacterProfiles`,
  `filterBlockedUserPosts`, `filterBlockedUserNotifications`.
- 4 test suites (Marketplace/Wallet/Social/Notification) — all mock `stubBackendUtils` + logger, `__resetForTests()`.

### Phase 2 — Marketplace & wallet rewiring + paywall removal (A1/A2) — `82143b7`
Rewired every marketplace/wallet consumer onto the stubs and **removed the client-side paywall**:
- Deleted `MarketplaceApiService`, `MarketplacePurchaseService` (folded into `MarketplaceService.acquire` —
  approved default #3), `acquireItem`/`itemSnapshots`/`librarySync`/`marketplaceTypes`, dead `MarketListingCard`.
- `CharacterChatService.openCharacterChat` dropped `currentUserId` + the silent-return lock gate; 3 call sites +
  the extra consumers `ChatDetailScreen` and `CreateAIScreen` (both found by the zero-hit gate, not in the doc)
  cleaned. `MarketScreen` balance badge now reads the wallet stub; empty-state branch removed.
- **Acquire is honest**: owned state flips ONLY on `acquire()` success (fixes the old `finally` fake-success by
  construction); insufficient balance surfaces "Not enough Souls — buying Souls is coming soon".
- **Publish = upload-copy (A4)**: character-card publishing only; text/theme publish, listing edit, re-list and
  library-remove are honest "not available in preview" errors — the stub API was deliberately NOT extended with
  fake success.
- Signup-bonus flow removed (`registerAction` no longer calls `claimSignupBonus`).

### Phase 3 — Social, notifications & profile rewiring (A3/A4) — `20d70c9`
- **Profile is cloud-first**: `UserProfileStore` (AsyncStorage shadow) deleted; display name now saves via the
  existing authenticated fetch path to `PATCH /v1/auth/me` (`AuthService.updateDisplayName` — backend-verified
  2026-08-24, display_name only) + `AuthContext.refreshUser()` so saves propagate to `useAuth().user`.
  Username/bio/avatar inputs are disabled with "coming soon" hints (honest stub).
- All social consumers (posts, comments, likes, saves, follows, blocks, creators) rewired to `SocialService` +
  pure blocked filters; notification badge = `notificationService.getUnreadCount()` + subscription, auth-independent.
- **Notification creation removed**: the stub feed is read-only; old `addNotification` call sites deleted
  (backend must own notification writes in Phase 2).

### Phase 4 — Schema surgery (B5 consolidation + O4 reply strip + O6 categories off tables) — `a0992be`
- **Consolidation amendment (user-approved):** the 15 migrations `000041_add_character_profile_source` …
  `000055_add_marketplace_cache` collapse into a SINGLE `000041_consolidate_senju_features.ts` containing only the
  surviving SQL — personas, character_favorites, chat_conversation_settings (physical `blocked` column kept),
  conversation_messages `reactions_json`/`is_pinned`/pinned index. Header documents the rationale, the `000039`
  reserved placeholder, and the dev-DB-wipe note.
- Deleted 26 files: 15 migrations + 6 sidecar repos (marketplace, soulWallet, characterSocial, userSocial,
  contentLibrary, blockedContent) + 5 repo test suites + the O4 reply feature (`reply_to_message_id` param/payload
  through `EntitySessionService`, repo INSERT/SELECT/UPDATE, `models.ts`, `ChatDetailScreen`, `ChatBubble`).
- `characters.ts`: source/visibility + category fns deleted; favorites, `getUserCharacterProfiles`,
  `getSiblingCharacterProfiles`, `getCharacterStats` kept.
- `scripts/dump-schema.ts`: `CLIENT_ONLY_TABLES` 23 → **3** (`personas`, `character_favorites`,
  `chat_conversation_settings`); schema dump + migration snapshots regenerated.
- **O6 categories off tables**: new `CategoryPreferencesService` (AsyncStorage `@harmony_character_categories`)
  with rename/delete rewrite of the tag on affected profiles; "Add to category" writes the category name as a
  native `character_profiles.tags` entry (syncs to engine). UI on CharactersScreen + the category modals.
- `CreateAIScreen` "Visibility & Sharing" UI removed (its persistence table is gone); `AIProfileScreen` ownership
  resolves from cloud creator only; import-flow source-tagging writes removed.

### Phase 5 — B4 seeding revert (engine = single default-config source) — `29871ab`
- Deleted `SoulbitsDefaultConfigService` (319 lines of parallel default-config creation in engine-synced tables —
  duplicate rows, LWW churn, broken standalone mode) + all CreateAIScreen auto-fill machinery.
- **`EntityModuleSelector` "Disabled" option restored** (`{id:-1, name:'Disabled', value:''}` first sheet row,
  label fallback `?? 'Disabled'`); unset slots save as unset (`'' → null`, aligning create with edit).
- Decision: NO auto-select of engine-synced default rows; engine-synced defaults still appear in the picker when
  connected. Constants check: `moduleDefaults.ts`/`moduleConfiguration.ts` reference the engine provider
  `'Soulbits Cloud'`/`soulbitscloud` — NOT the deleted service's row name — so nothing else to change.

### Phase 6 — D-register bug mends (4 commits) — `ba97e9a` + `4fc4ab0` + `77518e5` + `40553b3`
- **Batch A (ChatList cluster, F1/F3/F5/F6/F7/F8/F10/F11/F12):** focus-scoped `message:received` subscription with
  incremental row update + re-sort; 400 ms debounced reload on `session:started|stopped`; `deleteConversationByParticipantKey`
  cascades settings rows; list filters via `SocialService.getBlockedUserIds()`; new paginated
  `getPhoneConversationsPage(entityId, {limit, offset})` (GROUP BY participant_key, 20/page — also fixes duplicate
  group entries); persona resolution awaited before first load; bubble unread badge pushed through the subscription;
  set-to-1 unread semantics; muted guard skips unread increments; Archived bubble uses live persona; dead
  `getKeyLastRead`-family subsystem deleted.
- **Batch B (F4/O3 D1-3 D1-4):** F4 verdict **NO drift** — app participant-key derivation matches the engine
  exactly (evidence table in the logbook); fixed the false docstring in `interactions.ts`; contract pinned by
  `interactionsParticipantKey.test.ts` (12 cases). **D1-3**: 120 s auto-stop now FINISHES the recording
  (root cause = abort-flag-before-finish + stale-closure interval; pure `nextRecordingTick` + 5 tests). **D1-4**:
  `ChatBubbleModule.show()` Kotlin → Promise-based boolean (canDrawOverlays → false; try/catch → true/false);
  Promise over sync-boolean because `newArchEnabled=true` forbids sync native returns. **Kotlin compile rides the
  user's next device build.**
- **Batch C (A6 D1-5 D1-7 D1-8 D1-12):** reply-mode toggle in `ChatConversationMenuModal` (AsyncStorage via
  `ChatPreferencesService`, paced via `INIT_ENTITY.payload.reply_mode`; `InteractionSession.replyMode` added so
  partner **reconnect** honors it); background handler early-returns while `cloudSessionService.isPurging()`;
  3-state connection indicator (connected purple / connecting amber pulsing / offline grey); first message gets a
  day divider; `getCharacterStats` chats count via aggregate SQL with JS-scan fallback.

### Phase 7 — Track E: INIT_ENTITY ingestion-error recovery — `ec0aaca`
- `handleInitEntityResponse` ERROR branch: ingestion-class error (`entity_not_defined`, named const) → no teardown,
  bounded retries (`MAX_INIT_ENTITY_RETRIES = 2`), fire-and-forget recovery via new `recoverInitEntity`
  (purge guard → `SyncService.syncAndWait()` → fresh entity WS connection → re-send INIT_ENTITY honoring
  `replyMode`); cap reached → shared `failInteractionSession` teardown. Non-ingestion errors keep old behavior.
- New `handleEntityConnectionError` wired to ConnectionManager `error:entity`: INIT_ENTITY-class errors defer to the
  event-path recovery; genuine transport errors stay fatal. Dedup verified (`started` flag + register-before-send).
- **Re-enabled `entitySessionInitRecovery.test.ts`** (was `.skip` since the rebase D2 ruling) — 4/4 green UNMODIFIED.

### Phase 8 — Track C: editor consolidation (3 commits) — `ca48bd5` + `3310dde` + `7352034`
- New `src/components/character-card/editor-sections/`: pure `editorState.ts` (snake↔camel V3 mapping, shared with
  the round-trip test so they can't drift), `imageReconcile.ts` (diff-based image deltas), and section components
  (Greeting incl. test-scenario generator bar, Alternate Greetings, Lorebook, Tags, Lifecycle, Attribution, Export)
  + `ImportReviewSheet` moved here (Characters import flow depends on it).
- CreateAI **edit mode** loads the full V3/RP state (`loadEditProfile`); save validates instead of silent-clamping;
  hidden `group_only_greetings`/`extensions`/`assets` carried so the spread can't wipe them.
- **Image churn fixed**: `computeImageDeltas` applies only create/update/remove deltas via the existing repo fns —
  untouched ids stay stable. Layout General → Details → Greeting/Alternate/Lorebook/Images/Tags/Lifecycle/
  Attribution/Export → Advanced; create mode keeps a lightweight subset.
- Deleted `CharacterProfileEditScreen.tsx` + its old suite + route/`// D4: comparison-only` scaffolding.
  **`EntityConfigEdit` finding**: zero references anywhere — the screen did not survive the rebase; nothing to
  drop/TODO. Q-D4a fully closed. Stale `e2e/.maestro/03-conflict-resolution.yaml` flagged (broken pre-Phase-8,
  outside jest gates, needs on-device e2e rework) — intentionally NOT fixed.

### Review phase — post-Phase-1 corrections (user rulings) — `755c117`
The user's diff review (baseline `59739e0`) found UI removed beyond "screens stay verbatim"; rulings restored it on
extended stubs. **Full detail: `senju-followup-phase1/10-ReviewCorrections.md`**; superseded markers below refer
to this section.
- **Stub extensions**: `updateListing`/`relistListing`/`removeLibraryEntry`; draft `kind` (`character_card|text|theme`)
  + `text`/`previewText`/`sourceProfileId`; summary `salesCount`; detail preview fields + `kind`; `AcquireResult`
  deep-link ids; NEW `ProfileExtrasService` (username/bio/avatar, AsyncStorage `@harmony_profile/<userId>`).
- **Restored UI**: marketplace detail preview region + salesCount (+4 tests); full publish wizard incl. text/theme
  (from character field or scratch) + edit mode + re-list + library-remove (fixed latent unreachable theme step);
  marketplace PREVIEW chat locks (ruling: viewable free, chat locked until acquired, own library never locked) via
  `getListingForProfile`/`isChatLocked` + central `openCharacterChat` gate + AIProfile price pill/lock + ChatDetail
  defense-in-depth; EditProfile username/bio/avatar + MyProfile header extras.
- **New component**: `VisibilitySettingsSection` (private/public/marketplace + SOUL price) — publish screen; noted
  in 20-Backend-Concept §1. Post-acquire AIProfile navigation preserved as commented `TODO(backend)`.
- **Bugs found during verification**: (1) import failure `no such column: first_mes` = stale dev DB predating
  migration 000037 (standing question #2 CONFIRMED on-device; user wiped). (2) `ChatBubbleService` FGS crash
  (`ForegroundServiceDidNotStartInTimeException` from closeWindow/hideOne/setUnreadCount command deliveries) —
  `onStartCommand` now calls `startForegroundCompat()` unconditionally + `maybeStopWhenEmpty()`; compile-verified;
  **on-device verification rides the next device build (with D1-4 Kotlin)**.
- **Gates**: tsc 0 errors; unit 98 suites / 873 tests; integration 10 / 50 + 1 skipped.

---

## Deviations from the phase docs (with reasoning)

1. **Extra paywall consumers** `ChatDetailScreen` + `CreateAIScreen` (Phase 2) — the doc's consumer list was
   incomplete; both were found by the zero-hit gate and cleaned per the A4 ruling. `MarketScreen` had no
   `handleChat` to strip (doc assumed one).
2. **Stub API deliberately NOT extended** (Phase 2): text/theme publish, listing edit, re-list, library-remove =
   honest errors, not fake success (honest-stub rule). *(SUPERSEDED by review phase — all four now work via the
   extended stub, per the user ruling.)*
3. **`salesCount`** dropped from the detail screen (not in stub types); optional in the manage row. **Apply-to-
   character** maps asset text to `description` (no itemType→field mapping in stub `ContentAsset`). **Acquire
   success → navigate My Library** (stub `AcquireResult` carries no profile link). *(salesCount SUPERSEDED by
   review phase — restored via the summary wire. Apply-to-character still open; acquire→AIProfile deep link
   preserved as commented TODO code.)*
4. **Gate-1 literal zero-hit deferred to Phase 4** — `claimSignupBonus`/`canChatWithCharacter` were still defined
   inside the doomed repos + their tests (zero non-test importers); the literal zero lands when the repos are
   deleted.
5. **`UserProfileStore` port was a no-op** (Phase 3): no tests existed for it or My/EditProfile screens
   (grep-verified).
6. **`getPosts` returns `Promise<StubPost[]>`** (Phase 1 doc typo said singular); **`publishListing` status
   `'pending'`** (moderation semantics; pending excluded from public feed); all error classes in one file (avoids
   import cycles); `upgradeUrl` placeholder `https://harmony.ai/souls` (backend owns the real URL);
   `NotificationService` under `src/services/social/` (doc allowed either).
7. **`getUserCharacterProfiles` adapted, not kept verbatim** (Phase 4) — its SQL JOINed `character_profile_sources`
   (dropped); now returns all non-deleted profiles with an interim-behaviour comment. Ownership signal returns with
   the Phase-2 engine mirror (B2 input).
8. **4 files still called "dead" fns** (Phase 4, plan assumed zero consumers): CreateAIScreen, AIProfileScreen,
   CharacterProfileEditScreen, CharacterCardImportService — call sites removed (see per-phase above).
9. **Phase-4 gate residuals are documentation-only**: the new migration's header must name `reply_to_message_id` +
   dropped tables (phase-doc self-contradiction resolved in favor of required docs); `@harmony_character_categories`
   key substring-matches `character_categories` (false positive). `MarketplaceService.test.ts` doomed-repo
   jest.mock backstop removed (module gone — resolution fails loudly anyway). `src/database/README.md` untouched
   (verified it never listed sidecar tables).
10. **F4 data note**: old-derivation settings rows = accepted loss on dev devices (no re-key migration — decided,
    comment in `chatConversationSettings.ts`). Reply-mode storage key migrated from her `chat_reply_mode_` prefix —
    old dev values abandoned, consistent with the F4 ruling.
11. **Phase-7 recovery design**: bounded 2 retries (not a loop); `isPurging?.()` optional-called so the unmodified
    spec's mock passes while production suppression works.
12. **Phase-8 image reconcile uses soft delete** (repo default) not permanent delete — audit trail kept;
    `updateCharacterImage` already existed → no new repo fn (doc's conditional).

---

## What was intentionally NOT fixed

- **Stub API surface kept minimal** — text/theme publish, listing edit, re-list, library-remove are honest
  "not available in preview" errors; no fake success anywhere. *(SUPERSEDED by review phase — all four flow
  through the extended stub now.)*
- **Notification write side** — the stub feed is read-only; the badge reflects the seeded feed only. Backend must
  own notification writes (20-Backend-Concept item).
- **No read APIs for per-item liked-state / counts** in the stub (posts, images, saved-state) — screens derive at
  read time, start `liked=false`, trust the toggle return; a focus reload resets liked visuals. Future backend
  should expose per-item liked-state + counts.
- **Followers stays 0** on My Profile (only Following is derivable) — honest stub limitation; backend graph needed.
- **Creator→user resolution not done at stub level** (`filterBlockedCharacterProfiles` matches blocked user ids
  against local profile ids; old doomed table did the resolution). Marketplace/Discover character feeds are not
  block-filterable (listings carry `creatorName` only) — backend needs creator user ids on listings.
- **10 pre-existing cosmetic parity drifts + `device_push_tokens` Go-only** — pre-existing baseline, untouched
  (this phase's parity gate is exactly the expected narrowed-D3 set).
- **`reply_to_message_id` / reply feature** — stripped (O4), not kept.
- **D1-11 legacy persona prefs** — deferred (P4/O2). **F2/F9 (paywall)** — done by this phase. **F4 no-re-key
  ruling** — old settings rows accepted loss.
- **Kotlin `show()` Promise<boolean> compile** — rides the user's next device build (no Kotlin source change by us).
- **`e2e/.maestro/03-conflict-resolution.yaml`** — stale artifact flagged (pre-existing, outside jest gates).
- **Dev-DB-wipe** — not automated; documented (see §Dev-DB-wipe note).

---

## Gate outputs

### Final (run by the orchestrator, Phase 9)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **0 errors** |
| Unit (`npx jest --selectProjects unit`) | **95 suites / 834 tests passed** (12 snapshots) |
| Integration (`npx jest --selectProjects integration`) | **10 suites / 50 passed + 1 skipped** — the skip is the pre-existing integration skip, NOT `entitySessionInitRecovery` (that one is re-enabled and green) |
| Schema dump (`npm run schema:dump -- --output schema/rn-schema.json`) | regenerated; parity = exactly the expected Phase-1 end state (see §Parity excerpt) |
| `npx gitnexus analyze` | 7.039 nodes / 14.268 edges / 189 clusters / 300 flows |
| Grep sweeps (§1 of 9-VerificationRecords) | all zero in src/ — only intentional residual: the static no-import assertion regex inside `MarketplaceService.test.ts` |

### Per-phase numbers (from the logbook)

| Phase | Unit | Integration | Notes |
|---|---|---|---|
| 1 — Stub layer | 88 suites / 861 tests | 10 / 50 + 1 skip | GitNexus symbols 7 110 → 7 384, no touched flows |
| 2 — Mkt/wallet wiring | 88 / 858 | 10 / 50 + 1 skip | grep sweeps clean (only repo-internal definitions + their tests) |
| 3 — Social/profile wiring | 88 / 858 | 10 / 50 + 1 skip | gate-1 grep clean |
| 4 — Schema surgery | 84 / 770 | 10 / 50 + 1 skip | −5 repo suites, +1 CategoryPreferencesService; snapshots −648/+6 lines, v5–v40 boundaries byte-identical; parity = expected set exactly |
| 5 — B4 revert | 84 / 770 | 10 / 50 + 1 skip | grep zero; service had no tests |
| 6 — D-register mends | 91 / 810 | 10 / 50 + 1 skip | +7 suites / +40 tests across 4 commits |
| 7 — INIT_ENTITY recovery | 92 / 814 | 10 / 50 + 1 skip | spec suite 4/4 green unmodified; all 11 entity-session suites green |
| 8 — Editor consolidation | 95 / 834 | 10 / 50 + 1 skip | +3 suites / +20 tests; grep `CharacterProfileEdit` in src/ → zero |

---

## Parity excerpt (Phase-1 end state)

| Category | Count | Entries |
|---|---|---|
| RN entries | **55** | regenerated `schema/rn-schema.json` |
| Go entries | **55** | `harmony-link-private` HEAD dump |
| Matching | **43** | — |
| RN-only | **1** | `idx_conversation_messages_pinned` (part of the named D3 divergence) |
| Go-only | **1** | `device_push_tokens` (engine-only; RN's `000039` is the reserved-number placeholder) |
| Different SQL | **11** | `conversation_messages` (D3-narrowed) + 10 pre-existing cosmetic drifts |

**Exactly the expected Phase-1 end state:** D3 is now NARROWED to `conversation_messages.reactions_json` +
`is_pinned` (+ pinned index); RN-only index leaks: **zero**. Anything else would have been investigated, not
papered over.

---

## Dev-DB-wipe note

Devices that already ran builds recording the old migrations 41–55 (marketplace/social sidecar tables) need a
**one-time dev DB wipe** (dev-only exposure; orphaned preview tables are harmless but linger). The consolidated
`000041` migration header documents this; the CHANGELOG wave carries the user-facing hint. No production migration
path exists for the dropped tables by design (they were never synced to the engine).

---

## Standing decisions consumed

1. **Consolidation amendment (Track B5, user-approved)** — 15 migrations collapse into ONE `000041` containing
   only surviving SQL (message actions minus reply-to, personas, character_favorites, chat_conversation_settings);
   all marketplace/social/wallet sidecar SQL dropped.
2. **`blocked_users` → stub** — table dropped; the block list lives in the `SocialService` stub (BlockedUsersScreen
   keeps working against fixture users).
3. **`MarketplacePurchaseService` fold** — service deleted; the acquire flow folds into `MarketplaceService.acquire()`.
4. **Blocked-column deferral** — `chat_conversation_settings.blocked` column name stays until the Phase-2 B2 table
   rewrite (the repo keeps the `'blocked'` storage flag deliberately).
5. **`21-Engine-Contract-Persona-Enums.md` deferred** — drafted in Phase 2's own planning round, not now; Phase 9
   writes only the outline section below.

---

## Phase-2 outline (engine track — LAST, own planning round produces `21-Engine-Contract-Persona-Enums.md`)

1. **B1 — message actions on the engine.** Go mirror migration for `conversation_messages` (`reactions_json`,
   `is_pinned`, read flags — shape O12) + engine ingestion/persistence → **D3 closes, parity gate green**.
2. **B2 — app-side tables get engine mirrors + watermark columns.** Go mirrors + watermark-contract columns
   (`deleted_at`) + SyncService registration for `character_favorites` and the **redesigned**
   `chat_conversation_settings` (unread → derived read-flags — her 3 parallel unread systems die; reply-mode
   becomes a synced column, replacing the interim AsyncStorage key); tags→categories sync path.
3. **B3 — personas & entity typing.** `entities.entity_type` enum (P3/O1 naming); personas → user entities
   conversion (O8); engine lifecycle/emotion/proactivity = AI-only; user-entity prompt-injection symmetry +
   `rag_reindex_required` semantics (O13).
4. **Engine-side ChatList consequences** — F1/F8 event contract if B1 planning wants push-driven chat lists
   (today the `message:received` + session-lifecycle contract is app-local).

**Pointers for follow-up Phase 2 from the logbook:**
- **Ownership-signal gap (B2 input):** `getUserCharacterProfiles` interim-returns ALL profiles (old
  `character_profile_sources` JOIN dropped). The engine mirror must restore per-user ownership so MyProfile "AI
  Characters" count, the publish flow, and the apply-to-character picker filter correctly.
- **Backend-concept discoveries:** profile→listing linkage (AIProfile price pill + acquire-success deep link have
  none); text/theme publish + listing edit + re-list + library-remove (honest-error placeholders now); `salesCount`;
  itemType→profile-field mapping for apply-to-character; "created by others" Discover query; real `upgradeUrl`
  (placeholder `https://harmony.ai/souls`); profile extension = `username`/`bio` in `PATCH /v1/auth/me` + avatar
  upload endpoint + `avatar_url` in responses; notification **write** side (comment/like/follow/image-comment
  events → notifications); per-item liked-state + count reads on posts/images; follower graph for the local user;
  creator user ids on marketplace listings (blocked-filter + attribution + creator resolution).
  *(Review-phase update: profile→listing linkage, text/theme publish + edit/re-list/library-remove, `salesCount`,
  and the profile-extras seam are now STUB-SUPPORTED — the listed items remain as the real-backend requirements.)*
- **Stub read-API gaps:** no liked-by-me / count getters in the stub — screens derive at read time and start
  `liked=false`; a focus reload resets liked visuals. Future backend should expose per-item liked-state + counts.
- **Stub seam contract (client design input):** `MarketplaceService` / `WalletService` / `SocialService` /
  `NotificationService` method surfaces as shipped in Phase 1 are the client contract; wire shapes must keep
  `APIError.isQuotaError`, `soulCreditsAvailable`, `currentTier`, `upgradeUrl` and the subscription sub-API
  (see `20-Backend-Concept-Marketplace-Profile.md` outline).
- **Phase-6/7/8 state for B-planning:** F4 confirmed NO app/engine participant-key drift (contract pinned by test);
  read-flags (B1) supersede `unread_count` (kept until then); INIT_ENTITY recovery is app-side bounded (engine
  unchanged; contract: `entity_not_defined` rejection during the pre-ingestion race is now recovered app-side);
  the editor's full V3 column surface matters if the engine ever validates/normalizes card columns on sync.

---

## Verification (Phase 9 checklist)

- [x] All gates green with expected outputs; no unexplained parity entries
- [x] Record doc + outlines written; CHANGELOG/README/docs/memory bank updated
- [ ] Final `gitnexus_detect_changes()` on the docs commit (orchestrator, after committing)
- [ ] Hand-off note to user: on-device smoke list (Market/Discover/Chat create→chat reliability/Editor
      round-trip) + pending coordination item (senju origin force-push window)