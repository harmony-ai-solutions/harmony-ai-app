# Phase 6-1 — Cloud: Session Hosting Infra Retirement

> **Repo:** `soulbits-cloud-backend` (branch `feat/app-engine-parity`)
> **Assessment basis:** previously-deferred cloud-cleanup scope, folded into this plan 2026-10-11; 2026-10-11 rulings (on-device lifecycle, pre-launch no-legacy)
> **Depends on:** 3-4 + 4-4 verified on devices (the session plane is functionally unused by the app); **not** gated on 2-6 (the plane being retired here is the *session* plane; the snapshot plane's retirement is 6-2, which does gate on 2-6)
> **Inventory:** research doc §5 + the explore-agent inventory (paths below from it)
> **Codebase mapping consulted:** `.planning/codebase/` (cloud — soulbits-cloud-backend): ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, INTEGRATIONS.md

## Objective

Delete per-user session hosting outright — the broker, warm pool, conduct proxy, init/sidecar containers, and the lifecycle dispatcher that fed the (already-deleted, 4-4) worker. Pre-launch ruling applies: no freeze window, no sunset staging — the only consumers ever were our own builds.

## Deletion scope (delete outright)

- **Services:** `cmd/session-broker/` (incl. `handlers/`, `provisioning/`, `warmpool/`, `lifecycle/` grace manager, `datapurge_sweeper.go`, `devicegate.go`, `db/`), `cmd/conduct-proxy/`, `cmd/session-init/`, `cmd/session-sidecar/`, `cmd/lifecycle-dispatcher/`, `cmd/baremetal-scheduler/` (106-line stub; its rationale — warm-pool v2 placement — dies here)
- **Packages:** `pkg/session/` (entire — Session model, `ecs.go` Fargate task builder, `valkey.go`, `deviceauth.go`, `datapurge.go`; snapshot-plane files `s3.go`/`snapshot_rag.go`/`keyinject.go` are listed here but **executed in 6-2** for blast-radius isolation)
- **DLQ drainer (delete wholesale — no split):** `pkg/dlqarchive` is imported **only** by `cmd/lifecycle-dispatcher` (verified: `grep -rln dlqarchive` → dispatcher main + the package's own tests + `tests/e2e/dlq_drainer_test.go`; the inference gateway's `drainer/` is ALB connection-draining, unrelated). `dlq-archive` is **not a bucket/module** — it is a prefix + lifecycle rule inside **s3-internal-assets** (`DLQ_ARCHIVE_PREFIX` env, dispatcher-scoped IAM policy, env-module wiring in `infrastructure/tofu/modules/environment/main.tf`). Delete the package, its wiring, the e2e test, the prefix env/IAM/lifecycle-rule blocks from the internal-assets module.
- **IaC:** `infrastructure/tofu/modules/ecs-services/main.tf` (session_broker + conduct_proxy blocks), `lifecycle.tf` (worker + dispatcher entries; push_service stays), `combined.tf` (`backend_combined_api`/`backend_combined_infra` session+lifecycle containers), `iam/main.tf` (session_broker_*/conduct_proxy_* policies + task roles), `ecr/main.tf` (service entries: session-broker, conduct-proxy, session-init, session-sidecar, soulbits-engine, lifecycle-worker, lifecycle-dispatcher)
- **CI/deploy:** `.github/workflows/mirror-soulbits-engine.yml` (engine Docker Hub→ECR mirror), deploy-dev/prod matrix entries for deleted services
- **Compose/dev:** `Dockerfile.sidecar`, `Dockerfile.lifecycle-worker` (if not already removed by 4-4), `docker-compose.yml` session/conduct/lifecycle services, `/sessions` + `/lifecycle` vhost provisioning + `session-svc`/`lifecycle-svc` RabbitMQ users (keep inference vhost), `minio-init` soulbits-sessions bucket creation (6-2 owns the bucket itself), `.env.example` session/Docker-mode/datapurge/engine-image blocks
- **Data plane:** `sessions` DB table chain (000004 + 000005/000006/000009/000020/000027) via down-migrations; `lifecycle_jobs` (000025); RabbitMQ exchanges/queues (`session.commands*`, `cmd.{taskID}`, `/lifecycle` vhost objects); valkey keys `session:provisioning:*`, `session:endpoint:*`, `session:heartbeat:*`, `session:datadel:*`, `lock:snapshot:*`, `due:lifecycle` — **keep `pkg/valkey/session.go`** (auth sign-in sessions; name collision, NOT hosting)
- **Observability/docs:** `monitoring/grafana/.../sessions.json` dashboard, `monitoring/alloy/config.alloy` soulbits-engine relabel block, `scripts/cleanup-session-containers.sh` + session-plane e2e helper scripts, `tests/e2e/` session/conduct/lifecycle/sync_request/cloud-engine suites + `helpers.go`/`main.go` session wiring, stale root build artifacts + .gitignore hygiene
- **Contract ripple:** `pkg/openapi/openapi.yaml` `/v1/session/*` paths removed → regenerate `soulbits-api-client-go` + app `soulbits-api-client` (coordinate; app-side session client deletion already happened in 3-4)
- **Config/docs:** `pkg/config` session block; README/ARCHITECTURE_GUIDE/first-rollout/lifecycle-plane-operations docs; `portal/CloudPage.tsx` marketing copy; memory banks

## Keep (dependency)

`cmd/inference-gateway`, `cmd/push-service`, `cmd/subscription-service`, `cmd/auth-service` (purge-client rewrite happens in 6-2), `cmd/worker`, `cmd/worker-fleet`, `pkg/auth`, `pkg/paseto`, inference rabbitmq/valkey plumbing, all non-sessions S3 modules (`s3-worker-binaries`, `s3-releases`, `s3-web-portal`, `s3-internal-assets` — kept as a bucket; only its `dlq-archive/` prefix + dispatcher-scoped IAM/lifecycle-rule blocks go).

## Implementation steps

1. Down-migrations (sessions chain, lifecycle_jobs) + valkey/RabbitMQ topology teardown in compose/provisioning. **Migration-numbering hazard:** cloud `db/migrations/000029` is duplicated (two file pairs share the number: `000029_add_email_change` + `000029_fix_kitten_tts_languages`) — pre-existing; never renumber existing migrations to "fix" this; new/down migrations take the next free number.
2. Service + package deletions (scope above; `pkg/dlqarchive` + the `dlq-archive/` prefix blocks die wholesale with the dispatcher — no split).
3. IaC module edits + plan/apply (dev → prod), deploy workflow matrix updates.
4. openapi session-path removal + client regeneration (both client repos).
5. E2E suite rework: delete session-plane suites; keep account/inference/push suites green without session fixtures.
6. Docs/memory-bank/portal updates.

## Verification gates

- `go build ./...`, `go vet ./...`, `go test ./...` green (minus pre-existing App-Control-blocked packages)
- Repo builds with zero references to deleted packages (grep gates: `pkg/session`, `cmd/session-`, `cmd/conduct-`, `cmd/lifecycle-dispatcher`)
- Deployed dev env healthy with remaining services only; dashboards/alerts trimmed
- Regenerated clients compile against both consumers

## Risks & rollback

- Missed consumer of a deleted queue/key → grep gates + dev-env soak before prod apply; git/tf-state revert per component
- openapi regen breaks app/API clients → coordinate in one coupled PR set (repo conventions); CI on all three repos
- IaC apply order matters (services before topology) → runbook note in the PR

## Progress checklist

- [ ] Down-migrations + topology teardown
- [ ] Services/packages deleted (`pkg/dlqarchive` + `dlq-archive/` prefix blocks fully gone — no split)
- [ ] IaC updated + applied (dev, prod)
- [ ] openapi + clients regenerated
- [ ] E2E suites reworked green
- [ ] Docs/memory banks/portal updated
