# Phase 7-3: E2E and Parity Jobs

## Objective

Add CI jobs for the schema-parity gate (Phase 5-3) and Android/iOS E2E tests (Phase 6) to the GitHub Actions pipeline. These run alongside the unit/integration tests from Phase 7-1 but on different schedules and triggers — they're too slow to run on every PR.

## Context

The test pyramid from the research:

| Layer | Run cadence | Workflow |
|---|---|---|
| Unit | Every PR | Phase 7-1 (`test.yml`) |
| Integration | Every PR | Phase 7-1 (`test.yml`) |
| Schema parity | Every PR + on release | Phase 5-3 (`schema-parity.yml`) — already added |
| E2E (Android) | Nightly + pre-release | This phase |
| E2E (iOS) | Nightly + pre-release | This phase |
| Migration | Every PR | Phase 7-1 (part of unit suite) |

E2E is slow (5-10 minutes for Android, 10-15 for iOS) and resource-intensive (KVM emulator, macOS runner). Running it on every PR would slow the team down. Instead: run a smoke subset on PRs, full suite nightly.

## Prerequisites

- Phase 5-3 complete (parity workflow exists).
- Phase 6-1 through 6-5 complete (Android E2E works locally).
- Phase 6-6 complete OR explicitly deferred (iOS E2E strategy decided).

## Implementation Steps

### 1. Extend the schema-parity workflow for releases

Phase 5-3 already created `.github/workflows/schema-parity.yml`. Add release-tag triggers so parity is enforced before any release:

```yaml
on:
  pull_request:
    paths:
      - 'src/database/migrations/**'
      - 'schema/**'
      - 'scripts/dump-schema.ts'
      - '.github/workflows/schema-parity.yml'
  push:
    branches: [main]
    tags: ['v*']  # ← NEW: also run on release tags
  workflow_dispatch:
```

This way, even if the parity workflow isn't required on every PR (because the changed paths don't match), it always runs before a release.

### 2. Make the parity workflow a release gate

In `.github/workflows/build-release.yml`, add `schema-parity` to the build jobs' `needs:`:

```yaml
jobs:
  schema-parity:
    name: Schema parity (RN ↔ Harmony Link)
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      # ... inline the steps from Phase 5-3's workflow, or use 'workflow_run' to call it
      # Inline is simpler for a release gate

  test:
    needs: schema-parity  # parity is part of the test layer
    # ... existing test steps

  build-android:
    needs: test
    # ...
```

This ensures no release ships without parity. If the parity check fails (schema drift), the test job doesn't run, and the build is aborted.

### 3. Create the Android E2E workflow

Create `.github/workflows/e2e-android.yml`:

```yaml
name: E2E (Android, Docker)

on:
  schedule:
    # Nightly at 03:00 UTC
    - cron: '0 3 * * *'
  workflow_dispatch:
  pull_request:
    paths:
      - 'e2e/**'
      - '.github/workflows/e2e-android.yml'
    # Only run on PRs that touch E2E infrastructure; otherwise rely on nightly

env:
  HARMONY_LINK_IMAGE_TAG: e2e-latest

jobs:
  build-apk:
    name: Build debug APK (E2E)
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
      - uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'
      - run: npm ci
      - name: Build E2E APK
        env:
          ENVFILE: .env.e2e
        working-directory: android
        run: |
          chmod +x gradlew
          ./gradlew assembleDevDebug
      - name: Copy APK to E2E dir
        run: |
          cp android/app/build/outputs/apk/dev/debug/app-dev-debug.apk e2e/app-debug.apk
      - uses: actions/upload-artifact@v4
        with:
          name: e2e-apk
          path: e2e/app-debug.apk

  build-harmony-link:
    name: Build Harmony Link E2E image
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
        with:
          repository: harmony-ai-solutions/harmony-link-private
          token: ${{ secrets.HARMONY_LINK_REPO_PAT }}
          path: harmony-link
      - name: Build image
        working-directory: harmony-link
        run: docker build -f Dockerfile.e2e -t harmony-link-private:${{ env.HARMONY_LINK_IMAGE_TAG }} .
      - name: Save image
        run: docker save harmony-link-private:${{ env.HARMONY_LINK_IMAGE_TAG }} | gzip > harmony-link-e2e.tar.gz
      - uses: actions/upload-artifact@v4
        with:
          name: harmony-link-image
          path: harmony-link-e2e.tar.gz

  run-e2e:
    name: Run E2E
    runs-on: ubuntu-latest
    timeout-minutes: 30
    needs: [build-apk, build-harmony-link]
    steps:
      - uses: actions/checkout@v4

      - uses: actions/download-artifact@v4
        with:
          name: e2e-apk
          path: e2e/

      - uses: actions/download-artifact@v4
        with:
          name: harmony-link-image
          path: .

      - name: Load Harmony Link image
        run: docker load < harmony-link-e2e.tar.gz

      - name: Enable KVM
        # Required for the Android emulator
        run: |
          echo 'KERNEL=="kvm", GROUP="kvm", MODE="0777"' | sudo tee /etc/udev/rules.d/99-kvm4all.rules
          sudo udevadm control --reload-rules
          sudo udevadm trigger --name-match=kvm
          ls -la /dev/kvm

      - name: Start Compose stack
        working-directory: e2e
        run: |
          docker compose up -d harmony-link android-emulator

      - name: Wait for emulator boot
        run: |
          for i in $(seq 1 60); do
            STATUS=$(docker exec android-emulator cat /home/androidusr/device_status 2>/dev/null || echo "not ready")
            echo "Attempt $i: $STATUS"
            if echo "$STATUS" | grep -q "device_status=online\|booted"; then
              echo "Emulator ready!"
              break
            fi
            sleep 10
          done

      - name: Run Maestro
        working-directory: e2e
        run: docker compose up maestro-runner --abort-on-container-exit --exit-code-from maestro-runner

      - name: Collect reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-android-reports
          path: e2e/reports/

      - name: Dump emulator logs on failure
        if: failure()
        run: |
          docker compose logs android-emulator > emulator.log 2>&1 || true
          docker compose logs harmony-link > harmony-link.log 2>&1 || true

      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: e2e-android-logs
          path: |
            emulator.log
            harmony-link.log

      - name: Tear down
        if: always()
        working-directory: e2e
        run: docker compose down -v
```

