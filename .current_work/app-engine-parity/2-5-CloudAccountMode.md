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

- [ ] Cloud-mode orchestration (embedded engine, no session) behind flag
- [ ] W1 escrow endpoints + tests
- [ ] Staging E2E green (on-device cloud chat + escrow round-trip)
