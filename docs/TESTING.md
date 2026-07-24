# Testing Strategy

This document describes how the HarmonyAIChat React Native app is tested,
what kinds of tests exist, and how to add new ones.

## Test Pyramid

```
        ┌────────────────┐
        │   E2E (~3%)    │  Maestro in Docker (Android) + macOS runner (iOS)
        ├────────────────┤
        │ Integration    │  Jest + real SQLite (better-sqlite3) + jest-websocket-mock
        │   (~14%)       │  22 tests / 7 suites
        ├────────────────┤
        │  Unit (~86%)   │  Jest + RNTL
        │  132 tests     │  11 suites (repositories, migrations, compat, smoke)
        └────────────────┘
```

**Total: 154 tests (153 passing, 1 known-skipped)** across 18 suites.

## Where Tests Live

| Layer | Directory | Run Command |
|---|---|---|
| Unit | `src/**/__tests__/*.test.ts(x)`, `__tests__/**/*.test.ts(x)` (excl. integration) | `npx jest --selectProjects unit` |
| Integration | `__tests__/integration/**/*.test.ts` | `npx jest --selectProjects integration` |
| Migration | `src/database/__tests__/migrations.*.test.ts` | `npx jest --selectProjects unit --testPathPatterns migrations` |
| E2E (Android) | `e2e/.maestro/*.yaml` | `docker compose -f e2e/docker-compose.yml up` |
| E2E (iOS) | `e2e/.maestro/*.yaml` | macOS GitHub Actions runner (nightly) |

### Unit Test Suites (11)

| Suite | File | Tests | What It Covers |
|---|---|---|---|
| Smoke | `nodeDatabase.smoke.test.ts` | 3 | `NodeDatabase` basic CRUD |
| Compat | `compat/nodeSide.test.ts` | 23 | NodeDatabase vs RN behavior compatibility |
| Snapshot | `migrations.snapshot.test.ts` | 3 | Migration schema snapshots (10 snapshots) |
| Roll-forward | `migrations.rollforward.test.ts` | 42 | All 28 migrations run forward, verify schema |
| Entities | `repositories/entities.test.ts` | 11 | Entity CRUD, CASCADE deletes |
| Characters | `repositories/characters.test.ts` | 14 | Character profile CRUD |
| Modules | `repositories/modules.test.ts` | 7 | Module config CRUD |
| Providers | `repositories/providers.test.ts` | 16 | Provider config CRUD (11 ported + 5 new) |
| Memories | `repositories/memories.test.ts` | 4 | Orphaned memory cleanup |
| Cross-repo | `repositories/cross-repo.test.ts` | 7 | Cross-repository referential integrity |
| App | `__tests__/App.test.tsx` | 1 | Root component smoke test (react-test-renderer) |

### Integration Test Suites (7)

| Suite | File | Tests | What It Covers |
|---|---|---|---|
| WSS Smoke | `wss.smoke.integration.test.ts` | 1 | WebSocket connection establishes |
| Sync Service | `syncService.integration.test.ts` | 8 | Happy-path sync flow |
| Conflicts | `sync.conflict.test.ts` | 3 | Conflict detection and resolution |
| Network | `sync.network.test.ts` | 3 | Reconnection and network resilience |
| Clock | `sync.clock.test.ts` | 3 | Clock drift handling |
| Failures | `sync.failures.test.ts` | 3 (1 skipped) | Error handling scenarios |
| Concurrent | `sync.concurrent.test.ts` | 2 | Concurrent sync sessions |

## Running Tests Locally

### All Tests

```bash
npm test
```

### Unit Tests Only

```bash
npx jest --selectProjects unit
```

### Integration Tests Only

```bash
npx jest --selectProjects integration
```

### Migration Tests (Snapshot + Roll-forward)

```bash
npx jest --selectProjects unit --testPathPatterns migrations
```

When you intentionally change the schema, update snapshots:

```bash
npx jest --selectProjects unit --testPathPatterns migrations --updateSnapshot
```

Review the diff carefully before committing.

### Type Check

```bash
npx tsc --noEmit
```

### E2E Tests (Android)

Requires Docker Desktop with KVM support (validated on Windows 11 + WSL2 + Docker Desktop, July 2026).

