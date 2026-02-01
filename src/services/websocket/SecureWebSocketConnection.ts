import AsyncStorage from '@react-native-async-storage/async-storage';
import { WebSocketConnection } from './WebSocketConnection';
import { BaseWebSocketConnection } from './BaseWebSocketConnection';
import { createLogger } from '../../utils/logger';

const log = createLogger('[SecureWebSocketConnection]');

export class SecureWebSocketConnection extends BaseWebSocketConnection implements WebSocketConnection {
  private wss: WebSocket | null = null;

  constructor() {
    super();
  }

  async connect(url: string): Promise<void> {
    // Clean up existing secure connection properly
    if (this.wss) {
      log.info('Closing existing WSS connection');
      const oldWss = this.wss;
      oldWss.onopen = null;
      oldWss.onmessage = null;
      oldWss.onerror = null;
      oldWss.onclose = null;
      oldWss.close();
      this.wss = null;
    }

    log.info(`Connecting securely to: ${url}`);
    
    return new Promise((resolve, reject) => {
      try {
        // Get JWT from AsyncStorage
        AsyncStorage.getItem('harmony_jwt').then(async (jwt) => {
          if (!jwt) {
            const error = new Error('No JWT credentials available');
            log.error(error.message);
            reject(error);
            return;
          }
          
          // React Native WebSocket: Pass JWT as protocol parameter
          // The backend will need to extract it from the Sec-WebSocket-Protocol header
          const protocols = [`Bearer.${jwt}`];
          const wss = new WebSocket(url, protocols);
          
          // Set a timeout for the connection attempt
          const connectionTimeout = setTimeout(() => {
            log.error('WSS connection timeout');
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
            log.info('Connected securely (WSS)');
            
            this.emit('connected');
            resolve();
          };
          
          wss.onerror = (error: any) => {
            clearTimeout(connectionTimeout);
            log.error('Secure connection error:', error);
            log.error(`Error type: ${typeof error}`);
            log.error(`Error keys: ${error ? Object.keys(error) : 'null'}`);
            
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
            
            log.info(`Error string for detection: ${errorString}`);
            
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
              log.info('Certificate verification failed - emitting event');
              this.emit('cert:verification_failed', error);
            } else {
              this.emit('error', error);
            }
            reject(error);
          };

          wss.onclose = (event) => {
            clearTimeout(connectionTimeout);
            log.info(`Secure connection closed, code: ${event.code} reason: ${event.reason}`);
            this.stopHeartbeat();
            
            // Only emit disconnected if this is still our current connection
            if (this.wss === wss) {
              this.wss = null;
              this.emit('disconnected');
            }
          };
          
          // Only assign to this.wss after all handlers are set up
          this.wss = wss;
        }).catch((error) => {
          log.error('Failed to get JWT token:', error);
          reject(error);
        });
      } catch (error) {
        log.error('Failed to create WSS connection:', error);
        this.wss = null;
        reject(error);
      }
    });
  }

  disconnect(): void {
    log.info('Disconnecting');
    this.stopHeartbeat();
    
    if (this.wss) {
      try {
        this.wss.close();
      } catch (err) {
        log.warn('Error closing connection:', err);
      }
      this.wss = null;
    }
  }

  async sendEvent(event: any): Promise<void> {
    if (!this.wss) {
      const error = new Error('No WebSocket connection available');
      log.error(error.message);
      this.emit('error', error);
      throw error;
    }

    if (this.wss.readyState !== WebSocket.OPEN) {
      const error = new Error(`WebSocket not ready (state: ${this.wss.readyState})`);
      log.error(error.message);
      this.emit('error', {
        message: error.message,
        code: 'SEND_FAILED',
        readyState: this.wss.readyState
      });
      throw error;
    }

    try {
      const message = JSON.stringify(event);
      log.info(`Sending event: ${event.event_type}`);
      this.wss.send(message);
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
    return this.wss !== null && this.wss.readyState === WebSocket.OPEN;
  }
}
