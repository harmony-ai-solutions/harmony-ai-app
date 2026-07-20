# Phase 8-1: Testing Strategy Documentation

## Objective

Document the new testing strategy in `docs/` so future contributors understand what tests exist, where they live, how to run them, and why the architecture is the way it is. This prevents the current state (broken tests, no clear strategy) from recurring.

## Context

The previous testing setup had no documentation — the only signals were the broken `run-db-tests.js` script and the hand-rolled `run-all-tests.ts`. New contributors had no way to know how to add a test or what layer of test to write.

This phase creates a single canonical document that explains the strategy and points to the per-phase implementation details.

## Prerequisites

- Phases 1–7 complete (the strategy is implemented and working).

## Implementation Steps

### 1. Create `docs/TESTING.md`

Structure:

```markdown
# Testing Strategy

This document describes how the HarmonyAIChat React Native app is tested,
what kinds of tests exist, and how to add new ones.

## Test pyramid

```
        ┌────────────────┐
        │   E2E (~5%)    │  Maestro in Docker (Android) + TestingBot (iOS)
        ├────────────────┤
        │ Integration    │  Jest + real SQLite (better-sqlite3) + jest-websocket-mock
        │   (~25%)       │
        ├────────────────┤
        │  Unit (~70%)   │  Jest + RNTL
        └────────────────┘
