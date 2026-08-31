# 4-2 — Engine Sync Registration + Per-Table Initial Backfill

> Phase 4 / repo: **harmony-link-private**. Contract: `21-Engine-Contract` §4.1–§4.3, Q5/Q6/Q7.
> Prerequisite: Phase 1 (schema) + 4-1 shape decisions (column types).

## Objective

The engine-side 7-step recipe for both new tables + the per-device initial-backfill contract.

## 1. Models (`database/models/`)

- `CharacterFavorite{Sync}` pair + `ChatConversationSetting{Sync}` pair with `ToSyncModel`/`ToDBModel`
  (template: `models/entity.go:9-70`). JSON keys = app column names. Types: favorites `ProfileID string`;
  **timestamps as `time.Time`/`*time.Time`** (the columns are TIMESTAMP-labeled so the driver returns `time.Time` —
  string pointers would scan but re-format to RFC3339Nano on every round-trip; `time.Time` lets binding normalize);
  settings `ParticipantKey`, `EntityID *string`, `Pinned/Archived` (match 4-1's
  boolean decision — prefer `int64` 0/1 to avoid JSON bool friction), `ReplyMode string`,
  watermark triple. Add `convertToSyncModel` cases (`synchronization.go:2275-2517`).

## 2. Query constants (`database/sync_utils.go`)

- `queryGetChangedCharacterFavorites` / `queryGetChangedChatConversationSettings` using `whereChangedSince`
  VERBATIM (:19-21) + `GetChanged<X>(tx, since)` funcs (pattern :242-247 + :456-485). PK field in ORDER BY/pk
  selection: `profile_id` / `participant_key`.

## 3. Send plumbing (`eventserver/synchronization.go`)

- `sendLocalChanges` (:594-1161): fetch + `DetermineOperation` + `sendSyncDataWithConfirmation` blocks — favorites
  after `character_profiles` step, settings after `conversation_messages` step (FK order, matching 4-1).
- `sendSizeEstimate` `countChanges` list (:1811-1848) gains both tables — MUST stay lockstep with the fetch list
  (comment :1779-1783 warns).
- Apply switch `handleSyncData` (:1252-1459): two new cases — both tables are **row-LWW by `updated_at`, ties →
  incoming** (Q §4.2; provider-config precedent :2063-2065): no existing → create; newer inbound → update;
  `delete` op → soft-delete tombstone.
- Cleanup: extend soft-delete cleanup scope if tombstones should hard-purge (follow `lifecycle_state` precedent —
  include both tables).

## 4. Per-table initial backfill (Q7, engine side) + paired app 000043 (§9-A14)

- `sync_devices` += column `synced_tables TEXT NOT NULL DEFAULT '[]'` — **migration needed**: engine migration
  `000043_synced_tables_registry`, authored in lockstep (§9-A11) with the **paired REAL app migration `000043`**
  (see below). ~~Engine-LOCAL table not in the app schema~~ — **corrected by §9-A14**: `sync_devices` (and
  `sync_history`) DO exist app-side as mistakenly-ported mirrors with a ZERO-caller repo
  (`src/database/repositories/sync.ts`); the pairing deliberately makes them Go-only.
- **App-side `000043` (repo: harmony-ai-app, same lockstep session)**: `DROP TABLE IF EXISTS sync_devices;
  DROP TABLE IF EXISTS sync_history;` + **delete `src/database/repositories/sync.ts`** (all six fns verified
  dead — zero callers) + remove the `SyncDevice`/`SyncHistory` model types from `src/database/models.ts` +
  register in `src/database/migrations.ts` (version 43) + regenerate migration snapshots + `schema/rn-schema.json`.
  Dev-DB note: devices that already synced keep orphaned empty tables until wiped — harmless, covered by the
  extended wipe note. Both headers cross-reference their pair.
- Contract: in `sendLocalChanges`, for each registered table NOT in the device's `synced_tables` set → fetch with
  `since = 0` (full table) and the size-estimate counts it likewise; at `handleSyncFinalize` (:1671-1739) add all
  current registered tables to the set. Stale sets (tables later removed) are pruned at finalize.
- The apply side needs no backfill concept (inbound rows apply via LWW regardless).
- Registry hygiene (§9-A14): with the app drops, `sync_devices` AND `sync_history` become **Go-only** → in the
  same commit **CONVERT** the interim `table:sync_history` different-SQL entry to Go-only and **ADD**
  `table:sync_devices` Go-only to `scripts/parity-allowlist.json` (reason: "engine-local sync-infra table, app
  copy was dead code and dropped — sanctioned by §9-A14"). End state = **3 uniform Go-only infra entries**
  (`device_push_tokens` + `sync_devices` + `sync_history`).

## Tests (TDD — red → green)

- **RED first**: sync exchange tests (insert/update/LWW-tie/tombstone for both tables) + backfill tests (device
  without `synced_tables` entry receives full table ONCE, then incremental; second device unaffected; finalize
  records the set) — fail before the cases/models exist.
- Migration: up/down + rollback suite green (`go test ./database/...`) — snapshot-style, runs after authoring.
- App 000043: snapshot regen; app migration tests green; tsc 0 (repo + models deleted cleanly).

## Verification

- [ ] `go build ./...`; `go test ./...` green
- [ ] App: tsc 0, `npm test` green; grep `sync_devices|sync_history|createSyncDevice|createSyncHistory` in
      `src/` → zero (outside migration files); snapshots + `rn-schema.json` regenerated
- [ ] Lockstep check: fetch list ↔ countChanges list ↔ app upload list contain the same two tables
- [ ] Local parity compare (both sides of 000043 exist locally — §9-A11): output = EXACTLY the allowlist =
      3 Go-only entries; `sync_devices`/`sync_history` absent from the RN dump
- [ ] `gitnexus_impact` on `sendLocalChanges`/`handleSyncData` before editing; `gitnexus_detect_changes()` before committing (both repos)
