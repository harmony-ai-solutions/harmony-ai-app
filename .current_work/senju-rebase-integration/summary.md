# Senju Design Updates → feat/cloud-lifecycle Integration

> **Status: ANALYSIS + DOCUMENTATION COMPLETE. NO implementation performed yet.**
> Awaiting proof-read before rebase execution.

## Context

Two branches diverged at merge-base `07f023900f269c73a3a4457cbc9256ec9ba297ff`:

| Branch | Author | Commits | Scale | Content |
|---|---|---|---|---|
| `feat/cloud-lifecycle` (ours, tip `969baf6`) | RuntimeRacer | 20 | 162 files, +19.7k/−1.0k | Device approval for soulbits cloud, cloud data purge, RP chat improvements (character card V3, greetings/scenario, lorebook), migration overhauls |
| `senju-design-updates` (hers, tip `5204fb5`) | senjuLawliet | 52 | 206 files, +35.4k/−7.7k | App-wide design/UX overhaul, chat UX rework, personas, social layer, marketplace/souls preview screens, 15 local-DB migrations |

Goal:
1. Rebase her branch onto the latest `feat/cloud-lifecycle` while **preserving all her UI work and genuine bugfixes verbatim**.
2. Identify red-herring fixes and bug-introducing changes (report-only; **not** fixed during rebase).
3. Identify feature work misusing the local DB / AsyncStorage against repo architecture (local DB = engine-parity-governed; cloud/marketplace/social data does not belong there).
4. Stub backend-dependent features so a follow-up can implement proper backends.

## Document Index

| Doc | Content |
|---|---|
| [`00-Research-Findings.md`](00-Research-Findings.md) | Complete analysis record: conflict map, per-area deep dives, red herrings, pattern violations, preservation inventory |
| [`01-Rebase-Playbook.md`](01-Rebase-Playbook.md) | Execution plan: phases, per-file conflict resolutions, integration commits, verification gates |
| [`02-Followup-Stub-Plan.md`](02-Followup-Stub-Plan.md) | Post-rebase work: stub layer, engine-parity track, persona spec, editor consolidation, bug mends (D1+D2 registers) |
| [`03-Pattern-Cheat-Sheet.md`](03-Pattern-Cheat-Sheet.md) | Canonical repo patterns (cloud client, DB, sync, storage, navigation, i18n, testing) + stub blueprint rules |
| [`04-Preference-Alignment-Inventory.md`](04-Preference-Alignment-Inventory.md) | Complete inventory of preference/unread settings: fixed vs dynamic, where each lives, three-parallel-unread-systems forensics |

During execution, per-step record docs will be added (`10-…`, `11-…`, …) documenting what was changed/merged/kept, with reasoning.

## Headline Findings

1. **Migration numbering collision (BLOCKER):** both branches claim versions 35–40 with entirely different SQL. Ours are engine-parity-bound (1:1 Go mirror incl. the `000039` reserved-number placeholder); hers are client-only sidecars. Resolution: keep ours 35–40 fixed, renumber hers +6 → 000041–000055.
2. **Silent runtime killers beyond textual conflicts:** her repo/screens read `appearance`/`backstory`/`example_dialogues` columns our migration 000037 drops; her code types character image ids as `number` vs our TEXT UUID PKs; her migration 000040 ALTERs the **synced** `conversation_messages` table (parity-gate break + engine push of unknown columns); her `AppNavigator` removes routes our code still navigates to.
3. **Marketplace/paywall is client-only theater:** never-synced sidecar tables mean the SOUL paywall exists only on the seller's device; no purchase path exists (`confirmPurchaseIfNeeded` dead code); two disconnected wallets; fake-success publish/delist flows.
4. **Her work is genuinely valuable in aggregate:** real fixes (haptics, emoji perf, scroll-to-latest — which fixes a bug still present on our branch, day separators, themed toasts, fork rollback), a well-engineered native bubble-chat stack, and a correct-in-intent persona concept.
5. **`f45540a` reimplemented engine-originating behavior app-side:** the engine already seeds default SoulbitsCloud configs that sync down; her `SoulbitsDefaultConfigService` creates a parallel set in engine-synced tables, un-gated by connection mode.

