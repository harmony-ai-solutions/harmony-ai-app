# Phase 1-2: Delete Broken Test Runner

## Objective

Remove the hand-rolled in-app test runner that has been the source of the "tests must run inside the app" pain point. The runner is already non-functional from the command line because `run-db-tests.js` does `require('./src/database/__tests__/run-all-tests.ts')` from plain Node, which cannot parse TypeScript without a loader. Once Phase 2 lands the Node SQLite adapter and Phase 3 ports the actual tests to real Jest, this runner is fully obsolete.

## Context

The current broken state, in detail:

- `run-db-tests.js` (repo root) — attempts `require('./src/database/__tests__/run-all-tests.ts')` from Node, which fails immediately with `SyntaxError: Unexpected token` on the first TypeScript syntax.
- `src/database/__tests__/run-all-tests.ts` — exports a `runAllTests()` function with custom ASCII-art banners, a hand-rolled phase runner, and a custom `TestResult` type.
- `src/database/__tests__/test-utils.ts` — defines `runTest` and `runTestWithCleanup` wrappers that mimic Jest's `it()` but with worse ergonomics.
- The five actual test files (`entities.test.ts`, `characters.test.ts`, `modules.test.ts`, `providers.test.ts`, `memories.test.ts`) each export a `runXxxTests()` function returning `TestResult[]`. None use `describe`/`it`/`expect` — they're written in the custom framework's idiom.

These files require the real `react-native-sqlite-storage` native module to be available (because they import `../connection` which imports the native lib), so even if the TypeScript loader issue were fixed, they could only run inside the booted RN app — which is the workflow the user explicitly rejected as "very unappealing."

## Prerequisites

- Phase 1-1 complete (Jest modernized).
- This phase can be done in either order relative to Phase 2/3:
  - **Option A (recommended)**: Delete the broken runner now, accept that DB tests are temporarily gone, restore them as real Jest tests in Phase 3. This is cleaner — there's no half-working state.
  - **Option B (conservative)**: Wait until Phase 3 ports the tests, then delete. Slightly more work because the porter needs to read both old and new formats simultaneously.

This plan assumes Option A.

## Implementation Steps

### 1. Verify the runner is actually broken

Confirm the claim before deleting:

```bash
node run-db-tests.js
```

Expected: `SyntaxError: Unexpected token 'export'` or similar. If it somehow works, stop and investigate — the rest of this plan assumes it doesn't.

### 2. Identify any references to the runner

Before deleting, search for anything that imports or references these files:

Use the Grep tool to search for:
- `run-all-tests` (anywhere in repo)
- `run-db-tests` (anywhere in repo)
- `runTestWithCleanup` and `runTest` (across `src/`)
- `from './test-utils'` and `from '../test-utils'`
- `runEntityTests|runCharacterTests|runModuleTests|runProviderTests|runMemoryTests` (the exported phase runners)

Expected locations: only inside `src/database/__tests__/` and possibly a README or two.

### 3. Delete the runner entry point

```
rm run-db-tests.js
```

This file is at the repo root and serves no purpose other than to fail.

### 4. Delete the hand-rolled test framework

```
rm src/database/__tests__/run-all-tests.ts
rm src/database/__tests__/test-utils.ts
```

### 5. Delete (or quarantine) the five custom-format test files

The actual test logic in these files will be re-implemented as real Jest tests in Phase 3-3. The current files can't be salvaged directly because they're written in the custom framework's idiom. Delete them now:

```
rm src/database/__tests__/entities.test.ts
rm src/database/__tests__/characters.test.ts
rm src/database/__tests__/modules.test.ts
rm src/database/__tests__/providers.test.ts
rm src/database/__tests__/memories.test.ts
```

**Important**: Before deleting, preserve the test cases themselves by recording what each file tested. This becomes the input to Phase 3-3. Either:
- Commit a `test-cases-inventory.md` note (in this `.current_work/test-framework-overhaul/` folder) listing every test name from each file, OR
- Tag the commit before deletion (e.g., `git tag pre-test-runner-deletion`) so Phase 3-3 can `git show` the old tests.

Recommend the inventory approach — it forces explicit thinking about which tests to port vs. drop.

### 6. Update `package.json` if needed

Check whether any npm script references `run-db-tests.js`. Currently the only test script is `"test": "jest"`, so no change needed. Verify.

### 7. Update documentation

Check for README references to running DB tests via the in-app runner. If `README.md`, `docs/*.md`, or `CLAUDE.md` mention `run-db-tests.js` or "run tests inside the app," remove or update those sections.

Use Grep tool to search for: `run-db-tests`, `in-app test`, `inside the app`, `runAllTests`.

### 8. Run the remaining Jest suite to confirm nothing broke

```bash
npm test
```

Expected: the only Jest tests (`__tests__/App.test.tsx`, `__tests__/services/SyncService.test.ts`) still pass. The DB test files were never running under Jest anyway.

## Files to Delete

- `run-db-tests.js`
- `src/database/__tests__/run-all-tests.ts`
- `src/database/__tests__/test-utils.ts`
- `src/database/__tests__/entities.test.ts`
- `src/database/__tests__/characters.test.ts`
- `src/database/__tests__/modules.test.ts`
- `src/database/__tests__/providers.test.ts`
- `src/database/__tests__/memories.test.ts`

## Files to Possibly Modify

- `README.md` — remove any references to the deleted runner
- `docs/**/*.md` — same
- `CLAUDE.md` — same (if it mentions test workflow)

## Files to Create

- `.current_work/test-framework-overhaul/test-cases-inventory.md` — list of every test case from the deleted files, used as input to Phase 3-3

## Validation

- [ ] `node run-db-tests.js` no longer exists
- [ ] `npm test` still passes (App.test.tsx, SyncService.test.ts)
- [ ] No dangling imports referencing deleted files (verify with `npx tsc --noEmit`)
- [ ] `test-cases-inventory.md` committed with full enumeration of deleted test cases
- [ ] README/docs no longer reference the deleted runner

## Estimated Effort

Half a day, including the test cases inventory.
