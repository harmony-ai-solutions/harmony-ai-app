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

      // Remove event subscriptions BEFORE closing. The library's onX() methods
      // OVERWRITE their internal listener reference without removing the
      // previous native event subscription — so the old "clear handlers by
      // registering no-ops" approach orphaned the real closures, which kept
      // reacting to native events forever (error → close → error ping-pong
      // flood, observed on device ending in a JNI global-ref overflow crash).
      try {
        oldWs.removeOnOpenListener();
        oldWs.removeOnMessageListener();
        oldWs.removeOnErrorListener();
        oldWs.removeOnCloseListener();
        oldWs.close();
      } catch (err) {
        log.warn('Error closing self-signed connection:', err);
      }

      this.wssSelfSigned = null;
    }

    log.info(`Connecting with self-signed cert library to: ${url}`);
    
    return new Promise((resolve, reject) => {
      // Single settle guard for the whole connect attempt. Declared in the
      // executor scope (NOT inside the try block below) so the timeout callback
      // — which also settles the promise — can mark the attempt as signalled and
      // suppress any late native onError, exactly like the onError/.catch paths.
      let failureSignalled = false;
      // Set a timeout for the connection attempt
      const connectionTimeout = setTimeout(() => {
        log.error('Self-signed WSS connection timeout');
        // Settle exactly once: mark the attempt as signalled so a delayed native
        // onError (the native side can report this tear-down as an error AFTER we
        // already rejected) is suppressed instead of emitting a spurious second
        // 'error'. Completes the failureSignalled guarantee that onError/.catch
        // already implement (without this, a post-timeout error leaked one extra
        // 'error' event — bounded but noisy).
        failureSignalled = true;
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

        // Remove any subscriptions left over from a previous lifecycle of this
        // cached per-URL instance (e.g. after a server-initiated close, where
        // close() — and thus the library's removeAllListeners() — never ran).
        // The onX() registrations below would otherwise overwrite the listener
        // references and orphan the old native subscriptions, re-creating the
        // error ping-pong flood on the next failure.
        ws.removeOnOpenListener();
        ws.removeOnMessageListener();
        ws.removeOnErrorListener();
        ws.removeOnCloseListener();

        // (failureSignalled is declared in the Promise executor scope above so
        // the timeout branch, this handler, and the .catch all share one guard.)

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
          this.stopHeartbeat();
          
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
          // 'No active WebSocket for this URL' is emitted by the native module
          // when close() is called for an already-removed socket. It is benign
          // teardown noise — answering it with another close() (the old
          // behavior) created a self-sustaining native↔JS error ping-pong.
          // Never close/emit/reject in response to it.
          if (typeof err === 'string' && err.includes('No active WebSocket for this URL')) {
            log.warn('Ignoring benign native close-race error:', err);
            return;
          }

          clearTimeout(connectionTimeout);
          log.error(`Self-signed connection error: ${err}`);

          // Signal only once per connect attempt: a failing native socket can
          // report the same failure repeatedly, and every repeated close()
          // would feed the native error loop again.
          if (failureSignalled) {
            return;
          }
          failureSignalled = true;

          // Clean up failed connection
          if (this.wssSelfSigned === ws) {
            this.wssSelfSigned = null;
          }

          // Best-effort close so a lingering native socket can't deadlock the
          // next connect with "Already Connected" (see connect() catch).
          try {
            ws.close();
          } catch (closeErr) {
            log.warn('Error closing errored self-signed connection:', closeErr);
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

            // Best-effort close of the native socket for this URL. The native
            // module keeps a per-URL socket map and rejects any later connect()
            // with "Already Connected" while a socket lingers. A failed connect
            // used to leave this.wssSelfSigned unset, so a subsequent
            // disconnect() was a no-op and the stale socket deadlocked every
            // retry. Closing here (and in the error handler below) guarantees
            // the next attempt starts from a clean native state.
            try {
              ws.close();
            } catch (closeErr) {
              log.warn('Error closing failed self-signed connection:', closeErr);
            }

            // Clean up
            if (this.wssSelfSigned === ws) {
              this.wssSelfSigned = null;
            }

            if (!failureSignalled) {
              failureSignalled = true;
              this.emit('error', err);
            }
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
    this.stopHeartbeat();
    
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

    // the library doesn't expose readyState, but we check if it is still connected
    if (!this.isConnected()) {
      const error = new Error('WebSocket not connected');
      log.error(error.message);
      this.emit('error', {
        message: error.message,
        code: 'SEND_FAILED'
      });
      throw error;
    }

    try {
      const message = JSON.stringify(event);
      log.info(`Sending event: ${event.event_type}`);
      this.wssSelfSigned.send(message);
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
}
