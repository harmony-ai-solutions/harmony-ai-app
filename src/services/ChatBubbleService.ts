/**
 * ChatBubbleService — JS wrapper around the native floating chat bubble.
 *
 * The native side (`ChatBubbleModule` / `ChatBubbleService` on Android)
 * renders a draggable avatar bubble over OTHER apps and brings the app to the
 * foreground when tapped, handoffing the conversation via a JS event
 * (`ChatBubble.open`) plus a static pending-conversation slot.
 *
 * This wrapper:
 *  - exposes a thin, promise-based API (isSupported / hasPermission /
 *    requestPermission / show / hide / cancelPendingBubble)
 *  - wires the `ChatBubble.open` device event so AppShell can navigate to the
 *    pending conversation even when the app was fully backgrounded
 *  - handles the Android overlay permission flow robustly: when the user taps
 *    "Open chat bubble" before the SYSTEM_ALERT_WINDOW permission is granted,
 *    the conversation is remembered and the bubble auto-shows the moment the
 *    user returns from the OS settings screen. A poll fallback re-checks the
 *    permission every few seconds so the promise never hangs and never gives
 *    up early while the user is still inside the settings screen.
 */

import {
  NativeModules,
  NativeEventEmitter,
  Platform,
  AppState,
} from 'react-native';
import { createLogger } from '../utils/logger';

const log = createLogger('[ChatBubbleService]');

export interface BubbleConversation {
  /** Interaction participant key — stable conversation identifier */
  participantKey: string;
  /** Interaction id (may be a temp UUIDv7 until the canonical one arrives) */
  interactionId: string;
  /** Partner entity id (empty for group chats) */
  entityId: string;
  /** The user's own (impersonated) entity id for this conversation */
  ownEntityId?: string;
  /** Display name shown in the bubble-open navigation */
  entityName?: string;
  /** Participant ids (used by ChatDetail to derive the session) */
  participantIds?: string[];
  /** Avatar as a data URL (used to paint the bubble) */
  avatar?: string | null;
}

const native = Platform.OS === 'android' ? NativeModules.ChatBubbleModule : null;

let emitter: NativeEventEmitter | null = null;
if (Platform.OS === 'android' && native) {
  emitter = new NativeEventEmitter(native as any);
}

type OpenListener = (conversation: BubbleConversation | null) => void;
const openListeners = new Set<OpenListener>();

if (emitter) {
  emitter.addListener('ChatBubble.open', (payload: any) => {
    const raw = payload?.conversation;
    log.info('ChatBubble.open event received');
    let conversation: BubbleConversation | null = null;
    if (typeof raw === 'string' && raw.length > 0) {
      try {
        conversation = JSON.parse(raw) as BubbleConversation;
      } catch (e) {
        log.error('Failed to parse bubble conversation payload:', e);
      }
    }
    openListeners.forEach(listener => listener(conversation));
  });
}

/**
 * Subscribe to bubble-open events (AppShell calls this to navigate).
 * Returns an unsubscribe function.
 */
export function onBubbleOpen(listener: OpenListener): () => void {
  openListeners.add(listener);
  return () => openListeners.delete(listener);
}

/** True when the platform supports the overlay bubble. */
export async function isBubbleSupported(): Promise<boolean> {
  if (!native) return false;
  try {
    return Boolean(await native.isSupported());
  } catch (e) {
    log.error('isSupported failed:', e);
    return false;
  }
}

/** True when the SYSTEM_ALERT_WINDOW overlay permission is granted. */
export async function hasBubblePermission(): Promise<boolean> {
  if (!native) return false;
  try {
    return Boolean(await native.hasPermission());
  } catch (e) {
    log.error('hasPermission failed:', e);
    return false;
  }
}

// ============================================================================
// Permission flow (native promise + AppState + poll fallback)
// ============================================================================

/** Pending conversation to show once the overlay permission is granted. */
let pendingPermissionConversation: BubbleConversation | null = null;
let permissionResolvers: Array<(granted: boolean) => void> = [];
let appStateSubscriber: { remove(): void } | null = null;
let permissionPoll: ReturnType<typeof setInterval> | null = null;

function notifyPermissionChange(granted: boolean): void {
  const resolvers = permissionResolvers;
  permissionResolvers = [];
  resolvers.forEach(resolve => resolve(granted));
}

function cleanupAppStateSubscriber(): void {
  if (appStateSubscriber) {
    appStateSubscriber.remove();
    appStateSubscriber = null;
  }
}

