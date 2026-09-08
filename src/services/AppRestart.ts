/**
 * App process restart (phase 4-5 / D82).
 *
 * The stale-watermark rebuild reaction (D76) needs the closest-to-PROCESS
 * restart the app can get: a mid-session re-init would wipe under mounted,
 * querying screens with the lazy `syncDb` handle open and SyncService in-memory
 * state live — the exact race class D61 was ruled to kill. A process restart
 * tears all of it down by construction (open WS, DB handles, in-memory sync
 * state, active entity sessions).
 *
 * This app is BARE React Native (no Expo — `react-native` CLI scripts in
 * package.json, `android/` + `ios/` native projects, New Architecture enabled
 * via `android/gradle.properties: newArchEnabled=true`), so `react-native-restart`
 * is the right mechanism:
 *
 *   - Android: ProcessPhoenix.triggerRebirth — a TRUE process termination +
 *     rebirth (the native process dies; the activity + React context are
 *     recreated from scratch).
 *   - iOS: the standard RN reload command (JS-runtime restart; the native
 *     process survives, but the full React context — JS modules, native module
 *     instances, WS/DB handles owned by JS — is recreated).
 *
 * v0.0.29 supports both the legacy bridge and the New Architecture (TurboModule
 * spec `RNRestartSpec` with `codegenConfig`), so it works with this app's
 * `newArchEnabled=true`. Autolinking picks up the native side (Android Gradle
 * plugin `com.facebook.react` codegen wiring + iOS podspec with
 * `install_modules_dependencies`); a native rebuild (`gradlew` / `pod install`)
 * is required after adding the dependency.
 *
 * `restartApp` intentionally throws on failure (e.g. the native module was
 * never linked) — the caller (SyncService.handleRebuildRequired) catches it:
 * crash-safety is guaranteed by persisting the wipe flag BEFORE this call, so
 * a failed restart still wipes on the next natural launch (D82).
 */

import RNRestart from 'react-native-restart';

/** Restart the app process. Throws if the native module is unavailable. */
export function restartApp(): void {
  RNRestart.restart();
}