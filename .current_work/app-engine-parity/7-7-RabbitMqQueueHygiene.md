# Phase 7-7 — Cloud: RabbitMQ Queue Hygiene (DLQ TTLs + `lifecycle`→`push` rename)

> **Repo:** `soulbits-cloud-backend`
> **Created:** 2026-10-12 (owner review follow-ups: DLQ overflow protection + naming clarity; owner rulings: **TTL = 7d**, vhost/user rename + monitor gauges **in scope**)
> **Depends on:** 6-1 (dispatcher/DLQ-drainer retirement — the context that created both gaps)
> **Scope note:** dev is LIVE running the pre-changeset code; prod does not exist yet. All queue-arg/name changes need a one-time drain+delete on the dev broker.

## Verified current state (2026-10-12 review — anchor before editing)

1. **No DLQ anywhere has a TTL.** `inference.dlq.{workload}` queues are declared with `nil` args (`pkg/rabbitmq/inference.go:79-85`); `lifecycle.dlq` / `lifecycle.push.dlq` likewise (`pkg/rabbitmq/lifecycle.go:128-137`). Work queues carry only DLX args (`inference.go:214-217`); reply queues are exclusive/auto-deleted (fine). Since the 6-1 drainer deletion, **nothing drains or archives any DLQ** — depth is gauged only for `inference.dlq.*` (`cmd/worker-fleet/monitoring/dlq.go:72` builds `inference.dlq.%s`; gauge `inference_dlq_depth` at `:191`). Unbounded sinks.
2. **The lifecycle jobs half of the topology is publish-dead.** `lifecycle.jobs` / `lifecycle.dlq` producers (lifecycle-worker, lifecycle-dispatcher) are deleted (4-4 / 6-1); the only remaining `PublishLifecycleJob` callers are tests. `lifecycle.push` is still consumed by push-service (`cmd/push-service/push.go:295`) and push-service owns the topology declare (`push.go:188`), but its documented producer ("PublishLifecycleJob from the worker", comment at `push.go:185-186`) no longer exists — the 4-4 relay/keepalive deliver via the shared in-process runtime, not AMQP. **Re-verify at implementation time** (grep for `PublishLifecycleJob` callers in `cmd/`) before deleting anything.
3. The `lifecycle` naming now refers to a plane that mostly no longer exists — source of the confusion. The name runs three layers deep: AMQP resources (exchange/queues), the broker vhost `/lifecycle` + user `lifecycle-svc`, and the env var/secret plumbing.

## Design

### 1. TTLs on every DLQ (the overflow fix)

- Add `"x-message-ttl": int64(7 * 24 * time.Hour / time.Millisecond)` to the queue args in:
  - `pkg/rabbitmq/inference.go` — the `inference.dlq.%s` declares (`:79-85`),
  - the (renamed, see below) push DLQ declare.
- 7d matches the engine changeset-store retention spirit; dead letters older than that have no replay value.
- **Ops precondition (dev is live):** re-declaring an existing durable queue with different args fails with `PRECONDITION_FAILED` (406) and breaks service startup. Before deploying: on the dev broker, drain (export if you want the contents) and delete every affected queue — `inference.dlq.{type}` × |WorkloadTypes|, `lifecycle.push.dlq`, `lifecycle.dlq`. Expected depths ≈ 0.

### 2. Rename `lifecycle` → `push` (queue/exchange level)

- New names: exchange `lifecycle`→`push`; DLX `lifecycle.dlx`→`push.dlx`; queue `lifecycle.push`→`push.deliveries`; DLQ `lifecycle.push.dlq`→`push.deliveries.dlq` (with the TTL from §1).
- **Delete, don't rename:** `lifecycle.jobs` + `lifecycle.dlq` declarations and their routing keys — no producers or consumers remain (per verified state #2; re-verify first).
- `pkg/rabbitmq/lifecycle.go` → rename file to `push.go`; constants (`QueueLifecyclePush`→`QueuePushDeliveries`, etc.); collapse `PublishLifecycleJob`'s jobs/push routing switch into a single-purpose `PublishPushDelivery`; rename `ConsumeLifecycleJobs`→`ConsumePushDeliveries` (it was already parameterized by queue name).
- Update: push-service wiring + the stale worker comment (`push.go:185-186`), `pkg/rabbitmq/lifecycle_test.go` (rename + drop jobs-routing cases), any e2e references (grep `lifecycle.push`), docs.

