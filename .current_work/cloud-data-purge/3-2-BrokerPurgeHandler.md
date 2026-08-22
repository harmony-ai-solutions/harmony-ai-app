# Phase 3-2: Broker Purge Handler + Connect/Provisioning Gates + Resume Sweeper

**Repo:** `C:\Users\sge20\go\src\github.com\harmony-ai-solutions\soulbits-cloud-backend`
**Files:** `cmd/session-broker/handlers/handlers.go`, `cmd/session-broker/handlers/handlers_test.go`, `cmd/session-broker/main.go`, `cmd/session-broker/provisioning/provisioning.go`, new `cmd/session-broker/datapurge_sweeper.go` (+ test)

> ⚠️ Read phases 2-1/2-2/2-3 first — this phase consumes
> `session.DeleteUserSnapshot`, the `datapurge.go` helpers, and
> `keystore.DeleteUserKey`. Run `gitnexus_impact` on `Handler.Connect` and the
> provisioning ready-flip before editing them (AGENTS.md rule) and
> `gitnexus_detect_changes` before committing.

## Objective

The purge endpoint itself, the defense-in-depth connect/provisioning gates, and
the restart-safe resume sweeper.

## Handler — `DeleteSessionData(w, r)`

### New seams on `handlers.Handler` (testability — follow the existing
interface-field style of `ValkeyClient`/`SessionStore`):

```go
// SnapshotPurger permanently deletes a user's S3 data (all versions).
// Production impl wraps session.DeleteUserSnapshot.
type SnapshotPurger interface {
    DeleteUserSnapshot(ctx context.Context, bucket, userID string) (objects, versions int, err error)
}
// KeyStoreDeleter removes the per-user DEK (subset of keystore.KeyStore).
type KeyStoreDeleter interface {
    DeleteUserKey(ctx context.Context, userID string) error
}
// TaskKiller force-stops a session task WITHOUT the graceful stop command
// (no final snapshot upload). The lifecycle shutdown coordinator's ECS
// force-stop fallback already has this — find the exact method on
// warmpool.ECSClient / lifecycle.ShutdownCoordinator via gitnexus and adapt.
type TaskKiller interface {
    ForceStopTask(ctx context.Context, taskID string) error
}
```

New fields: `S3 SnapshotPurger`, `S3Bucket string`, `Keys KeyStoreDeleter`,
`Tasks TaskKiller`, `KillConfirmTimeout time.Duration` (default 10s),
`PurgeFlagTTL time.Duration` (default `session.DefaultDataPurgeFlagTTL`),
plus a valkey-client handle for purge-flag calls — extend the existing
`ValkeyClient` interface with `GetDataPurgeFlag/SetDataPurgeFlag/...` OR add a
second narrow interface; follow whichever keeps the `valkeyWrapper` in main.go
cleanest.

### Flow (exact order — each numbered step is a `Phase` marker written to the flag)

1. Auth → userID. Decode body; `confirm != "DELETE"` → 400 `{"error":"confirmation_required"}`.
2. `GetDataPurgeFlag` — if present → 200 `{"status":"in_progress","request_id":...}` (idempotent concurrent call; NO side effects).
3. **Set flag first** (`SetDataPurgeFlag` with fresh requestID + registry ZAdd). This is the guard everything else checks.
4. Acquire snapshot lease with **bounded wait**: retry `valkey.AcquireSnapshotLease` every 250ms up to ~3s, holder `purge-<uuid>`. Not acquired → delete flag + registry → 409 `{"error":"snapshot_busy","retry_after_ms":3000}`. On success defer release on `context.Background()`.
5. **Kill**: list the user's non-terminal sessions (`GetProvisioningSession` catches one; for ALL rows add a store method `GetNonTerminalSessionsByUserID` next to `MarkSessionsPurged`). For each with an ECS/Docker task ID: `TaskKiller.ForceStopTask` (NO stop command — the sidecar must never run its graceful upload). Then poll task death (heartbeat gone / docker container gone — reuse `IsTaskAlive` + killer's confirm) until `KillConfirmTimeout` → on timeout: 503 `{"error":"kill_unconfirmed"}` and LEAVE the flag + registry for the sweeper (do NOT release yet — the sweeper owns it now; return after releasing only the lease).
6. `MarkSessionsPurged` (Phase 3-1).
7. Clean Valkey per killed task/user: `DeleteSessionEndpoint(userID)`, `DeleteProvisioningState(userID)`, `DeleteTaskUserMapping(taskID)`, cert fingerprint + heartbeat keys (session pkg helpers), warm-pool membership removal if the task was pooled (`RemoveFromWarmPool`/`RemoveActiveTask` — mirror what disconnect-path cleanup does; grep lifecycle teardown).
8. `S3.DeleteUserSnapshot(bucket, userID)` → counts.
9. `RemoveUserLifecycleMembers(userID)` → count.
10. `Keys.DeleteUserKey(userID)` → `dekDeleted=true` on nil.
11. Verify: re-list prefix (0 objects), `GetUserKey → ErrKeyNotFound` optional (keystore may be nil in tests), re-scan ZSET. On verify failure → log + metric + leave flag for sweeper, still 503.
12. `DeleteDataPurgeFlag` + `UnregisterDataPurge` + release lease + metrics + audit log (zerolog Info with user_id, request_id, counts, duration_ms — "session: data purge completed (user-initiated)") → 200 `{"status":"deleted", counts...}`.

