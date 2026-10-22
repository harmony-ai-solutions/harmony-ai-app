/**
 * EngineLogStream — the WebSocket client for the embedded engine's live log
 * stream (`/api/development/logs/stream`, plan 7-11).
 *
 * The stream lives on the MANAGEMENT server (admin port), NOT the event WS
 * port: `ws://<bind>:<adminPort>/api/development/logs/stream?token=<loopback>`.
 * Auth rides a query param (browsers/WS clients cannot send custom headers):
 * the per-process loopback token the readiness payload carries, or the admin
 * key on a desktop/self-hosted bind. This mirrors the app's other engine-WS
 * patterns: a small injectable socket factory (standard `new WebSocket` in
 * production, a fake in tests) + capped exponential-backoff reconnect.
 *
 * The server emits `entry` (a new `EngineLogEntryDto`) and `remove` (a
 * dedup-eviction id the UI drops) events, plus a 30s `ping` keepalive. Clients
 * push in-band JSON control messages: `{type:"filter",data:{...}}`,
 * `{type:"pause"}` and `{type:"resume"}`.
 */

import { getEngineConnection } from './EngineService';
import type { EngineConnection } from './EngineService';
import type { EngineLogEntryDto } from './EngineApiClient';
import { createLogger } from '../../utils/logger';

const log = createLogger('[EngineLogStream]');

/** The minimal WebSocket surface the stream needs (injectable for tests). */
export interface WebSocketLike {
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/** An event delivered to subscribers. `ping` is a keepalive (no payload use). */
export interface EngineLogStreamEvent {
  type: 'entry' | 'remove' | 'ping';
  entry?: EngineLogEntryDto;
  removeId?: number;
  timestamp?: number;
}

/** The observable connection state of the stream. */
export type EngineLogStreamStatus =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'stopped';

/** In-band filter update shape accepted by the server. */
export interface EngineLogStreamFilter {
  component?: string;
  entityId?: string;
  minLevel?: string;
}

export interface EngineLogStreamOptions {
  /** Connection source (defaults to the live engine connection). */
  getConnection?: () => EngineConnection | null;
  /** Socket factory (defaults to `new WebSocket(url)`). */
  wsFactory?: (url: string) => WebSocketLike;
  /** Admin key fallback for desktop/self-hosted binds (query param). */
  getAdminApiKey?: () => string;
  onEvent?: (event: EngineLogStreamEvent) => void;
  onStatusChange?: (status: EngineLogStreamStatus) => void;
  /** Backoff bounds (defaults 1s → 30s, mirroring EntitySessionService). */
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
}

export class EngineLogStream {
  private readonly getConnection: () => EngineConnection | null;
  private readonly wsFactory: (url: string) => WebSocketLike;
  private readonly getAdminApiKey: () => string;
  private onEvent?: (event: EngineLogStreamEvent) => void;
  private onStatusChange?: (status: EngineLogStreamStatus) => void;
  private readonly reconnectBaseDelayMs: number;
  private readonly reconnectMaxDelayMs: number;

  private ws: WebSocketLike | null = null;
  private status: EngineLogStreamStatus = 'idle';
  private filter: EngineLogStreamFilter = {};
  private paused = false;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** True while `stop()` is unwinding — suppresses the close-triggered retry. */
  private stopped = true;

  constructor(options: EngineLogStreamOptions = {}) {
    this.getConnection = options.getConnection ?? getEngineConnection;
    this.wsFactory =
      options.wsFactory ?? ((url: string) => new WebSocket(url) as unknown as WebSocketLike);
    this.getAdminApiKey = options.getAdminApiKey ?? (() => '');
    this.onEvent = options.onEvent;
    this.onStatusChange = options.onStatusChange;
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? 1000;
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 30000;
  }

  /** The current connection status. */
  getStatus(): EngineLogStreamStatus {
    return this.status;
  }

  /** Subscribe/replace the event handler (the screen may mount after start). */
  setEventHandler(handler?: (event: EngineLogStreamEvent) => void): void {
    this.onEvent = handler;
  }

  /** Subscribe/replace the status handler. */
  setStatusHandler(handler?: (status: EngineLogStreamStatus) => void): void {
    this.onStatusChange = handler;
  }

