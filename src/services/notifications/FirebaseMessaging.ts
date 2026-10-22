/**
 * FirebaseMessaging — the app-side Firebase Cloud Messaging integration
 * (plan 7-12 §3, step 7; D1=b + D2 + D4).
 *
 * ## Why
 *
 * The cloud's push sender is **FCM-v1-only**: it addresses *FCM registration
 * tokens*, which require the Firebase SDK **client-side**. Before this step the
 * app registered a raw APNs token, which FCM cannot address (plan 7-12
 * verified state 5), and Android registered no token at all (verified state 6).
 * This module acquires an FCM registration token on both platforms, writes it
 * into the single-source-of-truth {@link pushTokenStore} (with `'sdk'`
 * precedence over the raw-APNs fallback) and registers it with the cloud via
 * the existing `DeviceAuthService.registerDevice` flow.
 *
 * ## Runtime guarding (a FENCE, not a nice-to-have)
 *
 * React Native Firebase throws when its native module is not linked, and — on
 * a build that carries the *placeholder* `google-services.json` /
 * `GoogleService-Info.plist` (plan 7-12 §3; D4 self-builder contract) —
 * `getToken()` rejects against the dummy project. Every entry point here is
 * therefore guarded:
 *
 *   - the SDK is loaded through an injectable {@link FirebaseMessagingApi}
 *     loader whose default is a `try/catch` `require` (so a bare jest run or a
 *     build without the pods never throws at import time);
 *   - {@link FirebaseMessagingService.isAvailable} checks `getApps().length > 0`
 *     (Firebase not configured ⇒ no app ⇒ fall back);
 *   - `getToken()` is wrapped: on failure we simply keep the native seam token
 *     (`PushTokenStore` keeps working) and skip cloud registration of an FCM
 *     token. Graceful degradation, never a crash.
 *
 * ## Wire shapes (verified cloud/engine facts — plan 7-12 fact sheet)
 *
 *   - **Relay** (`POST /v1/lifecycle/notify` → FCM):
 *     `data = { kind:"relay", payload:"<JSON string>" }` where the payload blob
 *     is `{ kind:"outreach", entityId, messageId }`. The human-readable alert
 *     rides the OS-visible `notification` (title/body). → we PARSE
 *     `data.payload` to extract `messageId`.
 *   - **Engine-local** (custom-FCM path, topology A):
 *     `data = { entity_id, message_type, message_id, created_at }` — top-level
 *     `message_id`.
 *   - **Keepalive / blind-tick** (silent): `data = { kind:"keepalive" }`
 *     (+ `apns content-available` on iOS). These keep routing into the EXISTING
 *     native wake bridge — this module never re-enters the wake path, it only
 *     observes them.
 *
 * ## Message handling policy
 *
 *   - **Foreground** (`onMessage`): FCM suppresses the OS banner itself;
 *     the app owns the surface. Parse `messageId` → {@link outreachDedupe},
 *     then surface **in-app only** via the {@link FirebaseMessagingDeps.onInApp}
 *     seam.
 *   - **Background / killed**: an OS-visible `notification` is displayed by the
 *     OS (nothing to do but record the `message_id` for dedupe). A **data-only**
 *     outreach is posted as a local notification (the OS would not show it).
 *   - **Tap** (`onNotificationOpenedApp` / `getInitialNotification`) → the
 *     {@link FirebaseMessagingDeps.onNotificationOpened} seam, plus dedupe so
 *     the tapped message never re-notifies.
 *   - `notification_transport === 'off'` silences everything the app has
 *     discretion over (in-app + local posts). OS-displayed background pushes
 *     cannot be suppressed client-side — that is expected (plan 7-12 §3/§5).
 *
 * `message_id` is deduped through the SHARED {@link outreachDedupe} singleton so
 * a relay push, an engine-FCM push, a wake-relayed push and the events-WS path
 * can never double-notify the same outreach.
 *
 * Singleton — attach via {@link attachFirebaseMessaging} at boot (`index.js`).
 */

