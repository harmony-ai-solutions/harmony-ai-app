# Phase 2-5 — Cloud Data Path (Cloud-Account Mode, On-Device Engine)

> **Repos:** `harmony-ai-app` (orchestration) + cloud backend (account/policy only — no engine code, no user data storage)
> **Assessment basis:** 2026-10-11 review ruling — the planned embedded↔cloud-session-engine changeset path is **obsolete**: new clients never sync lifecycle/chat data to a cloud engine peer. Backup/continuity: **user-owned cloud storage** ([research](research-user-storage-backup.md), decided 2026-10-11) — implemented in [2-6](2-6-UserStorageBackupRestore.md); this phase covers the cloud-account orchestration and the account-side key escrow.
> **Depends on:** 2-3, 2-4 (peer protocol, client role — desktop ↔ embedded only); supersedes the original dual-protocol cloud path of this phase
> **Note:** session hosting infra retirement itself is **Phase 6 (this plan)** — until then the running infra is simply unused by the app.
> **Codebase mapping consulted:** `.planning/codebase/` — app + cloud backend repos (ARCHITECTURE.md, STRUCTURE.md, INTEGRATIONS.md)

## Objective

"Cloud mode" names the *account*, not the compute location: the user is signed in with their SoulbitsCloud account (inference entitlements, tier policy, backup key escrow), but the embedded engine IS the engine. The cloud contributes exactly: auth/account, the inference API, tier policy, keepalive/relay (4-4), and the **W1 backup-key escrow** (2-6) — and stores **zero user database data**. The S3 snapshot plane + per-user DEK infrastructure that the original draft of this phase assumed for backup is **retired in 6-2** (it belonged to the removed session feature).

## Design

- **Cloud mode startup:** start embedded engine → inject/refresh SoulbitsCloud provider configs (existing `soulbitsTokenSync` + `injectSoulbitsToken`; in embedded mode the "sync to engine" step becomes a direct local write) → chat + lifecycle fully on-device. No session provisioning; `CloudSessionService` becomes dead code and is deleted in 3-4.
- **Continuity = user-owned storage backup (2-6):** encrypted artifact snapshots to the user's own cloud storage (iOS: iCloud Drive container; integrated: WebDAV/Dropbox/OneDrive; local export everywhere; Google Drive only behind Google's written consent — not in v1). Restore offered at fresh-install onboarding.
- **W1 backup-key escrow endpoint (cloud backend, this phase):** `PUT/GET/DELETE /v1/account/backup-key` — PASETO-authenticated; stores the 2-6 backup DEK wrapped under a server-side KMS-wrapped KEK (envelope, mirroring the existing keystore pattern — **without** re-creating `pkg/keystore`; a narrow account-scoped store). Honest-claim wording per the research doc (§3.5). Escrow drop hooks into the account-deletion flow rework (6-2).
- **Fresh installs:** no migration path exists, by ruling (unlaunched product) — a new install either starts empty or restores from the user's latest backup (2-6).

## Implementation steps

1. App: cloud-mode orchestration (embedded engine + config injection; no `CloudSessionService` call) behind the phase flag.
2. Cloud: W1 escrow endpoints (store/fetch/delete wrapped DEK; KMS CMK; audit log line); consumed by 2-6's orchestrator.
3. Cloud: verify no other account/policy endpoint assumed a session context.
4. Staging E2E: cloud chat fully on-device; escrow round-trip (set → read on "new device").

## Files to create/modify

- App: cloud-mode orchestration in `src/services/engine/` (flagged), `src/services/cloud/soulbitsClient.ts` additions
- Cloud backend: auth-service account route + handler (escrow), tests; no engine imports (assert in review)

## Verification gates

- Staging E2E green: on-device cloud chat; escrow round-trip
- Zero cloud-side engine imports added; zero user-database storage touched by the backend (grep gate)

## Risks & rollback

- Escrow endpoint becomes accidental data magnet → scope strictly to the wrapped-key blob (size/type validation); review gate
- App-flagged until 3-4 deletes the old path; flag reverts behavior until then

## Progress checklist

- [x] Cloud-mode orchestration (embedded engine, no session) behind flag — flag + module + wiring + tests landed; the SoulbitsCloud **provider-config injection step is BLOCKED** on a missing engine-side management route (see implementation notes)
- [x] W1 escrow endpoints + tests — `PUT/GET/DELETE /v1/account/backup-key` + KMS-envelope store, handler + store tests green
- [ ] Staging E2E green (on-device cloud chat + escrow round-trip) — **owner/ops gate**

## Implementation notes (2026-10-11, `feat/app-engine-parity`)

