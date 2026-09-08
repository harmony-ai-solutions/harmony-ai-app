# 1-1 — Engine: Ghost-Aware Sync Apply (N1 Fix)

## Objective

Eliminate the silent `UNIQUE constraint failed: entities.id` failure when the app pushes an entity whose id is
held by an engine-side soft-deleted (tombstoned) row. Implements decision **D4** (ghost-aware resurrect/replace
on sync apply) — **review-6 amendment (D75/D69–D78): the resurrect branch is row-level; D9's shared
child-resurrection helper is deleted with Phase 5** (a lagging sender pushes entity AND child rows as
individual records; each child resurrects through its own ghost-aware apply, D39) — and the
verbatim-timestamp apply (originally D7's prerequisite; post-D11 a correctness fix — the engine must stop
re-stamping incoming timestamps). Resolves senju phase-2 ledger **N1**.

## Context (investigation 2026-09-05, re-verified in plan review)

Current apply path in `eventserver/synchronization.go` entities case (lines 1398–1416):

1. `existing, err := entities.GetEntity(tx, e.ID)` (line 1404) — `GetEntity`
   (`database/repository/entities/entities.go:33-49`) filters `deleted_at IS NULL` → tombstone is invisible.
2. On `err != nil` → `return entities.CreateEntity(tx, e)` (1413) — raw `INSERT` → PK collision with the tombstone
   row → **transaction rolls back silently** (error only travels in the unlogged `SYNC_DATA_CONFIRM` payload,
   `synchronization.go:1644-1674`).
3. Because `err != nil`, the entity-cache refresh (`synchronization.go:1633-1643`, gated on `err == nil`,
   `db.LoadAllEntities`) is skipped → `config.ApplicationConfig.Entities` never sees the entity → subsequent
   `INIT_ENTITY` fails with `entity_not_defined` (`eventprocessor.go:196-199`; **second site: resume path
   `eventprocessor.go:769`** — see 1-3).

Verified facts (plan review):

- `GetEntityIncludingDeleted` does **not exist yet** — genuinely net-new. The only ghost-aware helper today is
  the boolean `EntityExists` (`entities.go:51-66`).
- **Complete apply switch** (`handleSyncData`, `synchronization.go:1345-1578`): the ghost-PK risk class
  (tombstone-style delete **and** deleted-filtered read in apply) covers **six** tables (review-3
  correction — `character_image` was missed):
  `entities` (`entities.go:38`), `character_profiles` (`character_profiles.go:61`),
  **`character_image`** (`synchronization.go:1378-1397`; filtered `GetCharacterImage` `images.go:50`,
  raw `CreateCharacterImage` on miss), `entity_module_mappings` (`entities.go:354`),
  **`interactions`** (`interactions.go:83`), **`conversation_messages`** (`messages.go:382`). Already
  safe (unfiltered reads — LWW sees tombstones): `memories`, `entity_emoji_actions`,
  `chat_conversation_settings`; **no read at all** (unconditional `INSERT OR REPLACE`,
  newest-arrival-wins — `synchronization.go:1498-1499, 1513-1516`): `emotion_state`, `lifecycle_state`.
- **Engine re-stamps incoming timestamps** (this is what breaks D5 — see 3-1 "Convergence prerequisite"):
  `CreateEntity` omits `created_at`/`updated_at` → column default `CURRENT_TIMESTAMP` (`entities.go:20-23`);
  `UpdateEntity` overwrites `updated_at` (`entities.go:135`); same for `entity_module_mappings`
  (`entities.go:322-327`, `392`), `interactions` (`interactions.go:42-44`, `103`), `memories` (`memory.go:80-90`);
  provider/module configs strip `created_at` explicitly (`synchronization.go:2223-2225`). Already preserved
  verbatim: `conversation_messages`, `emotion_state`, `lifecycle_state`, `entity_emoji_actions`,
  `chat_conversation_settings`.
- LWW precedent: `existing == nil || e.UpdatedAt.After(existing.UpdatedAt)` at `synchronization.go:1411`
  (analogues per table; note `chat_conversation_settings` inverts to incoming-wins-on-tie at 1571).

## Implementation Steps

