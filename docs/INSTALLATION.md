# Installation Guide

## Build Flavours

The app ships with dev and prod build flavours to distinguish development/beta builds from production releases.

### Android

Android uses `productFlavors` (`dev`/`prod` in `android/app/build.gradle`):

| Flavor | Application ID | Behaviour |
|--------|---------------|-----------|
| **dev** | `ai.soulbits.chat.dev` | Co-installable alongside prod. Targets beta hosts. |
| **prod** | `ai.soulbits.chat` | Production release. Targets `*.soulbits.app`. |

`react-native-config` surfaces `APP_ENV`, `IS_BETA` (boolean), `GOOGLE_WEB_CLIENT_ID`, and `APPLE_SERVICES_ID` to JavaScript based on the active flavour.

> OAuth identifiers are **not hardcoded** in tracked files. They are injected per-environment from gitignored GCP `client_secret_*.json` files by `scripts/oauth-secrets.cjs`. See [OAUTH-SECRETS.md](OAUTH-SECRETS.md) for full details.

### iOS

iOS uses a **single Xcode scheme** — dev/prod is distinguished by the CI build matrix in `.github/workflows/build-release.yml`:

- The workflow regenerates `.env` (read by `react-native-config`) per matrix entry
- `PRODUCT_BUNDLE_IDENTIFIER` is overridden: `ai.soulbits.chat.dev` for dev builds
- No separate `.xcconfig` files or second Xcode scheme

> Apple Sign-In (SIWA) requires a **signed build** with the SIWA entitlement. It does not apply to the current unsigned sideload IPAs — email/password and Google Sign-In are available on sideload builds instead.

## Android

### Requirements
- Android 7.0 (API 24) or higher
- "Install from unknown sources" enabled in device settings

### Steps
1. Download the latest APK: [harmony-ai-app-android.apk](https://download.soulbits.app/app/latest/harmony-ai-app-android.apk)
2. Open the downloaded `.apk` file
3. Confirm installation when prompted
4. Open the app and configure your Soulbits Engine connection

### Updating
Download and install the new APK over the existing one. Your data is preserved.

## iOS (Sideloading)

> ⚠️ iOS installation requires sideloading tools. The app is provided as an unsigned IPA
> and must be signed with your Apple ID before installation.

### Requirements
- iOS 15.0 or higher
- A computer (Windows/Mac) with one of the sideloading tools below
- A free Apple ID

### Method 1: Sideloadly (Recommended)

1. Download and install [Sideloadly](https://sideloadly.io/) on your PC/Mac
2. Download the latest `.ipa` file: [harmony-ai-app-ios.ipa](https://download.soulbits.app/app/latest/harmony-ai-app-ios.ipa)
3. Open Sideloadly and drag the `.ipa` file into it
4. Enter your Apple ID when prompted
5. Click "Start" to sign and install the app
6. On your iOS device, go to Settings → General → VPN & Device Management
7. Trust the developer certificate associated with your Apple ID
8. Open the app and configure your Soulbits Engine connection

**Note**: Free Apple ID signing expires after 7 days. Re-sign weekly via Sideloadly.

### Method 2: AltStore

1. Install [AltStore](https://altstore.io/) on your iOS device (requires a PC/Mac on the same network)
2. Download the latest `.ipa` file: [harmony-ai-app-ios.ipa](https://download.soulbits.app/app/latest/harmony-ai-app-ios.ipa)
3. Open the `.ipa` file with AltStore
4. AltStore will sign and install the app
5. AltStore auto-refreshes the signing in the background (keep your PC/Mac running periodically)

### Updating
Download the new `.ipa` and reinstall via your sideloading tool. App data should be preserved.

## In-app updates & release manifests (plan 7-10)

The app learns about new releases from two static JSON manifests on the existing
CloudFront download hosts (no new service):

- **`https://download.soulbits.app/engine/latest.json`** — written by the engine
  release workflow. Shape:

  ```json
  {
    "version": "v0.3.2",
    "contractVersion": "1.4.0",
    "releasedAt": "2026-10-12T12:00:00Z",
    "notesUrl": "https://download.soulbits.app/engine/v0.3.2/NOTES.md",
    "artifacts": {
      "desktop": { "windows_amd64": "…/soulbits-engine-v0.3.2_windows_amd64.zip",
                   "linux_amd64":   "…/soulbits-engine-v0.3.2_linux_amd64.zip" },
      "android": { "arm64": "…/arm64/libengine.so", "x86_64": "…/x86_64/libengine.so" },
      "ios":     { "xcframework": "…/SoulbitsEngine.xcframework.zip" }
    }
  }
  ```

- **`https://download.soulbits.app/app/latest.json`** — written by the app
  release workflow's tag-only `create-release` job. Carries per-environment
  `android`/`ios` download URLs.

The app cache-busts with `?t=<now>` and caches the result for 6 hours
(`UpdateAvailableService`). **The embedded engine only updates WITH the app**
(Android 10+ SELinux blocks `exec()` from writable storage; iOS forbids
downloaded native code) — so an "engine update" surfaces as a banner that says
it arrives with the next app update, plus a directly-actionable **desktop**
download link on the DesktopSync rejected state. On the **sideload** Android
channel the app-available banner offers an in-app APK install
(`REQUEST_INSTALL_PACKAGES`; hidden on the Play channel — see
`src/config/appChannel.ts`). iOS links to these INSTALLATION instructions.

> The manifest shape/URLs are a de-facto public contract — owner sign-off is an
> explicit gate before they are frozen.

## Local Development (Google OAuth)

For local development, the Google OAuth client secrets are read from
**gitignored** `client_secret_*.json` files and injected at build time:

```bash
# 1. Place the GCP OAuth client JSON (downloaded from Google Cloud Console)
#    in the repo root or secrets/dev/ (matches client_secret_*.json).

# 2. Generate the environment files:
npm run oauth:dev      # dev environment (writes .env + gradle-secrets.dev.properties)

# 3. Build / run (the scripts auto-run the loader first):
npm run android
npm run ios
```

See [OAUTH-SECRETS.md](OAUTH-SECRETS.md) for the full environment wiring,
search order, and CI behaviour.

## Backup provider OAuth (Dropbox / OneDrive) — TODO (owner action)

The user-owned-storage backup feature (plan 2-6) can upload to **Dropbox** and
**OneDrive** in addition to a local folder and WebDAV. Those two targets need
OAuth client credentials registered with each provider, and today the app ships
**empty placeholder client ids** (`android/app/src/main/java/ai/soulbits/chat/backup/BackupModule.kt`
— `OAUTH_PROVIDERS["dropbox"].clientId` / `["onedrive"].clientId` are `""`).

> **TODO:** the project owner must create a Dropbox app and an Azure (Entra)
> app registration, then wire the resulting client ids into the build the same
> way the Google OAuth ids are handled — extend `scripts/oauth-secrets.cjs` to
> emit them (e.g. `DROPBOX_CLIENT_ID` / `ONEDRIVE_CLIENT_ID`) from gitignored
> secret files into the per-flavour `.env` / `gradle-secrets.<flavour>.properties`,
> and have `BackupModule` read them per build flavour.
>
> Do **not** invent or hardcode client ids. Until the owner wires real
> credentials, the Dropbox / OneDrive backup targets cannot complete their OAuth
> flow; local-folder and WebDAV targets work without OAuth. The redirect URI is
> `soulbits://oauth/callback` (registered as a deep link in the Android
> manifest).
