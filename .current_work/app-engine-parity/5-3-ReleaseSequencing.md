# Phase 5-3 — Release Sequencing & Rollback

> **Repos:** all; process/ops phase
> **Assessment basis:** §12.5 (coupled releases) — reduced 2026-10-11: the product is unlaunched, so there is no version matrix to enforce and no staged rollout; every build goes to fresh installs on our own devices.
> **Codebase mapping consulted:** `.planning/codebase/` — all three repos (ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md; TESTING.md where present)

## Objective

Land the three repos in a working order on fresh installs, with a rollback story that is purely git/image-level (no user-data migration ever runs).

## Pairing contract (the only compatibility that matters)

| Relationship | Path | Guard |
|---|---|---|
| New app (embedded engine) ↔ desktop engine | changeset-v1 (2-3) | handshake negotiation; mismatched engine → typed reject + "update Harmony Link" UX (existing sticky pattern) |
| New app ↔ cloud | **no engine peer, no user-data storage** — inference API + account/W1 escrow (2-5) + user-owned-storage backup/restore (2-6); keepalive cron + push relay (4-4) | — |

## Release order

1. **Engine** (desktop builds updated): changeset protocol + lazy/catch-up/batch live; desktop↔embedded pairing available.
2. **Cloud backend** (4-4): keepalive cron + relay + tier extension deployed. The lifecycle-worker deletion lands here only after 4-3 is verified on devices (order 4) — otherwise it follows in the same step as order 4.
3. **App, Android** (1-x + 2-x + 3-x complete): management-API-only data layer, TS stack deleted (3-4), cloud mode = 2-5 path.
4. **App, iOS** (4-x): requires 4-1/4-2 in the build, because 3-4 made the embedded engine mandatory — ship in the same release cycle as Android or after it. Verify 4-3 wakes against the deployed 4-4 cloud pieces; then execute the worker deletion if it hasn't run yet.
5. **Phase 6 — Cloud Cleanup (in this plan, previously deferred):** after orders 1–4 are verified on devices — 6-1 session-infra retirement → 6-2 snapshot plane + DEK retirement + GDPR purge rework (**gated on 2-6 verified**: its replacement backup must be proven first) → 6-3 engine-import zeroing → 6-4 engine dead-code removal. Detailed ordering + the irreversible bucket-purge runbook live in the 6-x files.

## Rollback story

- Every repo: git/image revert — no release is one-way. No data migration, no import, no user fleet mid-transition; the old protocol's deletion is exactly git history.
- Engine constraint: don't land an engine schema migration in the same window as a changeset-protocol rollout (epoch-ledger readability on revert) — enforce in the release checklist.
- Keepalive cron + relay have independent kill switches (correctness never depends on either).
- **Phase 6 exception:** infrastructure deletion is git-revertable per component, but the 6-2 **bucket purge is irreversible** — its runbook (verify zero consumers → purge all versions → destroy) must complete in dev before prod, with completion recorded.

## Release checklist artifacts (committed)

> **Convention:** every `[ ]` below is an **owner** action (device/ops run on real
> hardware or cloud infra — no agent builds per workspace rules). **[code-side ✓]**
> marks work already landed on `feat/app-engine-parity` that only needs to ship in
> the order shown. Exact commands are quoted where the source task recorded them;
> the per-task docs (linked) hold the long form. All owner items are deduplicated
> from the per-phase OWNER GATES/OPS notes (re-derived from `summary.md`).

- [x] **Per-order checklists written** (this section) — artifact complete (5-3).
      Release execution + sign-offs are the owner gates below.
- [ ] **Device smoke per order** (Android fresh install, iOS fresh install, desktop
      pairing, cloud chat on-device + 2-6 backup/restore round-trip) — owner.
- [ ] **Phase 6 executed per the 6-x files** (bucket-purge runbook recorded) — owner.

### Pairing-contract guards (the only compatibility that matters)

