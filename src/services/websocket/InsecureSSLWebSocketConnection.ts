import AsyncStorage from '@react-native-async-storage/async-storage';
import WebSocketWithSelfSignedCert from 'react-native-websocket-self-signed';
import { WebSocketConnection } from './WebSocketConnection'
import { BaseWebSocketConnection } from './BaseWebSocketConnection';

export class InsecureSSLWebSocketConnection extends BaseWebSocketConnection implements WebSocketConnection {
  private wssSelfSigned: WebSocketWithSelfSignedCert | null = null;

  constructor() {
    super();
  }

  async connect(url: string): Promise<void> {
    const jwt = await AsyncStorage.getItem('harmony_jwt');
    
    if (!jwt) {
      const error = new Error('No JWT credentials available');
      console.error('[InsecureSSLWebSocketConnection]', error.message);
      throw error;
    }

    // Close existing connections properly
    if (this.wssSelfSigned) {
      console.log('[InsecureSSLWebSocketConnection] Closing existing self-signed WSS connection');
      const oldWs = this.wssSelfSigned;
      
      // Clear event handlers to prevent spurious events
      try {
        oldWs.onOpen(() => {});
        oldWs.onMessage(() => {});
        oldWs.onError(() => {});
        oldWs.onClose(() => {});
        oldWs.close();
      } catch (err) {
        console.warn('[InsecureSSLWebSocketConnection] Error closing self-signed connection:', err);
      }
      
      this.wssSelfSigned = null;
    }

    console.log('[InsecureSSLWebSocketConnection] Connecting with self-signed cert library to:', url);
    
    return new Promise((resolve, reject) => {
      // Set a timeout for the connection attempt
      const connectionTimeout = setTimeout(() => {
        console.error('[InsecureSSLWebSocketConnection] Self-signed WSS connection timeout');
        if (this.wssSelfSigned) {
          try {
            this.wssSelfSigned.close();
          } catch (err) {
            console.warn('[InsecureSSLWebSocketConnection] Error closing timed-out connection:', err);
          }
          this.wssSelfSigned = null;
        }
        reject(new Error('Self-signed secure connection timeout'));
      }, 10000); // 10 second timeout
      
      try {
        const ws = WebSocketWithSelfSignedCert.getInstance(url);
        
        ws.onOpen(() => {
          clearTimeout(connectionTimeout);
          console.log('[InsecureSSLWebSocketConnection] Connected securely (self-signed)');
          
          this.emit('connected');
          resolve();
        });
        
        ws.onMessage((message: string) => {
          // Parse and route the message
          clearTimeout(connectionTimeout);
          this.handleMessage({ data: message });
        });
        
        ws.onClose(() => {
          clearTimeout(connectionTimeout);
          console.log('[InsecureSSLWebSocketConnection] Self-signed connection closed');
          
          // Only emit disconnected if this is our current connection
          if (this.wssSelfSigned === ws) {
            console.log('[InsecureSSLWebSocketConnection] Current connection closed, cleaning up');
            this.wssSelfSigned = null;
            
            this.emit('disconnected');
          } else {
            console.log('[InsecureSSLWebSocketConnection] Old connection closed, ignoring');
          }
        });
        
        ws.onError((err: string) => {
          clearTimeout(connectionTimeout);
          console.error('[InsecureSSLWebSocketConnection] Self-signed connection error:', err);
          
          // Clean up failed connection
          if (this.wssSelfSigned === ws) {
            this.wssSelfSigned = null;
          }
          
          const error = new Error(err);
          this.emit('error', error);
          reject(error);
        });
        
        // Connect with JWT authorization header
        ws.connect({ Authorization: `Bearer ${jwt}` })
          .then(() => {
            console.log('[InsecureSSLWebSocketConnection] Self-signed connection established');
            this.wssSelfSigned = ws;
          })
          .catch((err: any) => {
            clearTimeout(connectionTimeout);
            console.error('[InsecureSSLWebSocketConnection] Failed to connect with self-signed library:', err);
            
            // Clean up
            if (this.wssSelfSigned === ws) {
              this.wssSelfSigned = null;
            }
            
            this.emit('error', err);
            reject(err);
          });
          
      } catch (error) {
        clearTimeout(connectionTimeout);
        console.error('[InsecureSSLWebSocketConnection] Failed to initialize self-signed connection:', error);
        this.wssSelfSigned = null;
        reject(error);
      }
    });
  }

  disconnect(): void {
    console.log('[InsecureSSLWebSocketConnection] Disconnecting');
    
    if (this.wssSelfSigned) {
      try {
        // Clear the reference before closing to prevent onClose from triggering cleanup
        const ws = this.wssSelfSigned;
        this.wssSelfSigned = null;
        
        // Now close the connection
        ws.close();
      } catch (err) {
        console.warn('[InsecureSSLWebSocketConnection] Error closing connection:', err);
      }
    }
  }

  isConnected(): boolean {
    // Self-signed library doesn't expose readyState, so we'll check if the connection exists
    return this.wssSelfSigned !== null;
  }

  async sendEvent(event: any): Promise<void> {
    if (!this.wssSelfSigned) {
      const error = new Error('No WebSocket connection available');
      console.error('[InsecureSSLWebSocketConnection]', error.message);
      this.emit('error', error);
      throw error;
    }

    try {
      const message = JSON.stringify(event);
      console.log('[InsecureSSLWebSocketConnection] Sending event:', event.event_type);
      this.wssSelfSigned.send(message);
    } catch (error) {
      console.error('[InsecureSSLWebSocketConnection] Error sending event:', error);
      this.emit('error', error);
      throw error;
    }
  }
}
