# Phase 6-3 — Cloud: Engine-Import Zeroing & Relicensing Enabler

> **Repo:** `soulbits-cloud-backend`
> **Assessment basis:** 4-4 deleted the lifecycle engine code; the relicense-to-source-available option (e.g. SSPL-family) completes only when the backend carries **zero** engine dependencies. One blocker remains: a keeper service imports the engine. Resolution ruled 2026-10-11 after a Go push-library survey (recorded below).
> **Depends on:** 6-1 (worker/dispatcher gone — the only other engine importers), 4-3 verified (outreach eligibility is evaluated on-device, so the engine-side decay-context SQL is dead weight)

## Objective

Make `soulbits-cloud-backend` build and deploy with **zero references to `harmony-link-private`** — no Go imports, no `replace` directives, no committed vendor tree, no CI engine-clone, no engine container images. This is the gate that makes the relicensing decision executable (the decision itself is legal/business, out of plan scope).

## The blocker: `cmd/push-service` imports `harmony-link-private/push`

Current imports: `resolver.go`, `push.go`, `push_test.go` (FCM notifier, `LocalTokenResolver` reading the DB, `decay_context.go` — engine-SQLite-shaped SQL for composing outreach notification context server-side, a lifecycle-worker fossil).

## Resolution — backend adopts the Firebase Admin SDK; engine keeps its light path (ruled 2026-10-11)

**Library survey digest:** our wrapper's non-duplicated delta over the official `google.golang.org/api/fcm/v1` client is only ~150–250 LOC (error classification, retry, fan-out). `firebase.google.com/go/v4/messaging` (Apache-2.0, actively maintained — v4.22.0, Sep 2026) provides all of it: `SendEach`/`SendEachForMulticast` (≤500 fan-out), the full error taxonomy (`IsUnregistered`, `IsQuotaExceeded`, `IsUnavailable`…). Alternatives rejected: `appleboy/go-fcm` (thin wrapper over the same SDK, same weight), `cristalhq/fcm` (niche taken but 1-maintainer, string-only errors), legacy-API libs (dead), extracting our own OSS lib (delta too small to justify a public repo).

**Why the asymmetry:** the Admin SDK's ~40-dependency tree (grpc, otel, …) is acceptable **server-side** but wrong for the engine — it compiles into every mobile install (`libengine.so`, iOS XCFramework via gomobile/CGO: binary size, build time, CVE-pinning surface), while the *embedded* engine barely pushes directly at all (on-device outreach goes through the 4-4 relay). The engine's existing internal `push/` package is already the right light implementation — it stays, unchanged except `decay_context.go` (deleted in 6-4).

1. **Backend switch:** push-service moves to `firebase.google.com/go/v4/messaging`:
   - Client construction from the existing service-account credentials/config
   - Keepalive cron fan-out via `SendEachForMulticast` chunks (≤500 tokens/call) — maps 1:1 onto the 4-4 hourly job
   - Relay dispatch via `Send` (single opaque payload, 4-4)
   - **New hygiene the old code lacked:** per-token `IsUnregistered` → prune `device_push_tokens`; `IsQuotaExceeded`/`IsUnavailable` → backoff + metric counters (keepalive stays fire-and-forget semantically)
   - Token resolution stays backend-side (user → device tokens from Postgres). `LocalTokenResolver`'s engine-DB reading and `decay_context.go` die **unported** — outreach eligibility is on-device per 4-3/D-PUSH-04; the relay never composes content
2. **Engine: zero change in this phase** (its `push/` package stays internal; 6-4 deletes only `decay_context.go` from it)
3. **Module-graph cleanup:** remove `require harmony-ai-solutions/harmony-link-private` and the three `replace` directives (engine, `jgiannuzzi/go-sqlite3` fork — only needed to open encrypted engine DBs, `chromem-go` fork), regenerate `go.sum`; `vendor/` (committed) is deleted — note the Admin SDK's dependency tree enters `go.mod` but lives in the module cache, not a vendor tree; `Dockerfile` drops `-mod=vendor` + the vendor-prereq comment; deploy workflows delete the "Authenticate git for private harmony-ai-solutions modules", "Clone Harmony Link engine (sibling)", and "Generate vendor directory" steps (dev + prod)
4. **Permanent CI grep gate:** zero occurrences of `harmony-link-private` / `hl_database` / engine `replace` patterns in the backend repo — so the dependency cannot silently return
5. Cleanup leftovers if 6-1 didn't catch them: `docker-compose.yml` engine-image env blocks, `pkg/config` image fields, stale root CGO probes (`lifecycle-cgo-smoke.exe`, `tmp_cgo_probe.exe`) + .gitignore hygiene

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

- [ ] push-service on Admin SDK (cron fan-out, relay, token pruning, backoff)
- [ ] Engine import + replaces/vendor/Dockerfile/workflow removal
- [ ] CI grep gate added
- [ ] Staging push round-trip green (keepalive + relay + pruning)
- [ ] Relicensing-enabling README note updated
