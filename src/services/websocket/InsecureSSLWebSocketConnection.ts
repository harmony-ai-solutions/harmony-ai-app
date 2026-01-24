import AsyncStorage from '@react-native-async-storage/async-storage';
import WebSocketWithSelfSignedCert from 'react-native-websocket-self-signed';
import { WebSocketConnection } from './WebSocketConnection'
import { BaseWebSocketConnection } from './BaseWebSocketConnection';
import { createLogger } from '../../utils/logger';

const log = createLogger('[InsecureSSLWebSocketConnection]');

export class InsecureSSLWebSocketConnection extends BaseWebSocketConnection implements WebSocketConnection {
  private wssSelfSigned: WebSocketWithSelfSignedCert | null = null;

  constructor() {
    super();
  }

  async connect(url: string): Promise<void> {
    const jwt = await AsyncStorage.getItem('harmony_jwt');
    
    if (!jwt) {
      const error = new Error('No JWT credentials available');
      log.error(error.message);
      throw error;
    }

    // Close existing connections properly
    if (this.wssSelfSigned) {
      log.info('Closing existing self-signed WSS connection');
      const oldWs = this.wssSelfSigned;
      
      // Clear event handlers to prevent spurious events
      try {
        oldWs.onOpen(() => {});
        oldWs.onMessage(() => {});
        oldWs.onError(() => {});
        oldWs.onClose(() => {});
        oldWs.close();
      } catch (err) {
        log.warn('Error closing self-signed connection:', err);
      }
      
      this.wssSelfSigned = null;
    }

    log.info(`Connecting with self-signed cert library to: ${url}`);
    
    return new Promise((resolve, reject) => {
      // Set a timeout for the connection attempt
      const connectionTimeout = setTimeout(() => {
        log.error('Self-signed WSS connection timeout');
        if (this.wssSelfSigned) {
          try {
            this.wssSelfSigned.close();
          } catch (err) {
            log.warn('Error closing timed-out connection:', err);
          }
          this.wssSelfSigned = null;
        }
        reject(new Error('Self-signed secure connection timeout'));
      }, 10000); // 10 second timeout
      
      try {
        const ws = WebSocketWithSelfSignedCert.getInstance(url);
        
        ws.onOpen(() => {
          clearTimeout(connectionTimeout);
          log.info('Connected securely (self-signed)');
          
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
          log.info('Self-signed connection closed');
          
          // Only emit disconnected if this is still our current connection
          if (this.wssSelfSigned === ws) {
            log.info('Current connection closed, cleaning up');
            this.wssSelfSigned = null;
            
            this.emit('disconnected');
          } else {
            log.info('Old connection closed, ignoring');
          }
        });
        
        ws.onError((err: string) => {
          clearTimeout(connectionTimeout);
          log.error(`Self-signed connection error: ${err}`);
          
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
            log.info('Self-signed connection established');
            this.wssSelfSigned = ws;
          })
          .catch((err: any) => {
            clearTimeout(connectionTimeout);
            log.error('Failed to connect with self-signed library:', err);
            
            // Clean up
            if (this.wssSelfSigned === ws) {
              this.wssSelfSigned = null;
            }
            
            this.emit('error', err);
            reject(err);
          });
          
      } catch (error) {
        clearTimeout(connectionTimeout);
        log.error('Failed to initialize self-signed connection:', error);
        this.wssSelfSigned = null;
        reject(error);
      }
    });
  }

  disconnect(): void {
    log.info('Disconnecting');
    
    if (this.wssSelfSigned) {
      try {
        // Clear the reference before closing to prevent onClose from triggering cleanup
        const ws = this.wssSelfSigned;
        this.wssSelfSigned = null;
        
        // Now close the connection
        ws.close();
      } catch (err) {
        log.warn('Error closing connection:', err);
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
      log.error(error.message);
      this.emit('error', error);
      throw error;
    }

    try {
      const message = JSON.stringify(event);
      log.info(`Sending event: ${event.event_type}`);
      this.wssSelfSigned.send(message);
    } catch (error) {
      log.error('Error sending event:', error);
      this.emit('error', error);
      throw error;
    }
  }
}
