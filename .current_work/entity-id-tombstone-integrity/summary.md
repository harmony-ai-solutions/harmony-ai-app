# Entity ID Integrity & Tombstone Strategy — Implementation Plan

> **Follow-up work to Senju Phase 2** ([`16-Engine-Phase2-PostAlignment-Record.md`](../senju-rebase-integration/16-Engine-Phase2-PostAlignment-Record.md)).
> Resolves follow-up ledger items **N1** (sync-apply ghost-PK failure), **N3** (space-containing entity ids),
> **N4** (renameEntity onto ghost id), mitigates **N2** (cross-device derived-id LWW merge), and partially
> addresses **N6** (management openapi.yaml gaps) by documenting the new endpoints.
>
> **Plan review 2026-09-05:** verified against all three working trees by 3-agent audit; corrections folded in
> and decisions **D7–D10** added (user-ruled same session). See `6-1` for the shared verification artifacts.
>
> **Plan review 2, 2026-09-06:** full 3-agent re-audit + user rulings **D11–D21** (same session). Most
> consequential: **D11 supersedes D7's repair sequence** — convergence is now engine-authoritative (app
> one-time wipe + full re-sync), which deletes the app id-migration, the timestamp repair pass, the
> `repair_completed` marker, and the two-deploy split. New phase **2-1b** owns D8. 3-2 was rewritten.
>
> **Plan review 3, 2026-09-06 (session 2):** 5-agent code audit (engine sync, engine id/migration, app sync,
> app UX, engine FE) + live-DB verification + user rulings **D22–D40**. Most consequential: **D22 removes
> runtime id-rename entirely** (the audit proved a runtime PK rewrite is impossible in-transaction under FKs
> ON — and D2/D14 had already made ids machine plumbing), **D23 makes creation server-derived-only** (ids
> locked from birth), and **D39 generalizes the ghost-aware apply** with `character_image` added as the 6th
> ghost-risk table. Mechanical corrections are folded directly into the phase docs.
>
> **Plan review 4, 2026-09-06 (session 3):** 4-agent code audit (engine sync, engine id/migration, app,
> engine FE) + spot verification. Gap closures and pattern fixes folded directly into the phase docs; user
> rulings **D51–D60** added (below; numbered from D51 because the same-day plan amendment claimed D41).
> Most consequential: **D51 pins the migration's unicode slug as a
> recursive-CTE pure-SQL transform** (the audit proved the driver has no `regexp()` — the original
> "replace() collapse" wording was not implementable), **D52 unifies duplicate ids with timestamped
> derivation**, **D55 closes the create→open-chat critical-wait hole** (the incident's wizard variant), and
> the **D26 child-count arithmetic is corrected** (entity + **8** children / **9** stamps — the docs said 7/8).
>
> **Plan amendment, 2026-09-06 (session 3):** user ruling **D41** — the restore/deleted-entities UI ships in
> the **app** too (parity with 5-2; 5-2's "deliberate non-goal" note is superseded). New phase **5-3** owns the
> app side: local resurrect + sync propagation (per D4) — no management-API access, no new sync protocol
> message. App delete-path parity fixes ride along (D26's 8-child cascade + D17's one-`now` persona stamping).
> **Review 6: D41 and Phase 5 in their entirety are superseded by D75 — nothing in this amendment ships
> except the delete-path parity fixes (retained via D26/D17/4-4).**
>
> **Plan review 5, 2026-09-06 (session 4):** 4-agent code audit (engine sync, engine repos/migrations, app,
> engine FE) + live-DB spot verification and user rulings **D61–D67** (below). Most consequential: **D61 moves
> the app wipe into the boot window** (supersedes D38's placement — screens mount and query the DB before the
> on-connect sync effect fires, so an `initiateSync`-first-statement wipe ran under already-rendered screens)
> and **D62 converts migration 000045 to a Go migration via a ~20-line runner hook** (supersedes D51's
> recursive-CTE slug, moots D40 — the live-tested audit proved the pure-SQL conforming-detector and charset
> verification have no correct form without `regexp()`, and GLOB is loose/unreliable). Mechanical corrections
> and implementation pins folded directly into the phase docs.
>
> **Plan review 6, 2026-09-06 (session 5):** design consultation + user rulings **D69–D78**. **D1's never-purge
> invariant is superseded** — tombstones are the delete-propagation protocol, garbage-collected after
> propagation: the engine finalize purge is **repaired** (FK-safe order, unified 35-table allowlist — D71/D72)
> instead of removed, the app finalize purge is **kept** (D73), and a **purge floor + stale-watermark rebuild**
> (D76) makes the deliberately un-gated engine GC (D69a) multi-device-safe. **Phase 5 (restore) is deleted
> entirely (D75)** — deletion is final once propagated and GC'd; recreation (new timestamped id) is the only
> path back. Ids remain never-reused — now guaranteed by construction (D2/D23), not by tombstone retention.
>
> **Plan review 7, 2026-09-06 (session 6):** 3-agent code audit (engine, app, engine FE — ~60 file:line
> claims verified; review 6's design rulings were audited against code for the first time) + user rulings
> **D79–D87**. Most consequential: **D79 re-homes the orphaned D26/D17 delete-cascade work** (Phase 5's
> deletion had left the 8-child cascade + one-`now` stamping without an owning step — engine = 2-1b step 6,
> app = 4-4 step 6), **D80 makes migration alias-backfill collisions skip-and-log** (a collision on the
> alias partial unique index would otherwise boot-loop the migration), **D81 migrates `claire`** (D31
> amended to seed-time-only; only `user` is migration-exempt), and **D82 makes the 4-5 rebuild reaction a
> process restart**. Mechanical corrections folded directly into the phase docs.

## Incident & Root Cause Summary

**Symptom:** Quickly deleting an entity ("Isabella") and recreating it from a character card leaves the new
entity stuck in "waiting for connection"; the greeting never arrives. Observed 2026-09-05 (adb logcat PID 5916 +
engine log `soulbits-tmp/logs/soulbits-engine_2026-09-05_11-09-37.log`).

**Root cause chain (verified by 3-agent investigation + live DB inspection):**

1. Engine soft-deletes entities (tombstones); app receives tombstones via forced full sync, then **hard-purges
   its local tombstones** on `SYNC_FINALIZE` (`SyncService.ts:1551-1612`) → app loses the ghost id reservation.
2. Engine's own purge (`database/repository/synchronization/maintenance.go:12-47`) is **permanently broken**
   (deletes `character_profiles` before `entities` → RESTRICT FK aborts the whole loop — the recurring
   `Failed to clean up soft-deleted records` error) → engine tombstones (and their PK reservations) persist forever.
3. App recreates "Isabella" → ghost-guard `entityIdExists("Isabella")` returns false (local ghost purged) →
   reuses raw id → pushes `entities.insert` → engine sync-apply does deleted-filtered `GetEntity` → raw
   `CreateEntity` INSERT → **`UNIQUE constraint failed: entities.id`** (N1) → silent rollback.
4. App proceeds to INIT_ENTITY (sync failure swallowed as "non-critical") → engine in-memory entity map never
   refreshed → **`entity_not_defined`** (`eventprocessor.go:196-198`) → no session, no greeting.
5. App recovery re-sends the same failing insert, exhausts retries, deletes the session → ChatDetailScreen shows
   amber "Connecting…" forever; splash never reveals (`has_first_mes` never arrives).

## Binding Strategy Decisions (user-ruled, 2026-09-05 session)

| # | Decision |
|---|---|
| D1 | ~~**Entity IDs are never erased & never reused.** Deletion = soft-delete (tombstone); tombstones are **never purged** from either DB. This is the original design invariant and is restored/protected by this plan.~~ **SUPERSEDED by D69–D78 (review 6): tombstones are the delete-propagation protocol, garbage-collected after propagation** — engine finalize purge repaired (D71/D72), app finalize purge kept (D73), no restore exists (D75). **IDs remain never reused — guaranteed by construction (D2/D23 timestamped ids), not by tombstone retention.** Physical purge is the terminal state of deletion. |
| D2 | **Timestamped default ID schema**: new entity ids are derived as `{slug(name)}-{YYYYMMDDHHMMSS}` in **UTC** (e.g. `Isabella-20260905123514`). Slug = name with every run of chars outside `[A-Za-z0-9]` collapsed to a single `-` (trim leading/trailing `-`), empty fallback `entity`, base slug capped at 48 chars. Existing ghost-aware dedupe (`resolveNextEntityIdCopy` app-side, `dedupe_id_if_taken` engine-side) remains as backstop for same-second collisions. **Rejected alternative**: first 8 chars of a hashed date (worse readability, no monotonicity, adds birthday-collision risk without benefit). |
| D3 | **Spaces are prohibited in entity IDs** (charset `^[A-Za-z0-9][A-Za-z0-9._-]*$`, max length 64). Applies to every creation/rename seam in all three codebases. The built-in `user` persona entity id is exempt from the timestamp pattern but must still satisfy the charset. **Persona display names keep spaces by moving them to `alias`** (alias carries the human name, id is derived). Resolves ledger N3. |
| D4 | **Recreation always mints a NEW timestamped id** (~~history stays attached to the old tombstone); **restore** is the explicit path to bring a deleted entity back (resurrect: `deleted_at = NULL`, `updated_at` bump, propagates via sync)~~ — **restore clause dropped by D75 (review 6): no restore exists; recreation is the only path back**, and the old family is eventually GC'd per D69–D78). Engine sync-apply becomes ghost-aware (N1 fix): an incoming live row whose PK collides with a tombstone replaces/resurrects the tombstone row when newer (LWW). |
| D5 | **Deterministic migration**: existing entity ids (live *and* tombstoned) are converted to the new pattern using the **row's own `created_at`** (UTC, second precision) as the timestamp — NOT migration runtime. ~~"…so engine and app migrations independently produce identical ids and sync converges"~~ — **amended by D11**: only the engine migrates (determinism is now engine-internal/idempotence); the app wipes and re-syncs. Renames ripple to `alias`, `entity_module_mappings`, `interactions` (`entity_id`, `participant_key`, `participant_ids` JSON), `conversation_messages` (`entity_id`, `sender_entity_id`), `memories`, `emotion_state`, `lifecycle_state`, `entity_emoji_actions`, `chat_conversation_settings` (`participant_key` PK, `entity_id`). |
| D6 | **Sync schema version gating**: engine rejects sync from app builds below the minimum sync-schema version (and vice versa) with a clear "update required" signal, preventing migrated/un-migrated DB divergence (duplicate-id chaos). |
| D7 | ~~**Same-release, runtime-ordered id convergence**~~ **SUPERSEDED by D11** (plan review 2): the repair-pass sequence below is replaced by engine-authoritative wipe + full re-sync. The D7 finding it rested on remains true and relevant (the engine re-stamps incoming timestamps; verbatim apply ships as 1-1 step 2 as a correctness fix), but the cross-repo determinism requirement is gone — only the engine computes migrated ids. |
| D8 | ~~**Rename is an in-place ripple rename**~~ **SUPERSEDED by D22 (review 3): runtime id-rename is removed entirely** — endpoint, controller path, FE dialog deleted; 2-1b is now the removal phase. (The review-3 audit found the in-place rewrite was additionally impossible in-tx under FKs ON: no `ON UPDATE CASCADE` on any `entities(id)` FK; `PRAGMA foreign_keys` is a no-op inside a tx, `migrations.go:190`.) Original: Engine `RenameEntity` was to be re-implemented as a transactional id rewrite across the full D5 ripple matrix (D12: independent Go, no migration-SQL sharing). Replaces today's create-copy-tombstone rename (`entity_controller.go:478-527`) which severs history and collides as a raw 500 — that broken implementation is what gets deleted. |
| D9 | ~~**Resurrect ≡ restore; greeting guard stays live-only** (user-ruled). The 1-1 sync-apply resurrect runs the **same** child-resurrection logic as 5-1's restore (shared repository helper keyed on the tombstone's pre-overwrite `deleted_at`).~~ **SUPERSEDED in part by D75/D69–D78 (review 6): the shared child-resurrection helper is gone** (no restore); the 1-1 sync-apply resurrect is **row-level** — a lagging sender pushes entity AND child rows as individual records, and each child resurrects through its own ghost-aware apply (D39) under the same LWW rule; family completeness comes from the record stream, not a matcher. **Survives unchanged:** `HasPriorConversation` keeps filtering `deleted_at IS NULL` — do NOT make the guard tombstone-aware (would silently empty "clear chat"-style restarts). |
| D10 | **Reserved entity ids: `{user, deleted}`** enforced at every charset-validation seam (2-1 engine, 2-2 app, 2-3 FE). `deleted` avoids gin static-route shadowing of `GET /api/entities/deleted` (an entity named `deleted` would be unfetchable/unrestorable by id); `user` formalizes the existing implicit guard. |

## Plan-Review-2 Rulings (user-ruled, 2026-09-06 session)

| # | Decision |
|---|---|
| D11 | **Wipe-as-primary convergence (supersedes D7's ordering).** Single engine deploy (migration 000045 + sync gate v2, 3-3); the app update performs a **one-time local wipe + full re-sync** from the migrated engine (rewritten 3-2). No app id-migration, no repair pass, no marker. App ships a **no-op placeholder migration 000045** for cross-repo numbering parity. Accepted cost: app-local rows created offline and never synced are lost (dev-branch context). **Engine updates before app.** |
| D12 | ~~**D8 rename is an independent Go implementation**~~ **(moot — D22 removed rename entirely)**. Original: never shared with 3-1's migration SQL ("we never mix business logic with SQL migrations"). Only pinned equivalence: participant-key recompute ↔ `DeriveParticipantKey` (fixture-locked in 6-1 §3). |
| D13 | **4-2 simplified.** Typed `SyncConflictError` (engine confirm payload gains a structured error field, 1-3) + `critical` syncAndWait mode + actionable alert + **no navigation into a doomed chat**. The local id-rewrite/ripple/re-push recovery machinery is **dropped** — Phases 1–2 make genuine conflicts near-impossible; a retry re-derives a fresh id at a new second. |
| D14 | **Persona display-name edits never rename the entity id** (FE mirrors 2-2's "id stable for life"). Edit = alias + profile update only; ~~id rename happens solely via the explicit Entities-tab action~~ **(review 3: no id-rename action exists at all — D22; alias edit is the only "rename")**. Persona name-uniqueness becomes **case-insensitive alias-equality**. |
| D15 | ~~**Create/rename wire contract.**~~ **Amended by D23 (review 3): derived create is the ONLY mode.** Original: Derived create sends `{ name, character_profile_id?, dedupe_id_if_taken: true }`; explicit create sent `{ id, … }` verbatim; rename targets used verbatim. **Now:** requests carrying `id` → `400 'id is server-assigned'`; the explicit mode and the rename clause are deleted (D22/D23). Duplicate keeps derivation (`DeriveEntityID(source name, now)`). |
| D16 | **Delete returns 409 while any active session exists on the entity id** (~~rename AND~~ delete — review 3: rename half deleted with D22). Prerequisites: entity sessions reliably released on WS disconnect (**D27: this is a code fix, not just verification — non-phone disconnect never removes sessions today**); zombie runners/emotion-engines (no attached session) cleared as shared hygiene on delete/restore/resurrect; restore + sync-apply resurrect need no session guard (nothing legitimately attached to a tombstoned id). |
| D17 | **Unified cascade stamp.** `DeleteEntity` captures ONE UTC second-truncated `now` for the entity row + all cascade UPDATEs (6 children pre-D26, 8 post — review-4 count fix) + the persona route's profile delete; cascade UPDATEs must NOT re-stamp already-tombstoned children (`AND deleted_at IS NULL`). Restore/resurrect child matcher = **parsed-instant equality (second-truncated)** against the tombstone's pre-overwrite `deleted_at` (bridges engine format-A/B and app ISO-ms cascades — the app already stamps its 6 children + entity row with one shared `now`, `entities.ts:720-728`). Pre-fix legacy tombstones restore best-effort (documented, accepted). |
| D18 | **`chat_conversation_settings` gets a full soft delete** (not "just set deleted_at"): tombstone + `deleted_at IS NULL` on all five read predicates (`getChatConversationSettings`, `…Batch`, `conversationSettingsExistForEntity`, `listConversationsByFlag`, `getReplyMode`) + `deleted_at = NULL` resurrect in `upsertSettings`'s ON CONFLICT. A hard delete here would resurrect "deleted" conversations on every full re-pull (D11). |
| D19 | **The wipe clears id-keyed AsyncStorage preferences** (`chat_global_impersonated_entity`, `@harmony_chat_reply_mode_*`, legacy `chat_entity_pref_*`) — preferences reset once; no remap machinery. Ids are stable for life post-migration, so the staleness class is one-time. |
| D20 | ~~**Length edge ignored.**~~ **Fully moot per D23** — no human-typed ids exist anywhere post-review-3, so there is no 64-cap validation surface at all (the concept survives only inside 3-1's "already-conforming" regex detector). |
| D21 | **Small-items bundle (all user-approved):** (1) config-table sync keeps `id` stripped, applies `created_at`/`deleted_at` verbatim (verify `UpdateRecordMap` writes the column); (2) sync-finalize updates its own session row by sessionID, not `GetActiveSyncSession`'s latest; (3) delete dead `SoftDeleteEmojiActionsByEntity` + `UpdateMemoryEndDate`; (4) emotion/lifecycle apply documented as unconditional replace ("newest-arrival-wins, ephemeral") — never "LWW"; (5) mappings delete→LWW fall-through (`synchronization.go:1424-1430`) preserved + pinning test; (6) migration fixtures add format-B `entities` rows, treat already-conforming ids as taken in tie-breaks, sorting pinned to SQL BINARY `ORDER BY` (never `localeCompare`); (7) app fixes `normalizeTimestampForSync`/`toUnixTimestamp` space-format→UTC (hygiene; skews live LWW today) — **review 3 (D32): ships in the 3-2 wipe release**; (8) ChatDetail partner header gains alias fallback (`nickname \|\| name \|\| alias`) — **review 3: extend to `headerName` derivation (447/536→2263), not just `charName:2094`**; (9) FE adds `node --test` behavioral locks for validation utils (precedent: `dynamicBackgroundStore.test.js`); (10) FE deleted-lists: one shared `DeletedEntitiesSection`, type-filtered per tab, store `deleteEntity` refreshes it; (11) dead i18n keys **deleted** (`personas.json` `fields.*`, `characters.json:76 deleteConfirm` — **review 3: also `characters.json` `createPersonaReservedUser`/`createEntityReservedUser`/`entityIdInvalidName` and `entitySettings.json` `invalidChars` + rename-confirmation keys, orphaned by D22/D23**); (12) tutorial copy (**path corrected: `src/components/tutorial/tutorialSteps.jsx`**) updated in lockstep — **review 3: name-only copy (no id mention remains)**; (13) dev-tool raw-id surfaces won't-fix; ~~Simulator post-rename reselect blip accepted~~ (moot — no rename). |

## Plan-Review-3 Rulings (user-ruled, 2026-09-06 session 2)

> 5-agent code audit + live-DB verification. Rulings below change design; mechanical corrections are folded
> into the phase docs directly.

| # | Decision |
|---|---|
| D22 | **No runtime id-rename — ever.** The management rename endpoint, `RenameEntity` (create-copy-tombstone, `entity_controller.go:478-527`), and the FE rename dialog are **deleted**; "rename" is always an alias edit (`updateEntity`). Motivation: a runtime PK rewrite is impossible in-transaction under FKs ON (no `ON UPDATE CASCADE` on any `entities(id)` FK; `PRAGMA foreign_keys` is a no-op inside a tx, `migrations.go:190-194`), and D2/D14 already made ids machine plumbing — the endpoint was the last human-id entry point. Supersedes **D8/D12**, D15's rename clause, D16's rename half; **N4 closed by removal**. Vector `Relocate` API dropped; 3-1's one-time re-embed cost accepted + documented. 2-1b rewritten as the removal phase. |
| D23 | **Ids are server-derived only and locked from birth.** Wire contract: `{ name, character_profile_id?, dedupe_id_if_taken: true }` — requests carrying `id` → `400 'id is server-assigned'` (old clients fail loudly). FE `validateEntityId`/`generateUniqueEntityId` deleted entirely; app 2-2 step 3 (explicit-id validation) dropped. Every id in the system is a built-in, a one-time-migrated legacy id, or minted by construction. Supersedes D15's explicit mode; **D20 fully moot**. Name-level reserved checks stay (D33). |
| D24 | **Sync-apply delete runs the shared zombie teardown** (stop runners/emotion engines, evict active sessions on the id — deletion must converge; nothing may stay attached to a tombstoned id). Owned by 1-1; helper shared with delete/restore (2-1b). |
| D25 | **Unified delete-op stamps (D17 extension):** ALL engine delete paths — the D17 cascade, per-table sync delete ops, and `DeleteEmojiAction` (which also gains the `deleted_at IS NULL` guard it lacks today) — route through the one captured-now helper. ~~This is what makes the instant-equality restore matcher sound for **sync-arrived** tombstones~~ **(review 6: the restore matcher is deleted with Phase 5 — the unification survives as delete-path hygiene: consistent family stamps are what let the repaired GC (1-2) purge whole families predictably; the engine re-stamps children's `deleted_at` at apply time today: `interactions.go:242`, `messages.go:166`, `memory.go:144`, `emoji_action.go:72`).** |
| D26 | **Delete cascade grows to entity + 8 children** (review-4 arithmetic fix — the docs previously said 7): `chat_conversation_settings` and `lifecycle_state` join the cascade (neither is tombstoned today — `entities.go:160-222` cascades only 6). D17 becomes "**9 stamps, one captured `now`**" (entity row + 8 children). ~~Restore (5-1) mirrors the full 8-child set~~ **(review 6: the restore-mirroring clause is deleted with Phase 5 — the cascade growth itself stays: children MUST tombstone so the repaired GC (1-2) can purge whole families; exclusions shrink to partner-side mirror rows).** Kills the emotion/lifecycle asymmetry. |
| D27 | **Disconnect-release fix + delete-guard predicate:** non-phone WS disconnect calls `RemoveSession` (`handler_websocket.go:80-82` never removes today — `RemoveSession` has zero production callers; real leak independent of the guard); delete's 409 blocks on `Active \|\| (Suspended && within TTL)` sessions (phone sessions suspend for a 5-min TTL, `session.go:639-667`). |
| D28 | **Config-table resurrect branches inside `syncProviderRecord`** (it already fetches tombstone-aware timestamps): tombstoned + newer-live → resurrect-style update (`deleted_at = NULL`); delete-op → write the payload's `deleted_at` verbatim. Primitives untouched (`UpdateRecordMap`'s `deleted_at IS NULL` WHERE and `MarkRecordDeleted`'s re-stamp stay) — D21-1 alone was insufficient: the update path silently no-ops over tombstones (`lww.go:87`, unchecked `RowsAffected`) and the delete path never applies payload `deleted_at` (`lww.go:37`). |
| D29 | **Resurrect/restore writes `updated_at = max(incoming, engine-now UTC)`.** The engine's tombstone `updated_at` is pre-delete while the app's is delete-time, so the old "≥ tombstone's" rule could drop resurrects at the app's LWW gate (`SyncService.ts:1069`). Engine LWW gate becomes inclusive `>=` (matches the app; kills the tie asymmetry with today's strict `After` at `synchronization.go:1411`). |
| D30 | **Derived-create alias collisions auto-suffix** via existing `ResolveAliasCopy` (`entity_controller.go:209-244`) — live twin `Isabella` → alias `Isabella 2`. Consistent with `dedupe_id_if_taken`; create never 400s on name collision. (Tombstoned aliases never block — partial index, verified.) |
| D31 | **Seed ids are exempt built-ins** like `user`: `claire` (`config/db/init.go:132`) and `default-user-profile` (`:289`) keep their raw ids, documented; no per-install derivation churn. **(Review 7 amendment: the exemption is SEED-TIME only — the 000045 migration migrates existing installs' `claire` like any other non-conforming id; only `user` is migration-exempt. Fresh installs seed raw `claire`, existing installs hold `claire-<ts>` — accepted install-local inconsistency; her module folders re-embed once, D22 class. `default-user-profile` is a *profile* id — no migration effect.)** |
| D32 | **D21-7 (app UTC timestamp fix) ships in the 3-2 wipe release** — fixing it earlier causes one-time LWW churn on legacy format-A rows (parsed instant shifts by local offset); post-wipe all local rows are engine-origin. |
| D33 | **Reserved names (`user`, `deleted`) validated at all three app name→id seams** — CreateAIScreen, PersonaEditScreen (adds `deleted` to today's `user`-only check), CharacterChatService (has none today) — friendly inline error. Belt-and-braces UX guard; derivations can't collide by construction post-D23. |
| D34 | **`critical` syncAndWait gates the *shared* wait** (`SyncService.ts:606-608`): when any critical waiter exists, the shared wait rejects on error. Corrected caller map: real `syncAndWait` callers are `CharacterChatService.ts:139`, `recoverInitEntity:1859`, `PersonaEditScreen.tsx:814`, `ChatDetailScreen.tsx:2008` (the plan's 1744/2085 are `initiateSync` calls). |
| D35 | **INIT_ENTITY ERROR payload gains structured `error_code`** (`entity_not_defined`, `entity_disabled`, `entity_exists_deleted`) — the app matches free-text error strings today (`EntitySessionService.ts:34/1777`), brittle by design; 1-3 owns the field, 4-3 consumes it. |
| D36 | **`failed` marker on `InteractionSession`, retained in both maps** — service `failInteractionSession` (`:1823`) flags instead of deleting; context `handleSessionError` (`EntitySessionContext.tsx:118-125`, the second deletion site the plan missed) keeps flagged entries. One source of truth; Retry replaces. |
| D37 | **FE restore feedback:** Entities tab = refresh-then-select (the `handleCopy` echoed-id precedent `loadEntities() → selectEntity(id)` — avoids the stale-list override race, cf. `CharacterProfilesView:219-222`); Personas tab = refresh + toast (no selection state exists there — don't build one). |
| D38 | ~~**Wipe check is the first statement inside `initiateSync()`**~~ **SUPERSEDED by D61 (review 5):** React mounts screens (and their DB queries) child-first, before the on-connect sync effect fires — the initiateSync placement wiped under already-rendered screens; the boot-window placement preserves the original "before any sync starts" rationale, strictly earlier. Original: the single funnel all auto-sync triggers pass through (on-connect `SyncConnectionContext.tsx:295`, token refresh `soulbitsTokenSync.ts:85`, session start `EntitySessionService.ts:1744`); structurally race-free vs a bootstrap module racing the on-connect sync. |
| D39 | **Ghost-aware apply is a generic `applySyncedRow[T]` strategy helper** — the 7 structurally-identical switch cases (entities, character_profiles, **character_image — the 6th ghost-risk table the audit found, `synchronization.go:1378`; its fetch is deleted-filtered and its create/update re-stamp**, entity_module_mappings, interactions, emoji_actions, memories) collapse into one mechanism: strategy struct (unfiltered fetch, create, update, tombstone, `deleteFallsThrough` for mappings) + shared D9 resurrect helper. 4 cases stay bespoke: messages (field-scoped merge), emotion/lifecycle (unconditional replace), settings (tie-inversion). |
| D40 | **3-1 is decoupled from `DeriveEntityID`.** The migration runner is SQL-only (`migrations.go:373-390` — no Go hook exists), so `deriveEntityId(...)` as the Core Rule was unimplementable as written. The Core Rule becomes a documented pure-SQL transform (replace/trim/cap-48/`entity` fallback, `substr`+`strftime` over formats A/B/C, `-2` tie-break by `(created_at, old_id)` BINARY, conforming-ids-as-taken), fixture-locked in 6-1 §4. Post-D11 the output only needs charset-validity + determinism + collision-freedom — not `DeriveEntityID` equality. 6-1 §1 vectors stay 2-1-only. **(Review 5/D62: mooted — with a Go migration the transform literally reuses `DeriveEntityID`.)** |

## Plan-Review-4 Rulings (user-ruled, 2026-09-06 session 3; numbered **D51–D60** — D41 was claimed by the same-day plan amendment further below)

> 4-agent code audit (engine sync, engine id/migration, app, engine FE). Mechanical corrections folded into the
> phase docs directly; the rulings below change or extend mechanics. Decision-item format was "problem +
> options + recommendation"; the user's chosen option is recorded.

| # | Decision |
|---|---|
| D51 | **Migration slug = recursive-CTE pure-SQL transform (pinned spec).** The engine SQLite (jgiannuzzi/go-sqlite3 fork, `go.mod` replace) has **no `regexp()`** (no `SQLITE_ENABLE_REGEXP`, no Go `RegisterFunc`), and `replace()` cannot collapse runs of arbitrary non-ASCII — the review-3 "replace() collapse" wording was **not implementable** while the migration's own pass-criterion demands charset-valid ids. 3-1 now pins a recursive CTE: one codepoint per step (`substr`+`unicode`), emit `[A-Za-z0-9]` verbatim, emit `-` only on an alnum→non-alnum transition (never twice), then trim edge `-`, cap 48, `'' → entity`. Charset invariant preserved. 6-1 §4 gains a non-ASCII fixture row (`«Zoë»!!` → base `Zo`). **Superseded by D62 (review 5): the Go migration hook replaces the CTE slug entirely.** |
| D52 | **Duplicate ids are timestamped like creates.** `POST /entities/:id/duplicate` derives via `DeriveEntityID(source display name, now)` (display name = `alias` if set, else linked profile name, else id — same source rule as 3-1) with `dedupe_id_if_taken` backstop. **Behavior change:** replaces the copy-series `ResolveEntityID(src.ID)` mechanic (`Max-2`, ed517ea); the 2-1 checklist's old "duplicate derivation intact" is void. Alias stays copy-suffixed on BOTH sides (engine `ResolveAliasCopy`, app `getNextEntityAliasCopy` — the 2A/6A tie-in). FE copy flow already uses the server-echoed id — no FE change. |
| D53 | **Ephemeral-table carve-out from D1.** `emotion_state` and `lifecycle_state` are ephemeral single-row-per-entity state — D1's never-erase does **not** apply to them (unconditional `INSERT OR REPLACE` apply, `emotion.go:16`/`lifecycle_state.go:104`, may legitimately overwrite their tombstones; documented alongside D21-4). D26's cascade still tombstones them; restore's child-resurrection does **not guarantee** them (the uniform matcher may resurrect when still tombstoned with the unified stamp; an interim replace legitimately leaves them live; state re-creates on first use) — tests must not assert their resurrection. |
| D54 | **Sync-apply delete ops stay unconditional — no LWW guard (pinned as intended).** Deletes converge; a newer live row resurrects per 1-1's table. The stale-delete edge (a delete op older than a local live row tombstones anyway, and post-D24 momentarily tears down a live runner/session until the next live update) is accepted and documented. Pinning test added in 1-1. |
| D55 | **Sync fully executed before INIT_ENTITY, always (extends D34).** Chat-open runs a `critical` syncAndWait whenever the entity has unsynced local changes — predicate `entity.updated_at > last successful full-sync watermark` (per-source `getLastSyncTimestamp`; both inputs exist, no new persisted state). Closes the wizard variant of the incident: entities created fire-and-forget (`CreateAIScreen.tsx:1225` + `goBack()`) then opened later from the list had **no** guard (the old `createdNewEntity`-only wait, `CharacterChatService.ts:138`). Clean entities (pulled or already-synced) skip the wait — zero added latency. The wait resolves only on a COMPLETE sync round (incl. finalize). |
| D56 | **App-side alias dedupe at creation seams (mirror of D30).** Persona seams (`createUserPersona`, `createUserPersonaFromCard`) dedupe `alias = getNextEntityAliasCopy(displayName)` (live-only, existing helper `entities.ts:299+`) before INSERT — moving alias from `entityId` (collision-free today) to `displayName` otherwise throws on the live-only partial unique index `idx_entities_alias_unique` (000018/000042). Same treatment on duplicate seams (D52 tie-in; `duplicateAIPartner` already complies) and `openCharacterChat`'s same-name-card latent collision. Engine sync-apply does NOT mutate incoming aliases (verbatim-apply preserved — server-side D30 covers management creates only). Complements D41's restore-time alias guard. |
| D57 | **`serverUpdateRequired` = sticky suppression + slow re-probe.** The gate must not tear down the WS or it loops forever (auto-reconnect scheduler `SyncConnectionContext.tsx:310-312` + on-connect sync `:295`). Instead: sticky state (a) suppresses reconnect scheduling and on-connect `initiateSync`, (b) starts a slow background re-probe (~10 min) that re-handshakes — the app **auto-recovers** once the engine is updated (D11's "data re-pulls once the engine is updated"). Sticky state clears on an accepted version-≥-2 handshake. **(Review 7 amendment: (a) generalized to ONE choke point — `initiateSync()` short-circuits at its top while sticky, covering ALL sync triggers (token refresh, session start, screen/manual pulls); 3-3 additionally maps `SYNC_REJECT reason=unsupported_schema_version` to the same sticky state — forward-compat for future version bumps.)** |
| D58 | **Wipe-in-progress gate (labeled, i18n).** A `wipe-in-progress` flag feeds the existing splash/loading gate — a labeled rebuild screen ("**Rebuilding from Soulbits Engine…**", proper i18n keys, en only per app convention) blocks interaction with the half-wiped DB for the seconds the wipe + first pull take; cleared when the first pull finalizes. Correctness addenda folded into 3-2: production wipe uses `wipeDatabaseCompletely` (NOT test-only `clearDatabaseData`, `connection.ts:209`), closes the lazy `syncDb` handle first, and resets SyncService in-memory state. |
| D59 | **`deriveEntityAlias` deleted from the engine FE** (supersedes 2-3's "keep"). The D15/D23 contract sends no `alias`, so the util would have zero callers — the engine default + D30 auto-suffix is the ONLY alias authority; client-side alias computation disappears entirely (ids AND aliases are server-owned). The planned `node --test` alias-deriver lock is dropped with it. |
| D60 | **Legacy-000024 participant keys: RECOMPUTE** (the plan's deferred decision, now ruled). Migration 000024's backfill always wrote both participant ids into `participant_ids` (`000024:121-145`), so canonical-formula recompute is well-defined for every legacy row; single-id legacy keys disappear (uniform key format). Recorded with a test vector in 6-1 §3. **(D62: the recompute now reuses `DeriveParticipantKey` directly.)** |

## Plan-Amendment Ruling (2026-09-06, session 3)

| # | Decision |
|---|---|
| D41 | ~~**App-side restore UI in scope (parity with 5-2).**~~ **SUPERSEDED by D75 (review 6) — Phase 5 (5-1/5-2/5-3) is deleted entirely; no restore ships anywhere.** Original: a `DeletedEntitiesScreen` (the `DisabledAIsScreen` pattern — settings sub-screen, both entity types in one list) + `listDeletedEntities`/`restoreEntity` repo helpers; local resurrect propagating via normal sync upload; app delete-path parity fixes (D26 8-child cascade + D17 one-`now` stamping) riding along — those delete-path parity fixes are **retained** (owned by 4-4/D26/D17). |

## Plan-Review-5 Rulings (user-ruled, 2026-09-06 session 4)

| # | Decision |
|---|---|
| D61 | **Wipe runs in the boot window, not inside `initiateSync` (supersedes D38's placement).** The one-time wipe-flag check moves into `DatabaseContext.initializeDb` (`DatabaseContext.tsx:41-66`) — the pre-render boot window already gated by `isLoading` → `DatabaseLoadingScreen` (which already imports/calls `wipeDatabaseCompletely`, `DatabaseLoadingScreen.tsx:20/:38`). Wipe + D19 prefs sweep → clear flag → init DB; the "Rebuilding from Soulbits Engine…" label rides the loading screen and clears when the **wipe** completes (empty-DB rendering during the first on-connect pull is safe — `sync:data-applied` refreshes). Kills the syncDb-race/in-memory-reset/D58-gate machinery; the accepted-loss window is unchanged. |
| D62 | **Migration 000045 is a Go migration via a small runner hook (supersedes D51, moots D40).** `Migration` gains `GoUp func(*sql.Tx) error` + a dispatch branch in `applyMigration` (~20 lines, `migrations.go`), executed inside the existing `runMigrationTx` (FK-off + `foreign_key_check` semantics, version recording, re-run-skip all unchanged; `.down` stays the no-op comment; the `.up.sql` becomes a comment-only stub for numbering/embed parity). The migration reuses `DeriveEntityID` (Core Rule collapses to `DeriveEntityID(displayName, parse3(created_at))`), `DeriveParticipantKey` verbatim (D60 recompute), the shared 3-format parser (**owned by 3-1 since review 6 — the 5-1 owner is deleted with Phase 5**), and a real Go conforming-detector (charset + `-YYYYMMDDHHMMSS` **or `-YYYYMMDDHHMMSS-N`** — dedupe-suffixed ids count as conforming/taken). Two test layers: runner-level (hook-in-tx semantics, error→rollback/retry, mixed SQL+Go ordering, mirror-guard skips Go) and migration-level (6-1 §4 fixtures + a `Name-<ts>-2` row + run-twice idempotence + participant-key equality + orphan-referent query). |
| D63 | **Display-name sources explicitly decoupled (fixes an internal contradiction).** Migration (3-1): `alias → old id → linked profile name` (legacy ids were the display name). Runtime duplicate (2-1/D52): `alias → linked profile name → id` (post-migration ids are timestamps). 2-1's "same source rule as 3-1" claim deleted. |
| D64 | **Config-table deletes keep today's LWW guard.** D54's "delete ops are unconditional" applies to row tables only; config deletes sit after the LWW gate today (`synchronization.go:2207→2212`) and stay there — documented split. |
| D65 | **Own-entity WS disconnect stops deleting the session entry** (`EntitySessionService.ts:442-448` deletes with no marker/error today — the third deletion site D36 missed; ChatDetail doesn't listen to `session:stopped`, so it sticks at amber). Retain the entry so 4-3's retry/timer machinery sees it; evaluate `closeAllSessions` (background/sync-loss) for the same treatment during implementation. |
| D66 | **Final create contract:** `{ name, character_profile_id?, entity_type?, dedupe_id_if_taken: true }`. `entity_type` stays optional exactly as today (`routes_entities.go:184`) — persona creates depend on it (`entityService.js:94`); requests carrying `id` **or `alias`** → `400` (server-assigned at creation; alias editable via `updateEntity`). `name` is wire-only input (derives id, defaults alias); `entities.alias` (per-entity label + uniqueness anchor) and `character_profiles.name` (per-card label, legitimately shared by multiple entities) are different fields and both stay. |
| D67 | **`DeleteMemory` stays a hard delete — documented exception.** Sole production caller is memory consolidation (`modules/cognition/memory_consolidator.go:426`; promoted sources hard-deleted after content merge; `rag/sync.go:41` is the same-named vector-store call, not DB). Accepted + documented consequence: no tombstone → outbound sync can't emit it (`GetChangedMemories` selects existing rows only, `sync_utils.go:225`) → app devices retain consolidated source memories indefinitely. Recorded in the memory bank as the known D1 exception. |
| D68 | **App id-minting collapses into one seam helper (approved post-fold, same session).** All five app creation seams (`openCharacterChat`, `createPartner`, `createUserPersona`, `createUserPersonaFromCard`, `duplicateAIPartner`) route through a single DB-backed **`mintEntityId(name)`** in `entities.ts` — `deriveEntityId(name)` → reserved-name throw (`user`/`deleted`, D33) → ghost-aware `nextFreeDerivedId` — with an optional **`mintPersonaIdentity(displayName) → { id, alias }`** companion folding D56's alias dedupe for the alias-minting seams (both persona creates + `openCharacterChat`'s card alias; `duplicateAIPartner` keeps its complying copy-suffix alias). Seam drift is the N3 incident class (a seam minting raw/space ids); future seams get correctness by construction. Pure `deriveEntityId` stays in `entityIdUtils.ts` (6-1 §1 vectors) — the mint helper can't live there (DB probe); `CharacterChatService` already depends on the repo layer, so no new dependency direction. Owned by 2-2. |

## Plan-Review-6 Rulings (user-ruled, 2026-09-06 session 5)

> Design consultation, not a code audit: the session re-examined D1's never-purge invariant against the
> post-D2/D23 reality (timestamped ids make id reuse impossible **by construction**, independent of tombstone
> retention) and the user requirement that deletion must be able to actually clean up the database. The
> existing tombstone-GC mechanisms (both sides already had finalize purges — the app's was correct, the
> engine's was broken) are **kept and repaired** instead of removed. **Phase 5 (restore) is deleted.**

| # | Decision |
|---|---|
| D69 | **Engine GC gating stays status-quo (this-device session).** The finalize purge keeps its existing trigger — tombstones older than the finalizing session's start — with **no cross-device ack gating**. Multi-device is future worry; multi-device safety is provided by D76's purge-floor rebuild, not by the gate. Single-device users (the common case) are correct either way. |
| D70 | *(Moot — only meaningful with D69(b), which was rejected.)* |
| D71 | **Engine purge = minimal repair.** Fix the two real bugs only: (a) **FK-safe table order** — children of `entities` first (`entity_module_mappings`, `interactions`, `conversation_messages`, `memories`, `emotion_state`, `lifecycle_state`, `entity_emoji_actions`, `chat_conversation_settings`), then `entities`, then `character_profiles`, then `character_image`, then provider configs, then module configs (children of providers); (b) **per-table log-and-continue** — one table's error no longer aborts the whole loop (the abort is why the recurring FK error killed every table's purge). No family-atomic rewrite; legacy divergent-stamp families (pre-D17/D25) converge over successive runs — documented, accepted. |
| D72 | **GC allowlist unified to the full 35 registered sync tables on BOTH sides** (engine adds `memories`, `emotion_state`, `lifecycle_state`; app adds `emotion_state`, `lifecycle_state`). Emotion/lifecycle purge is trivially safe (D53 ephemeral). 6-1 locks both lists against `registeredSyncTables`/`SYNC_TABLES` so they cannot drift again (today: 32/33/35). |
| D73 | **App local GC kept as-is** — the existing finalize purge is correct local-GC (session complete = uploaded + applied → tombstones older than session start are spent propagation records), and the incident's id-collision class is dead by construction post-D2/D23 — **+ table list aligned per D72 + placeholder migration 000046** (parity with 1-2's `sync_gc_state`). Phase 4-1 is rewritten from "remove the purge" to "keep + align"; the planned test inversions are dropped. |
| D74 | **No explicit cleanup action** — auto-GC only (a single-device user's purge runs every sync anyway; an endpoint would add nothing it can't already do). |
| D75 | **Restore is dropped entirely — Phase 5 (5-1/5-2/5-3) is deleted.** Deletion is final once propagated + GC'd; recreation (new timestamped id) is the only path back. Supersedes: D4's restore clause, D9's shared child-resurrection helper (the 1-1 sync-apply resurrect becomes **row-level**; children resurrect via their own ghost-aware applies per D39), D37 (FE restore feedback), D41 (app restore UI), D21-10 (shared DeletedEntitiesSection), and 5-1's ownership of the shared 3-format timestamp parser (**re-homed to 3-1**, its only remaining consumer). D10's `deleted` id reservation is retained as belt-and-braces (no route consumes it now). **D17/D25 unified stamping survives as delete-path hygiene** (one captured `now`, `AND deleted_at IS NULL` guards, no re-stamp of already-tombstoned children) — its restore-matcher purpose is gone. |
| D76 | **Purge floor + stale-watermark rebuild (makes D69(a) multi-device-safe).** The engine GC persists `max_purged_deleted_at` (max `deleted_at` over rows **actually purged**; advances only when ≥1 row was purged — a no-op run never advances it). At SYNC_REQUEST, an **established** device (non-empty `synced_tables`) whose stored watermark is below the floor is answered with a rebuild signal; the app reacts by setting the 3-2 one-time wipe flag and re-running the D61 boot-window wipe + full re-pull (**accepted loss**: that device's unsynced local changes — the D11 class; a flagged device is by definition behind the engine). The finalizing device can never trip it (its watermark = session start > every purged stamp, by the `< cutoff` predicate). Fresh installs are exempt (empty `synced_tables`). Engine side owned by **1-2**; app reaction owned by new phase **4-5**. |
| D77 | **Both orphaned-memory finalize cleanups are KEPT** (engine `DeleteOrphanedMemories` call site `synchronization.go:1862`; app `cleanupOrphanedMemories` `SyncService.ts:1533`) — they sweep memories whose referencing interactions are already purged/gone, complementing D72 for exactly the legacy divergent-stamp families D71(a) converges over multiple runs. The 1-2/4-1 removal steps are void. D67's documented divergence (app-retained consolidated sources) stands unchanged — those rows stay referenced app-side, outside this sweep's reach. |
| D78 | **No tombstone-time blob slimming** — `character_image` blobs are reclaimed by GC (D72); the retention window's storage cost is accepted. Revisit only if it becomes a measured problem. |

## Plan-Review-7 Rulings (user-ruled, 2026-09-06 session 6)

> 3-agent code audit of the three working trees (review 6's rulings verified against code for the first
> time). Mechanical corrections folded directly into the phase docs; the rulings below change or pin design.

| # | Decision |
|---|---|
| D79 | **D26/D17 delete-cascade completion re-homed** (was orphaned by Phase 5's deletion — the summary's cross-references pointed at phase docs that lacked the steps): engine `DeleteEntity` → 8 children + one captured UTC second-truncated `now` incl. persona-route profile delete = **2-1b step 6**; app `deleteEntity` one-`now` block → 8 children = **4-4 step 6**. 1-2 step 11's ownership note corrected. |
| D80 | **Migration alias-backfill collisions: skip-and-log.** A backfilled alias colliding on `idx_entities_alias_unique` (live-only partial index, `000018`/`000042`) leaves the alias EMPTY and logs the row (surfaced with 3-1 step 5's orphan-referent list). Never fail the hook — a failed GoUp rolls back and boot-loops the migration. Display-name loss for that edge-case row accepted (rejected alternative: ResolveAliasCopy-style dedupe — over-engineered for the edge case). |
| D81 | **`claire` migrates** — 000045 renames her like any other non-conforming id; **D31 amended to seed-time-only scope**: fresh installs seed raw `claire`, existing installs hold `claire-<ts>` (accepted install-local inconsistency; one-time re-embed, D22 class). Only `user` is migration-exempt. `default-user-profile` is a profile id — no migration effect. |
| D82 | **4-5 rebuild reaction = process restart** (e.g. `react-native-restart`; new dependency): abort sync → persist wipe flag → **restart**; boot runs the D61 wipe naturally. Kills the mid-session re-init machinery concern (open `syncDb` handle, mounted querying screens, in-memory sync state die with the process — the exact race class D61 was ruled to kill). Crash-safety: flag persisted BEFORE the restart call. A re-flag after a completed rebuild logs + surfaces a diagnostic, never restart-loops. |
| D83 | **3-3 reject-reason mapping + D57 choke-point generalization.** `SYNC_REJECT reason=unsupported_schema_version` enters the sticky `serverUpdateRequired` state instead of the generic rejection notification (belt-and-braces — the accept-compare is the operative v1→v2 path, verified to cover cloud mode since the app handshakes there; the mapping is forward-compat for future version bumps). While sticky, `initiateSync()` short-circuits at its top for ALL triggers (token refresh, session start, screen/manual pulls) — one choke point, no per-trigger wiring. |
| D84 | **6-1 §5 synced to D61** — wipe = boot window inside `DatabaseContext.initializeDb` (was stale "inside `initiateSync` per D38"); label clears when the WIPE completes (was "wipe + first pull"). Mechanical. |
| D85 | **App placeholder migrations are TS modules** — `000045_engine_id_pattern_placeholder.ts` / `000046_sync_gc_state_placeholder.ts` (comment-only SQL template string + `migrations.ts` import/array entry); a `.sql` file would never be discovered by the app runner (44 `.ts` precedents). Mechanical. |
| D86 | **Persona edit alias-collision = friendly inline error** — case-insensitive alias-equality pre-check in `PersonaEditScreen` (live rows, self-excluded) + typed friendly error on the residual unique-constraint race in `updateUserPersona` (never raw SQLite). Mirrors the engine's update-400 + 2-3's edit predicate; creates keep auto-suffixing (D56 unchanged). |
| D87 | **Precision notes folded:** `SYNC_TABLES` pinned at `SyncService.ts:81-122`; D30 restated as query guard AND partial unique index (update path also guarded, constraint→400 race mapping); `DeleteOrphanedMemories`' live-orphan hard-deletes documented alongside D67 as the accepted no-tombstone divergence class (converges via app-local sweep); 4-3's splash ref corrected (`:134-137` = `shouldRevealEmptyChat`). |

## Phases

| Phase | Scope | Repo(s) |
|---|---|---|
| 1 | Engine integrity: ghost-aware sync apply (N1), tombstone-GC repair (1-2 rewritten — D69/D71/D72/D76), sync observability & session hygiene | harmony-link |
| 2 | ID schema: derivation + derived-only creation at all creation seams (D23) | harmony-link, app, engine FE |
| 2b | Engine: remove legacy rename + delete-side runtime guards — D22/D27 owner | harmony-link |
| 3 | Engine id-pattern migration + app wipe/rebuild bootstrap + sync version gating (D11-ordered) | harmony-link, app |
| 4 | App integrity: keep local GC (4-1 rewritten — D73), surface sync failures, fix stuck "Connecting…" UX, gate hard deletes, stale-watermark rebuild (4-5 — D76) | harmony-ai-app |
| 6 | Verification, docs, memory banks, changelogs | all |

**Recommended execution order (D11-aware):** Phase 1 + 2-1b + 4-1/4-3/4-4 first (hotfix-grade — unbreaks
the incident; 4-1 is keep-and-align under review 6 — near-no-op; verbatim-timestamp apply from 1-1 ships
here as a correctness fix), Phase 2 next, then
Phase 3 as the D11 sequence (**single** engine deploy with migration 000045 + gate v2 — **engine before
app**; the app release then performs the one-time wipe + rebuild and advertises v2),
then 4-2 + 4-5, Phase 6.

**Branches (unchanged from senju phase 2 conventions):** engine on `feat/engine-track-phase2` (local-only,
never pushed), nested `frontend/` repo on the same branch name, app on `senju-design-updates-rebase`.
**No merges to `main` anywhere.**

## Implementation Status

Track the completion of each phase as implementation progresses:

> **IMPLEMENTATION COMPLETE — 2026-09-07** (orchestrator note). All phases executed via distributed subagents;
> per-phase details + deviations live in each phase doc's "Implementation Notes". Verification evidence in
> [6-1's Verification Report](6-1-CrossRepoVerification.md); cross-repo record:
> [`../senju-rebase-integration/17-EntityIdTombstoneIntegrity-Record.md`](../senju-rebase-integration/17-EntityIdTombstoneIntegrity-Record.md).
> D11 release-window sequencing remains a **manual at-release** gate (engine deploy before app release).

- [x] **Phase 1: Engine Integrity (sync apply & tombstone GC)**
  - [x] Ghost-Aware Sync Apply — N1 Fix ([1-1-EngineGhostAwareSyncApply.md](1-1-EngineGhostAwareSyncApply.md))
  - [x] Tombstone GC repair — FK-safe order, 35-table allowlist, purge floor + rebuild signal ([1-2-EngineTombstoneGcRepair.md](1-2-EngineTombstoneGcRepair.md)) — D69/D71/D72/D76
  - [x] Sync Observability & Session Hygiene ([1-3-EngineSyncObservability.md](1-3-EngineSyncObservability.md))
- [x] **Phase 2: ID Schema — Derivation & Derived-Only Creation**
  - [x] Engine: ID derivation + derived-only create contract ([2-1-EngineEntityIdDerivationValidation.md](2-1-EngineEntityIdDerivationValidation.md))
  - [x] Engine: remove legacy rename + delete-side guards — D22/D27 ([2-1b-EngineInPlaceRippleRename.md](2-1b-EngineInPlaceRippleRename.md))
  - [x] App: ID derivation + charset validation ([2-2-AppEntityIdDerivationValidation.md](2-2-AppEntityIdDerivationValidation.md))
  - [x] Engine FE: validation UX + alias-based persona naming ([2-3-EngineFeIdValidationAndAliasNaming.md](2-3-EngineFeIdValidationAndAliasNaming.md))
- [x] **Phase 3: Engine Migration, App Wipe/Rebuild & Version Gating (D11)**
  - [x] Engine migration: legacy ids → timestamped pattern ([3-1-EngineIdPatternMigration.md](3-1-EngineIdPatternMigration.md))
  - [x] App: wipe & rebuild bootstrap + placeholder 000045 ([3-2-AppWipeRebuildBootstrap.md](3-2-AppWipeRebuildBootstrap.md))
  - [x] Sync schema version gating ([3-3-SyncVersionGating.md](3-3-SyncVersionGating.md))
- [x] **Phase 4: App Integrity & UX**
  - [x] Keep local tombstone GC + align allowlist + placeholder 000046 ([4-1-AppLocalTombstoneGc.md](4-1-AppLocalTombstoneGc.md)) — D72/D73
  - [x] Surface sync insert failures + conflict recovery ([4-2-AppSyncFailureSurfacing.md](4-2-AppSyncFailureSurfacing.md))
  - [x] Fix stuck "Connecting…" / splash dead-end ([4-3-AppStuckConnectingUxFix.md](4-3-AppStuckConnectingUxFix.md))
  - [x] Gate hard-delete paths ([4-4-AppHardDeleteGating.md](4-4-AppHardDeleteGating.md))
  - [x] Stale-watermark rebuild — purge-floor reaction ([4-5-AppStaleWatermarkRebuild.md](4-5-AppStaleWatermarkRebuild.md)) — D76
- [x] **Phase 6: Verification & Documentation**
  - [x] Cross-repo verification & incident repro test ([6-1-CrossRepoVerification.md](6-1-CrossRepoVerification.md))
  - [x] Docs, memory banks, changelogs, ledger updates ([6-2-DocsMemoryBanksChangelogs.md](6-2-DocsMemoryBanksChangelogs.md))

## Risks & Notes for Executors

- **Old plain-name ids disappear after migration** — anything referencing them externally (docs, exports,
  deep links, test fixtures) must be updated; test DBs with ids like `Isabella` get migrated to the new
  pattern by 000045 (no runtime charset checks exist post-D23 — the regex lives only in the migration's
  conforming-detector).
- **One-time re-embed (D22):** migration 000045 does not relocate on-disk vector folders
  (`WorkingDir/<entityId>/rag`); post-migration entities re-embed on first use. Accepted; document in the
  migration comment. No `Relocate` API ships (rename is gone; the load-vs-rebuild path at `rag.go:112-131`
  handles missing folders).
- **Migration numbering:** both repos' highest migration is **000044** — the id-pattern migration is **000045**
  on each side (plan's older "000001–000042" references were stale). 1-2's `sync_gc_state` lands as
  **000046** engine-side + an app placeholder **000046** (same D11 parity pattern as 000045).
- **D11 ordering is simple but strict:** the engine deploy (migration 000045 + gate v2) lands **before**
  the app update; a new app that already wiped must not point at an un-migrated engine (3-3's
  `serverUpdateRequired` covers it — data re-pulls once the engine is updated). App-local rows created
  offline and never synced are lost by design (D11) — run a manual sync first if that matters.
- **Un-gated engine GC (D69a) is multi-device-safe only via D76's purge-floor rebuild:** a returning device
  whose stored watermark lags the engine's `max_purged_deleted_at` wipes + re-pulls (losing only its
  unsynced local changes — the D11 accepted-loss class). A device that never returns blocks nothing (the
  purge is un-gated by design); any later return is flagged at SYNC_REQUEST. Single-device users never trip
  the check (their watermark = the finalizing session's start > every purged stamp).
- **Known accepted divergence (D67):** engine memory consolidation hard-deletes source rows after merging
  them into promoted memories; app devices keep the pre-consolidation sources (no tombstone propagates).
  Documented exception to the tombstone protocol (D1 as amended by D69–D78; sweep kept per D77) — revisit
  only if memory duplication becomes user-visible.
- **Timestamp format heterogeneity:** three formats coexist (`YYYY-MM-DD HH:MM:SS` SQLite defaults, Go-driver
  `2006-01-02 15:04:05.999999999±07:00` strings — some written in local time — and app ISO-ms-`Z`). After
  D11 this is an **engine-migration-only** concern (3-1); the parser spec + test vectors live in
  [6-1](6-1-CrossRepoVerification.md). App-side, the same UTC rule applies to the hygiene fix (D21-7). JS
  `Date` parses the space format as **local time** — never parse it bare.
- **SQLite FK handling during rename migrations**: the engine runner already wraps migrations with
  `PRAGMA foreign_keys=OFF` + `foreign_key_check` (inline PRAGMAs inside migration SQL are a no-op);
  `DROP COLUMN`/`RENAME COLUMN` are banned in both runners — use the `_new` table-rebuild pattern
  (precedent: app migration `000042`, engine `runMigrationTx`).
- **Version gating ships in the same window on both sides** (single engine deploy + app release per D11);
  a migrated server must never accept sync from an un-migrated app (and vice versa) — see 3-3.
- **Subagent rule from senju phase 2 (binding):** subagents read reference repos at their absolute local paths,
  never via remote refs (`feat/engine-track-phase2` is local-only).

## Context Sources Consulted

- Investigation reports (2026-09-05, 3 code-expert agents): engine, app, engine-FE findings with file:line refs
  (mirrored in each phase file below).
- **Plan review (2026-09-05, 3 code-expert agents):** all file:line claims re-verified against the three working
  trees; corrections and D7–D10 folded into the phase docs.
- `harmony-ai-app/.current_work/senju-rebase-integration/16-Engine-Phase2-PostAlignment-Record.md` (phase 2
  record + follow-up ledger N1–N9).
- Memory banks: `harmony-ai-app/memory-bank/`, `harmony-link-private/memory-bank/` (soft-delete pattern,
  id-PK-spans-ghosts rule, sync protocol).
- Codebase maps: `harmony-ai-app/.planning/codebase/`, `harmony-link-private/.planning/codebase/`,
  `harmony-link-private/frontend/.planning/codebase/`.
- Live evidence: `adb logcat` (2026-09-05, PIDs 5391/5916), engine log `soulbits-tmp/logs/soulbits-engine_2026-09-05_11-09-37.log`,
  engine DB `harmony-link-private/data/data.sqlite` (read-only inspection).
