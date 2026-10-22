# Phase 7-10 — Engine & App Update Surfacing (release manifests, CI provisioning, contract canary, update UX)

> **Repos:** engine (`../harmony-link-private`), app (`../harmony-ai-app`), cloud (`soulbits-cloud-backend` — no code, IaC already exists)
> **Origin:** review follow-up 2026-10-12, **owner ruling: FULL scope** — CI engine provisioning fix, `latest.json` manifests, runtime contract-canary wiring, Settings/About version row + update-available banner + desktop-peer download deep-link, and the optional Android app self-update flow.
> **Sequencing:** no management-contract changes (all engine endpoints used already exist); 7-6/7-8 contract bumps unaffected. Prefer landing **after 7-9** so artifact names are final (`SoulbitsEngine.*`); if it lands first, publish under the current `HarmonyEngine.*` names and let 7-9 rename (manifest consumers key off fields, not filenames).
> **Structural fact (do not re-litigate):** the embedded engine updates **only with the app**. Android 10+ SELinux blocks `exec()` from writable app storage (why the sidecar execs from read-only `nativeLibraryDir` — `android/app/build.gradle:212-213`), and iOS forbids downloaded native code. "Engine update" UX therefore means *notify + update the app* (+ direct download links for the **desktop** peer, where they are actionable).

## Objective

Close the loop that 5-1 half-built: the app knows which engine it shipped, verifies the running engine at
startup, tells the user when a newer engine/app exists, and — as the hard precondition — the release
pipelines actually **provision the engine binary** so shipped builds contain one.

## Verified current state (anchors, 2026-10-12)

### Download plane (cloud — exists, healthy)
- [`modules/s3-releases/main.tf`](../../../soulbits-cloud-backend/infrastructure/tofu/modules/s3-releases/main.tf) — `soulbits-releases` bucket, public **read** (no listing) for `app/*` + `engine/*`, versioning + 90d non-current lifecycle; `ci-releases-uploader` IAM user (policy `shared/main.tf:154-178`) shared by both repos' GitHub secrets.
- CloudFront: `download.soulbits.app` + `download.project-harmony.ai` over the bucket ([`shared/main.tf:36-70`](../../../soulbits-cloud-backend/infrastructure/tofu/environments/shared/main.tf:36), outputs `releases_base_url` / `releases_harmony_base_url` at `shared/outputs.tf:55-62`).

### Engine release pipeline (gap: mobile artifacts never published)
- [`build.yml:122,224`](../../../harmony-link-private/.github/workflows/build.yml) upload **desktop zips only** → `engine/<v>/soulbits-engine-<v>_{windows,linux}_amd64.zip`. Sidecar (`build/android/<abi>/libengine.so`) + facades are `actions/upload-artifact` (GitHub-internal) at `:329,372,421` — they never reach the bucket, so the app's gradle URL source has **no producer**. No manifest of any kind is written.
- Note: engine workflow uses `aws-region: us-west-1` (`:111,:215`) while the app's uses `eu-central-1` — harmless for S3 (global), but standardize on `eu-central-1` while touching these jobs.

### App release pipeline (gap: builds without an engine)
- [`build-release.yml:116-122`](../../../harmony-ai-app/.github/workflows/build-release.yml:116) — release gradle invocation passes **no** `-PENGINE_SIDECAR_*` flags; `jniLibs/**/libengine.so` is gitignored ([`.gitignore:108-109`](../../../harmony-ai-app/.gitignore:108)) → `vendorEngineSidecar` takes its warning path ("engine will be unavailable on <abi> devices", `build.gradle:285-288`) and the APK **ships engine-less**. The iOS job (`pod install` + `xcodebuild`, `:179-221`) never fetches the gitignored xcframework ([`.gitignore:111-113`](../../../harmony-ai-app/.gitignore:111)) → `HarmonyEngineModule.m` fails to compile. (These are the still-open "first CI run" owner gates from 4-1/4-2 — this phase closes them.)
- Uploads: `app/<v>/<env>/harmony-ai-app-<v>-{android.apk,ios.ipa}` + `app/latest/<env>/` pointers (`:133-151,240-256`) + GitHub Release with links (`:261-286`). No version manifest JSON.
- Pin hygiene: gradle default `ENGINE_SIDECAR_VERSION = "0.1.0"` ([`build.gradle:244`](../../../harmony-ai-app/android/app/build.gradle:244)) is fictional vs engine `AppVersion = "v0.3.0-dev"`.

