import EventEmitter from 'eventemitter3';
import DeviceInfo from 'react-native-device-info';
import { Platform } from 'react-native';
import ConnectionManager from './connection/ConnectionManager';
import ConnectionStateManager from './ConnectionStateManager';
import { createLogger } from '../utils/logger';

const log = createLogger('[EntitySessionService]');

export interface EntitySession {
  sessionId: string;              // From backend after ENTITY_SESSION_ACCEPT
  connectionId: string;           // 'entity-{entityId}'
  entityId: string;
  characterId: string;
  deviceType: string;
  deviceId: string;
  capabilities: string[];
  connectedAt: number;
  lastActivity: number;
  status: 'connecting' | 'active' | 'disconnected';
}

interface EntitySessionEvents {
  'session:started': (session: EntitySession) => void;
  'session:stopped': (entityId: string) => void;
  'session:error': (entityId: string, error: string) => void;
  'message:received': (entityId: string, message: any) => void;
  'entity:state_update': (entityId: string, state: any) => void;
  'typing:indicator': (entityId: string, isTyping: boolean) => void;
}

export class EntitySessionService extends EventEmitter<EntitySessionEvents> {
  private static instance: EntitySessionService;
  private connectionManager: typeof ConnectionManager;
  private sessions: Map<string, EntitySession> = new Map();
  
  private constructor() {
    super();
    this.connectionManager = ConnectionManager;
    this.setupConnectionListeners();
  }
  
  static getInstance(): EntitySessionService {
    if (!EntitySessionService.instance) {
      EntitySessionService.instance = new EntitySessionService();
    }
    return EntitySessionService.instance;
  }
  
  private setupConnectionListeners() {
    // Listen to entity connection events
    this.connectionManager.on('connected:entity', this.handleEntityConnected.bind(this));
    this.connectionManager.on('disconnected:entity', this.handleEntityDisconnected.bind(this));
    this.connectionManager.on('error:entity', this.handleEntityError.bind(this));
    this.connectionManager.on('event:entity', this.handleEntityEvent.bind(this));
  }
  
  async startEntitySession(entityId: string, characterId: string): Promise<EntitySession> {
    // Check if sync connection is active
    if (!this.connectionManager.isConnected('sync')) {
      throw new Error('Sync connection required for entity sessions');
    }
    
    // Check if session already exists
    if (this.sessions.has(entityId)) {
      log.warn(`Session for ${entityId} already exists`);
      return this.sessions.get(entityId)!;
    }
    
    log.info(`Starting session for entity ${entityId}`);
    
    const deviceId = await DeviceInfo.getUniqueId();
    const connectionId = `entity-${entityId}`;
    
    // Create session object
    const session: EntitySession = {
      sessionId: '', // Will be set after backend accepts
      connectionId,
      entityId,
      characterId,
      deviceType: 'harmony_app',
      deviceId,
      capabilities: ['chat', 'voice', 'expressions'],
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      status: 'connecting'
    };
    
    this.sessions.set(entityId, session);
    
    // Get connection URL and mode from ConnectionStateManager
    const mode = await ConnectionStateManager.getSecurityMode() || 'secure';
    const url = mode === 'unencrypted' 
      ? await ConnectionStateManager.getWSUrl()
      : await ConnectionStateManager.getWSSUrl();
    
    if (!url) {
      throw new Error('No connection URL available');
    }
    
    try {
      // Create WebSocket connection for entity
      await this.connectionManager.createConnection(
        connectionId,
        'entity',
        url,
        mode as any,
        entityId
      );
      
      // Send ENTITY_SESSION_START event
      await this.sendSessionStart(session);
      
      return session;
    } catch (error) {
      log.error(`Failed to start session for ${entityId}:`, error);
      this.sessions.delete(entityId);
      throw error;
    }
  }
  
