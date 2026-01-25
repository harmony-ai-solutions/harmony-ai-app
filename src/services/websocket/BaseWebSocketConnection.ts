import EventEmitter from 'eventemitter3';
import {WebSocketConnection, WebSocketConnectionEvents} from './WebSocketConnection'
import { createLogger } from '../../utils/logger';

const log = createLogger('[BaseWebSocketConnection]');

export abstract class BaseWebSocketConnection extends EventEmitter<WebSocketConnectionEvents> implements WebSocketConnection {
  constructor() {
    super();
  }

  abstract connect(url: string): Promise<void>;
  abstract disconnect(): void;
  abstract isConnected(): boolean;
  abstract sendEvent(event: any): Promise<void>;

  protected handleMessage(event: any): void {
    try {
      const message = JSON.parse(event.data);
      
      // Validate message structure before accessing properties
      if (!message || typeof message !== 'object') {
        log.error('Invalid message format received');
        return;
      }

      log.info(`Received event: ${message.event_type} status: ${message.status}`);

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
