import { WebSocketConnection } from './WebSocketConnection';
import { BaseWebSocketConnection } from './BaseWebSocketConnection';
import { createLogger } from '../../utils/logger';

const log = createLogger('[UnencryptedWebSocketConnection]');

export class UnencryptedWebSocketConnection extends BaseWebSocketConnection implements WebSocketConnection {
  protected ws: WebSocket | null = null;

  constructor() {
    super();
  }

  async connect(url: string): Promise<void> {
    // Clean up existing connection properly
    if (this.ws) {
      log.info('Closing existing WS connection');
      // Remove event handlers to prevent them from firing during cleanup
      const oldWs = this.ws;
      oldWs.onopen = null;
      oldWs.onmessage = null;
      oldWs.onerror = null;
      oldWs.onclose = null;
      oldWs.close();
      this.ws = null;
    }

    return new Promise((resolve, reject) => {
      log.info(`Connecting to: ${url}`);
      
      try {
        const ws = new WebSocket(url);
        
        ws.onmessage = (event) => {
          this.handleMessage(event);
        };
        
        ws.onopen = () => {
          log.info('Connected (insecure)');
          
          this.emit('connected');
          resolve();
        };
        
        ws.onerror = (error) => {
          log.error('Connection error:', error);
          this.emit('error', error);
          reject(error);
        };
        
        ws.onclose = (event) => {
          log.info(`Disconnected, code: ${event.code} reason: ${event.reason}`);
          // Only emit disconnected if this is still our current connection
          if (this.ws === ws) {
            this.ws = null;
            this.emit('disconnected');
          }
        };
        
        // Only assign to this.ws after all handlers are set up
        this.ws = ws;
      } catch (error) {
        log.error('Failed to create WS connection:', error);
        reject(error);
      }
    });
  }

  disconnect(): void {
    log.info('Disconnecting');
    
    if (this.ws) {
      try {
        this.ws.close();
      } catch (err) {
        log.warn('Error closing connection:', err);
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

    try {
      const message = JSON.stringify(event);
      log.info(`Sending event: ${event.event_type}`);
      this.ws.send(message);
    } catch (error) {
      log.error('Error sending event:', error);
      this.emit('error', error);
      throw error;
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