import { Platform } from 'react-native';
import { createLogger } from '../../utils/logger';
import { pushTokenStore } from './PushTokenStore';
import type { PushTokenStore } from './PushTokenStore';
import { outreachDedupe } from './outreachDedupe';
import type { OutreachDedupe } from './outreachDedupe';
import {
  getHideContentOnLockScreen,
  getNotificationTransport,
} from './NotificationSettings';
import type { NotificationTransport } from './NotificationSettings';
import { postLocalNotification } from './LocalNotifications';
import type { LocalNotificationPayload } from './LocalNotifications';
import {
  composeLocalNotification,
} from './OutreachNotificationService';
import type { OutreachNotificationEvent } from './OutreachNotificationService';
import DeviceAuthService from '../cloud/DeviceAuthService';
import notificationService from '../social/NotificationService';

const log = createLogger('[FirebaseMessaging]');

// ── Rollback knob (mirrors ENGINE_EMBEDDED_ENABLED) ──────────────────────
/** Build-time default. Flip to false (or call setFirebaseMessagingEnabled) to roll back. */
export const FIREBASE_MESSAGING_ENABLED = true;
let enabledOverride: boolean | null = null;

/** True when the Firebase messaging integration is enabled (rollback knob). */
export function isFirebaseMessagingEnabled(): boolean {
  return enabledOverride ?? FIREBASE_MESSAGING_ENABLED;
}

/** Runtime override for the feature flag (pass null to restore the default). */
export function setFirebaseMessagingEnabled(enabled: boolean | null): void {
  enabledOverride = enabled;
}

// ── The RNFB surface (structural, so it can be faked in tests) ───────────

/**
 * A subset of `RemoteMessage` — only the fields this service reads. Note the
 * top-level `messageId` is the *FCM* id; the OUTREACH `message_id` lives in
 * `data` (see {@link parsePushMessage}).
 */
export interface RemoteMessageLike {
  messageId?: string;
  from?: string;
  sentTime?: number;
  data?: Record<string, string | object>;
  notification?: { title?: string; body?: string };
  /** iOS: APNs background update flag. */
  contentAvailable?: boolean;
}

/**
 * The exact RNFB modular functions this service uses. Injectable so unit tests
 * never touch the native SDK.
 */
export interface FirebaseMessagingApi {
  getApps(): unknown[];
  getMessaging(app?: unknown): unknown;
  getToken(messaging: unknown, options?: unknown): Promise<string>;
  deleteToken?(messaging: unknown, options?: unknown): Promise<void>;
  onMessage(messaging: unknown, listener: (message: RemoteMessageLike) => unknown): () => void;
  onTokenRefresh(messaging: unknown, listener: (token: string) => unknown): () => void;
  onNotificationOpenedApp(
    messaging: unknown,
    listener: (message: RemoteMessageLike) => unknown,
  ): () => void;
  getInitialNotification(messaging: unknown): Promise<RemoteMessageLike | null>;
  setBackgroundMessageHandler(
    messaging: unknown,
    handler: (message: RemoteMessageLike) => Promise<unknown>,
  ): void;
}

/**
 * Load the RNFB modular API. The default is a guarded `require` so that:
 *   - a jest run / a build without the pods returns `null` (never throws), and
 *   - no native code is touched at module import time.
 *
 * Uses the **v26 modular API** — v26 removed the deprecated namespaced
 * `firebase.messaging()` / `messaging()` default export (plan 7-12 §3 named
 * `messaging().getToken()`; v26 is the latest RN 0.86-compatible release and
 * requires the new architecture, which this app enables).
 */
export function loadFirebaseMessagingApi(): FirebaseMessagingApi | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const appMod = require('@react-native-firebase/app');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const msgMod = require('@react-native-firebase/messaging');
    if (!appMod || typeof appMod.getApps !== 'function') return null;
    if (!msgMod || typeof msgMod.getMessaging !== 'function') return null;
    if (typeof msgMod.getToken !== 'function' || typeof msgMod.onMessage !== 'function') {
      return null;
    }
    return {
      getApps: appMod.getApps,
      getMessaging: msgMod.getMessaging,
      getToken: msgMod.getToken,
      deleteToken: msgMod.deleteToken,
      onMessage: msgMod.onMessage,
      onTokenRefresh: msgMod.onTokenRefresh,
      onNotificationOpenedApp: msgMod.onNotificationOpenedApp,
      getInitialNotification: msgMod.getInitialNotification,
      setBackgroundMessageHandler: msgMod.setBackgroundMessageHandler,
    };
  } catch (e) {
    log.warn('Firebase SDK unavailable (native module not linked):', e);
    return null;
  }
}

