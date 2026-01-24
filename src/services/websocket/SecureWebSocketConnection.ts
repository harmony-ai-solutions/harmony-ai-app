import AsyncStorage from '@react-native-async-storage/async-storage';
import { WebSocketConnection } from './WebSocketConnection';
import { BaseWebSocketConnection } from './BaseWebSocketConnection';

export class SecureWebSocketConnection extends BaseWebSocketConnection implements WebSocketConnection {
  private wss: WebSocket | null = null;

  constructor() {
    super();
  }

  async connect(url: string): Promise<void> {
    // Clean up existing secure connection properly
    if (this.wss) {
      console.log('[SecureWebSocketConnection] Closing existing WSS connection');
      const oldWss = this.wss;
      oldWss.onopen = null;
      oldWss.onmessage = null;
      oldWss.onerror = null;
      oldWss.onclose = null;
      oldWss.close();
      this.wss = null;
    }

    console.log('[SecureWebSocketConnection] Connecting securely to:', url);
    
    return new Promise((resolve, reject) => {
      try {
        // Get JWT from AsyncStorage
        AsyncStorage.getItem('harmony_jwt').then(async (jwt) => {
          if (!jwt) {
            const error = new Error('No JWT credentials available');
            console.error('[SecureWebSocketConnection]', error.message);
            reject(error);
            return;
          }
          
          // React Native WebSocket: Pass JWT as protocol parameter
          // The backend will need to extract it from the Sec-WebSocket-Protocol header
          const protocols = [`Bearer.${jwt}`];
          const wss = new WebSocket(url, protocols);
          
          // Set a timeout for the connection attempt
          const connectionTimeout = setTimeout(() => {
            console.error('[SecureWebSocketConnection] WSS connection timeout');
            wss.close();
            this.wss = null;
            reject(new Error('Secure connection timeout'));
          }, 10000); // 10 second timeout
          
          wss.onmessage = (event) => {
            clearTimeout(connectionTimeout);
            this.handleMessage(event);
          };
          
          wss.onopen = () => {
            clearTimeout(connectionTimeout);
            console.log('[SecureWebSocketConnection] Connected securely (WSS)');
            
            this.emit('connected');
            resolve();
          };
          
          wss.onerror = (error: any) => {
            clearTimeout(connectionTimeout);
            console.error('[SecureWebSocketConnection] Secure connection error:', error);
            console.error('[SecureWebSocketConnection] Error type:', typeof error);
            console.error('[SecureWebSocketConnection] Error keys:', error ? Object.keys(error) : 'null');
            
            // Detect certificate verification errors - check multiple error formats
            // Handle the case where error.toString() returns '[object Object]' which is useless
            const errorToString = error?.toString?.();
            let errorString: string;
            
            if (errorToString && errorToString.toLowerCase() === '[object object]') {
              // If toString returns the useless default object representation, use JSON.stringify instead
              errorString = JSON.stringify(error).toLowerCase();
            } else {
              // Otherwise, use the normal approach
              errorString = (error?.message || errorToString || JSON.stringify(error) || '').toLowerCase();
            }
            
            console.log('[SecureWebSocketConnection] Error string for detection:', errorString);
            
            const isCertError = 
              errorString.includes('certificate') ||
              errorString.includes('ssl') ||
              errorString.includes('tls') ||
              errorString.includes('cert_') ||
              errorString.includes('trust anchor') ||
              errorString.includes('self signed') ||
              errorString.includes('unable to verify') ||
              errorString.includes('verification failed') ||
              errorString.includes('handshake');
            
            // Additional heuristic: If this is a WSS connection and error has no meaningful details,
            // treat it as a certificate verification failure (most common cause in React Native)
            const hasGenericErrorStructure = errorString.includes('"_type":"error"') && 
                                           errorString.includes('"_defaultprevented":false');
            
            // Clean up failed connection
            wss.onopen = null;
            wss.onmessage = null;
            wss.onerror = null;
            wss.onclose = null;
            this.wss = null;
            
            if (isCertError || hasGenericErrorStructure) {
              console.log('[SecureWebSocketConnection] Certificate verification failed - emitting event');
              this.emit('cert:verification_failed', error);
            } else {
              this.emit('error', error);
            }
            reject(error);
          };

          wss.onclose = (event) => {
            clearTimeout(connectionTimeout);
            console.log('[SecureWebSocketConnection] Secure connection closed, code:', event.code, 'reason:', event.reason);
            
            // Only emit disconnected if this is still our current connection
            if (this.wss === wss) {
              this.wss = null;
              this.emit('disconnected');
            }
          };
          
          // Only assign to this.wss after all handlers are set up
          this.wss = wss;
        }).catch((error) => {
          console.error('[SecureWebSocketConnection] Failed to get JWT token:', error);
          reject(error);
        });
      } catch (error) {
        console.error('[SecureWebSocketConnection] Failed to create WSS connection:', error);
        this.wss = null;
        reject(error);
      }
    });
  }

  disconnect(): void {
    console.log('[SecureWebSocketConnection] Disconnecting');
    
    if (this.wss) {
      try {
        this.wss.close();
      } catch (err) {
        console.warn('[SecureWebSocketConnection] Error closing connection:', err);
      }
      this.wss = null;
    }
  }

  async sendEvent(event: any): Promise<void> {
    if (!this.wss) {
      const error = new Error('No WebSocket connection available');
      console.error('[SecureWebSocketConnection]', error.message);
      this.emit('error', error);
      throw error;
    }

    if (this.wss.readyState !== WebSocket.OPEN) {
      const error = new Error(`WebSocket not ready (state: ${this.wss.readyState})`);
      console.error('[SecureWebSocketConnection]', error.message);
      this.emit('error', error);
      throw error;
    }

    try {
      const message = JSON.stringify(event);
      console.log('[SecureWebSocketConnection] Sending event:', event.event_type);
      this.wss.send(message);
    } catch (error) {
      console.error('[SecureWebSocketConnection] Error sending event:', error);
      this.emit('error', error);
      throw error;
    }
  }

  isConnected(): boolean {
    return this.wss !== null && this.wss.readyState === WebSocket.OPEN;
  }
}
