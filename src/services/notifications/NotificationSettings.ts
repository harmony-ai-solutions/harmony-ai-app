/**
 * NotificationSettings — the single source of truth for the app's outreach
 * notification preferences (plan 7-12 §2/§4d, §5).
 *
 * Two values, both persisted in AsyncStorage under the app's reserved
 * `@soulbits_setting_*` key convention (mirrors SettingsScreen's toggles +
 * `BiometricLockService`):
 *
 *   - `notification_transport: auto | direct | cloud | off` (default `auto`).
 *     In THIS phase the enforced effect is: `off` silences all local/in-app
 *     notifications; the other three allow them. The direct/cloud distinction
 *     becomes meaningful in steps 5/7 (wake relay + Firebase) — those agents
 *     read this SAME module.
 *   - "Hide content on lock screen" (default OFF = preview shown). When ON,
 *     local notification bodies use generic text instead of `body_preview`;
 *     in-app rendering is unaffected. Later steps (wake-relay composer) read
 *     this SAME preference.
 *
 * Values are cached in memory after the first read and kept current by the
 * setters, so a per-event read (the events-WS path) never hits AsyncStorage
 * more than once per process (best-effort: a storage failure falls back to the
 * default and never throws).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createLogger } from '../../utils/logger';

const log = createLogger('[NotificationSettings]');

/** The user-facing transport preference (plan 7-12 §5). */
export type NotificationTransport = 'auto' | 'direct' | 'cloud' | 'off';

/** AsyncStorage key for {@link NotificationTransport}. */
export const NOTIFICATION_TRANSPORT_KEY = '@soulbits_setting_notification_transport';
/** AsyncStorage key for the "hide content on lock screen" toggle. */
export const NOTIFICATION_HIDE_CONTENT_KEY = '@soulbits_setting_notification_hide_content';

/** Default transport — never force a path; `auto` picks the best available. */
export const DEFAULT_NOTIFICATION_TRANSPORT: NotificationTransport = 'auto';
/** Default lock-screen behavior — show the message preview. */
export const DEFAULT_HIDE_CONTENT_ON_LOCK_SCREEN = false;

const TRANSPORTS: readonly NotificationTransport[] = ['auto', 'direct', 'cloud', 'off'];

/** Type guard for a stored/parsed transport value. */
export function isNotificationTransport(value: unknown): value is NotificationTransport {
  return typeof value === 'string' && (TRANSPORTS as readonly string[]).includes(value);
}

let cachedTransport: NotificationTransport | null = null;
let cachedHideContent: boolean | null = null;

/** The current transport preference (default `auto`). Never throws. */
export async function getNotificationTransport(): Promise<NotificationTransport> {
  if (cachedTransport !== null) return cachedTransport;
  try {
    const raw = await AsyncStorage.getItem(NOTIFICATION_TRANSPORT_KEY);
    cachedTransport = isNotificationTransport(raw) ? raw : DEFAULT_NOTIFICATION_TRANSPORT;
  } catch (e) {
    log.warn('getNotificationTransport failed; defaulting to auto', e);
    cachedTransport = DEFAULT_NOTIFICATION_TRANSPORT;
  }
  return cachedTransport;
}

/** Persist the transport preference (updates the in-memory cache first). */
export async function setNotificationTransport(value: NotificationTransport): Promise<void> {
  cachedTransport = value;
  try {
    await AsyncStorage.setItem(NOTIFICATION_TRANSPORT_KEY, value);
  } catch (e) {
    log.warn('setNotificationTransport failed', e);
  }
}

/** Whether lock-screen bodies hide content (default OFF = preview shown). */
export async function getHideContentOnLockScreen(): Promise<boolean> {
  if (cachedHideContent !== null) return cachedHideContent;
  try {
    const raw = await AsyncStorage.getItem(NOTIFICATION_HIDE_CONTENT_KEY);
    cachedHideContent = raw === 'true';
  } catch (e) {
    log.warn('getHideContentOnLockScreen failed; defaulting to preview', e);
    cachedHideContent = DEFAULT_HIDE_CONTENT_ON_LOCK_SCREEN;
  }
  return cachedHideContent;
}

/** Persist the lock-screen hide-content preference (updates the cache first). */
export async function setHideContentOnLockScreen(value: boolean): Promise<void> {
  cachedHideContent = value;
  try {
    await AsyncStorage.setItem(NOTIFICATION_HIDE_CONTENT_KEY, value ? 'true' : 'false');
  } catch (e) {
    log.warn('setHideContentOnLockScreen failed', e);
  }
}

/** Prime the in-memory cache (best-effort; used by the settings screen). */
export async function loadNotificationSettings(): Promise<{
  transport: NotificationTransport;
  hideContentOnLockScreen: boolean;
}> {
  const [transport, hideContentOnLockScreen] = await Promise.all([
    getNotificationTransport(),
    getHideContentOnLockScreen(),
  ]);
  return { transport, hideContentOnLockScreen };
}

/** Test-only: drop the cache so suites are order-independent. */
export function __resetNotificationSettingsForTests(): void {
  cachedTransport = null;
  cachedHideContent = null;
}

export default {
  getNotificationTransport,
  setNotificationTransport,
  getHideContentOnLockScreen,
  setHideContentOnLockScreen,
  loadNotificationSettings,
  isNotificationTransport,
};