// ── Wire parsing ─────────────────────────────────────────────────────────

/** The classification of an incoming FCM payload. */
export type FirebasePushKind = 'relay' | 'engine' | 'keepalive' | 'unknown';

/** A parsed FCM payload, normalised across the two outreach shapes. */
export interface ParsedPushMessage {
  kind: FirebasePushKind;
  /** The OUTREACH `message_id` (relay payload / engine top-level), or null. */
  messageId: string | null;
  /** entity_id (relay payload / engine top-level), or null. */
  entityId: string | null;
  /** Engine `message_type` (engine shape only). */
  messageType: string | null;
  /** Engine `created_at` (engine shape only). */
  createdAt: string | null;
  /** True when the OS will display (or already displayed) a banner. */
  hasNotification: boolean;
  /** OS-visible title (relay alert), when present. */
  title: string | null;
  /** OS-visible body (relay alert), when present. */
  body: string | null;
  /** The original message (for seams that need it). */
  raw: RemoteMessageLike;
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') {
    const t = value.trim();
    return t ? t : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/** Parse a data value that may already be an object or a JSON string. */
function parseMaybeJson(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t) return null;
    try {
      const parsed = JSON.parse(t);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Normalise an FCM `RemoteMessage` into a {@link ParsedPushMessage}. Pure and
 * total (never throws) — unknown/short payloads classify as `'unknown'`.
 *
 * Order matters: keepalive → relay (payload blob) → engine (top-level
 * `message_id`) → unknown.
 */
export function parsePushMessage(message: RemoteMessageLike | null | undefined): ParsedPushMessage {
  const raw: RemoteMessageLike = message && typeof message === 'object' ? message : {};
  const data =
    raw.data && typeof raw.data === 'object' ? (raw.data as Record<string, unknown>) : {};
  const notification =
    raw.notification && typeof raw.notification === 'object' ? raw.notification : undefined;
  const hasNotification = Boolean(notification);
  const title = asString(notification?.title);
  const body = asString(notification?.body);

  const base = {
    messageId: null as string | null,
    entityId: null as string | null,
    messageType: null as string | null,
    createdAt: null as string | null,
    hasNotification,
    title,
    body,
    raw,
  };

  const kind = asString(data.kind);

  // Keepalive / blind-tick (silent) — the EXISTING native wake bridge handles
  // these; we only observe.
  if (kind === 'keepalive') {
    return { kind: 'keepalive', ...base };
  }

  // Relay push: the opaque payload blob carries the outreach messageId.
  const relayPayload = parseMaybeJson(data.payload);
  if (kind === 'relay' || relayPayload) {
    const messageId =
      asString(relayPayload?.messageId) ?? asString(relayPayload?.message_id);
    const entityId =
      asString(relayPayload?.entityId) ?? asString(relayPayload?.entity_id);
    if (messageId) {
      return { kind: 'relay', ...base, messageId, entityId };
    }
    // A relay envelope whose blob we could not read — nothing to dedupe on.
    return { kind: 'unknown', ...base };
  }

  // Engine-local (custom-FCM) shape: top-level message_id.
  const engineMessageId = asString(data.message_id);
  if (engineMessageId) {
    return {
      kind: 'engine',
      ...base,
      messageId: engineMessageId,
      entityId: asString(data.entity_id),
      messageType: asString(data.message_type),
      createdAt: asString(data.created_at),
    };
  }

  return { kind: 'unknown', ...base };
}

/** Build the local-OS-notification payload for a parsed push. */
export function composePushLocalNotification(
  parsed: ParsedPushMessage,
  hideContent: boolean,
): LocalNotificationPayload {
  const event: OutreachNotificationEvent = {
    type: 'outreach',
    entity_id: parsed.entityId ?? '',
    // The push carries no entity display name; the composer falls back to the
    // title / generic text.
    entity_name: (parsed.title ?? '').trim(),
    message_id: parsed.messageId ?? '',
    title: (parsed.title ?? '').trim(),
    body_preview: (parsed.body ?? '').trim(),
    created_at: parsed.createdAt ?? new Date().toISOString(),
    eligibility: 'eligible',
  };
  return composeLocalNotification(event, hideContent);
}

// ── Default cloud registration (existing flow) ───────────────────────────

/**
 * Register an FCM token with the cloud exactly as the raw-APNs flow did
 * (`IOSLifecycleBridge.defaultRegisterPushToken`): the in-memory notification
 * feed + the backend device row via `DeviceAuthService.registerDevice`. Never
 * throws (both legs are best-effort; a signed-out device has no row to update).
 */
export async function registerFcmTokenWithCloud(token: string): Promise<void> {
  const clean = (token ?? '').trim();
  if (!clean) return;
  try {
    await notificationService.registerPushToken(clean);
  } catch (e) {
    log.warn('push-token notification registration failed (non-fatal):', e);
  }
  try {
    await DeviceAuthService.registerDevice({ pushToken: clean });
  } catch (e) {
    log.warn('push-token device registration failed (non-fatal):', e);
  }
}

// ── Deps ─────────────────────────────────────────────────────────────────

export interface FirebaseMessagingDeps {
  /** RNFB loader (default {@link loadFirebaseMessagingApi}). */
  loadApi?: () => FirebaseMessagingApi | null;
  /** Token store (default the process-wide singleton). */
  store?: PushTokenStore;
  /** Cloud registration (default {@link registerFcmTokenWithCloud}). */
  registerWithCloud?: (token: string) => Promise<void>;
  /** Shared dedupe store (default the process-wide singleton). */
  dedupe?: OutreachDedupe;
  /** Transport preference reader (default NotificationSettings). */
  getTransport?: () => Promise<NotificationTransport>;
  /** Lock-screen hide-content reader (default NotificationSettings). */
  getHideContent?: () => Promise<boolean>;
  /** Local OS notification poster (default LocalNotifications). */
  postLocal?: (payload: LocalNotificationPayload) => Promise<boolean> | void;
  /** Foreground in-app surface (the app's existing unread/read path). */
  onInApp?: (parsed: ParsedPushMessage) => void;
  /** Silent keepalive/blind-tick observability seam (native wake owns routing). */
  onBackgroundWake?: (parsed: ParsedPushMessage) => void;
  /** Notification-tap seam (route into the app's existing open behavior). */
  onNotificationOpened?: (parsed: ParsedPushMessage) => void;
}

// ── Service ──────────────────────────────────────────────────────────────

export class FirebaseMessagingService {
  private readonly loadApi: () => FirebaseMessagingApi | null;
  private readonly store: PushTokenStore;
  private readonly registerWithCloud: (token: string) => Promise<void>;
  private readonly dedupe: OutreachDedupe;
  private readonly getTransport: () => Promise<NotificationTransport>;
  private readonly getHideContent: () => Promise<boolean>;
  private readonly postLocal: (payload: LocalNotificationPayload) => Promise<boolean> | void;
  private onInApp?: (parsed: ParsedPushMessage) => void;
  private onBackgroundWake?: (parsed: ParsedPushMessage) => void;
  private onNotificationOpened?: (parsed: ParsedPushMessage) => void;

  private api: FirebaseMessagingApi | null = null;
  private messaging: unknown = null;
  private started = false;
  private available = false;
  private unsubscribers: Array<() => void> = [];

  constructor(deps: FirebaseMessagingDeps = {}) {
    this.loadApi = deps.loadApi ?? loadFirebaseMessagingApi;
    this.store = deps.store ?? pushTokenStore;
    this.registerWithCloud = deps.registerWithCloud ?? registerFcmTokenWithCloud;
    this.dedupe = deps.dedupe ?? outreachDedupe;
    this.getTransport = deps.getTransport ?? getNotificationTransport;
    this.getHideContent = deps.getHideContent ?? getHideContentOnLockScreen;
    this.postLocal = deps.postLocal ?? (payload => postLocalNotification(payload));
    this.onInApp = deps.onInApp;
    this.onBackgroundWake = deps.onBackgroundWake;
    this.onNotificationOpened = deps.onNotificationOpened;
  }

  /** True when Firebase is initialised and this service is live. */
  isActive(): boolean {
    return this.available;
  }

  /** Subscribe/replace the foreground in-app handler. */
  setInAppHandler(handler?: (parsed: ParsedPushMessage) => void): void {
    this.onInApp = handler;
  }

  /** Subscribe/replace the tap handler. */
  setNotificationOpenedHandler(handler?: (parsed: ParsedPushMessage) => void): void {
    this.onNotificationOpened = handler;
  }

  /**
   * Register the background message handler. MUST be called as early as
   * possible (before the root component mounts) so Android's Headless JS task
   * and iOS's background launch can reach it. Safe to call when Firebase is
   * unavailable — it then simply does nothing.
   */
  installBackgroundHandler(): void {
    const api = this.loadApi();
    if (!api) return;
    if (!this.isApiAvailable(api)) return;
    let messaging: unknown;
    try {
      messaging = api.getMessaging();
    } catch (e) {
      log.warn('getMessaging() failed; background handler not installed:', e);
      return;
    }
    try {
      api.setBackgroundMessageHandler(messaging, message => this.handleBackground(message));
    } catch (e) {
      log.warn('setBackgroundMessageHandler failed:', e);
    }
  }

  /**
   * Attach foreground listeners and acquire the initial FCM token. Idempotent.
   * Safe to call regardless of feature flag / Firebase availability.
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    if (!isFirebaseMessagingEnabled()) {
      log.info('Firebase messaging disabled (rollback knob) — native token fallback');
      return;
    }

    const api = this.loadApi();
    if (!api) {
      log.info('Firebase unavailable (SDK not linked) — native token fallback');
      return;
    }
    if (!this.isApiAvailable(api)) {
      log.info('Firebase not initialised (apps=0) — native token fallback');
      return;
    }

    this.api = api;
    try {
      this.messaging = api.getMessaging();
    } catch (e) {
      log.warn('getMessaging() failed:', e);
      this.api = null;
      return;
    }
    this.available = true;

    // Foreground arrivals.
    this.unsubscribers.push(
      api.onMessage(this.messaging, message => {
        void this.handleForeground(message);
      }),
    );
    // Token rotation.
    this.unsubscribers.push(
      api.onTokenRefresh(this.messaging, token => {
        void this.handleToken(token);
      }),
    );
    // Notification taps while the app was backgrounded.
    this.unsubscribers.push(
      api.onNotificationOpenedApp(this.messaging, message => {
        this.handleOpened(message);
      }),
    );
    // Cold-start tap (app opened from a quit state by a notification tap).
    void Promise.resolve(api.getInitialNotification(this.messaging))
      .then(message => {
        if (message) this.handleOpened(message);
      })
      .catch(e => log.warn('getInitialNotification failed:', e));

    // Initial token acquisition (guarded).
    await this.acquireToken();
  }

  /** Tear down listeners (tests / rollback). */
  stop(): void {
    this.unsubscribers.forEach(u => {
      try {
        u();
      } catch {
        /* ignore */
      }
    });
    this.unsubscribers = [];
    this.available = false;
    this.started = false;
    this.api = null;
    this.messaging = null;
  }

  // ── Handlers (public for tests) ────────────────────────────────────────

  /**
   * A foreground FCM message. FCM already suppresses the OS banner; the app
   * owns the surface. Never throws.
   */
  async handleForeground(message: RemoteMessageLike | null | undefined): Promise<void> {
    try {
      const parsed = parsePushMessage(message);
      if (parsed.kind === 'keepalive' || parsed.kind === 'unknown') return;
      if (!parsed.messageId) return;

      const transport = await this.getTransport();
      if (transport === 'off') return;

      if (!this.dedupe.recordIfNew(parsed.messageId)) return;
      this.emitInApp(parsed);
    } catch (e) {
      log.warn('handleForeground failed:', e);
    }
  }

  /**
   * A background / quit FCM message (Android Headless JS / iOS background
   * launch). The OS displays any `notification` payload itself; a data-only
   * outreach is posted locally. Never throws.
   */
  async handleBackground(message: RemoteMessageLike | null | undefined): Promise<void> {
    try {
      const parsed = parsePushMessage(message);

      // Silent keepalive/blind-tick: the EXISTING native wake bridge owns
      // routing (wake entry semantics unchanged). Observe only.
      if (parsed.kind === 'keepalive') {
        this.emitBackgroundWake(parsed);
        return;
      }
      if (parsed.kind === 'unknown' || !parsed.messageId) return;

      const transport = await this.getTransport();
      if (transport === 'off') return;

      // Dedupe BEFORE surfacing: a background FCM arrival for an already-seen
      // message (e.g. a wake-relayed push) must be suppressed.
      if (!this.dedupe.recordIfNew(parsed.messageId)) return;

      // The OS already displayed a banner for a notification-bearing push.
      if (parsed.hasNotification) return;

      const hideContent = await this.getHideContent();
      await this.postLocal(composePushLocalNotification(parsed, hideContent));
    } catch (e) {
      log.warn('handleBackground failed:', e);
    }
  }

  /** A notification tap (background or cold start). Never throws. */
  handleOpened(message: RemoteMessageLike | null | undefined): void {
    try {
      const parsed = parsePushMessage(message);
      if (parsed.messageId) {
        // Mark seen so opening a tapped message cannot re-notify it.
        this.dedupe.recordIfNew(parsed.messageId);
      }
      this.emitNotificationOpened(parsed);
    } catch (e) {
      log.warn('handleOpened failed:', e);
    }
  }

  /** Recognise and register a token (initial acquisition + rotation). */
  async handleToken(token: string | null | undefined): Promise<void> {
    const clean = (token ?? '').trim();
    if (!clean) return;
    // SDK token takes precedence over the native raw-token fallback (§3).
    this.store.setPushToken(clean, 'sdk');
    await this.registerWithCloud(clean);
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async acquireToken(): Promise<void> {
    if (!this.api || this.messaging === null) return;
    try {
      const token = await this.api.getToken(this.messaging);
      await this.handleToken(token);
    } catch (e) {
      // A placeholder/missing Firebase config makes getToken() reject (dummy
      // project / no APNs). Keep the native seam token — do NOT register an
      // FCM token, do NOT crash (plan 7-12 §3 fence).
      log.warn(
        'getToken() failed (Firebase config missing/placeholder?) — keeping native token fallback:',
        e,
      );
    }
  }

  private isApiAvailable(api: FirebaseMessagingApi): boolean {
    try {
      const apps = api.getApps();
      return Array.isArray(apps) && apps.length > 0;
    } catch (e) {
      log.warn('getApps() failed:', e);
      return false;
    }
  }

  private emitInApp(parsed: ParsedPushMessage): void {
    try {
      this.onInApp?.(parsed);
    } catch (e) {
      log.warn('in-app handler threw:', e);
    }
  }

  private emitBackgroundWake(parsed: ParsedPushMessage): void {
    try {
      this.onBackgroundWake?.(parsed);
    } catch (e) {
      log.warn('background-wake handler threw:', e);
    }
  }

  private emitNotificationOpened(parsed: ParsedPushMessage): void {
    try {
      this.onNotificationOpened?.(parsed);
    } catch (e) {
      log.warn('notification-opened handler threw:', e);
    }
  }
}

// ── App-wide singleton ───────────────────────────────────────────────────

let attached: FirebaseMessagingService | null = null;

/**
 * Attach the app-wide Firebase messaging integration (idempotent). Boot code
 * calls this once at the top of `index.js` (before the root component mounts,
 * so the background handler is installed early). Safe when Firebase is
 * absent/placeholder — it then does nothing and the native token fallback
 * stays in force.
 */
export function attachFirebaseMessaging(
  deps: FirebaseMessagingDeps = {},
): FirebaseMessagingService {
  if (attached) return attached;
  const service = new FirebaseMessagingService(deps);
  service.installBackgroundHandler();
  void service.start();
  attached = service;
  return service;
}

/** The attached singleton, or null when not attached (tests / diagnostics). */
export function getFirebaseMessaging(): FirebaseMessagingService | null {
  return attached;
}

/** Test-only: stop + detach the singleton. */
export function detachFirebaseMessagingForTests(): void {
  attached?.stop();
  attached = null;
}

/** True when `Platform.OS` is a platform this integration supports. */
export function isFirebaseMessagingSupportedPlatform(): boolean {
  return Platform.OS === 'android' || Platform.OS === 'ios';
}

export default FirebaseMessagingService;
