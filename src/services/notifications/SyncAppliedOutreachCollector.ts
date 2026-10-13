/**
 * SyncAppliedOutreachCollector — a short-lived subscriber to the engine's
 * outreach events WS (`/api/notifications/stream`) used by the iOS wake pass to
 * catch outreach that landed via **sync** during a suspended period
 * (plan 7-12 §2/§5, step 5).
 *
 * ## Why a live subscriber
 *
 * The engine emits an event for every sync-applied outreach/greeting row
 * (`lifecycle/outreach_notify_observer.go` → the notifications hub →
 * `/api/notifications/stream`). The hub does NOT buffer or replay: an event that
 * fires while nobody is subscribed is gone. So to cover sync-applied outreach,
 * the wake pass must be SUBSCRIBED while the catch-up/batch applies the pending
 * changesets. This collector is opened right after the engine is up and drained
 * after the batch — it buffers the events that arrive in between.
 *
 * It is intentionally tiny and independent of `OutreachNotificationService`
 * (which owns the AppState/local-post policy and is not attached during a
 * background wake): no posting, no reconnection — just buffer what arrives for
 * the wake window, then hand it to the relay.
 *
 * The URL/auth mirror the service's (`adminBaseUrl` → ws + loopback token, or
 * the admin key on a desktop/self-hosted bind).
 */

import { getEngineConnection } from '../engine/EngineService';
import type { EngineConnection } from '../engine/EngineService';
import type { WebSocketLike } from '../engine/EngineLogStream';
import { OUTREACH_STREAM_PATH } from './OutreachNotificationService';
import type { OutreachNotificationEvent } from './OutreachNotificationService';
import { createLogger } from '../../utils/logger';

const log = createLogger('[SyncAppliedOutreach]');

/** Bound on buffered events (a wake applies a bounded number of rows). */
export const DEFAULT_COLLECTOR_MAX_EVENTS = 64;

export interface SyncAppliedOutreachCollectorOptions {
  /** Connection source (defaults to the live engine connection). */
  getConnection?: () => EngineConnection | null;
  /** Socket factory (defaults to `new WebSocket(url)`). */
  wsFactory?: (url: string) => WebSocketLike;
  /** Admin-key fallback for desktop/self-hosted binds (query param). */
  getAdminApiKey?: () => string;
  /** Max buffered events (default {@link DEFAULT_COLLECTOR_MAX_EVENTS}). */
  maxEvents?: number;
}

export class SyncAppliedOutreachCollector {
  private readonly getConnection: () => EngineConnection | null;
  private readonly wsFactory: (url: string) => WebSocketLike;
  private readonly getAdminApiKey: () => string;
  private readonly maxEvents: number;

  private ws: WebSocketLike | null = null;
  private events: OutreachNotificationEvent[] = [];
  private started = false;

  constructor(options: SyncAppliedOutreachCollectorOptions = {}) {
    this.getConnection = options.getConnection ?? getEngineConnection;
    this.wsFactory =
      options.wsFactory ?? ((url: string) => new WebSocket(url) as unknown as WebSocketLike);
    this.getAdminApiKey = options.getAdminApiKey ?? (() => '');
    this.maxEvents = options.maxEvents ?? DEFAULT_COLLECTOR_MAX_EVENTS;
  }

  /** Build the stream URL from a connection (token or admin key). */
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

  /**
   * Begin buffering events. Best-effort: with no engine connection (or a socket
   * construction failure) it simply buffers nothing.
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    const url = this.buildUrl();
    if (!url) {
      log.warn('no engine connection / credential; collector inactive');
      return;
    }

    let socket: WebSocketLike;
    try {
      socket = this.wsFactory(url);
    } catch (e) {
      log.warn('socket construction failed:', e);
      return;
    }
    this.ws = socket;

    socket.onmessage = (ev: { data: unknown }) => {
      if (this.ws !== socket) return;
      this.handleMessage(ev?.data);
    };
    socket.onerror = () => {
      /* best-effort: a failed collector never fails the wake */
    };
    socket.onclose = () => {
      if (this.ws === socket) this.ws = null;
    };
  }

  /** Drain the buffered events (the socket stays open until {@link stop}). */
  take(): OutreachNotificationEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Close the socket (idempotent). */
  stop(): void {
    this.started = false;
    if (!this.ws) return;
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
    if (this.events.length >= this.maxEvents) return;
    this.events.push(msg);
  }
}

export default SyncAppliedOutreachCollector;
