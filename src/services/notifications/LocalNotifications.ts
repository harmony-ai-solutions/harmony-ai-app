/**
 * LocalNotifications — the JS wrapper around the native local-notification
 * posting surfaces (plan 7-12 §4a/§4b).
 *
 * One bridge name on both platforms (`NativeModules.SoulbitsNotifications`):
 *   - iOS  → `ios/Notifications/SoulbitsNotificationsModule.m` (extended this
 *     phase with `postLocalNotification`; the permission wrapper already lives
 *     there and is consumed by `NotificationPermission.ts`).
 *   - Android → `android/.../notifications/NotificationsModule.kt` (new this
 *     phase; `getName()` returns the same `SoulbitsNotifications`).
 *
 * The module is absent off-device / in a bare jest run, so every function is a
 * safe no-op returning `false` — callers never branch on the module's presence.
 *
 * ## Dedupe
 *
 * `messageId` is passed through to the native side, which uses it as the
 * platform's replace-key (iOS request identifier / Android notification tag),
 * so a re-post for the same message REPLACES rather than stacks. The
 * client-side `message_id` short-window check lives in `outreachDedupe.ts`.
 */

import { NativeModules } from 'react-native';
import { createLogger } from '../../utils/logger';

const log = createLogger('[LocalNotifications]');

/** What to post. `messageId` is the stable replace-key; `entityId` groups. */
export interface LocalNotificationPayload {
  title: string;
  body: string;
  /** entity_id — iOS `threadIdentifier` / Android notification group. */
  entityId: string;
  /** message_id — iOS request identifier / Android tag (dedupe-by-replace). */
  messageId: string;
}

/** The native module surface this wrapper needs. */
export interface LocalNotificationsBridge {
  postLocalNotification(options: {
    title: string;
    body: string;
    entityId: string;
    messageId: string;
  }): Promise<boolean>;
}

function getBridge(): LocalNotificationsBridge | null {
  const mod = (NativeModules as Record<string, unknown>).SoulbitsNotifications as
    | Partial<LocalNotificationsBridge>
    | undefined;
  if (!mod || typeof mod.postLocalNotification !== 'function') return null;
  return mod as LocalNotificationsBridge;
}

/** True when the native local-notification bridge is available on this build. */
export function isLocalNotificationsSupported(): boolean {
  return getBridge() !== null;
}

/**
 * Post a local OS notification. Resolves `true` when the native side accepted
 * it. Never throws — a missing bridge or a native error resolves `false`.
 */
export async function postLocalNotification(
  payload: LocalNotificationPayload,
): Promise<boolean> {
  const bridge = getBridge();
  if (!bridge) return false;
  if (!payload || !payload.messageId) return false;
  try {
    return Boolean(
      await bridge.postLocalNotification({
        title: payload.title ?? '',
        body: payload.body ?? '',
        entityId: payload.entityId ?? '',
        messageId: payload.messageId,
      }),
    );
  } catch (e) {
    log.warn('postLocalNotification failed', e);
    return false;
  }
}

export default {
  isLocalNotificationsSupported,
  postLocalNotification,
};
