# Testing Patterns

**Analysis Date:** 2026-08-07

> Authoritative strategy doc: `docs/TESTING.md` (updated after the test-framework
> overhaul, Phases 1–8). This file reflects the current state: Jest 30 multi-project
> setup, real-SQLite database tests via `better-sqlite3`, EventEmitter-based sync
> integration tests, and Maestro E2E. The old hand-rolled runner
> (`run-db-tests.js`, `run-all-tests.ts`, `test-utils.ts`) is **deleted**.

## Test Framework

**Runner:**
- Jest 30.4.2 (see `package.json` `devDependencies`; `overrides` pin jest-environment-node/jest-mock/@jest/fake-timers/jest-util to `^30`)
- Config: `jest.config.js` — **multi-project**:
  - `unit` project: `@react-native/jest-preset`, `testEnvironment: 'node'`, matches `src/**/*.test.ts(x)` and `__tests__/**/*.test.ts(x)` minus `__tests__/integration/`
  - `integration` project: `@react-native/jest-preset`, `testEnvironment: 'node'`, matches `__tests__/integration/**/*.test.ts`
- Preset: `@react-native/jest-preset` (v0.86.0); Babel via `babel.config.js` → `module:@react-native/babel-preset`
- `setupFiles: ['./jest.setup.js']` for both projects
- `transformIgnorePatterns` whitelist: `react-native`, `@react-native`, `@react-navigation`, `react-native-fs`, `react-native-keychain`, `react-native-sqlite-storage`, `@react-native-documents`, `react-native-vector-icons`, `react-native-linear-gradient`, `react-native-safe-area-context`, `react-native-screens`, `react-native-paper`, `react-native-config`, `uuid`, `react-native-track-player`, `@invertase`, `@react-native-google-signin`, `@react-native-community`

**Assertion Library:**
- Jest built-in `expect` (jest 30); `@testing-library/jest-native` (v5.4.3) present in devDependencies but the current suites use plain `expect` matchers
- `react-test-renderer` v19 used for the root smoke test only (`__tests__/App.test.tsx`)

**UI Testing Library:**
- `@testing-library/react-native` v14 (RNTL) — **`render()` is async in v14; every render must be awaited** (see `src/components/cloud/__tests__/CloudProvisioningCard.render.test.tsx`)

**Run Commands:**
```bash
npm test                                          # test:unit then test:integration
npm run test:unit                                 # jest --selectProjects unit --maxWorkers=45
npm run test:integration                          # jest --selectProjects integration
npm run test:raw                                  # jest (both projects, default worker pool — can trigger known DB issue)
npx jest --selectProjects unit --testPathPatterns migrations           # migration tests only
npx jest --selectProjects unit --testPathPatterns migrations --updateSnapshot  # refresh snapshots
npx jest --selectProjects integration <file> --forceExit               # single integration file
npx tsc --noEmit                                  # type check
```

**Why `--maxWorkers=45` (unit):** better-sqlite3 (native addon) intermittently fails
("Received function did not throw") on UNIQUE/FK/rollback assertions when multiple DB
test files share one Jest worker. Running each unit file in its own worker avoids
cross-worker contamination. **Bump `--maxWorkers` in `package.json` if the unit suite
exceeds 45 files.** See the Known Issue section of `docs/TESTING.md`.

## Test File Organization

**Location:**
- Unit tests co-located in `__tests__/` dirs next to source:
  - `src/database/__tests__/` — DB repos, migrations, compat, smoke
  - `src/database/__tests__/repositories/` — `characters.test.ts`, `entities.test.ts`, `modules.test.ts`, `providers.test.ts`, `memories.test.ts`, `emotion_state.test.ts`, `cross-repo.test.ts`
  - `src/services/__tests__/` — `ConnectionStateManager.test.ts`, `BiometricLockService.test.ts`, `syncNameClash.test.ts`, entity session tests
  - `src/services/websocket/__tests__/`, `src/services/connection/__tests__/`, `src/services/cloud/__tests__/`
  - `src/contexts/__tests__/` — `AppAlertContext.test.tsx`, `BiometricLockContext.test.tsx`, `EntitySessionContext.retry.test.tsx`
  - `src/components/cloud/__tests__/`, `src/constants/__tests__/`, `src/utils/charactercard/__tests__/`
- Integration tests: `__tests__/integration/*.integration.test.ts` with helpers in `__tests__/integration/helpers/`
- E2E: `e2e/.maestro/*.yaml` (Maestro flows, not Jest)

**Naming:**
- Unit: `<name>.test.ts` / `<name>.test.tsx` (e.g., `providers.test.ts`, `BiometricLockService.test.ts`)
- Integration: `<topic>.integration.test.ts` with domain-first names (`sync.conflict.integration.test.ts`, `sync.network.integration.test.ts`, `wss.smoke.integration.test.ts`)
- Migration suites: `migrations.snapshot.test.ts`, `migrations.rollforward.test.ts`
- Root smoke: `__tests__/App.test.tsx`

