# Phase 4-4 — Cloud: Keepalive Cron, Push Relay & Worker Deletion

> **Repo:** `soulbits-cloud-backend` (branch `feat/app-engine-parity`)
> **Assessment basis:** 2026-10-11 review ruling — on-device lifecycle authority; the cloud becomes data-blind for lifecycle
> **Depends on:** 0-4 (engine batch API shipped to the app); 4-2/4-3 consume it. The cron + relay can ship earlier (no-op until the app registers handlers).
> **Codebase mapping consulted:** `.planning/codebase/` (cloud — soulbits-cloud-backend): ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, INTEGRATIONS.md

## Objective

Replace cloud lifecycle **execution** with two data-blind primitives — a best-effort hourly keepalive push (iOS only) and a device-initiated visible-push relay — and **delete the lifecycle-worker outright**. End state: the cloud never opens a user snapshot for lifecycle, never imports engine packages for lifecycle, and the backend carries no lifecycle engine code at all.

Pre-launch ruling (2026-10-11): no old versions exist in the wild — no freeze window, no kill-switch, no sunset gate, no version floors. The worker is removed in one step once the on-device path (4-3) is live on our devices.

## Context

The lifecycle-worker today downloads each user's encrypted snapshot, opens it with the per-user DEK, runs engine beats server-side, uploads, and pushes outreach (D-SYNC-02/D-BEH-04). The 2026-10-11 ruling inverts this: lifecycle authority lives on the device (embedded engine + 0-4 batch); the cloud's only jobs are (a) occasionally waking iOS devices, (b) relaying user-visible notifications the device asks for. Privacy consequence: no lifecycle processing of data at rest, ever.

## Design

### 1. Keepalive cron (best-effort, iOS only) — independently shippable, droppable

- One cron job in the existing push-service (or adjacent): **hourly, send a `content-available: 1` silent push to every known iOS device token**. Token source on the cloud side is Postgres **`user_devices`** (`cmd/push-service/resolver.go` — authorized devices with a `push_token`; FCM/APNs plumbing already exists). Do **not** grep for `device_push_tokens`: that is the *engine-side* SQLite table (engine migration 000039), which the backend never reads.
- No enrollment API, no per-entity tracking, no new tables, no version filtering (unlaunched — every token belongs to a current build).
- Delivery semantics: **fire-and-forget**. No retries, no delivery tracking (metrics counters only: sent/apns-accepted). Apple throttles by design (~few/hour budget, usage-pattern dependent, zero with Background App Refresh off) — correctness never depends on it (0-1 lazy + 0-4 catch-up converge on any later wake).
- Rationale on record: without it, iOS entities only advance on app-open/overnight — background outreach would never originate. With it, best-effort background presence. **Product may drop this component entirely** without any other phase changing.
- Server policy knobs: rate (default 1/h), kill switch.

### 2. Visible-push relay (device-initiated, opaque)

