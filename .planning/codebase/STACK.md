# Technology Stack

**Analysis Date:** 2026-08-07

## Languages

**Primary:**
- TypeScript `^5.8.3` - All application code in `src/`, `App.tsx`, `__tests__/`, `e2e` tooling, `scripts/dump-schema.ts`. Config in `tsconfig.json` (extends `@react-native/typescript-config`).

**Secondary:**
- JavaScript (CommonJS) - Build/tooling config files: `babel.config.js`, `metro.config.js`, `react-native.config.js`, `jest.config.js`, `.eslintrc.js`, `.prettierrc.js`, `scripts/oauth-secrets.cjs`
- Kotlin `2.1.20` - Android native layer `android/app/build.gradle`, `android/build.gradle`
- Swift / Objective-C - iOS native layer: `ios/HarmonyAIChat/AppDelegate.swift`, `ios/Podfile`
- Ruby `>= 2.6.10` - CocoaPods dependency management `Gemfile` (pins `cocoapods >= 1.13`, `activesupport`, `xcodeproj < 1.26.0`)
- Python - `scripts/compare-schemas.py` (schema parity check in CI)
- Java - Android Gradle build (`org.gradle.jvmargs` in `android/gradle.properties`, JDK 17 in CI)
- Go - NOT in this repo; the Go backends are sibling repos (see INTEGRATIONS.md)

## Runtime

**Environment:**
- React Native `0.86.0` (installed version from `node_modules/react-native/package.json`; `package.json` declares `^0.86.0`)
- React `^19.2.7`
- Node `>= 20` (declared in `package.json` `engines`; CI uses Node 20 in `.github/workflows/test.yml`, `.github/workflows/build-release.yml`)

**Package Manager:**
- npm (no version pinned in repo)
- Lockfile: `package-lock.json` present (committed)

**JS Engines:**
- Hermes enabled (`hermesEnabled=true` in `android/gradle.properties`); JSC fallback flavor declared as `io.github.react-native-community:jsc-android:2026004.+` in `android/app/build.gradle`

## Frameworks

**Core:**
- React Native `0.86.0` - App framework; entry `index.js` registers `App` from `App.tsx`
- React Native New Architecture enabled (`newArchEnabled=true` in `android/gradle.properties`) — TurboModules/Fabric
- React Navigation `^7.x` - `@react-navigation/native`, `@react-navigation/native-stack`, `@react-navigation/bottom-tabs`; navigators at `src/navigation/AppNavigator.tsx`, `src/navigation/MainTabNavigator.tsx`
- react-native-paper `^5.14.5` - Material Design UI kit (`PaperProvider` in `App.tsx`)
- i18next `^26.3.6` + react-i18next `^17.0.9` - Internationalization; locale files in `src/i18n/locales/en/*.json`
- emoji-mart `^5.6.0` + emoji-datasource - Emoji picker/sprite rendering (`src/components/emoji/`, `src/services/EmojiService.ts`)

**Testing:**
- Jest `^30.4.2` - multi-project runner (`jest.config.js`: `unit` + `integration` projects, both Node environment)
- @testing-library/react-native `^14.0.1` + @testing-library/jest-native
- jest-junit `^17.0.0` - XML reports (`reports/unit-tests.xml`, `reports/integration-tests.xml`)
- better-sqlite3 `^12.11.1` (devDependency) - Node-side SQLite for migration/repository tests (`src/database/__test_utils__/nodeDatabase.ts`)
- Maestro - E2E mobile UI tests (`e2e/.maestro/*.yaml`)
- ts-node `^10.9.2` - runs `scripts/dump-schema.ts` (`npm run schema:dump`)

**Build/Dev:**
- Metro bundler via `@react-native/metro-config` `^0.86.0` (`metro.config.js` — custom `assetExts` for `db/mp3/ttf/obj`, `blockList: null` to allow `__tests__` in bundles)
- Babel via `module:@react-native/babel-preset` (`babel.config.js`)
- TypeScript compiler (`npx tsc --noEmit` in CI)
- react-native-config `^1.6.1` - build-time env injection (native BuildConfig/xcconfig → JS `Config`)
- `@react-native-community/cli` `^20.2.0` - RN CLI tooling

## Key Dependencies

**Critical:**
- `@harmony-ai-solutions/soulbits-api-client` - First-party REST client for Soulbits cloud backend, installed **directly from git** (`git+ssh://git@github.com/harmony-ai-solutions/soulbits-api-client-js.git#518c9e8...`), built on `openapi-fetch`; consumed via `src/services/cloud/soulbitsClient.ts`
- `react-native-sqlite-storage` `^6.0.1` - Local SQLite persistence (`src/database/connection.ts`); promise API enabled
- `react-native-keychain` `^10.0.0` - Secure token/encryption-key storage (`src/services/auth/tokenStorage.ts`, `src/database/connection.ts`)
- `react-native-websocket-self-signed` `^0.4.0` - WebSocket client supporting self-signed TLS for Harmony Link pairing (`src/services/connection/createWebSocket.ts`)
- `@react-native-async-storage/async-storage` `^2.2.0` - Connection state/JWT persistence (`src/services/ConnectionStateManager.ts`)

