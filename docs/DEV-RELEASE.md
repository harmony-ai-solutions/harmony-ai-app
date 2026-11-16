# Dev-Release Loop

How to ship and self-install **dev-channel** APKs quickly, without touching the
prod channel. This is the fast inner loop: publish a dev APK, the phone's
in-app update dialog picks it up and self-installs.

> **Version convention — read this first.** Always pass a **PLAIN** `vX.Y.Z` as
> the dispatch `version` input (`v1.3.0`, not `v1.3.0-dev`). The dev flavour
> appends `-dev` natively (`versionNameSuffix "-dev"` in
> `android/app/build.gradle`) and the dev manifest mirrors that exact suffix.
> Hand-suffixing produces `…-dev-dev`, which never equals the installed version
> and leaves the update dialog prompting on every launch.

---

## How it works

Two per-channel manifests live on the CloudFront download host:

| Channel | Manifest | Written by |
|---------|----------|------------|
| dev  | `https://download.soulbits.app/app/dev/latest.json`  | dispatch with `publish_latest=true` **and** tag runs |
| prod | `https://download.soulbits.app/app/prod/latest.json` | **tag runs only** (`refs/tags/v*`) |

Manifest shape (one file per channel — `<env>` is the file's own channel):

```json
{
  "version": "v1.3.0-dev",
  "releasedAt": "2026-10-17T12:00:00Z",
  "notesUrl": "https://github.com/harmony-ai-solutions/harmony-ai-app/releases/tag/v1.3.0",
  "android": { "url": "https://download.soulbits.app/app/v1.3.0/dev/harmony-ai-app-v1.3.0-android.apk" },
  "ios":     { "url": "https://download.soulbits.app/app/v1.3.0/dev/harmony-ai-app-v1.3.0-ios.ipa" }
}
```

A build reads **only its own channel's file** (`RELEASES.appManifestUrl` in
`src/config/cloud.ts`, derived from `APP_ENV`). The dev file's `version` carries
the flavour's exact `-dev` suffix, so an up-to-date dev install compares **equal**
(`v1.3.0-dev` == `v1.3.0-dev`) and the update dialog stays silent.

**Update-check cadence (owner ruling 2026-10-17):** there is **no TTL**. The check
runs on every **cold start** and on every app **foreground** (`AppState` →
`'active'`, throttled to ≥60s between fetches). Concurrent calls are de-duplicated,
the last result is cached, and a failed fetch falls back to that cache — so an
offline launch still knows what it knew before.

---

## Check the current versions first

Before dispatching, read the **live** versions — never guess from a repo file.
Both repos' version inputs are free text, and their fallbacks are stale by
design (see the last row).

| What you need | Authoritative source |
|---------------|----------------------|
| Latest app **dev** release | `https://download.soulbits.app/app/dev/latest.json` → `version` (e.g. `v0.4.50-dev`). Dispatch the **next** number **without** the suffix (`v0.4.51`). |
| Latest app **prod** release | `https://download.soulbits.app/app/prod/latest.json` → `version` (tag runs only; a `403 AccessDenied` means nothing has been published on that channel yet). |
| Latest engine **dev sidecar** | `s3://soulbits-releases/engine/<version>/<abi>/libengine.so` — list the prefixes with the release AWS credentials, or read the last `android_only=true` engine dispatch. |

```bash
# App: the channel manifest is written by the release itself, so it is exact.
curl -s https://download.soulbits.app/app/dev/latest.json | jq -r .version

# Engine: list published versions (needs the release AWS credentials)…
aws s3 ls s3://soulbits-releases/engine/ | tail -5

# …or, without AWS credentials, read the last dev-loop dispatch's version:
gh run list -R harmony-ai-solutions/harmony-link-private --workflow=build.yml --limit 5
gh run view <run-id> --log | grep "INPUTS_VERSION="

# Then confirm the candidate sidecar really exists (both ABIs):
curl -sI https://download.soulbits.app/engine/v0.4.30-dev/arm64/libengine.so | head -1
curl -sI https://download.soulbits.app/engine/v0.4.30-dev/x86_64/libengine.so | head -1
```

> **`engine/latest.json` is not a dev-version source.** Only tag runs — or a
> dispatch with `ios=true` — write it; the `android_only` dev-loop job publishes
> the sidecars and deliberately never touches the manifest. Equally, the
> `ENGINE_SIDECAR_VERSION` repo variable and `android/app/build.gradle`'s
> `VERSION_NAME` default are fallbacks for convenience, not release state.

---

## Local dev-release APK

Build a signed dev APK locally that is **signature-consistent with CI** (so a CI
APK can later self-update over a local install — see the keystore note).

### 1. Build the engine sidecar (engine repo)

```bash
# in the engine repo (harmony-link-private)
bash build_sidecar_android.sh
# → build/android/arm64/libengine.so
#   build/android/x86_64/libengine.so
```

### 2. Assemble the dev release APK (this repo)

From `android/`:

```bash
./gradlew assembleDevRelease \
  -PRELEASE_KEYSTORE_FILE=release.keystore \
  -PRELEASE_KEYSTORE_PASSWORD=… \
  -PRELEASE_KEY_ALIAS=… \
  -PRELEASE_KEY_PASSWORD=… \
  -PENGINE_SIDECAR_ARTIFACTS_DIR=<engine-repo>/build/android
```

Output:

```
app/build/outputs/apk/dev/release/app-dev-release.apk
```

