# Cloud Data Purge — User-Initiated Deletion of Soulbits Engine Sync Data

## Overview

Today a user cannot delete their synchronized soulbits-engine data from the cloud
S3 bucket (`soulbits-sessions-{env}/{userID}/`). A broken/corrupt sync DB in the
cloud can therefore never be repaired by the user — the only writers are the
session sidecar (teardown upload) and the lifecycle worker (beat upload), and
there is **no production delete path anywhere** (the sole `DeleteObjects` call is
a test helper). This plan adds a user-initiated, hard-kill-based purge of all
cloud-side engine data, surfaced in the app's Settings → Data Synchronization
screen.

**Scope of deletion (per user):**

| Store | Keys / rows | Action |
|---|---|---|
| S3 sessions bucket | `{userID}/data.sqlite{,-wal,-shm}` + `{userID}/rag/*` — **all versions** (bucket has versioning enabled) | permanent delete (explicit VersionIds, not delete markers) |
| Valkey `due:lifecycle` | all ZSET members whose `user_id` matches | remove (stops autonomy beat chains) |
| Postgres `users` | `db_encryption_key_encrypted` (KMS-wrapped DEK) | NULL out (fresh DEK on next connect) |
| Postgres `sessions` | rows in non-terminal status | transition to new terminal status `purged` |
| Valkey routing/state | endpoint, provisioning state, task mapping, cert fp, heartbeat, warm-pool membership | delete |

**Explicitly out of scope:** account deletion, `user_devices`, subscriptions,
inference history, DLQ archive bucket, auth-service data.

## Key design decisions (settled with user)

1. **Endpoint:** `POST /v1/session/data/delete` with body `{"confirm": "DELETE"}}`
   (action-style POST, matching `/v1/session/connect|disconnect|connected`).
2. **Hard kill, no grace-period wait:** any live session's ECS/Docker task is
   force-stopped (NO graceful stop command → the sidecar never gets to upload a
   final snapshot → no data resurrection). Target wall time: **5–15 s**.
3. **Purge flag in Valkey** (`session:datadel:{userID}` + registry ZSET
   `session:datadel:registry`) is set FIRST and is the guard for everything:
   connect gate (409 `purge_in_progress`), provisioning re-check, lifecycle-worker
   drop, and a broker-side sweeper that **confirms-or-resumes** unfinished purges
   after broker restart. All purge steps are idempotent → "resume" = "re-run +
   verify".
4. **DEK is deleted** (true fresh start; `seed` op re-establishes beat chains at
   the next session teardown; broker lazily creates a fresh DEK on next connect).
5. **Defense in depth on app AND broker:** app suppresses reconnect during purge
   and maps the typed 409; broker blocks connect at entry AND re-checks in the
   provisioning goroutine before flipping a session to `ready`.
6. **Snapshot lease** (`lock:snapshot:{userID}`) acquired with bounded wait for
   the whole purge → concurrent lifecycle-worker beat cannot re-upload.

## Endpoint contract

`POST /v1/session/data/delete` (PASETO auth, rate-limited like other session routes)

| Response | Body | Meaning |
|---|---|---|
| 200 | `{"status":"deleted","objects_deleted":n,"versions_deleted":m,"beats_removed":k,"dek_deleted":true}` | purge complete; idempotent (re-request returns fresh result, zero counts) |
| 200 | `{"status":"in_progress","request_id":"..."}` | another purge for this user is mid-flight (this device or another) |
| 400 | `{"error":"confirmation_required"}` | `confirm != "DELETE"` |
| 401 | — | auth |
| 409 | `{"error":"snapshot_busy","retry_after_ms":3000}` | snapshot lease contended; retry in seconds |
| 429 / 503 | — | rate limit / stop-confirmation timeout (sweeper finishes) |

`POST /v1/session/connect` gains a new **409**
`{"error":"purge_in_progress","retry_after_ms":5000}` response while the flag is
active (spec + both clients must model it).

## Repositories touched

| Repo | Work |
|---|---|
| `soulbits-cloud-backend` | OpenAPI spec, `pkg/session` S3 purge + purge-flag/ZSET helpers, `pkg/valkey` ZRem, `pkg/keystore` delete, migration 000027, session-broker handler/gates/sweeper, lifecycle-worker gate, e2e tests |
| `soulbits-api-client-go` | vendored spec, codegen, `DeleteSessionData` + typed errors |
| `soulbits-api-client-js` | vendored spec, codegen, `session.deleteData` + typed errors, v0.2.0 |
| `harmony-ai-app` | `CloudSessionService.purgeCloudData()` + purge state, `SyncConnectionContext` 409 mapping, SyncSettingsScreen destructive card, i18n, Jest tests, JS client pin bump |

