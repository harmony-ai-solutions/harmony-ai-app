# Phase 7-1: Pull Request Test Workflow

## Objective

Create a new GitHub Actions workflow that runs all unit and integration tests on every pull request. This is the bedrock CI gate — fast feedback loop on every change.

## Context

The existing `.github/workflows/build-release.yml` only triggers on tag pushes / manual dispatch and has **no test step**. It goes straight from `npm ci` to building APKs/IPAs. There's no automated check that the code actually works before a release is cut.

This phase adds the missing test layer. It runs on every PR (and on push to main), and is the prerequisite for Phase 7-2 (gating release builds on test success).

## Prerequisites

- Phase 1 complete (Jest modernized).
- Phase 2 complete (Database abstraction in place — unit tests for repositories can run).
- Phase 3 complete (migration tests exist).
- Phase 4 complete (integration tests exist, including the JSDOM-project split).

## Implementation Steps

### 1. Create the workflow file

Create `.github/workflows/test.yml`:

```yaml
name: Tests

on:
  pull_request:
    paths-ignore:
      - 'docs/**'
      - '*.md'
      - '.current_work/**'
      - 'memory-bank/**'
      - 'design/**'
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  # ─────────────────────────────────────────────────────────────────
  # Type-check + lint
  # ─────────────────────────────────────────────────────────────────
  typecheck:
    name: Type-check & lint
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm run lint

  # ─────────────────────────────────────────────────────────────────
  # Unit tests (Node environment — fast)
  # ─────────────────────────────────────────────────────────────────
  unit-tests:
    name: Unit tests
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
      - run: npm ci
      - name: Run unit tests
        # Uses the 'unit' Jest project (Node env, excludes integration tests)
        run: npx jest --selectProjects unit --coverage --reporters=default --reporters=jest-junit
        env:
          JEST_JUNIT_OUTPUT_DIR: ./reports
          JEST_JUNIT_OUTPUT_NAME: unit-tests.xml
      - name: Upload coverage
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: unit-test-coverage
          path: coverage/
      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: unit-test-results
          path: reports/unit-tests.xml

  # ─────────────────────────────────────────────────────────────────
  # Integration tests (JSDOM environment — needs WebSocket global)
  # ─────────────────────────────────────────────────────────────────
  integration-tests:
    name: Integration tests
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
      - run: npm ci
      - name: Run integration tests
        # Uses the 'integration' Jest project (JSDOM env)
        run: npx jest --selectProjects integration --reporters=default --reporters=jest-junit
        env:
          JEST_JUNIT_OUTPUT_DIR: ./reports
          JEST_JUNIT_OUTPUT_NAME: integration-tests.xml
      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: integration-test-results
          path: reports/integration-tests.xml

  # ─────────────────────────────────────────────────────────────────
  # Migration snapshot tests (treated as part of unit suite, but split out)
  # ─────────────────────────────────────────────────────────────────
  migration-tests:
    name: DB migration tests
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
      - run: npm ci
      - name: Run migration tests
        # Filter to migration-specific test files
        run: npx jest --selectProjects unit --testPathPattern migrations
```

### 2. Add `jest-junit` reporter

For test results to integrate with GitHub Actions UI and PR checks:

```bash
npm install --save-dev jest-junit
```

The workflow above already references it. Default output goes to `reports/junit.xml` — the workflow overrides the path.

### 3. Configure Jest project split

Phase 4-1 introduced the multi-project Jest config. Verify it's in `jest.config.js`:

```javascript
module.exports = {
  projects: [
    {
      displayName: 'unit',
      preset: '@react-native/jest-preset',
      testEnvironment: 'node',
      testMatch: [
        '<rootDir>/src/**/*.test.ts',
        '<rootDir>/src/**/*.test.tsx',
        '<rootDir>/__tests__/**/*.test.ts',
      ],
      testPathIgnorePatterns: ['/node_modules/', '/__tests__/integration/'],
      // ... transformIgnorePatterns, setupFiles
    },
    {
      displayName: 'integration',
      preset: '@react-native/jest-preset',
      testEnvironment: 'jsdom',
      testMatch: ['<rootDir>/__tests__/integration/**/*.test.ts'],
      // ... transformIgnorePatterns, setupFiles
    },
  ],
};
```

If the existing `jest.config.js` doesn't have `projects`, refactor it as part of Phase 7-1 (this is technically Phase 4-1 work, but verify it's done).

### 4. Add a PR check for the workflow

In the repo's GitHub settings → Branches → Branch protection rules for `main`:

- ✅ Require status checks to pass before merging
- ✅ Require branches to be up to date before merging
- Status checks required:
  - `Type-check & lint`
  - `Unit tests`
  - `Integration tests`
  - `DB migration tests`

This prevents merging PRs that fail tests. Document this requirement in `CONTRIBUTING.md` (or create one if it doesn't exist).

### 5. Cache `node_modules` aggressively

The workflow uses `cache: npm` in `setup-node`, which caches `~/.npm`. For even faster runs, consider caching `node_modules` directly:

```yaml
- uses: actions/cache@v4
  with:
    path: node_modules
    key: ${{ runner.os }}-node_modules-${{ hashFiles('package-lock.json') }}
    restore-keys: ${{ runner.os }}-node_modules-
```

This skips `npm ci` entirely on cache hit, saving 30-60 seconds per run.

### 6. Optional: add a coverage gate

If the team wants to enforce minimum coverage:

```yaml
- name: Run unit tests with coverage gate
  run: npx jest --selectProjects unit --coverage --coverageThreshold='{"global":{"branches":70,"functions":80,"lines":80,"statements":80}}'
```

Start permissive (60-70% thresholds) and ratchet up over time. Don't gate on coverage until the team has had time to bring the existing codebase up to the threshold.

### 7. Validate

Open a PR with a trivial change (e.g., add a comment to `package.json`) and confirm all four jobs run and pass.

Then open a PR with a deliberately-broken change (e.g., add `expect(1).toBe(2)` to a test) and confirm the relevant job fails.

## Files to Create

- `.github/workflows/test.yml`
- (Optional) `CONTRIBUTING.md` if not present

## Files to Modify

- `package.json` — add `jest-junit` dev dependency
- `jest.config.js` — verify the `projects` array (Phase 4-1)

## Validation

- [ ] All four jobs (`typecheck`, `unit-tests`, `integration-tests`, `migration-tests`) run on PR open
- [ ] Each job passes within its timeout on a clean PR
- [ ] Test results appear in GitHub Actions UI as collapsible test reports
- [ ] Branch protection requires all four to pass before merge
- [ ] A deliberately-broken change correctly fails the relevant job

## Open Questions to Resolve During Implementation

- **What's the current lint script?** `package.json` has `"lint": "eslint ."` — verify it passes before adding it as a gate.
- **How long does the unit test suite actually take?** Adjust `timeout-minutes` based on real run time + 50% headroom.
- **Should coverage be reported but not gated initially?** Recommended: report it (so the team sees the number), gate it later once the baseline is established.

## Estimated Effort

Half a day to wire up. Plus iteration to get timeouts right and the test count stable.

## Operational Note

The first PR after this workflow is added will likely surface a handful of pre-existing test failures (the tests in the repo were never run regularly). Triage each:

- **Real bug**: fix it
- **Stale test**: update or delete
- **Flaky test**: quarantine (move to `__tests__/__flaky__/`) and investigate

Don't let perfect be the enemy of good — if a test is flaky, mark it `it.skip(...)` with a TODO rather than blocking all PRs.
