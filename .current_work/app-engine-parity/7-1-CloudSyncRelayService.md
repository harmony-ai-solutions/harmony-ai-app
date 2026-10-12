# Phase 7-1 — Cloud: Sync Relay Service (data-blind transport)

> **Repo:** `soulbits-cloud-backend` (new service `cmd/sync-relay` + auth-service pairing endpoints + IaC)
> **Created:** 2026-10-12 (owner-approved Phase 7; amends the 2026-10-11 "no user data in cloud" ruling → **no *readable* user data**: blind, E2E-encrypted blobs only)
> **Depends on:** 6-1 (session plane retired; conduct-proxy deleted — pattern reference only, in its git history), 2-3/2-4 wire semantics (reference; engines terminate the protocol, the relay transports frames)
> **Pattern basis:** conduct-proxy WS routing (git history), push-service PASETO REST (4-4), lifecycle-dispatcher ZSET claim loop (git history), auth-service device registry (live: `/v1/devices` + `user_devices.authorized`)

## Objective

A relay service that lets a user's engines (desktop + phones) exchange changeset-v1 frames **through the cloud** when they are not on the same LAN — and buffer frames for devices that are offline. The relay is a **blind pipe**: it never parses, stores-in-the-clear, or interprets sync payloads; all frames are E2E-encrypted by the engines (7-2). It is **not** an engine peer: epoch/handover/authority logic runs engine-to-engine unchanged; the relay preserves per-sender order and nothing else. Correctness never depends on the relay — the 2-2 store's rejoin/baseline rule converges after any relay data loss (buffers are an optimization, TTL'd and disposable).

## Design

### 1. Service shape (`cmd/sync-relay`)

- **Transport in:** one WebSocket endpoint (`/v1/sync/ws`) + thin REST (`/v1/sync/*`) for pairing-token exchange, buffer status, and health. Gorilla WS per repo conventions.
- **Auth:** PASETO bearer (the 4-4 push-service relay pattern: `Authorization: Bearer <paseto>`, local-public-key verification, claims `sub` = user id, `device_id`, `dataset_id`). Token issuance stays with auth-service (portal/app sign-in) — the relay only verifies.
- **Device gate:** the connecting device must be a registered, authorized device — verify against auth-service's device registry (`user_devices` row for `device_id`, `authorized=true`) following the repo's existing internal service-authz pattern (how inference-gateway checks subscription state today). Unauthorized/revoked → close with policy code.
- **Model:** per-account **sync group** = the set of the user's devices sharing one `dataset_id`. Relay state (Valkey or in-memory + persistent buffer):
  - **Live fan-out:** connected members receive frames from any sender in real time, per-sender FIFO.
  - **Offline buffer:** frames for absent members append to a per-(account, dataset, device) ordered buffer (Redis streams/ZSET per the dispatcher pattern, or equivalent); a reconnecting device drains from its last-acked seq. **TTL 7d** (≤ the engine store's 14-day retention; data beyond that is recovered by baseline rejoin, never by the relay). Hard byte cap per account from the tier (below) — on overflow drop-oldest + set an overflow flag surfaced in status (the engine re-baselines; correctness holds).
  - **Acks:** per-recipient ack of seq → buffer trim. Acks are transport-level only (engine-level CHANGESET_ACK still flows inside the encrypted payload).
- **Envelope (all the relay ever sees):** `{v, sender_device_id, dataset_id, seq, aead_frame}` — opaque bytes beyond that. No JSON parsing of `aead_frame`, ever; enforce a max frame size (e.g. 4 MiB) at the envelope level.
- **Quotas (tier):** new subscription limits — `sync_buffer_mb` (default tier e.g. 64), `sync_devices` (max group size, e.g. 3). Enforcement + `429`/policy close codes; surfaced via `/v1/sync/status`.

### 2. Pairing tokens (auth-service)

Short-lived, single-use **pairing tokens** binding (user, device, dataset) — minted on device request (PASETO-authenticated), consumed by the relay at first connect (elevates the connection to group membership). Design detail shared with 7-4 (portal QR) and 7-2 (engine client): token = opaque ~128-bit string, TTL 5 min, one-time. New auth-service endpoints (PASETO-authenticated): `POST /v1/devices/sync-pairing` (mint), relay-side `POST /v1/sync/pairing/consume`. Revocation of a device (existing `/v1/devices/{id}` DELETE) must kick its relay connections and trigger key rotation (7-2) — the relay implements the kick; rotation is the engines'/portal's concern.

### 3. Backup blob routes (for 7-5, same service)

Two REST route groups on the same service (one deploy, one quota story): `PUT/GET /v1/backup/objects/{sha256}` + `GET/PUT /v1/backup/manifest/{device}` — opaque AEAD blobs (already encrypted by the engine's 2-6 pipeline) to a **new** S3 bucket (`s3-sync-backup` module — distinct from the retired 6-2 snapshot plane; blind blobs only, content-addressed by the engine-side hash). Quota `backup_storage_mb` per tier. Implemented here only if 7-5 is in scope when this task runs; otherwise leave route stubs out and 7-5 adds them.

### 4. Infra & observability

Tofu: new `sync-relay` service (ECS/combined container, ALB WS listener rules — conduct-proxy's deleted ALB wiring is the reference in git history), ECR entry, IAM (PASETO public key secret, S3 access for backup bucket, Valkey), deploy-dev/prod matrices, compose/dev service + `.env.example`, Prometheus/Grafana entries (connections, buffer bytes, drops, quota rejections). openapi additions for REST routes; e2e suite (connect → fan-out → offline buffer → drain → overflow → revoke-kick) using the repo's e2e harness; Bruno collection update.

## Threat model (document in-repo)

- The relay sees: account identity, device ids/dataset ids, connection times, frame counts/sizes/timing. It cannot see contents (AEAD, keys never transit the relay). Accepted-metadata list documented like 2-6's manifest note.
- Denial-of-service by the relay = availability risk only (engines converge via LAN or baseline rejoin).
- Replay: relay passes seq-tagged frames; engines reject non-monotonic/duplicate seq (7-2 pins this in tests).

## Implementation steps

1. Service skeleton: WS endpoint + PASETO verify + device gate + live fan-out (in-memory) + tests.
2. Persistent buffer (streams/ZSET, TTL, byte cap, drain-on-reconnect, ack trim) + overflow flag.
3. Pairing-token endpoints (auth-service + relay consume) + revoke-kick path.
4. Tier quota fields (subscription-service) + enforcement + status endpoint.
5. (If 7-5 in scope) backup blob routes + `s3-sync-backup` bucket module.
6. IaC + CI/deploy + compose + monitoring + openapi + e2e + docs.

## Verification gates

- `go build ./...`, `go vet ./...`, `go test ./...` green; `tofu validate` green on touched modules.
- Grep gate: relay never imports a JSON-decoder path over `aead_frame` (enforced by test: fuzzed/malformed frames pass through or are size-rejected, never parsed).
- E2E (local compose): two fake engines (test harness clients) fan-out + offline-buffer + drain round-trip.

## Owner ops gates

- ALB WS routing + tofu plan/apply (dev→prod); pairing-token TTL/quota policy sign-off.

## Progress checklist

- [ ] Service skeleton + auth + device gate + fan-out
- [ ] Persistent buffer + TTL + quota + overflow
- [ ] Pairing tokens + revoke-kick
- [ ] Tier limit fields + enforcement
- [ ] Backup blob routes (with 7-5)
- [ ] IaC/CI/compose/monitoring/openapi/e2e/docs
- [ ] Owner ops gates
