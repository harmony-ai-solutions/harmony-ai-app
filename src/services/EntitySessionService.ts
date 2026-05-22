import EventEmitter from 'eventemitter3';
import DeviceInfo from 'react-native-device-info';
import { Platform, AppState } from 'react-native';
import ConnectionManager, { ConnectionMode } from './connection/ConnectionManager';
import ConnectionStateManager from './ConnectionStateManager';
import { createLogger } from '../utils/logger';
import { messageExists, createConversationMessage, updateConversationMessage, getConversationMessage } from '../database/repositories/conversation_messages';
import {
  createInteraction,
  deriveScopeFromParticipants,
  deriveParticipantKey,
} from '../database/repositories/interactions';
import { Interaction } from '../database/models';
import { SyncService } from './SyncService';
import AudioPlayer, { AudioPlayer as AudioPlayerClass } from './AudioPlayer';
import { v7 as uuidv7 } from 'uuid';

const log = createLogger('[EntitySessionService]');

// ============================================================================
// InteractionSession — replaces DualEntitySession
// ============================================================================

export interface InteractionSession {
  interactionId: string;           // Impersonated entity's interaction ID (per D-35)
  interaction: Interaction | null; // null for temp UUIDv7 until INIT_ENTITY response arrives
  participantIds: string[];        // ALL participants including ownEntityId
  ownEntityId: string;             // The impersonated entity — all messages stored from this perspective
  connections: Map<string, {       // entityId -> connection info
    connectionId: string;           // 'entity-{entityId}'
    status: 'connecting' | 'active' | 'disconnected';
  }>;
  pendingTranscriptions: Map<string, {
    messageId: string;
    interactionId: string;
    timeout: ReturnType<typeof setTimeout>;
  }>;
}

/**
 * Individual entity session (tracked per-connection)
 * Used for low-level connection state during initialization
 */
export interface EntitySession {
  sessionId: string;              // From backend after INIT_ENTITY response
  connectionId: string;           // 'entity-{entityId}'
  entityId: string;
  deviceType: string;
  deviceId: string;
  capabilities: string[];
  replyMode: string;              // "instant" or "realistic"
  connectedAt: number;
  lastActivity: number;
  status: 'connecting' | 'active' | 'disconnected';
  resumed?: boolean;              // true if this session was resumed from a suspended state on Harmony Link
}

// ============================================================================
// EntitySessionEvents — keyed by interactionId ONLY (no partnerEntityId)
// ============================================================================

interface EntitySessionEvents {
  'session:started': (interactionId: string, session: InteractionSession) => void;
  'session:stopped': (interactionId: string) => void;
  'session:error': (interactionId: string, error: string) => void;
  'message:received': (interactionId: string, message: any) => void;
  'message:edited': (interactionId: string, payload: { message_id: string; content: string; is_edited: boolean; edit_of_message_id?: string }) => void;
  'typing:indicator': (interactionId: string, entityId: string, isTyping: boolean) => void;
  'recording:indicator': (interactionId: string, entityId: string, isRecording: boolean) => void;
  'transcription:completed': (interactionId: string, messageId: string, text: string) => void;
  'transcription:failed': (interactionId: string, messageId: string) => void;
}

// ============================================================================
// EntitySessionService — manages InteractionSessions (participant-agnostic)
// ============================================================================

export class EntitySessionService extends EventEmitter<EntitySessionEvents> {
  private static instance: EntitySessionService;
  private connectionManager: typeof ConnectionManager;
  private sessions: Map<string, InteractionSession> = new Map(); // keyed by interactionId
  private pendingSessions: Map<string, EntitySession> = new Map(); // Track individual sessions during initialization (keyed by entityId)
  private transcriptionStates: Map<string, 'pending' | 'failed'> = new Map(); // Track transcription state (keyed by messageId)
  private reconnectTimers: Map<string, { interactionId: string; entityId: string; attempts: number; timer: ReturnType<typeof setTimeout> | null }> = new Map();
  private appStateSubscription: any;