**Structure:**
```
__tests__/
├── App.test.tsx                                  # Root render smoke (react-test-renderer)
├── cloudSessionService.test.ts
└── integration/
    ├── README.md
    ├── helpers/
    │   ├── HarmonyLinkMockServer.ts              # EventEmitter mock of sync protocol
    │   ├── resetSyncService.ts                    # Singleton reset helper
    │   ├── fixtures.ts                            # Data factories (sampleCharacter, ...)
    │   └── runFullSync.ts                         # Drive sync to completion w/ 10s timeout
    ├── wss.smoke.integration.test.ts
    ├── syncService.integration.test.ts
    ├── sync.conflict.integration.test.ts
    ├── sync.network.integration.test.ts
    ├── sync.clock.integration.test.ts
    ├── sync.failures.integration.test.ts
    ├── sync.concurrent.integration.test.ts
    └── syncNameClash.integration.test.ts

src/database/
├── __test_utils__/                               # NOT tests — runtime helper code
│   ├── nodeDatabase.ts                           # better-sqlite3 Database impl
│   ├── testDatabase.ts                           # createInMemoryDatabase / createFileDatabase
│   └── dumpSchema.ts                             # schema dump for snapshot tests
└── __tests__/
    ├── repositoryFixtures.ts                     # useFreshDatabase() / withFreshDatabase()
    ├── nodeDatabase.smoke.test.ts
    ├── compat/nodeSide.test.ts                   # RN-vs-Node behavior parity
    ├── migrations.snapshot.test.ts
    ├── migrations.rollforward.test.ts
    └── repositories/*.test.ts
```

**Snapshot files** (`.snap`) are committed alongside `migrations.snapshot.test.ts`
and `migrations.rollforward.test.ts`; schema changes require updating them deliberately.

## Test Structure

**Suite Organization:**
- `describe('...', () => { const {getDb} = useFreshDatabase(); ... })` at module level for DB fixtures
- `describe.each` / `it.each` for data-driven cases — roll-forward uses
  `describe.each(snapshotVersions)` and `it.each(MIGRATIONS.map(m => [m.version] as const))`;
  `CloudProvisioningCard.test.tsx` uses typed `it.each<[CloudSessionStatus, boolean, string]>`
- `test`/`it` with descriptive sentences: `it('returns 5 (default) when the key is unset', ...)`
- `beforeEach`/`afterEach` for state isolation; `jest.clearAllMocks()` / `jest.restoreAllMocks()`
  in lifecycle hooks

**Database fixture pattern** (`src/database/__tests__/repositoryFixtures.ts`):
```typescript
export function useFreshDatabase() {
  let db: NodeDatabase;
  beforeEach(async () => {
    db = createInMemoryDatabase();          // real SQLite :memory: via better-sqlite3
    await runMigrations(db, true);
    jest.spyOn(connection, 'getDatabase').mockReturnValue(db);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await db.close();
  });
  return { getDb: () => db };
}
```
Also `withFreshDatabase<T>(fn)` — the async per-test variant.

**Integration suite skeleton** (`__tests__/integration/syncService.integration.test.ts`):
- Module-level mutable refs (`testDbRef`, `mockServerRef`) so hoisted `jest.mock` factories can access them
- `jest.mock('../../src/database/connection', ...)` routes `getDatabase`/`getSyncDatabase` to the test DB
- `beforeEach`: clear AsyncStorage → fresh in-memory DB + migrations → new `HarmonyLinkMockServer` → `resetSyncServiceSingleton()` → inject mock ConnectionManager
- `runFullSync(syncService)` promise resolves on `sync:completed`, rejects on `sync:error` or timeout (default 10s)

## Mocking

**Framework:** Jest module mocks + `jest.spyOn`

**Global mocks** live in `jest.setup.js` (applied to every test, both projects):
- `react-native-sqlite-storage`, `react-native-fs`, `react-native-keychain` (full `ACCESS_CONTROL` enum — `BiometricLockService` reads it at module load), `react-native-biometrics` (constructor mock returning a **shared** instance so tests drive the same jest.fn), `@react-native-async-storage/async-storage`, `@react-native-documents/picker`, `react-native-paper` (string mocks), `@react-native-google-signin/google-signin`, `@invertase/react-native-apple-authentication`, `react-native-config`, `react-native-device-info`, `react-native-track-player`, `music-metadata` (`{virtual: true}` — ESM-only), `react-native-audio-record`, `react-native-image-picker`, `@react-native-clipboard/clipboard`, `react-native-vector-icons/MaterialCommunityIcons` ('Icon' string), `react-native-websocket-self-signed`, `react-native/Libraries/Utilities/Platform`
- Suppresses `console.warn`/`console.error` globally (silences RN warnings in CI output)

