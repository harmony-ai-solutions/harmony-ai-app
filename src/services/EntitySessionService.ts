import EventEmitter from 'eventemitter3';
import DeviceInfo from 'react-native-device-info';
import { Platform, AppState } from 'react-native';
import ConnectionManager from './connection/ConnectionManager';
import ConnectionStateManager from './ConnectionStateManager';
import { createLogger } from '../utils/logger';
import { CLOUD_HOSTS, WS_PATHS } from '../config/cloud';
import { messageExists, createConversationMessage, updateConversationMessage, getConversationMessage } from '../database/repositories/conversation_messages';
import {
  createInteraction,
  deriveScopeFromParticipants,
  deriveParticipantKey,
} from '../database/repositories/interactions';
import {
  getChatConversationSettings,
  incrementConversationUnread,
} from '../database/repositories/chatConversationSettings';
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
    connectionId: string;           // 'entity-{entityId}[-{participantKey}]'
    status: 'connecting' | 'active' | 'disconnected';
  }>;
  pendingTranscriptions: Map<string, {
    messageId: string;
    interactionId: string;
    timeout: ReturnType<typeof setTimeout>;
  }>;
  // Guards a single session:started emission per InteractionSession. Without it,
  // the two participants' INIT_ENTITY SUCCESS responses race through the
  // own-entity's `await createInteraction(...)` window and BOTH re-enter the
  // all-active check after both connections are already 'active' — emitting
  // session:started twice (and double-triggering the on-start sync).
  started?: boolean;
  /**
   * Render-only greeting support (§1-10): true when the character's card has an
   * authored `first_mes` (read from the INIT_ENTITY SUCCESS payload). The
   * greeting itself is NOT fabricated here — it arrives as a normal
   * `message_type="greeting"` ConversationMessage via the message-load/sync
   * path. `undefined` until an INIT_ENTITY SUCCESS carrying `has_first_mes`
   * has been processed.
   */
  hasFirstMes?: boolean;
}

/**
 * Guided scenario inputs (§2-4) — maps 1:1 to the engine `guided` payload
 * shape for GENERATE_GREETING / START_NEW_SCENARIO. Structurally identical to
 * `ScenarioGeneratorSheet`'s `ScenarioGuidedInputs` (the screen passes it
 * through untouched).
 */
export interface GuidedScenarioInput {
  mood: string[];
  setting: string;
  relationship: string;
  timeOfDay: string;
  whoFirst: 'character' | 'user';
  premise: string;
}

