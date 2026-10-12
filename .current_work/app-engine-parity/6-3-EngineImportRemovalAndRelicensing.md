# Phase 6-3 — Cloud: Engine-Import Zeroing & Relicensing Enabler

> **Repo:** `soulbits-cloud-backend`
> **Assessment basis:** 4-4 deleted the lifecycle engine code; the relicense-to-source-available option (e.g. SSPL-family) completes only when the backend carries **zero** engine dependencies. One blocker remains: a keeper service imports the engine. Resolution ruled 2026-10-11 after a Go push-library survey (recorded below).
> **Depends on:** 6-1 (worker/dispatcher gone — the only other engine importers), 4-3 verified (outreach eligibility is evaluated on-device, so the engine-side decay-context SQL is dead weight)
> **Codebase mapping consulted:** `.planning/codebase/` (cloud — soulbits-cloud-backend): ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, INTEGRATIONS.md

## Objective

Make `soulbits-cloud-backend` build and deploy with **zero references to `harmony-link-private`** — no Go imports, no `replace` directives, no committed vendor tree, no CI engine-clone, no engine container images. This is the gate that makes the relicensing decision executable (the decision itself is legal/business, out of plan scope).

## The blocker: `cmd/push-service` imports `harmony-link-private/push`

What the backend actually pulls from the engine package (verified in `cmd/push-service/push.go`/`resolver.go`/`push_test.go`): the **FCM notifier wrapper** (`push.Notifier`, `push.NewNotifierFromCreds`, `push.FCMNotifier`, `push.NoopNotifier`, `push.BuildFCMPayload`, `push.ErrDeviceUnregistered`, `push.Notification`) plus the `push.DeviceTokenResolver` interface — implemented backend-side by the **Postgres `user_devices` resolver** (`resolver.go`). Attribution correction (2026-10-11 review): `LocalTokenResolver` (`push/local.go` — engine SQLite `device_push_tokens`) and `GatherDecayContext` (`push/decay_context.go`) are **engine-side** code the backend never imported; `GatherDecayContext`'s only consumer was `cmd/lifecycle-worker/job.go`, deleted in 4-4.

## Resolution — backend adopts the Firebase Admin SDK; engine keeps its light path (ruled 2026-10-11)

**Library survey digest:** our wrapper's non-duplicated delta over the official `google.golang.org/api/fcm/v1` client is only ~150–250 LOC (error classification, retry, fan-out). `firebase.google.com/go/v4/messaging` (Apache-2.0, actively maintained — v4.22.0, Sep 2026) provides all of it: `SendEach`/`SendEachForMulticast` (≤500 fan-out), the full error taxonomy (`IsUnregistered`, `IsQuotaExceeded`, `IsUnavailable`…). Alternatives rejected: `appleboy/go-fcm` (thin wrapper over the same SDK, same weight), `cristalhq/fcm` (niche taken but 1-maintainer, string-only errors), legacy-API libs (dead), extracting our own OSS lib (delta too small to justify a public repo).

**Why the asymmetry:** the Admin SDK's ~40-dependency tree (grpc, otel, …) is acceptable **server-side** but wrong for the engine — it compiles into every mobile install (`libengine.so`, iOS XCFramework via gomobile/CGO: binary size, build time, CVE-pinning surface), while the *embedded* engine barely pushes directly at all (on-device outreach goes through the 4-4 relay). The engine's existing internal `push/` package is already the right light implementation — it stays, unchanged except `decay_context.go` (deleted in 6-4).

1. **Backend switch:** push-service moves to `firebase.google.com/go/v4/messaging`:
   - Client construction from the existing service-account credentials/config
   - Keepalive cron fan-out via `SendEachForMulticast` chunks (≤500 tokens/call) — maps 1:1 onto the 4-4 hourly job
   - Relay dispatch via `Send` (single opaque payload, 4-4)
   - **New hygiene the old code lacked:** per-token `IsUnregistered` → prune the `user_devices` push tokens (Postgres — `UPDATE user_devices SET push_token = NULL …` per the existing resolver contract); `IsQuotaExceeded`/`IsUnavailable` → backoff + metric counters (keepalive stays fire-and-forget semantically)
   - Token resolution stays backend-side (user → device tokens from Postgres `user_devices`). Engine-side `push/decay_context.go` (dead since 4-4 deleted its only caller) is deleted in **6-4**; engine `push/local.go` (`LocalTokenResolver` — engine-internal SQLite path) stays with the engine's internal `push/` package, untouched by this phase