**Infrastructure:**
- `react-native-fs` `^2.20.0` - File system (DB path in DocumentDirectory, wipe/cleanup)
- `react-native-device-info` `^15.0.1` - Device ID (`ConnectionStateManager`)
- `react-native-biometrics` `^3.0.1` - Biometric lock (`src/services/BiometricLockService.ts`, `src/contexts/BiometricLockContext.tsx`)
- `react-native-track-player` `^5.0.0-alpha0` + `react-native-audio-record` `^0.2.2` + `music-metadata` - Audio playback/recording (`src/services/AudioPlayer.ts`, `AudioRecorder.ts`)
- `react-native-image-picker` `^7.0.0` + `@react-native-documents/picker` `^12.0.0` - Image/document import (avatar, character cards)
- `react-native-linear-gradient` `^2.8.3` - Animated gradient backgrounds (`src/components/background/`)
- `react-native-vector-icons` `^10.3.0` - Icons (font linking via `fonts.gradle` in `android/app/build.gradle`)
- `uuid` `^13.0.0` + `react-native-get-random-values` `^2.0.0` - ID generation (`src/utils/uuid.ts`; polyfill imported first in `index.js`)
- `eventemitter3` `^5.0.1` - Event emitter base for service singletons (AuthService, CloudSessionService, ConnectionStateManager)
- `react-native-logs` `^5.5.0` - Logging (`src/utils/logger.ts`, tag `[SOULBITS]`, error-only in prod)
- `react-native-safe-area-context`, `react-native-screens`, `@react-native-community/slider`, `@react-native-clipboard/clipboard` - RN core ecosystem

## Configuration

**Environment:**
- `react-native-config` reads native-injected vars; key vars consumed in `src/config/cloud.ts`: `APP_ENV` (`'dev' | 'prod'`), `IS_BETA`, `GOOGLE_WEB_CLIENT_ID`, `APPLE_SERVICES_ID`
- Android flavors `dev`/`prod` (`android/app/build.gradle`) inject `IS_BETA`, OAuth IDs, and E2E overrides `HARMONY_LINK_WSS_URL`/`HARMONY_LINK_WS_URL` as `buildConfigField`
- OAuth secrets resolved at build time by `scripts/oauth-secrets.cjs` from gitignored GCP `client_secret_*.json` files (`npm run oauth:dev` / `oauth:prod`); fallback to `-P` gradle properties / CI vars
- `.env.example` present at repo root (1654 bytes, 2026-08-01) — template only, never read/committed
- `e2e/.env.e2e` / `e2e/.env.e2e.ios` - E2E build env files (existence noted)

**Build:**
- `android/build.gradle`: buildTools 36.0.0, minSdk 24, compileSdk 36, targetSdk 36, NDK 27.1.12297006, Kotlin 2.1.20; Google Services plugin 4.4.2
- `ios/HarmonyAIChat.xcodeproj/project.pbxproj`: `IPHONEOS_DEPLOYMENT_TARGET = 15.1`, `MARKETING_VERSION = 1.0`, `CURRENT_PROJECT_VERSION = 1`
- `ios/Podfile`: `use_react_native!`, `platform :ios, min_ios_version_supported`
- CI `.github/workflows/build-release.yml`: JDK 17 (Temurin), CocoaPods install, xcodebuild Release (unsigned), `./gradlew assemble{Dev,Prod}Release`

## Platform Requirements

**Development:**
- Node >= 20, npm, JDK 17 (CI), Android SDK (compile 36), Xcode (iOS 15.1+), CocoaPods >= 1.13, Ruby >= 2.6.10
- `Gemfile` pins `xcodeproj < 1.26.0`, `concurrent-ruby < 1.3.4` to avoid known build failures
- Watchman config present (`.watchmanconfig`); no `.nvmrc`

**Production:**
- Deployment target: Android APK (dev/prod flavors) + iOS IPA, both built unsigned and distributed via AWS S3 (`soulbits-releases` bucket, eu-central-1) behind `download.soulbits.app` (see `.github/workflows/build-release.yml`)
- Backend: sibling Go repos `harmony-link-private` (self-hosted desktop bridge) and `soulbits-cloud-backend` (cloud SaaS) — both checked out under the same GOPATH org but NOT part of this repo (no `go.mod` here)

---

*Stack analysis: 2026-08-07*