  private async sendSessionStart(session: EntitySession): Promise<void> {
    const event = {
      event_id: this.generateEventId(),
      event_type: 'ENTITY_SESSION_START',
      status: 'NEW',
      payload: {
        entity_id: session.entityId,
        character_id: session.characterId,
        device_id: session.deviceId,
        device_type: session.deviceType,
        device_platform: Platform.OS,
        capabilities: session.capabilities
      }
    };
    
    await this.connectionManager.sendEvent(session.connectionId, event);
  }
  
  async stopEntitySession(entityId: string): Promise<void> {
    const session = this.sessions.get(entityId);
    
    if (!session) {
      log.warn(`No session found for ${entityId}`);
      return;
    }
    
    log.info(`Stopping session for entity ${entityId}`);
    
    try {
      // Send session end event if connected
      if (this.connectionManager.isConnected(session.connectionId)) {
        await this.sendSessionEnd(session);
      }
    } catch (error) {
      log.error('Error sending session end:', error);
    } finally {
      // Disconnect and cleanup
      this.connectionManager.disconnectConnection(session.connectionId);
      session.status = 'disconnected';
      this.sessions.delete(entityId);
      this.emit('session:stopped', entityId);
    }
  }
  
  private async sendSessionEnd(session: EntitySession): Promise<void> {
    const event = {
      event_id: this.generateEventId(),
      event_type: 'ENTITY_SESSION_END',
      status: 'NEW',
      payload: {
        session_id: session.sessionId,
        entity_id: session.entityId
      }
    };
    
    await this.connectionManager.sendEvent(session.connectionId, event);
  }
  
  async sendChatMessage(entityId: string, message: string): Promise<void> {
    const session = this.sessions.get(entityId);
    
    if (!session) {
      throw new Error(`No active session for entity ${entityId}`);
    }
    
    if (session.status !== 'active') {
      throw new Error(`Session for entity ${entityId} is not active`);
    }
    
    const event = {
      event_id: this.generateEventId(),
      event_type: 'CHAT_MESSAGE',
      status: 'NEW',
      payload: {
        session_id: session.sessionId,
        entity_id: entityId,
        text: message,
        timestamp: Math.floor(Date.now() / 1000)
      }
    };
    
    await this.connectionManager.sendEvent(session.connectionId, event);
    session.lastActivity = Date.now();
  }
  
  getActiveSession(entityId: string): EntitySession | null {
    return this.sessions.get(entityId) || null;
  }
  
  private handleEntityConnected(entityId: string): void {
    log.info(`Entity ${entityId} connected`);
    // Connection is established, waiting for SESSION_ACCEPT
  }
  
  private handleEntityDisconnected(entityId: string): void {
    log.info(`Entity ${entityId} disconnected`);
    const session = this.sessions.get(entityId);
    if (session) {
      session.status = 'disconnected';
      this.emit('session:stopped', entityId);
    }
  }
  
  private handleEntityError(entityId: string, error: any): void {
    log.error(`Entity ${entityId} error:`, error);
    this.emit('session:error', entityId, error.message || 'Connection error');
  }
  
  private handleEntityEvent(entityId: string, event: any): void {
    const session = this.sessions.get(entityId);
    if (!session) return;
    
    session.lastActivity = Date.now();
    
    log.info(`Entity ${entityId} event: ${event.event_type}`);
    
    switch (event.event_type) {
      case 'ENTITY_SESSION_ACCEPT':
        session.sessionId = event.payload.session_id;
        session.status = 'active';
        this.emit('session:started', session);
        break;
        
      case 'CHAT_MESSAGE':
        this.emit('message:received', entityId, event.payload);
        break;
        
      case 'ENTITY_STATE_UPDATE':
        this.emit('entity:state_update', entityId, event.payload);
        break;
        
      case 'TYPING_INDICATOR':
        this.emit('typing:indicator', entityId, event.payload.is_typing);
        break;
        
      default:
        log.warn(`Unhandled event: ${event.event_type}`);
    }
  }
  
  private generateEventId(): string {
    return `entity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export default EntitySessionService.getInstance();
