# Phase 7-1: Backend E2E — Purge Suite (final phase, part 1)

**Repo:** `C:\Users\sge20\go\src\github.com\harmony-ai-solutions\soulbits-cloud-backend`
**Files:** new `tests/e2e/session_data_purge.go`, `tests/e2e/main.go` (register test name), helpers if needed

> Docker IS available. The stack: `docker compose up -d` from the repo root.
> Run pattern (tests/e2e/README.md): `cd tests/e2e; go run . -v --reset -run <Names>`.
> Register the new tests under a `-run` name **`SessionDataPurge`** in main.go's
> test registry (follow how Session/SessionFullChain are registered). All tests
> below are `localOnly` (cloud mode skips — destructive against shared env).

## Context — harness facts

- Shared sequential state (auth token, user) via the existing `tc` test
  context; helpers exist for: register/login (`auth.go`), connect/poll
  (`session.go`), MinIO client + bucket (`snapshot_store.go` has delete
  helpers; assert-exists helpers in `verification.go`), Postgres via
  `DATABASE_URL`, Valkey via `VALKEY_ADDR` (check `helpers.go` for an existing
  client — the DLQ tests talk to RabbitMQ/MinIO directly, so raw clients are
  the established pattern), `docker logs`/exec usage exists in DLQ tests.
- Broker URL: `SESSION_BROKER_URL` (localhost:8080); compose service name
  `session-broker` (restart target).
- The sidecar uploads snapshots at teardown; the engine runs as a docker-mode
  container per session.

## Tests (all under the `SessionDataPurge` run name)

### 1. `TestSessionDataPurge_ConfirmationRequired`
POST delete without body / with `{"confirm":"yes"}` → 400
`{"error":"confirmation_required"}`. No side effects (snapshot objects intact).

### 2. `TestSessionDataPurge_ConnectBlockedWhileFlagSet`
Set the purge flag directly in Valkey (`SET session:datadel:{userID} <json>` +
`ZADD session:datadel:registry`) for the shared user → connect → **409**
`{"error":"purge_in_progress"}` (exact shape) → DEL flag + ZREM → connect
returns 200/202 again. Proves the gate without racing a live purge.

### 3. `TestSessionDataPurge_FullChain_LiveSession` (the core test)
1. Fresh user (register+login). Connect → poll until `ready`/`active`.
2. Seed cloud state for that user:
   - MinIO: upload `{userID}/data.sqlite` **twice** (two versions), plus
     `{userID}/rag/vectors.bin` and `{userID}/data.sqlite-wal`.
   - Valkey: `ZADD due:lifecycle` a beat member
     `{"user_id":"...","entity_id":"e2e","op":"beat"}` (score now+1s) and a
     seed member `{"user_id":"...","op":"seed"}`.
   - DEK: created at connect by the broker (assert users row has non-NULL
     `db_encryption_key_encrypted` via Postgres, docker mode uses
     LocalFileKeyStore — then instead assert via behavior in step 5; keep the
     Postgres assertion IF the docker broker uses the Postgres keystore, else
     skip — verify which by reading main.go wiring and record in the report).
3. POST delete `{"confirm":"DELETE"}` → **200**, `status=deleted`,
   `objects_deleted >= 4`, `versions_deleted >= 5` (2 versions of
   data.sqlite + wal + rag + any engine-written objects), `beats_removed == 2`,
   `dek_deleted == true`.
4. Assert cloud state gone:
   - MinIO `ListObjectsV2` prefix `{userID}/` → empty; `ListObjectVersions`
     → empty (no delete markers left behind).
   - Valkey `due:lifecycle` → no members containing the userID (both formats).
   - Purge flag + registry entry absent.
   - Postgres: user's session rows → `status='purged'`.
   - Engine container for the session is gone (docker: list containers,
     match the session's task/container naming from the docker ECS impl).
5. **No resurrection**: wait 20s (grace-period + snapshot-timeout scale) →
   MinIO prefix STILL empty (sidecar never uploaded — it was hard-killed).
6. Idempotency: POST delete again → 200 deleted, zero counts.

### 4. `TestSessionDataPurge_ReconnectFresh`
Continues from test 3's user (or fresh user purged the same way): connect →
provisions cleanly → `ready`. Disconnect → teardown uploads a FRESH snapshot
(seed objects re-appear under `{userID}/`) and the seed op re-adds the beat
chain (eventually present in `due:lifecycle`). Proves the post-purge cold
start works end-to-end.

### 5. `TestSessionDataPurge_BrokerRestartResume`
1. Seed S3 objects for a fresh synthetic user (no session needed).
2. Simulate a crash mid-purge: set flag + registry entry manually (phase
   `"s3"`, attempts 0). Do NOT call the endpoint.
3. `docker restart <session-broker-container>`; wait for `/health` 200
   (helper or poll).
4. Within ~2 sweeper intervals: MinIO prefix empty, flag + registry cleared,
   `session_data_purge_resumes_total` advanced (scrape `/metrics` on the
   broker — pattern exists in lifecycle_helpers.go).

### 6. `TestSessionDataPurge_WorkerDropsBeat`
1. Set purge flag for the shared user; `ZADD due:lifecycle` a due beat member.
2. Wait one dispatcher→worker sweep (see `lifecycle_test.go` for timing
   helpers/poll patterns).
3. Assert: no snapshot objects appeared for the user (worker dropped before
   download), member NOT re-armed (absent from `due:lifecycle` after the
   sweep), and the beat did not go to the DLQ (dropped = Acked).
4. Clean up the flag (so later tests can connect).

### 7. `TestSessionDataPurge_SecondDeviceInProgress`
Flag set → a second delete call → 200 `status=in_progress` with the original
`request_id`, and NO new purge started (flag request_id unchanged).

## Run

```powershell
docker compose up -d
cd tests\e2e
go run . -v --reset -run SessionDataPurge
# regressions:
go run . -v --reset -run Session,SessionConnectTimeout,OpenAPISpec,Lifecycle
```

All green before committing. If a timing assumption proves wrong (sweeper
interval, seed timing), fix the test with polling — never weaken an assertion
without orchestrator approval.

## Commit

`test(e2e): session data purge coverage (full chain, gates, restart resume, worker drop)`

## Checklist

- [ ] `SessionDataPurge` registered in main.go; all 7 tests implemented
- [ ] Full suite run green (purge + regression names above)
- [ ] No assertion weakened; deviations documented in report
- [ ] Committed (no push)
