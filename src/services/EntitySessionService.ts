import EventEmitter from 'eventemitter3';
import DeviceInfo from 'react-native-device-info';
import { Platform, AppState } from 'react-native';
import { Buffer } from 'buffer';
import ConnectionManager, { ConnectionMode } from './connection/ConnectionManager';
import ConnectionStateManager from './ConnectionStateManager';
import { createLogger } from '../utils/logger';
import { messageExists, createChatMessage } from '../database/repositories/chat_messages';
import { SyncService } from './SyncService';
import AudioPlayer from './AudioPlayer';

const log = createLogger('[EntitySessionService]');

// polyfill for btoa in React Native
const btoa = (data: string) => Buffer.from(data, 'binary').toString('base64');

export interface DualEntitySession {
  userSession: EntitySession;      // The entity user impersonates
  partnerSession: EntitySession;   // The entity being chatted with
  partnerEntityId: string;
  impersonatedEntityId: string;
}

export interface EntitySession {
  sessionId: string;              // From backend after INIT_ENTITY response
  connectionId: string;           // 'entity-{entityId}'
  entityId: string;
  deviceType: string;
  deviceId: string;
  capabilities: string[];
  connectedAt: number;
  lastActivity: number;
  status: 'connecting' | 'active' | 'disconnected';
}

interface EntitySessionEvents {
  'session:started': (partnerEntityId: string, session: DualEntitySession) => void;
  'session:stopped': (partnerEntityId: string) => void;
  'session:error': (partnerEntityId: string, error: string) => void;
  'message:received': (partnerEntityId: string, message: any) => void;
  'typing:indicator': (partnerEntityId: string, entityId: string, isTyping: boolean) => void;
  'recording:indicator': (partnerEntityId: string, entityId: string, isRecording: boolean) => void;
}

export class EntitySessionService extends EventEmitter<EntitySessionEvents> {
  private static instance: EntitySessionService;
  private connectionManager: typeof ConnectionManager;
  private sessions: Map<string, DualEntitySession> = new Map();
  private appStateSubscription: any;
  
  private constructor() {
    super();
    this.connectionManager = ConnectionManager;
    this.setupConnectionListeners();
    this.setupAppStateListener();
  }
  
  static getInstance(): EntitySessionService {
    if (!EntitySessionService.instance) {
      EntitySessionService.instance = new EntitySessionService();
    }
    return EntitySessionService.instance;
  }
  