### Runtime version awareness (gap: built but unwired)
- Engine exposes `GET /public/appversion` → `{"appVersion": constants.AppVersion}` ([`management/server.go:195-196`](../../../harmony-link-private/management/server.go:195)) and the facade `EngineVersion` (4-1); the app has `checkContractVersion()` + `ENGINE_CONTRACT_VERSION` ([`engineContract.ts:57,87`](../../../harmony-ai-app/src/services/engine/engineContract.ts:87)) — **zero runtime consumers** (tests only). No screen shows the engine version. Nothing polls for updates.
- App self-version available via `react-native-device-info@15` ([`package.json:51`](../../../harmony-ai-app/package.json:51)).
- Desktop-peer actionable case already has UI real estate: `DesktopSyncScreen` rejected state (copy `desktopSync.json:121-122`) is where a "download the latest desktop engine" link belongs.

## Design

### 1. Release manifests (static JSON on the bucket; no new service)

`engine/latest.json` (plus a versioned twin `engine/<v>/manifest.json`), written by the engine workflow:

```json
{
  "version": "v0.3.2",
  "contractVersion": "1.2.0",
  "releasedAt": "2026-10-12T12:00:00Z",
  "notesUrl": "https://download.soulbits.app/engine/v0.3.2/NOTES.md",
  "artifacts": {
    "desktop": {
      "windows_amd64": "https://download.soulbits.app/engine/v0.3.2/soulbits-engine-v0.3.2_windows_amd64.zip",
      "linux_amd64":   "https://download.soulbits.app/engine/v0.3.2/soulbits-engine-v0.3.2_linux_amd64.zip"
    },
    "android": {
      "arm64":  "https://download.soulbits.app/engine/v0.3.2/arm64/libengine.so",
      "x86_64": "https://download.soulbits.app/engine/v0.3.2/x86_64/libengine.so"
    },
    "ios": {
      "xcframework": "https://download.soulbits.app/engine/v0.3.2/SoulbitsEngine.xcframework.zip"
    }
  }
}
```

`app/latest.json`, written by the app workflow (single writer: the `create-release` job; `workflow_dispatch`
builds skip it), keyed per environment:

```json
{
  "version": "v1.4.0",
  "releasedAt": "2026-10-12T12:00:00Z",
  "notesUrl": "https://github.com/harmony-ai-solutions/harmony-ai-app/releases/tag/v1.4.0",
  "android": { "dev": "https://download.soulbits.app/app/v1.4.0/dev/harmony-ai-app-v1.4.0-android.apk",
               "prod": "https://download.soulbits.app/app/v1.4.0/prod/harmony-ai-app-v1.4.0-android.apk" },
  "ios":     { "dev": "…/harmony-ai-app-v1.4.0-ios.ipa", "prod": "…" }
}
```

Rules: absolute URLs (they become a de-facto public contract — owner sign-off on the shape); served via the
existing CloudFront hosts; the app cache-busts with `?t=<now>`; dev-channel builds read the same files but
only surface `dev` entries (flavor-aware like `CLOUD_HOSTS`).

### 2. CI engine provisioning (the precondition fix)

- **Engine `build.yml`**: after the existing sidecar/facade jobs, publish to S3: `engine/<v>/<abi>/libengine.so`
  (both ABIs), `engine/<v>/SoulbitsEngine.xcframework.zip` (zip of the `build-facade-ios` job output),
  `engine/<v>/SoulbitsEngine.aar`, and both manifests (versioned + `latest.json`). Add a final
  `aws s3 ls s3://soulbits-releases/engine/<v>/` verification step. Standardize `aws-region: eu-central-1`.
  Keep an eye on the Windows publish line (`:122`) — its pwsh `$env:VERSION`/backtick escaping deserves a
  first-run eyeball.
- **App `build-release.yml`**: new `engine_version` input (or repo var, default = the pinned release). The
  Android job passes `-PENGINE_SIDECAR_VERSION=${ENGINE_VERSION}
  -PENGINE_SIDECAR_BASE_URL=https://download.soulbits.app/engine` — the vendoring task already consumes
  exactly this URL shape ([`build.gradle:235`](../../../harmony-ai-app/android/app/build.gradle:235)). Add a
  new gradle flag `-PENGINE_SIDECAR_STRICT=true` that turns the vendor warning into a **failure** (CI must
  not ship engine-less again), plus an APK post-build assertion (`unzip -l | grep libengine.so`). The iOS job
  downloads + unzips the xcframework into `ios/Frameworks/` before `pod install`.
- **macOS runner gating (owner ruling 2026-10-13, landed same day)**: macOS legs run **only when explicitly
  required** — release tags keep building iOS (the tag push is the release act, and `create-release` +
  `app/latest.json` / `engine/latest.json` reference the iOS URLs, so skipping would publish dead links),
  while manual `workflow_dispatch` runs are **opt-in**: app input `build_ios` (default `false`) gates
  `build-ios`; engine input `ios` (default `false`) gates `build-facade-ios`. Skipping the engine facade also
  auto-skips `publish-release` (dependents of skipped `needs` are skipped), so cheap manual runs can no longer
  clobber `engine/latest.json` with a dev version. App `e2e-ios.yml` was the third macOS consumer —
  **ruled dispatch-only 2026-10-13 and landed**: `pull_request` trigger removed (stale "nightly" header
  comment and 8×-rate figure corrected in the same pass; "Harmony Link" → "Soulbits Engine").
