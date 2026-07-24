# Future Work Backlog

Deferred items, known gaps, and long-term strategic improvements identified during the test framework overhaul (Phases 1–8). None of these are blocking — they are improvements to consider once the current testing infrastructure is stable.

See also: [`docs/TESTING.md`](TESTING.md) for the current testing strategy.

## Backlog Items

### 1. Vendored canonical schema (long-term alternative to dump-and-diff)

**Description**: Instead of dumping schemas from both repos (RN + Go) and diffing them in CI, extract a single canonical schema file (or Atlas HCL descriptor) that both repos consume. Both sides generate their migrations from this single source of truth.

**Why it matters**: Eliminates the "two repos with parallel migrations" problem entirely. Schema changes happen in one place; both sides pick them up. No more "Mirrors migration XXXX" comments.

**Effort**: 2–3 weeks (depends on Atlas adoption learning curve).

**Trigger**: When schema changes become frequent enough that the dump-and-diff gate becomes a bottleneck, or when a third consumer of the schema appears (e.g., a desktop client).

**Reference**: Phase 5 research report, section 3.2 (Approach B — Atlas HCL).

---

### 2. Pact contract tests for the Harmony Link protocol

**Description**: Add Pact consumer-driven contract tests between the TS client and the Go server. The TS side defines "what messages I send and what I expect back" as Pact contracts; the Go side verifies each contract against its actual implementation.

**Why it matters**: Catches message-shape drift (field renames, type changes) between the two sides without requiring a full E2E run. Particularly valuable for the bidirectional WSS protocol where shape compatibility is critical.

**Effort**: 1–2 weeks. Pact v3+ message pact support is an imperfect fit for bidirectional streaming, so some pattern discovery will be needed.

**Trigger**: When E2E runs become too slow to catch every PR, or when a message-shape mismatch slips through to production.

**Reference**: Phase 4 research report, section 3.3 (Pact contract testing).

---

### 3. SQLCipher compatibility smoke test