> **Note**: GitHub-hosted `ubuntu-latest` runners DO support `/dev/kvm` with the udev rule tweak shown. This is the standard pattern documented in many RN E2E setups.

### 4. Create the iOS E2E workflow

The iOS E2E strategy is documented in Phase 6-6. The workflow file lives in `harmony-ai-app` at `.github/workflows/e2e-ios.yml` and uses a `macos-15` GitHub Actions runner. See [6-6-IOSMacOSRunner.md](6-6-IOSMacOSRunner.md) for the full workflow YAML — it's the canonical source. Don't duplicate it here.

The summary of what runs there:
- Build the iOS Simulator `.app` with the `.env.e2e.ios` config
- Cross-compile Harmony Link as a native macOS Go binary (no Docker needed)
- Generate self-signed certs and start Harmony Link on `localhost:9443`
- Boot an iOS Simulator, install the `.app`, run Maestro flows
- Same `e2e/.maestro/*.yaml` flows as Android — reused, not duplicated

### 5. Add pre-release E2E gates (optional)

For high-stakes releases, you may want E2E to pass before the release ships. Wire the nightly E2E as a manual dispatch step in the release workflow:

In `.github/workflows/build-release.yml`:

```yaml
  # Optional: pre-release E2E gate
  e2e-android-prerelease:
    name: Android E2E (pre-release)
    needs: test
    runs-on: ubuntu-latest
    timeout-minutes: 30
    # ... inline the e2e-android.yml steps

  build-android:
    needs: [test, e2e-android-prerelease]  # ← gate
```

This makes releases significantly slower (30+ minutes for E2E) and is optional. The team should decide: is "E2E green" a hard release requirement, or a nice-to-have that the nightly run catches?

**Recommendation**: Start without the pre-release E2E gate (rely on nightly runs + manual dispatch). Add the gate once the nightly runs are stable for a few weeks.

### 6. Document the E2E cadence

In `e2e/README.md`:

```markdown
## CI schedule

| Trigger | Scope | Duration |
|---|---|---|
| Pull request (touches `e2e/**`) | Full E2E suite | ~20 min |
| Nightly (03:00 UTC) | Full E2E suite | ~20 min |
| Manual dispatch | Full E2E suite | ~20 min |
| Release tag | (none by default — nightly results are trusted) |  |

To run E2E on demand:
1. Actions tab → "E2E (Android, Docker)" → Run workflow
2. Wait ~20 minutes
3. Download `e2e-android-reports` artifact for JUnit XML
```

## Files to Create

- `.github/workflows/e2e-android.yml`
- `.github/workflows/e2e-ios.yml` (if Phase 6-6 done)

## Files to Modify

- `.github/workflows/schema-parity.yml` — add tag/release trigger
- `.github/workflows/build-release.yml` — add `schema-parity` job; optionally add `e2e-android-prerelease`
- `e2e/README.md` — document CI cadence

## Validation

- [ ] Nightly schedule triggers the workflow
- [ ] Manual dispatch works
- [ ] PR that touches `e2e/**` triggers the workflow
- [ ] APK build artifact is uploaded and consumed by the run-e2e job
- [ ] KVM is accessible on `ubuntu-latest` (the udev rule works)
- [ ] Emulator boots within 5 minutes
- [ ] At least the smoke flow passes
- [ ] Reports artifact contains JUnit XML
- [ ] On failure, logs artifact contains emulator + harmony-link container logs
- [ ] Schema-parity check runs on tag pushes
- [ ] Release workflow now requires schema-parity to pass

## Open Questions to Resolve During Implementation

- **Should E2E run on every PR or just nightly?** Recommend nightly + PR-on-touch (only when `e2e/**` changes). Full E2E on every PR is too slow.
- **What's the GitHub Actions free-tier minute budget?** E2E workflows consume significant minutes. Confirm the team has budget or is on a paid plan.
- **Should the iOS workflow run nightly too?** TestingBot minutes cost money. Recommend nightly iOS only if iOS E2E is mature; weekly otherwise.
- **Where do `HARMONY_LINK_REPO_PAT` and TestingBot secrets get configured?** Repo settings → Secrets and Variables → Actions. Document required scopes.

## Estimated Effort

One to two days. Most of the time is debugging the Compose stack inside GitHub Actions (which has different networking and KVM behavior than local Docker).

## Risk

The first nightly E2E run will likely fail. Common causes:

- GitHub Actions runner doesn't have the exact same `/dev/kvm` behavior as the dev machine
- Network routing between containers is different
- Timeouts too tight for the slower CI hardware
- Secrets missing or wrong scope

Plan to debug the first 3-5 nightly runs. After that, it should stabilize.

## Spike Item

Before wiring the full nightly, run the workflow manually once with just the smoke flow enabled. Once that's green for 3 consecutive nights, expand to the full suite.
