import EventEmitter from 'eventemitter3';
import DeviceInfo from 'react-native-device-info';
import { Platform, AppState } from 'react-native';
import { Buffer } from 'buffer';
import ConnectionManager, { ConnectionMode } from './connection/ConnectionManager';
import ConnectionStateManager from './ConnectionStateManager';
import { createLogger } from '../utils/logger';
import { messageExists, createConversationMessage, updateConversationMessage, getConversationMessage } from '../database/repositories/conversation_messages';
import { SyncService } from './SyncService';
import AudioPlayer from './AudioPlayer';
import { uint8ArrayToBase64 } from '../database/base64';
import { v7 as uuidv7 } from 'uuid';

const log = createLogger('[EntitySessionService]');

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
  'transcription:completed': (partnerEntityId: string, messageId: string, text: string) => void;
  'transcription:failed': (partnerEntityId: string, messageId: string) => void;
}

export class EntitySessionService extends EventEmitter<EntitySessionEvents> {
  private static instance: EntitySessionService;
  private connectionManager: typeof ConnectionManager;
  private sessions: Map<string, DualEntitySession> = new Map();
  private pendingSessions: Map<string, EntitySession> = new Map(); // Track individual sessions during initialization
  private pendingTranscriptions: Map<string, {
    messageId: string;
    partnerEntityId: string;
    timeout: any;
  }> = new Map();
  private transcriptionStates: Map<string, 'pending' | 'failed'> = new Map(); // Track transcription state
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
      
      // Store the dual session
      this.sessions.set(partnerEntityId, dualSession);

      log.info(`Dual session created for partner ${partnerEntityId}, sessions are 'connecting'...`);
      log.info(`User session (${impersonatedEntityId}): ${userSession.status}`);
      log.info(`Partner session (${partnerEntityId}): ${partnerSession.status}`);