```

## Where tests live

| Layer | Directory | Run with |
|---|---|---|
| Unit | `src/**/__tests__/*.test.ts`, `__tests__/**/*.test.ts` (not integration) | `npx jest --selectProjects unit` |
| Integration | `__tests__/integration/**/*.test.ts` | `npx jest --selectProjects integration` |
| Migration | `src/database/__tests__/migrations.*.test.ts` | `npx jest --selectProjects unit --testPathPattern migrations` |
| E2E | `e2e/.maestro/*.yaml` | `docker compose -f e2e/docker-compose.yml up` |

## Running tests locally

### Unit tests

    npm test

### Integration tests

    npx jest --selectProjects integration

### Migration tests (snapshot + roll-forward)

    npx jest --selectProjects unit --testPathPattern migrations

When you intentionally change the schema, update snapshots:

    npx jest --testPathPattern migrations --updateSnapshot

Review the diff carefully before committing.

### E2E tests (Android)

Requires Docker Desktop and KVM support.

    # 1. Build APK with E2E env
    ENVFILE=.env.e2e cd android && ./gradlew assembleDevDebug && cd ..
    cp android/app/build/outputs/apk/dev/debug/app-dev-debug.apk e2e/app-debug.apk

    # 2. Build Harmony Link E2E image (in harmony-link-private repo)
    cd ../harmony-link-private && docker build -f Dockerfile.e2e -t harmony-link-private:e2e .

    # 3. Start the stack
    cd ../harmony-ai-app
    docker compose -f e2e/docker-compose.yml up

### E2E tests (iOS)

Via TestingBot (cloud). See `e2e/README.md`.

## CI

- **Every PR**: unit + integration + migration + type-check + lint + schema parity
- **Nightly (03:00 UTC)**: full E2E suite (Android in Docker, iOS via TestingBot)
- **Pre-release**: full test suite must pass before APK/IPA builds start

Workflows:
- `.github/workflows/test.yml` — PR tests
- `.github/workflows/schema-parity.yml` — schema parity gate
- `.github/workflows/e2e-android.yml` — Android E2E
- `.github/workflows/e2e-ios.yml` — iOS E2E (if configured)
- `.github/workflows/build-release.yml` — release pipeline (gated on tests)

## Architecture decisions

These are deliberate, not accidental. Read this section before proposing changes.

### Why Jest (not Vitest)?

Vitest's RN support is still beta as of mid-2026 (`vitest-native` plugin achieves ~85% pass rate on real-world suites). Jest 30 + `@react-native/jest-preset` is the canonical path endorsed by the RN team. Re-evaluate Vitest in ~12 months.

### Why is the database abstracted behind an interface?

Production uses `react-native-sqlite-storage` with SQLCipher. Tests cannot use this (it requires the native RN runtime). The `Database` interface (`src/database/types.ts`) lets production and tests share repository code while swapping the underlying SQLite driver.

Tests use `better-sqlite3` (synchronous, fast, no native dependencies in Node).

### Why isn't SQLCipher tested in Jest?

SQLCipher is not supported by `better-sqlite3` or any Node SQLite driver. Encryption is verified separately by a small on-device smoke test (see Phase 8-2 backlog). Most repository and migration tests don't depend on encryption behavior — they care about SQL semantics, which are identical with or without encryption.

### Why is the schema parity check separate from unit tests?

Parity requires checking the RN schema against the Go server schema — two different codebases. This can't be done in a single Jest run. The dedicated `schema-parity.yml` workflow fetches the Go repo, runs both dump commands, and diffs them.

### Why does E2E run in Docker?

Mirrors the pattern used in the neighboring Soulbits Cloud Backend repo. Allows spawning a real Harmony Link Go backend as a Compose service. Reproducible locally and in CI. iOS cannot use Docker (Apple EULA), so iOS E2E uses a cloud device service.

## Adding a new test

### Unit test for a repository function

1. Add the test in `src/database/__tests__/repositories/<name>.test.ts`.
2. Use `useFreshDatabase()` from `repositoryFixtures.ts` to get a clean migrated DB per test.
3. Import the repository function under test, call it, assert on the result.
4. Run: `npx jest --selectProjects unit`.

### Integration test for a sync scenario

1. Add the test in `__tests__/integration/sync.<scenario>.test.ts`.
2. Use the `HarmonyLinkMockServer` helper from `__tests__/integration/helpers/`.
3. Use the `runFullSync` helper to drive a sync to completion.
4. Run: `npx jest --selectProjects integration`.

### Maestro E2E flow

1. Add a YAML file in `e2e/.maestro/<NN>-<name>.yaml` (NN = next available number).
2. Use `launchApp: clearState: true` for isolation.
3. Test locally before pushing: `docker compose -f e2e/docker-compose.yml up maestro-runner`.

### Migration change

1. Add a new numbered file in `src/database/migrations/`: `000NNN_description.ts`.
2. Export the SQL string.
3. Register it in the migrations barrel (`src/database/migrations/index.ts`).
4. Run `npx jest --testPathPattern migrations --updateSnapshot`.
5. Review the snapshot diff carefully.
6. If the schema changed, coordinate with the Go team — update `harmony-link-private` migration too.
7. Run `npm run schema:dump -- --output schema/rn-schema.json` to refresh the committed baseline.
8. Commit both the migration and the updated snapshots/baseline.

## Troubleshooting

### "Cannot find module 'better-sqlite3'"

Install dev dependencies: `npm install`.

### "better-sqlite3 build failed"

Install Visual Studio Build Tools (Windows) or Xcode Command Line Tools (macOS).

### Snapshot test fails after I changed a migration

That's the test working as designed. Review the diff — if the change is intentional, run `npx jest --testPathPattern migrations --updateSnapshot` and commit the updated snapshot.

### Integration test times out

Check that `HarmonyLinkMockServer` is responding to all expected messages. Use `mockServer.receivedEvents` to see what the client actually sent.

### E2E test hangs on "Waiting for emulator..."

The Android emulator in Docker takes 1-5 minutes to boot. If it consistently exceeds 5 minutes, the host's KVM may be slow or unavailable. Check `ls -la /dev/kvm` on the host.

## See also

- [`.current_work/test-framework-overhaul/summary.md`](../.current_work/test-framework-overhaul/summary.md) — implementation plan
- [`e2e/README.md`](../e2e/README.md) — E2E setup details
- [`.current_work/test-framework-overhaul/8-2-FutureWorkBacklog.md`](../.current_work/test-framework-overhaul/8-2-FutureWorkBacklog.md) — known gaps and future work
```

### 2. Update the main README

Add a Testing section that links to `docs/TESTING.md`:

```markdown
## Testing

See [docs/TESTING.md](docs/TESTING.md) for the full testing strategy.

Quick reference:

- `npm test` — unit tests
- `npx jest --selectProjects integration` — integration tests
- `docker compose -f e2e/docker-compose.yml up` — Android E2E
```

### 3. Add a testing section to AGENTS.md

If `AGENTS.md` (which currently describes GitNexus usage) should also describe testing conventions, add a section pointing to `docs/TESTING.md`. Otherwise, leave it alone.

### 4. Add inline pointers in source files

In `src/database/types.ts`, add a comment linking to the strategy doc:

```typescript
/**
 * Database abstraction layer.
 * @see docs/TESTING.md#architecture-decisions for the rationale.
 */
```

In `jest.config.js`:

```javascript
/**
 * Jest configuration for HarmonyAIChat.
 * Multi-project setup: 'unit' (Node env) and 'integration' (jsdom env).
 * @see docs/TESTING.md for details.
 */
```

### 5. Update CLAUDE.md if needed

If CLAUDE.md mentions the old broken test workflow, update or remove those references. Replace with pointers to `docs/TESTING.md`.

## Files to Create

- `docs/TESTING.md`

## Files to Modify

- `README.md` — add Testing section
- `src/database/types.ts` — add `@see` comment
- `jest.config.js` — add `@see` comment
- `CLAUDE.md` — remove old references, add new pointer
- `AGENTS.md` — optionally add testing section

## Validation

- [ ] `docs/TESTING.md` exists and covers: pyramid, locations, run commands, architecture decisions, troubleshooting
- [ ] All commands in the doc actually work when copy-pasted
- [ ] README links to it
- [ ] No remaining references to the deleted `run-db-tests.js` workflow anywhere in the repo (use Grep tool to confirm)

## Estimated Effort

Half a day. Mostly writing; some verification that the documented commands actually work.
