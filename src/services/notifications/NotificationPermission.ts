/**
 * NotificationPermission — notification-authorization service (task 5-1
 * add-on; Android parity added by the plan 7-12 §4 addendum).
 *
 * The app registers for **remote** notifications natively (silent pushes +
 * device token) but must also ask for **display** authorization, or the 4-4
 * relay's visible banners are dropped. This service wraps the native
 * `SoulbitsNotifications` module — one bridge name on both platforms:
 *   - iOS  → `ios/Notifications/SoulbitsNotificationsModule.m`
 *     (`UNUserNotificationCenter` authorization).
 *   - Android → `android/.../notifications/NotificationsModule.kt`
 *     (`POST_NOTIFICATIONS` runtime grant on API 33+; implicit before that).
 *
 * So a screen can request authorization at the natural point (the Settings →
 * Push notifications toggle) and degrade gracefully when the user denies it.
 * The call is platform-agnostic: on Android the module maps the binary
 * grant/deny onto the same lowercase union, and below API 33 resolves
 * `authorized` (the grant is implicit there).
 *
 * On any other platform, or when the native module is absent (e.g. a bare jest
 * run), every function is a safe no-op returning `'unavailable'`.
 */

import { NativeModules, Platform } from 'react-native';
import { createLogger } from '../../utils/logger';

const log = createLogger('[NotificationPermission]');

/** Lowercase authorization status, mirroring the native modules' strings. */
export type NotificationAuthorizationStatus =
  | 'authorized'
  | 'provisional'
  | 'ephemeral'
  | 'denied'
  | 'notDetermined'
  /** The native module is unavailable (unsupported platform / not linked). */
  | 'unavailable';

/** The native module surface (`NativeModules.SoulbitsNotifications`). */
export interface NotificationPermissionBridge {
  requestAuthorization(): Promise<NotificationAuthorizationStatus>;
  getAuthorizationStatus(): Promise<NotificationAuthorizationStatus>;
}

function getBridge(): NotificationPermissionBridge | null {
  // Both mobile platforms expose the `SoulbitsNotifications` bridge (iOS
  // UNUserNotificationCenter authorization; Android POST_NOTIFICATIONS).
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
  const mod = (NativeModules as Record<string, unknown>).SoulbitsNotifications as
    | Partial<NotificationPermissionBridge>
    | undefined;
  if (!mod || typeof mod.requestAuthorization !== 'function') return null;
  return mod as NotificationPermissionBridge;
}

/** True when the native authorization bridge is available on this platform. */
export function isNotificationPermissionSupported(): boolean {
  return getBridge() !== null;
}

/**
 * Read the current authorization status without prompting. Never throws — an
 * error surfaces as `'unavailable'` so callers can render a safe default.
 */
export async function getNotificationAuthorizationStatus(): Promise<NotificationAuthorizationStatus> {
  const bridge = getBridge();
  if (!bridge) return 'unavailable';
  try {
    return await bridge.getAuthorizationStatus();
  } catch (e) {
    log.warn('getAuthorizationStatus failed', e);
    return 'unavailable';
  }
}

/**
 * Request full notification authorization (alert + sound + badge) so visible
 * banners can display. Never throws — a denied prompt or a missing module
 * resolves to a status the caller can act on.
 */
export async function requestNotificationPermission(): Promise<NotificationAuthorizationStatus> {
  const bridge = getBridge();
  if (!bridge) return 'unavailable';
  try {
    return await bridge.requestAuthorization();
  } catch (e) {
    log.warn('requestAuthorization failed', e);
    return 'unavailable';
  }
}

/** True when the status permits visible banners (provisional is quiet but shows in Notification Center). */
export function isNotificationAuthorized(status: NotificationAuthorizationStatus): boolean {
  return status === 'authorized' || status === 'provisional' || status === 'ephemeral';
}
