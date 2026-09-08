# 1-3 — Engine: Sync Observability & Session Hygiene

## Objective

Make sync apply failures visible and clean up stale sync sessions — both surfaced by the incident (the failing
insert was invisible in logs; session `sync_44be981ca4cfc0dc_1788599686` is stuck `in_progress` forever).

## Context

- `SYNC_DATA` apply errors travel only in the `SYNC_DATA_CONFIRM` payload
  (`eventserver/synchronization.go:1644-1674`) and are never logged engine-side.
- `activeSyncs`/`sync_history` sessions are never reaped: aborted app sessions remain `in_progress`
  (live DB: session id 854 `in_progress` from 11:14:46).
- `entity_not_defined` is emitted as a bare error with no entity id context at **two** sites:
  `eventserver/eventprocessor.go:196-199` (INIT_ENTITY) and `eventprocessor.go:769` (resume path) — surfaced as
  a bare `h.logger.Warn(handlingError)` in `handler_websocket.go:202`, making diagnosis harder than necessary.
  Cover both.

## Implementation Steps

1. **Log apply failures**: in the SYNC_DATA apply error branch, log
   `level=warn msg="Sync data apply failed" table=... operation=... entityId/pk=... err=... component=sync`
   (keep the confirm payload as the transport to the app). **Review-2 addition (pairs with 4-2/D13):** the
   confirm error payload gains a **structured error code field** (today it is string-only) so the app can
   classify `SyncConflictError` vs transient — e.g. `error_code` alongside `error_message`.
   **Review-3 extension (D35):** the same structured `error_code` is added to the **INIT_ENTITY ERROR
   payload** (`entity_not_defined`, `entity_disabled`, plus the new `entity_exists_deleted` from step 4)
   — the app currently matches free-text error strings (`EntitySessionService.ts:34/1777`), which is
   brittle by design; 4-3 consumes the codes.
