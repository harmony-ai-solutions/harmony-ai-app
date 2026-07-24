# Phase 8-2: Future Work Backlog

## Objective

Capture the deferred items from earlier phases and the long-term strategic options identified in the research. None of these are blocking — they're improvements to consider once Phases 1–7 are stable.

## Context

The research reports (1–5) surfaced several "nice to have" or "long-term" items that don't fit in the initial overhaul. This document is the parking lot for them. Each item should have: a description, why it matters, rough effort, and a trigger condition (when to revisit).

## Backlog Items

### 1. Vendored canonical schema (long-term alternative to dump-and-diff)

**Description**: Instead of dumping schemas from both repos and diffing them in CI, extract a single canonical schema file (or Atlas HCL descriptor) that both repos consume. Both Go and TS sides generate their migrations from this single source of truth.

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

**Description**: Add a tiny test that verifies the production SQLCipher-encrypted database opens correctly, persists data across reopen, and the on-disk file is actually encrypted. This test runs on a real device or emulator (not in Node — `better-sqlite3` doesn't support SQLCipher).

**Why it matters**: Phase 2 deliberately deferred SQLCipher verification because most repository/migration tests don't depend on encryption behavior. But "does encryption actually work end-to-end?" is a question worth answering before each release.

**Effort**: 2–3 days. Two paths:
- (a) Resurrect a minimal version of the deleted in-app test runner (Phase 1-2) specifically for this purpose — runs as a debug screen in the app
- (b) Add a Maestro flow (Phase 6) that writes a record, closes the app, inspects the DB file via `adb shell`, asserts it's not plaintext

**Trigger**: Once per release cycle, or whenever `connection.ts`'s encryption logic changes.

**Reference**: Phase 2 research report, section 5 (Open risks — SQLCipher gap).

---

### 4. Migrate off `react-test-renderer` to RNTL

**Description**: Phase 1-1 mentioned that `react-test-renderer` is officially deprecated in React 19. The repo still has it as a dev dependency. Any existing snapshot tests using it should migrate to `@testing-library/react-native` (RNTL).

**Why it matters**: Future RN versions may drop support for `react-test-renderer` entirely. Migrating now avoids a forced migration later under time pressure.

**Effort**: 1–3 days depending on snapshot volume. RNTL v14 has a different snapshot format, so all snapshots need re-recording.

**Trigger**: Before upgrading to the next RN major version (0.87+), or when adding new component tests.

**Reference**: Phase 1-1 (jest 30 upgrade notes).

---

### 5. Re-evaluate Vitest

**Description**: Revisit the Jest-vs-Vitest decision in ~12 months. By then, `vitest-native` may be 1.0 stable, and production migration stories should exist.

**Why it matters**: Vitest is dramatically faster for web projects (5–28x on benchmarks) and has better ESM support. If it becomes viable for RN, the speedup would compound as the test suite grows.

**Effort**: 1–2 weeks for a full migration, IF viable.

**Trigger**: July 2027 (12 months from this plan), or when Vitest for RN reaches 1.0 — whichever comes first. Re-run the Phase 4 research agent's investigation at that point with current data.

**Reference**: Phase 1 research report (Jest vs Vitest).

---

### 6. Real-device E2E (not just emulator)

**Description**: Phase 6 uses an Android emulator and (optionally) TestingBot's iOS Simulator. Real-device testing catches issues that emulators miss: actual network conditions, vendor-customized Android UIs, hardware-specific behaviors (camera, BLE).

**Why it matters**: Some bugs only manifest on real devices. Vendor Android ROMs (Samsung, Xiaomi, Huawei) often have surprising deviations from AOSP.

**Effort**: Low if using a cloud service (BrowserStack, TestingBot real-device tier, Maestro Cloud real devices) — just pay more per run. High if self-hosting a device lab.

**Trigger**: When emulator-only E2E has been stable for 3+ months and the team is ready to invest in deeper coverage. Or when a real-device-only bug escapes to production.

**Reference**: Phase 6 research report, section 3.5 (cloud alternatives).

---

### 7. Component tests with RNTL

**Description**: Phase 1-1 mentioned adding RNTL but didn't define a component test suite. Build out coverage for individual screens and components: ChatDetailScreen, SettingsScreen, ConnectionSetupScreen, etc.

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

**Trigger**: After Phase 7 has been running for 3 months and the baseline coverage is visible.

---

### 11. Detox as E2E fallback

**Description**: If Maestro proves insufficient for any reason (e.g., gray-box synchronization needed for animated transitions), evaluate Detox as a secondary E2E tool. Detox's `await element.by...` is more robust for async UI updates than Maestro's `assertVisible`.

**Why it matters**: Maestro's black-box approach is fast but sometimes flaky for animations. Detox's gray-box is slower but more deterministic.

**Effort**: 1 week to add as a parallel option.

**Trigger**: If Maestro tests become flaky (>5% failure rate on no-change PRs).

**Reference**: Phase 6 research report (Detox vs Maestro).

---

### 12. Expand the in-repo schema parity check to a CLI

**Description**: Phase 5-3 implemented parity via a GitHub Actions workflow. Promote it to a CLI tool (`npm run schema:parity`) that developers can run locally before pushing.

**Why it matters**: Faster feedback loop — find drift before pushing, not after CI fails.

**Effort**: Half a day. Just wrap the workflow steps in an npm script.

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

**Effort**: 1 day to swap, IF the API has stabilized. The current API is synchronous like `better-sqlite3` so the adapter is similar.

**Trigger**: When `node:sqlite` reaches Stability 2 in a Node LTS version (likely Node 24 LTS or Node 26 LTS).

**Reference**: Phase 2 research report, section 2 (Option 1: `node:sqlite`).

---

## Maintenance of this backlog

Review this document quarterly. Items that have been implemented should be moved out (to a changelog or commit history). Items whose trigger condition has been met should be promoted to active phases in a new implementation plan.

Items that no longer seem relevant should be deleted — don't let this file become a graveyard of stale ideas.

## Files to Create

- This file (`8-2-FutureWorkBacklog.md`) is the deliverable.

## Validation

- [ ] Every item has a description, rationale, effort estimate, and trigger condition
- [ ] Items are roughly prioritized by trigger likelihood (most-likely-to-trigger first)
- [ ] The document is linked from `summary.md` and `docs/TESTING.md`
- [ ] A recurring calendar reminder exists to review this backlog quarterly

## Estimated Effort

The document itself: half a day to write. Implementing each item: variable (per-item estimates above).
