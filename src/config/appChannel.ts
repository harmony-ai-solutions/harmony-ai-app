/**
 * appChannel — the distribution channel for this build (plan 7-10 §4/§8).
 *
 * `REQUEST_INSTALL_PACKAGES` (needed for the in-app APK self-update) is
 * Play-review-sensitive, so the self-update flow is shown ONLY on the
 * `sideload` channel (and only on Android). The Play-vs-sideload decision is an
 * explicit 7-10 OWNER GATE; until it is made the default is conservative:
 *
 *   - `APP_CHANNEL` (react-native-config, injected per flavour) wins;
 *   - otherwise dev builds → `sideload` (so the flow is testable on device);
 *   - otherwise (prod) → `play` (self-update hidden).
 */

import { Platform } from 'react-native';
import Config from 'react-native-config';

export type AppChannel = 'sideload' | 'play';

/** The distribution channel for this build. */
export function getAppChannel(): AppChannel {
  const raw = String((Config as { APP_CHANNEL?: string } | undefined)?.APP_CHANNEL ?? '').toLowerCase();
  if (raw === 'play' || raw === 'sideload') return raw;
  return __DEV__ ? 'sideload' : 'play';
}

/** True when the in-app APK self-update flow may be offered (Android sideload). */
export function isApkSelfUpdateAvailable(): boolean {
  return Platform.OS === 'android' && getAppChannel() === 'sideload';
}
