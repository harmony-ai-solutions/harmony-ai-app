# Phase 3-1: Migration 000027 + `purged` Session Status

**Repo:** `C:\Users\sge20\go\src\github.com\harmony-ai-solutions\soulbits-cloud-backend`
**Files:** `db/migrations/000027_add_purged_session_status.{up,down}.sql`, `pkg/session/session.go`, `cmd/session-broker/db/sessions.go` (+ tests)

## Objective

A terminal session status `purged` so background loops (grace-period manager,
dead-task detector, sweepers) skip purged sessions instead of fighting the
purge, and a store method to transition a user's non-terminal sessions in one
statement.

## Context

- `sessions.status` is constrained by CHECK `sessions_status_check` — pattern
  for expanding it is migration `000020_add_provisioning_session_states.up.sql`
  (drop + recreate constraint). Current allowed values:
  `provisioning, ready, active, grace_period, snapshotting, terminated, failed`.
- Status constants live in `pkg/session/session.go`
  (`SessionStatusProvisioning` … `SessionStatusFailed`).
- Store methods live in `cmd/session-broker/db/sessions.go` — read it first and
  follow its query style (gorm raw / sqlx patterns as used there).
- Latest migration is `000026` → new one is `000027`.

## Changes

### `000027_add_purged_session_status.up.sql`

```sql
-- Migration: 000027_add_purged_session_status
-- Description: Add terminal 'purged' status for user-initiated data purge.

BEGIN;

ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_status_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_status_check
  CHECK (status IN ('provisioning','ready','active','grace_period','snapshotting','terminated','failed','purged'));

COMMIT;
```

`.down.sql` mirrors it (recreate without `'purged'`). Follow 000020's exact
header/comment style.

### `pkg/session/session.go`

```go
SessionStatusPurged SessionStatus = "purged"
```
Add next to the existing constants. Grep for exhaustive status switches
(handlers' `respondSessionState`, store, lifecycle) — purged is terminal and
never returned by connect flows; verify no switch needs a case (a missing case
must compile — Go switches without `default` are fine).

### `cmd/session-broker/db/sessions.go`

```go
// MarkSessionsPurged transitions ALL of the user's non-terminal sessions to
// the terminal 'purged' status. Returns the number of rows transitioned.
func (s *Store) MarkSessionsPurged(ctx context.Context, userID string) (int64, error)
```
One UPDATE: `SET status='purged', ended_at=now(), updated_at=now() WHERE user_id=$1
AND status IN ('provisioning','ready','active','grace_period','snapshotting')`.
Match the file's existing parameter/scan conventions.

### Tests

- Store test following the existing db test setup in that package (see how
  UpdateSessionStatus / ClaimGracePeriod are tested — same harness): user with
  sessions in `active` + `terminated` → MarkSessionsPurged → only active flips,
  `ended_at` set, `terminated` untouched.
- If the package's tests need Postgres and none is wired locally, keep the test
  behind the same build tag/skip the existing tests use — DO NOT invent a new
  container harness; e2e (Phase 7) covers it live.

## Verification

```powershell
go build ./...
go test ./cmd/session-broker/... ./pkg/session/...
```

## Commit

Part of the Phase 3 commit: `feat(session-broker): user-initiated data purge (endpoint, hard-kill, gates, sweeper)`

## Checklist

- [ ] Up + down migration written (000027), constraint includes 'purged'
- [ ] `SessionStatusPurged` constant added; repo builds
- [ ] `MarkSessionsPurged` implemented + tested per existing harness
- [ ] No background loop treats 'purged' as live (grep status IN (...) queries)