**Patterns:**
```typescript
// Replace global mock impl per-test (shared-instance handle)
const rnb = new (require('react-native-biometrics').default)();
beforeEach(() => {
  rnb.simplePrompt.mockReset();
  rnb.simplePrompt.mockResolvedValue({ success: false });
});

// In-memory Map backing AsyncStorage mock (tests real key names)
const store = new Map<string, string>();
(AsyncStorage.getItem as jest.Mock).mockImplementation(async (k: string) => store.get(k) ?? null);
```
- Hoisted-factory rule: `jest.mock` factories cannot reference outer variables — use `require()` inside the factory (documented in `CloudProvisioningCard.render.test.tsx` and `syncService.integration.test.ts`)
- Child-component stubbing: `jest.mock('../../themed/ThemedText', ...)` renders a light `Text` wrapper so `getByText`/`fireEvent.press` work without the theme dependency tree
- `jest.spyOn(connection, 'getDatabase')` for DB injection; `jest.clearAllMocks()` between tests
- Fake timers: `jest.useFakeTimers()` + `jest.advanceTimersByTime()` for timeouts/retries; **always** `jest.useRealTimers()` afterwards (28 call sites across suites)
- **Do NOT use fake timers in integration tests** — `setImmediate` in the mock server's async delivery conflicts (see `__tests__/integration/README.md`)

**What to Mock:**
- RN native modules, device APIs, storage, external connections (ConnectionManager boundary in integration tests)
- Child components whose dependency tree (Animated, gradients, theme) is noisy

**What NOT to Mock:**
- Business logic in pure TypeScript (test the real functions — e.g., `classifyCloudStage`)
- SQLite itself in DB tests — real `better-sqlite3` (`NodeDatabase`) exercises real migrations, FK/CASCADE, transactions
- `SyncService` state machine and `database/sync.ts` helpers in integration tests — only the network boundary is mocked

## Fixtures and Factories

**Repository tests:** `useFreshDatabase()`/`withFreshDatabase()` (`src/database/__tests__/repositoryFixtures.ts`); per-suite local helpers like `createMinimalProfile(id)` in `characters.test.ts` that fill NOT NULL defaults

**Integration fixtures** (`__tests__/integration/helpers/fixtures.ts`):
- Factory functions with an `overrides` spread: `sampleCharacter()`, `sampleEntity()`, `sampleProviderConfigOpenAI()`, `sampleProviderConfigSoulbitsCloud()`, `sampleSTTConfig()`, `sampleBackendConfig()`, `sampleVisionConfig()`, `sampleEntityModuleMapping()`, `sampleConversationMessage()`, `sampleMemory()`
- Random IDs via `randomId(prefix)` = `${prefix}${Math.random().toString(36).slice(2, 10)}`

**Mock server:** `HarmonyLinkMockServer.ts` — EventEmitter-based protocol mock (HANDSHAKE → SYNC_REQUEST → SYNC_DATA → SYNC_COMPLETE → SYNC_FINALIZE) with `setServerData`, `expectMessage`, `startAutoResponder`, `receivedEvents`, `reset()`. Chosen over `jest-websocket-mock` because global.WebSocket patching breaks under Jest 30 + jsdom.

## Coverage

**Requirements:** No coverage threshold enforced in `jest.config.js` or CI gates

**View Coverage:**
```bash
npx jest --selectProjects unit --coverage        # writes ./coverage/ (lcov + clover)
```
- Local `coverage/` contains `lcov-report/`, `lcov.info`, `clover.xml`, `coverage-final.json`
- CI (`test.yml`, unit-tests job) runs `--coverage --reporters=default --reporters=jest-junit` and uploads `coverage/` as an artifact (`unit-test-coverage`); results go to `reports/unit-tests.xml` via `jest-junit`

**Reports:**
- `reports/unit-tests.xml`, `reports/integration-tests.xml` (jest-junit output, committed/generated)
- `junit.xml` at repo root (older format)
- Jest config does not set `collectCoverageFrom` — coverage is per-file as run

## Test Types

**Unit Tests** (`npx jest --selectProjects unit`):
- Repository CRUD against real SQLite: `src/database/__tests__/repositories/*.test.ts`
- Service logic: `src/services/__tests__/`, `src/services/websocket/__tests__/`, `src/services/cloud/__tests__/`
- Context/component via RNTL: `src/contexts/__tests__/*.test.tsx`, `src/components/cloud/__tests__/*.test.tsx`
- Migration suites: snapshot (schema parity for all migrations) + roll-forward (every N→N+1 boundary)
- Pure helper tests: `CloudProvisioningCard.test.tsx` tests exported pure functions; `.render.test.tsx` tests the component