`-PENGINE_SIDECAR_ARTIFACTS_DIR` points the `vendorEngineSidecar` Gradle task at
the local drop (`<dir>/<artifact-abi>/libengine.so`, where the artifact ABIs are
`arm64` / `x86_64`). Alternatively provision by download with
`-PENGINE_SIDECAR_VERSION=vX.Y.Z -PENGINE_SIDECAR_BASE_URL=https://download.soulbits.app/engine`.
With neither, the build emits an **engine-less** APK and warns; adding
`-PENGINE_SIDECAR_STRICT=true` turns that warning into a hard failure (CI uses
strict — see Troubleshooting).

### 3. OAuth client id — required locally?

`resolveOAuthValue` in `android/app/build.gradle` resolves
`GOOGLE_WEB_CLIENT_ID` with this priority (first non-empty wins):

1. `-PGOOGLE_WEB_CLIENT_ID=…` (CLI override — what CI passes)
2. `android/gradle-secrets.dev.properties` — generated by `npm run oauth:dev`
   from your gitignored GCP `client_secret_*.json` files
3. `''` (empty — Google Sign-In falls back to SDK auto-discovery)

**There is no hardcoded dev default.** So `-PGOOGLE_WEB_CLIENT_ID` is **not
required locally if you have run `npm run oauth:dev`** (it writes the dev
properties file). If that file is absent, pass `-PGOOGLE_WEB_CLIENT_ID=…` or the
field resolves empty. CI always passes it explicitly.

### Keystore note

`android/app/release.keystore` is gitignored (`.gitignore`: `*.keystore`, with
`!debug.keystore`). Use the **same** keystore as the CI secret
(`ANDROID_RELEASE_KEYSTORE_BASE64`) so signatures match and a later CI APK can
self-update over a local install (and vice-versa).

---

## CI dev loop runbook

The dev-release loop spans two repos.

### Engine repo — publish the sidecar

1. **Actions → Run workflow** on branch `main` (the sidecar workflow lives in
   this repo's default branch).
2. Inputs: `android_only=true`, `version=vX.Y.Z-dev`. Dev-loop sidecars are
   published **with** the `-dev` suffix (`engine/v0.4.30-dev/…`); the plain
   `vX.Y.Z` rule below applies to the **app** dispatch only.
3. Verify the artifact is live (both ABIs):

   ```bash
   curl -sI https://download.soulbits.app/engine/vX.Y.Z-dev/arm64/libengine.so | head -1
   curl -sI https://download.soulbits.app/engine/vX.Y.Z-dev/x86_64/libengine.so | head -1
   # → HTTP/1.1 200 OK
   ```

### App repo — build + publish the dev APK

1. **Actions → Build Release → Run workflow** on `main`.
2. Inputs:
   - `version=vY.Y.Z` (PLAIN — no `-dev`; the dev flavour appends it)
   - `publish_latest=true` (writes `app/dev/latest.json`)
   - `engine_version=vX.Y.Z-dev` — pass the sidecar version **explicitly**:
     the `ENGINE_SIDECAR_VERSION` repo variable is only a fallback and can lag
     the live sidecar. `android/app/build.gradle`'s `VERSION_NAME` default is
     likewise for local builds only; CI always uses this dispatch input.
3. The run builds the dev + prod APKs and publishes **only**
   `app/dev/latest.json` (prod is untouched on a dispatch).

### Phone

1. Reopen the app (cold start) **or** pull-to-refresh on the settings screen.
2. An update dialog appears automatically ("Update available" / "Download and
   install app vY.Y.Z-dev now?") → tap **Download & install**.
3. On the sideload channel the button runs the in-app APK self-update; grant the
   install permission if prompted.

There is **no TTL**, so you don't wait: a cold start or a foreground (≥60s apart)
re-checks immediately. If the phone is offline, the last known state is served
from cache.

---

## Prod isolation

A dispatch (`publish_latest=true`) writes **`app/dev/latest.json` ONLY**.
`app/prod/latest.json` is written **only** by a real `v*` tag run. Prod installs
therefore never see a dev version.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Build fails: "Refusing to build an engine-less APK" | `-PENGINE_SIDECAR_STRICT=true` (CI) with no sidecar artifact | Publish the engine first, or pass `-PENGINE_SIDECAR_VERSION` + `-PENGINE_SIDECAR_BASE_URL` / `-PENGINE_SIDECAR_ARTIFACTS_DIR` |
| Manifest fetch 403 / update dialog never shows | Nothing published on that channel yet (e.g. no tag → no `app/prod/latest.json`) | Publish a dev release (`publish_latest=true`), or cut a `v*` tag for prod |
| Install rejected: signature mismatch | Installed build is debug-signed, the new APK is release-signed (or a different keystore) | Use the release keystore locally (see Keystore note); uninstall the debug build once |
| Update dialog keeps prompting for the version you just installed | Version suffix mismatch (`…-dev-dev`) | Re-run the dispatch with a PLAIN `vX.Y.Z` |
| Where to read the installed version | — | `versionName` is set in `android/app/build.gradle` (`versionName "…"` + the dev flavour's `versionNameSuffix "-dev"`); at runtime it's `DeviceInfo.getVersion()` |

---

## Related

- [`RELEASE.md`](RELEASE.md) — the full tag-driven release process.
- [`INSTALLATION.md`](INSTALLATION.md) — flavours, variants, and distribution.
- [`OAUTH-SECRETS.md`](OAUTH-SECRETS.md) — how OAuth identifiers are injected.