### Cloud (`soulbits-cloud-backend`) — W1 escrow: DONE

- **Migration `000032_create_account_backup_keys`** — a NARROW account-scoped
  table (one row per account: `user_id` PK → `users(id) ON DELETE CASCADE`,
  `wrapped_key_enc BYTEA`, timestamps). Not `pkg/keystore`; no per-user plaintext
  custody, no DEK generation, no data-plane read path.
- **Store `cmd/auth-service/backupkey/`** — KMS envelope at rest (mirrors the
  keystore's `kms.Encrypt/Decrypt` usage via the same minimal
  `KMSEncryptDecrypt` seam). `Put` KMS-encrypts the client blob; `Get`
  KMS-decrypts and returns `(blob, found)`; `Delete` is idempotent.
- **Handler `cmd/auth-service/handlers/backupkey.go`** — `PUT/GET/DELETE
  /v1/account/backup-key`, PASETO-only (API keys refused 403). Strict scope:
  `wrapped_key` (base64) only, ≤1 KiB decoded (413 over), ≤8 KiB body.
  Audit log line on every mutation (`user_id` + size; blob never logged).
  Nil store (no `KMS_CMK_ARN`) → 503, so minimal/test setups still run.
- **Wiring** — `main.go` builds the store from `KMS_CMK_ARN` + `ECS_REGION`;
  routes registered in the PASETO-protected `/v1` group.
- **OpenAPI** — `/v1/account/backup-key` (put/get/delete) + `BackupKeyPutRequest`
  / `BackupKeyResponse` / `BackupKeyStatus` schemas; spec tests green.

### Cloud — step 3 audit (account/policy session-context assumption): CLEAN

- **auth-service:** the ONLY auth→session-broker coupling is `accountpurge.go`
  (`BrokerPurgeClient` → `POST /v1/session/data/delete`) — the GDPR
  account-deletion purge, already slated for rework in 6-2. It is not an
  account/policy endpoint "assuming a session context" in the
  `CloudSessionService` sense; it is a data-plane teardown called on delete.
- **subscription-service:** zero session references — `/v1/subscription/*`
  resolves the tier from the PASETO auth context only.
- **auth-service handlers:** all other "session" references are the auth
  sign-in session model (PASETO `session_id` / refresh-token families), which
  is correct and independent of the cloud engine session.
- Conclusion: no other account/policy endpoint assumed a cloud engine session
  context; nothing else needs changing for 2-5.

### App (`harmony-ai-app`) — cloud-mode orchestration: PARTIAL (one BLOCKED step)

- **Flag** `ENGINE_CLOUD_MODE_ON_DEVICE` (`src/config/engineFeatures.ts`, default
  off) + boot hydration of both engine flags (`DatabaseContext`).
- **Module `src/services/engine/cloudModeOrchestration.ts`** — starts the
  embedded engine (idempotent), refreshes the SoulbitsCloud provider configs as
  a direct local write, and fetches the tier's `autonomy_beats_per_day` budget;
  subscribes to `auth:changed` for token rotation. `CloudSessionService` is not
  called on this path (dead code; deleted in 3-4).
- **`soulbitsClient.ts`** — `fetchMySubscription` + `fetchAutonomyBeatsPerDay`.
- **`AuthContext`** — when the flag is on and authenticated, starts the
  orchestration and suppresses the legacy `cloudSessionService.connect()`.
- **Tests** — flag, orchestration seams + subscription lifecycle, client
  subscription mapping, `EngineApiClient.refreshSoulbitsCloudProviderConfigs`.

> **BLOCKED — engine-side provider-config injection route.** The doc assumes
> "provider config injection endpoints exist engine-side"; they do NOT. The
> engine management API exposes only `GET /api/providers` and
> `GET /api/providers/{id}` (verified in `harmony-link-private/management/
> routes_providers.go` + `server.go`), and its token seed
> (`seedCloudSoulbitsCloudProvider`) is `CLOUD_MODE`-gated (env/`.inference-token`).
> The app-side call targets the required contract
> `POST /api/providers/soulbitscloud/refresh-token` (body `{api_key, base_url?}`
> → `{updated}`) and is treated as non-fatal until the route lands. Engine repo
> is out of scope for this task. See the final report for options.

> **RESOLVED (2026-10-11 follow-up):** the engine-side route `POST /api/providers/soulbitscloud/refresh-token` (body `{api_key, base_url?}` → `{updated}`) has landed in `harmony-link-private` (`management/routes_providers.go` handler + `management/server.go` registration, loopback-authed via `mobileAuthMiddleware`), so step 2 is no longer blocked.
