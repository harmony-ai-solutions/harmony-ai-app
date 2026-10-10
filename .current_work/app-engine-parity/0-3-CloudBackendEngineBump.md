# Phase 0-3 — Cloud Backend: Engine Dependency Bump & Compatibility Window

> **Repo:** `soulbits-cloud-backend` (branch `feat/app-engine-parity`)
> **Assessment basis:** §12.5 (coupled releases, schema support window), §7.1 (worker consumes engine packages directly)
> **Depends on:** 0-1, 0-2 merged in engine

## Objective

Bring the cloud backend onto the refactored engine core **without any infra changes** (session broker, warm pool, conduct proxy all stay untouched — deferred to the cloud-cleanup plan). Establish the N/N−1 schema support window for the lifecycle-worker.

## Context

The lifecycle-worker imports engine packages directly (`hl_database`, `emotion`, `lifecycle`, `modules/cognition`, `modules/common`, `push`) and runs against per-user snapshot SQLite files produced by session-task engines. After 0-1/0-2, the engine's state model gains lazy evaluation + catch-up; snapshots written by older session engines must remain readable, and worker output must remain readable by them (mixed fleet during rollout).

## Implementation steps

1. Bump the engine dependency (go.mod replace/require → `feat/app-engine-parity` merge commit; follow the repo's pinning convention).
2. Re-run lifecycle-worker suite (`go test ./cmd/lifecycle-worker/...` and the local E2E lifecycle tests where the environment allows; App-Control-blocked packages noted pre-existing).
3. Compatibility cases to verify explicitly:
   - Old snapshot (pre-0-1 anchors) + new worker: `restorePersistedState` / lazy evaluation must handle missing `last_evaluated_at`-style anchors with a safe default (fall back to `updated_at`; document choice)
   - New snapshot + old worker fleet (staggered deploys): worker writes only via engine functions — pin the same engine version across worker deployments during the rollout week (deploy worker before/with session-engine image, both carrying the new engine)
4. Define the **schema support window** policy: lifecycle-worker accepts snapshots with `user_version` ∈ {N, N−1}; older → job fails with typed error + snapshot queued for session-task migration path (existing behavior: next session task runs migrations on the DB — verify that remains true with the embedded engine absent; it does while session tasks exist — this is exactly why cloud cleanup is deferred).
5. Add a version-matrix note to the cloud repo README/ops docs.

## Files to create/modify

- `go.mod` (engine dependency bump)
- `cmd/lifecycle-worker/job.go` (only if anchor fallback needs explicit handling — expect none if 0-1 handles missing anchors)
- Ops/README version-matrix section, CHANGELOG.md

## Verification gates

- `go build ./...`, `go vet ./...`, `go test ./...` (minus pre-existing App-Control-blocked packages)
- Lifecycle E2E green against a dev snapshot from BOTH old and new session engines
- No infra diffs (broker/proxy/warm pool untouched — assert in review)

## Risks & rollback

- Staggered-fleet skew → mitigated by deploy ordering (worker + session image same engine version)
- Rollback: revert dependency bump; old worker tolerates new snapshots only if 0-1 avoided breaking schema changes (enforced there)

## Progress checklist

- [ ] Engine dependency bumped
- [ ] Old/new snapshot compatibility verified
- [ ] Schema support window policy documented + enforced
- [ ] Version matrix in ops docs
- [ ] Gates green