- `POST /v1/lifecycle/notify` — user-PASETO-authenticated; body: target device (default: caller's devices), **opaque payload** (≤4 KB APNs limit), optional pre-rendered alert text.
- The **device decides** what's worth a notification: outreach delivery, dream-worthy moments — eligibility decay (D-PUSH-04) is evaluated on-device by the engine (it owns last-user-message + prior-outreach data); the relay enforces only coarse abuse limits (per-user rate caps).
- Notification content privacy: payload may be ciphertext decrypted by a **Notification Service Extension** on-device (banner composed locally) — stretch option, not launch-blocking; plain-text alert via relay is the v1 default.
- Reuses push-service delivery + FCM/APNs channel; no engine imports.

### 3. Beat-budget policy via existing tier API

- `AutonomyBeatsPerDay` moves from worker-side valkey quota to **policy data the app fetches** through the existing authenticated tier/account API (extend its response; no lifecycle-specific endpoint). Cooperative on-device enforcement (0-4 `MaxBeats`); the inference gateway's existing per-user metering remains the billing/abuse backstop.
- The worker's valkey quota bookkeeping retires together with the worker itself.

### 4. Lifecycle-worker deletion (outright — no sunset staging)

- Delete `cmd/lifecycle-worker` (job scheduling members, quota keys, worker deploy config) in this phase, once 4-3 is live on our devices — the only consumers it ever had were our own builds.
- Seed path: the engine seeds lifecycle state for entities it creates (already true today); the session-broker seed producer stays untouched as frozen infra until Phase 6 (6-1).
- Result: **zero lifecycle engine imports in the backend.** Remaining engine imports (push-service, session-engine/warm-pool images, broker) are frozen infrastructure until Phase 6: 6-1 retires the session plane, 6-3 switches push-service to the Firebase Admin SDK and removes the last import — making the source-available relicense option (e.g. SSPL-family) executable; 6-4 then deletes the engine-side dead code (rows-v1 server + cloud-mode machinery).

## Implementation steps

1. Keepalive cron + policy knobs + metrics; E2E: iOS token receives push.
2. Relay endpoint: auth, payload-size validation, per-user rate caps, push-service dispatch; tests incl. abuse-limit case.
3. Tier API extension: add autonomy beat budget to the authenticated policy response; app consumption wired in 4-3.
4. Lifecycle-worker deletion PR: remove worker + deploy config + valkey quota plumbing; ops-docs + licensing-enabling note in repo README (source-available option completes with Phase 6 — 6-3).

## Files to create/modify

- `cmd/push-service/` (or new `cmd/lifecycle-keepalive/`): cron job
- `cmd/*/routes` or API layer: `POST /v1/lifecycle/notify` + tier policy extension
- `cmd/lifecycle-worker/`: **deleted**
- Ops docs, CHANGELOG.md

## Verification gates

- `go build ./...`, `go vet ./...`, `go test ./...` (minus pre-existing App-Control-blocked packages)
- E2E: keepalive sent → (device-side verification in 4-3); relay → FCM/APNs payload received; rate-cap enforced
- Worker gone: repo builds without `cmd/lifecycle-worker`; no lifecycle engine imports remain (grep gate in CI)

## Risks & rollback

- Silent-push throttling makes keepalive ineffective on some devices → accepted by design (bonus-tier semantics; product may drop the component)
- Relay abuse (spam via stolen PASETO) → per-user caps + existing auth revocation; opaque payloads mean the relay can't be used to exfiltrate readable content
- Worker deletion removes cloud lifecycle for any build that still expected it → sequencing, not gating: land after 4-3 is verified on devices (order tracked in 5-3)

## Progress checklist

- [x] Keepalive cron + knobs + metrics
- [x] Visible-push relay + rate caps
- [x] Tier policy extension (beat budget)
- [x] Lifecycle-worker deleted (+ quota/deploy plumbing)
- [x] Licensing-enabling note in ops docs

## Implementation notes (2026-10-11, soulbits-cloud-backend `feat/app-engine-parity`)

Implemented in `soulbits-cloud-backend`. `go build ./...`, `go vet ./...`,
`go test ./...` all green; `cmd/lifecycle-worker` package gone.

- **Keepalive cron** — `cmd/push-service/keepalive.go`. Hourly (default 3600s,
  `KEEPALIVE_INTERVAL_SEC`), kill switch `KEEPALIVE_ENABLED` (default true,
  documented droppable). Data-blind: sends an iOS `content-available: 1` silent
  push (`apns-push-type: background`, `content-available:1`, constant
  `data.kind="keepalive"`) to every authorized iOS token from Postgres
  `user_devices` (`platform='ios'`). Fire-and-forget; UNREGISTERED tokens are
  auto-disabled (token hygiene). Metrics: `push_keepalive_sent_total{status}`,
  `push_keepalive_devices_total`, `push_keepalive_errors_total`.
- **Relay** — `cmd/push-service/relay.go`: `POST /v1/lifecycle/notify`,
  user-PASETO-authenticated, body `{target_device_id?, payload (≤4096B),
  alert?{title,body}}`; opaque payload + optional pre-rendered alert; per-user
  hourly cap (`RELAY_MAX_PER_HOUR`, default 30, fail-closed). Env gate
  `RELAY_ENABLED`, PASETO key via `PASETO_KEY_SECRET_NAME`. Metrics:
  `push_relay_deliveries_total{status}`, `push_relay_rejected_total{reason}`.
  Served on push-service's existing HTTP port (`/health`+`/metrics`+relay) — no
  new listener; **operational step:** the ALB needs a `/v1/lifecycle/*` route to
  push-service (see report). Uses a self-contained FCM v1 sender
  (`sender.go`, no engine import) selected by the same `FCM_ENDPOINT` /
  FCM-creds policy as the outreach path.
- **Tier policy extension** — `cmd/subscription-service/handlers/handlers.go`
  adds `autonomy_beats_per_day` to `limits` for `/v1/subscription/me` and
  `/v1/subscription/tiers` (from the existing `TierDefinition.AutonomyBeatsPerDay`).
- **Worker deletion** — `cmd/lifecycle-worker/` + `Dockerfile.lifecycle-worker`
  removed; docker-compose service, deploy-workflow matrix/lists, Prometheus
  scrape job, Grafana regex, ECR repo list, IAM role for_each + worker S3 policy,
  ECS task-def/service/autoscaling (standalone + combined), restart-schedule
  entry, and the EC2 observability scrape list all updated. Worker-only Valkey
  plumbing removed: `CheckAndDecrementAutonomyQuota` + `ZRemIfScore` (+ tests).
  `pkg/session` snapshot-lease wrappers and `ZRange/ZAdd/ZPopMin/ZRem` primitives
  are KEPT (still used by the session-broker / dispatcher).
- **Docs** — lifecycle-plane-operations.md (4-4 banner + metrics + env knobs),
  cloud-data-deletion.md, README licensing-enabling note, CHANGELOG.md, tofu
  README; worker E2E suites removed from `tests/e2e`.
- **Deliberately left for later phases:** the `lifecycle.push` queue + consumer,
  the `lifecycle-dispatcher`, the broker seed producer, the `lifecycle_jobs`
  table, and the inference-gateway `lifecycle-worker` service-account row all
  remain as frozen infra → **6-1** (session-plane retirement). The engine
  `push` import in push-service remains → **6-3** (Firebase Admin SDK). Residual
  unused tofu variables (worker cpu/memory/capacity + service-account secret)
  left declared (valid Terraform) rather than cascaded.
