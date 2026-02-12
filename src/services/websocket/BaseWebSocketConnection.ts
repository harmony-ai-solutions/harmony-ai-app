import EventEmitter from 'eventemitter3';
import {WebSocketConnection, WebSocketConnectionEvents} from './WebSocketConnection'
import { createLogger } from '../../utils/logger';

const log = createLogger('[BaseWebSocketConnection]');

export abstract class BaseWebSocketConnection extends EventEmitter<WebSocketConnectionEvents> implements WebSocketConnection {
  private heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private readonly HEARTBEAT_INTERVAL = 30000; // 30 seconds
  private readonly HEARTBEAT_TIMEOUT = 10000;  // 10 seconds

  constructor() {
    super();
  }

  abstract connect(url: string): Promise<void>;
  abstract disconnect(): void;
  abstract isConnected(): boolean;
  abstract sendEvent(event: any): Promise<void>;

  public startHeartbeat(): void {
    // Clear any existing timers
    this.stopHeartbeat();

    log.info('Starting heartbeat timer');

    // Don't send first ping immediately - wait for application protocol to be ready
    // Set up interval to send pings every 30 seconds
    this.heartbeatIntervalId = setInterval(() => {
      this.sendPing();
    }, this.HEARTBEAT_INTERVAL);
  }

  protected stopHeartbeat(): void {
    if (this.heartbeatIntervalId) {
      log.info('Stopping heartbeat timer');
      clearInterval(this.heartbeatIntervalId);
      this.heartbeatIntervalId = null;
    }

    if (this.heartbeatTimeoutId) {
      clearTimeout(this.heartbeatTimeoutId);
      this.heartbeatTimeoutId = null;
    }
  }

  private sendPing(): void {
    try {
      log.debug('Sending CONNECTION_PING');

      const pingEvent = {
        event_id: `ping_${Date.now()}`,
        event_type: 'CONNECTION_PING',
        status: 'NEW',
        payload: {}
      };

      this.sendEvent(pingEvent);

      // Start timeout timer - if we don't get PONG in 10 seconds, connection is dead
      this.heartbeatTimeoutId = setTimeout(() => {
        log.warn('Heartbeat timeout - no PONG received within 10 seconds');
        this.handleHeartbeatTimeout();
      }, this.HEARTBEAT_TIMEOUT);

    } catch (error) {
      log.error('Failed to send PING:', error);
      this.handleHeartbeatTimeout();
    }
  }

  private handleHeartbeatTimeout(): void {
    log.error('Connection appears dead (heartbeat timeout), emitting error');
    this.emit('error', { message: 'Connection heartbeat timeout', code: 'HEARTBEAT_TIMEOUT' });
    // Note: The error event will be caught by ConnectionManager which will handle reconnection
  }

  protected handleMessage(event: any): void {
    try {
      const message = JSON.parse(event.data);
      
      // Validate message structure before accessing properties
      if (!message || typeof message !== 'object') {
        log.error('Invalid message format received');
        return;
      }

      log.info(`Received event: ${message.event_type} status: ${message.status}`);

      // Handle PONG response (clear timeout timer)
      if (message.event_type === 'CONNECTION_PONG') {
        log.debug('Received CONNECTION_PONG');
        if (this.heartbeatTimeoutId) {
          clearTimeout(this.heartbeatTimeoutId);
          this.heartbeatTimeoutId = null;
        }
        // Don't emit this as a regular event, it's just heartbeat bookkeeping
        return;
      }

      if (!message.payload) {
        log.warn('Message received with null/undefined payload', {
          event_type: message.event_type,
          status: message.status,
        });
        // Still process the message, just be careful with payload access
      }

      const harmonyEvent = {
        event_id: message.event_id || `unknown_${Date.now()}`,
        event_type: message.event_type,
        status: message.status,
        payload: message.payload || {},
      };

      // Emit the event for ConnectionManager to route
      this.emit('event', harmonyEvent);
      
      // Check if event has ERROR status and emit as error
      if (harmonyEvent.status === 'ERROR') {
        log.error('Received ERROR event:', harmonyEvent);
        const errorMsg = harmonyEvent.payload?.message || harmonyEvent.payload?.error || harmonyEvent.payload?.error_message || 'An error occurred';
        this.emit('error', { message: errorMsg, event: harmonyEvent });
      }
    } catch (error) {
      log.error('Error parsing message:', error);
    }
  }
}
