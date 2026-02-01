import EventEmitter from 'eventemitter3';
import { WebSocketConnection } from '../websocket/WebSocketConnection';
import { WebSocketConnectionFactory } from '../websocket/WebSocketConnectionFactory';
import { createLogger } from '../../utils/logger';

const log = createLogger('[ConnectionManager]');

export type ConnectionType = 'sync' | 'entity';
export type ConnectionMode = 'unencrypted' | 'secure' | 'insecure-ssl';
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'error';

export interface ConnectionInfo {
  id: string;                          // 'sync' | 'entity-{entityId}'
  type: ConnectionType;
  entityId?: string;
  connection: WebSocketConnection;
  mode: ConnectionMode;
  url: string;
  status: ConnectionStatus;
  createdAt: number;
  lastActivity: number;
  lastHeartbeat?: number;
}

interface ConnectionManagerEvents {
  // Connection lifecycle events (global)
  'connection:created': (id: string, type: ConnectionType) => void;
  'connection:connected': (id: string) => void;
  'connection:disconnected': (id: string) => void;
  'connection:error': (id: string, error: any) => void;
  'cert:verification_failed': (error: any) => void; // Added for sync connection cert errors
  
  // Connection-specific events (routed by ID)
  'connected:sync': () => void;
  'disconnected:sync': () => void;
  'error:sync': (error: any) => void;
  'event:sync': (data: any) => void;
  
  'connected:entity': (entityId: string) => void;
  'disconnected:entity': (entityId: string) => void;
  'error:entity': (entityId: string, error: any) => void;
  'event:entity': (entityId: string, data: any) => void;
}

export class ConnectionManager extends EventEmitter<ConnectionManagerEvents> {
  private static instance: ConnectionManager;
  private connections: Map<string, ConnectionInfo> = new Map();
  
  private constructor() {
    super();
    log.info('Initialized');
  }
  
  static getInstance(): ConnectionManager {
    if (!ConnectionManager.instance) {
      ConnectionManager.instance = new ConnectionManager();
    }
    return ConnectionManager.instance;
  }
  
  /**
   * Create a new WebSocket connection
   * @param id - Unique connection identifier ('sync' or 'entity-{entityId}')
   * @param type - Connection type ('sync' or 'entity')
   * @param url - WebSocket URL (ws:// or wss://)
   * @param mode - Security mode
   * @param entityId - Entity ID (required for entity connections)
   */
  async createConnection(
    id: string,
    type: ConnectionType,
    url: string,
    mode: ConnectionMode,
    entityId?: string
  ): Promise<void> {
    // Validate entity connection parameters
    if (type === 'entity' && !entityId) {
      throw new Error('entityId required for entity connections');
    }
    
    // Check if connection already exists
    if (this.connections.has(id)) {
      log.warn(`Connection ${id} already exists, disconnecting first`);
      this.disconnectConnection(id);
    }
    
    log.info(`Creating ${type} connection: ${id}`);
    
    // Create WebSocket connection using factory
    const connection = WebSocketConnectionFactory.createConnection(mode);
    
    // Create connection info
    const connectionInfo: ConnectionInfo = {
      id,
      type,
      entityId,
      connection,
      mode,
      url,
      status: 'connecting',
      createdAt: Date.now(),
      lastActivity: Date.now()
    };
    
    // Store connection
    this.connections.set(id, connectionInfo);
    
    // Setup event listeners for this connection
    this.setupConnectionListeners(id, connection);
    
    // Emit creation event
    this.emit('connection:created', id, type);
    
    try {
      // Attempt connection
      await connection.connect(url);
      
      // Update status
      connectionInfo.status = 'connected';
      connectionInfo.lastActivity = Date.now();
      
      log.info(`Connection ${id} established`);
    } catch (error) {
      log.error(`Failed to connect ${id}:`, error);
      connectionInfo.status = 'error';
      this.emit('connection:error', id, error);
      throw error;
    }
  }
  