Extract steps 3–12 into a shared `runDataPurge(ctx, userID, requestID) (result, error)` used by BOTH the handler and the sweeper.

### `Connect` gate (edit `Connect`)

Immediately after `authCtx` extraction, before the device gate:
`IsDataPurgeActive` → 409 `{"error":"purge_in_progress","retry_after_ms":5000}`.
Transient Valkey error → 503 (never fail open).

### Provisioning gate (edit `provisioning.Provisioner`)

Before flipping a session to `ready` (find the transition in
`cmd/session-broker/provisioning/provisioning.go`): re-check
`IsDataPurgeActive(userID)` → if active: force-stop the task, mark the session
`failed` with `FailureReason: "purge_in_progress"`, do NOT write the Valkey
endpoint/provisioning state. This closes the race of a connect that passed the
entry gate a ms before the flag was set.

### Route wiring (`main.go`)

In the authenticated group:
```go
r.Post("/session/data/delete", handler.DeleteSessionData)
```
Wire the new Handler fields: `S3: &s3SnapshotPurger{client: s3SDKClient}` (build
the client in BOTH Docker and AWS modes — it already exists in both branches),
`S3Bucket: cfg.S3SessionsBucket`, `Keys: keyStore`, `Tasks: <adapter over
ecsImpl — find force-stop>`, timeouts from env
(`DATAPURGE_KILL_TIMEOUT_SEC`, `DATAPURGE_FLAG_TTL`) with defaults.

### Sweeper (`cmd/session-broker/datapurge_sweeper.go`)

- Started in main.go alongside the other background loops (`Start(ctx)`/`Stop()`
  like deadTaskDetector). Interval 30s.
- `ListDataPurgeRegistry` → for each userID: `Attempts++` on the flag,
  `runDataPurge(ctx, userID, existingRequestID)` (resume = re-run; every step
  idempotent). Success → clear flag/registry. Attempts ≥ 5 → give up:
  clear flag + registry (unblock connect), `session_data_purge_failures_total`
  + Error log with request_id (alertable).
- Sweeper ctx: `context.Background()`-derived with per-user timeout
  (KillConfirmTimeout + 30s) — must survive broker-request cancellations.

### Metrics

Counters on the existing registry (`observability.NewRegistry()` pattern):
`session_data_purges_total`, `session_data_purge_failures_total`,
`session_data_purge_resumes_total`.

### Handler tests (extend `handlers_test.go`, stub style already used there)

- wrong/missing confirm → 400.
- pre-existing flag → 200 in_progress, NO purge side effects (stubs not called).
- happy path: stubs return fixed counts → 200 deleted, calls in order
  (kill → mark purged → s3 → beats → dek), flag deleted, lease released.
- snapshot_busy: lease acquire fails → 409, flag cleaned up.
- kill timeout: TaskKiller poll never confirms → 503 kill_unconfirmed, flag left
  (assert NOT deleted).
- connect gate: flag set → Connect returns 409 purge_in_progress (JSON shape exact).

## Verification

```powershell
go build ./...
go test ./cmd/session-broker/... -v
go test ./pkg/... 
```

## Commit

`feat(session-broker): user-initiated data purge (endpoint, hard-kill, gates, sweeper)`

## Checklist

- [ ] runDataPurge shared core; handler = thin HTTP shell
- [ ] Flag set FIRST; all error paths after step 4 handled per spec
- [ ] Connect + provisioning gates with exact 409 JSON shape
- [ ] Sweeper: resume, attempts cap, unblock-on-giveup
- [ ] Metrics + audit log
- [ ] Handler tests (all six scenarios) green
- [ ] gitnexus_impact run on Connect + provisioning ready-flip before edit; gitnexus_detect_changes before commit
