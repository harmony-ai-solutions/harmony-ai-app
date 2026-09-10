# Release Process

## Overview

Releases are managed via GitHub Actions. When a tag matching `v*` is pushed, the
`Build Release` workflow runs a multi-stage pipeline:

1. **Schema parity check** — ensures the RN schema matches the Harmony Link Go schema
2. **Test gate** — runs all tests (type-check, lint, unit, integration, migration)
3. **Build artifacts** — Android APK (dev + prod) and iOS IPA (dev + prod)
4. **Create GitHub Release** — with download links for all artifacts

If any stage fails, the pipeline halts and no artifacts are produced.

## Step-by-Step

### 1. Prepare the release

Ensure `main` is green:

- All CI checks pass on the latest `main` commit
- Nightly E2E runs have been green for the past 3+ days (recommended)
- Schema parity check passes (run manually or wait for PR merge)

### 2. Tag the release

```bash
git checkout main
git pull
git tag v1.2.3
git push origin v1.2.3
```

### 3. Monitor the workflow

1. Go to [Actions → Build Release](https://github.com/harmony-ai-solutions/harmony-ai-app/actions/workflows/build-release.yml)
2. Watch the pipeline progress:
   - ✅ `schema-parity` — runs first (fast, ~2 min)
   - ✅ `test` — runs second (unit + integration + migration, ~10-15 min)
   - ✅ `build-android` — runs in parallel for dev and prod (~10 min each)
   - ✅ `build-ios` — runs in parallel for dev and prod (~15 min each)
   - ✅ `create-release` — creates the GitHub Release with download links

### 4. Verify the release

- Check the [Releases page](https://github.com/harmony-ai-solutions/harmony-ai-app/releases)
- Download links should point to versioned S3 paths
- Latest pointers (`latest/dev`, `latest/prod`) are updated automatically

## Dry-Run a Release

To verify the release workflow without building artifacts:

1. Go to [Actions → Build Release → Run workflow](https://github.com/harmony-ai-solutions/harmony-ai-app/actions/workflows/build-release.yml)
2. Set **Version number** (optional, defaults to `v0.0.0-dev`)
3. Check **"Run tests only, skip APK/IPA builds (dry-run)"**
4. Click **Run workflow**

The pipeline will:
- ✅ Run schema parity check
- ✅ Run all tests (type-check, lint, unit, integration, migration)
- ❌ Skip APK and IPA builds
- ❌ Skip GitHub Release creation

This is useful for:
- Verifying the test gate works after config changes
- Testing infrastructure changes without consuming build minutes
- Quick validation that a branch is releasable

## Dependency Chain

```
schema-parity (schema diff check)
  └── test (type-check + lint + unit + integration + migration)
       ├── build-android (dev)
       ├── build-android (prod)
       ├── build-ios (dev)
       ├── build-ios (prod)
       └── create-release (GitHub Release)
```

All build jobs run in parallel after `test` passes. The release is created after
all build jobs complete.

## Emergency: Skip Tests

If a hotfix needs to bypass the test gate (rare, requires team approval):

1. Use `workflow_dispatch` with `skip_build` NOT checked (so builds run)
2. The `test` job will run — it cannot be skipped from the UI
3. For emergencies where tests are broken, edit `.github/workflows/build-release.yml`
   to temporarily remove the `needs: test` dependency from build jobs

> **Note**: Skipping the test gate should be exceptional and documented in the
> release notes. Normal releases must pass all tests.

## Required Secrets

The following secrets must be configured in the repository settings:

| Secret | Purpose |
|--------|---------|
| `HARMONY_LINK_REPO_PAT` | Access to `harmony-link-private` for schema parity |
| `ANDROID_RELEASE_KEYSTORE_BASE64` | Release keystore (base64-encoded) |
| `ANDROID_RELEASE_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_RELEASE_KEY_ALIAS` | Key alias |
| `ANDROID_RELEASE_KEY_PASSWORD` | Key password |
| `AWS_S3_UPLOAD_ACCESS_KEY_ID` | S3 upload access key |
| `AWS_S3_UPLOAD_SECRET_ACCESS_KEY` | S3 upload secret key |
