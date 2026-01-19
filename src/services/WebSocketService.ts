import EventEmitter from 'eventemitter3';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SyncService } from './SyncService';
import WebSocketWithSelfSignedCert from 'react-native-websocket-self-signed';

interface WebSocketServiceEvents {
  'connected': () => void;
  'connected:secure': () => void;
  'disconnected': () => void;
  'disconnected:secure': () => void;
  'error': (error: any) => void;
  'cert:verification_failed': (error: any) => void;
  'event': (data: any) => void;
  'sync:unknown_event': (event: any) => void;
}

export class WebSocketService extends EventEmitter<WebSocketServiceEvents> {
  private static instance: WebSocketService;
  private ws: WebSocket | null = null;
  private wss: WebSocket | null = null;
  private wssSelfSigned: WebSocketWithSelfSignedCert | null = null;
  private listenersSetup: boolean = false;
  
  // Store listener function references so we can remove them specifically
  private handshakeRequestedListener: ((event: any) => void) | null = null;
  private syncRequestedListener: ((event: any) => void) | null = null;
  private syncDataOutListener: ((event: any) => void) | null = null;
  private syncConfirmOutListener: ((event: any) => void) | null = null;
  private syncCompleteOutListener: ((event: any) => void) | null = null;
  private syncFinalizeOutListener: ((event: any) => void) | null = null;

  static getInstance(): WebSocketService {
    if (!WebSocketService.instance) {
      WebSocketService.instance = new WebSocketService();
    }
    return WebSocketService.instance;
  }

  constructor() {
    super();
  }

  private setupSyncListeners() {
    // Remove any existing listeners first to prevent duplicates
    this.cleanupSyncListeners();
    
    const syncService = SyncService.getInstance();
    
    // Create and store listener function references
    this.handshakeRequestedListener = (event) => {
      console.log('[WebSocketService] Forwarding HANDSHAKE_REQUEST');
      this.sendEvent(event);
    };
    
    this.syncRequestedListener = (event) => {
      console.log('[WebSocketService] Forwarding SYNC_REQUEST');
      this.sendEvent(event);
    };
    
    this.syncDataOutListener = (event) => {
      console.log('[WebSocketService] Forwarding SYNC_DATA');
      this.sendEvent(event);
    };
    
    this.syncConfirmOutListener = (event) => {
      console.log('[WebSocketService] Forwarding SYNC_DATA_CONFIRM');
      this.sendEvent(event);
    };
    
    this.syncCompleteOutListener = (event) => {
      console.log('[WebSocketService] Forwarding SYNC_COMPLETE');
      this.sendEvent(event);
    };
    
    this.syncFinalizeOutListener = (event) => {
      console.log('[WebSocketService] Forwarding SYNC_FINALIZE');
      this.sendEvent(event);
    };
    
    // Register listeners with SyncService
    syncService.on('handshake:requested', this.handshakeRequestedListener);
    syncService.on('sync:requested', this.syncRequestedListener);
    syncService.on('sync:data_out', this.syncDataOutListener);
    syncService.on('sync:confirm_out', this.syncConfirmOutListener);
    syncService.on('sync:complete_out', this.syncCompleteOutListener);
    syncService.on('sync:finalize_out', this.syncFinalizeOutListener);
    
    this.listenersSetup = true;
    console.log('[WebSocketService] Sync listeners setup complete');
  }

  private cleanupSyncListeners() {
    if (!this.listenersSetup) return;
    
    console.log('[WebSocketService] Cleaning up sync listeners');
    const syncService = SyncService.getInstance();
    
    // Remove only OUR specific listeners, not all listeners
    if (this.handshakeRequestedListener) {
      syncService.off('handshake:requested', this.handshakeRequestedListener);
    }
    if (this.syncRequestedListener) {
      syncService.off('sync:requested', this.syncRequestedListener);
    }
    if (this.syncDataOutListener) {
      syncService.off('sync:data_out', this.syncDataOutListener);
    }
    if (this.syncConfirmOutListener) {
      syncService.off('sync:confirm_out', this.syncConfirmOutListener);
    }
    if (this.syncCompleteOutListener) {
      syncService.off('sync:complete_out', this.syncCompleteOutListener);
    }
    if (this.syncFinalizeOutListener) {
      syncService.off('sync:finalize_out', this.syncFinalizeOutListener);
    }
    
    // Clear references
    this.handshakeRequestedListener = null;
    this.syncRequestedListener = null;
    this.syncDataOutListener = null;
    this.syncConfirmOutListener = null;
    this.syncCompleteOutListener = null;
    this.syncFinalizeOutListener = null;
    
    this.listenersSetup = false;
  }