### 3. Rename the vhost/user/IaC (mandatory)

Full inventory of the plumbing that carries the old name:

- **Broker provisioning:** `infrastructure/tofu/modules/ec2-rabbitmq/rabbitmq-setup.sh` provisions ALL users/vhosts/permissions via `rabbitmqctl` (no default user). Rename user `lifecycle-svc`→`push-svc`, vhost `/lifecycle`→`/push`, update its permission regexes to the renamed queues from §2, and **grant `fleet-monitor` read on `/push`** (needed by §4 — the management-API user is currently scoped to `/inference`, see compose `RABBITMQ_MGMT_VHOST: "%2Finference"`). The local compose RabbitMQ mirrors prod identities (`docker-compose.yml:72` comment) — apply the same user/vhost renames there (compose init/config + the push-service URL at `docker-compose.yml:559`).
- **Secret:** `infrastructure/tofu/modules/environment/main.tf:481-494` — replace secret `soulbits/{env}/rabbitmq/lifecycle_url` with `push_url` (URL string `amqp://push-svc:<pw>@<host>:5672/%2Fpush`); rewire the output passed into ecs-services (`environment/main.tf:889`, variable `rabbitmq_lifecycle_url_secret_arn` in `modules/ecs-services/variables.tf:439-441`) and the task-def env entries (`modules/ecs-services/lifecycle.tf:70`, `combined.tf:427`).
- **Env var:** `RABBITMQ_LIFECYCLE_URL` → `RABBITMQ_PUSH_URL` — Go side (`cmd/push-service/config.go:18-19, :71` default URL, `:107` validation message, all `t.Setenv` in `push_test.go`), tofu task defs, `docker-compose.yml:559`, `.env.example`.
- **Variables:** `rabbitmq_lifecycle_svc_password` → `rabbitmq_push_svc_password` (`modules/ec2-rabbitmq/variables.tf:54-56`, `modules/environment/variables.tf:72-74`, `environments/{dev,prod}/variables.tf:63-65`, the `main.tf` pass-throughs).
- **Not touched:** `pkg/config.RabbitMQURL` (`RABBITMQ_URL`, `/inference` vhost, `pkg/config/config.go:40`) — that's the inference plane's URL.
- **Dev migration order:** tofu apply (new secret/user/vhost exist) → drain+delete old-args queues (§1 precondition) → deploy services on new names/URL → retire `lifecycle-svc` user, `/lifecycle` vhost, old secret, and any orphaned old-name queues.

### 4. Fleet-monitor DLQ gauges (mandatory)

- Generalize `DLQMonitor` (`cmd/worker-fleet/monitoring/dlq.go`) beyond the hardcoded `inference.dlq.%s` name format (`:72`): accept explicit `(vhost, queueName)` targets.
- Instantiate a second monitor for the `/push` vhost watching `push.deliveries.dlq`; new gauge **`push_dlq_depth`** (keep `inference_dlq_depth` as-is — `tests/e2e/worker.go:88` asserts that name).
- Merge both monitors' depths into `FleetStatus.DLQDepths` (`monitoring.go:96-117` — one map keyed by workload/queue label).
- worker-fleet config: the single `RABBITMQ_MGMT_VHOST` (compose `:516`, `pkg/config/config.go:59`) becomes per-plane (e.g. add `RABBITMQ_MGMT_VHOST_PUSH` or a list); document in `.env.example`.

## Implementation steps

