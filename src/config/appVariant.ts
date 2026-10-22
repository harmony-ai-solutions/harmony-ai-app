/**
 * appVariant — the distribution variant for this build (plan 7-14).
 *
 * `APP_VARIANT` is the single FUNCTIONAL distribution axis:
 *
 *   - `full` (default) — the self-built / sideload distribution. Today's
 *                        behavior, byte-for-byte: every provider available,
 *                        direct-LAN pairing, purchases, and the in-app APK
 *                        self-update.
 *   - `store`          — the Play / App Store listing. Soulbits Cloud only,
 *                        non-cloud entities visible-but-locked, cloud-relay
 *                        pairing only, purchases disabled at launch, and the
 *                        APK self-updater OFF (the listing owns updates).
 *
 * Injection mirrors APP_ENV's existing mechanism:
 *   - Android → a `buildConfigField "String", "APP_VARIANT"` per flavour
 *     (`android/app/build.gradle`); react-native-config reflects the app's
 *     generated BuildConfig class, so `Config.APP_VARIANT` is a JS string at
 *     runtime.
 *   - iOS / Metro → `APP_VARIANT` is written into the generated root `.env` by
 *     `scripts/oauth-secrets.cjs`; react-native-config's iOS codegen
 *     (`GeneratedDotEnv.m`) turns it into `Config.APP_VARIANT`.
 *
 * Any value other than `'store'` — including an absent key — resolves to
 * `'full'`, so an unconfigured self-build is always the full variant
 * (design rule 6).
 *
 * TEST SEAM: the variant is a build-time value, so tests simulate a store build
 * WITHOUT a native rebuild via {@link setAppVariantForTests}. This is the seam
 * V2–V4 build on; see `src/config/__tests__/appVariant.test.ts`.
 */

import Config from 'react-native-config';

/** The distribution variant of the running build. */
export type AppVariant = 'store' | 'full';

/** Test-only override; `null` restores the build-time (native) value. */
let testOverride: AppVariant | null = null;

/**
 * The distribution variant for this build. Synchronous — callers read it at
 * call time (mirrors `getAppChannel` / `isEngineApiDataLayerEnabled`).
 */
export function getAppVariant(): AppVariant {
  if (testOverride !== null) return testOverride;
  const raw = String(Config?.APP_VARIANT ?? '').toLowerCase();
  return raw === 'store' ? 'store' : 'full';
}

/** True for store-listing builds (Play / App Store). */
export function isStoreVariant(): boolean {
  return getAppVariant() === 'store';
}

/** True for self-built / sideload builds (the default). */
export function isFullVariant(): boolean {
  return getAppVariant() === 'full';
}

/**
 * TEST ONLY — force the active variant (pass `null` to restore the build-time
 * value). Module-level, in-memory: lets a unit test exercise store-variant
 * gating without rebuilding the native app. Always reset in `afterEach`.
 */
export function setAppVariantForTests(variant: AppVariant | null): void {
  testOverride = variant;
}