```bash
# 1. Build APK with E2E gradle properties (use the helper script)
./e2e/build-apk.sh              # Linux/macOS/WSL
# .\e2e\build-apk.ps1           # Windows PowerShell
# This passes -PHARMONY_LINK_WSS_URL and -PHARMONY_LINK_WS_URL to gradle
# and copies the APK to e2e/app-debug.apk

# 2. Build Harmony Link image locally (in harmony-link-private repo)
cd ../harmony-link-private
docker build -f Dockerfile.build -t soulbits/harmony-link:latest .

# 3. Start the stack
cd ../harmony-ai-app
docker compose -f e2e/docker-compose.yml up
```

> **Note:** The compose file uses `soulbits/harmony-link:latest` (locally-built)
> with `pull_policy: never`. Don't use `harmonyai/harmony-link:latest` from
> Docker Hub for E2E — it's stale (Dec 2025) and may diverge from the
> backend code you're testing against.

### E2E Tests (iOS — currently deferred)

> **Status (July 2026):** The `.github/workflows/e2e-ios.yml` workflow exists
> but is **not triggered**. iOS E2E is excluded until the Android stack is
> validated end-to-end. See `docs/future-work.md` item #21.

macOS only. Runs via GitHub Actions on the macos-latest runner. See `e2e/README.md` for manual invocation instructions.

## CI

### Workflows

| Workflow | Trigger | What It Runs |
|---|---|---|
| `.github/workflows/test.yml` | Every PR | TypeScript type check, unit tests, integration tests, lint |
| `.github/workflows/schema-parity.yml` | Every PR + tags | Compares RN schema against Go server schema |
| `.github/workflows/e2e-android.yml` | Nightly (03:00 UTC) + manual | Full Android E2E suite in Docker |
| `.github/workflows/e2e-ios.yml` | Nightly (03:00 UTC) + manual | Full iOS E2E suite on macOS runner |
| `.github/workflows/build-release.yml` | Tag push | Release build (gated on `test` + `schema-parity`) |

### Run Cadence

- **Every PR**: type-check + unit + integration + migration + schema parity
- **Nightly (03:00 UTC)**: full Android E2E (Docker) + iOS E2E (macOS runner)
- **Pre-release**: all of the above must pass before the release build starts

## Architecture Decisions

These are deliberate, not accidental. Read this section before proposing changes.

### Stay on Jest 30 (not Vitest)

Vitest's React Native support is still beta as of mid-2026 (`vitest-native` plugin achieves ~85% pass rate on real-world suites). Jest 30 + `@react-native/jest-preset` is the canonical path endorsed by the React Native team. **Re-evaluate Vitest in ~12 months** (see `docs/future-work.md`).

### `better-sqlite3` as Node SQLite driver (not `node:sqlite`)

`node:sqlite` (Node 22+, Stability 1.1) does not support SQLCipher and has a different API shape. `better-sqlite3` is synchronous, fast, and has no RN-native dependencies. It wraps the same SQLite C library that `react-native-sqlite-storage` uses on device. **Re-evaluate `node:sqlite` when it reaches Stability 2** (see `docs/future-work.md`).

### Database abstraction via interface

Production uses `react-native-sqlite-storage` with SQLCipher via the `ReactNativeDatabase` adapter (`src/database/reactNativeDatabase.ts`). Tests cannot use this (it requires the native RN runtime). The `Database` interface (`src/database/types.ts`) lets production and tests share repository code while swapping the underlying driver. Tests use `NodeDatabase` (`src/database/__test_utils__/nodeDatabase.ts`) backed by `better-sqlite3`, injected via Jest's `moduleNameMapper`.

### SQLCipher verified by on-device smoke test only

SQLCipher encryption is not supported by any Node SQLite driver. Most repository and migration tests don't depend on encryption behavior — they care about SQL semantics, which are identical with or without encryption. A small on-device smoke test (see `docs/future-work.md`) verifies encryption end-to-end before each release.

### Schema parity via dump-and-diff in CI

Parity requires comparing the RN client schema against the Go server schema — two different codebases that can't be tested in a single Jest run. The dedicated `schema-parity.yml` workflow fetches the Go repo, runs both `dump-schema` commands, and diffs the JSON outputs. **Long-term goal**: vendored canonical schema file or Atlas HCL descriptor (see `docs/future-work.md`).

### Maestro over Detox for E2E

Detox officially supports React Native 0.77–0.84. This repo is on RN 0.86. Maestro works at the black-box UI level and is not tied to a specific RN version. Android E2E runs in Docker Compose (budtmo/docker-android emulator + harmony-link backend + maestro-runner). iOS E2E runs on macOS GitHub Actions runners.

## Adding a New Test