  private setupAppStateListener() {
    // Close sessions when app goes to background
    this.appStateSubscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'background') {
        log.info('App going to background, closing all entity sessions');
        this.closeAllSessions();
      }
    });
  }
  
  private setupConnectionListeners() {
    this.connectionManager.on('event:entity', this.handleEntityEvent.bind(this));
  }
  
  /**
   * Initialize dual entity session for chat
   * Creates sessions for BOTH user entity and partner entity
   */
  async startDualSession(
    partnerEntityId: string,
    impersonatedEntityId: string = 'user'
  ): Promise<DualEntitySession> {
    // Check if sync connection is active
    if (!this.connectionManager.isConnected('sync')) {
      throw new Error('Sync connection required for entity sessions');
    }
    
    // Check if session already exists
    if (this.sessions.has(partnerEntityId)) {
      log.warn(`Session for ${partnerEntityId} already exists`);
      return this.sessions.get(partnerEntityId)!;
    }
    
    log.info(`Starting dual session: user=${impersonatedEntityId}, partner=${partnerEntityId}`);
    
    const deviceId = await DeviceInfo.getUniqueId();
    const mode = await ConnectionStateManager.getSecurityMode() || 'secure';
    const url = mode === 'unencrypted' 
      ? await ConnectionStateManager.getWSUrl()
      : await ConnectionStateManager.getWSSUrl();
    
    if (!url) {
      throw new Error('No connection URL available');
    }
    
    try {
      // Create User Session
      const userConnectionId = `entity-${impersonatedEntityId}`;
      const userSession = await this.initializeEntitySession(
        impersonatedEntityId,
        userConnectionId,
        deviceId,
        url,
        mode as any
      );
      
      // Create Partner Session
      const partnerConnectionId = `entity-${partnerEntityId}`;
      const partnerSession = await this.initializeEntitySession(
        partnerEntityId,
        partnerConnectionId,
        deviceId,
        url,
        mode as any
      );
      
      const dualSession: DualEntitySession = {
        userSession,
        partnerSession,
        partnerEntityId,
        impersonatedEntityId
      };
      
      this.sessions.set(partnerEntityId, dualSession);
      this.emit('session:started', partnerEntityId, dualSession);
      
      return dualSession;
    } catch (error) {
      log.error(`Failed to start dual session for ${partnerEntityId}:`, error);
      throw error;
    }
  }
  
  private async initializeEntitySession(
    entityId: string,
    connectionId: string,
    deviceId: string,
    url: string,
    mode: ConnectionMode
  ): Promise<EntitySession> {
    const session: EntitySession = {
      sessionId: '',
      connectionId,
      entityId,
      deviceType: 'harmony_app',
      deviceId,
      capabilities: ['chat', 'voice', 'images'],
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      status: 'connecting'
    };
    
    // Create WebSocket connection
    await this.connectionManager.createConnection(
      connectionId,
      'entity',
      url,
      mode,
      entityId
    );
    
    // Send INIT_ENTITY event
    await this.sendInitEntity(session);
    
    return session;
  }
  
  private async sendInitEntity(session: EntitySession): Promise<void> {
    const event = {
      event_id: this.generateEventId(),
      event_type: 'INIT_ENTITY',
      status: 'NEW',
      payload: {
        entity_id: session.entityId,
        device_type: session.deviceType,
        device_id: session.deviceId,
        device_platform: Platform.OS,
        capabilities: session.capabilities
      }
    };
    
    await this.connectionManager.sendEvent(session.connectionId, event);
  }
  
  async stopSession(partnerEntityId: string): Promise<void> {
    const dualSession = this.sessions.get(partnerEntityId);
    if (!dualSession) {
      log.warn(`No session found for ${partnerEntityId}`);
      return;
    }
    
    log.info(`Stopping session for ${partnerEntityId}`);
    
    try {
      // Stop any playing audio
      await AudioPlayer.stop();
      
      // Disconnect user session
      if (this.connectionManager.isConnected(dualSession.userSession.connectionId)) {
        await this.connectionManager.sendEvent(
          dualSession.userSession.connectionId,
          {
            event_id: this.generateEventId(),
            event_type: 'ENTITY_SESSION_END',
            status: 'NEW',
            payload: { session_id: dualSession.userSession.sessionId }
          }
        );
        this.connectionManager.disconnectConnection(dualSession.userSession.connectionId);
      }
      
      // Disconnect partner session
      if (this.connectionManager.isConnected(dualSession.partnerSession.connectionId)) {
        await this.connectionManager.sendEvent(
          dualSession.partnerSession.connectionId,
          {
            event_id: this.generateEventId(),
            event_type: 'ENTITY_SESSION_END',
            status: 'NEW',
            payload: { session_id: dualSession.partnerSession.sessionId }
          }
        );
        this.connectionManager.disconnectConnection(dualSession.partnerSession.connectionId);
      }
    } catch (error) {
      log.error('Error stopping session:', error);
    } finally {
      this.sessions.delete(partnerEntityId);
      this.emit('session:stopped', partnerEntityId);
    }
  }
  
  closeAllSessions(): void {
    const partnerIds = Array.from(this.sessions.keys());
    for (const partnerId of partnerIds) {
      this.stopSession(partnerId);
    }
  }
  
  /**
   * Send text message to partner entity
   */
  async sendTextMessage(
    partnerEntityId: string,
    text: string
  ): Promise<void> {
    const dualSession = this.sessions.get(partnerEntityId);
    if (!dualSession || dualSession.partnerSession.status !== 'active') {
      throw new Error(`No active session for entity ${partnerEntityId}`);
    }
    
    const utterance = {
      entity_id: dualSession.impersonatedEntityId,
      content: text,
      type: 'UTTERANCE_COMBINED'
    };
    
    await this.sendUtterance(dualSession.partnerSession.connectionId, utterance);
    dualSession.partnerSession.lastActivity = Date.now();
  }
  
  /**
   * Send audio message to partner entity
   */
  async sendAudioMessage(
    partnerEntityId: string,
    audioData: Uint8Array,
    mimeType: string,
    duration: number
  ): Promise<void> {
    const dualSession = this.sessions.get(partnerEntityId);
    if (!dualSession || dualSession.partnerSession.status !== 'active') {
      throw new Error(`No active session for entity ${partnerEntityId}`);
    }
    
    // Convert to base64 for event payload
    const base64Audio = btoa(String.fromCharCode(...audioData));
    
    const utterance = {
      entity_id: dualSession.impersonatedEntityId,
      content: '',
      type: 'UTTERANCE_COMBINED',
      audio: base64Audio,
      audio_type: mimeType,
      audio_duration: duration
    };
    
    await this.sendUtterance(dualSession.partnerSession.connectionId, utterance);
    dualSession.partnerSession.lastActivity = Date.now();
  }
  
  /**
   * Send image message to partner entity
   */
  async sendImageMessage(
    partnerEntityId: string,
    imageBase64: string,
    mimeType: string,
    caption?: string
  ): Promise<void> {
    const dualSession = this.sessions.get(partnerEntityId);
    if (!dualSession || dualSession.partnerSession.status !== 'active') {
      throw new Error(`No active session for entity ${partnerEntityId}`);
    }
    
    const utterance = {
      entity_id: dualSession.impersonatedEntityId,
      content: caption || '',
      type: 'UTTERANCE_COMBINED',
      image_data: imageBase64,
      image_mime_type: mimeType
    };
    
    await this.sendUtterance(dualSession.partnerSession.connectionId, utterance);
    dualSession.partnerSession.lastActivity = Date.now();
  }
  
  private async sendUtterance(connectionId: string, utterance: any): Promise<void> {
    const event = {
      event_id: this.generateEventId(),
      event_type: 'ENTITY_UTTERANCE',
      status: 'NEW',
      payload: utterance
    };
    
    await this.connectionManager.sendEvent(connectionId, event);
  }
  
  getSession(partnerEntityId: string): DualEntitySession | null {
    return this.sessions.get(partnerEntityId) || null;
  }
  
  private async handleEntityEvent(entityId: string, event: any): Promise<void> {
    // Find which dual session this belongs to
    let dualSession: DualEntitySession | null = null;
    let sessionType: 'user' | 'partner' | null = null;
    
    for (const [, session] of this.sessions) {
      if (session.userSession.entityId === entityId) {
        dualSession = session;
        sessionType = 'user';
        break;
      }
      if (session.partnerSession.entityId === entityId) {
        dualSession = session;
        sessionType = 'partner';
        break;
      }
    }
    
    if (!dualSession) {
      log.warn(`Received event for unknown entity: ${entityId}`);
      return;
    }
    
    // Update last activity
    if (sessionType === 'user') {
      dualSession.userSession.lastActivity = Date.now();
    } else {
      dualSession.partnerSession.lastActivity = Date.now();
    }
    
    log.info(`Entity ${entityId} event: ${event.event_type}`);
    
    switch (event.event_type) {
      case 'ENTITY_INFO': // Response to INIT_ENTITY
        if (sessionType === 'user') {
          dualSession.userSession.sessionId = event.payload.session_id;
          dualSession.userSession.status = 'active';
        } else {
          dualSession.partnerSession.sessionId = event.payload.session_id;
          dualSession.partnerSession.status = 'active';
        }
        // Only emit when both sessions are active
        if (dualSession.userSession.status === 'active' && 
            dualSession.partnerSession.status === 'active') {
          this.emit('session:started', dualSession.partnerEntityId, dualSession);
        }
        break;
        
      case 'ENTITY_UTTERANCE':
        // Convert utterance to chat message and save
        await this.handleIncomingUtterance(dualSession, event.payload);
        this.emit('message:received', dualSession.partnerEntityId, event.payload);
        break;
        
      case 'TYPING_INDICATOR':
        this.emit(
          'typing:indicator',
          dualSession.partnerEntityId,
          event.payload.entity_id,
          event.payload.is_typing
        );
        break;
        
      case 'RECORDING_INDICATOR':
        this.emit(
          'recording:indicator',
          dualSession.partnerEntityId,
          event.payload.entity_id,
          event.payload.is_recording
        );
        break;
        
      default:
        log.warn(`Unhandled event: ${event.event_type}`);
    }
  }
  
  private async handleIncomingUtterance(
    dualSession: DualEntitySession,
    utterance: any
  ): Promise<void> {
    // Check for duplicate
    const messageId = utterance.message_id || this.generateEventId();
    if (await messageExists(messageId)) {
      log.debug(`Message ${messageId} already exists, skipping`);
      return;
    }
    
    // Determine message type
    let messageType: 'text' | 'audio' | 'combined' | 'image' = 'text';
    if (utterance.image_data) {
      messageType = 'image';
    } else if (utterance.audio && utterance.content) {
      messageType = 'combined';
    } else if (utterance.audio) {
      messageType = 'audio';
    }
    
    // Convert base64 data to Uint8Array if present
    let imageData: Uint8Array | null = null;
    if (utterance.image_data) {
      imageData = new Uint8Array(Buffer.from(utterance.image_data, 'base64'));
    }
    
    let audioData: Uint8Array | null = null;
    if (utterance.audio) {
      audioData = new Uint8Array(Buffer.from(utterance.audio, 'base64'));
    }
    
    const message = {
      id: messageId,
      entity_id: dualSession.impersonatedEntityId,  // From user's perspective
      sender_entity_id: utterance.entity_id,         // Who sent it
      session_id: dualSession.partnerSession.sessionId,
      content: utterance.content || '',
      audio_duration: utterance.audio_duration || null,
      message_type: messageType,
      audio_data: audioData,
      audio_mime_type: utterance.audio_type || null,
      image_data: imageData,
      image_mime_type: utterance.image_mime_type || null,
      vl_model: null, // Will be populated by Harmony Link
      vl_model_interpretation: null,
      vl_model_embedding: null
    };
    
    await createChatMessage(message);

    // Trigger sync
    SyncService.getInstance().initiateSync();
  }
  
  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export default EntitySessionService.getInstance();