**Description**: Add a test that verifies the production SQLCipher-encrypted database opens correctly, persists data across reopen, and the on-disk file is actually encrypted. This test runs on a real device or emulator (not in Node — `better-sqlite3` doesn't support SQLCipher).

**Why it matters**: Phase 2 deliberately deferred SQLCipher verification because most repository/migration tests don't depend on encryption behavior. But "does encryption actually work end-to-end?" is a question worth answering before each release.

**Effort**: 2–3 days. Two paths:
- (a) Add a Maestro flow that writes a record, closes the app, inspects the DB file via `adb shell`, asserts it's not plaintext
- (b) Add a debug screen in the app that runs a minimal encryption smoke test

**Trigger**: Once per release cycle, or whenever `connection.ts`'s encryption logic changes.

**Reference**: Phase 2 research report, section 5 (Open risks — SQLCipher gap).

---

### 4. Migrate off `react-test-renderer` to RNTL

**Description**: `react-test-renderer` is officially deprecated in React 19. The repo still has it as a dev dependency. `@testing-library/react-native` (RNTL) is already installed (Phase 1-1). The only existing component test (`__tests__/App.test.tsx`) uses `react-test-renderer` and should be migrated to RNTL.

**Why it matters**: Future RN versions may drop support for `react-test-renderer` entirely. Migrating now avoids a forced migration later under time pressure.

**Effort**: 1–3 days depending on snapshot volume. RNTL has a different snapshot format, so snapshots need re-recording.

**Trigger**: Before upgrading to the next RN major version (0.87+), or when adding new component tests.

**Reference**: Phase 1-1 (Jest 30 upgrade notes).

---

### 5. Re-evaluate Vitest

**Description**: Revisit the Jest-vs-Vitest decision in ~12 months. By then, `vitest-native` may be 1.0 stable, and production migration stories should exist.

**Why it matters**: Vitest is dramatically faster for web projects (5–28x on benchmarks) and has better ESM support. If it becomes viable for RN, the speedup would compound as the test suite grows.

**Effort**: 1–2 weeks for a full migration, IF viable.

**Trigger**: July 2027 (12 months from this plan), or when Vitest for RN reaches 1.0 — whichever comes first.

**Reference**: Phase 1 research report (Jest vs Vitest).

---

### 6. Real-device E2E (not just emulator)

**Description**: Phase 6 uses an Android emulator and a macOS GitHub Actions runner. Real-device testing catches issues that emulators miss: actual network conditions, vendor-customized Android UIs, hardware-specific behaviors.

**Why it matters**: Some bugs only manifest on real devices. Vendor Android ROMs (Samsung, Xiaomi, Huawei) often have surprising deviations from AOSP.

**Effort**: Low if using a cloud service (BrowserStack, TestingBot real-device tier, Maestro Cloud real devices) — just pay more per run. High if self-hosting a device lab.

**Trigger**: When emulator-only E2E has been stable for 3+ months and the team is ready to invest in deeper coverage. Or when a real-device-only bug escapes to production.

**Reference**: Phase 6 research report, section 3.5 (cloud alternatives).

---

### 7. Component tests with RNTL

**Description**: Build out RNTL coverage for individual screens and components: ChatDetailScreen, SettingsScreen, ConnectionSetupScreen, etc. The only existing component test (`__tests__/App.test.tsx`) uses `react-test-renderer`.

**Why it matters**: Component tests catch UI regressions (wrong text, missing buttons, broken navigation) much faster than E2E and without device overhead. They fill the gap between unit tests (pure logic) and E2E (full integration).

**Effort**: Ongoing — each screen takes 2–4 hours to test thoroughly.

**Trigger**: When adding new screens or refactoring existing ones.

**Reference**: Phase 4 research report, section 4.2 (RNTL).

---

### 8. Visual regression testing

**Description**: Add visual regression tests that capture screenshots of key screens and fail when the pixels change. Maestro has screenshot support; RNTL can integrate with `jest-image-snapshot`.

**Why it matters**: Catches unintended UI changes (a designer's nightmare — "why did this button move 2px?").

**Effort**: 1 week to set up the harness; ongoing maintenance as the UI evolves.

**Trigger**: When the design system stabilizes and pixel-perfect rendering becomes a requirement.

---

### 9. Performance regression testing

**Description**: Track key performance metrics (app startup time, sync duration, chat scroll FPS) over time and fail CI if they regress beyond a threshold.

**Why it matters**: Sync performance is critical for user experience — a 2x slowdown can make the app feel broken.

**Effort**: 2–3 weeks to set up a benchmarking harness (Flashlight for RN, or custom Maestro timing).

**Trigger**: When user complaints about performance appear, or before/after any major sync refactor.

**Reference**: Phase 6 research report mentioned Flashlight as the standard RN profiler.

---

### 10. Coverage gating

**Description**: Phase 7-1 added coverage reporting but no gating. Once the baseline coverage is established (track for 3+ months), enforce minimum thresholds that ratchet upward over time.

**Why it matters**: Prevents coverage from slowly eroding as new code is added without tests.

**Effort**: Ongoing policy work, not technical work.

**Trigger**: After the test framework has been running for 3 months and the baseline coverage is visible.

---

### 11. Detox as E2E fallback

**Description**: If Maestro proves insufficient (e.g., gray-box synchronization needed for animated transitions), evaluate Detox as a secondary E2E tool. Detox's `await element.by...` is more robust for async UI updates than Maestro's `assertVisible`.

**Why it matters**: Maestro's black-box approach is fast but sometimes flaky for animations. Detox's gray-box is slower but more deterministic.

**Effort**: 1 week to add as a parallel option.

**Trigger**: If Maestro tests become flaky (>5% failure rate on no-change PRs).

**Reference**: Phase 6 research report (Detox vs Maestro).

---

### 12. Expand the in-repo schema parity check to a CLI

**Description**: Phase 5-3 implemented parity via a GitHub Actions workflow only — there is no local CLI for developers. Wrap the workflow steps as `npm run schema:parity` so developers can check for drift before pushing.

**Why it matters**: Faster feedback loop — find drift before pushing, not after CI fails.

**Effort**: Half a day. Wrap the workflow steps in an npm script that runs `dump-schema` on both repos and diffs the output.

**Trigger**: Anytime. Low effort, useful immediately.

---

### 13. `@swc/jest` for pure-unit test files

**Description**: Phase 1-1 mentioned SWC as an optional speedup for files that don't import `react-native`. Evaluate adding it for pure-logic files (repositories, sync helpers, utilities) to speed up the unit suite.

**Why it matters**: SWC transforms TypeScript ~20x faster than Babel. For a large suite, this could shave minutes off CI.

**Effort**: Half a day to configure. Must verify it doesn't break the `@react-native/babel-preset`-dependent files.

**Trigger**: When unit test cold-start time exceeds 60 seconds.

**Reference**: Phase 1 research report (Jest 30 modernization notes).

---

### 14. Investigate `node:sqlite` once stable

**Description**: Node 22+ has `node:sqlite` built in (currently Stability 1.1 — Active development). Once it reaches Stability 2 (Release Candidate) or Stability 3 (Stable), evaluate replacing `better-sqlite3` with it.

**Why it matters**: Eliminates the `better-sqlite3` native dependency (which causes occasional install pain on Windows/CI). Built-in to Node = zero-config.

**Effort**: 1 day to swap, IF the API has stabilized. The current API is synchronous like `better-sqlite3`, so the adapter pattern is similar.

**Trigger**: When `node:sqlite` reaches Stability 2 in a Node LTS version (likely Node 24 LTS or Node 26 LTS).

**Reference**: Phase 2 research report, section 2 (Option 1: `node:sqlite`).

---

## Implementation Findings (Added During Phases 1–7)

These items were discovered during the test framework overhaul itself and are documented here for prioritization.

### 15. Clock drift compensation not implemented

**Description**: The `clock_drift_seconds` field received from the handshake protocol is currently **ignored** by `SyncService`. The field is present in the protocol message but no adjustment logic exists on the client side.

**Why it matters**: If clock drift between client and server is non-trivial, sync timestamps could be inaccurate, leading to missed updates or conflicts.

**Effort**: 2–3 days. Either implement the adjustment in `SyncService` (adjust local timestamps by the drift), or remove the field from the protocol if it's unused.

**Trigger**: Anytime — the field is already being sent by the server, so either action prevents future confusion.

**Source**: Phase 4-3 finding — handshake message parsing revealed the field is received but never used.

---

### 16. Schema divergences between RN and Go (9 issues, 2 CRITICAL)

**Description**: Phase 5-3 documented **9 known divergences** between the RN schema (dumped by `scripts/dump-schema.ts`) and the Go server schema (dumped by `harmony-link-private/cmd/dump_schema.go`). Two are **CRITICAL**: missing foreign key constraints on `conversation_messages` and `interactions` tables in the RN schema.

**Why it matters**: Missing FK constraints can lead to orphaned rows and data integrity issues. The critical items could cause referential integrity failures at runtime.

**Effort**: 1–2 weeks to triage and fix. Options:
- Fix RN migrations to match Go canonical schema
- Document acceptable divergences and add a `schema-parity-exceptions.txt`
- Both: fix critical items now, defer non-critical with documentation

**Trigger**: Before the next release. Critical items should be fixed before shipping.

**Source**: Phase 5-3 finding, documented in `.current_work/test-framework-overhaul/schema-parity-findings.md`.

---

### 17. Timer leak in SyncService (`setTimeout` without `.unref()`)

**Description**: `SyncService.sendSyncDataWithConfirmation` uses `setTimeout` without calling `.unref()`. This causes the "worker process has failed to exit gracefully" warning in Jest, and more importantly, can prevent the Node process from exiting cleanly.

**Why it matters**: The Jest warning is cosmetic (tests pass), but the underlying issue means timers can keep the process alive. In production, this is not a problem (the app keeps running), but it indicates a pattern that should be cleaned up.

**Effort**: 15 minutes. Add `.unref()` to the timer call.

**Trigger**: Anytime. Quick fix that removes a CI warning and improves process hygiene.

**Source**: Phase 4-3 finding — observed in every test run output.

---

### 18. Zero test coverage for 5 repositories

**Description**: The following repositories have **no test coverage at all**, as documented in `repository-test-gaps.md` (Phase 3-3 finding):

- `EmotionState` repository
- `EmojiAction` repository
- `SyncDevice` repository
- `ConversationMessage` repository
- `Interaction` repository

**Why it matters**: These repositories contain critical data paths — conversation messages are the core chat data, interactions drive the chat list, sync devices manage pairing, emotion state and emoji actions are user-facing features.

**Effort**: 2–5 days total (1 day per repository). Follow the pattern established by `entities.test.ts` and `characters.test.ts` using `useFreshDatabase()`.

**Trigger**: Before adding new features that touch these repositories, or as part of a "test coverage sprint."

**Source**: Phase 3-3 finding, documented in `.current_work/test-framework-overhaul/repository-test-gaps.md`.

---

## Maintenance of This Backlog

Review this document quarterly. Items that have been implemented should be moved out (to a changelog or commit history). Items whose trigger condition has been met should be promoted to active phases in a new implementation plan.

Items that no longer seem relevant should be deleted — don't let this file become a graveyard of stale ideas.

---

## Post-Plan Additions (July 2026)

These items were discovered during the post-plan E2E validation work.

### 19. Cloud-mode empty-JWT response handling not empirically verified

**Description**: When the harmony-link server runs with `CLOUD_MODE=true`, the
handshake response returns empty `jwt_token`, `server_cert`, and `expires_at`
fields (verified by `harmony-link-private/eventserver/synchronization_cloudmode_test.go:82-85`).
The server generates a real JWT internally but doesn't send it in the response
— cloud deployments rely on the conduct proxy for user auth.

The client's `ConnectionStateManager.applyE2EOverride()` strategy relies on
this being fine because:
1. `request.go:131` skips JWT validation in cloud mode
2. Empty string satisfies `jwtToken !== null` in `ConnectionStateManager.initialize()`
3. `saveConnectionCredentials()` overwrites the placeholder with the empty value

But the **`connectWithRefresh()` → `connect()` handoff** when the response has
empty fields hasn't been traced end-to-end against a live server.

**Why it matters**: If the empty JWT triggers an unexpected code path (e.g.,
a `if (!jwtToken)` check that throws), the E2E flow fails silently.

**Effort**: 1 day. Run the actual compose stack, watch the logs, fix any
client-side null/empty-string issues that surface.

**Trigger**: Before relying on the E2E stack for release gating.

**Source**: Post-plan investigation of cloud-mode server behavior.

---

### 20. Full E2E compose run never executed

**Description**: All prerequisites for `docker compose -f e2e/docker-compose.yml up`
are in place:
- `soulbits/harmony-link:latest` image present locally
- `budtmo/docker-android:emulator_14.0` pulled and KVM-validated
- Healthcheck regex fixed (`READY`, not `device_status=online`)
- APK buildable with `-PHARMONY_LINK_WSS_URL=...` + `-PHARMONY_LINK_WS_URL=...`
- Maestro flows have real selectors based on actual i18n strings + testIDs
- `ConnectionStateManager.applyE2EOverride()` implements the auto-pairing strategy

But the actual end-to-end run (compose up → APK install → Maestro flows) has
**not been executed**. The next session should pick up from here.

**Why it matters**: Validates the entire test pyramid at once. Catches
integration issues that no individual unit/integration test can.

**Effort**: 1-2 hours to run + triage initial failures.

**Trigger**: ASAP. Everything else is in place.

**Source**: Post-plan work — E2E stack preparation.

**Handoff**: See `.current_work/test-framework-overhaul/summary.md` →
"Post-Plan Work" → "E2E stack run" for the full status.

---

### 21. iOS E2E explicitly excluded from GHA

**Description**: The `.github/workflows/e2e-ios.yml` workflow exists but is
**not triggered**. iOS E2E is excluded until the Android E2E stack is
validated end-to-end (item #20).

**Why it matters**: iOS-specific regressions won't be caught in CI until
this is enabled.

**Effort**: 1 day. Re-enable the workflow trigger, debug any macOS-specific
issues (iOS Simulator networking, code signing, etc.).

**Trigger**: After item #20 succeeds — Android E2E must be stable first.

**Source**: Explicit user decision during post-plan review.

---

### 22. `react-native-config`'s `ENVFILE` env var does not work with the gradle daemon

**Description**: react-native-config's `dotenv.gradle` reads the `ENVFILE`
environment variable to pick a `.env` file. But the gradle **daemon** caches
its environment at startup, so setting `ENVFILE` in a subsequent shell
invocation has no effect.

The workaround used in the post-plan work: pass values via `-P` gradle
properties instead, which are per-invocation. The `android/app/build.gradle`
`buildConfigField` declarations read via `project.findProperty(...)`:

```gradle
buildConfigField "String", "HARMONY_LINK_WSS_URL", "\"${project.findProperty('HARMONY_LINK_WSS_URL') ?: ''}\""
buildConfigField "String", "HARMONY_LINK_WS_URL", "\"${project.findProperty('HARMONY_LINK_WS_URL') ?: ''}\""
```

Helper scripts: `e2e/build-apk.sh` + `e2e/build-apk.ps1`.

**Why it matters**: Documents a footgun. Future contributors who try to use
`ENVFILE=.env.e2e ./gradlew ...` will be confused when the env vars don't
apply (silent failure — values end up empty strings).

**Effort**: Already worked around. No action needed unless the team wants
to migrate to `gradlew --no-daemon` for E2E builds (slower but more predictable).

**Trigger**: If the team adopts CI patterns that rely on `ENVFILE`.

**Source**: Post-plan debugging — `BuildConfig.java` was missing
`HARMONY_LINK_WSS_URL` despite the env var being set.

---

### 23. Production-side `HARMONY_LINK_WSS_URL` override now implemented (was deferred)

**Description**: This was originally deferred from Phase 4-1 (see `tls-current-state.md`
line 78). **Now completed** in `src/services/ConnectionStateManager.ts:applyE2EOverride()`.

Documented here only as a closure record — no action needed.

**Why it matters**: Closes a gap noted in the original Phase 4-1 plan. The
production code path now reads `Config.HARMONY_LINK_WSS_URL` and
`Config.HARMONY_LINK_WS_URL` at boot.

**Effort**: Done.

**Trigger**: N/A.

**Source**: Post-plan Phase B-3 work.