**Integration Tests** (`npx jest --selectProjects integration`):
- Real SyncService + real SQLite + real migrations; mock only the ConnectionManager/network boundary via `HarmonyLinkMockServer`
- 7 suites: wss smoke, happy-path sync, conflicts, network resilience, clock drift, failures (1 skipped), concurrent sessions
- Run with `--forceExit` — SyncService leaves 30s confirmation timers behind

**E2E Tests** (Maestro, `e2e/.maestro/*.yaml`):
- Android via Docker Compose stack `e2e/docker-compose.yml` (harmony-link + android-emulator + maestro-runner); iOS on macOS GitHub Actions runner (currently deferred)
- Flows: `01-smoke-boot.yaml`, `02-happy-path-pull.yaml`, `03-conflict-resolution.yaml`, `04-network-reconnect.yaml`, shared `_shared/navigate-to-sync-settings.yaml`
- Run: `docker compose -f e2e/docker-compose.yml up` (build APK first via `e2e/build-apk.sh` / `e2e/build-apk.ps1`)

**CI** (`.github/workflows/test.yml`, per PR + push to main):
- `typecheck`: `npx tsc --noEmit` + `npm run lint`
- `unit-tests`: unit project with coverage + jest-junit
- `integration-tests`: integration project with jest-junit
- `migration-tests`: `npx jest --selectProjects unit --testPathPatterns migrations`
- Also: `schema-parity.yml` (RN vs Go schema diff), `e2e-android.yml` + `e2e-ios.yml` (nightly 03:00 UTC), `build-release.yml` (tag push, gated on test + schema-parity)

## Common Patterns

**Async event-driven assertions** (`__tests__/integration/helpers/runFullSync.ts`):
```typescript
export async function runFullSync(syncService, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Sync did not complete within ${timeoutMs}ms`)), timeoutMs);
    const onCompleted = () => { clearTimeout(timeout); syncService.removeListener('sync:completed', onCompleted); resolve(); };
    const onError = (err) => { clearTimeout(timeout); syncService.removeListener('sync:error', onError); reject(new Error(err)); };
    syncService.on('sync:completed', onCompleted);
    syncService.on('sync:error', onError);
    syncService.initiateSync().catch(reject);
  });
}
```

**Data-driven `it.each`** (typed tuples):
```typescript
it.each<[CloudSessionStatus, boolean, string]>([
  ['ready', false, 'connecting'],
  ['ready', true, 'connected'],
])('maps status=%s isConnected=%s → %s', (status, isConnected, expected) => {
  expect(classifyCloudStage(status, isConnected)).toBe(expected);
});
```

**Error testing:**
```typescript
// Rejection style
await expect(BiometricLockService.authenticateBiometric()).resolves.toBe(false);
// SQLite constraint (real DB)
await expect(repo.create({id: 'dup'})).rejects.toThrow();  // UNIQUE/FK via better-sqlite3
```

**Timing/retry testing with fake timers:**
```typescript
jest.useFakeTimers();
rnb.simplePrompt.mockReturnValueOnce(new Promise(() => {}));  // never settles
const pending = BiometricLockService.authenticateBiometric();
jest.advanceTimersByTime(60000);
expect(await pending).toBe(false);
jest.useRealTimers();
```

**RNTL component tests:**
```typescript
const { getByText, getByTestId } = await render(<CloudProvisioningCard {...baseProps} status="failed" />);
fireEvent.press(getByText('Retry'));
expect(baseProps.onRetry).toHaveBeenCalled();
```
(v14: `render` returns a promise — await it; wrap in `await act(...)` when state updates matter)

## Pitfalls & Gotchas

1. **AsyncStorage state leaks between tests** — `AsyncStorage.clear()` in `beforeEach` (integration suite)
2. **Singleton state** — always `resetSyncServiceSingleton()` in `beforeEach` (integration suite)
3. **Mock server state** — `mockServer.reset()` in `afterEach`
4. **Fake timers vs integration** — never `jest.useFakeTimers()` in integration tests
5. **better-sqlite3 worker contamination** — keep `--maxWorkers` ≥ unit test file count; don't use `test:raw` casually
6. **Hoisted `jest.mock` scope** — factories can't reference outer variables; use `require()` inside
7. **RNTL v14 async render** — un-awaited `render()` yields undefined results
8. **Integration `--forceExit`** — needed due to leftover SyncService timers
9. **Snapshot updates** — review `migrations.*.snap` diffs carefully; commit alongside the migration
10. **`npx jest --selectProjects unit` without `--maxWorkers`** — may intermittently fail (see Known Issue in `docs/TESTING.md`)

---

*Testing analysis: 2026-08-07*