  /** Build the stream URL from the live connection (token or admin key). */
  buildUrl(connection: EngineConnection | null = this.getConnection()): string | null {
    if (!connection) return null;
    const base = connection.adminBaseUrl.replace(/^http/, 'ws');
    const token = connection.token;
    if (token) {
      return `${base}/api/development/logs/stream?token=${encodeURIComponent(token)}`;
    }
    const adminKey = this.getAdminApiKey();
    if (adminKey) {
      return `${base}/api/development/logs/stream?apiKey=${encodeURIComponent(adminKey)}`;
    }
    return null;
  }

  /** Open the stream (idempotent while already running). */
  start(): void {
    if (!this.stopped && (this.status === 'connecting' || this.status === 'open' || this.status === 'reconnecting')) {
      return;
    }
    this.stopped = false;
    this.attempts = 0;
    this.open();
  }

  /** Close the stream and cancel any pending reconnect. */
  stop(): void {
    this.stopped = true;
    this.clearReconnect();
    this.teardownSocket();
    this.emitStatus('stopped');
  }

  /** Push an in-band filter update (sent immediately when open). */
  setFilter(filter: EngineLogStreamFilter): void {
    this.filter = filter ?? {};
    if (this.isOpen()) {
      this.sendFilter();
    }
  }

  /** Pause/resume server-side forwarding. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (this.isOpen()) {
      this.sendControl(paused ? 'pause' : 'resume');
    }
  }

  /** True while the socket is open. */
  isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === 1 /* OPEN */;
  }

  // ── internals ──────────────────────────────────────────────────────────

  private open(): void {
    const url = this.buildUrl();
    if (!url) {
      log.warn('EngineLogStream: no engine connection / credential; not connecting');
      this.emitStatus('idle');
      return;
    }
    this.emitStatus(this.attempts > 0 ? 'reconnecting' : 'connecting');

    let socket: WebSocketLike;
    try {
      socket = this.wsFactory(url);
    } catch (e) {
      log.warn('EngineLogStream: socket construction failed:', e);
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;

    socket.onopen = () => {
      if (this.ws !== socket) return;
      this.attempts = 0;
      this.emitStatus('open');
      // Re-apply the current filter + pause state to the fresh connection.
      if (Object.keys(this.filter).length > 0) this.sendFilter();
      if (this.paused) this.sendControl('pause');
    };

    socket.onmessage = (ev: { data: unknown }) => {
      if (this.ws !== socket) return;
      this.handleMessage(ev?.data);
    };

    socket.onerror = () => {
      if (this.ws !== socket) return;
      // The close handler drives the retry; nothing to do beyond logging.
      log.warn('EngineLogStream: socket error');
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
    let msg: { type?: string; data?: EngineLogEntryDto; removeId?: number; timestamp?: number };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.type) {
      case 'entry':
        if (msg.data) this.emit({ type: 'entry', entry: msg.data });
        break;
      case 'remove':
        if (typeof msg.removeId === 'number') this.emit({ type: 'remove', removeId: msg.removeId });
        break;
      case 'ping':
        this.emit({ type: 'ping', timestamp: msg.timestamp });
        break;
      default:
        break;
    }
  }

  private sendFilter(): void {
    this.sendControl('filter', {
      component: this.filter.component,
      entityId: this.filter.entityId,
      minLevel: this.filter.minLevel,
    });
  }

  private sendControl(type: string, data?: unknown): void {
    if (!this.isOpen() || this.ws === null) return;
    try {
      this.ws.send(JSON.stringify(data === undefined ? { type } : { type, data }));
    } catch (e) {
      log.warn('EngineLogStream: send failed:', e);
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnect();
    const delay = Math.min(
      this.reconnectBaseDelayMs * 2 ** this.attempts,
      this.reconnectMaxDelayMs,
    );
    this.attempts += 1;
    this.emitStatus('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) this.open();
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

  private emit(event: EngineLogStreamEvent): void {
    try {
      this.onEvent?.(event);
    } catch (e) {
      log.warn('EngineLogStream: event handler threw:', e);
    }
  }

  private emitStatus(status: EngineLogStreamStatus): void {
    this.status = status;
    try {
      this.onStatusChange?.(status);
    } catch (e) {
      log.warn('EngineLogStream: status handler threw:', e);
    }
  }
}
