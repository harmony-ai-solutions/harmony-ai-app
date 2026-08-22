# Phase 3-3: Lifecycle-Worker Drop Gate

**Repo:** `C:\Users\sge20\go\src\github.com\harmony-ai-solutions\soulbits-cloud-backend`
**Files:** `cmd/lifecycle-worker/job.go`, `cmd/lifecycle-worker/job_test.go`

> ⚠️ Run `gitnexus_impact({target: "executeJob", direction: "upstream"})`
> before editing (AGENTS.md rule) and include the result in your report.

## Objective

A lifecycle beat (or lookahead session) for a user whose data is being purged
must Ack-and-drop: no download, no op, no upload, **no re-arm** (a re-arm would
resurrect the beat chain the purge just removed). This is the third
defense-in-depth layer alongside the snapshot lease and the due-ZSET cleanup.

## Context

- `cmd/lifecycle-worker/job.go` `executeJob` runs steps 1–14 (session gates,
  lease, DEK, download, op, upload, reschedule, lookahead). Failure paths call
  `rescheduleOnFailure` — the purge drop must NOT go through it.
- The worker's Valkey client is `deps.vc` (*valkey.Client). Phase 2-2 provides
  `session.IsDataPurgeActive(ctx, vc, userID)`.

## Implementation

Add **step 0** at the top of `executeJob`:

```go
// 0. DATA PURGE GATE — a purge flag means the user's cloud data is being
// deleted. Ack and drop WITHOUT re-arm: the purge removes the user's
// due:lifecycle members; a re-arm here would resurrect the chain.
if purging, err := session.IsDataPurgeActive(ctx, deps.vc, job.UserID); err != nil {
    // Transient Valkey error: treat like other gate errors — normal error
    // path (Nack + re-arm) so the beat is not lost. Never fail open into
    // an upload during a possible purge.
    return fmt.Errorf("lifecycle: data purge check: %w", err)
} else if purging {
    log.Info().Str("user_id", job.UserID).Str("job_id", job.JobID).
        Msg("lifecycle: dropping beat — user data purge in progress")
    if deps.metrics != nil {
        deps.metrics.dataPurgeDroppedBeats.Inc() // add counter alongside existing worker metrics
    }
    return nil // Ack, no re-arm, no upload
}
```

Add the `dataPurgeDroppedBeats` counter (promauto) wherever the worker's other
metrics live (find `snapshotDownloads` for the pattern).

Also check `runLookaheadSession` (same package): the cached-beat path
(`runGatedBeat`) re-acquires the lease per beat — add the same flag check to
its gate sequence so a purge starting mid-lookahead stops the session cleanly
(its cache artifacts are local-only; dropping is safe).

## Tests (extend `job_test.go` — stub patterns exist there, incl. a fakeS3Server)

- flag set → `executeJob` returns nil; stubs assert: NO S3 download, NO upload,
  NO `due:lifecycle` ZAdd (re-arm), lease never acquired.
- flag check error (valkey stub errors) → returns error (goes to normal
  re-arm path).
- flag absent → existing behaviour unchanged (run one existing test to confirm
  no regression).

## Verification

```powershell
go build ./...
go test ./cmd/lifecycle-worker/... -v
```

## Commit

Part of the Phase 3 commit: `feat(session-broker): user-initiated data purge (endpoint, hard-kill, gates, sweeper)`

## Checklist

- [ ] gitnexus impact on executeJob run first
- [ ] Step-0 gate + lookahead gate added with metric
- [ ] Tests: drop (no side effects), error path, no-flag regression
- [ ] `go test ./cmd/lifecycle-worker/...` green