- [x] **`rejected` sync state surfaces actionable copy** (SYNC_REJECT / version
      mismatch → "update Harmony Link" UX). Verified on `DesktopSyncScreen`: the
      9-state badge maps `rejected` → red `cloud-off-outline`, and 5-3 added a
      `desktop-sync-rejected-hint` card + reworded `stateSub_rejected` /
      `rejectedHint` to name the version mismatch and the fix (update Harmony Link
      on both devices, reconnect). The engine's typed reject reason is
      `unsupported_protocol` with a min-version hint (`sync_handshake.go`,
      `SyncRejectReasonUnsupportedProtocol`).
- [ ] **MANUAL CHECK — same-window constraint:** do **not** land an engine schema
      migration in the same release window as the changeset-protocol rollout
      (epoch-ledger readability on revert). Order 1 **is** a protocol rollout —
      hold engine migrations for a separate window. Confirm in the release PR set.

### Order 1 — Engine (desktop builds updated)

**Ships:** changeset-v1 protocol + lazy/catch-up/batch live; desktop↔embedded
pairing available; rows-v1 + cloud-mode dead code gone (6-4). **[code-side ✓]**

- [ ] Engine gates green with the mandatory session-extension defines:
      `CGO_CFLAGS='-DSQLITE_ENABLE_SESSION -DSQLITE_ENABLE_PREUPDATE_HOOK' go build ./... && go vet ./... && go test ./...` → 0.
- [ ] Build the sidecar artifacts: `make sidecar-android` (NDK `27.1.12297006`), and
      the facade artifacts — iOS `CGO_CFLAGS='-DSQLITE_ENABLE_SESSION -DSQLITE_ENABLE_PREUPDATE_HOOK' ./build_facade_ios.sh` (macOS + Xcode),
      Android `ANDROID_NDK_HOME=$ANDROID_HOME/ndk/27.1.12297006 ./build_facade_android.sh`.
      (4-1 owner gate; the gomobile `x/mobile` tool-dep bump is an owner decision
      the scripts self-apply.)
- [ ] First `build-android-sidecar` CI run green (pending — Actions cannot run
      locally). (1-1)
- [ ] Desktop build ships the changeset protocol; confirm a desktop↔embedded
      handshake negotiates `changeset-v1` (rows-v1 gone). (2-3 / 6-4)
- [ ] **Catch-up observation (owner device):** stop the desktop engine ~2 h,
      restart, confirm the entity returns with a bounded catch-up (≤3 LLM calls;
      long-gap → single hiatus re-entry) and no double-advance. (0-2)
- [ ] **LAN pairing smoke (engine side):** desktop authority + a second engine pair
      over LAN; device-approval handshake; epoch handover. (2-4)
- **Rollback:** git/image revert of the desktop build. No data migration runs; the
  deleted rows-v1 protocol is exactly git history. *Constraint:* no engine schema
  migration in this window (see manual check).

### Order 2 — Cloud backend (4-4)

**Ships:** keepalive cron + push relay + tier extension deployed. **Caveat:** the
lifecycle-worker deletion lands here **only after 4-3 is verified on devices
(order 4)** — otherwise it follows in the same step as order 4. **[code-side ✓]**

- [ ] Cloud gates: `go build ./... && go vet ./... && go test ./...` green (some
      packages App-Control-blocked on Windows — pre-existing). (4-4)
- [ ] `tofu plan` / `tofu apply` for the touched modules (dev → prod) — keepalive
      cron + relay + lifecycle-worker removal. (4-4)
- [ ] ALB route `/v1/lifecycle/*` → push-service provisioned. (4-4)
- [ ] Secrets check: `PASETO_KEY_SECRET_NAME` present; optional
      `KEEPALIVE_APNS_TOPIC` set if visible keepalive is enabled. (4-4)
- [ ] **Staging E2E:** on-device cloud chat + W1 escrow round-trip; `KMS_CMK_ARN`
      present on the auth-service task defs (6-3 add-on). (2-5)
- [ ] Confirm the lifecycle-worker deletion runs only after order 4's 4-3
      verification (else carry it with order 4).