  private constructor() {
    super();
    this.connectionManager = ConnectionManager;
    this.setupConnectionListeners();
    this.setupAppStateListener();
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /** Returns participant IDs excluding the own entity — the "chat partners" */
  private getOtherParticipantIds(session: InteractionSession): string[] {
    return session.participantIds.filter(id => id !== session.ownEntityId);
  }

  /** Returns connection IDs for all OTHER participants with 'active' status (excluding own entity) */
  private getPartnerConnectionIds(session: InteractionSession): string[] {
    const result: string[] = [];
    for (const id of this.getOtherParticipantIds(session)) {
      const conn = session.connections.get(id);
      if (conn && conn.status === 'active') {
        result.push(conn.connectionId);
      }
    }
    return result;
  }

  /** Clean up all pending transcriptions for a given interaction. */
  private cleanupTranscriptionsForInteraction(interactionId: string): void {
    const transcriptionsToCleanup: string[] = [];
    for (const [interactionIdKey, sessions] of this.sessions.entries()) {
      if (interactionIdKey !== interactionId) continue;
      for (const [messageId, request] of sessions.pendingTranscriptions.entries()) {
        clearTimeout(request.timeout);
        transcriptionsToCleanup.push(messageId);
        this.transcriptionStates.set(messageId, 'failed');
      }
      transcriptionsToCleanup.forEach(messageId => {
        sessions.pendingTranscriptions.delete(messageId);
      });
    }
    if (transcriptionsToCleanup.length > 0) {
      log.info(`Marked ${transcriptionsToCleanup.length} pending transcriptions as failed for interaction ${interactionId}`);
    }
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
    this.connectionManager.on('disconnected:entity', this.handleEntityDisconnected.bind(this));
  }

  // ---------------------------------------------------------------------------
  // Partner auto-reconnect logic
  // ---------------------------------------------------------------------------

  private schedulePartnerReconnect(interactionId: string, entityId: string): void {
    const key = `${interactionId}:${entityId}`;
    const existing = this.reconnectTimers.get(key);
    if (existing?.timer) clearTimeout(existing.timer);

    const attempts = (existing?.attempts ?? 0) + 1;
    // Exponential backoff capped at 30s: 1s, 2s, 4s, 8s, 16s, 30s, 30s, ...
    const delay = Math.min(1000 * Math.pow(2, attempts - 1), 30000);

    const timer = setTimeout(() => {
      this.reconnectPartner(interactionId, entityId);
    }, delay);

    this.reconnectTimers.set(key, { interactionId, entityId, attempts, timer });
  }

  private async reconnectPartner(interactionId: string, entityId: string): Promise<void> {
    const session = this.sessions.get(interactionId);
    if (!session) return; // interaction already terminated

    const connection = session.connections.get(entityId);
    if (!connection || connection.status !== 'disconnected') return; // already reconnected or removed

    log.info(`Reconnecting partner ${entityId} for interaction ${interactionId} (attempt ${this.reconnectTimers.get(`${interactionId}:${entityId}`)?.attempts ?? '?'})`);
    connection.status = 'connecting';

    try {
      const mode = await ConnectionStateManager.getSecurityMode() || 'secure';
      const wsUrl = mode === 'unencrypted'
        ? await ConnectionStateManager.getWSUrl()
        : await ConnectionStateManager.getWSSUrl();

      if (!wsUrl) {
        throw new Error('No connection URL available');
      }

      await this.connectionManager.createConnection(
        connection.connectionId,
        'entity',
        wsUrl,
        mode as any,
        entityId
      );

      // Send INIT_ENTITY — the server will detect the suspended session and resume it
      await this.sendInitEntityForEntity(entityId, session);

      log.info(`Partner ${entityId} reconnection initiated (server will resume suspended session)`);
    } catch (error) {
      log.error(`Failed to reconnect partner ${entityId}:`, error);
      connection.status = 'disconnected';
      this.schedulePartnerReconnect(interactionId, entityId); // retry with backoff
    }
  }

  /** Cancel all pending reconnect timers for an interaction (called from stopInteractionSession) */
  private cancelReconnectsForInteraction(interactionId: string): void {
    for (const [key, entry] of this.reconnectTimers.entries()) {
      if (entry.interactionId === interactionId) {
        if (entry.timer) clearTimeout(entry.timer);
        this.reconnectTimers.delete(key);
      }
    }
  }

  /** Send INIT_ENTITY for a specific entity within an InteractionSession */
  private async sendInitEntityForEntity(entityId: string, session: InteractionSession): Promise<void> {
    const connection = session.connections.get(entityId);
    if (!connection) {
      log.warn(`Cannot send INIT_ENTITY for ${entityId}: no connection found in session`);
      return;
    }

    const event = {
      event_id: this.generateEventId(),
      event_type: 'INIT_ENTITY',
      status: 'NEW',
      payload: {
        entity_id: entityId,
        participant_ids: session.participantIds, // ALWAYS includes own entity per D-21
        device_type: 'phone',
        device_id: '', // Will be filled by caller
        device_platform: Platform.OS,
        capabilities: ['chat'],
        tts_output_type: 'binary',
        reply_mode: 'realistic',
      }
    };

    await this.connectionManager.sendEvent(connection.connectionId, event);
  }

  // ---------------------------------------------------------------------------
  // handleEntityDisconnected — participant-agnostic
  // ---------------------------------------------------------------------------

  /**
   * Handles an entity WebSocket connection dropping.
   * Own-entity drop terminates the interaction; partner drop clears indicators
   * and schedules auto-reconnect with exponential backoff capped at 30s.
   */
  private handleEntityDisconnected(entityId: string): void {
    log.info(`Entity connection dropped for ${entityId}`);

    // If still in the pending-init map, just remove it
    if (this.pendingSessions.has(entityId)) {
      const pending = this.pendingSessions.get(entityId)!;
      pending.status = 'disconnected';
      this.pendingSessions.delete(entityId);
      log.info(`Removed pending session for ${entityId}`);
    }

    // Find the InteractionSession that contains this entity's connection
    for (const [interactionId, session] of this.sessions.entries()) {
      const connection = session.connections.get(entityId);
      if (!connection) continue;

      connection.status = 'disconnected';

      if (entityId === session.ownEntityId) {
        // OWN entity connection dropped — this is fatal for the interaction
        log.info(`Own entity connection lost for interaction ${interactionId} — terminating session`);
        this.cleanupTranscriptionsForInteraction(interactionId);
        this.cancelReconnectsForInteraction(interactionId);
        this.sessions.delete(interactionId);
        this.emit('session:stopped', interactionId);
      } else {
        // PARTNER entity connection dropped — interaction continues
        log.info(`Partner ${entityId} disconnected from interaction ${interactionId} — scheduling reconnect`);

        // Clear any active indicators from the disconnected partner
        this.emit('typing:indicator', interactionId, entityId, false);
        this.emit('recording:indicator', interactionId, entityId, false);

        // Schedule auto-reconnect attempt
        this.schedulePartnerReconnect(interactionId, entityId);
      }
      return;
    }

    log.debug(`disconnected:entity for ${entityId} – no matching interaction session found`);
  }

  // ---------------------------------------------------------------------------
  // startInteractionSession — replaces startDualSession
  // ---------------------------------------------------------------------------

  /**
   * Initialize an interaction session for chat.
   * Creates WebSocket connections for ALL participants (N+1 per D-18).
   *
   * @param ownEntityId - The impersonated entity (all messages stored from this perspective)
   * @param participantIds - ALL participants including ownEntityId per D-21
   * @param replyMode - Reply mode ('realistic' or 'instant')
   */
  async startInteractionSession(
    ownEntityId: string,
    participantIds: string[],
    replyMode: string = 'realistic'
  ): Promise<InteractionSession> {
    // Check if sync connection is active
    if (!this.connectionManager.isConnected('sync')) {
      throw new Error('Sync connection required for entity sessions');
    }

    // Generate a temp UUIDv7 for optimistic navigation
    const tempInteractionId = uuidv7();

    // Check if session with this temp ID already exists (shouldn't happen with UUIDv7)
    if (this.sessions.has(tempInteractionId)) {
      log.warn(`Session for interaction ${tempInteractionId} already exists, returning existing`);
      return this.sessions.get(tempInteractionId)!;
    }

    log.info(`Starting interaction session: ownEntity=${ownEntityId}, participants=[${participantIds.join(', ')}]`);

    const deviceId = await DeviceInfo.getUniqueId();
    const mode = await ConnectionStateManager.getSecurityMode() || 'secure';
    const url = mode === 'unencrypted'
      ? await ConnectionStateManager.getWSUrl()
      : await ConnectionStateManager.getWSSUrl();

    if (!url) {
      throw new Error('No connection URL available');
    }

    // Build connections map
    const connections = new Map<string, { connectionId: string; status: 'connecting' | 'active' | 'disconnected' }>();

    try {
      // Create the InteractionSession with temp interactionId
      const session: InteractionSession = {
        interactionId: tempInteractionId,
        interaction: null,
        participantIds,
        ownEntityId,
        connections,
        pendingTranscriptions: new Map(),
      };

      // Create WebSocket connections for ALL participants (N+1 per D-18)
      for (const entityId of participantIds) {
        const connectionId = `entity-${entityId}`;
        connections.set(entityId, {
          connectionId,
          status: 'connecting',
        });

        // Create the EntitySession for pending tracking
        const entitySession: EntitySession = {
          sessionId: '',
          connectionId,
          entityId,
          deviceType: 'phone',
          deviceId,
          capabilities: ['chat'],
          replyMode,
          connectedAt: Date.now(),
          lastActivity: Date.now(),
          status: 'connecting',
        };

        this.pendingSessions.set(entityId, entitySession);

        // Create WebSocket connection
        await this.connectionManager.createConnection(
          connectionId,
          'entity',
          url,
          mode as any,
          entityId
        );

        log.info(`WebSocket connection established for ${entityId}, sending INIT_ENTITY...`);

        // Send INIT_ENTITY with participant_ids per D-21
        const initEvent = {
          event_id: this.generateEventId(),
          event_type: 'INIT_ENTITY',
          status: 'NEW',
          payload: {
            entity_id: entityId,
            participant_ids: participantIds, // ALWAYS includes own entity per D-21
            device_type: 'phone',
            device_id: deviceId,
            device_platform: Platform.OS,
            capabilities: ['chat'],
            tts_output_type: 'binary', // Request binary audio output for mobile app
            reply_mode: replyMode,
          }
        };

        await this.connectionManager.sendEvent(connectionId, initEvent);

        log.info(`INIT_ENTITY sent for ${entityId}, waiting for backend response via events...`);
      }

      // Store the session (all connections in 'connecting' status)
      this.sessions.set(tempInteractionId, session);

      log.info(`Interaction session created for participants [${participantIds.join(', ')}] with temp interactionId ${tempInteractionId}`);

      return session;
    } catch (error) {
      log.error(`Failed to start interaction session:`, error);

      // Clean up any connections that were created
      for (const [entityId, conn] of connections.entries()) {
        this.pendingSessions.delete(entityId);
        if (this.connectionManager.isConnected(conn.connectionId)) {
          this.connectionManager.disconnectConnection(conn.connectionId);
        }
      }

      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // sendInitEntity (legacy — used by initializeEntitySession during pending init)
  // ---------------------------------------------------------------------------

  private async sendInitEntity(session: EntitySession): Promise<void> {
    const event = {
      event_id: this.generateEventId(),
      event_type: 'INIT_ENTITY',
      status: 'NEW',
      payload: {
        entity_id: session.entityId,
        participant_ids: [session.entityId], // Minimal set — will be expanded by startInteractionSession
        device_type: session.deviceType,
        device_id: session.deviceId,
        device_platform: Platform.OS,
        capabilities: session.capabilities,
        tts_output_type: 'binary', // Request binary audio output for mobile app
        reply_mode: session.replyMode
      }
    };

    await this.connectionManager.sendEvent(session.connectionId, event);
  }

  // ---------------------------------------------------------------------------
  // setReplyMode — participant-agnostic broadcast to ALL partner connections
  // ---------------------------------------------------------------------------

  async setReplyMode(interactionId: string, mode: string): Promise<void> {
    const session = this.sessions.get(interactionId);
    if (!session) {
      log.warn(`No active session for interaction ${interactionId}, cannot set reply mode`);
      return;
    }

    const event = {
      event_id: this.generateEventId(),
      event_type: 'SET_REPLY_MODE',
      status: 'NEW',
      payload: {
        entity_id: session.ownEntityId, // The entity whose reply mode is changing
        reply_mode: mode
      }
    };

    // Send to ALL participant connections (excluding own entity's STT connection)
    const partnerConnectionIds = this.getPartnerConnectionIds(session);
    for (const connectionId of partnerConnectionIds) {
      await this.connectionManager.sendEvent(connectionId, event);
    }

    log.info(`Reply mode updated to '${mode}' for interaction ${interactionId} (sent to ${partnerConnectionIds.length} partners)`);
  }

  // ---------------------------------------------------------------------------
  // stopInteractionSession — replaces stopSession
  // ---------------------------------------------------------------------------

  async stopInteractionSession(interactionId: string): Promise<void> {
    const session = this.sessions.get(interactionId);
    if (!session) {
      log.warn(`No session found for interaction ${interactionId}`);
      return;
    }

    log.info(`Stopping interaction session for ${interactionId}`);

    try {
      // Stop any playing audio
      await AudioPlayer.stop();

      // Clean up all pending transcriptions for this interaction
      this.cleanupTranscriptionsForInteraction(interactionId);

      // Cancel any pending reconnect timers
      this.cancelReconnectsForInteraction(interactionId);

      // Disconnect ALL connections
      for (const [entityId, conn] of session.connections.entries()) {
        if (this.connectionManager.isConnected(conn.connectionId)) {
          await this.connectionManager.sendEvent(
            conn.connectionId,
            {
              event_id: this.generateEventId(),
              event_type: 'ENTITY_SESSION_END',
              status: 'NEW',
              payload: { session_id: interactionId }
            }
          );
          this.connectionManager.disconnectConnection(conn.connectionId);
        }

        // Clean up pending sessions
        this.pendingSessions.delete(entityId);
      }
    } catch (error) {
      log.error('Error stopping session:', error);
    } finally {
      this.sessions.delete(interactionId);
      this.emit('session:stopped', interactionId);
    }
  }

  closeAllSessions(): void {
    const interactionIds = Array.from(this.sessions.keys());
    for (const id of interactionIds) {
      this.stopInteractionSession(id);
    }
  }

  // ---------------------------------------------------------------------------
  // sendTextMessage — participant-agnostic broadcast
  // ---------------------------------------------------------------------------

  async sendTextMessage(
    interactionId: string,
    text: string,
    additionalEffects?: any | null
  ): Promise<void> {
    const session = this.sessions.get(interactionId);
    if (!session) {
      throw new Error(`No active session for interaction ${interactionId}`);
    }

    const partnerConnectionIds = this.getPartnerConnectionIds(session);
    if (partnerConnectionIds.length === 0) {
      throw new Error(`No active partner connections for interaction ${interactionId}`);
    }

    // Generate UUID v7 for message ID (domain layer)
    const messageId = uuidv7();

    // Store message locally with interaction_id and entity_id = ownEntityId per D-02/D-35
    const message = {
      id: messageId,
      entity_id: session.ownEntityId, // Own-entity perspective per D-02/D-35
      sender_entity_id: session.ownEntityId,
      interaction_id: session.interactionId,
      content: text,
      audio_duration: null,
      message_type: 'text' as 'text',
      audio_data: null,
      audio_mime_type: null,
      image_data: null,
      image_mime_type: null,
      vl_model: null,
      vl_model_interpretation: null,
      emotional_state_bits: 0,
      is_recon_followup: false,
      is_edited: false,
      edit_of_message_id: null,
    };

    await createConversationMessage(message);
    log.info(`Stored text message ${messageId} locally for interaction ${interactionId}`);

    // Send to ALL partner connections (participant-agnostic broadcast)
    const utterance = {
      message_id: messageId,
      entity_id: session.ownEntityId,
      content: text,
      type: 'UTTERANCE_COMBINED'
    };

    // Attach additional effects if present
    if (additionalEffects && additionalEffects.emotionEffects && additionalEffects.emotionEffects.length > 0) {
      (utterance as any).additional_effects = additionalEffects;
      log.info(`Sending message ${messageId} with ${additionalEffects.emotionEffects.length} additional emotion effects`);
    }

    for (const connectionId of partnerConnectionIds) {
      await this.sendUtterance(connectionId, utterance);
    }

    log.info(`Sent message ${messageId} to ${partnerConnectionIds.length} partner(s) for interaction ${interactionId}`);
  }

  // ---------------------------------------------------------------------------
  // newAudioMessage — creates audio message, requests transcription
  // ---------------------------------------------------------------------------

  async newAudioMessage(
    interactionId: string,
    audioData: string,
    mimeType: string,
    duration: number
  ): Promise<string> {
    const session = this.sessions.get(interactionId);
    if (!session) {
      throw new Error(`No active session for interaction ${interactionId}`);
    }

    log.info(`Starting audio message flow for interaction ${interactionId}`);

    const base64Audio = audioData;

    // Generate UUID v7 for message ID (domain layer)
    const messageId = uuidv7();

    const message = {
      id: messageId,
      entity_id: session.ownEntityId, // Own-entity perspective per D-02/D-35
      sender_entity_id: session.ownEntityId,
      interaction_id: session.interactionId,
      content: '',
      audio_duration: duration,
      message_type: 'audio' as 'audio',
      audio_data: base64Audio,
      audio_mime_type: mimeType,
      image_data: null,
      image_mime_type: null,
      vl_model: null,
      vl_model_interpretation: null,
      emotional_state_bits: 0,
      is_recon_followup: false,
      is_edited: false,
      edit_of_message_id: null,
    };

    await createConversationMessage(message);
    log.info(`Stored message ${messageId} in database (awaiting transcription)`);

    try {
      await this.requestTranscription(messageId, interactionId, base64Audio);
    } catch (error) {
      log.error(`Failed to request transcription for ${messageId}:`, error);
    }

    return messageId;
  }

  private async requestTranscription(
    messageId: string,
    interactionId: string,
    base64Audio: string
  ): Promise<void> {
    const session = this.sessions.get(interactionId);
    if (!session) {
      throw new Error(`No session for interaction ${interactionId}`);
    }

    const eventId = this.generateEventId();

    const timeout = setTimeout(() => {
      log.warn(`Transcription timeout for message ${messageId}`);
      session.pendingTranscriptions.delete(messageId);
      this.transcriptionStates.set(messageId, 'failed');
      this.emit('transcription:failed', interactionId, messageId);
    }, 30000);

    session.pendingTranscriptions.set(messageId, {
      messageId,
      interactionId,
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

    // STT always sent on own entity's connection
    const ownConnection = session.connections.get(session.ownEntityId);
    if (!ownConnection) {
      throw new Error(`No own entity connection for interaction ${interactionId}`);
    }

    await this.connectionManager.sendEvent(
      ownConnection.connectionId,
      event
    );

    log.info(`Sent STT_INPUT_AUDIO for message ${messageId}, event ${eventId}`);
  }

  // ---------------------------------------------------------------------------
  // sendImageMessage — participant-agnostic broadcast
  // ---------------------------------------------------------------------------

  async sendImageMessage(
    interactionId: string,
    imageBase64: string,
    mimeType: string,
    caption?: string
  ): Promise<void> {
    const session = this.sessions.get(interactionId);
    if (!session) {
      throw new Error(`No active session for interaction ${interactionId}`);
    }

    const partnerConnectionIds = this.getPartnerConnectionIds(session);
    if (partnerConnectionIds.length === 0) {
      throw new Error(`No active partner connections for interaction ${interactionId}`);
    }

    // Generate UUID v7 for message ID
    const messageId = uuidv7();

    const utterance = {
      message_id: messageId,
      entity_id: session.ownEntityId,
      content: caption || '',
      type: 'UTTERANCE_COMBINED',
      image_data: imageBase64,
      image_mime_type: mimeType
    };

    for (const connectionId of partnerConnectionIds) {
      await this.sendUtterance(connectionId, utterance);
    }

    log.info(`Sent image message ${messageId} to ${partnerConnectionIds.length} partner(s) for interaction ${interactionId}`);
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

  // ---------------------------------------------------------------------------
  // Session accessors
  // ---------------------------------------------------------------------------

  getInteractionSession(interactionId: string): InteractionSession | null {
    return this.sessions.get(interactionId) || null;
  }

  // ---------------------------------------------------------------------------
  // handleEntityEvent — process incoming WebSocket events
  // ---------------------------------------------------------------------------

  private async handleEntityEvent(entityId: string, event: any): Promise<void> {
    log.debug(`handleEntityEvent called for entity ${entityId}, event type: ${event.event_type}, status: ${event.status}`);

    // First, try to find in pending sessions (for sessions still initializing)
    let targetSession = this.pendingSessions.get(entityId);
    let interactionSession: InteractionSession | null = null;
    let interactionId: string | null = null;

    // Find the InteractionSession that contains this entity
    if (!targetSession) {
      for (const [iid, session] of this.sessions.entries()) {
        if (session.connections.has(entityId)) {
          interactionSession = session;
          interactionId = iid;
          break;
        }
      }
    } else {
      // Also find if this entity belongs to an InteractionSession
      for (const [iid, session] of this.sessions.entries()) {
        if (session.connections.has(entityId)) {
          interactionSession = session;
          interactionId = iid;
          break;
        }
      }
    }

    if (!targetSession && !interactionSession) {
      log.warn(`Received event for unknown entity ${entityId}`);
      return;
    }

    // Handle INIT_ENTITY responses (SUCCESS or ERROR)
    if (event.event_type === 'INIT_ENTITY') {
      await this.handleInitEntityResponse(entityId, event, targetSession ?? null, interactionSession, interactionId ?? '');
      return;
    }

    // For remaining event types, we need an InteractionSession
    if (!interactionSession || !interactionId) {
      log.debug(`Event ${event.event_type} for ${entityId} - no interaction session yet, ignoring`);
      return;
    }

    // Update last activity on the pending session if found
    if (targetSession) {
      targetSession.lastActivity = Date.now();
    }

    switch (event.event_type) {
      case 'STT_OUTPUT_TEXT':
        if (event.status === 'NEW') {
          const msgId = event.payload?.message_id;
          if (!msgId) {
            log.warn(`Received STT_OUTPUT_TEXT without message_id, event_id: ${event.event_id}`);
            break;
          }

          const transcriptionRequest = interactionSession.pendingTranscriptions.get(msgId);
          if (transcriptionRequest) {
            clearTimeout(transcriptionRequest.timeout);
            interactionSession.pendingTranscriptions.delete(msgId);
            this.transcriptionStates.delete(msgId);

            const text = event.payload?.content || '';
            log.info(`Received STT transcription for message ${msgId}: "${text}"`);

            await updateConversationMessage(msgId, {
              content: text
            });

            this.emit('transcription:completed',
              transcriptionRequest.interactionId,
              msgId,
              text
            );
          } else {
            log.warn(`Received STT_OUTPUT_TEXT for unknown message_id: ${msgId}`);
          }
        }
        break;

      case 'ENTITY_UTTERANCE':
        // Handle incoming messages
        await this.handleIncomingMessage(interactionSession, interactionId, event);
        break;

      case 'ENTITY_UTTERANCE_EDIT':
        await this.handleIncomingMessageEdit(interactionSession, interactionId, event);
        break;

      case 'TYPING_INDICATOR':
        // Handle typing indicator
        const isTyping = event.payload?.is_typing || false;
        this.emit('typing:indicator', interactionId, entityId, isTyping);
        break;

      case 'RECORDING_INDICATOR':
        this.emit(
          'recording:indicator',
          interactionId,
          event.payload.entity_id,
          event.payload.is_recording
        );
        break;

      default:
        log.debug(`Unhandled entity event type: ${event.event_type}`);
    }
  }

  /**
   * Handle INIT_ENTITY response.
   * Per D-03/D-32/D-35: extracts interaction_id, creates local Interaction record,
   * replaces temp UUIDv7.
   */
  private async handleInitEntityResponse(
    entityId: string,
    event: any,
    targetSession: EntitySession | null,
    interactionSession: InteractionSession | null,
    interactionId: string
  ): Promise<void> {
    if (event.status === 'SUCCESS') {
      log.info(`INIT_ENTITY SUCCESS for ${entityId}`);

      // Update the pending/individual session
      if (targetSession) {
        targetSession.sessionId = event.payload.session_id;
        targetSession.status = 'active';
        log.info(`Session activated: ${entityId} -> session_id=${event.payload.session_id}`);

        // Update capabilities from backend response (if provided)
        if (event.payload.capabilities && Array.isArray(event.payload.capabilities)) {
          targetSession.capabilities = event.payload.capabilities;
          log.info(`Entity capabilities updated for ${entityId}: ${event.payload.capabilities.join(', ')}`);
        }

        // Log if session was resumed from a suspended state
        if (event.payload.resumed) {
          log.info(`Session ${entityId} was RESUMED from suspended state on Harmony Link`);
          targetSession.resumed = true;
        }
      }

      // Update the connection status in the InteractionSession
      if (interactionSession) {
        const connection = interactionSession.connections.get(entityId);
        if (connection) {
          connection.status = 'active';
          log.info(`Connection status updated to 'active' for ${entityId} in interaction ${interactionId}`);
        }

        // If THIS is the own entity's response, handle interaction_id replacement per D-03/D-35
        if (entityId === interactionSession.ownEntityId) {
          const canonicalInteractionId = event.payload.interaction_id;
          if (canonicalInteractionId && canonicalInteractionId !== interactionSession.interactionId) {
            log.info(`Replacing temp interactionId ${interactionSession.interactionId} with canonical ${canonicalInteractionId}`);

            // Get the old interactionId
            const oldInteractionId = interactionSession.interactionId;

            // Update the session's interactionId
            interactionSession.interactionId = canonicalInteractionId;

            // Re-key the sessions map
            this.sessions.delete(oldInteractionId);
            this.sessions.set(canonicalInteractionId, interactionSession);

            // Create local Interaction record per D-03/D-35
            const scope = deriveScopeFromParticipants(interactionSession.participantIds);
            const participantKey = deriveParticipantKey(
              interactionSession.participantIds,
              interactionSession.ownEntityId,
              scope
            );
            const now = new Date().toISOString();

            const interactionRecord: Interaction = {
              id: canonicalInteractionId,
              entity_id: interactionSession.ownEntityId, // Per D-35: app is single-perspective
              interaction_scope: scope,
              participant_key: participantKey,
              participant_ids: JSON.stringify(interactionSession.participantIds),
              status: 'active',
              started_at: now,
              last_activity_at: now,
              ended_at: null,
              memory_id: null,
              continued_interaction_id: null,
              metadata: null,
              summary: null,
              presence_type: 'phone', // Per D-16: app creates phone interactions
              created_at: now,
              updated_at: now,
              deleted_at: null,
            };

            try {
              await createInteraction(interactionRecord);
              interactionSession.interaction = interactionRecord;
              log.info(`Created local Interaction record ${canonicalInteractionId} for entity ${interactionSession.ownEntityId}`);
            } catch (err) {
              log.error(`Failed to create local Interaction record:`, err);
              // Non-fatal: the interaction will be created from sync data later
            }
          }

          // Re-check: if the canonical ID matches the temp ID (same value),
          // we still need to create the interaction record
          if (!interactionSession.interaction) {
            const canonicalId = event.payload.interaction_id || interactionSession.interactionId;
            const scope = deriveScopeFromParticipants(interactionSession.participantIds);
            const participantKey = deriveParticipantKey(
              interactionSession.participantIds,
              interactionSession.ownEntityId,
              scope
            );
            const now = new Date().toISOString();

            const interactionRecord: Interaction = {
              id: canonicalId,
              entity_id: interactionSession.ownEntityId,
              interaction_scope: scope,
              participant_key: participantKey,
              participant_ids: JSON.stringify(interactionSession.participantIds),
              status: 'active',
              started_at: now,
              last_activity_at: now,
              ended_at: null,
              memory_id: null,
              continued_interaction_id: null,
              metadata: null,
              summary: null,
              presence_type: 'phone',
              created_at: now,
              updated_at: now,
              deleted_at: null,
            };

            try {
              await createInteraction(interactionRecord);
              interactionSession.interaction = interactionRecord;
              log.info(`Created local Interaction record ${canonicalId} for entity ${interactionSession.ownEntityId}`);
            } catch (err) {
              log.error(`Failed to create local Interaction record:`, err);
            }
          }
        }

        // Check if ALL connections are now active → emit 'session:started'
        let allActive = true;
        for (const [, conn] of interactionSession.connections) {
          if (conn.status !== 'active') {
            allActive = false;
            break;
          }
        }

        if (allActive) {
          log.info(`All connections active for interaction ${interactionSession.interactionId} — emitting session:started`);

          // Remove from pending sessions now that all are fully active
          for (const pid of interactionSession.participantIds) {
            this.pendingSessions.delete(pid);
          }

          this.emit('session:started', interactionSession.interactionId, interactionSession);

          // Trigger sync to pick up any pending messages from Harmony Link
          SyncService.getInstance().initiateSync().catch(err => {
            log.warn('Auto-sync on session start failed (non-critical):', err);
          });
        } else {
          const statuses = Array.from(interactionSession.connections.entries())
            .map(([eid, conn]) => `${eid}=${conn.status}`)
            .join(', ');
          log.info(`Interaction session partially active: ${statuses}`);
        }
      } else {
        log.info(`Session ${entityId} activated, waiting for InteractionSession to be created`);
      }
    } else if (event.status === 'ERROR') {
      log.error(`INIT_ENTITY ERROR for ${entityId}:`, event.payload);

      // Mark target session as failed
      if (targetSession) {
        targetSession.status = 'disconnected';
        this.pendingSessions.delete(entityId);
      }

      // If we have an interaction session, handle error
      if (interactionSession && interactionId) {
        this.emit('session:error', interactionId,
          event.payload?.error || 'Session initialization failed');

        // Clean up the interaction session
        this.cancelReconnectsForInteraction(interactionId);
        this.sessions.delete(interactionId);

        // Disconnect all connections for this interaction
        for (const [, conn] of interactionSession.connections) {
          if (this.connectionManager.isConnected(conn.connectionId)) {
            this.connectionManager.disconnectConnection(conn.connectionId);
          }
        }

        // Clean up pending sessions
        for (const pid of interactionSession.participantIds) {
          this.pendingSessions.delete(pid);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Incoming message handling
  // ---------------------------------------------------------------------------

  private async handleIncomingMessage(
    interactionSession: InteractionSession,
    interactionId: string,
    event: any
  ): Promise<void> {
    try {
      log.info(`Incoming message from ${event.entity_id} in interaction ${interactionId}`);

      // Save to database
      await this.handleIncomingUtterance(interactionSession, interactionId, event.payload, event.event_id);

      // Emit event so UI can reload if this chat is open
      this.emit('message:received', interactionId, event.payload);

    } catch (error) {
      log.error('Failed to handle incoming message:', error);
    }
  }

  private async handleIncomingMessageEdit(
    interactionSession: InteractionSession,
    interactionId: string,
    event: any
  ): Promise<void> {
    try {
      const messageId = event.payload?.message_id || event.payload?.edit_of_message_id;
      const newContent = event.payload?.content;

      if (!messageId || !newContent) {
        log.warn(`Received ENTITY_UTTERANCE_EDIT without message_id or content, event_id: ${event.event_id}`);
        return;
      }

      log.info(`Processing message edit for ${messageId}: new content length=${newContent.length}`);

      // Update the existing message in the database
      await updateConversationMessage(messageId, {
        content: newContent,
        is_edited: true,
      });

      // Emit event so UI can re-render if this chat is open
      this.emit('message:edited', interactionId, {
        message_id: messageId,
        content: newContent,
        is_edited: true,
        edit_of_message_id: event.payload?.edit_of_message_id,
      });

    } catch (error) {
      log.error('Failed to handle incoming message edit:', error);
    }
  }

  /**
   * Handle incoming utterance from a partner entity.
   * Stores message with interaction_id and entity_id = ownEntityId per D-35.
   */
  private async handleIncomingUtterance(
    interactionSession: InteractionSession,
    interactionId: string,
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

    // Store with entity_id = ownEntityId per D-35 (app is single-perspective)
    const message = {
      id: messageId,
      entity_id: interactionSession.ownEntityId, // From user's perspective per D-35
      sender_entity_id: utterance.entity_id,      // Who sent it
      interaction_id: interactionSession.interactionId, // Own entity's interaction ID
      content: utterance.content || '',
      audio_duration: utterance.audio_duration || null,
      message_type: messageType,
      audio_data: utterance.audio || null,          // Already base64 from backend
      audio_mime_type: utterance.audio_type || null,
      image_data: utterance.image_data || null,     // Already base64 from backend
      image_mime_type: utterance.image_mime_type || null,
      vl_model: null, // Will be populated by Harmony Link
      vl_model_interpretation: null,
      emotional_state_bits: 0,
      is_recon_followup: utterance.is_recon_followup || false,
      is_edited: utterance.is_edited || false,
      edit_of_message_id: utterance.edit_of_message_id || null,
    };

    await createConversationMessage(message);

    // Parse and persist audio duration if the backend did not provide it
    if (message.audio_data && !message.audio_duration) {
      const duration = await AudioPlayerClass.getDurationFromBase64(
        message.audio_data,
        message.audio_mime_type || 'audio/wav'
      );
      if (duration) {
        await updateConversationMessage(messageId, { audio_duration: duration });
        log.info(`Stored audio duration for message ${messageId}: ${duration.toFixed(2)}s`);
      }
    }

    // Trigger sync
    SyncService.getInstance().initiateSync();
  }

  // ---------------------------------------------------------------------------
  // Retry transcription
  // ---------------------------------------------------------------------------

  async retryTranscription(messageId: string, interactionId: string): Promise<void> {
    const session = this.sessions.get(interactionId);
    if (!session) {
      throw new Error(`No active session for interaction ${interactionId}`);
    }

    const ownConnection = session.connections.get(session.ownEntityId);
    if (!ownConnection || ownConnection.status !== 'active') {
      throw new Error(`No active own entity connection for interaction ${interactionId}`);
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
    await this.requestTranscription(messageId, interactionId, message.audio_data);
  }

  // ---------------------------------------------------------------------------
  // Public state queries
  // ---------------------------------------------------------------------------

  /**
   * Check if a message has a failed transcription
   */
  isTranscriptionFailed(messageId: string): boolean {
    return this.transcriptionStates.get(messageId) === 'failed';
  }

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // ===========================================================================
  // LEGACY METHODS — DEPRECATED
  // These are kept temporarily for compatibility during the transition.
  // They throw clear errors pointing to the new API.
  // ===========================================================================

  /**
   * @deprecated Use startInteractionSession instead.
   */
  async startDualSession(
    partnerEntityId: string,
    impersonatedEntityId: string = 'user',
    replyMode: string = 'realistic'
  ): Promise<any> {
    throw new Error(
      'startDualSession is deprecated. Use startInteractionSession(ownEntityId, participantIds, replyMode) instead. ' +
      'The new method is participant-agnostic and accepts an array of participant IDs.'
    );
  }

  /**
   * @deprecated Use stopInteractionSession instead.
   */
  async stopSession(partnerEntityId: string): Promise<void> {
    throw new Error(
      'stopSession is deprecated. Use stopInteractionSession(interactionId) instead.'
    );
  }

  /**
   * @deprecated Use getInteractionSession instead.
   */
  getSession(partnerEntityId: string): any {
    return null;
  }
}

export default EntitySessionService.getInstance();
