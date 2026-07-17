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

        // Set a timeout for the connection attempt (longer for cloud warm-pool init)
        const connectionTimeout = setTimeout(() => {
          log.error('Cloud WS connection timeout');
          ws.close();
          this.ws = null;
          reject(new Error('Cloud WS connection timeout'));
        }, 15000);

        ws.onmessage = (event) => {
          clearTimeout(connectionTimeout);
          this.handleMessage(event);
        };

        ws.onopen = () => {
          clearTimeout(connectionTimeout);
          log.info('Cloud WS connected');
          this.emit('connected');
          resolve();
        };

        ws.onerror = (error: any) => {
          clearTimeout(connectionTimeout);
          log.error('Cloud WS error:', error);

          // Clean up failed connection
          ws.onopen = null;
          ws.onmessage = null;
          ws.onerror = null;
          ws.onclose = null;
          this.ws = null;

          this.emit('error', error);
          reject(error);
        };

        ws.onclose = async (event) => {
          clearTimeout(connectionTimeout);
          log.info(`Cloud WS closed, code: ${event.code} reason: ${event.reason}`);
          this.stopHeartbeat();

          // Only emit disconnected if this is still our current connection
          if (this.ws === ws) {
            this.ws = null;

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
          }
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