1. Re-verify no production `PublishLifecycleJob` callers (grep `cmd/`).
2. Go topology: TTLs + rename + jobs-half deletion (`pkg/rabbitmq/`), push-service wiring + stale comment.
3. Go config: `RABBITMQ_PUSH_URL` env rename + tests.
4. Tofu: broker script renames + fleet-monitor `/push` read, secret/env/variable renames (§3 inventory).
5. Monitor generalization + second gauge + fleet status merge + worker-fleet config.
6. Docs: `docs/` references to lifecycle queues; `.env.example`; CHANGELOG entry (user-relevant: "dead-letter queues now expire after 7 days").

## Files to create/modify

- `pkg/rabbitmq/inference.go` (DLQ TTL args)
- `pkg/rabbitmq/lifecycle.go` → `pkg/rabbitmq/push.go` (rename + delete jobs half + TTL)
- `pkg/rabbitmq/lifecycle_test.go` → `push_test.go`
- `cmd/push-service/push.go`, `cmd/push-service/config.go`, `cmd/push-service/push_test.go`
- `cmd/worker-fleet/monitoring/{dlq.go,monitoring.go}`, `cmd/worker-fleet/main.go`, `pkg/config/config.go`
- `infrastructure/tofu/modules/ec2-rabbitmq/rabbitmq-setup.sh`
- `infrastructure/tofu/modules/environment/{main.tf,variables.tf}`
- `infrastructure/tofu/modules/ecs-services/{lifecycle.tf,combined.tf,variables.tf}`
- `infrastructure/tofu/environments/{dev,prod}/{variables.tf,main.tf}`
- `docker-compose.yml`, `.env.example`, `docs/`, `CHANGELOG.md`

## Verification gates

- `go build ./...`, `go vet ./...`, `go test ./...` green.
- `tofu validate` green on touched modules (dev + prod environments).
- Local compose e2e green (push path behavior unchanged; only names changed).

## Owner ops steps (dev, once — ordered)

1. `tofu apply` — new `push-svc` user + `/push` vhost + `push_url` secret live (old ones still present).
2. Drain/export + delete queues that get new args: `inference.dlq.{type}` (all), `lifecycle.push.dlq`, `lifecycle.dlq` — **before** deploying the TTL change (406 guard).
3. Deploy the changeset (services redeclare new-name topology with TTLs and consume/publish on `/push`).
4. Post-cutover cleanup: delete orphaned `lifecycle` exchange / `lifecycle.jobs` / old-name queues; retire `lifecycle-svc` user + `/lifecycle` vhost + `lifecycle_url` secret (tofu destroy/apply of the removed resources).

## Progress checklist

- [x] Producer re-verification (grep) — zero non-test `PublishLifecycleJob` callers under `cmd/` (only `pkg/rabbitmq/push_test.go` + one comment); jobs half deleted
- [x] DLQ TTLs, 7d (inference + push) — `dlqMessageTTLMillis` applied to `inference.dlq.*` and `push.deliveries.dlq`
- [x] Rename lifecycle→push topology + jobs-half deletion — `pkg/rabbitmq/lifecycle.go`→`push.go`, `DeclarePushTopology`/`PublishPushDelivery`/`ConsumePushDeliveries`
- [x] Vhost/user/secret/env rename (tofu + compose + Go config) — `/lifecycle`→`/push`, `lifecycle-svc`→`push-svc`, `RABBITMQ_LIFECYCLE_URL`→`RABBITMQ_PUSH_URL`, `rabbitmq_push_svc_password`, `push_url` secret
- [x] Fleet-monitor: generalized targets + `push_dlq_depth` gauge + fleet-status merge — `DLQTarget`, second `/push` monitor, merged `DLQDepths`, `RABBITMQ_MGMT_VHOST_PUSH`
- [x] Tests + docs + changelog — renamed/reduced `push_test.go`, new monitor test, `docs/lifecycle-plane-operations.md`, README, `.env.example`, CHANGELOG
- [ ] Dev broker cutover runbook executed with deploy — OWNER OPS (live broker; not touched by this changeset)