2. **Stale session reaping**: on sync finalize failure paths and on new `SYNC_REQUEST` from the same device,
   mark/replace orphaned `in_progress` sessions for that device (or add a TTL sweep at startup). Ensure
   `lastSync` watermark for the device is only advanced on successful finalize (already true by
   construction — `device.LastSyncTimestamp` advances on successful finalize only).
   **Review-2 fix (D21-2):** `handleSyncFinalize` currently resolves the history row via
   `GetActiveSyncSession(deviceID)` (`synchronization.go:1841` → `history.go:94-116`), which returns the
   *most recent* `in_progress` row — with a stuck prior session (the incident's exact state) finalize marks
   the **stale** row. Finalize must update **its own** session row (by sessionID).
   **Review-4 implementation (unblocks D21-2):** `sync_history` has **no session-id column**
   (`history.go:12-37` — only `device_id, sync_started_at, sync_status, created_at`) and the WS-level
   `SyncSessionID` is never persisted, so "update by sessionID" is unimplementable as written. Cheapest
   fix: thread `history.ID` (already in hand at `handleSyncRequest:478-491`) onto the in-memory
   `SyncSession`; finalize then updates by that id directly, and reaping on a new SYNC_REQUEST from the
   device becomes one `UPDATE sync_history SET sync_status='failed' WHERE device_id = ? AND
   sync_status='in_progress' AND id != ?` — no schema migration, no `(device_id, sync_started_at)`
   matching hack. **Also reap the in-memory `activeSyncs` map on WS disconnect** — `shutdown()`
   (`handler_websocket.go:67-90`) never touches it; only FINALIZE/CANCEL/ERROR remove entries today, so a
   mid-sync disconnect leaks the entry for process lifetime (review-4 finding).
3. **Enrich `entity_not_defined`** (both emission sites: `eventprocessor.go:196-199` and `:769`): include the
   requested `entity_id`, handler id and session params in the log line (`handler_websocket` component). No
   protocol change.
4. **Optional (small)**: emit a distinct error code (`entity_exists_deleted`) if the INIT_ENTITY id exists but
    is tombstoned — helps the app give an actionable message (diagnostic only post-review-6: no restore
    exists (D75); the message should guide the user to recreate instead).

## Files to Modify

- `eventserver/synchronization.go` (apply-error logging, session reaping)
- `eventserver/eventprocessor.go` / `handler_websocket` (error context)
- `database/repository/synchronization/` (session update helpers, if needed)

## Tests

- Apply failure produces a warn-level log (assert via log hook or extract logger seam).
- New SYNC_REQUEST from device with an `in_progress` session → old session finalized/failed, no leak.
- Finalize with a stuck prior `in_progress` session → **the current** session's row is the one updated (D21-2).
- Mid-sync WS disconnect → the in-memory `activeSyncs` entry is reaped (review-4; `shutdown()` path).
- Confirm error payload carries the structured `error_code` field (4-2/D13 dependency); **INIT_ENTITY
  ERROR payload carries `error_code` too (D35) — app matches codes, not message strings.**
- `entity_not_defined` log line contains entity id.

## Checklist

- [x] Apply-failure logging added
- [x] Session reaping implemented
- [x] INIT_ENTITY error enrichment
- [x] Optional distinct tombstone error code
- [x] Tests green; phase doc updated

## Implementation Notes (deviations)

Implemented all steps 1–4 (engine repo `harmony-link-private`, branch
`feat/engine-track-phase2`, uncommitted alongside phases 2-1b/1-1/1-2).

- **Step 1 — apply-failure logging + `error_code`.** The warn line is emitted
  with logrus structured fields exactly per spec:
  `msg="Sync data apply failed" table=… operation=… entityId=… err=… component=sync`
  (+ the session's existing `sessionId` field). `entityId` is extracted
  generically from the record JSON via a small probe (`id` → `entity_id` →
  `participant_key`) — covers the row tables plus the ephemeral/settings rows.
  `SyncDataConfirmPayload` gained `error_code` with `omitempty` (absent on
  SUCCESS; old-engine representable). Classifier: `sync_conflict` when the
  lowered error string contains `constraint` (the sqlite error string class —
  covers the incident's `UNIQUE constraint failed: entities.id`, plus FK/NOT
  NULL/CHECK), `apply_failed` otherwise. PINNED strings:
  `sync_conflict` / `apply_failed` (constants `SyncErrorCodeConflict` /
  `SyncErrorCodeApplyFailed`).
- **Step 2 — session hygiene.** `sync_history` has no session-id column, so
  per review-4 the in-memory `SyncSession` gained `HistoryID int64`
  (populated at `handleSyncRequest` from `history.ID`, set by
  `CreateSyncHistory`'s `LastInsertId`). `handleSyncFinalize` now updates
  **its own** history row by `HistoryID` (D21-2) instead of
  `GetActiveSyncSession(deviceID)`; a missing id (never happens via the
  request path) logs a warn and skips. New `FailOrphanedInProgressSessions`
  (exact pinned SQL + `deleted_at IS NULL` guard + `updated_at` bump) runs in
  the SYNC_REQUEST tx after the fresh row is created — reaps the incident's
  stuck `in_progress` row. `shutdown()` now calls a new
  `SynchronizationHandler.ReapActiveSyncs()`: clears the in-memory map AND
  marks the in-flight history rows failed (best-effort tx; a DB failure only
  logs). `device.LastSyncTimestamp` advances on successful finalize only —
  unchanged by construction, verified.
- **Step 3 — `entity_not_defined` enrichment.** Both emission sites
  (`handleInitEntity` + `resumeEntitySession`) log a warn line carrying
  `entityId`, `handlerId`, `deviceId`, `participantIds`; the websocket
  `OnEventProcessed` echo additionally gains the entity id via
  `WithField("entityId", …)` for INIT_ENTITY errors. No protocol change beyond
  step 4's code field.
- **Step 4 — INIT_ENTITY `error_code` (D35).** New `initEntityError{Code,
  Message}` type; `OnEventProcessed` builds a structured ERROR payload
  `{ error, error_code }` for INIT_ENTITY (free-text `error` retained for
  old-engine string-matching fallback; `error_code` omitted when the error
  carries none). PINNED codes: `entity_not_defined`, `entity_disabled`, and
  new `entity_exists_deleted` (constant `ErrEntityExistsDeleted`) emitted when
  the requested id exists in the DB but is tombstoned — detected via a new
  tombstone-aware fetch (`controllers.GetEntityIncludingDeleted` →
  `config/db.GetEntityIncludingDeleted`); message guides the user to recreate
  (no restore exists — D75). Fresh + resume sites both covered.
- **Deviations / observations:**
  1. `GetActiveSyncSession` (repo + controller facade) is now **unused by the
     event server** but **kept** — the controller facade still wraps it and
     deleting a public repo API was out of scope; the phase doc's
     "repository/synchronization/ (session update helpers, if needed)" slot
     was filled with the two new helpers instead. `go vet` does not flag the
     repo-level function (exported, referenced by the facade).
  2. **`go test ./... -count=1 -timeout 60s` trips the eventserver per-package
     timeout (60.09s)** — measured 63.5s for eventserver WITHOUT this phase's
     tests on the current machine (the pre-existing suite alone was already at
     59.6s on a faster pass), +~1s with the new tests. The full repo is green
     with `-timeout 90s` (eventserver 63.3s). Recommend bumping eventserver's
     package timeout to 90s for the pinned repo-wide command; this is a
     pre-existing knife-edge, not a regression from this phase.
  3. The new tests were consolidated into 2 suite methods + 3 plain tests
     (with subtests) to minimize added DB-setup time in the eventserver
     package (5 test functions / 7 subtests total added).
  4. `recordIdentifier` returns `""` for records without any of the three
     probed keys (e.g. some config rows) — the log line still carries
     table/operation/err, which is the diagnosable core.
