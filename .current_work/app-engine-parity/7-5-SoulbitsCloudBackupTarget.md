# Phase 7-5 — Engine+Cloud: SoulbitsCloudTarget (hosted backup storage option)

> **Repos:** `harmony-link-private` (new `BackupTarget` impl) + `soulbits-cloud-backend` (blob routes live in 7-1's service; quota in subscription-service)
> **Created:** 2026-10-12 (Phase 7)
> **Depends on:** **2-6** (backup artifact pipeline + `BackupTarget` interface — must land first), 7-1 (service shell + `s3-sync-backup` bucket)
> **Amends:** 2-6's "operator stores zero user database data" → same ruling amendment as the relay: **zero readable data** — blobs arrive already AEAD-encrypted under the user's backup DEK (2-6 pipeline); the operator stores opaque ciphertext, content-addressed by the engine-side hash.

## Objective

Offer Soulbits-hosted storage as a first-class backup target alongside iCloud/WebDAV/Dropbox/OneDrive/local: zero-setup backup for cloud-account users, quota'd by tier. The artifact pipeline, key-wrap set (W1–W4), and manifest semantics are **unchanged** — this is purely another destination for the already-encrypted objects.

## Design

### 1. Engine target (`SoulbitsCloudTarget`)

- Implements 2-6's `BackupTarget` interface exactly: upload baseline + side objects + manifest, download manifest + objects, list manifests (for restore picker).
- Transport: 7-1's backup REST routes (`PUT/GET /v1/backup/objects/{sha256}`, `GET/PUT /v1/backup/manifest/{device}`) — HTTPS + the same relay/account credential the app injects for sync (7-2's `relay_token` flow; the engine itself never authenticates to Soulbits).
- Auth material supplied by the app layer (per 2-6's design: targets receive credentials from outside); app settings UI adds "Soulbits Cloud" in 2-6's target picker when signed in, with quota display (`backup_storage_mb` from the tier, usage from `/v1/sync/usage`-class endpoint).
- Server-side dedupe by sha256 content address (same hash the manifest references) — free with content-addressed PUTs.

### 2. Cloud side (if not already landed inside 7-1)

Bucket `s3-sync-backup` (new tofu module — **not** the retired 6-2 snapshot plane: different bucket, different lifecycle, blind-blob policy documented), object lifecycle: none by default (user data), GDPR path = account purge flow extends to delete the bucket prefix (6-2's purge rework owns the hook — coordinate). Quota enforcement at upload (413 with usage headers); manifest whole-object replace per 2-6; `manifest.prev.json` convention identical.

### 3. Sizing & honesty copy

Quota defaults per tier (e.g. free 0 / premium 25 GB — **owner decision at execution time**, propose in report); the app's estimate UX (2-6) displays "~X MB → Soulbits Cloud (Y/Z GB used)". Recovery-code/W3 path unaffected (keys are client-side).

## Implementation steps

1. Cloud: bucket module + blob routes + quota + purge-hook coordination with 6-2's rework (if 7-1 didn't land them).
2. Engine: `SoulbitsCloudTarget` + unit tests against a fake HTTP server; integration with 2-6's scheduler (skip-if-unchanged, estimate).
3. App: target-picker entry + quota display + restore source.
4. openapi/docs/tests; E2E backup → wipe → restore via hosted target (compose).

## Verification gates

- Engine canonical env: build/vet/test exit 0. Cloud: build/vet/test + `tofu validate` green.
- E2E round-trip in compose (backup → wipe → restore from hosted target) green.

## Owner ops gates

- Bucket provisioning (tofu apply), quota defaults sign-off, GDPR purge runbook update.

## Progress checklist

- [x] Cloud bucket + routes + quota (+ purge hook)
- [x] Engine target + tests
- [x] App target-picker + restore
- [ ] E2E round-trip (wired; owner gate — blocked by the 000029 duplicate migration)
- [ ] Owner ops gates

## Implementation notes (2026-10-12, `feat/app-engine-parity`)

### Engine (`harmony-link-private`) — DONE

- **`modules/backup/target_soulbits.go`** — `SoulbitsCloudTarget` over the landed
  7-1 routes (`PUT/GET /v1/backup/objects/{sha256}`, `PUT/GET
  /v1/backup/manifest/{device}`) with the app-injected account PASETO. Sentinels
  `ErrAuthNeeded` (401/403) and `ErrQuotaExceeded` (429
  `backup_storage_quota_exceeded`); the management route maps them to HTTP
  401/429.
- **Design resolution (documented deviation):** the 7-1 server addresses objects
  by the sha256 of the **stored** object (`sha256(body) == path`), while the
  engine's generic object key embeds the **plaintext** sha256 (the stable
  dedup/GC address — 2-6). Because `BackupTarget.Get(key)` carries only the
  engine key, the target implements the optional **`HashAddressedTarget`**
  capability and the `Service` performs object I/O by `ObjectRef.ObjectSHA256`
  (two small `objectPut`/`objectGet` helpers). The manifest, the object pipeline
  and the key-wrap set are **unchanged**; other targets keep the plaintext-key
  path. The engine's `manifest.prev.json` (2-generation retention) maps to the
  sibling slot `<device>.prev` (same route, distinct path segment).
