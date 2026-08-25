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
 *    user returns from the OS settings screen. A fast grace poll keeps
 *    re-checking the permission for several seconds after the user returns
 *    (many devices apply the "display over other apps" toggle asynchronously),
 *    and a slower poll fallback runs the whole time — so the promise never
 *    hangs and never gives up early while the user is still inside settings.
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

/**
 * Conversations currently shown as floating bubbles, keyed by participantKey
 * (insertion order = stack order, top → bottom). The native side enforces a
 * max of 4 — when the stack is full the oldest bubble is auto-replaced.
 */
const activeBubbleConversations = new Map<string, BubbleConversation>();

/** Get the most recently shown floating bubble conversation (legacy). */
export function getActiveBubbleConversation(): BubbleConversation | null {
  const values = [...activeBubbleConversations.values()];
  return values.length > 0 ? values[values.length - 1] : null;
}

/** Get ALL conversations currently shown as floating bubbles (stack order). */
export function getActiveBubbleConversations(): BubbleConversation[] {
  return [...activeBubbleConversations.values()];
}

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

// ── Background handling ────────────────────────────────────────────────
// The floating chat window is a second React surface hosted by the SAME
// ReactHost as the main activity. When the activity goes to background RN
// pauses ALL surfaces on that host — including the overlay — freezing it on
// whatever frame it shows (e.g. the loading spinner). It only resumes when
// the user returns, which is why the window appears "stuck loading forever"
// while the app is backgrounded.
//
// The correct UX: close the floating WINDOW when the app backgrounds. The
// bubble itself stays visible (native overlay, independent of React) and can
// be tapped again to reopen the window on return.
if (Platform.OS === 'android') {
  AppState.addEventListener('change', (state) => {
    if (state === 'background') {
      log.info('App backgrounded — closing floating chat window (bubble stays).');
      closeBubbleWindow();
    }
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

interface PermissionRequest {
  promise: Promise<boolean>;
  resolve: (granted: boolean) => void;
}

/**
 * Single in-flight permission request. A new tap while one is pending reuses
 * the same request instead of spawning duplicate flows/pollers.
 */
let activePermissionRequest: PermissionRequest | null = null;
let appStateSubscriber: { remove(): void } | null = null;
let permissionPoll: ReturnType<typeof setInterval> | null = null;
/** Fast grace poll started when the user returns from the OS settings screen. */
let permissionReturnPoll: ReturnType<typeof setInterval> | null = null;
let permissionReturnPollElapsed = 0;

const PERMISSION_POLL_INTERVAL_MS = 3000;
const PERMISSION_TIMEOUT_MS = 60000;
/** Fast re-check cadence while the user just returned from overlay settings. */
const PERMISSION_RETURN_POLL_INTERVAL_MS = 300;
/** How long the fast grace poll keeps checking after the user returns. */
const PERMISSION_RETURN_GRACE_MS = 10000;

function stopPermissionFlow(): void {
  if (appStateSubscriber) {
    appStateSubscriber.remove();
    appStateSubscriber = null;
  }
  if (permissionPoll) {
    clearInterval(permissionPoll);
    permissionPoll = null;
  }
  if (permissionReturnPoll) {
    clearInterval(permissionReturnPoll);
    permissionReturnPoll = null;
    permissionReturnPollElapsed = 0;
  }
}

/**
 * Resolve the in-flight permission request and tear down all fallback paths.
 * Every grant-detection path (native fast-path, AppState, poll) funnels here.
 */
function settlePermissionRequest(granted: boolean): void {
  const request = activePermissionRequest;
  activePermissionRequest = null;
  stopPermissionFlow();
  request?.resolve(granted);
}

/**
 * Re-check the overlay permission. Called from every grant-detection path.
 * When granted, the pending conversation (if any) is auto-shown and the
 * request settles — the user's "Open chat bubble" tap must always end with
 * a visible bubble.
 *
 * A transient bubble-show failure is deliberately decoupled from the
 * permission verdict: it must NOT resolve the request false (which would
 * surface the misleading "overlay permission required" toast). Instead the
 * conversation stays pending and a later poll attempt retries the show.
 */
function recheckOverlayPermission(): void {
  hasBubblePermission().then(granted => {
    if (!activePermissionRequest) return;
    if (!granted) return;
    const conversation = pendingPermissionConversation;
    if (conversation) {
      showBubble(conversation).then(shown => {
        if (!activePermissionRequest) return;
        if (shown) {
          pendingPermissionConversation = null;
          settlePermissionRequest(true);
        } else {
          log.warn(
            'Bubble show failed even though overlay permission is granted; retrying on next poll.',
          );
        }
      });
    } else {
      settlePermissionRequest(true);
    }
  });
}

/**
 * Watch for the user returning from the OS overlay-permission settings
 * screen. Once they return, run a fast grace poll that keeps re-checking the
 * permission for a few seconds.
 *
 * Many devices apply the "display over other apps" toggle asynchronously, so
 * a single post-return check can miss a correctly-granted permission and
 * wrongly resolve the request false. As soon as the grant is observed, the
 * pending conversation auto-shows and the request settles true. If the grace
 * window elapses without a grant, the request settles false (no need to wait
 * for the full 60s timeout).
 */
function subscribeToPermissionReturn(): void {
  if (appStateSubscriber) return;
  let wasBackgrounded = false;
  appStateSubscriber = AppState.addEventListener('change', (state) => {
    if (state === 'background') {
      wasBackgrounded = true;
    } else if (state === 'active' && wasBackgrounded) {
      wasBackgrounded = false;
      if (permissionReturnPoll) clearInterval(permissionReturnPoll);
      permissionReturnPollElapsed = 0;
      permissionReturnPoll = setInterval(() => {
        permissionReturnPollElapsed += PERMISSION_RETURN_POLL_INTERVAL_MS;
        recheckOverlayPermission();
        if (permissionReturnPollElapsed >= PERMISSION_RETURN_GRACE_MS) {
          // The user returned without granting (or the device never applied
          // the toggle) — settle false instead of hanging forever.
          settlePermissionRequest(false);
        }
      }, PERMISSION_RETURN_POLL_INTERVAL_MS);
    }
  });
}

/**
 * Request the overlay permission. Resolves true when already granted or when
 * the user grants it in the OS settings screen; resolves false when the user
 * returns without granting (or the timeout elapses).
 *
 * Resolution paths are raced so the promise NEVER hangs and NEVER resolves
 * false while the user is still inside the settings screen:
 *   1. native bridge promise — FAST PATH that only resolves TRUE (on some
 *      devices onActivityResult fires — e.g. RESULT_CANCELED — before the OS
 *      toggle is applied; resolving false from native would wrongly tear down
 *      the recovery paths below while the user is still in settings)
 *   2. AppState listener — fires when the user returns from settings
 *   3. a poll that re-checks every 3s until granted or 60s elapse
 */
export async function requestBubblePermission(): Promise<boolean> {
  if (!native) {
    log.error('ChatBubbleModule unavailable — cannot request overlay permission.');
    return false;
  }
  const already = await hasBubblePermission();
  if (already) return true;
  // Reuse an in-flight request so rapid taps don't spawn duplicate flows.
  if (activePermissionRequest) return activePermissionRequest.promise;

  let resolveRequest!: (granted: boolean) => void;
  const promise = new Promise<boolean>(resolve => {
    resolveRequest = resolve;
  });
  activePermissionRequest = { promise, resolve: resolveRequest };

  subscribeToPermissionReturn();

  // Path 1: native bridge (resolves true via onActivityResult on most devices).
  native.requestPermission().then(
    (granted: boolean) => {
      if (granted) recheckOverlayPermission();
    },
    () => { /* the poll + AppState paths still cover this */ },
  );

  // Path 3: poll fallback — re-check every 3s until granted or 60s elapse.
  let elapsed = 0;
  permissionPoll = setInterval(() => {
    elapsed += PERMISSION_POLL_INTERVAL_MS;
    recheckOverlayPermission();
    if (elapsed >= PERMISSION_TIMEOUT_MS) {
      settlePermissionRequest(false);
    }
  }, PERMISSION_POLL_INTERVAL_MS);

  return promise;
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
  if (!native) {
    log.error('ChatBubbleModule unavailable — cannot show the bubble.');
    return false;
  }
  const supported = await isBubbleSupported();
  if (!supported) {
    log.warn('Floating bubble is not supported on this platform/OS version.');
    return false;
  }
  const granted = await hasBubblePermission();
  if (!granted) {
    // Remember the conversation — the AppState listener re-shows it once the
    // user grants the overlay permission in the OS settings screen.
    log.info(
      `Overlay permission not granted for ${conversation.entityName ?? conversation.participantKey}; ` +
        'conversation queued for auto-show on grant.',
    );
    pendingPermissionConversation = conversation;
    return false;
  }
  try {
    activeBubbleConversations.set(conversation.participantKey, conversation);
    // D1-4: native show() resolves a REAL boolean (canDrawOverlays + try/catch
    // in ChatBubbleModule.kt) — the `result === false` check is live again.
    const result = await native.show(JSON.stringify(conversation));
    if (result === false) {
      // Native refused to start the bubble service (missing overlay
      // permission, or a foreground-service start failure such as the
      // Android 12+ background-start policy) — this is NOT necessarily a
      // permission problem, so callers can retry without treating it as a
      // permission denial.
      log.warn(
        `Native show() returned false for ${conversation.entityName ?? conversation.participantKey}; ` +
          'bubble was not displayed.',
      );
      return false;
    }
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
  settlePermissionRequest(false);
}

/**
 * Hide/remove floating bubble(s). When a participantKey is given, only that
 * bubble is removed; otherwise ALL bubbles are hidden (service stops).
 */
export async function hideBubble(participantKey?: string): Promise<void> {
  if (!native) {
    log.warn('ChatBubbleModule unavailable — nothing to hide.');
    activeBubbleConversations.clear();
    return;
  }
  try {
    if (participantKey) {
      activeBubbleConversations.delete(participantKey);
      (native as any).hideOne(participantKey);
    } else {
      activeBubbleConversations.clear();
      native.hide();
    }
  } catch (e) {
    log.error('hideBubble failed:', e);
  }
}

/**
 * Close only the floating chat window — the bubble itself stays visible and
 * can be tapped again to reopen the window. No-op when the window isn't open.
 */
export function closeBubbleWindow(): void {
  if (!native || typeof (native as any).closeWindow !== 'function') {
    return;
  }
  try {
    (native as any).closeWindow();
  } catch (e) {
    log.error('closeWindow failed:', e);
  }
}

/**
 * Update the unread badge count shown on ONE floating bubble. Call this when
 * new messages arrive while the bubble is visible. participantKey selects the
 * bubble; when omitted the (legacy) single bubble is targeted.
 */
export async function setBubbleUnreadCount(
  count: number,
  participantKey?: string,
): Promise<void> {
  if (!native || typeof (native as any).setUnreadCount !== 'function') {
    return;
  }
  try {
    (native as any).setUnreadCount(Math.max(0, count), participantKey ?? null);
  } catch (e) {
    log.error('setUnreadCount failed:', e);
  }
}

export default {
  onBubbleOpen,
  isBubbleSupported,
  hasBubblePermission,
  requestBubblePermission,
  showBubble,
  hideBubble,
  closeBubbleWindow,
  cancelPendingBubble,
  setBubbleUnreadCount,
  getActiveBubbleConversation,
  getActiveBubbleConversations,
};
