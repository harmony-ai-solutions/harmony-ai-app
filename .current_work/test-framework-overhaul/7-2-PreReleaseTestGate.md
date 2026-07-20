# Phase 7-2: Pre-Release Test Gate

## Objective

Modify the existing `.github/workflows/build-release.yml` so that release builds (APK and IPA) cannot be produced unless all tests pass first. Currently the workflow goes straight from `npm ci` to building artifacts — no validation that the code being released actually works.

## Context

The release workflow at `.github/workflows/build-release.yml` triggers on:
- Tag pushes (`v*`)
- Manual dispatch (`workflow_dispatch`)

It runs three jobs: `build-android` (matrix dev/prod), `build-ios` (matrix dev/prod), and `create-release` (which depends on both). There is no `needs:` dependency on any test workflow.

The fix: make these jobs depend on the `test.yml` workflow (Phase 7-1) being green on the same commit, OR run tests inline within the release workflow as a prerequisite job.

Two architectural options:

**Option A: Use `workflow_run` trigger** — the release workflow triggers after a successful `test.yml` run. Complex to set up, doesn't work well for manual dispatch.

**Option B: Inline test job as a dependency** — add a `test` job at the top of `build-release.yml`, make `build-android` and `build-ios` depend on it. Simple, self-contained, recommended.

This phase implements Option B.

## Prerequisites

- Phase 7-1 complete (`test.yml` workflow exists and passes on main).

## Implementation Steps

### 1. Add a `test` job to the release workflow

Edit `.github/workflows/build-release.yml`:

```yaml
name: Build Release

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:
    inputs:
      version:
        description: 'Version number for the build'
        default: 'v0.0.0-dev'

jobs:
  # ───────────────────────────────────────────────────────────────────
  # NEW: Test gate — must pass before any artifact is built
  # ───────────────────────────────────────────────────────────────────
  test:
    name: Tests (pre-release gate)
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
      - run: npm ci

      - name: Type-check
        run: npx tsc --noEmit

      - name: Lint
        run: npm run lint

      - name: Unit tests
        run: npx jest --selectProjects unit --reporters=default --reporters=jest-junit
        env:
          JEST_JUNIT_OUTPUT_DIR: ./reports
          JEST_JUNIT_OUTPUT_NAME: unit-tests.xml

      - name: Integration tests
        run: npx jest --selectProjects integration --reporters=default --reporters=jest-junit
        env:
          JEST_JUNIT_OUTPUT_DIR: ./reports
          JEST_JUNIT_OUTPUT_NAME: integration-tests.xml

      - name: Migration tests
        run: npx jest --selectProjects unit --testPathPattern migrations

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: pre-release-test-results
          path: reports/

  # ───────────────────────────────────────────────────────────────────
  # EXISTING: Build Android APK (now depends on test)
  # ───────────────────────────────────────────────────────────────────
  build-android:
    name: Build Android APK (${{ matrix.environment }})
    needs: test  # ← NEW: gate on tests passing
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        environment: [dev, prod]
    steps:
      # ... existing steps unchanged ...
```

### 2. Update the iOS build job similarly

```yaml
  build-ios:
    name: Build iOS IPA (${{ matrix.environment }})
    needs: test  # ← NEW: gate on tests passing
    runs-on: macos-15
    strategy:
      # ... rest unchanged
```

### 3. Update `create-release` to depend on the test gate transitively

It already depends on `build-android` and `build-ios`, which now depend on `test`. No change needed — but verify the chain is intact:

```yaml
  create-release:
    name: Create GitHub Release
    runs-on: ubuntu-latest
    needs: [build-android, build-ios]  # ← transitively requires test
    if: startsWith(github.ref, 'refs/tags/v')
    # ... rest unchanged
```

### 4. Add a `test-failed` notification (optional)

If tests fail on a release attempt, the team should know immediately. Add a Slack or email notification step:

```yaml
  notify-failure:
    name: Notify on test failure
    runs-on: ubuntu-latest
    needs: test
    if: failure()
    steps:
      - name: Slack notification
        uses: rtCamp/action-slack-notify@v2
        env:
          SLACK_WEBHOOK: ${{ secrets.SLACK_WEBHOOK }}
          SLACK_TITLE: 'Pre-release tests failed'
          SLACK_MESSAGE: 'Release build aborted — tests failed on ${{ github.ref_name }}'
          SLACK_COLOR: '#FF0000'
```

### 5. Add a fast-fail dry-run mode (optional)

For testing the release workflow itself without building artifacts, add a `workflow_dispatch` input:

```yaml
on:
  push:
    tags: ['v*']
  workflow_dispatch:
    inputs:
      version:
        description: 'Version number for the build'
        default: 'v0.0.0-dev'
      skip_build:
        description: 'Run tests only, skip APK/IPA builds (dry-run)'
        type: boolean
        default: false

jobs:
  test:
    # ... runs always

  build-android:
    needs: test
    if: ${{ !inputs.skip_build }}
    # ... rest

  build-ios:
    needs: test
    if: ${{ !inputs.skip_build }}
    # ... rest
```

This lets you verify the test gate works without spending 20+ minutes on Android/iOS builds.

### 6. Document the new release flow

In `README.md` or `docs/RELEASE.md` (create if needed):

```markdown
## Release process

1. Ensure all tests pass on `main` (CI is green).
2. Tag a release: `git tag v1.2.3 && git push origin v1.2.3`.
3. The `Build Release` workflow runs:
   - First: full test suite (unit + integration + migration)
   - Then: Android APK build (dev + prod)
   - Then: iOS IPA build (dev + prod)
   - Finally: GitHub Release created with download links
4. If any test fails, the build is aborted and the team is notified.

## Dry-run a release

To verify the release workflow without building artifacts:

1. Go to Actions → Build Release → Run workflow.
2. Check "Run tests only, skip APK/IPA builds (dry-run)".
3. Confirm tests pass.
```

### 7. Validate the gate works

Trigger a manual dispatch with a deliberately-broken test (e.g., temporarily add `expect(1).toBe(2)` to a test, commit to a branch, and trigger). Confirm:

- The `test` job fails
- The `build-android` and `build-ios` jobs are skipped (don't even start)
- No artifacts are produced
- The notification fires (if configured)

Then revert and trigger again — confirm the happy path works.

## Files to Modify

- `.github/workflows/build-release.yml` — add `test` job, add `needs:` to build jobs

## Files to Create

- (Optional) `docs/RELEASE.md`
- (Optional) Slack notification step

## Validation

- [ ] Tag push triggers the workflow
- [ ] `test` job runs first; build jobs wait
- [ ] If `test` fails, build jobs are skipped (`skipped` status, not `failure`)
- [ ] If `test` passes, build jobs run normally
- [ ] GitHub Release is only created when all upstream jobs pass
- [ ] Dry-run mode (`skip_build`) works for workflow debugging
- [ ] Documentation explains the new flow

## Open Questions to Resolve During Implementation

- **Should the test job run on the same runner type as the build jobs, or differently?** The test job uses `ubuntu-latest`; the iOS build job uses `macos-15`. Keeping them separate is fine — they have different needs.
- **What if the team wants to release a hotfix and a test is broken?** Add a `workflow_dispatch` input `skip_tests` (similar to `skip_build`) for emergencies. Document that this should be used sparingly and only with explicit team approval.
- **Should the release workflow also run the parity gate (Phase 5-3) and E2E (Phase 7-3)?** Yes — add them as additional `needs:` dependencies. See Phase 7-3 for wiring.

## Estimated Effort

Half a day. Mostly testing the gate works end-to-end (which requires waiting for the full test suite + build to run).
