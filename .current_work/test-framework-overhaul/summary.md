# Test Framework Overhaul — Implementation Plan

## Overview

This plan replaces the broken test infrastructure in the HarmonyAIChat React Native app with a modern, layered testing strategy. The current state has two parallel and both-broken test systems: a Jest setup that mocks `react-native-sqlite-storage` to empty no-op stubs (so DB code is never actually tested), and a hand-rolled "test runner" (`run-db-tests.js` + `src/database/__tests__/run-all-tests.ts`) that can only run inside the booted RN app and is currently non-functional because Node cannot `require()` TypeScript files directly. There is no automated schema-migration verification, no integration testing of the Harmony Link sync protocol against real SQL, and no E2E coverage at all.

The new strategy introduces a **`Database` interface abstraction** as the keystone — production keeps using `react-native-sqlite-storage` unchanged, while tests use a `better-sqlite3`-backed Node adapter that runs real SQL. This single architectural change unlocks: real migration testing, real integration tests for sync code, schema-parity verification against the Go backend, and E2E tests that spawn a real Harmony Link instance in Docker. The plan also modernizes Jest (29 → 30 + `@react-native/jest-preset`), introduces a Maestro-based E2E pipeline running inside Docker Compose for Android (mirroring the Soulbits Cloud Backend repo's pattern), and adds CI gates that run all tests on every PR and as a precondition to release builds.

## Background Research

This plan synthesizes five deep research reports produced by parallel code-expert subagents on 2026-07-20. The full reports are preserved in [`research/`](research/) alongside this plan:

1. [`research/01-sqlite-under-jest.md`](research/01-sqlite-under-jest.md) — concluded `better-sqlite3` + `Database` interface abstraction is the keystone.
2. [`research/02-migration-testing.md`](research/02-migration-testing.md) — recommended snapshot tests + cross-language parity gate, with long-term Atlas/vendored-DDL option.
3. [`research/03-sync-integration-e2e.md`](research/03-sync-integration-e2e.md) — recommended real DB + `jest-websocket-mock`, Maestro over Detox for E2E.
4. [`research/04-jest-vs-vitest.md`](research/04-jest-vs-vitest.md) — concluded stay on Jest, modernize to Jest 30 + `@react-native/jest-preset`.
5. [`research/05-docker-maestro-e2e.md`](research/05-docker-maestro-e2e.md) — confirmed Android E2E in Docker via `budtmo/docker-android` + Harmony Link as Compose service; iOS requires macOS runner (cannot run in Docker).

No `.planning/codebase/` mapping documents exist for this repo, so none were consulted. The plan aligns with conventions observed in `.current_work/ci-cd-s3-release-pipeline/` (folder + `summary.md` + numbered phase files).

## Harmony Link (`harmony-link-private`) Preparation

Since the same developer owns both repos, the following Go-side work is part of this overhaul (detailed in Phases 5-2 and 6-2). It can be done in any order relative to the RN-side phases, but should be ready before Phase 7's parity CI gate and E2E jobs go live:

- **PAT for CI access** — create a fine-grained Personal Access Token with `contents: read` on `harmony-link-private`; store as `HARMONY_LINK_REPO_PAT` in the RN repo's GitHub Actions secrets.
- **`cmd/dump-schema` CLI** (Phase 5-2) — applies all Go migrations to an in-memory SQLite DB and dumps normalized JSON matching the RN side's shape. ~1 day.
- **`/health` HTTP endpoint** (Phase 6-2) — small Go addition returning 200 once migrations are applied and the WSS listener is bound. ~20 LoC if not already present.
- **`Dockerfile.e2e` + `scripts/generate-e2e-certs.sh`** (Phase 6-2) — packages the backend as a Docker image that generates a self-signed CA + server cert at startup. ~2 days.
- **E2E config file** (`configs/e2e.yaml`) — in-memory DB, debug logging, TLS=self-signed.
- **Optional: seed data mechanism** — a way for the E2E stack to pre-populate the Go DB with known fixtures (e.g., a "Test Character" the Maestro happy-path flow looks for).
- **Migration cadence discipline** — whenever either side adds a migration, both sides must add it. The Phase 5-3 CI gate makes this enforced rather than aspirational.

## Phases at a Glance

| Phase | Topic | Files | Effort | Priority |
|-------|-------|-------|--------|----------|
| 1 | Jest Modernization & Cleanup | 2 | 1–2 days | High |
| 2 | Database Abstraction Layer | 4 | 3–5 days | High (keystone) |
| 3 | Migration Testing | 3 | 2–3 days | High |
| 4 | Sync Integration Testing | 3 | 3–5 days | High |
| 5 | Cross-Language Schema Parity | 3 | 2–3 days | Medium |
| 6 | E2E with Docker + Maestro | 6 | 1–2 weeks | Medium |
| 7 | CI Pipeline Integration | 3 | 2–3 days | High |
| 8 | Documentation & Future Work | 2 | 1 day | Medium |

## Target Test Pyramid

```
        ┌────────────────┐
        │   E2E (~5%)    │  Maestro in Docker Compose (Android) + cloud (iOS)
        │  Full device   │  boot → migrate → WSS connect → sync → UI
        ├────────────────┤
        │ Integration    │  Jest + real SQLite (better-sqlite3) + jest-websocket-mock
        │   (~25%)       │  SyncService, sync helpers, conflict, retry, clock drift
        ├────────────────┤
        │  Unit (~70%)   │  Jest + RNTL
        │                │  Repository functions, parsers, UI components
        └────────────────┘
```

## Implementation Status

Track the completion of each phase as implementation progresses:

- [x] **Phase 1: Jest Modernization & Cleanup** ✅
  - [x] [1-1-Jest30Upgrade.md](1-1-Jest30Upgrade.md) — Migrate Jest 29 → 30, switch to `@react-native/jest-preset`
  - [x] [1-2-DeleteBrokenTestRunner.md](1-2-DeleteBrokenTestRunner.md) — Remove `run-db-tests.js`, `run-all-tests.ts`, and the hand-rolled `runTest`/`runTestWithCleanup` helpers
- [x] **Phase 2: Database Abstraction Layer** ✅ *(keystone — blocks Phases 3, 4)*
  - [x] [2-1-DatabaseInterface.md](2-1-DatabaseInterface.md) — Define `Database` interface matching the subset of the `react-native-sqlite-storage` API in use
  - [x] [2-2-BetterSqlite3NodeAdapter.md](2-2-BetterSqlite3NodeAdapter.md) — Test-only adapter implementing `Database` on top of `better-sqlite3`
  - [x] [2-3-RepositoryMigrationToInterface.md](2-3-RepositoryMigrationToInterface.md) — Refactor `connection.ts` and the ~10 repository files to import the interface
  - [x] [2-4-AdapterCompatibilityTest.md](2-4-AdapterCompatibilityTest.md) — Smoke test running identical queries through both adapters
- [x] **Phase 3: Migration Testing** ✅
  - [x] [3-1-SchemaSnapshotTest.md](3-1-SchemaSnapshotTest.md) — Run all 32 migrations, snapshot `sqlite_master`
  - [x] [3-2-RollForwardTest.md](3-2-RollForwardTest.md) — Verify every version boundary upgrades cleanly
  - [x] [3-3-ConvertHandRolledDbTests.md](3-3-ConvertHandRolledDbTests.md) — Port the 5 existing `*.test.ts` DB tests to real Jest tests using the Node adapter
- [x] **Phase 4: Sync Integration Testing** ✅
  - [x] [4-1-WSSMockInfrastructure.md](4-1-WSSMockInfrastructure.md) — Add `jest-websocket-mock`, factory for swapping WSS impl in tests, **+ production env-var override** (completed in post-plan work, see file)
  - [x] [4-2-SyncServiceIntegrationTest.md](4-2-SyncServiceIntegrationTest.md) — Rewrite `SyncService.test.ts` with real DB + mocked WSS, full protocol flow. Old test **deleted** in post-plan cleanup (was quarantined to `__legacy__/`, then removed).
  - [x] [4-3-EdgeCaseScenarios.md](4-3-EdgeCaseScenarios.md) — Conflict resolution, network drop + retry, clock drift
- [x] **Phase 5: Cross-Language Schema Parity** ✅
  - [x] [5-1-RNSchemaDumpUtility.md](5-1-RNSchemaDumpUtility.md) — CLI that dumps normalized schema JSON from the RN migrations
  - [x] [5-2-GoSchemaDumpCommand.md](5-2-GoSchemaDumpCommand.md) — Counterpart command in `harmony-link-private` (cross-repo coordination)
  - [x] [5-3-ParityCIGate.md](5-3-ParityCIGate.md) — CI job that diffs both dumps and fails on drift. **9 divergences found (2 CRITICAL)** — see `schema-parity-findings.md` and `docs/future-work.md` #16.
- [x] **Phase 6: E2E with Docker + Maestro** ✅ *(infrastructure complete; flows not yet validated against a live emulator — see "Post-Plan Work" below)*
  - [x] [6-1-DockerComposeStack.md](6-1-DockerComposeStack.md) — Top-level compose file orchestrating all services. **Image updated to `soulbits/harmony-link:latest`** (locally-built) in post-plan work.
  - [x] [6-2-HarmonyLinkService.md](6-2-HarmonyLinkService.md) — Go backend container with self-signed cert generation at startup
  - [x] [6-3-AndroidEmulatorService.md](6-3-AndroidEmulatorService.md) — `budtmo/docker-android` service with KVM acceleration. **Validated working in WSL2+Docker Desktop** in post-plan work (see `spike-results-6-3.md`). Healthcheck fixed (greps `READY`, not `device_status=online`).
  - [x] [6-4-SelfSignedTLSBootstrap.md](6-4-SelfSignedTLSBootstrap.md) — App-side trust configuration (`network_security_config.xml`, env-var CA injection)
  - [x] [6-5-MaestroFlows.md](6-5-MaestroFlows.md) — YAML flows covering boot, handshake, sync, conflict, reconnect. **Selectors rewritten in post-plan work** — now use real i18n strings + state-derived testIDs (see file).
  - [x] [6-6-IOSMacOSRunner.md](6-6-IOSMacOSRunner.md) — iOS E2E on macOS GitHub Actions runner (Android flows reused)
- [x] **Phase 7: CI Pipeline Integration** ✅
  - [x] [7-1-PullRequestTestWorkflow.md](7-1-PullRequestTestWorkflow.md) — New `test.yml` workflow running unit + integration tests on every PR
  - [x] [7-2-PreReleaseTestGate.md](7-2-PreReleaseTestGate.md) — Modify `build-release.yml` to require passing tests before building APK/IPA
  - [x] [7-3-E2EAndParityJobs.md](7-3-E2EAndParityJobs.md) — E2E Android (Docker), E2E iOS (cloud), and schema-parity jobs
- [x] **Phase 8: Documentation & Future Work** ✅
  - [x] [8-1-TestingStrategyDoc.md](8-1-TestingStrategyDoc.md) — Document the new testing strategy in `docs/`
  - [x] [8-2-FutureWorkBacklog.md](8-2-FutureWorkBacklog.md) — Atlas/vendored DDL, Pact contracts, Vitest re-evaluation, SQLCipher smoke test on device

---

## Post-Plan Work (after initial 8 phases shipped)

The following work was done after the initial implementation pass and is documented here so the next maintainer has an accurate picture.

### ✅ Smoke test verified

`npm test` passes consistently:
```
Test Suites: 18 passed, 18 total
Tests:       1 skipped, 153 passed, 154 total
Snapshots:   10 passed, 10 total
```

### ✅ Legacy `SyncService.test.ts` deleted

Originally quarantined to `__tests__/services/__legacy__/`. Then deleted entirely
in a follow-up cleanup — its protocol knowledge was fully extracted into
`__tests__/integration/helpers/HarmonyLinkMockServer.ts` and the new integration
test suite. The `jest.config.js` `testPathIgnorePatterns` entry that excluded
`__legacy__/` was also removed.

### ✅ Docker Compose image updated to `soulbits/harmony-link:latest`

The compose file originally referenced `harmonyai/harmony-link:latest` (Docker Hub,
Dec 2025). Replaced with the locally-built `soulbits/harmony-link:latest` image
(fresh from `harmony-link-private/Dockerfile.build`) and added `pull_policy: never`
so it doesn't try to fetch from Docker Hub.

### ✅ Emulator boot healthcheck bug fixed

`budtmo/docker-android:emulator_14.0` writes `READY` to
`/home/androidusr/device_status` when booted. The original healthcheck grepped
for `device_status=online` or `booted` (incorrect patterns from older docs).
Fixed to grep for `READY`.

### ✅ WSL2 + Docker Desktop KVM validated

The original `spike-results-6-3.md` was DEFERRED based on assumption. Re-validated
empirically: `/dev/kvm` is exposed inside containers on Windows 11 + WSL2 + Docker
Desktop out of the box. Emulator cold-boot takes ~50 seconds with hardware accel.
See `spike-results-6-3.md` for full evidence and CI gotchas.

### ✅ Phase 4-1 production-side env-var override implemented

The original Phase 4-1 shipped the test-side factory (`createWebSocket.ts`) but
deferred the production-side `HARMONY_LINK_WSS_URL` override. That gap is now
closed in `src/services/ConnectionStateManager.ts:applyE2EOverride()`. Strategy:
pre-seed AsyncStorage with expired-token state so `SyncConnectionContext` takes
the `connectWithRefresh()` path, which runs the WS handshake. In cloud mode
(`CLOUD_MODE=true` on the harmony-link container), the server auto-approves new
devices during handshake (see `harmony-link-private/eventserver/synchronization.go:260`).

Build mechanism: pass `-PHARMONY_LINK_WSS_URL=...` and `-PHARMONY_LINK_WS_URL=...`
to gradle. Helper scripts: `e2e/build-apk.sh` + `e2e/build-apk.ps1`. Verified
that BuildConfig.java contains both URLs after the build.

### ✅ Maestro flow selectors rewritten

All 6 Maestro YAML files had placeholder selectors (`text: ".*"`,
`text: "Connected"`, `text: "E2E Test Character"`). Rewritten based on
investigation of the actual UI:

- `01-smoke-boot.yaml` — uses real text `"Chats"`, `"Not connected"`, `"Connect Now"`.
  Will pass on cold launch (unpaired).
- `02-happy-path-pull.yaml` — uses state-derived testIDs.
- `03-conflict-resolution.yaml` — uses testIDs for character edit + sync trigger.
- `04-network-reconnect.yaml` — uses reconnecting/connected testIDs.
- `_shared/navigate-to-sync-settings.yaml` — uses tab + card testIDs.

### ✅ testIDs added to UI components (Phase B-1)

For Maestro to use stable selectors that survive copy changes:
- `ConnectionStatusBadge` → `connection-status-dot-{connected,reconnecting,disconnected,not-paired}` (state-dependent)
- All 5 tab buttons (`tab-discover`, `tab-search`, `tab-chat`, `tab-characters`, `tab-settings`) via `tabBarButtonTestID`
- `ChatListScreen` → `chat-list-item`, `chat-list-not-paired`, `chat-list-empty`, `connect-now-button`
- `SettingsScreen` → `settings-connection-card`, `settings-sync-card`
- `SyncSettingsScreen` → `sync-now-button`, `force-resync-button`
- `CharacterProfileEditScreen` → `character-name-input`
- `CharacterProfileCard` → `character-profile-card`
- `ThemedButton` → accepts and forwards `testID` + `accessibilityLabel` to all 4 variants

### ⏳ E2E stack run (next session)

The full `docker compose -f e2e/docker-compose.yml up` end-to-end run is **not yet
executed**. Prerequisites are all in place:
- `soulbits/harmony-link:latest` image present locally
- `budtmo/docker-android:emulator_14.0` image pulled
- KVM acceleration validated
- `BuildConfig.java` confirmed to contain both `HARMONY_LINK_WSS_URL` and `HARMONY_LINK_WS_URL` after `-P` flag build
- `e2e/app-debug.apk` buildable via `e2e/build-apk.ps1` (PowerShell) or `e2e/build-apk.sh` (WSL)

**Known risk**: even with auto-pairing, the cloud-mode handshake returns an empty
JWT. The client's `connectWithRefresh()` flow expects a JWT in the response and
calls `saveConnectionCredentials()` — with empty values. This *should* work
(server doesn't validate JWT in cloud mode, and the empty string satisfies
`jwtToken !== null`), but has not been verified end-to-end.

### ⏳ Still-open items (in `docs/future-work.md`)

- #15: `clock_drift_seconds` is still ignored by `SyncService`
- #16: 9 schema divergences (2 CRITICAL: missing FKs on `conversation_messages` + `interactions`)
- #17: `setTimeout` without `.unref()` in `SyncService.sendSyncDataWithConfirmation` (15-min fix)
- #18: 5 repositories with zero test coverage (`EmotionState`, `EmojiAction`, `SyncDevice`, `ConversationMessage`, `Interaction`)
- iOS E2E runner explicitly excluded from GHA for now

## Key Decisions

- **Stay on Jest, modernize to v30.** Vitest is not production-ready for RN in mid-2026 (`vitest-native` is beta, ~85% pass rate on `react-native-paper`, no public production migration stories). Re-evaluate in ~12 months.
- **`better-sqlite3` as the Node SQLite driver**, not `node:sqlite` (experimental, no SQLCipher, wrong API) or WASM options (no SQLCipher, slower).
- **SQLCipher compatibility is verified by a small on-device smoke test only** (see Phase 8). Every-day tests run on plain SQLite — encryption is orthogonal.
- **Maestro over Detox for E2E.** Detox officially supports RN 0.77–0.84; this repo is on RN 0.86. Maestro's black-box approach is more upgrade-resilient.
- **Android E2E runs in Docker Compose** mirroring the Soulbits Cloud Backend pattern. **iOS E2E runs on a macOS GitHub Actions runner** — iOS Simulator cannot run in Docker (Apple EULA + technical reasons). The same Maestro YAML flows are reused for both platforms.
- **Schema parity uses dump-and-diff in CI** as the initial gate. Long-term option: extract a vendored canonical schema file or adopt Atlas (deferred to Phase 8 backlog).

## Risks & Spike Items

Things to validate early in execution (each is a 1–2 day spike, none blocks planning):

1. **`better-sqlite3` build on Windows + CI** — prebuilts exist for Win/x64 Node 20–25, but `node-gyp` may fail without VS Build Tools. Validate on day 1 of Phase 2.
2. **`react-native-sqlite-storage` binds all numbers as doubles** (issue #4141). The Node adapter will bind ints correctly, so some tests may pass in Node but fail on device. Decide whether to add an Android emulator CI step for a subset of repository tests natively.
3. **`jest-websocket-mock` + Jest fake timers conflict.** Sync has timeout/retry logic — decide upfront whether time-sensitive tests use real timers or a workaround.
4. **Two-connection-pool design** in `connection.ts` (main + sync for WAL concurrency). The Node adapter must support this — test specifically.
5. **WSL2 + KVM reliability for local Android E2E** on Windows developers' machines. Backup plan: emulator-on-host + `adb connect host.docker.internal:5555`.
6. **React Native WebSocket + self-signed cert trust on Android** — `react-native-websocket-self-signed` is currently used; verify it accepts a CA pushed into the Android user cert store via `adb`. Backup plan: cleartext WS inside the Docker network.