- **Pin hygiene**: remove the fictional `0.1.0` default in favor of CI-required explicitness; add one line to
  the 5-3 release checklist: "bump `ENGINE_SIDECAR_VERSION`, verify `aapt`-level engine presence".

### 3. Contract match as a BUILD-time gate (amended 2026-10-14)

> **Amendment (owner ruling 2026-10-14):** the original design wired a runtime `too_old` blocking card.
> That is wrong for an EMBEDDED engine: it ships WITH the app, so a contract mismatch is a build defect —
> not a user-remediable condition — and a card that can never resolve by user action is pure noise (it
> also compared the engine's PRODUCT version to the app's CONTRACT version, so it fired unconditionally).
> The runtime card was **removed**; the contract match moved to the **build step**.

- New gate script `scripts/check-engine-contract-build.cjs` — resolves the engine checkout (same logic as
  `build-engine-sidecar.cjs`: `--engine-repo` / `SOULBITS_ENGINE_REPO` / sibling `../harmony-link-private`),
  then delegates to `scripts/check-engine-contract.mjs --engine-repo <path>`. App `ENGINE_CONTRACT_VERSION`
  MUST equal the engine `docs/api/management/openapi.yaml` `info.version`; a mismatch **fails the build**
  (`npm run android` / `android-prod` / `ios` / `build:e2e:android` all gate on it; `npm run
  check:engine-contract` runs it standalone). When the engine checkout is ABSENT the check is SKIPPED with
  a warning (app-only CI without the private engine — matches the optional `contract-drift` CI job).
- The runtime probe stays **INFORMATIONAL only**: `EngineApiClient.engineAppVersion()` →
  `GET /public/appversion` → `EngineService.refreshEngineVersion()` (normalized) feeds the Settings
  **About** row. No `contract` verdict, no blocking UI. iOS facade parity: `EngineVersion` via `EngineCall`
  when the host is `EmbeddedEngineHost`.

### 4. Update-surfacing UX

- **About block** (extend `HelpSupportSettingsScreen.tsx` or a sibling `AboutSettingsScreen`): rows for App
  version (`DeviceInfo.getVersion()`), Soulbits Engine version (from §3 state), management-contract version
  (`ENGINE_CONTRACT_VERSION`).
- **`UpdateAvailableService`**: fetch both manifests (cache-busted; AsyncStorage cache, 6h TTL; refreshed on
  app start after engine-ready, on settings pull-to-refresh). Compare `app/latest.version` vs
  `DeviceInfo.getVersion()` — semver, env-aware. **Amended 2026-10-14:** the engine manifest is still
  fetched (for the desktop deep-link below) but there is no engine-update comparison — the embedded engine
  updates only with the app.
- **Banner** (non-blocking, dismissible per version, persisted): "App vY available" (+ Update button on
  Android sideload channel). **Amended 2026-10-14:** the engine banner line is gone (no engine update to
  announce). New i18n namespace `updates.json` (en).
- **Desktop-peer deep-link**: `DesktopSyncScreen` rejected state gains "Download the latest desktop engine"
  → `engine/latest.artifacts.desktop.{windows_amd64,linux_amd64}` (platform-pick or both links). This is the
  one place an engine download is directly actionable for the user today.
- **Optional Android self-update** (sideload channel only, behind a channel flag): Download via RNFS to
  cache → `ACTION_VIEW` install intent (`REQUEST_INSTALL_PACKAGES` permission + manifest entry + user
  confirmation flow). Play-channel builds hide it. iOS: link to the portal INSTALLATION instructions only.

### 5. Fences

- No management-API or contract-version changes; no new cloud service (static bucket JSON only).
- No OTA engine download on-device (platform-forbidden — see header).
- Desktop Wails self-update out of scope (desktop keeps portal/GitHub download UX).
- Portal download-card content is 7-9's URL-fix territory; only manifest URLs land here.

## Implementation steps

1. Engine `build.yml`: S3 publish (sidecar/facades/manifests) + `s3 ls` verify + region standardization.
2. App `build-release.yml`: engine provisioning (gradle flags + framework fetch + strict vendor + APK
   assertion) + `app/latest.json` writer in `create-release`.