2. **Engine: zero change in this phase** (its `push/` package stays internal; 6-4 deletes only `decay_context.go` from it)
3. **Module-graph cleanup:** remove `require harmony-ai-solutions/harmony-link-private` and the three `replace` directives (engine, `jgiannuzzi/go-sqlite3` fork — only needed to open encrypted engine DBs, `chromem-go` fork), regenerate `go.sum`; `vendor/` (committed) is deleted — note the Admin SDK's dependency tree enters `go.mod` but lives in the module cache, not a vendor tree; `Dockerfile` drops `-mod=vendor` + the vendor-prereq comment; deploy workflows delete the "Authenticate git for private harmony-ai-solutions modules", "Clone Harmony Link engine (sibling)", and "Generate vendor directory" steps (dev + prod)
4. **Permanent CI grep gate:** zero occurrences of `harmony-link-private` / `hl_database` / engine `replace` patterns in the backend repo — so the dependency cannot silently return
5. Cleanup leftovers if 6-1 didn't catch them: `docker-compose.yml` engine-image env blocks, `pkg/config` image fields, stray build artifacts + .gitignore hygiene — sweep **all** stray `*.exe` at repo root and under `cmd/`/`scripts/` (verified present: `auth-service.exe`, `baremetal-scheduler.exe`, `cmd/conduct-proxy/conduct-proxy.exe`, `cmd/session-broker/session-broker.exe`, `cmd/session-sidecar/session-sidecar.exe`, `fcm-mock.exe`, `inference-gateway.exe`, `lifecycle-cgo-smoke.exe`, `tmp_cgo_probe.exe`), excluding `.terraform/` provider caches

## Verification gates

- `go build ./...`, `go vet ./...`, `go test ./...` green with the module graph clean
- CI grep gate added and green
- Deploy workflows build + deploy from the repo alone (no sibling clone, no private-module auth); dev env healthy
- Staging push round-trip on the new SDK: keepalive `SendEachForMulticast` chunking correct; relay delivery end-to-end; **unregistered-token pruning verified** (insert a dead token, observe prune); quota-error backoff path exercised

## Risks & rollback

- Admin SDK dependency tree (grpc/otel) enters the backend — accepted server-side; pin versions deliberately; go.sum review in the PR
- Push behavior changes during the switch → port the notifier's test intent (token resolution, error handling) to the SDK's API; staging round-trip before prod; behavior diff checklist (delivery, error mapping, retry)
- No engine code is copied anymore — the earlier copy/licensing footnote is **obsolete** (nothing shared between the repos)

## Progress checklist

- [x] push-service on Admin SDK (cron fan-out, relay, token pruning, backoff)
      — done: `cmd/push-service` uses `firebase.google.com/go/v4/messaging`
      (`Send` for relay, `SendEachForMulticast` ≤500 for the keepalive cron and
      per-user outreach fan-out); per-token `IsUnregistered` → `user_devices`
      prune; `IsQuotaExceeded`/`IsUnavailable` → metric counters (transient
      backoff is provided by the SDK's built-in retry). Local/E2E keeps a
      mock-endpoint transport (`FCM_ENDPOINT`) so the existing mock-fcm-server
      contract still holds.
- [x] Engine import + replaces/vendor/Dockerfile/workflow removal — done:
      `require harmony-link-private` + all three `replace` directives gone;
      `vendor/` deleted; `Dockerfile` drops `-mod=vendor`; deploy-dev removes the
      private-module-auth / engine-clone / vendor-generation steps; the stale
      `harmony_link_version` deploy-prod input + sed removed; dead
      `pkg/config.InferenceBaseURL` swept.
- [x] CI grep gate added — `.github/workflows/dependency-guard.yml`
      (zero `harmony-link-private` / `hl_database` / engine-fork references on
      the dependency surfaces: Go source, go.mod/go.sum, Dockerfiles,
      docker-compose, workflows).
- [ ] Staging push round-trip green (keepalive + relay + pruning) — OWNER GATE:
      requires real Firebase credentials in the `soulbits/{env}/fcm` secret and a
      staging deploy; not executable from the dev workstation.
- [x] Relicensing-enabling README note updated — done (README §"Licensing /
      source-availability note").

### Owner ops gates (not executable in the dev workspace)

1. `tofu apply` for the touched modules (dev/prod) — picks up the new
   `KMS_CMK_ARN` auth-service env and the `backup_key_kms` IAM policy (see the
   6-3 add-on below).
2. Firebase project provisioning + FCM service-account JSON written into the
   `soulbits/{env}/fcm` Secrets Manager secret (owned by the firebase tofu root).
3. Staging push round-trip on the new SDK (keepalive chunking, relay delivery,
   unregistered-token pruning, quota-error path).

### Add-on (owner-approved, flagged by 6-2): W1 backup-key escrow wiring

- `KMS_CMK_ARN` (plain env — an ARN is not a secret) added to the auth-service
  container in both the standalone task def and the backend-combined-api task def.
- New scoped IAM policy `backup_key_kms` (`kms:Encrypt`/`Decrypt`/`GenerateDataKey`
  on the retained escrow CMK ARN only), attached to the auth-service task role
  and the backend-combined union role. `tofu validate` green; apply = owner gate.