- **Rollback:** git/image revert per service; the keepalive cron + relay have
  independent kill switches (correctness never depends on either). Infra revert is
  `tofu` state-level per component.

### Order 3 — App, Android (1-x + 2-x + 3-x)

**Ships:** management-API-only data layer; TS stack deleted (3-4); cloud mode =
2-5 path; Android embedding (1-1/1-2) + user-owned backup (2-6). **[code-side ✓]**

- [ ] App gates: `npx.cmd tsc --noEmit` → 0; `npm.cmd run test` green. (repo convention)
- [ ] Build variants + jniLibs placement: run `:app:vendorEngineSidecar` (per-ABI
      `libengine.so` into `src/main/jniLibs/{arm64-v8a,x86_64}/`, pin
      `-PENGINE_SIDECAR_VERSION`); confirm `extractNativeLibs=true`. (1-2; the real
      artifact URL/CI drop is an owner gate — no release URL published yet.)
- [ ] **Emulator/device smoke** for the sidecar (`adb` commands in
      `docs/Sidecar-Deployment.md` "Verifying a build"): `ENGINE_READY` handshake,
      health watch, SIGTERM shutdown. (1-1)
- [ ] **Fresh-install smoke:** fresh install → engine starts → management-API
      reads/writes work (no TS replica). (3-4)
- [ ] **Cloud chat on-device:** sign in → on-device engine + injected provider
      configs → chat round-trip. (3-4 / 2-5)
- [ ] **Bundle-size delta** recorded vs the pre-deletion build. (3-4)
- [ ] **Backup round-trips (2-6):** backup → wipe → restore on ≥1 integrated target
      + local export; device-to-device transfer carries the DB; Auto-Backup
      exclusion honored; kill-mid-upload recovers.
- [ ] **LAN pairing smoke via UI:** desktop authority + phone sidecar →
      `pending_approval` → approve on desktop → `syncing` → edit on phone → appears
      on desktop; handover promotes the phone. (2-4 / 3-5)
- [ ] Restore offer appears after the first fresh-install sign-in when a backup
      exists, and is skippable (5-3 gate).
- **Rollback:** git/image revert of the app build (APK/AAB). No user-data
  migration; the engine DB is device-local. Reverting the app after a 3-4 ship
  leaves a build with no data path to the old replica — acceptable pre-launch
  (fresh installs only).

### Order 4 — App, iOS (4-x)

**Ships:** in-process module (4-1/4-2) + blind-tick lifecycle (4-3); requires
4-1/4-2 in the build (3-4 made the embedded engine mandatory). Ship with or after
Android. **Verify 4-3 wakes against the deployed 4-4 pieces; then execute the
worker deletion if it has not run yet.** **[code-side ✓]**

- [ ] **Build + vendor `HarmonyEngine.xcframework`** (macOS + Xcode): in
      `harmony-link-private`, `CGO_CFLAGS='-DSQLITE_ENABLE_SESSION -DSQLITE_ENABLE_PREUPDATE_HOOK' ./build_facade_ios.sh`
      → `cp -R build/ios/HarmonyEngine.xcframework ../harmony-ai-app/ios/Frameworks/`
      → `cd ios && pod install && open HarmonyAIChat.xcworkspace`. (4-1 / 4-2)
- [ ] **iOS device matrix** (physical iPhone): launch → engine starts (foreground)
      → chat; background mid-chat → engine stops after the grace window →
      foreground → restarts + resumes; phone-call interruption; low-power
      foreground; RSS before/after a chat session. (4-2)
- [ ] **App Store entitlement review** + first submission: iCloud container +
      keychain access group + `aps-environment`; embedded Go runtime + loopback
      servers. (4-2)
- [ ] **Silent-push wake drill:** backgrounded, trigger a keepalive
      (`KEEPALIVE_ENABLED=true`, or a manual APNs `content-available:1` push with
      `data.kind=keepalive`) → `engine:wake` → `lifecycle.batch` → clean
      `finishWake` (no expiration force-stop) in the device console
      (`[EngineWake]` / `[IOSLifecycleWake]`). (4-3)