## Decision Record

### Rebase decisions

| # | Decision |
|---|---|
| D1 | **Full 52-commit replay** (`git rebase --onto feat/cloud-lifecycle 07f0239`), `rerere` enabled. Her authorship/history preserved. Coordinate force-push of her origin branch with her. |
| D2 | **Skip red test** `src/services/__tests__/entitySessionInitRecovery.test.ts` (rename/disable) with TODO — it asserts an `INIT_ENTITY` recovery mechanism that was never implemented (test is red against both branches). The file is a complete executable spec for the follow-up fix. |
| D3 | **Accept temporarily-red schema-parity CI** after rebase: exactly one divergence, `conversation_messages` (her message-action columns on a synced table). Closed by the engine-parity follow-up track (Go migration + engine support) — see 02-Followup, Track B. |
| D4 | **Two-step editor handling:** restore `CharacterProfileEditScreen` (+ `ProfileImagePicker`, `ImageViewerModal`) after rebase but keep it **unlinked from her UI** (immediate comparison only). Follow-up: consolidate editors — port the V3/RP editor suite into her `CreateAI` edit mode behind a UI refactor (the current screen is bloated and should be split anyway). Open sub-question flagged in playbook (Q-D4a): route registration & our import-flow deep-link. |
| D5 | **This documentation set.** Per execution step, a record doc will be created. |

### Follow-up design directives (from senior dev, binding for 02-Followup-Stub-Plan)

| Topic | Directive |
|---|---|
| Personas | Personas are a **logical concept over user entities**, not a table. Two-path model: chat-from-card / create-AI-partner → **AI Entity**; persona from scratch or from character card (**copy at creation**, like entities — P1) → **User Entity**. The default persona **is** the engine-seeded `user` entity (materialized, editable). "Chat as XY" preference → AsyncStorage. Her `personas` table is **dropped** in the streamlining (P2). `entity_type` enum on `entities` for AI- vs user-controlled (details P3, deferred). Engine lifecycle/emotion/proactivity machinery processes **AI entities only**; user entities are excluded from those automations. |
| User profiles | Cloud-first: drop the AsyncStorage shadow store (`UserProfileStore`); cloud is source of truth; `PATCH /v1/auth/me` belongs in the backend concept; avatar becomes an uploaded asset URL; any local cache must be cloud-wins, read-through. |
| Categories / favorites / conversation settings / profile sources | These are **user preferences that should sync to Soulbits Engine / Harmony Link** (unified product goal). Engine-parity track: Go mirror migrations, watermark-contract columns, SyncService registration. `unread_count` likely splits (synced prefs vs per-device unread). Character categories should be **derived dynamically from `character_profiles.tags`** (supported after our RP/card improvements; `getDistinctTags()` exists). |
| Marketplace API | Exists on her branch with real transport but points at an undocumented backend and bypasses the first-party client. **Stub now** (UI verbatim, in-memory service behind env flag), rework into proper backend concept after rebase. Pre-match `soulbits-api-client` wire shapes (`subscription`, `APIError.isQuotaError`, `soulCreditsAvailable`) so the later swap is cheap. |
| `f45540a` config seeding | She reimplemented engine-originating behavior (engine seeds `"Default SoulbitsCloud"` rows that sync down — see 00-Research §8). Follow-up: revert the auto-fill, restore the "Disabled" option, auto-select the engine's synced default row instead of creating parallel rows. |

### Proof-read round decisions (added)