3. Gradle: `ENGINE_SIDECAR_STRICT` flag; retire the `0.1.0` default.
4. App: `engineAppVersion()` + normalization (+ unit table incl. `v0.3.0-dev` vs `0.3.0`).
5. App: `EngineService` canary wiring + `too_old` blocking card.
6. App: `UpdateAvailableService` + manifest types + cache + banners + `updates.json` copy.
7. App: About block rows + `DesktopSyncScreen` desktop-engine deep-link.
8. App: optional Android APK self-update behind the channel flag.
9. Docs + changelogs (engine, app) + 5-3 release-checklist line + memory banks.

## Files to create/modify

- **Engine:** `.github/workflows/build.yml` (publish steps, region), release-notes helper if needed.
- **App:** `.github/workflows/build-release.yml`, `android/app/build.gradle` (strict flag, default pin),
  `src/services/engine/EngineApiClient.ts` (+`engineAppVersion`), `src/services/engine/engineContract.ts`
  (normalization helper if colocated), `src/services/engine/EngineService.ts` (canary), new
  `src/services/updates/UpdateAvailableService.ts` (+ types/tests), `src/screens/settings/HelpSupportSettingsScreen.tsx`
  (or new About screen), `src/screens/settings/DesktopSyncScreen.tsx` (deep-link),
  `src/i18n/locales/en/updates.json` (+ registration), optional `src/services/updates/apkSelfUpdate.ts` +
  Android manifest/permission, `docs/INSTALLATION.md`, `CHANGELOG.md`.
- **Cloud:** none (IaC already serves both prefixes); optionally note manifest URLs in portal copy later.

## Verification gates (owner-run)

- Engine CI run publishes the full `engine/<v>/` set + manifest; `aws s3 ls` assertion green.
- App release `workflow_dispatch` with `engine_version` set: APK contains `libengine.so` (workflow
  assertion), iOS archive compiles with the fetched framework.
- App unit tests: normalization table, canary gate transitions, manifest compare (env-aware), banner
  dismiss persistence.
- Owner device drills: (1) app built against an older engine than its `ENGINE_CONTRACT_VERSION` →
  `too_old` card; (2) manifest ahead of shipped engine → banner, no blocking; (3) pairing-rejected state →
  desktop link resolves to a real zip; (4) Android sideload self-update round-trip.

## Owner gates

- First full engine+app release run through the new provisioning (eyeball the Windows pwsh publish line).
- Manifest shape/URL sign-off (they become a public de-facto contract).
- Play-vs-sideload channel decision for self-update visibility (`REQUEST_INSTALL_PACKAGES` is a
  Play-review-sensitive permission).

## Progress checklist

- [x] 1. Engine workflow S3 publishing + verify
- [x] 2. App release workflow engine provisioning + app/latest.json
- [x] 3. Gradle strict flag + pin hygiene
- [x] 4. engineAppVersion + normalization
- [x] 5. Contract match as a build-time gate (was: runtime canary + too-old card; amended 2026-10-14)
- [x] 6. UpdateAvailableService + banners + copy
- [x] 7. About block + desktop deep-link
- [x] 8. Optional Android self-update (channel-flagged)
- [x] 9. Docs, changelogs, checklist line, memory banks
- [ ] Owner: first release run · manifest sign-off · channel decision · device drills

> **Work item 0 (prerequisite, from 7-9's report):** `BackupModule.pickFolder` fixed for RN 0.86
> (`reactContext.currentActivity` + `reactContext.startActivityForResult(intent, code, null)`;
> the `ReactContextBaseJavaModule` API moved to `ReactApplicationContext`). `android\gradlew.bat
> assembleDevDebug` now passes (was failing pre-existing) — first agent-verified Android build on
> this host. See the 7-10 final report.
>
> **Landing notes:** steps 1-9 landed code-side; the version probe lives in `EngineService` with
> an INJECTED probe (`engineVersionProbe.ts`) to avoid the `EngineApiClient`↔`EngineService` import
> cycle. **Amended 2026-10-14:** the runtime `contract` verdict + `EngineContractGate` blocking card were
> removed (embedded-engine ruling — see §3); the probe now only feeds the About engine-version row, and
> the app↔engine contract match is enforced by the build-time `scripts/check-engine-contract-build.cjs`
> gate. `aws`-CLI steps are documented for the owner's first run — no live S3 publish was attempted
> (no CI credentials locally).
>
> **macOS gating (owner ruling 2026-10-13, landed same day):** app `build_ios` input + engine `ios`
> input (both default `false`) make manual dispatches opt-in for macOS; tags unchanged. Engine
> manual runs without `ios` now skip `publish-release` entirely (needs-skip propagation) — no more
> `engine/latest.json` clobber risk from dev-version dispatches. App `e2e-ios.yml` additionally
> **ruled dispatch-only** (pull_request trigger removed; stale nightly/8× header corrected).
