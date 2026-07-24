import { WebSocketConnection } from './WebSocketConnection';
import { BaseWebSocketConnection } from './BaseWebSocketConnection';
import AuthService from '../auth/AuthService';
import { createLogger } from '../../utils/logger';

const log = createLogger('[CloudWS]');

export class CloudWebSocketConnection extends BaseWebSocketConnection implements WebSocketConnection {
  private ws: WebSocket | null = null;

  constructor() {
    super();
  }

  async connect(url: string): Promise<void> {
    // Clean up existing connection properly
    if (this.ws) {
      log.info('Closing existing cloud WS connection');
      const oldWs = this.ws;
      oldWs.onopen = null;
      oldWs.onmessage = null;
      oldWs.onerror = null;
      oldWs.onclose = null;
      oldWs.close();
      this.ws = null;
    }

    log.info(`Connecting to cloud WS: ${url}`);

    const paseto = await AuthService.getToken();
    if (!paseto) {
      throw new Error('Not authenticated');
    }

    return new Promise((resolve, reject) => {
      try {
        const protocols = [`Bearer.${paseto}`];
        const ws = new WebSocket(url, protocols);

        // Lifecycle tracking so the promise settles exactly once and the
        // 'disconnected' event (+ reactive auth-refresh chain) only fires for
        // connections that actually reached 'connected'.
        //
        // Connect-time failures (upgrade rejected with HTTP 401/404/500/503 —
        // which RN surfaces as a generic onerror with no close code) settle the
        // promise via onerror/timeout and let onclose perform ws cleanup WITHOUT
        // emitting 'disconnected'. This is important because:
        //   - the promise rejection already drives the caller's reconnect, and
        //   - a spurious 'disconnected' would also trigger handleSyncDisconnected
        //     → scheduleReconnect, racing the rejection path.
        // (scheduleReconnect is idempotent, so a double-fire is merely wasteful,
        //  but avoiding it keeps the logs and state clean.)
        let settled = false;
        let opened = false;

        // Set a timeout for the connection attempt (longer for cloud warm-pool init)
        const connectionTimeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          log.error('Cloud WS connection timeout');
          try { ws.close(); } catch (e) { log.warn('Error closing ws on timeout:', e); }
          // NOTE: do NOT null this.ws here. onclose owns cleanup and needs
          // this.ws === ws to recognise this as the current connection so it can
          // null it. Nulling here would defeat the onclose guard.
          this.emit('error', new Error('Cloud WS connection timeout'));
          reject(new Error('Cloud WS connection timeout'));
        }, 15000);

        ws.onmessage = (event) => {
          clearTimeout(connectionTimeout);
          this.handleMessage(event);
        };

        ws.onopen = () => {
          if (settled) return;
          opened = true;
          settled = true;
          clearTimeout(connectionTimeout);
          log.info('Cloud WS connected');
          this.emit('connected');
          resolve();
        };

        ws.onerror = (error: any) => {
          log.error('Cloud WS error:', error);
          // Connect-time failure (never opened): settle the promise now. We
          // intentionally do NOT null this.ws or detach onclose — onclose will
          // fire next (RN guarantees error→close ordering) and perform the ws
          // cleanup. For an already-opened connection, the error merely precedes
          // onclose, which runs the auth-refresh + 'disconnected' path below.
          if (!opened && !settled) {
            clearTimeout(connectionTimeout);
            settled = true;
            this.emit('error', error);
            reject(error);
          }
        };

        ws.onclose = async (event) => {
          clearTimeout(connectionTimeout);
          log.info(`Cloud WS closed, code: ${event.code} reason: ${event.reason}`);
          this.stopHeartbeat();

          // Only act if this is still the current connection — a subsequent
          // connect() may have already replaced this.ws with a fresh socket.
          if (this.ws !== ws) return;
          this.ws = null;

          // Only run the disconnect path for connections that were established.
          // Connect-time failures are already handled via the promise rejection
          // (onerror/timeout) and must not emit 'disconnected'.
          if (!opened) return;

          // Auth-failure close (1008 policy / 4401 app-defined): refresh before
          // signaling disconnect so the caller's reconnect upgrade uses a fresh PASETO.
          const AUTH_CLOSE_CODES = [1008, 4401] as const;
          if (event.code && (AUTH_CLOSE_CODES as readonly number[]).includes(event.code)) {
            try {
              const ok = await AuthService.refresh();
              if (!ok) {
                // Refresh failed (revoked/refresh-token dead) → force re-login.
                // invalidate() emits 'auth:expired' → AuthContext → login screen.
                await AuthService.invalidate();
              }
            } catch (e) {
              log.warn('Reactive refresh threw; invalidating', e);
              await AuthService.invalidate().catch(() => {});
            }
          }

          this.emit('disconnected');
        };

        // Only assign to this.ws after all handlers are set up
        this.ws = ws;
      } catch (error) {
        log.error('Failed to create cloud WS connection:', error);
        this.ws = null;
        reject(error);
      }
    });
  }

  disconnect(): void {
    log.info('Disconnecting cloud WS');
    this.stopHeartbeat();

    if (this.ws) {
      try {
        this.ws.close();
      } catch (err) {
        log.warn('Error closing cloud WS connection:', err);
      }
      this.ws = null;
    }
  }

  async sendEvent(event: any): Promise<void> {
    if (!this.ws) {
      const error = new Error('No WebSocket connection available');
      log.error(error.message);
      this.emit('error', error);
      throw error;
    }

    if (this.ws.readyState !== WebSocket.OPEN) {
      const error = new Error(`WebSocket not ready (state: ${this.ws.readyState})`);
      log.error(error.message);
      this.emit('error', {
        message: error.message,
        code: 'SEND_FAILED',
        readyState: this.ws.readyState
      });
      throw error;
    }

    try {
      const message = JSON.stringify(event);
      log.info(`Sending event: ${event.event_type}`);
      this.ws.send(message);
    } catch (error) {
      log.error('Error sending event:', error);
      this.emit('error', {
        message: 'Failed to send event',
        code: 'SEND_FAILED',
        originalError: error
      });
      throw error;
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