| Topic | Decision |
|---|---|
| Q-D4a | **Approved (default):** register the `CharacterProfileEdit` route with a comparison-only comment; screen stays unlinked from her UX. |
| Unread / read-state | **[directive]** read state = flag on `conversation_messages` (new synced column; base model has none); unread badges/dividers **derived** from message state. Her THREE parallel unread systems (DB `unread_count`, two AsyncStorage last-read key families — one write-only dead) all removed. Full inventory: `04-Preference-Alignment-Inventory.md`. |
| Engine sequencing | **[directive]** app-side stubbing + data-model changes FINAL first; **engine side LAST**, planned in a dedicated round after the rebase (`21-Engine-Contract…` doc is that artifact). 02-Followup sequencing updated to two phases. |
| Marketplace/social tables | **[directive]** drop **all** marketplace/social SQLite tables (incl. cache tables) unless explicitly approved to keep; stub state in-memory only; every data-model-related path stubbed or removed. |
| B5 mechanics | Confirmed as proposed (fold removals into pre-release renumbered migration files, one dedicated pass post-rebase, pre-mainline). |
| ChatListScreen audit | 12 new findings registered (02-Followup Track D2): no live reload (F1, HIGH), orphaned settings on delete (F3), blocked-users never filters the list (F5), LIMIT-50 window drop (F6), dead key-last-read subsystem, and others. Only she touched the file — no rebase conflicts, purely follow-up material. |

### Final rulings (proof-read round 2)

| # | Ruling |
|---|---|
| A3 | **Confirmed:** `profile_sources.source` dropped, derived from V3 authorship (`creator`/`creator_notes`/`card_provenance`). The concept was her invention for the Discover split; author fields already cover it. "Created by others" → backend query in cloud concept. |
| A4 | **Confirmed + design note:** publishing to marketplace = **copy of card contents uploaded to the marketplace backend**; no local `'marketplace'` visibility, no local listing rows. → `20-Backend-Concept`. |
| A6 | **Returns:** instant/realistic reply-mode toggle comes back — UI in the **conversation settings menu** (not immediate chat UI/header); synced `chat_conversation_settings` column in B2, AsyncStorage interim. Explicitly distinct from O4. |
| O3 | **Engine-aligned keys:** own entity is part of the participant key **everywhere** (matching the engine); per-persona conversation semantics intended; app derivation + docstring fixed to match — no app/engine drift. |
| O4 | **Reply-to-message dropped** (removed deliberately): strip `reply_to_message_id` from renumbered-46, remove `sendTextMessage` param + `ChatBubble` reply-header remnants. |
| O5 | **(a) fixtures visible everywhere** — stubs ship in all builds, no visibility gating; service-interface seam stays as the backend swap point. |
| O6 | **Lightweight categories:** custom categories in AsyncStorage; assigning to a character writes a native profile tag (syncs via `tags`); her category tables dropped (B5). |
| O7 | **Delete** `MarketplaceApiService`. |
| O8 | **Convert** existing `personas` rows → user entities (+ minimal copied profiles). |
| O10 | **Muted ⇒ suppress badge increments** (conversation stays visible). |
| O11 | **Unify on last-message `created_at`**; replace LIMIT-50 with proper pagination. |
| — | A1, A2, A5, A7–A14 **ratified without comment** (read-flag synced; backfill all-read; drop per-partner persona pref; no local blocked-list fix; event-subscription F1 fix; repo-level cascade F3; audit findings follow-up-only; shim-row `'user'` classification; recovery spec verbatim; stub-visible UI; minor behaviors kept). |

### Post-rebase execution rulings (added during Phase 3/4 execution)