      // Note: 'session:started' event will be emitted from handleEntityEvent 
      // when both sessions transition to 'active' status
      
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
      sessionId: '', // Will be set when INIT_ENTITY response arrives
      connectionId,
      entityId,
      deviceType: 'harmony_app',
      deviceId,
      capabilities: ['chat', 'voice', 'images'],
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      status: 'connecting' // Starts as 'connecting', will become 'active' via event
    };
    
    try {
      // Store in pendingSessions immediately so handleEntityEvent can find it
      this.pendingSessions.set(entityId, session);
      log.info(`Stored pending session for ${entityId}`);
      
      // Create WebSocket connection
      await this.connectionManager.createConnection(
        connectionId,
        'entity',
        url,
        mode,
        entityId
      );

      log.info(`WebSocket connection established for ${entityId}, sending INIT_ENTITY...`);

      // Send INIT_ENTITY (fire and forget)
      await this.sendInitEntity(session);

      log.info(`INIT_ENTITY sent for ${entityId}, waiting for backend response via events...`);

      // Return session in 'connecting' state
      // It will transition to 'active' when handleEntityEvent processes the response
      return session;
    } catch (error) {
      log.error(`Failed to initialize entity session for ${entityId}:`, error);
      session.status = 'disconnected';

      // Clean up pending session and connection on failure
      this.pendingSessions.delete(entityId);
      if (this.connectionManager.isConnected(connectionId)) {
        this.connectionManager.disconnectConnection(connectionId);
      }

      throw error;
    }
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
        capabilities: session.capabilities,
        tts_output_type: 'binary' // Request binary audio output for mobile app
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
      
      // Clean up all pending transcriptions for this partner
      const transcriptionsToCleanup: string[] = [];
      for (const [messageId, request] of this.pendingTranscriptions.entries()) {
        if (request.partnerEntityId === partnerEntityId) {
          clearTimeout(request.timeout);
          transcriptionsToCleanup.push(messageId);
          this.transcriptionStates.set(messageId, 'failed');
        }
      }
      transcriptionsToCleanup.forEach(messageId => {
        this.pendingTranscriptions.delete(messageId);
      });
      
      if (transcriptionsToCleanup.length > 0) {
        log.info(`Marked ${transcriptionsToCleanup.length} pending transcriptions as failed for ${partnerEntityId}`);
      }
      
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
      
      // Clean up pending sessions if they exist
      this.pendingSessions.delete(dualSession.userSession.entityId);
      this.pendingSessions.delete(dualSession.partnerSession.entityId);
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
    
    // Generate UUID v7 for message ID (domain layer)
    const messageId = uuidv7();
    
    // Store message locally first (optimistic UI pattern)
    const message = {
      id: messageId,
      entity_id: dualSession.partnerEntityId,
      sender_entity_id: dualSession.impersonatedEntityId,
      session_id: dualSession.partnerSession.sessionId,
      content: text,
      audio_duration: null,
      message_type: 'text' as 'text',
      audio_data: null,
      audio_mime_type: null,
      image_data: null,
      image_mime_type: null,
      vl_model: null,
      vl_model_interpretation: null,
      vl_model_embedding: null
    };
    
    await createConversationMessage(message);
    log.info(`Stored text message ${messageId} locally`);
    
    // Send to partner entity with message_id
    const utterance = {
      message_id: messageId,
      entity_id: dualSession.impersonatedEntityId,
      content: text,
      type: 'UTTERANCE_COMBINED'
    };
    
    await this.sendUtterance(dualSession.partnerSession.connectionId, utterance);
    dualSession.partnerSession.lastActivity = Date.now();
  }

  /**
   * Create a new audio message (stores locally, requests transcription)
   * Does NOT send to partner - that happens via sendUtterance() after confirmation
   */
  async newAudioMessage(
    partnerEntityId: string,
    audioData: string,
    mimeType: string,
    duration: number
  ): Promise<string> {
    const dualSession = this.sessions.get(partnerEntityId);
    if (!dualSession || dualSession.partnerSession.status !== 'active') {
      throw new Error(`No active session for entity ${partnerEntityId}`);
    }
    
    log.info(`Starting audio message flow for ${partnerEntityId}`);
    
    const base64Audio = audioData;
    
    // Generate UUID v7 for message ID (domain layer)
    const messageId = uuidv7();
    
    const message = {
      id: messageId,
      entity_id: dualSession.partnerEntityId,
      sender_entity_id: dualSession.impersonatedEntityId,
      session_id: dualSession.partnerSession.sessionId,
      content: '',
      audio_duration: duration,
      message_type: 'audio' as 'audio',
      audio_data: base64Audio,
      audio_mime_type: mimeType,
      image_data: null,
      image_mime_type: null,
      vl_model: null,
      vl_model_interpretation: null,
      vl_model_embedding: null
    };
    
    await createConversationMessage(message);
    log.info(`Stored message ${messageId} in database (awaiting transcription)`);
    
    try {
      await this.requestTranscription(messageId, partnerEntityId, base64Audio);
    } catch (error) {
      log.error(`Failed to request transcription for ${messageId}:`, error);
    }
    
    return messageId;
  }

  private async requestTranscription(
    messageId: string,
    partnerEntityId: string,
    base64Audio: string
  ): Promise<void> {
    const dualSession = this.sessions.get(partnerEntityId);
    if (!dualSession) {
      throw new Error(`No session for ${partnerEntityId}`);
    }
    
    const eventId = this.generateEventId();
    
    const timeout = setTimeout(() => {
      log.warn(`Transcription timeout for message ${messageId}`);
      this.pendingTranscriptions.delete(messageId);
      this.transcriptionStates.set(messageId, 'failed');
      this.emit('transcription:failed', partnerEntityId, messageId);
    }, 30000);
    
    this.pendingTranscriptions.set(messageId, {
      messageId,
      partnerEntityId,
      timeout
    });
    
    this.transcriptionStates.set(messageId, 'pending');
    
    const event = {
      event_id: eventId,
      event_type: 'STT_INPUT_AUDIO',
      status: 'NEW',
      payload: {
        message_id: messageId,
        audio_data: {
          audio_bytes: base64Audio,
          channels: 1,
          bit_depth: 16,
          sample_rate: 16000
        },
        result_mode: 'return'
      }
    };
    
    await this.connectionManager.sendEvent(
      dualSession.userSession.connectionId,
      event
    );
    
    log.info(`Sent STT_INPUT_AUDIO for message ${messageId}, event ${eventId}`);
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
    
    // Generate UUID v7 for message ID
    const messageId = uuidv7();
    
    const utterance = {
      message_id: messageId,
      entity_id: dualSession.impersonatedEntityId,
      content: caption || '',
      type: 'UTTERANCE_COMBINED',
      image_data: imageBase64,
      image_mime_type: mimeType
    };
    
    await this.sendUtterance(dualSession.partnerSession.connectionId, utterance);
    dualSession.partnerSession.lastActivity = Date.now();
  }
  
  public async sendUtterance(connectionId: string, utterance: any): Promise<void> {
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
    log.debug(`handleEntityEvent called for entity ${entityId}, event type: ${event.event_type}, status: ${event.status}`);

    // First, try to find in pending sessions (for sessions still initializing)
    let targetSession = this.pendingSessions.get(entityId);
    let dualSession: DualEntitySession | null = null;

    if (!targetSession) {
      // Not in pending, search in active dual sessions
      for (const session of this.sessions.values()) {
        if (session.userSession.entityId === entityId) {
          dualSession = session;
          targetSession = session.userSession;
          break;
        } else if (session.partnerSession.entityId === entityId) {
          dualSession = session;
          targetSession = session.partnerSession;
          break;
        }
      }
    }

    if (!targetSession) {
      log.warn(`Received event for unknown entity ${entityId}`);
      return;
    }

    // Update last activity
    targetSession.lastActivity = Date.now();

    // Handle INIT_ENTITY responses (SUCCESS or ERROR)
    if (event.event_type === 'INIT_ENTITY') {
      if (event.status === 'SUCCESS') {
        log.info(`INIT_ENTITY SUCCESS for ${entityId}`);

        // Update session with backend response
        targetSession.sessionId = event.payload.session_id;
        targetSession.status = 'active';

        log.info(`Session activated: ${entityId} -> session_id=${event.payload.session_id}`);

        // Find the dual session this belongs to (may not exist yet if this is the first to complete)
        if (!dualSession) {
          // Search for dual session containing this entity
          for (const session of this.sessions.values()) {
            if (session.userSession.entityId === entityId || session.partnerSession.entityId === entityId) {
              dualSession = session;
              break;
            }
          }
        }

        // Check if we have a dual session and if BOTH sessions are now active
        if (dualSession) {
          if (dualSession.userSession.status === 'active' &&
            dualSession.partnerSession.status === 'active') {
            log.info(`Dual session fully active for partner ${dualSession.partnerEntityId}`);
            
            // Remove from pending sessions now that they're fully active
            this.pendingSessions.delete(dualSession.userSession.entityId);
            this.pendingSessions.delete(dualSession.partnerSession.entityId);
            
            this.emit('session:started', dualSession.partnerEntityId, dualSession);
          } else {
            log.info(`Dual session partially active: user=${dualSession.userSession.status}, partner=${dualSession.partnerSession.status}`);
          }
        } else {
          log.info(`Session ${entityId} activated, waiting for dual session to be created`);
        }

        return; // INIT_ENTITY response handled, don't process further
      } else if (event.status === 'ERROR') {
        log.error(`INIT_ENTITY ERROR for ${entityId}:`, event.payload);

        // Mark session as failed
        targetSession.status = 'disconnected';
        
        // Remove from pending sessions
        this.pendingSessions.delete(entityId);

        // Find the dual session if it exists
        if (!dualSession) {
          for (const session of this.sessions.values()) {
            if (session.userSession.entityId === entityId || session.partnerSession.entityId === entityId) {
              dualSession = session;
              break;
            }
          }
        }

        if (dualSession) {
          // Emit error
          this.emit('session:error', dualSession.partnerEntityId,
            event.payload?.error || 'Session initialization failed');

          // Clean up the dual session
          this.sessions.delete(dualSession.partnerEntityId);

          // Clean up pending sessions
          this.pendingSessions.delete(dualSession.userSession.entityId);
          this.pendingSessions.delete(dualSession.partnerSession.entityId);

          // Disconnect both connections
          this.connectionManager.disconnectConnection(dualSession.userSession.connectionId);
          this.connectionManager.disconnectConnection(dualSession.partnerSession.connectionId);
        }

        return; // Error handled
      }
    }

    // Handle other event types (only if we have a dual session)
    if (!dualSession) {
      log.debug(`Event ${event.event_type} for ${entityId} - no dual session yet, ignoring`);
      return;
    }

    switch (event.event_type) {
      case 'STT_OUTPUT_TEXT':
        if (event.status === 'NEW') {
          const messageId = event.payload?.message_id;
          if (!messageId) {
            log.warn(`Received STT_OUTPUT_TEXT without message_id, event_id: ${event.event_id}`);
            break;
          }
          
          const transcriptionRequest = this.pendingTranscriptions.get(messageId);
          if (transcriptionRequest) {
            clearTimeout(transcriptionRequest.timeout);
            this.pendingTranscriptions.delete(messageId);
            this.transcriptionStates.delete(messageId);
            
            const text = event.payload?.content || '';
            log.info(`Received STT transcription for message ${messageId}: "${text}"`);
            
            await updateConversationMessage(messageId, {
              content: text
            });
            
            this.emit('transcription:completed', 
              transcriptionRequest.partnerEntityId,
              messageId,
              text
            );
          } else {
            log.warn(`Received STT_OUTPUT_TEXT for unknown message_id: ${messageId}`);
          }
        }
        break;

      case 'ENTITY_UTTERANCE':
        // Handle incoming messages
        await this.handleIncomingMessage(dualSession, event);
        break;

      case 'TYPING_INDICATOR':
        // Handle typing indicator
        const isTyping = event.payload?.is_typing || false;
        this.emit('typing:indicator', dualSession.partnerEntityId, entityId, isTyping);
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
        log.debug(`Unhandled entity event type: ${event.event_type}`);
    }
  }
  
  private async handleIncomingMessage(dualSession: DualEntitySession, event: any): Promise<void> {
    try {
      log.info(`Incoming message from ${event.entity_id} in session ${dualSession.partnerEntityId}`);

      // Save to database
      await this.handleIncomingUtterance(dualSession, event.payload, event.event_id);

      // Just emit event so UI can reload if this chat is open
      this.emit('message:received', dualSession.partnerEntityId, event.payload);

    } catch (error) {
      log.error('Failed to handle incoming message:', error);
    }
  }

  private async handleIncomingUtterance(
    dualSession: DualEntitySession,
    utterance: any,
    eventId: string
  ): Promise<void> {
    // Get message_id from utterance (protocol field)
    const messageId = utterance.message_id;
    if (!messageId) {
      log.warn(`Received utterance without message_id (event_id: ${eventId}), skipping`);
      return;
    }
    
    // Check for duplicate
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
    
    const message = {
      id: messageId,
      entity_id: dualSession.impersonatedEntityId,  // From user's perspective
      sender_entity_id: utterance.entity_id,         // Who sent it
      session_id: dualSession.partnerSession.sessionId,
      content: utterance.content || '',
      audio_duration: utterance.audio_duration || null,
      message_type: messageType,
      audio_data: utterance.audio || null,          // Already base64 from backend
      audio_mime_type: utterance.audio_type || null,
      image_data: utterance.image_data || null,     // Already base64 from backend
      image_mime_type: utterance.image_mime_type || null,
      vl_model: null, // Will be populated by Harmony Link
      vl_model_interpretation: null,
      vl_model_embedding: null
    };
    
    await createConversationMessage(message);

    // Trigger sync
    SyncService.getInstance().initiateSync();
  }
  
  /**
   * Retry transcription for a failed message
   */
  async retryTranscription(messageId: string, partnerEntityId: string): Promise<void> {
    const dualSession = this.sessions.get(partnerEntityId);
    if (!dualSession || dualSession.userSession.status !== 'active') {
      throw new Error(`No active session for entity ${partnerEntityId}`);
    }
    
    log.info(`Retrying transcription for message ${messageId}`);
    
    // Clear failed state
    this.transcriptionStates.delete(messageId);
    
    // Get message from database
    const message = await getConversationMessage(messageId);
    
    if (!message || !message.audio_data) {
      throw new Error('Message not found or has no audio data');
    }
    
    // Request transcription using existing logic
    await this.requestTranscription(messageId, partnerEntityId, message.audio_data);
  }
  
  /**
   * Check if a message has a failed transcription
   */
  isTranscriptionFailed(messageId: string): boolean {
    return this.transcriptionStates.get(messageId) === 'failed';
  }
  
  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export default EntitySessionService.getInstance();
