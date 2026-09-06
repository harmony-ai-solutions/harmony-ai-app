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
   is tombstoned — helps the app give an actionable message (pairs with 5-1 restore).

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

- [ ] Apply-failure logging added
- [ ] Session reaping implemented
- [ ] INIT_ENTITY error enrichment
- [ ] Optional distinct tombstone error code
- [ ] Tests green; phase doc updated
