# Phase 2-5 — Cloud Data Path (On-Device Engine + Device-Owned Backup)

> **Repos:** `harmony-ai-app` (orchestration) + cloud backend (policy only — no engine code)
> **Assessment basis:** 2026-10-11 review ruling — the planned embedded↔cloud-session-engine changeset path is **obsolete**: new clients never sync lifecycle/chat data to a cloud engine peer (warm pool becomes functionally unused; physical retirement stays in the deferred cloud-cleanup plan)
> **Depends on:** 2-3, 2-4 (peer protocol, client role — desktop ↔ embedded only); supersedes the original dual-protocol cloud path of this phase
> **Note:** infra cleanup (broker/warm-pool/proxy retirement) remains DEFERRED to the cloud-cleanup plan. Pre-launch ruling: no old-version support — cloud session engines simply become unused by the app once 3-4 lands.

## Objective

Give cloud-mode users a fully on-device architecture with a device-owned continuity story — **without** any engine peer in the cloud:

1. **Cloud mode (new architecture):** "cloud mode" names the *account*, not the compute location — the user is signed in with their SoulbitsCloud account (inference entitlements, tier policy, backup), but the embedded engine IS the engine: chat runs on-device against injected SoulbitsCloud inference configs (existing PASETO/token-sync plumbing); there is no cloud engine peer to sync with. Lifecycle runs on-device (4-3/4-4 model). The cloud contributes only: auth/account, the inference API, tier policy, keepalive/relay (4-4), and encrypted-backup blob storage.
2. **Continuity:** encrypted engine-DB **backup/restore** replaces the cloud-authoritative copy — reusing the existing S3 snapshot plane + per-user DEK infrastructure (upload/download only; no cloud process ever opens the DB).
3. **Fresh installs:** no migration path exists, by ruling (unlaunched product) — a new install either starts empty or restores from the user's latest encrypted backup.

## Design

- **Cloud mode startup (new architecture):** start embedded engine → inject/refresh SoulbitsCloud provider configs (existing `soulbitsTokenSync` + `injectSoulbitsToken`) → chat + lifecycle fully on-device. No session provisioning; `CloudSessionService` becomes dead code and is deleted in 3-4.
- **Backup:** facade-triggered engine DB snapshot upload (WAL checkpoint → gzip → S3, existing snapshot tooling). Cadence: on-significant-change debounce + daily opportunistic (rides the 4-3 overnight window when iOS grants it; Android/desktop sync their own backups or rely on peer changesets). First-backup size rides the existing estimate-confirm UX (`sync:estimate` dialog contract, answered by the app on behalf of the engine).
- **Restore:** new-device/fresh-install onboarding path — sign in → offer encrypted restore → download + open with the user's DEK (key re-wrap via existing account recovery) → engine runs.
- **Privacy end-state:** the cloud stores ciphertext blobs + keys it must hold for account recovery; it never opens engine DBs, never runs engine code, never evaluates lifecycle (4-4 ruling).
- **Estimate gate reuse:** first baseline backup + any full re-push use the size-estimate confirm dialog (same contract as today's initial sync).

## Implementation steps

1. App: cloud-mode orchestration (embedded engine + config injection; no `CloudSessionService` call) behind the phase flag.
2. App: backup scheduler + restore onboarding (facade snapshot hooks; estimate bridging reusing the existing dialog).
3. Cloud: snapshot upload/download endpoints already exist (S3 plane) — verify auth paths work without a session context; add version pinning if absent.
4. Staging E2E: cloud chat on-device; backup → wipe → restore round-trip.

## Files to create/modify

- App: `src/services/cloud/EngineBackupService.ts` (new), facade bridge `src/services/engine/`, restore onboarding screen wiring
- Cloud backend: auth/path verification only (no engine dependencies introduced — ever, per 4-4)

## Verification gates

- Staging E2E green: on-device cloud chat; backup/restore round-trip
- Zero cloud-side engine imports added (assert in review)
- Estimate-confirm UX exercised on first backup

## Risks & rollback

- Users who never back up lose the safety net they implicitly had (cloud-authoritative copy) → mitigate: default-on backup cadence, restore offered prominently at install; copy must set expectations
- DEK/account-recovery edge cases for restore → reuse existing key infrastructure; test matrix incl. password reset flows
- Rollback: new path is app-flagged until 3-4 deletes the old path; until then the flag reverts behavior

## Progress checklist

- [ ] Cloud-mode orchestration (embedded engine, no session) behind flag
- [ ] Backup scheduler + estimate bridging
- [ ] Restore onboarding path
- [ ] Staging E2E green