**Workflow policy (user-approved):** subagents implement AND commit (one commit
per phase, conventional messages, never push). User pushes. The app consumes the
JS client via a pinned git hash in `package.json` — the JS client phase's commit
hash feeds the app phase. E2E phase runs the new tests against
`docker compose up -d` (Docker is available).

## Phases

- **Phase 1 — OpenAPI spec:** new endpoint + connect 409 + schemas.
- **Phase 2 — Backend foundations:** versioned S3 purge (2-1), Valkey purge
  flag/lifecycle-ZSET helpers (2-2), keystore delete (2-3). Pure `pkg/` layer, no wiring.
- **Phase 3 — Broker integration:** migration + `purged` status (3-1), purge
  handler + connect/provisioning gates + resume sweeper (3-2), lifecycle-worker
  drop gate (3-3).
- **Phase 4 — Go client:** regen + `DeleteSessionData` + typed errors.
- **Phase 5 — JS client:** regen + `deleteData` + typed errors + v0.2.0 (parallel with 4).
- **Phase 6 — App integration:** purge service + reconnect suppression (6-1),
  settings UI + i18n (6-2), tests + client pin bump (6-3).
- **Phase 7 — E2E + finalize:** full docker-compose e2e coverage of every new
  behaviour (7-1), docs/changelog/memory-bank + final verification (7-2).

Dispatch order: 1 → 2 → 3 → (4 ∥ 5) → 6 → 7. Phases 1–3 are sequential in the
same repo (no concurrent commits to one repo).

## Implementation Status

Track the completion of each phase as implementation progresses:

- [x] **Phase 1: OpenAPI Spec** ([1-1-OpenApiSpec.md](1-1-OpenApiSpec.md)) — commit `f068039`- [x] **Phase 2: Backend Foundations** — commit `f4eb40e`
  - [x] S3 versioned purge ([2-1-S3VersionedPurge.md](2-1-S3VersionedPurge.md))
  - [x] Valkey purge flag + lifecycle ZSET helpers ([2-2-ValkeyPurgeHelpers.md](2-2-ValkeyPurgeHelpers.md))
  - [x] Keystore delete ([2-3-KeystoreDelete.md](2-3-KeystoreDelete.md))
- [x] **Phase 3: Broker Integration** — commit `bf20b05`
  - [x] Migration + purged status ([3-1-PurgedStatusMigration.md](3-1-PurgedStatusMigration.md))
  - [x] Purge handler + gates + sweeper ([3-2-BrokerPurgeHandler.md](3-2-BrokerPurgeHandler.md))
  - [x] Worker drop gate ([3-3-WorkerAndProvisioningGates.md](3-3-WorkerAndProvisioningGates.md))
- [x] **Phase 4: Go Client** ([4-1-GoClientDeleteSessionData.md](4-1-GoClientDeleteSessionData.md)) — commit `5729768`
- [x] **Phase 5: JS Client** ([5-1-JsClientDeleteSessionData.md](5-1-JsClientDeleteSessionData.md)) — commit `f38e6115a013522f24e8e42d34547318a23a95fb` (v0.2.0)
- [x] **Phase 6: App Integration** — commit `f2d2357`
  - [x] Purge service + reconnect suppression ([6-1-AppPurgeService.md](6-1-AppPurgeService.md))
  - [x] Settings UI + i18n ([6-2-AppPurgeUI.md](6-2-AppPurgeUI.md))
  - [x] Tests + client pin bump ([6-3-AppTestsAndPin.md](6-3-AppTestsAndPin.md)) — pin → `f38e6115a013522f24e8e42d34547318a23a95fb`; 618 unit + 51 integration tests green
- [x] **Phase 7: E2E + Finalize**
  - [x] Backend e2e purge suite ([7-1-BackendE2EPurge.md](7-1-BackendE2EPurge.md)) — commit `5db0c44`; all 7 scenarios green (verified twice: agent run + independent orchestrator re-run, 3m31s). Note: commit subject carries a leading BOM artifact (cosmetic, unpushed).
  - [x] Docs, changelog, final verification ([7-2-FinalizeDocs.md](7-2-FinalizeDocs.md)) — backend `3dd1e40` (api-usage, .env.example, CHANGELOG, memory-bank ×2), go client `7e1bdb9` (README), js client `199624a` (README), app `984b841` (CHANGELOG). All builds/tests green; sole red is pre-existing unrelated `pkg/dlqarchive` failure (from `2861949`, DLQ workstream).

**Plan complete — 2026-08-19.** All commits unpushed (user pushes).

## Codebase mapping consulted

- App: `.planning/codebase/ARCHITECTURE.md`, `STRUCTURE.md`, `CONVENTIONS.md`,
  `TESTING.md` (harmony-ai-app `.planning/codebase/` — no backend-side mapping
  exists; backend context comes from GitNexus index `soulbits-cloud-backend`).