| # | Ruling |
|---|---|
| D6 | **`CLIENT_ONLY_TABLES` is interim-only scaffolding, not a design category.** Never approved; invented by senju (0cd9423) to keep the parity gate green for her sidecar tables. End state = zero dump exclusions ("app-only SQLite table" is not an allowed category — local state = AsyncStorage, engine-appropriate data = mirrored migrations both sides). **Deleted in the B5 pass** with the last sidecar-table drop. The 5-index leak was fixed immediately in commit F (`isClientOnlyEntry` matches indexes by `ON <table>`) so the gate returns to exactly D3 + known-pre-existing. |
| R7 | **Rebase-artifact fixes landed as commit E** (`53b445e`): our surviving code + her import lines lost `Animated`/`ToastAndroid`; our tests rendered her-augmented components without the now-required providers (ThemeContext, AppToastContext, AuthContext, safe-area, blockedContent repo, navigation). All 4 previously-failing suites green. These were Phase-2 integration damage — correctly in commit B's charter, not her code. |
| R8 | **3 pre-existing tsc errors on `feat/cloud-lifecycle` fixed as commit G** (`fe1408f`): `syncApplyFailureClearsSession` private `currentSession` access + `deviceAuth` `MockAPIError` used as a type. Pre-existing on our own branch (verified via worktree tsc) — fixed so tsc is clean before follow-up implementation begins. Note: the same errors remain on `feat/cloud-lifecycle` itself (fix applies to `senju-design-updates-rebase`, which supersedes it). |

### Deferred open questions

- **O1 (=P3):** `entity_type` enum naming/values, default backfill, Go migration details.
- **O2 (=P4):** Legacy "chat as AI character" stored prefs — silent fallback vs. optional "convert to persona from card" offer.
- **O9:** Offline caching for marketplace/library post-backend-concept (deferred to `20-Backend-Concept` by the table-drop directive).
- **O12:** Read-flag column shape (`read_at` timestamp vs boolean) + read-by-AI exposure — defer to `21-Engine-Contract`.
- **O13:** Engine-contract bundle for Phase 2 planning: user-entity prompt-injection symmetry; `rag_reindex_required` for user entities; engine-side `muted`/`disabled` behavior; default-persona seeding confirmation.
- (Q-D4a was resolved in round 1: route registered, comparison-only.)

## Execution Status

| Step | Status |
|---|---|
| Analysis (survey, conflict simulation, 10 deep-dive investigations) | ✅ complete |
| Decision record (D1–D5, P1–P4, design directives + D6/R7/R8) | ✅ complete |
| Documentation (this set) | ✅ complete |
| Phase 0: backups + rerere | ✅ complete (rerere left disabled — see 10-Record) |
| Phase 1: rebase replay | ✅ complete — 52/52, branch `senju-design-updates-rebase` |
| Phase 2: conflict resolution | ✅ complete — 29 rounds, record 10 |
| Phase 3: integration commits A/B/C + D2 skip | ✅ complete — `790357c`/`e494fdb`/`add5062`/`55d1fcd`, record 11 |
| Phase 4: verification gates | ✅ complete — tsc 0, unit 84/84, integration 10/10, parity = D3 only; record 12 |
| Post-gate mends (E/F/G) | ✅ complete — `53b445e`/`ca9d867`/`fe1408f`; see 12-Record appendix |
| Branch state | `senju-design-updates-rebase` @ `fe1408f` — awaiting coordinated force-push of her origin branch with senju |
| Followup Phase 1 (app-side stub/streamline) | ✅ complete — record `14-Followup-Phase1-Record.md` |
| Followup Phase 2 (engine track) | ✅ complete — record [`15-Engine-Phase2-Record.md`](15-Engine-Phase2-Record.md); engine `feat/engine-track-phase2` (NOT merged to main, Q16); migrations 41–44 both repos; parity 55/55 + 3 Go-only allowlisted; app `senju-design-updates-rebase` @ `4db2ab7`; coordinated mainline merge pending (engine FIRST) |
| Post-alignment waves (persona modules → persona cards → id/alias hardening + duplicate → app parity) | ✅ complete — record [`16-Engine-Phase2-PostAlignment-Record.md`](16-Engine-Phase2-PostAlignment-Record.md); per-wave folders `.current_work/persona-shared-modules/`, `persona-card-alignment/`, `app-parity-fixes/`; **no migrations** (parity unchanged); new follow-up ledger N1–N9 in record 16 |
