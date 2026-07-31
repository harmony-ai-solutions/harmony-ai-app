# Installation Guide

## Build Flavours

The app ships with dev and prod build flavours to distinguish development/beta builds from production releases.

### Android

Android uses `productFlavors` (`dev`/`prod` in `android/app/build.gradle`):

| Flavor | Application ID | Behaviour |
|--------|---------------|-----------|
| **dev** | `com.harmonyai.app.dev` | Co-installable alongside prod. Targets beta hosts. |
| **prod** | `com.harmonyai.app` | Production release. Targets `*.soulbits.app`. |

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
4. Open the app and configure your Harmony Link connection

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
8. Open the app and configure your Harmony Link connection

**Note**: Free Apple ID signing expires after 7 days. Re-sign weekly via Sideloadly.

### Method 2: AltStore

1. Install [AltStore](https://altstore.io/) on your iOS device (requires a PC/Mac on the same network)
2. Download the latest `.ipa` file: [harmony-ai-app-ios.ipa](https://download.soulbits.app/app/latest/harmony-ai-app-ios.ipa)
3. Open the `.ipa` file with AltStore
4. AltStore will sign and install the app
5. AltStore auto-refreshes the signing in the background (keep your PC/Mac running periodically)

### Updating
Download the new `.ipa` and reinstall via your sideloading tool. App data should be preserved.

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