  private setupConnectionListeners(connectionId: string, connection: WebSocketConnection): void {
    // We use a closure here to capture the info at the time of the event
    let heartbeatStarted = false;
    
    // Connected event
    connection.on('connected', () => {
      const info = this.connections.get(connectionId);
      if (!info) return;

      log.info(`${connectionId} connected`);
      info.status = 'connected';
      info.lastActivity = Date.now();
      
      this.emit('connection:connected', connectionId);
      
      // Emit type-specific event
      if (info.type === 'sync') {
        this.emit('connected:sync');
      } else if (info.type === 'entity' && info.entityId) {
        this.emit('connected:entity', info.entityId);
      }
    });
    
    // Disconnected event
    connection.on('disconnected', () => {
      const info = this.connections.get(connectionId);
      if (!info) return;

      log.info(`${connectionId} disconnected`);
      info.status = 'disconnected';
      
      this.emit('connection:disconnected', connectionId);
      
      // Emit type-specific event
      if (info.type === 'sync') {
        this.emit('disconnected:sync');
      } else if (info.type === 'entity' && info.entityId) {
        this.emit('disconnected:entity', info.entityId);
      }
    });
    
    // Error event
    connection.on('error', (error: any) => {
      const info = this.connections.get(connectionId);
      if (!info) return;

      log.error(`${connectionId} error:`, error);
      info.status = 'error';
      
      this.emit('connection:error', connectionId, error);

      // Check if this is a heartbeat timeout
      const isHeartbeatTimeout = error?.code === 'HEARTBEAT_TIMEOUT' || 
                                 error?.message?.includes('heartbeat timeout');

      if (isHeartbeatTimeout) {
        log.warn(`${connectionId} heartbeat timeout detected, marking as disconnected`);
        info.lastHeartbeat = Date.now();
        
        // Treat heartbeat timeout as a disconnection
        // This will trigger reconnection logic in SyncConnectionContext
        info.status = 'disconnected';
        
        // Emit disconnected event to trigger reconnect
        this.emit('connection:disconnected', connectionId);
        
        // Emit type-specific disconnect event
        if (info.type === 'sync') {
          this.emit('disconnected:sync');
        } else if (info.type === 'entity' && info.entityId) {
          this.emit('disconnected:entity', info.entityId);
        }
      } else {
        // Emit type-specific error for non-heartbeat errors
        if (info.type === 'sync') {
          this.emit('error:sync', error);
        } else if (info.type === 'entity' && info.entityId) {
          this.emit('error:entity', info.entityId, error);
        }
      }
    });

    // Cert verification failed event
    connection.on('cert:verification_failed', (error: any) => {
      log.info(`${connectionId} cert verification failed`);
      this.emit('cert:verification_failed', error);
    });
    
    // Message/Event routing
    connection.on('event', (data: any) => {
      const info = this.connections.get(connectionId);
      if (!info) return;

      info.lastActivity = Date.now();
      
      log.info(`${connectionId} received event: ${data.event_type}`);
      
      // Start heartbeat after first successful event (application protocol is ready)
      if (!heartbeatStarted) {
        log.info(`${connectionId} starting heartbeat after first event`);
        connection.startHeartbeat();
        heartbeatStarted = true;
      }
      
      // Route to appropriate handler
      if (info.type === 'sync') {
        this.emit('event:sync', data);
      } else if (info.type === 'entity' && info.entityId) {
        this.emit('event:entity', info.entityId, data);
      }
    });

  }
  
  getConnection(id: string): ConnectionInfo | null {
    return this.connections.get(id) || null;
  }
  
  isConnected(id: string): boolean {
    const conn = this.connections.get(id);
    return conn?.status === 'connected' && conn.connection.isConnected();
  }
  
  getSyncConnection(): ConnectionInfo | null {
    return this.connections.get('sync') || null;
  }
  
  getEntityConnection(entityId: string): ConnectionInfo | null {
    return this.connections.get(`entity-${entityId}`) || null;
  }
  
  getAllEntityConnections(): ConnectionInfo[] {
    return Array.from(this.connections.values()).filter(conn => conn.type === 'entity');
  }
  
  async sendEvent(connectionId: string, event: any): Promise<void> {
    const conn = this.connections.get(connectionId);
    
    if (!conn) {
      throw new Error(`Connection ${connectionId} not found`);
    }
    
    if (!conn.connection.isConnected()) {
      const error = new Error(`Connection ${connectionId} is not connected`);
      log.error(error.message);
      
      // Emit error which will trigger reconnection logic
      this.emit('connection:error', connectionId, { 
        message: error.message,
        code: 'NOT_CONNECTED' 
      });
      throw error;
    }
    
    log.info(`Sending event via ${connectionId}: ${event.event_type}`);
    conn.lastActivity = Date.now();
    
    try {
      await conn.connection.sendEvent(event);
    } catch (sendError) {
      log.error(`Failed to send event via ${connectionId}:`, sendError);
      
      // Emit error to trigger reconnection
      this.emit('connection:error', connectionId, {
        message: 'Failed to send event',
        code: 'SEND_FAILED',
        originalError: sendError
      });
      
      // Re-throw so caller knows it failed
      throw sendError;
    }
  }
  
  disconnectConnection(id: string): void {
    const conn = this.connections.get(id);
    
    if (!conn) {
      log.warn(`Connection ${id} not found`);
      return;
    }
    
    log.info(`Disconnecting ${id}`);
    
    // Remove all event listeners to prevent memory leaks and duplicate events
    conn.connection.removeAllListeners();
    
    // Disconnect the connection
    conn.connection.disconnect();
    
    // Remove from map
    this.connections.delete(id);
  }
  
  disconnectByType(type: ConnectionType): void {
    log.info(`Disconnecting all ${type} connections`);
    const toDisconnect = Array.from(this.connections.entries())
      .filter(([_, conn]) => conn.type === type)
      .map(([id, _]) => id);
    
    toDisconnect.forEach(id => this.disconnectConnection(id));
  }
  
  disconnectAll(): void {
    log.info('Disconnecting all connections');
    const ids = Array.from(this.connections.keys());
    ids.forEach(id => this.disconnectConnection(id));
  }
}

// Export singleton instance as named export to avoid circular dependency issues
const connectionManagerInstance = ConnectionManager.getInstance();
export { connectionManagerInstance as default };