/** Success result of a scenario generation dispatch. */
export interface ScenarioGenerationResult {
  greeting: string;
  interactionId: string;
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
  /**
   * Pending GENERATE_GREETING / START_NEW_SCENARIO dispatches awaiting their
   * engine response, keyed by event_id (§2-4). The engine replies on the same
   * WebSocket asynchronously, so each dispatch registers a waiter that the
   * matching response handler resolves/rejects.
   */
  private pendingGenerations: Map<string, {
    resolve: (result: ScenarioGenerationResult) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = new Map();
  private appStateSubscription: any;
  // Participant keys of conversations currently open on screen — incoming
  // messages for these do NOT bump the unread counter.
  private openConversationKeys: Set<string> = new Set();
  // In-memory disable-state overrides keyed by participant key. The UI updates
  // this synchronously on disable/enable so the send/incoming guards see the
  // new state IMMEDIATELY (no stale DB read while the write is in flight).
  private disabledOverrides: Map<string, boolean> = new Map();

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
    // Close entity sessions when the app goes to background (battery-friendly
    // teardown of the per-entity WebSockets). The CLOUD session is deliberately
    // NOT disconnected here: the floating chat overlay (ChatBubbleService) is a
    // second React root sharing this same singleton and keeps running as a
    // foreground service while the main activity is backgrounded. Tearing down
    // the cloud session then makes the overlay report "offline / disconnected
    // from cloud" and forces a slow broker re-provision on resume. Leaving the
    // cloud session ready lets the sync WS reconnect instantly on foreground.
    this.appStateSubscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'background') {
        log.info('App going to background, closing entity sessions (cloud session stays ready)');
        this.closeAllSessions();
      }
    });
  }

  /**
   * Register the entity connection listeners.
   *
   * IMPORTANT — idempotency across Metro hot reloads: this module default-
   * exports a singleton and is re-executed on every Fast Refresh, which would
   * normally create a NEW EntitySessionService instance that registers ANOTHER
   * listener set on the RETAINED ConnectionManager singleton. Old instances
   * are orphaned but their listeners persist, so every entity event would be
   * delivered once per instance. The ConnectionManager singleton holds the
   * CURRENT instance in `entitySessionEventTarget` and the actual listeners
   * are installed only once per ConnectionManager lifetime.
   */
  private setupConnectionListeners() {
    const cm = this.connectionManager as typeof ConnectionManager & {
      entitySessionEventTarget?: EntitySessionService | null;
      entitySessionListenersInstalled?: boolean;
    };

    // Make THIS instance the current event target (survives hot reloads).
    cm.entitySessionEventTarget = this;

    // Install the listeners exactly once per ConnectionManager lifetime.
    if (cm.entitySessionListenersInstalled) {
      return;
    }
    cm.entitySessionListenersInstalled = true;

    cm.on('event:entity', (entityId: string, event: any) => {
      cm.entitySessionEventTarget?.handleEntityEvent(entityId, event);
    });
    cm.on('disconnected:entity', (entityId: string) => {
      cm.entitySessionEventTarget?.handleEntityDisconnected(entityId);
    });
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
      const source = await ConnectionStateManager.getCurrentSource();
      let wsUrl: string;
      let mode: string;
      if (source === 'cloud') {
        wsUrl = `${CLOUD_HOSTS.conductProxyWs}${WS_PATHS.worker}`;
        mode = 'cloud';
      } else {
        mode = (await ConnectionStateManager.getSecurityMode()) || 'secure';
        wsUrl = mode === 'unencrypted'
          ? (await ConnectionStateManager.getWSUrl()) ?? ''
          : (await ConnectionStateManager.getWSSUrl()) ?? '';
      }

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

    const deviceId = await DeviceInfo.getUniqueId();

    const event = {
      event_id: this.generateEventId(),
      event_type: 'INIT_ENTITY',
      status: 'NEW',
      payload: {
        entity_id: entityId,
        participant_ids: session.participantIds, // ALWAYS includes own entity per D-21
        device_type: 'phone',
        device_id: deviceId,
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
    const source = await ConnectionStateManager.getCurrentSource();
    let url: string;
    let mode: string;
    if (source === 'cloud') {
      url = `${CLOUD_HOSTS.conductProxyWs}${WS_PATHS.worker}`;
      mode = 'cloud';
    } else {
      mode = (await ConnectionStateManager.getSecurityMode()) || 'secure';
      url = mode === 'unencrypted'
        ? (await ConnectionStateManager.getWSUrl()) ?? ''
        : (await ConnectionStateManager.getWSSUrl()) ?? '';
    }

    if (!url) {
      throw new Error('No connection URL available');
    }

    // Build connections map
    const connections = new Map<string, { connectionId: string; status: 'connecting' | 'active' | 'disconnected' }>();

    // Participant-set discriminator for the connection IDs. The engine keys
    // interaction sessions by participant set (one canonical interaction_id per
    // distinct participant set), so a Marcella+user chat and a claire+user chat
    // each need their OWN `entity-user` socket — they must NOT share the single
    // `entity-user` slot (ConnectionManager id + native per-URL socket key).
    // Without this, rapid chat switching raced the previous session's
    // `entity-user` teardown against the new session's `entity-user` setup →
    // native "Already Connected"/stale-socket failures → 15s init timeouts →
    // the "Scheduling retry 1/3…3/3" connection delay. ('+' from
    // deriveParticipantKey is URL-unsafe in `?connection_id=`, so sanitize it.)
    const scope = deriveScopeFromParticipants(participantIds);
    const participantKey = deriveParticipantKey(participantIds, ownEntityId, scope);
    const connKeySuffix = participantKey ? `-${participantKey.replace(/\+/g, '-')}` : '';

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

      // Register the session BEFORE sending INIT_ENTITY. The engine can return
      // INIT_ENTITY SUCCESS before this Promise.all resolves (notably the partner
      // entity's response); if the session isn't in `this.sessions` yet,
      // handleEntityEvent → handleInitEntityResponse runs with interactionSession
      // === null and never marks the connection 'active', so the session can
      // never reach all-active and stalls until the 15s init retry (observed
      // on device: a chat stuck in "connecting" for ~15s). The connections map
      // is shared by reference, so entries added below stay visible. Removed on
      // error in the catch below.
      this.sessions.set(tempInteractionId, session);

      // Create WebSocket connections for ALL participants in PARALLEL (N+1 per D-18).
      // Previously this was a serial for-loop with await — each WS connection (TCP + TLS +
      // WS handshake) had to complete before the next one started.  For a 2-participant chat
      // that meant ~2-6 s of sequential network I/O.  Running all connections concurrently
      // collapses total wall-clock time to the single slowest handshake.
      await Promise.all(participantIds.map(async (entityId) => {
        const connectionId = `entity-${entityId}${connKeySuffix}`;
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

        // Create WebSocket connection (TCP + TLS + WS handshake)
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
      }));

      log.info(`Interaction session created for participants [${participantIds.join(', ')}] with temp interactionId ${tempInteractionId}`);

      return session;
    } catch (error) {
      log.error(`Failed to start interaction session:`, error);

      // The session was registered before the parallel connect/send below;
      // remove it so a failed start doesn't leave a half-initialized entry
      // that later INIT_ENTITY responses (or the init timer) would act on.
      this.sessions.delete(tempInteractionId);

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
  // generateGreeting / startNewScenario — scenario generation events (§2-4)
  // ---------------------------------------------------------------------------

  /**
   * Resolve the connection to send a scenario event on. The generating entity
   * is `entityId` (the character whose greeting is being authored), so prefer
   * its own connection; fall back to any active partner connection.
   */
  private getGenerationConnection(
    session: InteractionSession,
    entityId: string,
  ): { connectionId: string } | null {
    const own = session.connections.get(entityId);
    if (own && (own.status === 'active' || own.status === 'connecting')) {
      return { connectionId: own.connectionId };
    }
    const partnerIds = this.getPartnerConnectionIds(session);
    if (partnerIds.length > 0) {
      return { connectionId: partnerIds[0] };
    }
    for (const [, conn] of session.connections.entries()) {
      if (conn.status === 'active' || conn.status === 'connecting') {
        return { connectionId: conn.connectionId };
      }
    }
    return null;
  }

  private registerGenerationWaiter(
    eventId: string,
    timeoutMs: number,
  ): Promise<ScenarioGenerationResult> {
    return new Promise<ScenarioGenerationResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingGenerations.delete(eventId);
        reject(new Error('Scenario generation timed out'));
      }, timeoutMs);
      this.pendingGenerations.set(eventId, { resolve, reject, timer });
    });
  }

  /**
   * Dispatch GENERATE_GREETING — first custom greeting + regenerate. Valid only
   * while the greeting is the only message (the engine enforces this and
   * returns ERROR otherwise; the client should fall back to START_NEW_SCENARIO).
   *
   * Resolves with the generated greeting + interaction_id from the engine.
   */
  async generateGreeting(payload: {
    entityId: string;
    targetEntityId: string;
    interactionId: string;
    mode: 'random' | 'directed';
    guided?: GuidedScenarioInput;
  }): Promise<ScenarioGenerationResult> {
    const session = this.sessions.get(payload.interactionId);
    if (!session) {
      throw new Error(`No active session for interaction ${payload.interactionId}`);
    }
    const connection = this.getGenerationConnection(session, payload.entityId);
    if (!connection) {
      throw new Error('No active connection to generate a greeting on');
    }

    const eventId = this.generateEventId();
    const waiter = this.registerGenerationWaiter(eventId, 30_000);

    const event: any = {
      event_id: eventId,
      event_type: 'GENERATE_GREETING',
      status: 'NEW',
      payload: {
        entity_id: payload.entityId,
        target_entity_id: payload.targetEntityId,
        interaction_id: payload.interactionId,
        mode: payload.mode,
      },
    };
    if (payload.guided) {
      event.payload.guided = payload.guided;
    }

    log.info(`Sending GENERATE_GREETING (${payload.mode}) for interaction ${payload.interactionId}`);
    await this.connectionManager.sendEvent(connection.connectionId, event);
    return waiter;
  }

  /**
   * Dispatch START_NEW_SCENARIO — scenario restart mid-conversation. The engine
   * creates a BRAND-NEW interaction (fresh `interaction_id` in the SUCCESS
   * payload); the caller swaps the active interactionId + runs a blocking sync.
   *
   * No interactionId in the payload (per the engine contract): the session is
   * resolved from the entity's connection.
   */
  async startNewScenario(payload: {
    entityId: string;
    targetEntityId: string;
    mode: 'random' | 'directed';
    guided?: GuidedScenarioInput;
  }): Promise<ScenarioGenerationResult> {
    // The session map is keyed by interaction id; the caller may still be on
    // the OLD id when restarting, so find the session via the entity connection.
    let session: InteractionSession | null = null;
    for (const [, s] of this.sessions.entries()) {
      if (s.connections.has(payload.entityId)) {
        session = s;
        break;
      }
    }
    if (!session) {
      throw new Error(`No active session for entity ${payload.entityId}`);
    }
    const connection = this.getGenerationConnection(session, payload.entityId);
    if (!connection) {
      throw new Error('No active connection to start a scenario on');
    }

    const eventId = this.generateEventId();
    const waiter = this.registerGenerationWaiter(eventId, 30_000);

    const event: any = {
      event_id: eventId,
      event_type: 'START_NEW_SCENARIO',
      status: 'NEW',
      payload: {
        entity_id: payload.entityId,
        target_entity_id: payload.targetEntityId,
        mode: payload.mode,
      },
    };
    if (payload.guided) {
      event.payload.guided = payload.guided;
    }

    log.info(`Sending START_NEW_SCENARIO (${payload.mode}) on interaction ${session.interactionId}`);
    await this.connectionManager.sendEvent(connection.connectionId, event);
    return waiter;
  }

  private handleGenerationResponse(
    entityId: string,
    event: any,
    interactionSession: InteractionSession | null,
    interactionId: string,
  ): void {
    const waiter = this.pendingGenerations.get(event.event_id);
    if (!waiter) {
      log.warn(`Scenario generation response for unknown event_id ${event.event_id} (${event.event_type})`);
      return;
    }
    clearTimeout(waiter.timer);
    this.pendingGenerations.delete(event.event_id);

    if (event.status !== 'SUCCESS') {
      const error =
        event.payload?.error || `${event.event_type} failed (${event.status || 'unknown'})`;
      waiter.reject(new Error(error));
      return;
    }

    const greeting: string = event.payload?.greeting ?? '';
    let resultInteractionId: string =
      event.payload?.interaction_id ?? interactionId ?? '';

    // START_NEW_SCENARIO returns a brand-new interaction — re-key the session
    // so subsequent events (message:received, sendTextMessage, ...) route to
    // the new interaction (mirrors the INIT_ENTITY canonical-id replacement).
    if (event.event_type === 'START_NEW_SCENARIO' && interactionSession && resultInteractionId) {
      if (resultInteractionId !== interactionSession.interactionId) {
        const oldId = interactionSession.interactionId;
        log.info(`START_NEW_SCENARIO: re-keying session ${oldId} → ${resultInteractionId}`);
        interactionSession.interactionId = resultInteractionId;
        this.sessions.delete(oldId);
        this.sessions.set(resultInteractionId, interactionSession);
      }
      // The engine owns the interaction record on this path (sync delivers it).
    } else if (event.event_type === 'START_NEW_SCENARIO' && !resultInteractionId) {
      // Defensive: keep the current id rather than dropping it to ''.
      resultInteractionId = interactionSession?.interactionId ?? '';
      log.warn(`START_NEW_SCENARIO SUCCESS without interaction_id — keeping ${resultInteractionId}`);
    }

    waiter.resolve({ greeting, interactionId: resultInteractionId });
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
      // Stop any playing audio. Isolated on purpose: AudioPlayer.stop() throws
      // 'player_not_initialized' when TrackPlayer was never set up (the chat
      // had no audio playback). Letting that bubble into the outer catch used
      // to SKIP the connection teardown below — leaking every entity WebSocket
      // (live heartbeat, "already exists" on the next session, orphaned
      // engine-side sessions).
      try {
        await AudioPlayer.stop();
      } catch (audioError) {
        log.warn('AudioPlayer.stop() failed during session stop (ignored):', audioError);
      }

      // Clean up all pending transcriptions for this interaction
      this.cleanupTranscriptionsForInteraction(interactionId);

      // Cancel any pending reconnect timers
      this.cancelReconnectsForInteraction(interactionId);

      // Disconnect ALL connections — fault-isolated per connection so one
      // failing ENTITY_SESSION_END/disconnect can't strand the remaining
      // connections (same leak class as the audio error above).
      for (const [entityId, conn] of session.connections.entries()) {
        try {
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
        } catch (connError) {
          log.warn(`Error tearing down connection ${conn.connectionId} during session stop:`, connError);
        }
      }
    } catch (error) {
      log.error('Error stopping session:', error);
    } finally {
      this.sessions.delete(interactionId);
      this.emit('session:stopped', interactionId);
    }
  }

  async closeAllSessions(): Promise<void> {
    const interactionIds = Array.from(this.sessions.keys());
    await Promise.all(interactionIds.map(id => this.stopInteractionSession(id)));
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

    // Disabled conversations cannot send messages.
    await this.assertNotDisabled(session);

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
    const utterance: any = {
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

  /**
   * Forward a text message to a DIFFERENT interaction (participant set)
   * without navigating the UI to that chat.
   *
   * The engine keys sessions by participant set, so multiple sessions can
   * coexist. This method either reuses an already-active session for the
   * target participant set, or starts one in the background and waits for
   * it to become active before sending the message.
   *
   * @param ownEntityId    - The impersonated entity
   * @param participantIds - ALL participants of the target chat (incl. ownEntityId)
   * @param text           - The message content to forward
   */
  async forwardTextMessage(
    ownEntityId: string,
    participantIds: string[],
    text: string
  ): Promise<void> {
    const scope = deriveScopeFromParticipants(participantIds);
    const targetKey = deriveParticipantKey(participantIds, ownEntityId, scope);

    // 1) Reuse an existing ACTIVE session for this participant set.
    for (const [id, session] of this.sessions.entries()) {
      if (session.ownEntityId !== ownEntityId) continue;
      const sessionScope = deriveScopeFromParticipants(session.participantIds);
      const sessionKey = deriveParticipantKey(
        session.participantIds,
        ownEntityId,
        sessionScope,
      );
      if (sessionKey !== targetKey) continue;

      const allActive = Array.from(session.connections.values()).every(
        c => c.status === 'active',
      );
      if (allActive) {
        log.info(`Reusing active session ${id} to forward message`);
        return this.sendTextMessage(id, text);
      }
    }

    // 2) No active session — start one in the background and wait for
    //    session:started (fires when all INIT_ENTITY round-trips complete).
    log.info(`Starting background session to forward message to ${targetKey}`);
    await this.startInteractionSession(ownEntityId, participantIds, 'realistic');

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.off('session:started', onStarted);
        reject(new Error('Forward session initialization timed out'));
      }, 25000);

      const onStarted = (interactionId: string, session: InteractionSession) => {
        if (session.ownEntityId !== ownEntityId) return;
        const sessionScope = deriveScopeFromParticipants(session.participantIds);
        const sessionKey = deriveParticipantKey(
          session.participantIds,
          ownEntityId,
          sessionScope,
        );
        if (sessionKey !== targetKey) return;

        clearTimeout(timeout);
        this.off('session:started', onStarted);
        this.sendTextMessage(interactionId, text)
          .then(resolve)
          .catch(reject);
      };

      this.on('session:started', onStarted);
    });
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

    // Disabled conversations cannot send messages.
    await this.assertNotDisabled(session);

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

    // Disabled conversations cannot send messages.
    await this.assertNotDisabled(session);

    const partnerConnectionIds = this.getPartnerConnectionIds(session);
    if (partnerConnectionIds.length === 0) {
      throw new Error(`No active partner connections for interaction ${interactionId}`);
    }

    // Generate UUID v7 for message ID
    const messageId = uuidv7();

    // Store message locally with interaction_id and entity_id = ownEntityId per D-02/D-35
    const message = {
      id: messageId,
      entity_id: session.ownEntityId,
      sender_entity_id: session.ownEntityId,
      interaction_id: session.interactionId,
      content: caption || '',
      audio_duration: null,
      message_type: 'image' as 'image',
      audio_data: null,
      audio_mime_type: null,
      image_data: imageBase64,
      image_mime_type: mimeType,
      vl_model: null,
      vl_model_interpretation: null,
      emotional_state_bits: 0,
      is_recon_followup: false,
      is_edited: false,
      edit_of_message_id: null,
    };

    await createConversationMessage(message);
    log.info(`Stored image message ${messageId} locally for interaction ${interactionId}`);

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

  /**
   * Send a combined utterance (e.g., audio+text) to ALL partner connections
   * in a participant-agnostic broadcast. Used by ChatDetailScreen for
   * audio confirmation flow (handleConfirmAndSendMessage).
   */
  async sendCombinedMessage(
    interactionId: string,
    utterance: any
  ): Promise<void> {
    const session = this.sessions.get(interactionId);
    if (!session) {
      throw new Error(`No active session for interaction ${interactionId}`);
    }

    const partnerConnectionIds = this.getPartnerConnectionIds(session);
    if (partnerConnectionIds.length === 0) {
      throw new Error(`No active partner connections for interaction ${interactionId}`);
    }

    for (const connectionId of partnerConnectionIds) {
      await this.sendUtterance(connectionId, utterance);
    }

    log.info(`Sent combined message ${utterance.message_id} to ${partnerConnectionIds.length} partner(s) for interaction ${interactionId}`);
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

  /**
   * Register a conversation as currently open on screen so incoming messages
   * do NOT bump the unread counter (ChatDetailScreen calls this on mount and
   * unregisters on unmount). Uses the participant key (stable identifier).
   */
  registerOpenConversation(participantKey: string): void {
    if (participantKey) this.openConversationKeys.add(participantKey);
  }

  unregisterOpenConversation(participantKey: string): void {
    if (participantKey) this.openConversationKeys.delete(participantKey);
  }

  isConversationOpen(participantKey: string): boolean {
    return this.openConversationKeys.has(participantKey);
  }

  /**
   * True when the conversation that `session` belongs to is disabled by the
   * local user (see chat_conversation_settings). Disabled conversations
   * cannot send OR receive messages.
   */
  async isSessionDisabled(session: InteractionSession): Promise<boolean> {
    try {
      const scope = deriveScopeFromParticipants(session.participantIds);
      const key = deriveParticipantKey(
        session.participantIds,
        session.ownEntityId,
        scope,
      );
      if (!key) return false;
      // In-memory override wins — the UI writes it synchronously on
      // disable/enable so sends react instantly (no stale DB read).
      if (this.disabledOverrides.has(key)) {
        return Boolean(this.disabledOverrides.get(key));
      }
      const settings = await getChatConversationSettings(key);
      return settings.disabled;
    } catch (error) {
      log.error('Failed to check disabled state for session:', error);
      return false;
    }
  }

  /**
   * Synchronously update the in-memory disabled state for a participant key.
   * Call this right after persisting the disable/enable so the send guard and
   * the incoming handler see the new state immediately.
   */
  setDisabledOverride(participantKey: string, disabled: boolean): void {
    if (!participantKey) return;
    if (disabled) {
      this.disabledOverrides.set(participantKey, true);
    } else {
      this.disabledOverrides.delete(participantKey);
    }
  }

  /**
   * Disable guard for the outbound send paths. Throws a friendly error when
   * the conversation is disabled so the UI can surface it without sending.
   */
  private async assertNotDisabled(session: InteractionSession): Promise<void> {
    if (await this.isSessionDisabled(session)) {
      throw new Error('This AI is disabled. Enable it to chat again.');
    }
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

    // Handle scenario generation responses (§2-4) — GENERATE_GREETING and
    // START_NEW_SCENARIO resolve their waiter (the screen awaits the dispatch).
    if (event.event_type === 'GENERATE_GREETING' || event.event_type === 'START_NEW_SCENARIO') {
      this.handleGenerationResponse(entityId, event, interactionSession, interactionId ?? '');
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

      case 'SET_REPLY_MODE':
        // The server should never broadcast SET_REPLY_MODE to clients.
        // Log a warning in case this ever happens unexpectedly.
        log.warn(`Received unexpected SET_REPLY_MODE from server for entity ${entityId} in interaction ${interactionId} — dropping event (server should not broadcast SET_REPLY_MODE)`);
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
        // Render-only greeting support (§1-10): surface `has_first_mes` from
        // the INIT_ENTITY SUCCESS payload so ChatDetailScreen can branch
        // synchronously (GreetingBubble vs EmptyChatCTA). The greeting itself
        // is NOT fabricated here — the engine delivers it as a normal
        // message_type="greeting" message via the message-load/sync path.
        // Read BEFORE the all-active check so the value is on the session by
        // the time session:started emits (which carries the session object).
        if (typeof event.payload?.has_first_mes === 'boolean') {
          interactionSession.hasFirstMes = event.payload.has_first_mes;
          log.info(
            `Entity ${entityId} reports has_first_mes=${event.payload.has_first_mes} (interaction ${interactionId})`,
          );
        }

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

        if (allActive && !interactionSession.started) {
          interactionSession.started = true;
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

      // Disabled conversations cannot RECEIVE messages either — drop them
      // before they reach the database.
      if (await this.isSessionDisabled(interactionSession)) {
        log.info(`Dropping incoming message from ${event.entity_id}: conversation is disabled`);
        return;
      }

      // Bump the unread counter unless this conversation is open on screen.
      const scope = deriveScopeFromParticipants(interactionSession.participantIds);
      const participantKey = deriveParticipantKey(
        interactionSession.participantIds,
        interactionSession.ownEntityId,
        scope,
      );
      if (participantKey && !this.openConversationKeys.has(participantKey)) {
        try {
          // Muted conversations stay visible in the chat list but never bump
          // the unread badge (O10/F11) — the muted flag is the user's explicit
          // "don't interrupt me" signal.
          const settings = await getChatConversationSettings(participantKey);
          if (!settings.muted) {
            await incrementConversationUnread(participantKey, event.entity_id ?? null);
          }
        } catch (error) {
          log.error('Failed to increment unread count:', error);
        }
      }

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
    log.warn(`Received utterance with message id ${utterance.message_id} from entity ${utterance.entity_id} (event_id: ${eventId})`);

    // Generate our own UUID for this message — each entity perspective must have
    // unique message IDs to prevent sync LWW collisions (the sender's message ID
    // belongs to the sender's interaction, not ours).
    const messageId = uuidv7();
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

}

export default EntitySessionService.getInstance();