### Walkthrough: Unit Test for a Repository

```typescript
// src/database/__tests__/repositories/<name>.test.ts
import {useFreshDatabase} from '../repositoryFixtures';
import * as repo from '../../repositories/<name>';

describe('<name> repository', () => {
  const {getDb} = useFreshDatabase();

  it('creates a record', async () => {
    const result = await repo.create({id: 'test-1', ...});
    expect(result).toBeDefined();
    expect(result.id).toBe('test-1');
  });

  it('deletes a record', async () => {
    await repo.create({id: 'test-1', ...});
    await repo.delete('test-1');
    const found = await repo.get('test-1');
    expect(found).toBeNull();
  });
});
```

Run: `npx jest --selectProjects unit`.

### Walkthrough: Integration Test for a Sync Scenario

```typescript
// __tests__/integration/sync.<scenario>.test.ts
import {HarmonyLinkMockServer} from './helpers';
import {runFullSync} from './helpers';

describe('sync <scenario>', () => {
  let server: HarmonyLinkMockServer;

  beforeEach(() => { server = new HarmonyLinkMockServer(); });
  afterEach(() => server.close());

  it('handles the scenario', async () => {
    // Configure mock server expectations
    server.expectMessage('sync:request', () => ({status: 'ok'}));
    await runFullSync();
    expect(server.receivedEvents).toContainEqual(
      expect.objectContaining({type: 'sync:completed'})
    );
  });
});
```

Run: `npx jest --selectProjects integration`.

### Walkthrough: Maestro E2E Flow

1. Create `e2e/.maestro/<NN>-<name>.yaml` (NN = next available number, e.g., `04-send-message.yaml`)
2. Use `launchApp: clearState: true` for isolation
3. Test locally: `docker compose -f e2e/docker-compose.yml up maestro-runner`

Example flow:

```yaml
appId: ai.soulbits.chat
---
- launchApp:
    clearState: true
- tapOn: "Connect"
- assertVisible: "Connection Status"
```

### Walkthrough: Migration Change

1. Add a new numbered file in `src/database/migrations/`: `000029_description.ts`
2. Export the SQL string
3. Register it in `src/database/migrations/index.ts`
4. Run snapshot update: `npx jest --selectProjects unit --testPathPatterns migrations --updateSnapshot`
5. Review the snapshot diff carefully
6. If the schema changed, coordinate with the Go team — update `harmony-link-private` migration too
7. Refresh the committed baseline: `npm run schema:dump -- --output schema/rn-schema.json`
8. Commit both the migration and the updated snapshots/baseline

## Troubleshooting

### "Cannot find module 'better-sqlite3'"

Install dev dependencies:

```bash
npm install
```

### "better-sqlite3 build failed"

This is a native module. Install build tools:

- **Windows**: Visual Studio Build Tools (select "Desktop development with C++")
- **macOS**: `xcode-select --install`
- **Linux**: `apt install build-essential python3`

### Snapshot Test Fails After Migration Change

The snapshot test is working as designed. Review the diff — if the change is intentional:

```bash
npx jest --selectProjects unit --testPathPatterns migrations --updateSnapshot
```

Commit the updated snapshot together with the migration.

### Integration Test Times Out

Check that `HarmonyLinkMockServer` is responding to all expected messages. Use `mockServer.receivedEvents` to see what the client actually sent. Default timeout is 10s; increase with `jest.setTimeout(20000)` if the scenario legitimately takes longer.

### E2E Test Hangs on "Waiting for Emulator..."

The Android emulator in Docker takes 1–5 minutes to boot. If it exceeds 5 minutes:

- Check KVM availability on the host: `ls -la /dev/kvm` (Linux)
- On Windows, ensure Hyper-V / WSL2 is enabled and virtualization is on in BIOS
- On macOS, Docker Desktop handles this automatically via Apple Hypervisor

### "A worker process has failed to exit gracefully"

This is caused by active timers not being cleaned up. Known occurrence in `SyncService.sendSyncDataWithConfirmation` (the `.unref()` fix is in the backlog — see `docs/future-work.md`). The test suite still passes; this warning is informational.

## See Also

- [`.current_work/test-framework-overhaul/summary.md`](../.current_work/test-framework-overhaul/summary.md) — full implementation plan for this framework
- [`e2e/README.md`](../e2e/README.md) — E2E setup and CI schedule details
- [`docs/future-work.md`](future-work.md) — known gaps, deferred items, and improvement roadmap