  async connect(url: string): Promise<void> {
    // Clean up existing connection properly
    if (this.ws) {
      console.log('[WebSocketService] Closing existing WS connection');
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
      console.log('[WebSocketService] Connecting to:', url);
      
      try {
        const ws = new WebSocket(url);
        
        ws.onmessage = (event) => this.handleMessage(event);
        
        ws.onopen = () => {
          console.log('[WebSocketService] Connected (insecure)');
          
          // Setup sync listeners after connection is established
          this.setupSyncListeners();
          
          this.emit('connected');
          resolve();
        };
        
        ws.onerror = (error) => {
          console.error('[WebSocketService] Connection error:', error);
          this.emit('error', error);
          reject(error);
        };
        
        ws.onclose = () => {
          console.log('[WebSocketService] Disconnected');
          // Only emit disconnected if this is still our current connection
          if (this.ws === ws) {
            this.emit('disconnected');
          }
        };
        
        // Only assign to this.ws after all handlers are set up
        this.ws = ws;
      } catch (error) {
        console.error('[WebSocketService] Failed to create WS connection:', error);
        reject(error);
      }
    });
  }

  async connectSecure(): Promise<void> {
    const jwt = await AsyncStorage.getItem('harmony_jwt');
    const wssUrl = await AsyncStorage.getItem('harmony_wss_url');
    
    if (!jwt || !wssUrl) {
      const error = new Error('No JWT credentials available');
      console.error('[WebSocketService]', error.message);
      throw error;
    }
    
    // Clean up existing secure connection properly
    if (this.wss) {
      console.log('[WebSocketService] Closing existing WSS connection');
      const oldWss = this.wss;
      oldWss.onopen = null;
      oldWss.onmessage = null;
      oldWss.onerror = null;
      oldWss.onclose = null;
      oldWss.close();
      this.wss = null;
    }
    
    // IMPORTANT: Close insecure WS connection BEFORE attempting secure connection
    // This prevents connection conflicts and allows clean retry after TLS failures
    if (this.ws) {
      console.log('[WebSocketService] Closing insecure WS connection before WSS attempt');
      const oldWs = this.ws;
      oldWs.onopen = null;
      oldWs.onmessage = null;
      oldWs.onerror = null;
      oldWs.onclose = null;
      oldWs.close();
      this.ws = null;
    }

    console.log('[WebSocketService] Connecting securely to:', wssUrl);
    
    return new Promise((resolve, reject) => {
      try {
        // React Native WebSocket: Pass JWT as protocol parameter
        // The backend will need to extract it from the Sec-WebSocket-Protocol header
        const protocols = [`Bearer.${jwt}`];
        const wss = new WebSocket(wssUrl, protocols);
        
        // Set a timeout for the connection attempt
        const connectionTimeout = setTimeout(() => {
          console.error('[WebSocketService] WSS connection timeout');
          wss.close();
          this.wss = null;
          reject(new Error('Secure connection timeout'));
        }, 10000); // 10 second timeout
        
        wss.onmessage = (event) => this.handleMessage(event);
        
        wss.onopen = () => {
          clearTimeout(connectionTimeout);
          console.log('[WebSocketService] Connected securely (WSS)');
          
          // Setup sync listeners after connection is established
          this.setupSyncListeners();
          
          this.emit('connected:secure');
          resolve();
        };
        
        wss.onerror = (error: any) => {
          clearTimeout(connectionTimeout);
          console.error('[WebSocketService] Secure connection error:', error);
          console.error('[WebSocketService] Error type:', typeof error);
          console.error('[WebSocketService] Error keys:', error ? Object.keys(error) : 'null');
          
          // Detect certificate verification errors - check multiple error formats
          const errorString = (error?.message || error?.toString?.() || JSON.stringify(error) || '').toLowerCase();
          console.log('[WebSocketService] Error string for detection:', errorString);
          
          const isCertError = 
            errorString.includes('certificate') ||
            errorString.includes('ssl') ||
            errorString.includes('tls') ||
            errorString.includes('cert_') ||
            errorString.includes('trust anchor') ||
            errorString.includes('self signed') ||
            errorString.includes('unable to verify') ||
            // Assume any wss:// connection error is cert-related
            true; // Temporary: treat ALL wss errors as potential cert errors
          
          // Clean up failed connection
          wss.onopen = null;
          wss.onmessage = null;
          wss.onerror = null;
          wss.onclose = null;
          this.wss = null;
          
          if (isCertError) {
            console.log('[WebSocketService] Certificate verification failed - emitting event');
            this.emit('cert:verification_failed', error);
          } else {
            this.emit('error', error);
          }
          reject(error);
        };

        
        wss.onclose = (event) => {
          clearTimeout(connectionTimeout);
          console.log('[WebSocketService] Secure connection closed, code:', event.code);
          
          // Only emit disconnected if this is still our current connection
          if (this.wss === wss) {
            this.wss = null;
            this.emit('disconnected:secure');
          }
        };
        
        // Only assign to this.wss after all handlers are set up
        this.wss = wss;
      } catch (error) {
        console.error('[WebSocketService] Failed to create WSS connection:', error);
        this.wss = null;
        reject(error);
      }
    });
  }

  /**
   * Connect using self-signed certificate library (insecure SSL mode)
   * This trusts the self-signed certificate without validation
   */
  async connectSecureInsecure(): Promise<void> {
    const jwt = await AsyncStorage.getItem('harmony_jwt');
    const wssUrl = await AsyncStorage.getItem('harmony_wss_url');
    
    if (!jwt || !wssUrl) {
      const error = new Error('No JWT credentials available');
      console.error('[WebSocketService]', error.message);
      throw error;
    }
    
    // Close existing connections
    if (this.wssSelfSigned) {
      console.log('[WebSocketService] Closing existing self-signed WSS connection');
      try {
        this.wssSelfSigned.close();
      } catch (err) {
        console.warn('[WebSocketService] Error closing self-signed connection:', err);
      }
      this.wssSelfSigned = null;
    }
    
    if (this.wss) {
      console.log('[WebSocketService] Closing existing WSS connection');
      const oldWss = this.wss;
      oldWss.onopen = null;
      oldWss.onmessage = null;
      oldWss.onerror = null;
      oldWss.onclose = null;
      oldWss.close();
      this.wss = null;
    }
    
    if (this.ws) {
      console.log('[WebSocketService] Closing insecure WS connection before self-signed WSS attempt');
      const oldWs = this.ws;
      oldWs.onopen = null;
      oldWs.onmessage = null;
      oldWs.onerror = null;
      oldWs.onclose = null;
      oldWs.close();
      this.ws = null;
    }

    console.log('[WebSocketService] Connecting with self-signed cert library to:', wssUrl);
    
    return new Promise((resolve, reject) => {
      // Set a timeout for the connection attempt
      const connectionTimeout = setTimeout(() => {
        console.error('[WebSocketService] Self-signed WSS connection timeout');
        if (this.wssSelfSigned) {
          try {
            this.wssSelfSigned.close();
          } catch (err) {
            console.warn('[WebSocketService] Error closing timed-out connection:', err);
          }
          this.wssSelfSigned = null;
        }
        reject(new Error('Self-signed secure connection timeout'));
      }, 10000); // 10 second timeout
      
      try {
        const ws = WebSocketWithSelfSignedCert.getInstance(wssUrl);
        
        ws.onOpen(() => {
          clearTimeout(connectionTimeout);
          console.log('[WebSocketService] Connected securely (self-signed)');
          
          // Setup sync listeners after connection is established
          this.setupSyncListeners();
          
          this.emit('connected:secure');
          resolve();
        });
        
        ws.onMessage((message: string) => {
          // Parse and route the message
          this.handleMessage({ data: message });
        });
        
        ws.onClose(() => {
          clearTimeout(connectionTimeout);
          console.log('[WebSocketService] Self-signed connection closed');
          if (this.wssSelfSigned === ws) {
            this.wssSelfSigned = null;
            this.emit('disconnected:secure');
          }
        });
        
        ws.onError((err: string) => {
          clearTimeout(connectionTimeout);
          console.error('[WebSocketService] Self-signed connection error:', err);
          
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
            console.log('[WebSocketService] Self-signed connection established');
            this.wssSelfSigned = ws;
          })
          .catch((err: any) => {
            clearTimeout(connectionTimeout);
            console.error('[WebSocketService] Failed to connect with self-signed library:', err);
            
            // Clean up
            if (this.wssSelfSigned === ws) {
              this.wssSelfSigned = null;
            }
            
            this.emit('error', err);
            reject(err);
          });
          
      } catch (error) {
        clearTimeout(connectionTimeout);
        console.error('[WebSocketService] Failed to initialize self-signed connection:', error);
        this.wssSelfSigned = null;
        reject(error);
      }
    });
  }

  private handleMessage(event: any): void {
    try {
      const data = JSON.parse(event.data);
      console.log('[WebSocketService] Received event:', data.event_type, 'status:', data.status);
      
      // Check if event has ERROR status
      if (data.status === 'ERROR') {
        console.error('[WebSocketService] Received ERROR event:', data);
        const errorMsg = data.payload?.message || data.payload?.error || 'An error occurred';
        this.emit('error', { message: errorMsg, event: data });
      }
      
      // Route sync and handshake events to SyncService
      if (data.event_type?.startsWith('SYNC_') || data.event_type?.startsWith('HANDSHAKE_')) {
        this.routeSyncEvent(data);
        return;
      }
      
      // Emit other events for general handling
      this.emit('event', data);
    } catch (error) {
      console.error('[WebSocketService] Error parsing message:', error);
    }
  }

  private routeSyncEvent(event: any): void {
    const syncService = SyncService.getInstance();
    
    console.log('[WebSocketService] Routing sync event:', event.event_type);
    
    switch (event.event_type) {
      case 'HANDSHAKE_PENDING':
        console.log('[WebSocketService] Handshake pending approval');
        syncService.emit('handshake:pending', event.payload);
        break;
        
      case 'HANDSHAKE_ACCEPT':
        console.log('[WebSocketService] Handshake accepted');
        syncService.handleHandshakeAccept(event.payload);
        break;
        
      case 'HANDSHAKE_REJECT':
        console.log('[WebSocketService] Handshake rejected');
        syncService.emit('handshake:rejected', event.payload);
        break;
        
      case 'SYNC_ACCEPT':
        console.log('[WebSocketService] Sync accepted');
        syncService.handleSyncAccept(event.payload);
        break;
        
      case 'SYNC_REJECT':
        console.log('[WebSocketService] Sync rejected');
        syncService.emit('sync:rejected', event.payload);
        break;
        
      case 'SYNC_DATA':
        console.log('[WebSocketService] Received sync data');
        syncService.handleIncomingSyncData(event.payload);
        break;
        
      case 'SYNC_DATA_CONFIRM':
        console.log('[WebSocketService] Received sync data confirmation');
        syncService.handleSyncDataConfirm(event.payload);
        break;
        
      case 'SYNC_COMPLETE':
        console.log('[WebSocketService] Sync complete');
        syncService.handleSyncComplete();
        break;
        
      case 'SYNC_FINALIZE':
        console.log('[WebSocketService] Sync finalize');
        syncService.handleSyncFinalize();
        break;
        
      default:
        console.warn(`[WebSocketService] Unhandled sync event type: ${event.event_type}`);
        this.emit('sync:unknown_event', event);
    }
  }

  async sendEvent(event: any): Promise<void> {
    // Check for self-signed connection first
    if (this.wssSelfSigned) {
      try {
        const message = JSON.stringify(event);
        console.log('[WebSocketService] Sending event via self-signed:', event.event_type);
        this.wssSelfSigned.send(message);
        return;
      } catch (error) {
        console.error('[WebSocketService] Error sending event via self-signed:', error);
        this.emit('error', error);
        throw error;
      }
    }
    
    // Fall back to regular connections
    const connection = this.wss || this.ws;
    
    if (!connection) {
      const error = new Error('No WebSocket connection available');
      console.error('[WebSocketService]', error.message);
      this.emit('error', error);
      throw error;
    }
    
    if (connection.readyState !== WebSocket.OPEN) {
      const error = new Error(`WebSocket not ready (state: ${connection.readyState})`);
      console.error('[WebSocketService]', error.message);
      this.emit('error', error);
      throw error;
    }
    
    try {
      const message = JSON.stringify(event);
      console.log('[WebSocketService] Sending event:', event.event_type);
      connection.send(message);
    } catch (error) {
      console.error('[WebSocketService] Error sending event:', error);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Check if currently connected (either WS or WSS)
   */
  isConnected(): boolean {
    if (this.wssSelfSigned) {
      return true; // Self-signed library doesn't expose readyState
    }
    const connection = this.wss || this.ws;
    return connection !== null && connection.readyState === WebSocket.OPEN;
  }

  /**
   * Check if securely connected (WSS or self-signed WSS)
   */
  isSecurelyConnected(): boolean {
    if (this.wssSelfSigned) {
      return true;
    }
    return this.wss !== null && this.wss.readyState === WebSocket.OPEN;
  }

  /**
   * Disconnect all connections
   */
  disconnect(): void {
    console.log('[WebSocketService] Disconnecting all connections');
    
    // Cleanup sync listeners when disconnecting
    this.cleanupSyncListeners();
    
    if (this.wssSelfSigned) {
      try {
        this.wssSelfSigned.close();
      } catch (err) {
        console.warn('[WebSocketService] Error closing self-signed connection:', err);
      }
      this.wssSelfSigned = null;
    }
    
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export default WebSocketService.getInstance();
