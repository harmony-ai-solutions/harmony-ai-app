/**
 * OutreachNotificationService — the app-side outreach notification client
 * (plan 7-12 §2, steps 3 + 4).
 *
 * ## What it does
 *
 * Subscribes to the engine's outreach notification stream
 * (`GET /api/notifications/stream`, a management-API WebSocket) and routes each
 * event by AppState:
 *
 *   - **Foreground** (`active`) → in-app surfacing only, via the
 *     {@link OutreachNotificationDeps.onInApp} seam (the app's existing
 *     chat-list/unread read path is the actual surface; no OS banner spam).
 *   - **Background / process alive** → a local OS notification through
 *     {@link OutreachNotificationDeps.postLocal} (default:
 *     `LocalNotifications.postLocalNotification`, which posts via the iOS
 *     `SoulbitsNotifications` module / the Android `NotificationsModule`).
 *
 * ## Wire shape (engine-shipped, contract 1.4.0)
 *
 * One JSON object per message, no envelope:
 * ```
 * { type:"outreach"|"greeting", entity_id, entity_name, message_id, title,
 *   body_preview, created_at, eligibility:"eligible"|"muted"|"decay_suppressed",
 *   delivery?:"live" }
 * ```
 * The server interleaves `{type:"ping",timestamp}` keepalives every 30s; those
 * are ignored.
 *
 * ## Defensive layers (engine gates stay authoritative)
 *
 *   1. `eligibility != "eligible"` never notifies (defensive second layer).
 *   2. `notification_transport === "off"` silences everything.
 *   3. `message_id` dedupe via the shared {@link outreachDedupe} seam, so a
 *      live event + a later re-emission (or a future push carrying the same id)
 *      never double-notifies.
 *
 * ## Transport
 *
 * The WS client mirrors `EngineLogStream` (plan 7-11): an injectable socket
 * factory (real `new WebSocket` in production, a fake in tests), a capped
 * exponential-backoff reconnect, and a clean `stop()`. The URL/auth derive from
 * the same engine target `EngineApiClient` uses (`getEngineConnection()` +
 * admin-key fallback), and the socket opens whenever an engine connection
 * exists — the local embedded engine AND a LAN-paired engine both present as
 * that connection.
 *
 * Singleton — use {@link attachOutreachNotifications} at boot.
 */

import { AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { createLogger } from '../../utils/logger';
import { getEngineConnection, onEngineConnectionChange } from '../engine/EngineService';
import type { EngineConnection } from '../engine/EngineService';
import type { WebSocketLike } from '../engine/EngineLogStream';
import { outreachDedupe } from './outreachDedupe';
import type { OutreachDedupe } from './outreachDedupe';
import {
  getHideContentOnLockScreen,
  getNotificationTransport,
} from './NotificationSettings';
import type { NotificationTransport } from './NotificationSettings';
import { postLocalNotification } from './LocalNotifications';
import type { LocalNotificationPayload } from './LocalNotifications';
import { isEntityLocked as defaultIsEntityLocked } from '../variant/entityAccess';

const log = createLogger('[OutreachNotifications]');

/** The management-API path of the outreach notification stream. */
export const OUTREACH_STREAM_PATH = '/api/notifications/stream';

// ── Wire types ───────────────────────────────────────────────────────────

export type OutreachEventType = 'outreach' | 'greeting';
export type OutreachEligibility = 'eligible' | 'muted' | 'decay_suppressed';

/** The engine's outreach notification event (snake_case, exactly the JSON). */
export interface OutreachNotificationEvent {
  type: OutreachEventType;
  entity_id: string;
  entity_name: string;
  message_id: string;
  title: string;
  body_preview: string;
  created_at: string;
  eligibility: OutreachEligibility;
  /** Present ("live") only for eventserver live-path events. */
  delivery?: 'live';
}

/** Observable stream status (mirrors `EngineLogStreamStatus`). */
export type OutreachStreamStatus =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'stopped';

/** The AppState surface the service needs (injectable for tests). */
export interface OutreachAppStateSource {
  currentState: AppStateStatus;
  addEventListener(
    type: 'change',
    handler: (state: AppStateStatus) => void,
  ): { remove(): void };
}

export interface OutreachNotificationDeps {
  /** Connection source (defaults to the live engine connection). */
  getConnection?: () => EngineConnection | null;
  /** Socket factory (defaults to `new WebSocket(url)`). */
  wsFactory?: (url: string) => WebSocketLike;
  /** Admin-key fallback for desktop/self-hosted binds (query param). */
  getAdminApiKey?: () => string;
  /** AppState source (defaults to RN `AppState`). */
  appState?: OutreachAppStateSource;
  /** Shared dedupe store (defaults to the process-wide singleton). */
  dedupe?: OutreachDedupe;
  /** Read the transport preference (defaults to NotificationSettings). */
  getTransport?: () => Promise<NotificationTransport>;
  /** Read the lock-screen hide-content preference (defaults to NotificationSettings). */
  getHideContent?: () => Promise<boolean>;
  /**
   * Store-variant lock predicate (plan 7-14 V3). When an entity is locked (its
   * provider isn't offered by this build) its outreach is suppressed — a locked
   * entity can't be interacted with, so a banner/unread would imply an
   * action that isn't possible. Defaults to the real entityAccess predicate
   * (short-circuits to false in the full variant).
   */
  isEntityLocked?: (entityId: string) => Promise<boolean>;
  /** Post a local OS notification (defaults to LocalNotifications). */
  postLocal?: (payload: LocalNotificationPayload) => Promise<boolean> | void;
  /** In-app surfacing seam for foreground events. */
  onInApp?: (event: OutreachNotificationEvent) => void;
  /** Observability hook. */
  onStatusChange?: (status: OutreachStreamStatus) => void;
  /** Backoff bounds (defaults 1s → 30s, mirroring EngineLogStream). */
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
}

/** Compose the generic (lock-screen-hidden) body text for an entity. */
export function genericOutreachBody(entityName: string): string {
  const name = (entityName ?? '').trim() || 'Your companion';
  return `${name} sent you a message`;
}

/**
 * Build the local OS notification for an event. When `hideContent` is true the
 * body is generic text; otherwise it is the engine's pre-rendered
 * `body_preview`.
 */
export function composeLocalNotification(
  event: OutreachNotificationEvent,
  hideContent: boolean,
): LocalNotificationPayload {
  const entityName = (event.entity_name ?? '').trim() || (event.title ?? '').trim();
  const fallback = genericOutreachBody(entityName);
  return {
    title: (event.title ?? '').trim() || entityName || 'Soulbits',
    body: hideContent ? fallback : (event.body_preview ?? '').trim() || fallback,
    entityId: event.entity_id ?? '',
    messageId: event.message_id ?? '',
  };
}

// ── Service ──────────────────────────────────────────────────────────────

export class OutreachNotificationService {
  private readonly getConnection: () => EngineConnection | null;
  private readonly wsFactory: (url: string) => WebSocketLike;
  private readonly getAdminApiKey: () => string;
  private readonly appState: OutreachAppStateSource;
  private readonly dedupe: OutreachDedupe;
  private readonly getTransport: () => Promise<NotificationTransport>;
  private readonly getHideContent: () => Promise<boolean>;
  private readonly isEntityLocked: (entityId: string) => Promise<boolean>;
  private readonly postLocal: (payload: LocalNotificationPayload) => Promise<boolean> | void;
  private onInApp?: (event: OutreachNotificationEvent) => void;
  private onStatusChange?: (status: OutreachStreamStatus) => void;
  private readonly reconnectBaseDelayMs: number;
  private readonly reconnectMaxDelayMs: number;

  private ws: WebSocketLike | null = null;
  private status: OutreachStreamStatus = 'idle';
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** True while `stop()` is unwinding — suppresses the close-triggered retry. */
  private stopped = true;
  /** True between `start()` and `stop()`. */
  private running = false;
  private unsubscribeConnection: (() => void) | null = null;
  private appStateSubscription: { remove(): void } | null = null;

  constructor(deps: OutreachNotificationDeps = {}) {
    this.getConnection = deps.getConnection ?? getEngineConnection;
    this.wsFactory =
      deps.wsFactory ?? ((url: string) => new WebSocket(url) as unknown as WebSocketLike);
    this.getAdminApiKey = deps.getAdminApiKey ?? (() => '');
    this.appState = deps.appState ?? (AppState as unknown as OutreachAppStateSource);
    this.dedupe = deps.dedupe ?? outreachDedupe;
    this.getTransport = deps.getTransport ?? getNotificationTransport;
    this.getHideContent = deps.getHideContent ?? getHideContentOnLockScreen;
    this.isEntityLocked = deps.isEntityLocked ?? defaultIsEntityLocked;
    this.postLocal = deps.postLocal ?? (payload => postLocalNotification(payload));
    this.onInApp = deps.onInApp;
    this.onStatusChange = deps.onStatusChange;
    this.reconnectBaseDelayMs = deps.reconnectBaseDelayMs ?? 1000;
    this.reconnectMaxDelayMs = deps.reconnectMaxDelayMs ?? 30000;
  }

  /** The current connection status. */
  getStatus(): OutreachStreamStatus {
    return this.status;
  }

  /** Subscribe/replace the in-app surfacing handler. */
  setInAppHandler(handler?: (event: OutreachNotificationEvent) => void): void {
    this.onInApp = handler;
  }

  /** Subscribe/replace the status handler. */
  setStatusHandler(handler?: (status: OutreachStreamStatus) => void): void {
    this.onStatusChange = handler;
  }

  /** Build the stream URL from the live connection (token or admin key). */
  buildUrl(connection: EngineConnection | null = this.getConnection()): string | null {
    if (!connection) return null;
    const base = connection.adminBaseUrl.replace(/^http/, 'ws');
    if (connection.token) {
      return `${base}${OUTREACH_STREAM_PATH}?token=${encodeURIComponent(connection.token)}`;
    }
    const adminKey = this.getAdminApiKey();
    if (adminKey) {
      return `${base}${OUTREACH_STREAM_PATH}?apiKey=${encodeURIComponent(adminKey)}`;
    }
    return null;
  }

  /** Begin watching the engine connection + AppState and open the stream. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.stopped = false;
    this.attempts = 0;

    this.unsubscribeConnection = onEngineConnectionChange(connection => {
      this.handleConnectionChange(connection);
    });
    this.appStateSubscription = this.appState.addEventListener('change', state => {
      this.handleAppState(state);
    });

    if (this.getConnection()) this.open();
    else this.emitStatus('idle');
  }

  /** Close the stream, cancel reconnect, and detach listeners. */
  stop(): void {
    this.running = false;
    this.stopped = true;
    this.unsubscribeConnection?.();
    this.unsubscribeConnection = null;
    this.appStateSubscription?.remove();
    this.appStateSubscription = null;
    this.clearReconnect();
    this.teardownSocket();
    this.emitStatus('stopped');
  }

  /** True while the socket is open. */
  isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === 1 /* OPEN */;
  }

  /** Transition AppState (exposed for tests; wired to RN AppState by default). */
  handleAppState(_value: AppStateStatus): void {
    // The policy is read per-event (isForeground); nothing to do on transition
    // beyond keeping the socket alive. Present so tests can drive transitions.
  }

  /**
   * Route one parsed outreach event. Public so tests (and, if ever needed, a
   * direct feed) can drive the policy without a socket. Never throws.
   */
  async handleEvent(event: OutreachNotificationEvent | null | undefined): Promise<void> {
    try {
      if (!event) return;
      if (event.type !== 'outreach' && event.type !== 'greeting') return; // ping/unknown
      if (event.eligibility !== 'eligible') return; // defensive (engine gates authoritative)

      const messageId = (event.message_id ?? '').trim();
      if (!messageId) return;

      const transport = await this.getTransport();
      if (transport === 'off') return; // silenced everywhere

      // Store-variant lock eligibility (7-14 V3): a locked entity's outreach is
      // suppressed (no local/in-app banner, no unread implied). Full variant →
      // the predicate short-circuits to false (no fetch).
      if (await this.isEntityLocked(event.entity_id)) return;

      // Dedupe BEFORE surfacing: a live event + a later re-emission (or a push
      // carrying the same id) must not double-notify.
      if (!this.dedupe.recordIfNew(messageId)) return;

      if (this.isForeground()) {
        this.emitInApp(event);
        return;
      }

      const hideContent = await this.getHideContent();
      const payload = composeLocalNotification(event, hideContent);
      await this.postLocal(payload);
    } catch (e) {
      log.warn('handleEvent failed:', e);
    }
  }

  // ── internals ──────────────────────────────────────────────────────────

  private isForeground(): boolean {
    return this.appState.currentState === 'active';
  }

  private handleConnectionChange(connection: EngineConnection | null): void {
    if (!this.running) return;
    if (connection) {
      if (!this.isOpen() && this.status !== 'connecting' && this.status !== 'reconnecting') {
        this.open();
      }
      return;
    }
    // Engine gone → tear the socket down (keep watching for its return).
    this.clearReconnect();
    this.teardownSocket();
    this.attempts = 0;
    this.emitStatus('idle');
  }

  private open(): void {
    const url = this.buildUrl();
    if (!url) {
      log.warn('no engine connection / credential; not connecting');
      this.emitStatus('idle');
      return;
    }
    this.emitStatus(this.attempts > 0 ? 'reconnecting' : 'connecting');

    let socket: WebSocketLike;
    try {
      socket = this.wsFactory(url);
    } catch (e) {
      log.warn('socket construction failed:', e);
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;

    socket.onopen = () => {
      if (this.ws !== socket) return;
      this.attempts = 0;
      this.emitStatus('open');
    };

    socket.onmessage = (ev: { data: unknown }) => {
      if (this.ws !== socket) return;
      this.handleMessage(ev?.data);
    };

    socket.onerror = () => {
      if (this.ws !== socket) return;
      log.warn('socket error');
    };

    socket.onclose = () => {
      if (this.ws !== socket) return;
      this.ws = null;
      if (this.stopped) return;
      this.scheduleReconnect();
    };
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let msg: OutreachNotificationEvent & { timestamp?: number };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    // Ignore the 30s keepalive + anything that is not an outreach/greeting event.
    if (msg.type !== 'outreach' && msg.type !== 'greeting') return;
    void this.handleEvent(msg);
  }

  private scheduleReconnect(): void {
    if (!this.running) return;
    this.clearReconnect();
    const delay = Math.min(
      this.reconnectBaseDelayMs * 2 ** this.attempts,
      this.reconnectMaxDelayMs,
    );
    this.attempts += 1;
    this.emitStatus('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped && this.running) this.open();
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private teardownSocket(): void {
    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close();
      } catch {
        /* ignore */
      }
    }
  }

  private emitInApp(event: OutreachNotificationEvent): void {
    try {
      this.onInApp?.(event);
    } catch (e) {
      log.warn('in-app handler threw:', e);
    }
  }

  private emitStatus(status: OutreachStreamStatus): void {
    this.status = status;
    try {
      this.onStatusChange?.(status);
    } catch (e) {
      log.warn('status handler threw:', e);
    }
  }
}

// ── App-wide singleton ───────────────────────────────────────────────────

let attached: OutreachNotificationService | null = null;

/**
 * Attach the app-wide outreach notification service (idempotent). Boot code
 * calls this once (see `DatabaseContext`); the process keeps it for its
 * lifetime.
 */
export function attachOutreachNotifications(
  deps: OutreachNotificationDeps = {},
): OutreachNotificationService {
  if (attached) return attached;
  attached = new OutreachNotificationService(deps);
  attached.start();
  log.info('Outreach notification service attached');
  return attached;
}

/** The attached singleton, or null when not attached (tests / diagnostics). */
export function getOutreachNotifications(): OutreachNotificationService | null {
  return attached;
}

/** Test-only: stop + detach the singleton. */
export function detachOutreachNotificationsForTests(): void {
  attached?.stop();
  attached = null;
}

export { outreachDedupe } from './outreachDedupe';

export default OutreachNotificationService;
