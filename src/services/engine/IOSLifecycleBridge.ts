/**
 * IOSLifecycleBridge — the JS side of the iOS blind-tick lifecycle (task 4-3).
 *
 * Registered once at boot (`index.js`), it wires the native coordinator's OS
 * wakes to the app's orchestrators and the APNs device token to device
 * registration:
 *
 *   - `engine:wake` (kind `keepalive` | `relay`) → {@link handleIOSLifecycleWake}
 *     (the bounded ~25 s silent-push pass);
 *   - `engine:wake` (kind `maintenance`)         → {@link handleIOSMaintenance}
 *     (the overnight deep sweep);
 *   - `push:token`                               → the notification service +
 *     the backend device row (so the 4-4 keepalive cron has a token to push to).
 *
 * After the pass the bridge calls `finishWake(taskId, resultJSON)` so the native
 * side ends its background assertion and always calls the OS completion handler
 * (step 2 expiration discipline).
 *
 * A background launch can deliver the wake before the bridge boots; the native
 * side queues it and the bridge drains it via `consumePendingWake` on attach.
 *
 * Off iOS (or without the engine module) this is a no-op.
 */

import { Platform } from 'react-native';
import { createLogger } from '../../utils/logger';
import {
  consumePendingEngineWake,
  consumePendingPushToken,
  finishEngineWake,
  onEngineWake,
  onPushToken,
} from './EngineEmbeddedModule';
import type { EngineWakeEvent } from './EngineEmbeddedModule';
import { handleIOSLifecycleWake } from './IOSLifecycleWakeHandler';
import { handleIOSMaintenance } from './IOSMaintenanceScheduler';
import notificationService from '../social/NotificationService';
import DeviceAuthService from '../cloud/DeviceAuthService';
import { pushTokenStore } from '../notifications/PushTokenStore';

const log = createLogger('[IOSLifecycleBridge]');

/** Injectable seams (tests override). */
export interface IOSLifecycleBridgeDeps {
  /** The silent-push pass. Defaults to {@link handleIOSLifecycleWake}. */
  wake?: typeof handleIOSLifecycleWake;
  /** The overnight sweep. Defaults to {@link handleIOSMaintenance}. */
  maintenance?: typeof handleIOSMaintenance;
  /** Register the APNs token. Default: notification service + device row. */
  registerPushToken?: (token: string) => Promise<void>;
  /** Complete the native OS task. Defaults to `finishEngineWake`. */
  finish?: (taskId: string, resultJSON: string) => Promise<void>;
}

/** Production push-token registration: in-memory feed + backend device row. */
async function defaultRegisterPushToken(token: string): Promise<void> {
  // The token source is now the single-source-of-truth store: when step 7's
  // Firebase SDK has supplied an FCM registration token it WINS; the raw APNs
  // token handed in here is only the fallback (no Firebase in the build)
  // (plan 7-12 §3).
  const effective = pushTokenStore.getPushToken() ?? token;
  try {
    await notificationService.registerPushToken(effective);
  } catch (e) {
    log.warn('push-token notification registration failed (non-fatal):', e);
  }
  try {
    await DeviceAuthService.registerDevice({ pushToken: effective });
  } catch (e) {
    log.warn('push-token device registration failed (non-fatal):', e);
  }
}

let attached = false;
let unsubscribers: Array<() => void> = [];

/**
 * Route one wake to its orchestrator, then complete the native task. Never
 * throws (the result JSON carries any failure for telemetry/logging).
 */
export async function routeEngineWake(
  event: EngineWakeEvent,
  deps: IOSLifecycleBridgeDeps = {},
): Promise<void> {
  const finish = deps.finish ?? finishEngineWake;
  let resultJSON = '{}';
  try {
    if (event.kind === 'maintenance') {
      const result = await (deps.maintenance ?? handleIOSMaintenance)();
      resultJSON = JSON.stringify(result);
    } else {
      const result = await (deps.wake ?? handleIOSLifecycleWake)({
        kind: event.kind === 'relay' ? 'relay' : 'keepalive',
      });
      resultJSON = JSON.stringify(result);
    }
  } catch (e) {
    resultJSON = JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
    log.warn(`wake ${event.kind} failed:`, e instanceof Error ? e.message : String(e));
  } finally {
    await finish(event.taskId, resultJSON);
  }
}

/**
 * Register the iOS lifecycle bridge (idempotent). Returns an unsubscribe fn.
 * Off iOS it is a no-op.
 */
export function registerIOSLifecycleBridge(deps: IOSLifecycleBridgeDeps = {}): () => void {
  if (Platform.OS !== 'ios') return () => undefined;
  if (attached) return detachIOSLifecycleBridgeForTests;

  const registerPushToken = deps.registerPushToken ?? defaultRegisterPushToken;

  unsubscribers.push(
    onEngineWake(event => {
      void routeEngineWake(event, deps);
    }),
  );
  unsubscribers.push(
    onPushToken(event => {
      void registerPushToken(event.token);
    }),
  );

  // A background launch may have queued the wake before this subscription.
  void consumePendingEngineWake().then(pending => {
    if (pending) void routeEngineWake(pending, deps);
  });
  void consumePendingPushToken().then(token => {
    if (token) void registerPushToken(token);
  });

  attached = true;
  log.info('iOS lifecycle bridge registered');
  return detachIOSLifecycleBridgeForTests;
}

/** Detach the bridge (test-only; also the returned unsubscribe). */
export function detachIOSLifecycleBridgeForTests(): void {
  unsubscribers.forEach(u => u());
  unsubscribers = [];
  attached = false;
}
