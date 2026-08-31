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

## 4. Per-table initial backfill (Q7, engine side)

- `sync_devices` += column `synced_tables TEXT NOT NULL DEFAULT '[]'` — **migration needed**: this is an
  engine-LOCAL infra table (not synced, not in the app schema) → a Go-only migration `000043_synced_tables_registry`
  with an **app-side reserved no-op placeholder `000043`** (000039 convention: comment-only app migration keeping
  the 1:1 number mirror; document in both headers).
- Contract: in `sendLocalChanges`, for each registered table NOT in the device's `synced_tables` set → fetch with
  `since = 0` (full table) and the size-estimate counts it likewise; at `handleSyncFinalize` (:1671-1739) add all
  current registered tables to the set. Stale sets (tables later removed) are pruned at finalize.
- The apply side needs no backfill concept (inbound rows apply via LWW regardless).
- Registry hygiene: `sync_devices` grows the `synced_tables` column → **ADD** the `table:sync_devices` entry to
  `scripts/parity-allowlist.json` in the same commit (reason: "engine-local `synced_tables` column — sanctioned
  by §9-A9"; the old "comments" reason is moot post-§9-A8). This is the one sanctioned allowlist addition of
  Phase 2 — end state = 2 entries.

## Tests (TDD — red → green)

- **RED first**: sync exchange tests (insert/update/LWW-tie/tombstone for both tables) + backfill tests (device
  without `synced_tables` entry receives full table ONCE, then incremental; second device unaffected; finalize
  records the set) — fail before the cases/models exist.
- Migration: up/down + rollback suite green (`go test ./database/...`) — snapshot-style, runs after authoring.

## Verification

- [ ] `go build ./...`; `go test ./...` green
- [ ] Lockstep check: fetch list ↔ countChanges list ↔ app upload list contain the same two tables
- [ ] `gitnexus_impact` on `sendLocalChanges`/`handleSyncData` before editing; `gitnexus_detect_changes()` before committing
