import { WebSocketConnection } from './WebSocketConnection';
import { BaseWebSocketConnection } from './BaseWebSocketConnection';

export class UnencryptedWebSocketConnection extends BaseWebSocketConnection implements WebSocketConnection {
  protected ws: WebSocket | null = null;

  constructor() {
    super();
  }

  async connect(url: string): Promise<void> {
    // Clean up existing connection properly
    if (this.ws) {
      console.log('[UnencryptedWebSocketConnection] Closing existing WS connection');
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
      console.log('[UnencryptedWebSocketConnection] Connecting to:', url);
      
      try {
        const ws = new WebSocket(url);
        
        ws.onmessage = (event) => {
          this.handleMessage(event);
        };
        
        ws.onopen = () => {
          console.log('[UnencryptedWebSocketConnection] Connected (insecure)');
          
          // Setup sync listeners after connection is established
          this.setupSyncListeners();
          
          this.emit('connected');
          resolve();
        };
        
        ws.onerror = (error) => {
          console.error('[UnencryptedWebSocketConnection] Connection error:', error);
          this.emit('error', error);
          reject(error);
        };
        
        ws.onclose = (event) => {
          console.log('[UnencryptedWebSocketConnection] Disconnected, code:', event.code, 'reason:', event.reason);
          // Only emit disconnected if this is still our current connection
          if (this.ws === ws) {
            this.ws = null;
            this.emit('disconnected');
          }
        };
        
        // Only assign to this.ws after all handlers are set up
        this.ws = ws;
      } catch (error) {
        console.error('[UnencryptedWebSocketConnection] Failed to create WS connection:', error);
        reject(error);
      }
    });
  }

  disconnect(): void {
    console.log('[UnencryptedWebSocketConnection] Disconnecting');
    
    // Cleanup sync listeners when disconnecting
    this.cleanupSyncListeners();
    
    if (this.ws) {
      try {
        this.ws.close();
      } catch (err) {
        console.warn('[UnencryptedWebSocketConnection] Error closing connection:', err);
      }
      this.ws = null;
    }
  }

  async sendEvent(event: any): Promise<void> {
    if (!this.ws) {
      const error = new Error('No WebSocket connection available');
      console.error('[UnencryptedWebSocketConnection]', error.message);
      this.emit('error', error);
      throw error;
    }

    try {
      const message = JSON.stringify(event);
      console.log('[UnencryptedWebSocketConnection] Sending event:', event.event_type);
      this.ws.send(message);
    } catch (error) {
      console.error('[UnencryptedWebSocketConnection] Error sending event:', error);
      this.emit('error', error);
      throw error;
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
