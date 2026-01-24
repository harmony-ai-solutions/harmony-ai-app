import EventEmitter from 'eventemitter3';
import {WebSocketConnection, WebSocketConnectionEvents} from './WebSocketConnection'

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
      const data = JSON.parse(event.data);
      console.log('[BaseWebSocketConnection] Received event:', data.event_type, 'status:', data.status);
      
      // Emit the event for ConnectionManager to route
      this.emit('event', data);
      
      // Check if event has ERROR status and emit as error
      if (data.status === 'ERROR') {
        console.error('[BaseWebSocketConnection] Received ERROR event:', data);
        const errorMsg = data.payload?.message || data.payload?.error || 'An error occurred';
        this.emit('error', { message: errorMsg, event: data });
      }
    } catch (error) {
      console.error('[BaseWebSocketConnection] Error parsing message:', error);
    }
  }
}
