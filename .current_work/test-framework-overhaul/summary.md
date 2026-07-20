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

- [ ] **Phase 1: Jest Modernization & Cleanup**
  - [ ] [1-1-Jest30Upgrade.md](1-1-Jest30Upgrade.md) — Migrate Jest 29 → 30, switch to `@react-native/jest-preset`
  - [ ] [1-2-DeleteBrokenTestRunner.md](1-2-DeleteBrokenTestRunner.md) — Remove `run-db-tests.js`, `run-all-tests.ts`, and the hand-rolled `runTest`/`runTestWithCleanup` helpers
- [ ] **Phase 2: Database Abstraction Layer** *(keystone — blocks Phases 3, 4)*
  - [ ] [2-1-DatabaseInterface.md](2-1-DatabaseInterface.md) — Define `Database` interface matching the subset of the `react-native-sqlite-storage` API in use
  - [ ] [2-2-BetterSqlite3NodeAdapter.md](2-2-BetterSqlite3NodeAdapter.md) — Test-only adapter implementing `Database` on top of `better-sqlite3`
  - [ ] [2-3-RepositoryMigrationToInterface.md](2-3-RepositoryMigrationToInterface.md) — Refactor `connection.ts` and the ~10 repository files to import the interface
  - [ ] [2-4-AdapterCompatibilityTest.md](2-4-AdapterCompatibilityTest.md) — Smoke test running identical queries through both adapters
- [ ] **Phase 3: Migration Testing**
  - [ ] [3-1-SchemaSnapshotTest.md](3-1-SchemaSnapshotTest.md) — Run all 32 migrations, snapshot `sqlite_master`
  - [ ] [3-2-RollForwardTest.md](3-2-RollForwardTest.md) — Verify every version boundary upgrades cleanly
  - [ ] [3-3-ConvertHandRolledDbTests.md](3-3-ConvertHandRolledDbTests.md) — Port the 5 existing `*.test.ts` DB tests to real Jest tests using the Node adapter
- [ ] **Phase 4: Sync Integration Testing**
  - [ ] [4-1-WSSMockInfrastructure.md](4-1-WSSMockInfrastructure.md) — Add `jest-websocket-mock`, factory for swapping WSS impl in tests
  - [ ] [4-2-SyncServiceIntegrationTest.md](4-2-SyncServiceIntegrationTest.md) — Rewrite `SyncService.test.ts` with real DB + mocked WSS, full protocol flow
  - [ ] [4-3-EdgeCaseScenarios.md](4-3-EdgeCaseScenarios.md) — Conflict resolution, network drop + retry, clock drift
- [ ] **Phase 5: Cross-Language Schema Parity**
  - [ ] [5-1-RNSchemaDumpUtility.md](5-1-RNSchemaDumpUtility.md) — CLI that dumps normalized schema JSON from the RN migrations
  - [ ] [5-2-GoSchemaDumpCommand.md](5-2-GoSchemaDumpCommand.md) — Counterpart command in `harmony-link-private` (cross-repo coordination)
  - [ ] [5-3-ParityCIGate.md](5-3-ParityCIGate.md) — CI job that diffs both dumps and fails on drift
- [ ] **Phase 6: E2E with Docker + Maestro**
  - [ ] [6-1-DockerComposeStack.md](6-1-DockerComposeStack.md) — Top-level compose file orchestrating all services
  - [ ] [6-2-HarmonyLinkService.md](6-2-HarmonyLinkService.md) — Go backend container with self-signed cert generation at startup
  - [ ] [6-3-AndroidEmulatorService.md](6-3-AndroidEmulatorService.md) — `budtmo/docker-android` service with KVM acceleration
  - [ ] [6-4-SelfSignedTLSBootstrap.md](6-4-SelfSignedTLSBootstrap.md) — App-side trust configuration (`network_security_config.xml`, env-var CA injection)
  - [ ] [6-5-MaestroFlows.md](6-5-MaestroFlows.md) — YAML flows covering boot, handshake, sync, conflict, reconnect
  - [ ] [6-6-IOSMacOSRunner.md](6-6-IOSMacOSRunner.md) — iOS E2E on macOS GitHub Actions runner (Android flows reused)
- [ ] **Phase 7: CI Pipeline Integration**
  - [ ] [7-1-PullRequestTestWorkflow.md](7-1-PullRequestTestWorkflow.md) — New `test.yml` workflow running unit + integration tests on every PR
  - [ ] [7-2-PreReleaseTestGate.md](7-2-PreReleaseTestGate.md) — Modify `build-release.yml` to require passing tests before building APK/IPA
  - [ ] [7-3-E2EAndParityJobs.md](7-3-E2EAndParityJobs.md) — E2E Android (Docker), E2E iOS (cloud), and schema-parity jobs
- [ ] **Phase 8: Documentation & Future Work**
  - [ ] [8-1-TestingStrategyDoc.md](8-1-TestingStrategyDoc.md) — Document the new testing strategy in `docs/`
  - [ ] [8-2-FutureWorkBacklog.md](8-2-FutureWorkBacklog.md) — Atlas/vendored DDL, Pact contracts, Vitest re-evaluation, SQLCipher smoke test on device

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