- **Enumeration gap (documented):** the 7-1 surface has no object-listing route,
  so `List(ObjectsPrefix)` returns nothing → the engine's GC/dedup no-op on this
  target (the server quota + the purge runbook own reclamation). A list route is
  a noted follow-up.
- **Management:** `GET /api/backup/targets` lists `soulbits-cloud`; the target
  descriptor accepts `device` (the app-supplied backup slot id).
- **Authority-side relay composition (7-2 residual)** —
  `syncclient/authority_relay.go` (`RelayAuthority`) + `Manager` wiring: an
  authority engine with relay config + a group key also dials the relay and
  bridges its `relayConn` to an authority `ChangesetSyncHandler` (role detected
  automatically; `transport=relay` + `store.Authority()`). Surfaces through the
  existing `relay` status block. Tests: a two-engine matrix over the fake relay
  using the **production** bridge, plus a Manager role-selection test. LAN suite
  untouched.
- **Tests:** fake-HTTP-server round-trip (backup → wipe → restore),
  content-addressed dedupe, quota + auth surfacing, `manifest.prev` semantics,
  skip-if-unchanged, name/key-mapping. Docs: `docs/Backup.md` hosted-target
  chapter + blind-ciphertext policy; `docs/Changeset-Sync.md` authority
  composition.

### App (`harmony-ai-app`) — DONE

- `BackupTargetType` gains `soulbits-cloud`; `BACKUP_TARGET_OPTIONS` adds it with
  `requiresSignIn` (the picker hides it when signed out).
  `BackupOrchestrator.buildTargetDescriptor` injects the PASETO + the
  `SYNC_RELAY.backupBaseUrl` + a stable slot (`BACKUP_CLOUD_SLOT = 'primary'`);
  `getCloudQuota()` reads `backup_bytes`/`quotas.backup_storage_mb` from
  `/v1/sync/status`; `withAuthRefresh` refreshes the PASETO and retries once on a
  hosted 401. `BackupSettingsScreen` shows the quota line + hides the option when
  signed out. New i18n keys; unit tests for the descriptor, quota, and refresh.

### Cloud (`soulbits-cloud-backend`) — DONE

- **GDPR purge hook:** `scripts/purge-backup-user.sh` (all-versions + delete
  markers under `backup/{user}/**` in `s3-sync-backup`, verified empty) + the
  account-deletion comment hook in `ConfirmAccountDeletion` (6-2's DB-only
  cascade cannot reach S3) + the blind-blob policy section in
  `docs/sync-relay-threat-model.md`. The routes/quota themselves landed in 7-1.

### Contract version

**Unchanged (1.1.0).** The backup routes are not part of the pinned management
contract, no sync endpoint/schema grew (the authority bridge reuses the existing
`relay` status block), and the app's `ENGINE_CONTRACT_VERSION` stays 1.1.0.

### Quota policy — RULED (owner, 2026-10-12; seeds updated in place)

Owner ruling: hosted backup storage (`backup_storage_mb`) = **free 1 GB / core
10 GB / infinite 50 GB** (free 1024 / core 10240 / infinite 51200 MB). The
doc's earlier sketch ("free 0 / premium 25 GB") and the first landed 7-1 seeds
(free 256 MB / core 2 GB / infinite 20 GB) are both superseded. Migration
000035 was uncommitted and never applied to any live/bootable DB (fresh-DB boots
are blocked by the standing 000029 duplicate), so the seeds were edited in place
— no new migration. `sync_buffer_mb` (64/512/4096) and `sync_devices` (3/5/10)
are **not** covered by this ruling and remain the as-landed policy defaults,
flagged to the owner at sign-off. No code change: values stay DB-configurable.

### Owner ops gates (unchecked)

1. **Compose E2E round-trip** — `tests/e2e/backup_target.go` (cloud repo,
   `-run BackupTarget`) drives the hosted surface end to end (objects +
   manifest rotation + backup → wipe → restore + quota 429 + status usage).
   **Blocked** by the standing **000029 duplicate migration** (fresh-DB compose
   boots fail; the kitten rename now targets 000038). Run once fixed:
   `docker compose --profile services --profile monitoring up` then, in
   `soulbits-cloud-backend/tests/e2e`, `go run . -run Auth,BackupTarget --reset`.
2. **On-device hosted backup → wipe → restore** — sign in, pick "Soulbits
   Cloud", back up, wipe, restore on a fresh install; confirm the quota line and
   the 401 refresh path.
3. **Authority-relay staging drill** — now that both sides are wired: two real
   devices, `transport=relay` on the desktop (authority) + phone, through the
   deployed staging relay (after 7-1 deploy), confirm desktop↔phone sync with no
   LAN.
4. **Bucket provisioning + purge runbook sign-off** — `tofu apply` the
   `s3-sync-backup` module; sign off the quota defaults and the per-user purge
   runbook.


