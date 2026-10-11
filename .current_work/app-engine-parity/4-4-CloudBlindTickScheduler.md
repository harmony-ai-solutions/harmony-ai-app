# Phase 4-4 — Cloud: Keepalive Cron, Push Relay & Worker Deletion

> **Repo:** `soulbits-cloud-backend` (branch `feat/app-engine-parity`)
> **Assessment basis:** 2026-10-11 review ruling — on-device lifecycle authority; the cloud becomes data-blind for lifecycle
> **Depends on:** 0-4 (engine batch API shipped to the app); 4-2/4-3 consume it. The cron + relay can ship earlier (no-op until the app registers handlers).

## Objective

Replace cloud lifecycle **execution** with two data-blind primitives — a best-effort hourly keepalive push (iOS only) and a device-initiated visible-push relay — and **delete the lifecycle-worker outright**. End state: the cloud never opens a user snapshot for lifecycle, never imports engine packages for lifecycle, and the backend carries no lifecycle engine code at all.

Pre-launch ruling (2026-10-11): no old versions exist in the wild — no freeze window, no kill-switch, no sunset gate, no version floors. The worker is removed in one step once the on-device path (4-3) is live on our devices.

## Context

The lifecycle-worker today downloads each user's encrypted snapshot, opens it with the per-user DEK, runs engine beats server-side, uploads, and pushes outreach (D-SYNC-02/D-BEH-04). The 2026-10-11 ruling inverts this: lifecycle authority lives on the device (embedded engine + 0-4 batch); the cloud's only jobs are (a) occasionally waking iOS devices, (b) relaying user-visible notifications the device asks for. Privacy consequence: no lifecycle processing of data at rest, ever.

## Design

### 1. Keepalive cron (best-effort, iOS only) — independently shippable, droppable

- One cron job in the existing push-service (or adjacent): **hourly, send a `content-available: 1` silent push to every known iOS device token** (`device_push_tokens` + FCM/APNs plumbing already exists).
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
- Seed path: the engine seeds lifecycle state for entities it creates (already true today); the session-broker seed producer stays untouched as frozen infra (cleanup plan).
- Result: **zero lifecycle engine imports in the backend.** Remaining engine imports (session-engine/warm-pool images, broker) are frozen infrastructure the cloud-cleanup plan retires; full engine-dependency removal — and with it the option to relicense source-available (e.g. SSPL-family) — completes with that cleanup plan, which this phase only *enables*.

## Implementation steps

1. Keepalive cron + policy knobs + metrics; E2E: iOS token receives push.
2. Relay endpoint: auth, payload-size validation, per-user rate caps, push-service dispatch; tests incl. abuse-limit case.
3. Tier API extension: add autonomy beat budget to the authenticated policy response; app consumption wired in 4-3.
4. Lifecycle-worker deletion PR: remove worker + deploy config + valkey quota plumbing; ops-docs + licensing-enabling note in repo README (source-available option completes with the cleanup plan).

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

- [ ] Keepalive cron + knobs + metrics
- [ ] Visible-push relay + rate caps
- [ ] Tier policy extension (beat budget)
- [ ] Lifecycle-worker deleted (+ quota/deploy plumbing)
- [ ] Licensing-enabling note in ops docs