function stopPermissionPoll(): void {
  if (permissionPoll) {
    clearInterval(permissionPoll);
    permissionPoll = null;
  }
}

/**
 * Resolve the pending permission request and tear down all fallback paths.
 * Every grant-detection path (native promise, AppState, poll) funnels here.
 */
function resolvePermission(granted: boolean): void {
  if (granted) {
    // Auto-show the pending conversation (if any) — the user's "Open chat
    // bubble" tap must always end with a visible bubble.
    const conversation = pendingPermissionConversation;
    pendingPermissionConversation = null;
    if (conversation) {
      showBubble(conversation).then(shown => {
        cleanupAppStateSubscriber();
        stopPermissionPoll();
        notifyPermissionChange(shown);
      });
      return;
    }
  }
  cleanupAppStateSubscriber();
  stopPermissionPoll();
  notifyPermissionChange(granted);
}

/**
 * Watch for the user returning from the OS overlay-permission settings
 * screen. Once they return, re-check the permission and resolve.
 */
function subscribeToPermissionReturn(): void {
  if (appStateSubscriber) return;
  let wasBackgrounded = false;
  appStateSubscriber = AppState.addEventListener('change', (state) => {
    if (state === 'background') {
      wasBackgrounded = true;
    } else if (state === 'active' && wasBackgrounded) {
      wasBackgrounded = false;
      // The user is back from the OS overlay-permission screen — wait a beat
      // for the OS to finalize the toggle, then re-check.
      setTimeout(() => {
        hasBubblePermission().then(resolvePermission);
      }, 400);
    }
  });
}

/**
 * Request the overlay permission. Resolves true when already granted or when
 * the user grants it in the OS settings screen; resolves false when denied.
 *
 * Three independent resolution paths are raced so it NEVER hangs and NEVER
 * gives up while the user is still inside the settings screen:
 *   1. the native bridge promise (resolved by the module's onActivityResult)
 *   2. the AppState listener (fires when the user returns from settings)
 *   3. a poll that re-checks every 3s until granted or 60s elapse
 */
export async function requestBubblePermission(): Promise<boolean> {
  if (!native) return false;
  const already = await hasBubblePermission();
  if (already) return true;

  subscribeToPermissionReturn();

  return new Promise<boolean>(resolve => {
    permissionResolvers.push(resolve);

    // Path 1: native bridge (resolves via onActivityResult on most devices).
    native.requestPermission().then(
      (granted: boolean) => resolvePermission(Boolean(granted)),
      () => { /* the poll + AppState paths still cover this */ },
    );

    // Path 3: poll fallback — re-check every 3s until granted or 60s elapse.
    let elapsed = 0;
    permissionPoll = setInterval(() => {
      elapsed += 3000;
      hasBubblePermission().then(granted => {
        if (granted || elapsed >= 60000) resolvePermission(granted);
      });
    }, 3000);
  });
}

/**
 * Show the floating bubble for a conversation. Requires the overlay
 * permission (call hasBubblePermission / requestBubblePermission first).
 * When the permission is missing, the conversation is remembered and the
 * bubble auto-shows once the user grants permission and returns.
 */
export async function showBubble(
  conversation: BubbleConversation,
): Promise<boolean> {
  if (!native) return false;
  const supported = await isBubbleSupported();
  if (!supported) return false;
  const granted = await hasBubblePermission();
  if (!granted) {
    // Remember the conversation — the AppState listener re-shows it once the
    // user grants the overlay permission in the OS settings screen.
    pendingPermissionConversation = conversation;
    return false;
  }
  try {
    native.show(JSON.stringify(conversation));
    log.info(`Bubble shown for ${conversation.entityName ?? conversation.participantKey}`);
    return true;
  } catch (e) {
    log.error('showBubble failed:', e);
    return false;
  }
}

/** Forget any pending bubble conversation (e.g. the user declined). */
export function cancelPendingBubble(): void {
  pendingPermissionConversation = null;
  cleanupAppStateSubscriber();
  notifyPermissionChange(false);
}

/** Hide/remove the floating bubble. */
export async function hideBubble(): Promise<void> {
  if (!native) return;
  try {
    native.hide();
  } catch (e) {
    log.error('hideBubble failed:', e);
  }
}

export default {
  onBubbleOpen,
  isBubbleSupported,
  hasBubblePermission,
  requestBubblePermission,
  showBubble,
  hideBubble,
  cancelPendingBubble,
};