1. **Tombstone-aware fetch** in `database/repository/entities/entities.go`:
   - `GetEntityIncludingDeleted(tx, id string) (*Entity, error)` — same as `GetEntity` without the
     `deleted_at IS NULL` filter.
2. **Timestamp fidelity (correctness fix; post-D11 no longer a migration prerequisite — it prevents LWW
    churn and keeps engine `updated_at` from outrunning the app's):** insert AND update apply paths must
    persist incoming `created_at` and `updated_at` **verbatim** for `entities`,
    `character_profiles` (review-3 addition — `CreateCharacterProfile` omits timestamps,
    `UpdateCharacterProfile` re-stamps at `character_profiles.go:156`),
    `character_image` (review-3 addition — same pattern, `images.go:17-21, 123`),
    `entity_module_mappings`, `interactions`, and `memories` — where "memories" means
    `CreateMemory` only (`memory.go:80-90`; `UpdateMemory` already writes `updated_at`/`deleted_at`
    verbatim from the model, `memory.go:188-192`). *(Review-4 verified: model-first writes are NOT a
    shortcut — `CreateInteraction`/`CreateMemory` overwrite the model's timestamp fields
    (`interactions.go:42-44`, `memory.go:80-90`) and `CreateEntity`/`CreateCharacterProfile`/
    `CreateCharacterImage`/`CreateEntityModuleMapping` omit the columns from their INSERTs entirely; the
    per-repo SQL edits are the minimum.)* Already preserved verbatim:
    `conversation_messages`, `emotion_state`, `lifecycle_state`, `entity_emoji_actions`,
    `chat_conversation_settings`. **Config tables (D21-1 + D28):** the apply strips `id`, `created_at`,
    AND `deleted_at` from the record map (`synchronization.go:2223-2225`) — keep `id` stripped
    (server-assigned), apply `created_at`/    `deleted_at` verbatim, and implement the resurrect/delete
    **branching inside `syncProviderRecord`** (D28 — it already fetches tombstone-aware timestamps):
    tombstoned + incoming live-newer → resurrect-style update (`deleted_at = NULL`); delete-op → payload
    `deleted_at`. The primitives stay untouched — **D21-1 alone was insufficient**: `UpdateRecordMap`'s
    `WHERE … deleted_at IS NULL` (`lww.go:87`, unchecked `RowsAffected`) silently no-ops over tombstones,
    and `MarkRecordDeleted` re-stamps `CURRENT_TIMESTAMP` ignoring the payload (`lww.go:37`).
    **Review-4 (D28 completion):** a delete op arriving for a row the engine has ALREADY tombstoned also
    no-ops today (both primitives carry `AND deleted_at IS NULL`) — `syncProviderRecord` needs a third
    branch, a direct `UPDATE … SET deleted_at = <payload ts> WHERE id = ?` (payload verbatim, no re-stamp),
    or the newer payload `deleted_at` is silently dropped for that case.

   **Review-5 pins (caller audit — the five repos are shared):**
   - Implement verbatim timestamps via the in-tree **zero-check fallback** (`CreateConversationMessage`
     pattern, `messages.go:88-95`) — write the model's timestamp when non-zero, else default — NOT
     unconditional writes: create/duplicate build `models.Entity{}` without timestamps
     (`entity_controller.go:54-59`, `:292-299`), seeds likewise (`config/db/init.go:125-137`, `:280-305`),
     and management `UpdateEntity` fetch-then-updates with the stale `updated_at`
     (`entity_controller.go:338-361`) — unconditional verbatim writes would freeze management edits below
     the outbound watermark (alias edits never sync). Management `UpdateEntity` sets `UpdatedAt = now`
     before the repo call. Sync apply is unaffected (payloads always carry timestamps).
   - **D28 comparison base:** the config resurrect branch gates on
     `incoming ≥ max(existing.updated_at, existing.deleted_at)` — `MarkRecordDeleted` never bumps
     `updated_at` (`lww.go:37`), so the `:2207` gate (updated_at-only) drops resurrects whose `updated_at`
     falls between the tombstone's pre-delete `updated_at` and its `deleted_at`.
   - **D64:** config deletes keep today's LWW guard (they sit after `:2207`); D54-unconditional applies to
     row tables only — document the split.
3. **Rework the sync-apply entities case** — LWW with resurrect semantics (D4/D9):

   | existing state | incoming row | action |
   |---|---|---|
   | none | live or deleted | `CreateEntity` (insert; timestamps verbatim) |
   | live | newer live | `UpdateEntity` (unchanged behavior; timestamps verbatim) |
   | **tombstone** | **newer live** | **ROW-LEVEL RESURRECT (review 6 — D9's shared helper deleted with Phase 5/D75):** overwrite the entity row (`deleted_at = NULL`, incoming columns incl. verbatim timestamps, **`updated_at = max(incoming, engine-now UTC)` — D29**: the engine tombstone's `updated_at` is pre-delete while the app's is delete-time, so anything weaker can be dropped by the app's LWW gate at `SyncService.ts:1069`; clock-skew-safe by construction), run the shared zombie teardown (D24), refresh the entity cache. **No child-family matcher**: a lagging sender pushes the entity AND its child rows as individual records in the same session — each child resurrects through its own ghost-aware apply (step 4) under the same LWW rule; family completeness comes from the record stream, not from a matcher. |
   | tombstone | older/equal live | drop (tombstone wins, LWW unchanged — note the gate becomes inclusive `>=` per D29, matching the app) |
   | any | deleted (tombstone op) | existing soft-delete path **+ D24 additions**: stamps go through the unified captured-now helper (D25 — today each repo re-stamps its own now/CURRENT_TIMESTAMP: `entities.go:206`, `interactions.go:242-245`, `messages.go:166`, `memory.go:144`, `emoji_action.go:72`, **plus the profile/image sync deletes — review-4 D25 completion: `DeleteCharacterProfileForSync` + its image cascade (`character_profiles.go:258, 265`) and `DeleteCharacterImage` (`images.go:157`)**), and the apply runs the **shared zombie teardown + evicts active sessions** on the id (deletion must converge; nothing may stay attached to a tombstoned id — sessions/runners/emotion-engines). **Review 6: D17/D25 stamping survives as delete-path hygiene** — one captured `now`, `AND deleted_at IS NULL` guards, no re-stamp of already-tombstoned children (consistent family stamps are what let the repaired GC (1-2) purge whole families predictably; the restore matcher they originally served is deleted with Phase 5). **D54 (review 4): delete ops stay unconditional — no LWW guard** (a stale delete tombstones anyway; a newer live row resurrects per this table; the momentary teardown of a live runner by a stale delete is accepted — pinned by test). |

   - **D29 scope (review 4):** the inclusive `>=` applies to the row-vs-tombstone/entity gates ONLY — the
     `conversation_messages` field-scoped merge gate (`synchronization.go:1478-1484`) stays **strict
     `After`**; its echo-safety is documented as tie = no-op, and a naive global `>=` would break it.

   - Keep everything inside the same transaction; on success the entity-cache refresh
     (`synchronization.go:1633-1643`) now runs → in-memory map includes the resurrected entity.
4. **Sibling-table parity via a generic strategy helper (D39 — review-3 refactor; implementation shape
   amended review 4):** make
   `character_profiles`, `character_image`, `entity_module_mappings`, `interactions`, and
   `conversation_messages` ghost-aware by collapsing the **seven structurally identical switch cases**
   (entities, character_profiles, character_image, entity_module_mappings, interactions,
   entity_emoji_actions, memories) into one shared apply mechanism with a per-table strategy.
   **Review-4 shape: an interface-based strategy registry** (`map[string]applyStrategy` with
   fetch/create/update/tombstone/`deleteFallsThrough` + an optional `afterApply` hook for the
   RAG-capture and entity-cache side effects at `1600-1624`/`1633-1643`) — **preferred over
   `applySyncedRow[T]` generics**: the variance is in function fields, not types (all 7 models expose
   `ID/UpdatedAt/DeletedAt`, but the strategies differ in behavior, not shape), and the registry makes the
   side-effect hooks a single optional field instead of per-instantiation wiring. Unfiltered
   `…IncludingDeleted` fetch is a strategy field (precedent for the pattern: `GetMemory` `memory.go:114-119`,
   `GetEmojiAction` `emoji_action.go:10-16`, `GetChatConversationSetting` `chat_conversation_settings.go:35-41`),
   and the resurrect branch calls the shared D9 helper once. Three review-4 pins:
   - **Not-found normalization:** repos split conventions — some fetches return `(nil, err)` on
     `sql.ErrNoRows` (`entities.go:42`, `character_profiles.go:76`, `entities.go:370`, `memory.go:134`),
     others `(nil, nil)` (`interactions.go:92`, `emoji_action.go:19`, `messages.go:392`). Strategies must
     normalize "missing" or the resurrect branch misreads it as a DB failure.
   - **Mappings update excludes `deleted_at`:** `UpdateEntityModuleMapping`'s SET list has no
     `deleted_at` today — the mappings `update` strategy must keep excluding it, or a generic update would
     tombstone the row and break the D21-5 delete fall-through.
    - **D53:** emotion/lifecycle stay bespoke unconditional-replace and are NOT part of the shared
      resurrect matcher's guaranteed set.
    **Three review-5 pins:**
    - **Row-aware `tombstone` (delete-over-tombstone must no-op):** today's delete branches key on
      deleted-filtered fetches → tombstones invisible → silent no-op. With unfiltered strategy fetches a
      naive delete call would ERROR on `RowsAffected == 0` (`entities.go:217-219`,
      `character_profiles.go:276-278`, `entities.go:415-417`) or re-stamp a newer tombstone
      (`DeleteEmojiAction`, until its D25 guard lands). The strategy's tombstone func receives the fetched
      row and no-ops when `existing.DeletedAt.Valid` (preserves today's semantics and the D17 matcher's
      stamp integrity).
    - **`zeroRowsOK` per-table knob:** repo updates disagree on 0-rows semantics (`UpdateCharacterImage`
      `images.go:120-132` and `UpdateConversationMessageActions` `messages.go:137-162` succeed silently;
      `UpdateEntity`/`UpdateCharacterProfile`/`UpdateEntityModuleMapping` error) — the generic update
      strategy needs the flag or a uniform rule.
    - **Side-effect gating stays split:** the entity-cache refresh (`:1633-1643`, fires on every
      entities/mappings op) stays OUTSIDE the registry (keep the table-name gate); RAG captures fire on
      actual writes only (`:1374-1376` forbids conflict-skip re-ingest) AND on the resurrect branch (a
      resurrected memory's vector entry died with the tombstone). One `afterApply` hook cannot serve both
      semantics. The registry also rejects unknown table names loudly (today's `default: return nil` at
      `:1596` silently swallows typos).
    - **`conversation_messages` ghost-awareness pinned (review 5 — step 4's enumeration was contradictory:
      messages was listed as ghost-risk yet excluded from the seven-case collapse):** messages stays
      BESPOKE but still needs the fix: unfiltered fetch on the insert path, tombstone + newer incoming →
      full-row resurrect (`deleted_at = NULL`, verbatim columns), D29's inclusive `>=` applies to the
      tombstone comparison while the live field-scoped merge gate stays strict `After` (per the D29 scope
      note below), and the RAG `OnMessageUpdated` capture fires on resurrect (the merge path deliberately
      skips it, `:1481-1483`).
   **Four cases stay bespoke:** `conversation_messages` (field-scoped merge,
   `synchronization.go:1478-1484`), `emotion_state`/`lifecycle_state` (unconditional replace —
   newest-arrival-wins, ephemeral; document as intended, do NOT describe as LWW, D21-4; tombstones not
   durable per D53), `chat_conversation_settings` (incoming-wins-on-tie at 1571). Additional pins:
   - `DeleteEmojiAction` gains the `deleted_at IS NULL` guard it lacks today (D25) — a late child delete
     must not re-stamp an already-cascaded row.
   - Mappings delete→LWW fall-through echo (D21-5 extension): the pinned test must also pin that a
     mappings delete op applied *before* the entity op leaves the row live with a bumped `updated_at`,
     which the app's inclusive gate (`SyncService.ts:1069`) accepts — the mapping is effectively
     un-deleted app-side until the entity op lands. Document, don't "fix".
5. **Outbound payload requirement (H6 — enumerate the tag changes, review-2 finding)**: sync-out rows
   must always carry the `deleted_at` key (JSON `null` when live, **never omitted**) — the app's dynamic
   update set only writes keys present in the payload (`SyncService.ts:1073-1079`); an omitted key leaves
   the local tombstone untouched. Most sync models already comply; exactly **three** carry
   `json:"deleted_at,omitempty"` and omit the key when live — fix the tags on `InteractionSync`
   (`models/interaction.go:47`), `MemorySync` (`models/memory.go:34`), and `EntityEmojiActionSync`
   (`models/emoji_action.go:33`). (`created_at` is already always emitted by every sync model — verified.
Two device-record models also carry `deleted_at,omitempty` — `SyncDevice`/`SyncDeviceSync`,
`sync_device.go:28/:48` — but they are handshake payloads, not row-table sync; harmless to H6, noted for
completeness.)
6. **Error propagation**: a failed apply still produces a `SYNC_DATA_CONFIRM` with `status=ERROR` and a
   descriptive message (exists today); 1-3 adds engine-side logging. PK collisions should now be rare.

## Files to Modify

- `eventserver/synchronization.go` (entities apply case + sibling cases via the `applySyncedRow` helper +
  timestamp fidelity + payload keys + sync-delete teardown/eviction D24)
- `database/repository/entities/entities.go` (`GetEntityIncludingDeleted`; row-level resurrect per step 3 —
  the shared-with-5-1 helper is deleted with Phase 5, review 6)
- `database/repository/{characters,interaction,conversation}` + `character_image` for sibling-table parity
  (`…IncludingDeleted` fetches as strategy fields — see step 4)
- `database/models/{interaction,memory,emoji_action}.go` (the three `deleted_at` omitempty tag fixes)
- Config apply (`syncProviderRecord` resurrect/delete branching — D28; `id` stays stripped)

## Tests (engine, `go test ./...`)

- Insert-over-tombstone (incoming live newer) → row replaced, `deleted_at = NULL`, cache refreshed; a
  **family-of-rows** push (entity + children as individual records, the lagging-sender shape) resurrects the
  family via each table's own ghost-aware apply.
- Insert-over-tombstone (incoming older) → tombstone preserved, no error.
- Insert with fresh id → plain insert (regression).
- Resurrect followed by `INIT_ENTITY` for that entity id → session created (was `entity_not_defined`); greeting
  **not** re-delivered when prior (now live) history exists (D9 — guard stays live-only).
- **Sync-apply delete with a live engine session/runner/emotion-engine on the id → all torn down, session
  evicted (D24).**
- Verbatim timestamps: apply insert/update leaves `created_at`/`updated_at` equal to the incoming payload
  (incl. `character_profiles` + `character_image` — review-3 additions), **except** resurrect which writes
  `max(incoming, engine-now)` (D29).
- Sibling-table parity tests for `entity_module_mappings`, `interactions`, `conversation_messages`,
  `character_image` (6th table — review-3).
- Sync-out payload includes `deleted_at: null` key on live rows — **for all three fixed tables**
  (interactions, memories, emoji actions), not just entities.
- Mappings delete-branch fall-through pinned (D21-5, incl. the echo behavior); config tombstone applies
  inbound + resurrect-over-tombstone lands (D28). **Review-4 additions:** delete-op over an
  already-tombstoned config row applies the payload `deleted_at` (D28 third branch); stale
  delete-over-newer-live tombstones unconditionally (D54 pin — no LWW guard on delete ops).
- **Review-5 additions:** delete-op over an already-tombstoned ROW no-ops (no error, stamp unchanged —
  row-aware tombstone pin); management create/update still stamps `now` after the timestamp change
  (zero-fallback pin — seeds/duplicate/alias-edit paths); messages resurrect over tombstone (full-row, RAG
  capture fired); config resurrect gate uses `max(updated_at, deleted_at)` (a between-timestamps
  resurrect lands).

## Codebase Mapping Consulted

`harmony-link-private/.planning/codebase/` (STRUCTURE, CONVENTIONS), memory-bank `systemPatterns.toon`
(soft-delete pattern), senju record N1, plan review 2026-09-05.

## Checklist

- [x] `GetEntityIncludingDeleted` added (entities, character_profiles, character_image, entity_module_mappings, interactions, conversation_messages; all normalize "missing" to `(nil, nil)`)
- [x] Verbatim `created_at`/`updated_at` on apply (all re-stamping tables incl. character_profiles + character_image) — **zero-check fallback** (write non-zero model timestamps, else default), NOT unconditional; management `UpdateEntity`/`UpdateImageMetadata` stamp `now` themselves
- [x] Sync-apply entities case reworked; resurrect is **row-level** (D9 helper deleted with Phase 5 — review 6); `updated_at = max(incoming, engine-now)` (D29)
- [x] Sibling tables ghost-aware via generic `applySyncedRow` strategy registry (D39); sync-delete runs teardown + eviction (D24); delete stamps unified (D25); row-table delete ops unconditional (D54); config deletes keep the LWW guard (D64 — documented split)
- [x] Outbound payloads always carry `deleted_at` key (InteractionSync, MemorySync, EntityEmojiActionSync — H6)
- [x] Tests green (`go build`, `go vet`, `go test ./...` — **769/769 pass**; 12 new ghost-aware sync-apply suite tests + 4 config-table tests + H6 outbound + zero-fallback + resurrect→INIT_ENTITY)
- [x] Phase doc updated with deviations

## Implementation Notes (deviations)

> Resumed by a second agent on 2026-09-07 after the predecessor was cancelled when a test run hung. This section records what was found in the working tree (predecessor's work) vs. what this agent fixed/added. The record reflects both.

### Root cause of the predecessor's test hang (FIXED — this agent)

`TestNewDeviceWithExistingContent` (a character_profiles **insert** for a new profile) panicked with a nil-pointer dereference inside `applySyncedRow` → `deletedAtOf(existing)` (character_profiles strategy). The strategy `fetch` returns `(nil, nil)` for a missing row, but Go interface conversion wraps the repo's nil `*T` into a **typed nil** (`any` holding `(*models.CharacterProfile)(nil)`): `existing == nil` was `false`, the create branch was skipped, and the LWW columns were read off the nil pointer → panic. The panic then unwound through `WithTransaction`'s deferred `conn.Close()`, which deadlocked on the connection mutex (goroutine blocked 7+ minutes) → the `go test -timeout 8m` hang that killed the predecessor.

**Fix:** `normalizeMissing(existing any)` in `eventserver/synchronization.go` collapses any typed-nil pointer back to untyped nil immediately after the strategy fetch (one centralized point covers all seven tables; `memories` already returns explicit untyped nil). This is exactly the review-4 "not-found normalization" pin — the predecessor's repo-level `(nil, nil)` convention was defeated by Go's typed-nil interface semantics. The `conversation_messages`/`chat_conversation_settings` bespoke paths were NOT affected (they compare concrete pointer types, where `== nil` works).

### Predecessor work kept (audited correct)

- `GetEntityIncludingDeleted` + per-table `…IncludingDeleted` fetches, `Resurrect*` repo helpers (row-level, D29 `max(incoming, engine-now)` via `resurrectUpdatedAt`), zero-check fallbacks in every re-stamping repo, `syncProviderRecord` D21-1/D28/D64 branches, `UpdateRecordMapIncludingDeleted` (third-branch primitive), H6 tag fixes, D24 helpers (`RemoveEntityRuntimeState`, `EvictEntitySessions`), D25 `DeleteStampNow` routing, `DeleteEmojiAction` `deleted_at IS NULL` guard, management `UpdateEntity`/`UpdateImageMetadata` `now` stamps. **No corrections needed to the strategy registry's LWW-with-resurrect semantics.**

### `DeleteStampNow` final location

Canonical home is **`utils/delete_stamps.go`** (NOT `database/repository/entities/delete_stamps.go` as the phase handoff note reported). This is the right call: the consumer set spans `entities`, `characters`, `interaction`, `conversation`, `memory` repos and `eventserver` — a helper in the entities package would create an import cycle for the characters repo (whose test binary already imports entities). The 2-1b test `TestDeleteStampNow_CapturedUTCSecondTruncated` lives in `database/repository/entities/entities_test.go` and passes there. All consumers + tests are consistent at the `utils` location.

### Fixes this agent made (beyond the hang)

1. **Unknown-table loud rejection (review-5 pin) was implemented wrong.** The predecessor left the post-switch `return nil` in place; replacing it with an unconditional error broke every successful apply (Go switch cases fall through to the bottom return on success). Fixed: each of the seven registry cases now `return nil` after a successful `applySyncedRow`; the bottom error is only reachable for genuinely unknown tables (`sync apply: unknown table %q`) — covered by `TestSyncApply_UnknownTableRejectedLoudly`.
2. **Stale pre-H6 test contradicted the ruling.** `TestMemorySyncModelDeletedAtRoundTrip` (committed, pre-existing) asserted `deleted_at` is **omitted** when nil — the exact behavior H6 forbids. Updated to assert `deleted_at` is present as JSON `null` on live rows (and added `TestH6DeletedAtKeyAlwaysEmitted` covering all three fixed tables). This was a REAL contradiction between a pre-existing test and a user ruling; the ruling wins.
3. **Pre-existing flaky test de-flaked.** `TestHandleInitEntity_Resume_PendingEventsDelivered` failed intermittently under full-package load: `deliverPendingEvents` sleeps 500 ms by design before writing, and the test's `require.Eventually` window was 2 s. Widened to 5 s (test-only change; passed 3× and failed 2× under identical eventserver code, proving flake, not regression).

### Tests added by this agent (the phase doc's test list was NOT yet implemented — `synchronization_test.go` was untouched)

- 12 sync-suite tests (`TestSyncApply_*`): insert-over-tombstone newer → resurrect + cache refresh; older → tombstone preserved; fresh id → plain insert; family-of-rows push resurrects (entity+profile+mapping+interaction+message); sync-apply delete tears down runner/session/cognition + evicts sessions (D24); delete-over-tombstoned row no-ops (review-5); stale delete-over-newer-live tombstones unconditionally (D54); mappings delete falls through live with bumped `updated_at` (D21-5); messages resurrect fires RAG capture; resurrect then INIT_ENTITY resolves + greeting NOT re-delivered over prior live history (D9 live-only); unknown table rejected loudly; verbatim timestamps across all six tables.
- 4 config tests (`TestSyncProviderRecord_*`): payload `deleted_at` applied verbatim (D28); resurrect over tombstone; delete over already-tombstoned config row (D28 third branch); resurrect gate uses `max(updated_at, deleted_at)`.
- `TestManagementUpdateEntityStampsNow` (zero-fallback pin), `TestH6DeletedAtKeyAlwaysEmitted` (outbound `deleted_at: null`).

### Deviations / notes

- **Config resurrect gate wording:** the doc's "a between-timestamps resurrect lands" was read as the *drop* case being pinned (incoming between pre-delete `updated_at` and `deleted_at` is dropped by the `max()` gate) plus the ≥-deleted_at case landing — matching the D28/D29 semantics as implemented. Both branches are asserted in `TestSyncProviderRecord_ResurrectGateUsesMax`.
- **D24 emotion-engine assertion:** post-sync-delete, `EnsureEmotionEngine` correctly returns nil (the entity-cache refresh has dropped the tombstoned entity from `config.ApplicationConfig.Entities`, so the Q8/Q9 gate refuses) — the engine removal itself is covered by the existing `TestRemoveEntityRuntimeState_TearsDownZombieState`. The sync-apply test asserts the runner/cognition/session teardown signals instead.
- **`character_image` NOT NULL `image_data`:** the verbatim-timestamps test supplies bytes; an app-synced live image with no bytes fails the NOT NULL constraint (pre-existing schema; unchanged).
- **Rename deletion (2-1b, D22):** `gitnexus_detect_changes` reports CRITICAL risk with `HandleRenameEntity`/`RenameEntity` processes affected — expected (rename is deleted per D22/D23; the plan's blast radius). Not a regression.
- Phase 1-2 owns `handleSyncFinalize` / `maintenance.go` — untouched (the sync-finalize cleanup code at `synchronization.go:2204-2249` was not modified by this phase).
