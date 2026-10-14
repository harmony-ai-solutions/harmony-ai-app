/**
 * appChannel — the distribution channel for this build (plan 7-10 §4/§8,
 * DERIVED from APP_VARIANT per plan 7-14 ruling 3).
 *
 * `REQUEST_INSTALL_PACKAGES` (needed for the in-app APK self-update) is
 * Play-review-sensitive, so the self-update flow is shown ONLY on the
 * `sideload` channel (and only on Android). As of 7-14 there is no separate
 * `APP_CHANNEL` input anymore — `APP_VARIANT` replaces and derives it:
 *
 *   - `store` variant (Play / App Store listing) → `play`  — the listing owns
 *     updates; the in-app APK self-updater is OFF.
 *   - `full`  variant (self-built / sideload)     → `sideload` — the in-app APK
 *     self-update IS the update mechanism.
 *
 * A store build therefore never offers the APK self-update even if some stale
 * channel value is injected. `APP_ENV` (dev/prod cloud host) stays orthogonal
 * and does not affect this.
 */

import { Platform } from 'react-native';
import { isStoreVariant } from './appVariant';

export type AppChannel = 'sideload' | 'play';

/** The distribution channel for this build (derived from {@link AppVariant}). */
export function getAppChannel(): AppChannel {
  return isStoreVariant() ? 'play' : 'sideload';
}

/** True when the in-app APK self-update flow may be offered (Android sideload). */
export function isApkSelfUpdateAvailable(): boolean {
  return Platform.OS === 'android' && getAppChannel() === 'sideload';
}