- [ ] **Overnight sweep observation:** charging + Wi-Fi overnight →
      `com.soulbits.engine.maintenance` grant → `lifecycle.maintenance` +
      `lifecycle.batch` → clean completion; backup ride-along ran when enabled. (4-3)
- [ ] **Outreach visible-push (staging):** force an outreach-due entity →
      `POST /v1/lifecycle/notify` returns `{delivered:1}` and the banner is
      received (notification authorization is now requested app-wide — 5-1 add-on).
      (4-3 / 4-4)
- [ ] **Low-power / Background App Refresh off:** confirm convergence on the next
      app-open; honest-limits copy matches observed cadence. (4-3)
- [ ] **Observation week:** sample the honored-keepalive rate over ≥7 days;
      document cadence; adjust copy if needed. (4-3)
- [ ] **iOS window gates** for `ProcessLifecycleBatch` (deadline/budget truncation
      strictly inside the OS window). (0-4)
- [ ] **iCloud round-trip (2-6):** backup → wipe → restore via the ubiquity
      container; W2 keychain unwrap. (2-6 / 4-2)
- [ ] Execute the 4-4 lifecycle-worker deletion if it did not run with order 2
      (now that 4-3 is verified on devices).
- **Rollback:** git/image revert of the iOS build + revert the vendored
  XCFramework. Foreground-tier engine means a revert never leaves a background
  process; no user-data migration.

### Order 5 — Phase 6 (Cloud Cleanup) — code-side executed; ops gates remain

**Sequencing:** 6-1 session-infra retirement → 6-2 snapshot plane + DEK retirement
+ GDPR purge rework (**gated on 2-6 verified** — its replacement backup must be
proven first) → 6-3 engine-import zeroing → 6-4 engine dead-code. Code-side is
landed; the ops gates below remain. **[code-side ✓]**

- [ ] **6-1 owner ops:** `tofu apply` dev → prod; run migration `000033`;
      broker/valkey topology teardown; coupled client-publish (regenerated openapi
      clients). Rollback: git/tf-state revert per component; missed-consumer risk
      covered by grep gates + dev soak.
- [ ] **6-2 owner ops:** deploy (auto-migration `000034`); `tofu apply`; **bucket
      purge + destroy** via `scripts/purge-sessions-bucket.sh` + the all-versions
      runbook in `infrastructure/tofu/README.md`; dev-env e2e. **IRREVERSIBLE
      bucket purge** — verify zero consumers (grep + 30-day access logs) → purge
      all versions → empty-bucket verification → destroy bucket + KMS key; record
      completion. Rollback: git-revertable per component *except the purge*.
- [ ] **6-3 owner ops:** `tofu apply` (`KMS_CMK_ARN` + `backup_key_kms` IAM);
      Firebase project provisioning + FCM service-account JSON into
      `soulbits/{env}/fcm`; staging push round-trip (chunking, relay delivery,
      unregistered-token pruning, quota-error path); ALB `/v1/lifecycle/*` route
      (from 4-4). Rollback: git/image revert; the Firebase secret is independent.
- [ ] **Bucket-purge runbook recorded** (completion note in the ops log) — required
      by this plan.

### Rollback rehearsal (staging)

- [ ] **Rehearse once in staging** (owner): image-revert path per repo — revert the
      deployed engine/cloud/app images to the previous build, confirm the system
      comes back with no data migration and no user-fleet mid-transition.
- [ ] Confirm the "no release is one-way" claim: every repo is git/image
      revertable; the only irreversible step is the 6-2 bucket purge (runbook above).

## Progress checklist

- [ ] Release order executed with sign-offs recorded here
- [ ] Rollback rehearsed once in staging (image-revert path)
- [ ] Phase 6 executed (6-1 → 6-2 → 6-3 → 6-4) with gates green
