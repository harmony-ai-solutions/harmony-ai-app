import EventEmitter from 'eventemitter3';
import { WebSocketConnection } from './websocket/WebSocketConnection';
import { WebSocketConnectionFactory } from './websocket/WebSocketConnectionFactory';

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
  private currentConnection: WebSocketConnection | null = null;
  private currentMode: 'unencrypted' | 'secure' | 'insecure-ssl' | null = null;
  
  static getInstance(): WebSocketService {
    if (!WebSocketService.instance) {
      WebSocketService.instance = new WebSocketService();
    }
    return WebSocketService.instance;
  }

  constructor() {
    super();
  }

  async connect(url: string, mode: 'unencrypted' | 'secure' | 'insecure-ssl'): Promise<void> {
    // Disconnect any existing connection first
    if (this.currentConnection) {
      this.disconnect();
    }
    
    // Store the current mode for proper event emission
    this.currentMode = mode;
    
    // Create new connection based on mode
    this.currentConnection = WebSocketConnectionFactory.createConnection(mode);
    
    // Set up event listeners for the new connection
    this.setupConnectionListeners(this.currentConnection);
    
    try {
      await this.currentConnection.connect(url);
      
      // Emit appropriate connection event based on mode
      if (mode === 'unencrypted') {
        this.emit('connected');
      } else {
        this.emit('connected:secure');
      }
    } catch (error) {
      console.error('[RefactoredWebSocketService] Connection failed:', error);
      this.emit('error', error);
      throw error;
    }
  }

  private setupConnectionListeners(connection: WebSocketConnection) {
    // Remove any existing listeners
    connection.off('connected', () => {});
    connection.off('disconnected', () => {});
    connection.off('error', () => {});
    connection.off('cert:verification_failed', () => {});
    connection.off('event', () => {});
    connection.off('sync:unknown_event', () => {});
    
    // Set up new listeners
    connection.on('connected', () => {
      console.log('[RefactoredWebSocketService] Connected (insecure)');
      this.emit('connected');
    });
    
    connection.on('disconnected', () => {
      console.log('[RefactoredWebSocketService] Disconnected');
      
      // Emit appropriate disconnected event based on mode
      if (this.currentMode === 'unencrypted') {
        this.emit('disconnected');
      } else {
        this.emit('disconnected:secure');
      }
    });
    
    connection.on('error', (error) => {
      console.error('[RefactoredWebSocketService] Connection error:', error);
      this.emit('error', error);
    });
    
    connection.on('cert:verification_failed', (error) => {
      console.error('[RefactoredWebSocketService] Certificate verification failed:', error);
      this.emit('cert:verification_failed', error);
    });
    
    connection.on('event', (data) => {
      console.log('[RefactoredWebSocketService] Forwarding event:', data.event_type);
      this.emit('event', data);
    });
    
    connection.on('sync:unknown_event', (event) => {
      console.log('[RefactoredWebSocketService] Forwarding unknown sync event');
      this.emit('sync:unknown_event', event);
    });
  }

  async sendEvent(event: any): Promise<void> {
    if (!this.currentConnection) {
      const error = new Error('No WebSocket connection available');
      console.error('[RefactoredWebSocketService]', error.message);
      this.emit('error', error);
      throw error;
    }
    
    try {
      await this.currentConnection.sendEvent(event);
    } catch (error) {
      console.error('[RefactoredWebSocketService] Error sending event:', error);
      this.emit('error', error);
      throw error;
    }
  }

  isConnected(): boolean {
    return this.currentConnection !== null && this.currentConnection.isConnected();
  }

  disconnect(): void {
    console.log('[RefactoredWebSocketService] Disconnecting all connections');
    
    if (this.currentConnection) {
      this.currentConnection.disconnect();
      this.currentConnection = null;
    }
    
    // Emit appropriate disconnected event based on mode
    if (this.currentMode === 'unencrypted') {
      this.emit('disconnected');
    } else if (this.currentMode) {
      this.emit('disconnected:secure');
    }
    
    // Clear mode after disconnect
    this.currentMode = null;
  }
}

export default WebSocketService.getInstance();
