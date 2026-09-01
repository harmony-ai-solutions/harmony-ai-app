import EventEmitter from 'eventemitter3';
import DeviceInfo from 'react-native-device-info';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SyncHelpers from '../database/sync';
import { getPkField } from '../database/pkRegistry';
import ConnectionStateManager from './ConnectionStateManager';
import connectionManagerInstance from './connection/ConnectionManager';
import type { ConnectionManager } from './connection/ConnectionManager';
import { getDatabase, getSyncDatabase } from '../database/connection';
import { createLogger } from '../utils/logger';
import EntityEmojiActionService from './EntityEmojiActionService';
import {
  CONFIG_ID_REFERENCES,
  generateRenamedName,
  isNameUniqueTable,
  nameClashKey,
  PROVIDER_CONFIG_REFERENCES,
  type KeepProviderRefCapture,
  type NameClashApplyDirective,
  type NameClashInfo,
  type NameClashResolution,
} from './syncNameClash';
import type { Database, DatabaseTransaction } from '../database/types';

const log = createLogger('[SyncService]');

// Define event types for type safety
interface SyncServiceEvents {
  'handshake:pending': (payload: any) => void;
  'handshake:accepted': (payload: any) => void;
  'handshake:rejected': (payload: any) => void;
  'sync:started': (session: SyncSession) => void;
  'sync:progress': (session: SyncSession) => void;
  'sync:completed': (session: SyncSession) => void;
  'sync:rejected': (payload: any) => void;
  'sync:error': (error: string) => void;
  'sync:aborted': (reason: string) => void;
  'sync:estimate': (payload: any) => void;
  'sync:estimate:confirm': (accepted: boolean) => void;
  /**
   * Emitted when an incoming server record's unique `name` collides with a
   * DIFFERENT local row during sync apply. The sync pauses until the UI calls
   * `resolveNameClash(resolution, applyToAll)`.
   */
  'sync:nameclash': (clash: NameClashInfo) => void;
  /**
   * Emitted after an inbound sync apply COMMITS, carrying the list of tables
   * that were touched. Consumers (ChatListScreen, CharactersScreen) react
   * based on which tables are present:
   *   - `conversation_messages` → ChatList recounts derived unread badges (3-1)
   *   - `chat_conversation_settings` → ChatList debounced reload (4-1, pin/archive)
   *   - `character_profiles` → CharactersScreen favorite-ids refresh (4-1; favorites now ride the profile row via is_favorite, 000044)
   * Payload is a plain `{ tables: string[] }`.
   */
  'sync:data-applied': (payload: { tables: string[] }) => void;
}

export interface SyncSession {
  sessionId: string;
  deviceId: string;
  deviceName: string;
  startTime: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  recordsSent: number;
  recordsReceived: number;
  error?: string;
  forceFullSync?: boolean;
}

/**
 * The full local-changes upload list, in FK-safe send order (provider configs →
 * module configs → character data → interactions → conversation/state data).
 * Used by both the upload phase (sendLocalChangesSequentially) and to mark the
 * per-table initial-upload set complete on SYNC_FINALIZE (Q7).
 *
 * 4-1: `chat_conversation_settings` rides after `conversation_messages`.
 * Favorites are no longer a sync table: they ride inside `character_profiles`
 * as the `is_favorite` flag (000044), so the favorites sidecar is gone.
 */
export const SYNC_TABLES: string[] = [
  // Provider configs first (no FK dependencies)
  'provider_config_openai',
  'provider_config_ollama',
  'provider_config_openaicompatible',
  'provider_config_openrouter',
  'provider_config_harmonyspeech',
  'provider_config_elevenlabs',
  'provider_config_kindroid',
  'provider_config_kajiwoto',
  'provider_config_characterai',
  'provider_config_localai',
  'provider_config_mistral',
  'provider_config_comfyui',
  'provider_config_xai',
  'provider_config_google',
  'provider_config_anthropic',
  'provider_config_soulbitscloud',
  // Module configs (reference provider configs)
  'backend_configs',
  'cognition_configs',
  'movement_configs',
  'rag_configs',
  'stt_configs',
  'tts_configs',
  'vision_configs',
  'imagination_configs',
  // Character and entity data
  'character_profiles',
  'character_image',
  'entities',
  'entity_module_mappings',
  // Interactions (referenced by conversation_messages)
  'interactions',
  // Conversation and state data
  'conversation_messages',
  'chat_conversation_settings', // 4-1: after messages (participant_key semantics)
  'emotion_state',
  'lifecycle_state',
  'entity_emoji_actions',
  'memories',
];

/**
 * Per-table sort rank for buffered-apply FK-safe ordering (see
 * applyBufferedSyncData). DERIVED from SYNC_TABLES (rank = array index + 1) so
 * the two lists are a single source of truth and can never drift (review fix).
 * A table not in SYNC_TABLES sorts last via the `?? 99` fallback at the sort
 * site (unknown tables are never part of the allowed sync set).
 */
export const TABLE_ORDER: Record<string, number> = Object.fromEntries(
  SYNC_TABLES.map((table, i) => [table, i + 1]),
);

/**
 * Resolve the sync watermark for a single table given the per-table
 * initial-upload set (Q7).
 *
 * A table NOT yet in the set uploads with `since = 0` (full) exactly once; once
 * it has been marked initial-uploaded (on SYNC_FINALIZE), subsequent syncs use
 * the session watermark so only rows changed since the last sync are sent.
 *
 * Contract: re-sends are harmless (LWW apply). The set exists purely to avoid
 * re-uploading every table in full on every sync.
 *
 * @param table - The registered sync table.
 * @param lastSync - The session watermark (already 0 for a force-full-sync).
 * @param initialUploadDone - The tables whose initial full upload completed.
 */
export function resolveTableSyncSince(
  table: string,
  lastSync: number,
  initialUploadDone: string[],
): number {
  return initialUploadDone.includes(table) ? lastSync : 0;
}

export class SyncService extends EventEmitter<SyncServiceEvents> {
  private static instance: SyncService;
  private connectionManager: ConnectionManager;
  private currentSession: SyncSession | null = null;

  // Shared promise for concurrent syncAndWait() callers. While set, additional
  // callers attach to the same in-flight wait instead of starting another one.
  private currentSyncWait: Promise<void> | null = null;

  private syncPhase: 'IDLE' | 'SERVER_SENDING' | 'CLIENT_SENDING' | 'FINALIZING' = 'IDLE';
  private pendingSyncConfirmation: {
    eventId: string;
    resolve: (value: any) => void;
    reject: (reason: any) => void;
  } | null = null;

  // Pending SYNC_DATA_SIZE_ESTIMATE awaiting the user's accept/reject decision.
  // The engine (new protocol) sends an estimate and BLOCKS until the app
  // replies with SYNC_DATA_SIZE_ESTIMATE_CONFIRM — if we never confirm, the
  // engine aborts the sync after its own 60s timeout.
  private pendingSizeEstimate: {
    syncSessionId: string;
    eventId: string;
    estimate: any;
  } | null = null;

  // Handshake promise tracking
  private pendingHandshake: {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timeoutId: ReturnType<typeof setTimeout>;
  } | null = null;

  // Configurable timeout for sync operations (default 30s). Exposed as setter for tests.
  private _syncTimeoutMs: number = 30_000;

  // Buffer for incoming server data (applied atomically when SYNC_COMPLETE received)
  private incomingDataBuffer: Array<{
    table: string;
    operation: 'insert' | 'update' | 'delete';
    record: any;
  }> = [];

  /**
   * Override the sync operation timeout (used by sendSyncDataWithConfirmation).
   * Default is 30_000ms. Set to a lower value (e.g., 500) in tests to avoid waiting.
   */
  setSyncTimeoutMs(ms: number): void {
    this._syncTimeoutMs = ms;
  }

  // Track IDs of records received from server this session to exclude from local changes
  private serverRecordIds: Set<string> = new Set();

  // Provider config rows merged into the server row by a "keep" resolution
  // (table:id of the SERVER row that now holds the app-local values). These
  // must also be re-sent in the upload phase — removing them from
  // serverRecordIds lets them through.
  private keepCascadedProviderKeys: Set<string> = new Set();

  // Pending name-clash resolution: the sync apply is paused until the user
  // decides (overwrite/keep/rename) for each clash in `clashes` (or selects
  // "apply to all"). Mirrors pendingSizeEstimate / confirmSizeEstimate.
  private pendingNameClash: {
    clashes: NameClashInfo[];
    index: number;
    decisions: Map<string, NameClashResolution>;
    resolve: () => void;
    reject: (reason: Error) => void;
  } | null = null;

  // "Apply to all" decision memorized for the CURRENT sync session only.
  // Cleared whenever a new sync session starts (initiateSync) or the session
  // aborts/rejects — it must never leak into the next sync.
  private nameClashApplyToAllResolution: NameClashResolution | null = null;

  private constructor() {
    super();
    this.connectionManager = connectionManagerInstance;
    this.setupConnectionListeners();
  }

  static getInstance(): SyncService {
    if (!SyncService.instance) {
      SyncService.instance = new SyncService();
    }
    return SyncService.instance;
  }

  /**
   * Register the sync connection listeners.
   *
   * IMPORTANT — idempotency across Metro hot reloads: this module default-
   * exports a singleton and is re-executed on every Fast Refresh, which would
   * normally create a NEW SyncService instance that registers ANOTHER listener
   * set on the RETAINED ConnectionManager singleton. Old instances are
   * orphaned but their listeners persist, so every event would be delivered
   * once per instance (observed 8-10x on-device: "Received SYNC_ACCEPT but no
   * current session" x10, "Aborting sync session" x7-9 per event). Two
   * mechanisms prevent that:
   *
   *  1. The ConnectionManager singleton holds the CURRENT SyncService instance
   *     in `syncServiceEventTarget`. Each new SyncService constructor sets it,
   *     so the single installed listener set always delegates to the newest
   *     instance and stale instances are bypassed entirely.
   *  2. The actual listeners are installed only ONCE per ConnectionManager
   *     lifetime (guarded by `syncServiceListenersInstalled`).
   */
  private setupConnectionListeners() {
    const cm = this.connectionManager as ConnectionManager & {
      syncServiceEventTarget?: SyncService | null;
      syncServiceListenersInstalled?: boolean;
    };

    // Make THIS instance the current event target (survives hot reloads).
    cm.syncServiceEventTarget = this;

    // Install the listeners exactly once per ConnectionManager lifetime.
    if (cm.syncServiceListenersInstalled) {
      return;
    }
    cm.syncServiceListenersInstalled = true;

    // Listen ONLY to sync connection events from ConnectionManager.
    cm.on('event:sync', (data: any) => cm.syncServiceEventTarget?.routeSyncEvent(data));

    // Self-healing: if the sync connection is lost, errors, or is torn down
    // mid-session (e.g. the ws→wss security-mode upgrade replacing the
    // connection while SYNC_DATA is being buffered), abort the in-flight
    // session so the `initiateSync` guard can never be permanently stuck on
    // 'in_progress'. Without this, a dropped connection leaves currentSession
    // orphaned and every future sync logs "Sync already in progress, skipping".
    cm.on('disconnected:sync', () => cm.syncServiceEventTarget?.abortSync('sync connection disconnected'));
    cm.on('error:sync', () => cm.syncServiceEventTarget?.abortSync('sync connection error'));
    // Emitted by ConnectionManager when createConnection() replaces an existing
    // sync connection (deliberate teardown). The underlying WS object's own
    // 'disconnected' event is intentionally suppressed there (listeners removed
    // before disconnect), so this dedicated signal covers the upgrade path.
    cm.on('sync:connection_replaced', () => cm.syncServiceEventTarget?.abortSync('sync connection replaced'));
  }

  private routeSyncEvent(data: any) {
    log.info(`Received sync event: ${data.event_type} status: ${data.status}`);

    // IGNORE acknowledgment statuses - these are transport/processing confirmations, not actionable events
    // Only process NEW and ERROR status events which contain actionable data
    // EXCEPTION: Allow SYNC_COMPLETE, SYNC_FINALIZE and SYNC_DATA_SIZE_ESTIMATE
    // with SUCCESS status through (protocol signals when finishing/measuring the sync).
    if (data.status === 'PENDING' || (data.status === 'SUCCESS' && (data.event_type !== 'SYNC_COMPLETE') && data.event_type !== 'SYNC_FINALIZE' && data.event_type !== 'SYNC_DATA_SIZE_ESTIMATE')) {
      log.debug(`Ignoring ${data.status} status event: ${data.event_type}`);
      return;
    }

    switch (data.event_type) {
      case 'HANDSHAKE_PENDING':
        this.emit('handshake:pending', data.payload);
        break;

      case 'HANDSHAKE_ACCEPT':
        this.handleHandshakeAccept(data.payload);
        break;

      case 'HANDSHAKE_REJECT':
        this.handleHandshakeReject(data.payload);
        break;

      case 'SYNC_REQUEST':
        if (data.status === 'ERROR') {
          this.handleSyncReject(data.payload);
        }
        break;

      case 'SYNC_ACCEPT':
        this.handleSyncAccept(data.payload);
        break;

      case 'SYNC_REJECT':
        this.handleSyncReject(data.payload);
        break;

      case 'SYNC_DATA_SIZE_ESTIMATE':
        this.handleSizeEstimate(data.payload);
        break;

      case 'SYNC_DATA':
        this.handleIncomingSyncData(data.payload);
        break;

      case 'SYNC_DATA_CONFIRM':
        this.handleSyncDataConfirm(data.payload);
        break;

      case 'SYNC_COMPLETE':
        this.handleSyncComplete(data);
        break;

      case 'SYNC_FINALIZE':
        this.handleSyncFinalize();
        break;

      default:
        log.warn(`Unhandled sync event type: ${data.event_type}`);
    }
  }

  private generateEventId(): string {
    return `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async requestHandshake(): Promise<void> {
    const deviceId = await DeviceInfo.getUniqueId();
    const deviceName = await DeviceInfo.getDeviceName();

    const event = {
      event_id: this.generateEventId(),
      event_type: 'HANDSHAKE_REQUEST',
      status: 'NEW',
      payload: {
        device_id: deviceId,
        device_name: deviceName,
        device_type: 'phone',
        device_platform: Platform.OS
      }
    };

    log.info('Requesting handshake:', event);
    await this.connectionManager.sendEvent('sync', event);
  }

  /**
   * Request handshake and wait for the response.
   * Returns a Promise that resolves when HANDSHAKE_ACCEPT is received.
   * Rejects on timeout or if HANDSHAKE_REJECT is received.
   */
  async requestHandshakeWithWait(timeoutMs: number = 30000): Promise<any> {
    // Check if there's already a pending handshake
    if (this.pendingHandshake) {
      log.warn('Handshake already in progress, rejecting previous one');
      this.pendingHandshake.reject(new Error('New handshake requested'));
      clearTimeout(this.pendingHandshake.timeoutId);
      this.pendingHandshake = null;
    }

    return new Promise(async (resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        log.error(`Handshake timed out after ${timeoutMs}ms`);
        this.pendingHandshake = null;
        reject(new Error('Handshake timeout'));
      }, timeoutMs);

      // Store pending handshake
      this.pendingHandshake = { resolve, reject, timeoutId };

      try {
        // Send the handshake request
        await this.requestHandshake();
        log.info('Handshake request sent, waiting for response...');
      } catch (error) {
        // If sending fails, clear timeout and reject immediately
        clearTimeout(timeoutId);
        this.pendingHandshake = null;
        reject(error);
      }
    });
  }

  private async handleHandshakeAccept(payload: any): Promise<void> {
    log.info('Handshake accepted:', payload);

    // Resolve pending handshake if exists
    if (this.pendingHandshake) {
      clearTimeout(this.pendingHandshake.timeoutId);
      this.pendingHandshake.resolve(payload);
      this.pendingHandshake = null;
    }

    await AsyncStorage.setItem('harmony_jwt', payload.jwt_token);

    // Get the server URL from the current WebSocket connection
    const currentWsUrl = await AsyncStorage.getItem('harmony_server_url');
    if (currentWsUrl) {
      let wssUrl: string;

      if (payload.wss_port === 0) {
        // Single-port mode: WSS on same port as WS, just change scheme
        wssUrl = currentWsUrl.replace(/^ws:\/\//, 'wss://');
        log.info('Single-port mode: WSS on same port as WS');
      } else {
        // Dual-port mode: replace port with wss_port from handshake
        wssUrl = currentWsUrl.replace(/^ws:\/\//, 'wss://').replace(/:\d+/, `:${payload.wss_port}`);
      }

      await AsyncStorage.setItem('harmony_wss_url', wssUrl);
      log.info(`Constructed WSS URL: ${wssUrl}`);
    }

    await AsyncStorage.setItem('harmony_server_cert', payload.server_cert);
    await AsyncStorage.setItem('harmony_token_expires_at', payload.token_expires_at.toString());

    // Only set default security mode if user hasn't chosen one yet
    // Default mode is required to "upgrade" the handler on first handshake,
    // but on Token refresh, we already have one set, so we can keep it as it is.
    const currentMode = await ConnectionStateManager.getSecurityMode();
    if (!currentMode) {
      await ConnectionStateManager.saveSecurityMode('secure');
    }

    this.emit('handshake:accepted', payload);
  };

  private handleHandshakeReject(payload: any): void {
    log.warn('Handshake rejected:', payload);

    // Reject pending handshake if exists
    if (this.pendingHandshake) {
      clearTimeout(this.pendingHandshake.timeoutId);
      this.pendingHandshake.reject(new Error(payload.message || 'Device rejected'));
      this.pendingHandshake = null;
    }

    this.emit('handshake:rejected', payload);
  }

  async initiateSync(forceFullSync: boolean = false): Promise<void> {
    // Guard: Skip if a sync is already in flight — either actively in progress
    // (SYNC_ACCEPT received) OR still awaiting acceptance (SYNC_REQUEST sent,
    // status 'pending'). Without the 'pending' check, two concurrent callers
    // (e.g. auto-sync on connect + syncAndWait after entity creation) each send
    // a SYNC_REQUEST milliseconds apart. The second request overwrites
    // currentSession, so the engine's SYNC_DATA_SIZE_ESTIMATE for the FIRST
    // session is ignored (session-id mismatch) and never confirmed — the engine
    // then aborts the sync after its own timeout with `size_estimate_rejected`.
    if (
      this.currentSession &&
      (this.currentSession.status === 'in_progress' || this.currentSession.status === 'pending')
    ) {
      log.info('Sync already in progress (or awaiting acceptance), skipping');
      return;
    }

    // Guard: Check connection is available
    if (!this.connectionManager.isConnected('sync')) {
      log.warn('Cannot initiate sync: sync connection not available');
      return;
    }

    const storedLastSync = forceFullSync ? 0 : await this.getLastSyncTimestamp();

    // The engine keeps its OWN per-device sync watermark and IGNORES the
    // client's `last_sync_timestamp` field from SYNC_REQUEST — it only resends
    // everything when `force_full_sync` is set. So a bare `last_sync_timestamp: 0`
    // from a freshly-installed or wiped client returns 0 records (the engine
    // considers its data "already sent" to this device).
    //
    // A client with no stored watermark has nothing locally, so requesting a
    // full pull is correct and lossless: escalate to force_full_sync so the
    // engine overrides its own watermark and resends all records.
    const effectiveForceFullSync = forceFullSync || storedLastSync === 0;
    const lastSync = effectiveForceFullSync ? 0 : storedLastSync;

    const deviceId = await DeviceInfo.getUniqueId();
    const deviceName = await DeviceInfo.getDeviceName();

    // Clear server to ensure we have a clean session
    this.serverRecordIds.clear();
    this.keepCascadedProviderKeys.clear();

    // Name-clash decisions are SESSION-scoped: forget any "apply to all"
    // selection from a previous sync session and drop a stale pending wait.
    this.nameClashApplyToAllResolution = null;
    this.pendingNameClash = null;

    // new sync session
    this.currentSession = {
      sessionId: this.generateEventId(),
      deviceId: deviceId,
      deviceName: deviceName,
      startTime: Math.floor(Date.now() / 1000),
      status: 'pending',
      recordsSent: 0,
      recordsReceived: 0,
      forceFullSync: effectiveForceFullSync
    };

    const event = {
      event_id: this.generateEventId(),
      event_type: 'SYNC_REQUEST',
      status: 'NEW',
      payload: {
        device_id: deviceId,
        device_name: deviceName,
        device_type: 'phone',
        device_platform: Platform.OS,
        current_utc_timestamp: this.currentSession.startTime,
        last_sync_timestamp: lastSync,
        force_full_sync: effectiveForceFullSync
      }
    };

    try {
      log.info('Initiating sync:', event);
      await this.connectionManager.sendEvent('sync', event);
    } catch (sendError) {
      log.error('Failed to send SYNC_REQUEST:', sendError);

      // Clear session since sync failed to initiate
      this.currentSession = null;

      // Emit error event so UI can show appropriate message
      this.emit('sync:error', 'Failed to initiate sync - connection may be lost');

      // Re-throw so caller knows it failed
      throw sendError;
    }
  }

  /**
   * Forces a complete re-sync by requesting all data from the server
   * and re-sending all local data. Useful after data migrations.
   */
  async forceFullSync(): Promise<void> {
    log.info('Forcing full re-sync');
    return this.initiateSync(true);
  }

  /**
   * Initiate a sync (if one isn't already running) and resolve once it actually
   * COMPLETES (SYNC_FINALIZE → 'sync:completed').
   *
   * Why this exists: `initiateSync()` resolves the moment SYNC_REQUEST is *sent*,
   * not when the engine has applied the data. Callers that need the engine to
   * already know about freshly-created records (e.g. creating an entity then
   * immediately opening its chat, which sends INIT_ENTITY) must wait for the
   * full round-trip — otherwise the engine rejects with `entity_not_defined`.
   *
   * Behaviour:
   *   - Resolves on 'sync:completed'.
   *   - Resolves best-effort (with a warning) on 'sync:error'/'sync:rejected'/
   *     'sync:aborted' or after `timeoutMs`, so callers are never blocked
   *     forever (e.g. a pending size-estimate confirmation the user hasn't
   *     acted on). The caller proceeds; the chat's own session logic surfaces
   *     any remaining problem.
   *   - Concurrent callers share a single wait.
   */
  async syncAndWait(options?: { timeoutMs?: number }): Promise<void> {
    // If a sync is already running (started via initiateSync or another waiter),
    // attach to the shared wait promise.
    if (this.currentSyncWait) {
      return this.currentSyncWait;
    }

    const timeoutMs = options?.timeoutMs ?? 45_000;
    this.currentSyncWait = this.runSyncAndWait(timeoutMs);
    try {
      await this.currentSyncWait;
    } finally {
      this.currentSyncWait = null;
    }
  }

  private runSyncAndWait(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;

      const cleanup = () => {
        this.off('sync:completed', onDone);
        this.off('sync:error', onDone);
        this.off('sync:rejected', onDone);
        this.off('sync:aborted', onDone);
      };

      const onDone = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        resolve();
      };

      timer = setTimeout(() => {
        log.warn(`syncAndWait timed out after ${timeoutMs}ms — proceeding (best-effort)`);
        onDone();
      }, timeoutMs);

      this.on('sync:completed', onDone);
      this.on('sync:error', onDone);
      this.on('sync:rejected', onDone);
      this.on('sync:aborted', onDone);

      // Kick off a sync if one isn't already running. initiateSync self-guards
      // (no-op when one is in progress or the connection is unavailable), so we
      // safely attach to an in-flight sync when present.
      this.initiateSync().catch(err => {
        log.warn('syncAndWait: initiateSync failed (best-effort):', err);
      });
    });
  }

  /**
   * Abort any in-flight sync session and reset all sync state.
   *
   * Called when the sync connection is lost, errors, or is deliberately
   * replaced mid-session (e.g. the ws→wss security-mode upgrade tearing down
   * the provisional connection while SYNC_DATA is being buffered).
   *
   * Without this hook, a mid-session connection loss orphans `currentSession`
   * with status 'in_progress' forever — the `initiateSync` guard then rejects
   * every future sync ("Sync already in progress, skipping") until the app
   * process restarts. This method guarantees the sync state machine always
   * returns to a clean slate so the next connection can start a fresh sync.
   *
   * Note: buffered server data is intentionally discarded (not applied). The
   * last-sync timestamp is not advanced, so the engine re-sends everything on
   * the next sync — a full re-sync is the safe, lossless recovery path.
   */
  abortSync(reason: string = 'connection lost'): void {
    // Idempotent guard: if nothing is in flight there is nothing to abort.
    // Duplicate/legacy listeners (or repeated calls) must not re-log or
    // re-emit `sync:aborted` — this makes N stacked listeners harmless even
    // before a cold restart clears them.
    if (!this.currentSession && !this.pendingSyncConfirmation && !this.pendingNameClash) {
      return;
    }

    log.warn(`Aborting sync session: ${reason}`);

    // Reject any pending SYNC_DATA confirmation so awaiting code doesn't hang
    // until the 30s timeout.
    if (this.pendingSyncConfirmation) {
      const { reject } = this.pendingSyncConfirmation;
      this.pendingSyncConfirmation = null;
      reject(new Error(`Sync aborted: ${reason}`));
    }

    // Reject any pending name-clash wait so applyBufferedSyncData does not
    // hang on a user decision that can never come (the sync is gone).
    if (this.pendingNameClash) {
      const pending = this.pendingNameClash;
      this.pendingNameClash = null;
      pending.reject(new Error(`Sync aborted: ${reason}`));
    }
    this.nameClashApplyToAllResolution = null;

    // Clear session + phase so the initiateSync guard is released.
    this.currentSession = null;
    this.syncPhase = 'IDLE';
    this.incomingDataBuffer = [];
    this.serverRecordIds.clear();

    this.emit('sync:aborted', reason);
  }

  /**
   * Handle a sync rejection from the engine (SYNC_REJECT, or SYNC_REQUEST with
   * ERROR status). The engine aborts a sync for reasons like a rejected size
   * estimate or a confirmation timeout.
   *
   * The session state MUST be reset here — otherwise currentSession is left
   * stuck and the `initiateSync` guard blocks every future sync (the engine
   * already considers the session dead, so it never clears it via SYNC_ACCEPT).
   */
  private handleSyncReject(payload: any): void {
    log.warn('Sync rejected:', payload);

    if (this.currentSession) {
      this.currentSession.status = 'failed';
      this.currentSession = null;
    }
    this.syncPhase = 'IDLE';
    this.incomingDataBuffer = [];
    this.serverRecordIds.clear();

    // Unblock any pending name-clash wait — the session is dead.
    if (this.pendingNameClash) {
      const pending = this.pendingNameClash;
      this.pendingNameClash = null;
      pending.reject(new Error('Sync rejected'));
    }
    this.nameClashApplyToAllResolution = null;

    this.emit('sync:rejected', payload);
  }

  private async handleSyncAccept(payload: any): Promise<void> {
    if (!this.currentSession) {
      log.warn('Received SYNC_ACCEPT but no current session');
      return;
    }

    log.info('Sync accepted:', payload);
    this.currentSession.status = 'in_progress';
    this.currentSession.sessionId = payload.sync_session_id;

    // Store force_full_sync flag from server response
    if (payload.force_full_sync) {
      this.currentSession.forceFullSync = true;
    }

    // Set phase to SERVER_SENDING and clear buffer
    this.syncPhase = 'SERVER_SENDING';
    this.incomingDataBuffer = [];

    this.emit('sync:started', this.currentSession);

    // Send SYNC_START to trigger server to send its changes
    const startEvent = {
      event_id: this.generateEventId(),
      event_type: 'SYNC_START',
      status: 'NEW',
      payload: {
        sync_session_id: this.currentSession.sessionId
      }
    };

    log.info('Sending SYNC_START to trigger server data transmission');
    await this.connectionManager.sendEvent('sync', startEvent);

    // DO NOT send local changes yet - wait for server SYNC_COMPLETE
  }

  /**
   * Handle a SYNC_DATA_SIZE_ESTIMATE from the engine.
   *
   * The engine (new protocol) sends an estimate of the data it is about to
   * push, then BLOCKS until the app replies with SYNC_DATA_SIZE_ESTIMATE_CONFIRM
   * (60s timeout → engine aborts). We do NOT block here — we store the pending
   * estimate and surface it via the 'sync:estimate' event so the UI layer can
   * prompt the user and eventually call `confirmSizeEstimate`.
   *
   * Backward compat: if an older engine sends no estimate and goes straight to
   * SYNC_DATA, nothing is stored and the sync proceeds exactly as before.
   */
  private async handleSizeEstimate(payload: any): Promise<void> {
    if (!payload || !payload.event_id || !payload.sync_session_id) {
      log.warn('SYNC_DATA_SIZE_ESTIMATE missing event_id or sync_session_id, ignoring');
      return;
    }

    if (!this.currentSession) {
      log.warn('Received SYNC_DATA_SIZE_ESTIMATE but no current session, ignoring');
      return;
    }

    // Defensive: ignore an estimate that does not belong to the active session
    // (e.g. a stale estimate from a previous, already-aborted session).
    if (this.currentSession.sessionId !== payload.sync_session_id) {
      log.warn(
        `Received SYNC_DATA_SIZE_ESTIMATE for session ${payload.sync_session_id} but active session is ${this.currentSession.sessionId} — ignoring`,
      );
      return;
    }

    this.pendingSizeEstimate = {
      syncSessionId: payload.sync_session_id,
      eventId: payload.event_id,
      estimate: payload,
    };

    log.info(
      `Received size estimate for session ${payload.sync_session_id} (event ${payload.event_id})`,
    );
    this.emit('sync:estimate', payload);
  }

  /**
   * Confirm (or reject) the pending size estimate back to the engine.
   *
   * The engine is waiting on its own side — the app just needs to eventually
   * send the confirmation so the engine can proceed (SUCCESS) or abort (REJECTED).
   *
   * @param accepted true → SYNC_DATA_SIZE_ESTIMATE_CONFIRM status SUCCESS,
   *                 false → status REJECTED + the session is aborted.
   */
  async confirmSizeEstimate(accepted: boolean): Promise<void> {
    if (!this.pendingSizeEstimate) {
      log.warn('confirmSizeEstimate called but no pending size estimate');
      return;
    }

    const { syncSessionId, eventId } = this.pendingSizeEstimate;
    this.pendingSizeEstimate = null;

    const event = {
      event_id: this.generateEventId(),
      event_type: 'SYNC_DATA_SIZE_ESTIMATE_CONFIRM',
      status: 'NEW',
      payload: {
        sync_session_id: syncSessionId,
        event_id: eventId,
        status: accepted ? 'SUCCESS' : 'REJECTED',
      },
    };

    log.info(`Sending size estimate confirmation: ${accepted ? 'SUCCESS' : 'REJECTED'}`);

    try {
      await this.connectionManager.sendEvent('sync', event);
    } catch (sendError) {
      log.error('Failed to send SYNC_DATA_SIZE_ESTIMATE_CONFIRM:', sendError);
    }

    if (!accepted) {
      // User rejected the estimated download — tear down the session. Buffered
      // server data (if any) is discarded; nothing is applied to the database.
      this.abortSync('size estimate rejected');
    }

    this.emit('sync:estimate:confirm', accepted);
  }

  /**
   * Apply buffered sync records in a single atomic transaction
   */
  private async applyBufferedSyncData(): Promise<void> {
    if (this.incomingDataBuffer.length === 0) {
      log.info('No buffered data to apply');
      return;
    }

    // Use the dedicated sync database connection so the heavy write-
    // transaction does not block the main connection used by UI queries
    // (ChatDetailScreen message loading, chat-list previews, etc.).
    // WAL mode allows concurrent reads on the main connection.
    const db = await getSyncDatabase();
    const recordCount = this.incomingDataBuffer.length;

    // Debug: Log the buffer contents
    log.info(`Applying ${recordCount} buffered sync records in transaction`);
    log.info('Buffer contents:');
    this.incomingDataBuffer.forEach((item, index) => {
      const pkField = getPkField(item.table);
      const pkValue = item.record[pkField];
      log.info(`  [${index + 1}/${recordCount}] ${item.table}.${item.operation} (${pkField}=${pkValue})`);
    });

    // ── Name-clash resolution (pre-pass) ──────────────────────────────────
    // An incoming record whose unique `name` collides with a DIFFERENT local
    // row would fail on the UNIQUE(name) constraint and roll back the whole
    // transaction. Detect those BEFORE opening the transaction, ask the user
    // (via sync:nameclash + resolveNameClash) how to resolve each clash, and
    // build an apply plan so the transaction never touches a violating INSERT.
    const clashes = await this.detectNameClashes(db);
    let applyPlan = new Map<string, NameClashApplyDirective>();
    if (clashes.length > 0) {
      log.warn(`Detected ${clashes.length} name clash(es) in buffered server data`);
      let decisions: Map<string, NameClashResolution>;
      try {
        decisions = await this.collectNameClashDecisions(clashes);
      } catch (error) {
        // Session was aborted/rejected while the user was deciding — discard
        // the buffered data without erroring (abortSync already reset state).
        log.warn('Name-clash decision wait aborted, discarding buffered data:', error);
        this.incomingDataBuffer = [];
        this.serverRecordIds.clear();
        return;
      }
      applyPlan = await this.buildApplyPlan(db, clashes, decisions);
    }

    // Provider config rows that a "keep" directive adopts: the incoming row is
    // SKIPPED during the apply (no insert), because the keep cascade renames
    // the app-local provider config to that server id instead — preserving the
    // app-local provider values (see cascadeKeepProviderConfig).
    const keptProviderServerIds = new Set<string>();
    for (const [key, directive] of applyPlan) {
      if (directive.kind === 'keep') {
        const clash = clashes.find(c => nameClashKey(c.table, c.incomingId) === key);
        const incoming = clash?.incomingRecord;
        for (const ref of directive.providerRefs) {
          const incomingProvider = incoming?.[ref.providerColumn];
          const incomingProviderConfigId = incoming?.[ref.configColumn];
          if (incomingProvider && incomingProviderConfigId) {
            keptProviderServerIds.add(
              `provider_config_${incomingProvider}:${incomingProviderConfigId}`,
            );
          }
        }
      }
    }

    // Track which tables this apply touches so the post-commit
    // `sync:data-applied` event can carry the applied table list (3-1 → 4-1).
    const appliedTables = new Set<string>();

    return new Promise<void>((resolve, reject) => {
      // Sort buffer by dependency order to satisfy FK constraints in correct
      // sequence (single source of truth: TABLE_ORDER is DERIVED from
      // SYNC_TABLES above — never maintain a second hand-written list):
      //   1. Provider configs (no dependencies)
      //   2. Module configs (reference provider configs)
      //   3. character_profiles (no FK deps)
      //   4. character_image (references character_profiles)
      //   5. entities (references character_profiles)
      //   6. entity_module_mappings (references entities + module configs)
      //   7. interactions (referenced by conversation_messages)
      //   8. conversation_messages, chat_conversation_settings, emotion_state,
      //      lifecycle_state, entity_emoji_actions, memories (reference
      //      entities / no FKs) — ride after the interactions tier.
      const sortedBuffer = [...this.incomingDataBuffer].sort((a, b) => {
        const orderA = TABLE_ORDER[a.table] ?? 99;
        const orderB = TABLE_ORDER[b.table] ?? 99;
        return orderA - orderB;
      });

      db.transaction(
        (tx) => {
          // Enable deferred foreign key checking to allow FK references within the
          // same transaction. Combined with sorted buffer order, this handles
          // circular deps at commit time.
          tx.executeSql('PRAGMA defer_foreign_keys = ON');

          // Apply all buffered records synchronously within transaction (sorted by dependency order)
          for (const item of sortedBuffer) {
            appliedTables.add(item.table);
            const pkField = getPkField(item.table);
            const pkValue = item.record[pkField];

            // ── Name-clash resolutions ────────────────────────────────────
            const directive = applyPlan.get(nameClashKey(item.table, pkValue));
            if (directive && directive.kind !== 'rename') {
              // overwrite / keep: adopt the server id (+ values) and remap
              // local references. No INSERT is attempted, so the UNIQUE(name)
              // constraint is never violated.
              this.applyIdAdoption(tx, item, directive);
              continue;
            }
            if (directive && directive.kind === 'rename') {
              // Rename the local entry (freeing the unique name), then fall
              // through to the normal INSERT path for the server record below.
              tx.executeSql(
                `UPDATE ${item.table} SET name = ?, updated_at = ? WHERE id = ?`,
                [directive.newName, new Date().toISOString(), directive.localId],
                () => {
                  log.debug(`  ✓ RENAMED local ${item.table}:${directive.localId} → ${directive.newName}`);
                },
                (_, error) => {
                  log.error(`  ❌ RENAME FAILED for ${item.table}:${directive.localId}`);
                  log.error(`  Error: ${error.message} (code: ${(error as any).code || 'unknown'})`);
                  return false; // Rollback
                }
              );
            }

            if (item.operation === 'delete') {
              // Soft delete
              log.debug(`  Executing DELETE for ${item.table}:${pkValue}`);
              tx.executeSql(
                `UPDATE ${item.table} SET deleted_at = ?, updated_at = ? WHERE ${pkField} = ?`,
                [item.record.deleted_at, item.record.updated_at, pkValue],
                () => {
                  log.debug(`  ✓ DELETE successful for ${item.table}:${pkValue}`);
                },
                (_, error) => {
                  log.error(`  ❌ DELETE FAILED for ${item.table}:${pkValue}`);
                  log.error(`  Error: ${error.message} (code: ${(error as any).code || 'unknown'})`);
                  log.error(`  Record:`, JSON.stringify(item.record, null, 2));
                  return false; // Rollback
                }
              );
            } else if (keptProviderServerIds.has(`${item.table}:${pkValue}`)) {
              // A provider config a "keep" directive adopts: skip the insert —
              // the cascade renames the app-local provider config to this id
              // (keeping the app-local values), so inserting the server copy
              // would collide with the renamed row.
              log.debug(`Skipping insert for keep-adopted provider config ${item.table}:${pkValue}`);
            } else {
              // Check if record exists, then insert or update
              tx.executeSql(
                `SELECT updated_at FROM ${item.table} WHERE ${pkField} = ?`,
                [pkValue],
                (_, result) => {
                  if (result.rows.length === 0) {
                    // Insert new record
                    log.debug(`  Executing INSERT for ${item.table}:${pkValue}`);
                    log.debug(`  Record data:`, JSON.stringify(item.record, null, 2));
                    const columns = Object.keys(item.record).join(', ');
                    const placeholders = Object.keys(item.record).map(() => '?').join(', ');
                    const values = Object.values(item.record);

                    tx.executeSql(
                      `INSERT INTO ${item.table} (${columns}) VALUES (${placeholders})`,
                      values,
                      () => {
                        log.debug(`  ✓ INSERT successful for ${item.table}:${pkValue}`);
                      },
                      (__, error) => {
                        log.error(`  ❌ INSERT FAILED for ${item.table}:${pkValue}`);
                        log.error(`  Error: ${error.message} (code: ${(error as any).code || 'unknown'})`);
                        log.error(`  SQL: INSERT INTO ${item.table} (${columns}) VALUES (...)`);

                        // Log FK field values to identify constraint violations
                        const fkFields = this.getForeignKeyFields(item.table);
                        if (fkFields.length > 0) {
                          log.error(`  Foreign Key Fields:`);
                          fkFields.forEach(fk => {
                            const value = item.record[fk];
                            log.error(`    - ${fk}: ${value === null ? 'NULL' : value === undefined ? 'UNDEFINED' : `"${value}"`}`);
                          });
                        }

                        log.error(`  Full Record:`, JSON.stringify(item.record, null, 2));
                        return false; // Rollback
                      }
                    );
                  } else {
                    // Last-Write-Wins: Compare timestamps
                    const existingUpdated = SyncHelpers.toUnixTimestamp(result.rows.item(0).updated_at);
                    const incomingUpdated = SyncHelpers.toUnixTimestamp(item.record.updated_at);

                    if (incomingUpdated >= existingUpdated) {
                      // Incoming wins - update
                      log.debug(`  Executing UPDATE for ${item.table}:${pkValue}`);
                      log.debug(`  Record data:`, JSON.stringify(item.record, null, 2));
                      const updates = Object.keys(item.record)
                        .filter(k => k !== pkField)
                        .map(k => `${k} = ?`)
                        .join(', ');
                      const values = Object.keys(item.record)
                        .filter(k => k !== pkField)
                        .map(k => item.record[k]);
                      values.push(pkValue);

                      tx.executeSql(
                        `UPDATE ${item.table} SET ${updates} WHERE ${pkField} = ?`,
                        values,
                        () => {
                          log.debug(`  ✓ UPDATE successful for ${item.table}:${pkValue}`);
                        },
                        (__, error) => {
                          log.error(`  ❌ UPDATE FAILED for ${item.table}:${pkValue}`);
                          log.error(`  Error: ${error.message} (code: ${(error as any).code || 'unknown'})`);
                          log.error(`  Record:`, JSON.stringify(item.record, null, 2));
                          return false; // Rollback
                        }
                      );
                    } else {
                      log.debug(`  Skipping UPDATE for ${item.table}:${pkValue} (local is newer)`);
                    }
                  }
                },
                (_, error) => {
                  log.error(`Error checking existing record: ${error.message}`);
                  return false; // Rollback
                }
              );
            }
          }
        },
        (error) => {
          log.error('❌ Transaction failed/rolled back:', error);
          log.error(`  Error message: ${error.message}`);
          log.error(`  Error code: ${(error as any).code || 'unknown'}`);

          // Critical cleanup on failure
          log.warn('Cleaning up after transaction failure');
          this.incomingDataBuffer = []; // Clear buffer
          this.serverRecordIds.clear(); // Clear server record tracking
          this.keepCascadedProviderKeys.clear();
          this.syncPhase = 'IDLE'; // Reset sync phase

          // Clear current session
          if (this.currentSession) {
            log.warn(`Clearing failed sync session: ${this.currentSession.sessionId}`);
            this.currentSession.status = 'failed';
            this.currentSession = null;
          }

          reject(error);
        },
        () => {
          log.info(`✅ Transaction committed successfully - applied ${recordCount} records`);
          this.incomingDataBuffer = []; // Clear buffer after successful commit

          // "keep"-resolved records must be RE-SENT in the upload phase: the
          // local values now live under the server's id, but the server's copy
          // still holds ITS values. Remove them from serverRecordIds so the
          // upload filter (sendLocalChangesSequentially) lets them through —
          // otherwise the server never learns the kept (final) version.
          for (const [key, directive] of applyPlan) {
            if (directive.kind === 'keep') {
              this.serverRecordIds.delete(key);
              log.debug(`Re-queueing keep-resolved record for upload: ${key}`);
            }
          }

          // The "keep"-cascaded provider configs too: their rows now hold the
          // app-local provider values under the server's provider config id.
          for (const providerKey of this.keepCascadedProviderKeys) {
            this.serverRecordIds.delete(providerKey);
            log.debug(`Re-queueing keep-cascaded provider config for upload: ${providerKey}`);
          }
          this.keepCascadedProviderKeys.clear();

          // Invalidate service caches that may be stale after incoming sync
          EntityEmojiActionService.invalidateAllCaches();

          // Tell consumers (ChatListScreen, CharactersScreen) which tables
          // changed so they can refresh derived unread / pin-archive / favorite
          // state (3-1 → 4-1: generalized event, per-table consumption).
          if (appliedTables.size > 0) {
            this.emit('sync:data-applied', { tables: Array.from(appliedTables) });
          }

          resolve();
        }
      );
    });
  }

  private async sendLocalChangesSequentially(lastSync: number): Promise<void> {
    if (!this.currentSession) {
      log.error('No active sync session');
      return;
    }

    // Failsafe: Clean up orphan entity_module_mappings before sync
    // This handles cases where entity was soft-deleted but mapping wasn't cascaded
    try {
      const cleanedCount = await SyncHelpers.cleanupOrphanEntityModuleMappings();
      if (cleanedCount > 0) {
        log.info(`Cleaned up ${cleanedCount} orphan entity_module_mappings before sync`);
      }
    } catch (error) {
      log.warn('Failed to cleanup orphan entity_module_mappings:', error);
      // Continue with sync even if cleanup fails
    }

    log.info(`Sending local changes since: ${lastSync}`);

    try {
      // Define table order respecting FK dependencies (must match server send order)
      const tables = SYNC_TABLES;

      // Per-table initial upload set (Q7): a table NOT yet initial-uploaded
      // sends with since = 0 (full) exactly once; after SYNC_FINALIZE marks it
      // done, subsequent syncs are incremental. LWW apply makes any re-send
      // harmless — the set exists purely to avoid full re-uploads every sync.
      const source = await ConnectionStateManager.getCurrentSource();
      const initialUploadDone =
        await ConnectionStateManager.getInitialUploadDoneTables(source);

      // Send each table's records sequentially
      for (const table of tables) {
        const tableSince = resolveTableSyncSince(table, lastSync, initialUploadDone);
        const records = await SyncHelpers.getChangedRecords(table, tableSince);
        log.info(`Found ${records.length} changes in ${table}`);

        // Filter out records that were received from the server this session
        // These have updated_at set to current time (when applied) but should not be sent back.
        // EXCEPTION: locally-deleted records must still be pushed so the server learns about
        // the deletion, even if the server sent the record back during the pull phase (LWW
        // would have kept the local version because its updated_at is newer).
        const pkField = getPkField(table);
        const filteredRecords = records.filter(record => {
          const recordKey = `${table}:${record[pkField]}`;
          if (this.serverRecordIds.has(recordKey)) {
            if (record.deleted_at) {
              log.debug(`Allowing locally-deleted server-received record through: ${recordKey}`);
              return true;
            }
            log.debug(`Excluding server-received record: ${recordKey}`);
            return false;
          }
          return true;
        });

        if (filteredRecords.length < records.length) {
          log.info(`Filtered to ${filteredRecords.length} local-only changes in ${table} (excluded ${records.length - filteredRecords.length} server records)`);
        }

        for (const record of filteredRecords) {
          // Failsafe: Normalize timestamps to ISO 8601 format for Harmony Link compatibility
          // This handles legacy data that may have space-separated timestamps from SQLite DEFAULT
          const normalizedRecord = SyncHelpers.normalizeRecordTimestamps(record, table);
          
          const operation = normalizedRecord.deleted_at ? 'delete' :
                           (SyncHelpers.toUnixTimestamp(normalizedRecord.created_at) > lastSync ? 'insert' : 'update');

          // Send record and wait for confirmation
          await this.sendSyncDataWithConfirmation(table, operation, normalizedRecord);
        }
      }

      // All local changes sent and confirmed
      log.info('Local changes sent, sending SYNC_COMPLETE');

      const event = {
        event_id: this.generateEventId(),
        event_type: 'SYNC_COMPLETE',
        status: 'NEW',
        payload: {
          sync_session_id: this.currentSession.sessionId
        }
      };

      await this.connectionManager.sendEvent('sync', event);

    } catch (error) {
      log.error('Error sending local changes:', error);
      this.emit('sync:error', error instanceof Error ? error.message : String(error));
    }
  }

  private async sendSyncDataWithConfirmation(
    table: string,
    operation: 'insert' | 'update' | 'delete',
    record: any
  ): Promise<void> {
    if (!this.currentSession) {
      throw new Error('No active sync session');
    }

    const eventId = `data_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    return new Promise((resolve, reject) => {
      // Store confirmation callback
      this.pendingSyncConfirmation = { eventId, resolve, reject };

      // Send the data
      const event = {
        event_id: eventId,
        event_type: 'SYNC_DATA',
        status: 'NEW',
        payload: {
          sync_session_id: this.currentSession!.sessionId,
          event_id: eventId,
          table,
          operation,
          record,
        },
      };

      // Measure payload size for diagnostics (like server-side logging)
      const payloadJSON = JSON.stringify(event.payload);
      const byteSize = new Blob([payloadJSON]).size;
      const mbSize = byteSize / (1024 * 1024);
      log.debug(`📊 SYNC_DATA payload size: ${table} ${operation} - ${mbSize.toFixed(2)} MB (${byteSize} bytes)`);

      // Resolve the PK via the centralized registry (4-1) — tables with a
      // non-`id` PK (entity_module_mappings, emotion_state, lifecycle_state,
      // chat_conversation_settings) key correctly.
      const pkField = getPkField(table);
      log.info(`Sending sync data for ${table}:${record[pkField] || 'undefined'}, eventId: ${eventId}`);
      this.connectionManager.sendEvent('sync', event).catch(reject);

      // Set timeout (configurable via setSyncTimeoutMs, default 30s)
      setTimeout(() => {
        if (this.pendingSyncConfirmation?.eventId === eventId) {
          this.pendingSyncConfirmation = null;
          reject(new Error(`Timeout waiting for confirmation of ${eventId}`));
        }
      }, this._syncTimeoutMs);
    });
  }

  private async handleIncomingSyncData(payload: any): Promise<void> {
    try {
      // Resolve the PK via the centralized registry (4-1) for accurate logging
      // and server-record exclusion keys.
      const pkField = getPkField(payload.table);
      const pkValue = payload.record?.[pkField] || 'undefined';
      log.info(`Buffering sync data for ${payload.table}:${pkValue}`);

      if (!this.currentSession) {
        log.error('No active sync session');
        return;
      }

      // Buffer the incoming data for atomic application later
      this.incomingDataBuffer.push({
        table: payload.table,
        operation: payload.operation,
        record: payload.record
      });

      // Track server record IDs to exclude from local changes later
      const recordPkField = getPkField(payload.table);
      if (payload.record?.[recordPkField]) {
        this.serverRecordIds.add(`${payload.table}:${payload.record[recordPkField]}`);
      }

      this.currentSession.recordsReceived++;
      this.emit('sync:progress', this.currentSession);

      // Send confirmation
      const confirmPayload = {
        sync_session_id: payload.sync_session_id,
        event_id: payload.event_id,
        status: 'SUCCESS'
      };

      // DIAGNOSTIC: Validate payload before sending
      if (!confirmPayload.sync_session_id || !confirmPayload.event_id) {
        log.error('⚠️ DIAGNOSTIC: Attempting to send SYNC_DATA_CONFIRM with empty fields!');
        log.error(`  sync_session_id: ${confirmPayload.sync_session_id || 'EMPTY'}`);
        log.error(`  event_id: ${confirmPayload.event_id || 'EMPTY'}`);
        log.error(`  Original payload received:`, JSON.stringify(payload, null, 2));
      }

      const confirmEvent = {
        event_id: this.generateEventId(),
        event_type: 'SYNC_DATA_CONFIRM',
        status: 'NEW',
        payload: confirmPayload
      };

      log.debug(`Sending SYNC_DATA_CONFIRM for event ${confirmPayload.event_id} in session ${confirmPayload.sync_session_id}`);

      await this.connectionManager.sendEvent('sync', confirmEvent);
      
    } catch (error: any) {
      log.error('Error buffering sync record:', error);

      const errorEvent = {
        event_id: this.generateEventId(),
        event_type: 'SYNC_DATA_CONFIRM',
        status: 'NEW',
        payload: {
          sync_session_id: payload.sync_session_id,
          event_id: payload.event_id,
          status: 'ERROR',
          error_message: error.message || 'Unknown error'
        }
      };
      await this.connectionManager.sendEvent('sync', errorEvent);

      // Emit sync error to notify UI
      this.emit('sync:error', error.message || 'Unknown error');
    }
  }

  private handleSyncDataConfirm(payload: any): void {
    if (!payload) {
      log.error('SYNC_DATA_CONFIRM received with null payload');
      return;
    }

    log.debug(`Received confirmation for ${payload.event_id}: ${payload.status}`);

    // Check if we're waiting for this confirmation
    if (this.pendingSyncConfirmation?.eventId === payload.event_id) {
      if (payload.status === 'SUCCESS') {
        // Increment records sent counter and emit progress when confirmed
        if (this.currentSession) {
          this.currentSession.recordsSent++;
          this.emit('sync:progress', this.currentSession);
        }
        this.pendingSyncConfirmation?.resolve(true);
      } else {
        this.pendingSyncConfirmation?.reject(
          new Error(payload.error_message || 'Sync failed')
        );
      }
      this.pendingSyncConfirmation = null;
    }
  }

  private async handleSyncComplete(event: any): Promise<void> {
    if (!this.currentSession) {
      log.warn('Received SYNC_COMPLETE but no current session');
      return;
    }

    const status = event.status;
    log.info(`Received sync event: SYNC_COMPLETE status: ${status} phase: ${this.syncPhase}`);

    // Handle SYNC_COMPLETE from server (can be NEW or SUCCESS status)
    if (this.syncPhase === 'SERVER_SENDING') {
      // Server finished sending - apply buffered data atomically and move to next phase
      try {
        await this.applyBufferedSyncData();
        if (!this.currentSession) {
          // The session was aborted/rejected while applying (e.g. during a
          // pending name-clash decision) — abortSync already reset state, so
          // do NOT proceed to client transmission.
          log.warn('Session no longer active after applying server data — skipping client transmission');
          return;
        }
        log.info('Server data applied successfully');
      } catch (error) {
        log.error('Failed to apply server data:', error);
        this.incomingDataBuffer = []; // Clear buffer on error
        this.serverRecordIds.clear(); // Clear server record tracking

        // Reset the session state completely. Leaving currentSession with
        // status 'in_progress' (or syncPhase stuck at 'SERVER_SENDING') makes
        // the initiateSync guard reject every future sync with "Sync already
        // in progress (or awaiting acceptance), skipping" — the app is
        // permanently bricked until a process restart. Mirrors
        // handleSyncReject / abortSync cleanup.
        if (this.pendingNameClash) {
          const pending = this.pendingNameClash;
          this.pendingNameClash = null;
          pending.reject(new Error('Failed to apply server data'));
        }
        this.nameClashApplyToAllResolution = null;
        this.syncPhase = 'IDLE';
        if (this.currentSession) {
          this.currentSession.status = 'failed';
          this.currentSession = null;
        }
        this.keepCascadedProviderKeys.clear();

        this.emit('sync:error', 'Failed to apply server data');
        return;
      }

      log.info('Starting client data transmission');
      this.syncPhase = 'CLIENT_SENDING';

      // Use lastSync as cutoff - records changed since last sync
      // Server-received records are filtered out by checking serverRecordIds
      // Use 0 as lastSync for force full sync to re-send all local data
      const lastSync = this.currentSession?.forceFullSync ? 0 : await this.getLastSyncTimestamp();
      // NOTE: must be awaited so the phase machine advances deterministically.
      // Without the await, a connection drop during CLIENT_SENDING would leave
      // syncPhase stuck and the orphaned-session bug would persist even after
      // abortSync (sendLocalChangesSequentially has its own catch that emits
      // sync:error, so an awaited rejection is handled, not thrown upward).
      try {
        await this.sendLocalChangesSequentially(lastSync);
      } catch (error) {
        log.error('sendLocalChangesSequentially failed:', error);
      }
      
    } else if (this.syncPhase === 'CLIENT_SENDING' && status === 'SUCCESS' ) {
      // Server acknowledged our SYNC_COMPLETE
      log.info('Server acknowledged our data transmission complete');
      // Both sides complete - send SYNC_FINALIZE
      log.info('Both sides complete, sending SYNC_FINALIZE');
      this.syncPhase = 'FINALIZING';

      const finalizeEvent = {
        event_id: this.generateEventId(),
        event_type: 'SYNC_FINALIZE',
        status: 'NEW',
        payload: {
          sync_session_id: this.currentSession!.sessionId
        }
      };

      this.connectionManager.sendEvent('sync', finalizeEvent);
    }
  }

  private async handleSyncFinalize(): Promise<void> {
    if (!this.currentSession) {
      log.warn('Received SYNC_FINALIZE but no current session');
      return;
    }

    log.info('Finalizing sync session');

    await this.updateLastSyncTimestamp(this.currentSession.startTime);

    // Per-table initial upload set (Q7): on SYNC_FINALIZE the session is
    // complete, so every registered table is marked initial-uploaded. Future
    // syncs upload only rows changed since the watermark (incremental), not a
    // full re-upload. LWW apply makes any re-send harmless.
    try {
      const source = await ConnectionStateManager.getCurrentSource();
      await ConnectionStateManager.markTablesInitialUploadDone(source, SYNC_TABLES);
    } catch (error) {
      log.warn('Failed to mark initial upload set complete:', error);
      // Best-effort — a stale set only causes a harmless full re-upload.
    }

    await this.cleanupSoftDeletedRecords(this.currentSession.startTime);

    // Clean up orphaned memories
    // This is necessary because memory promotion hard-deletes source memories on Harmony Link,
    // which don't propagate through sync pipeline (no soft-delete to sync).
    try {
      const deletedCount = await SyncHelpers.cleanupOrphanedMemories();
      if (deletedCount > 0) {
        log.info(`Cleaned up ${deletedCount} orphaned memories after sync`);
      }
    } catch (error) {
      log.error('Failed to clean up orphaned memories:', error);
      // Don't fail sync - cleanup is best-effort
    }

    this.currentSession.status = 'completed';
    this.emit('sync:completed', this.currentSession);
    this.currentSession = null;

    // Clear server record tracking for next sync session
    this.serverRecordIds.clear();
    log.debug('Cleared server record tracking');
  }

  private async cleanupSoftDeletedRecords(
    olderThanTimestamp: number,
  ): Promise<void> {
    const tables = [
      'character_profiles',
      'character_image',
      'entities',
      'entity_module_mappings',
      'interactions',
      'conversation_messages',
      'memories',
      'entity_emoji_actions',
      'provider_config_openai',
      'provider_config_ollama',
      'provider_config_openaicompatible',
      'provider_config_openrouter',
      'provider_config_harmonyspeech',
      'provider_config_elevenlabs',
      'provider_config_kindroid',
      'provider_config_kajiwoto',
      'provider_config_characterai',
      'provider_config_localai',
      'provider_config_mistral',
      'provider_config_comfyui',
      'provider_config_xai',
      'provider_config_google',
      'provider_config_anthropic',
      'provider_config_soulbitscloud',
      'backend_configs',
      'cognition_configs',
      'movement_configs',
      'rag_configs',
      'stt_configs',
      'tts_configs',
      'vision_configs',
      'imagination_configs',
      'chat_conversation_settings', // 4-1: soft-delete cleanup
    ];

    const db = getDatabase();
    for (const table of tables) {
      try {
        await db.executeSql(
          `DELETE FROM ${table} WHERE deleted_at IS NOT NULL AND CAST(strftime('%s', deleted_at) AS INTEGER) < ?`,
          [olderThanTimestamp],
        );
      } catch (error) {
        log.warn(
          `Failed to cleanup soft-deleted records from ${table}:`,
          error,
        );
      }
    }
    log.info('Soft-deleted records cleanup completed');
  }

  private async getLastSyncTimestamp(): Promise<number> {
    const source = await ConnectionStateManager.getCurrentSource();
    return ConnectionStateManager.getLastSync(source);
  }

  private async updateLastSyncTimestamp(timestamp: number): Promise<void> {
    const source = await ConnectionStateManager.getCurrentSource();
    await ConnectionStateManager.setLastSync(source, timestamp);
    log.info(`Updated last sync timestamp: ${timestamp}`);
  }

  /**
   * Returns the list of foreign key field names for a given table
   */
  private getForeignKeyFields(table: string): string[] {
    const fkMap: Record<string, string[]> = {
      'entities': ['character_profile_id'],
      'entity_module_mappings': [
        'entity_id',
        'backend_config_id',
        'cognition_config_id',
        'imagination_config_id',
        'movement_config_id',
        'rag_config_id',
        'stt_config_id',
        'tts_config_id',
        'vision_config_id'
      ],
      'interactions': ['entity_id', 'memory_id'],
      'lifecycle_state': ['entity_id'],
      'backend_configs': ['provider_config_id'],
      'vision_configs': ['provider_config_id'],
      'imagination_configs': ['provider_config_id'],
      'cognition_configs': ['provider_config_id'],
      'movement_configs': ['provider_config_id'],
      'rag_configs': ['provider_config_id'],
      'stt_configs': ['transcription_provider_config_id', 'vad_provider_config_id'],
      'tts_configs': ['provider_config_id'],
    };

    return fkMap[table] || [];
  }

  // -------------------------------------------------------------------------
  // Name-clash resolution
  // -------------------------------------------------------------------------

  /**
   * Scan the buffered server data for records whose unique `name` would
   * collide with a DIFFERENT local row on INSERT (the exact failure mode that
   * previously rolled back the whole sync transaction).
   */
  private async detectNameClashes(db: Database): Promise<NameClashInfo[]> {
    const clashes: NameClashInfo[] = [];

    for (const item of this.incomingDataBuffer) {
      if (item.operation === 'delete') continue;
      if (!isNameUniqueTable(item.table)) continue;

      const incomingId = item.record?.id;
      const name = item.record?.name;
      if (!incomingId || !name) continue;

      const [result] = await db.executeSql(
        `SELECT * FROM ${item.table} WHERE name = ?`,
        [name],
      );

      // If a same-name row with the INCOMING id exists locally, this is a
      // normal LWW update (no INSERT → no unique violation). Otherwise any
      // other row with the same name is a candidate clash.
      let local: any = null;
      for (let i = 0; i < result.rows.length; i++) {
        const row = result.rows.item(i);
        if (row.id === incomingId) {
          local = null;
          break;
        }
        if (!local) local = row;
      }
      if (!local) continue;

      // Only a real clash when the incoming record would actually be INSERTed
      // (its id is not present locally) — that INSERT is what the UNIQUE(name)
      // constraint would reject.
      const [pkResult] = await db.executeSql(
        `SELECT id FROM ${item.table} WHERE id = ?`,
        [incomingId],
      );
      if (pkResult.rows.length > 0) continue;

      clashes.push({
        table: item.table,
        name,
        localId: local.id,
        incomingId,
        localRecord: local,
        incomingRecord: item.record,
      });
    }

    return clashes;
  }

  /**
   * Collect the user's resolution for every clash. If a prior "apply to all"
   * decision was made earlier in THIS sync session, it is applied to every
   * clash without prompting. Otherwise each clash is surfaced via
   * `sync:nameclash` (one at a time) and `resolveNameClash` advances the
   * queue. Resolves once all clashes have a decision.
   */
  private collectNameClashDecisions(
    clashes: NameClashInfo[],
  ): Promise<Map<string, NameClashResolution>> {
    const decisions = new Map<string, NameClashResolution>();

    if (this.nameClashApplyToAllResolution) {
      for (const clash of clashes) {
        decisions.set(
          nameClashKey(clash.table, clash.incomingId),
          this.nameClashApplyToAllResolution,
        );
      }
      return Promise.resolve(decisions);
    }

    return new Promise((resolve, reject) => {
      this.pendingNameClash = {
        clashes,
        index: 0,
        decisions,
        resolve: () => {
          this.pendingNameClash = null;
          resolve(decisions);
        },
        reject,
      };
      this.emit('sync:nameclash', clashes[0]);
    });
  }

  /**
   * User (or UI) decision for the currently-pending name clash.
   *
   * @param resolution  'overwrite' | 'keep' | 'rename'
   * @param applyToAll  When true, the decision is memorized for every OTHER
   *                    clash in this sync session (and only this session).
   */
  async resolveNameClash(
    resolution: NameClashResolution,
    applyToAll: boolean = false,
  ): Promise<void> {
    const pending = this.pendingNameClash;
    if (!pending) {
      log.warn('resolveNameClash called but no pending name clash');
      return;
    }

    const clash = pending.clashes[pending.index];
    if (!clash) return;

    log.info(
      `Resolving name clash ${clash.table}:${clash.name} → ${resolution}${applyToAll ? ' (apply to all)' : ''}`,
    );
    pending.decisions.set(nameClashKey(clash.table, clash.incomingId), resolution);

    if (applyToAll) {
      this.nameClashApplyToAllResolution = resolution;
      for (let i = pending.index + 1; i < pending.clashes.length; i++) {
        const c = pending.clashes[i];
        pending.decisions.set(nameClashKey(c.table, c.incomingId), resolution);
      }
      pending.resolve();
      return;
    }

    pending.index++;
    if (pending.index >= pending.clashes.length) {
      pending.resolve();
    } else {
      this.emit('sync:nameclash', pending.clashes[pending.index]);
    }
  }

  /**
   * Translate resolved clashes into concrete per-record apply directives.
   * For `rename` this also picks a clash-free new name (avoiding collisions
   * with names already present in the local table).
   */
  private async buildApplyPlan(
    db: Database,
    clashes: NameClashInfo[],
    decisions: Map<string, NameClashResolution>,
  ): Promise<Map<string, NameClashApplyDirective>> {
    const plan = new Map<string, NameClashApplyDirective>();
    if (clashes.length === 0) return plan;

    // One unix timestamp shared by every rename in this apply pass so the
    // suffixes are consistent.
    const nowSeconds = Math.floor(Date.now() / 1000);

    for (const clash of clashes) {
      const key = nameClashKey(clash.table, clash.incomingId);
      const resolution = decisions.get(key);
      if (!resolution) continue;

      if (resolution === 'rename') {
        const taken = await this.collectExistingNames(db, clash.table);
        const newName = generateRenamedName(clash.name, {
          takenNames: taken,
          nowSeconds,
        });
        plan.set(key, {kind: 'rename', localId: clash.localId, newName});
      } else if (resolution === 'keep') {
        // Capture the local provider references BEFORE the apply transaction
        // adopts the server id — the cascade renames the local provider
        // configs to the server's provider config ids (see
        // cascadeKeepProviderConfig). Uses PROVIDER_CONFIG_REFERENCES because
        // stt_configs references TWO provider configs (transcription + VAD)
        // instead of one.
        const providerRefs: KeepProviderRefCapture[] = [];
        for (const ref of PROVIDER_CONFIG_REFERENCES[clash.table] ?? []) {
          providerRefs.push({
            configColumn: ref.configColumn,
            providerColumn: ref.providerColumn,
            localProvider: clash.localRecord?.[ref.providerColumn] ?? null,
            localProviderConfigId: clash.localRecord?.[ref.configColumn] ?? null,
          });
        }
        plan.set(key, {
          kind: 'keep',
          localId: clash.localId,
          providerRefs,
        });
      } else {
        plan.set(key, {kind: resolution, localId: clash.localId});
      }
    }

    return plan;
  }

  private async collectExistingNames(db: Database, table: string): Promise<string[]> {
    const [result] = await db.executeSql(`SELECT name FROM ${table}`);
    const names: string[] = [];
    for (let i = 0; i < result.rows.length; i++) {
      names.push(result.rows.item(i).name);
    }
    return names;
  }

  /**
   * Apply an overwrite/keep directive inside the apply transaction.
   *
   *  - overwrite: the local row adopts the incoming id AND all incoming values
   *  - keep:      the local row keeps its values, only the id is adopted
   *
   * Both then remap every local reference to the old id (via
   * CONFIG_ID_REFERENCES) so FK constraints still resolve to the adopted row.
   */
  private applyIdAdoption(
    tx: DatabaseTransaction,
    item: {table: string; record: any},
    directive: Extract<NameClashApplyDirective, {kind: 'overwrite' | 'keep'}>,
  ): void {
    const incomingId = item.record.id;

    const logFailure = (_: any, error: any) => {
      log.error(`  ❌ ${directive.kind.toUpperCase()} FAILED for ${item.table}:${directive.localId} → ${incomingId}`);
      log.error(`  Error: ${error.message} (code: ${(error as any).code || 'unknown'})`);
      return false; // Rollback
    };

    if (directive.kind === 'overwrite') {
      const columns = Object.keys(item.record).filter(k => k !== 'id');
      const updates = columns.map(c => `${c} = ?`).join(', ');
      const values = columns.map(c => item.record[c]);
      tx.executeSql(
        `UPDATE ${item.table} SET id = ?, ${updates} WHERE id = ?`,
        [incomingId, ...values, directive.localId],
        () => {
          log.debug(`  ✓ OVERWROTE local ${item.table}:${directive.localId} → ${incomingId} with server values`);
        },
        logFailure,
      );
    } else {
      // keep: adopt the server id but preserve local values. Re-point every
      // provider reference (provider_config_id, or the stt_configs
      // transcription/vad columns) at the incoming (server) provider config id
      // and bump updated_at so the row is picked up as a local change and the
      // server learns the kept (final) values.
      //
      // All statements here are issued SYNCHRONOUSLY (no callback nesting) —
      // the transaction executes each tx.executeSql in order, which matches
      // both the real RN SQLite and the test harness.
      const refs = directive.providerRefs ?? [];
      const setClauses = refs.map(r => `${r.configColumn} = ?`);
      const setValues = refs.map(r => item.record[r.configColumn]);
      tx.executeSql(
        `UPDATE ${item.table} SET id = ?, updated_at = ?, ${setClauses.join(', ')} WHERE id = ?`,
        [incomingId, new Date().toISOString(), ...setValues, directive.localId],
        () => {
          log.debug(`  ✓ KEPT local ${item.table}:${directive.localId} values, adopted id ${incomingId}`);
        },
        logFailure,
      );

      // Cascade: keep the COMPLETE setup (module config + its provider
      // configs). The incoming provider config rows were skipped from the
      // buffer (keptProviderServerIds), so renaming the local provider configs
      // to the server ids cannot collide.
      for (const ref of refs) {
        const localProviderConfigId = ref.localProviderConfigId;
        const incomingProviderConfigId = item.record[ref.configColumn];
        const localProviderTable = ref.localProvider
          ? `provider_config_${ref.localProvider}`
          : null;
        const incomingProviderTable = item.record[ref.providerColumn]
          ? `provider_config_${item.record[ref.providerColumn]}`
          : null;
        if (
          localProviderConfigId &&
          incomingProviderConfigId &&
          localProviderTable &&
          localProviderTable === incomingProviderTable
        ) {
          this.cascadeKeepProviderConfig(
            tx,
            incomingProviderTable,
            localProviderConfigId,
            incomingProviderConfigId,
          );
        } else if (
          ref.localProvider &&
          item.record[ref.providerColumn] &&
          ref.localProvider !== item.record[ref.providerColumn]
        ) {
          log.warn(
            `  ↳ Provider tables differ (${localProviderTable} vs ${incomingProviderTable}) — ` +
            `skipping provider config cascade for ${item.table}:${directive.localId}`,
          );
        }
      }
    }

    for (const ref of CONFIG_ID_REFERENCES[item.table] ?? []) {
      tx.executeSql(
        `UPDATE ${ref.table} SET ${ref.column} = ? WHERE ${ref.column} = ?`,
        [incomingId, directive.localId],
        () => {
          log.debug(`  ✓ Remapped ${ref.table}.${ref.column} ${directive.localId} → ${incomingId}`);
        },
        (_: any, error: any) => {
          log.error(`  ❌ REMAP FAILED for ${ref.table}.${ref.column} ${directive.localId} → ${incomingId}`);
          log.error(`  Error: ${error.message}`);
          return false; // Rollback
        },
      );
    }
  }

  /**
   * Keep-cascade: preserve the app's COMPLETE setup by renaming the local
   * provider config to the server's provider config id.
   *
   * The incoming server provider config row was SKIPPED during the apply
   * (keptProviderServerIds), so this rename cannot collide. The local row
   * keeps all its values and created_at; only the id changes (to the server
   * id) and updated_at is bumped (so it is detected as a local change and
   * re-sent back to the engine — which learns the app-local provider
   * settings). Nothing is orphaned: the row itself survives under the new id,
   * and every module config that referenced the old id is re-pointed.
   *
   * All statements are issued SYNCHRONOUSLY (the transaction executes each
   * tx.executeSql in order — no callback nesting, which would break on the
   * test harness where callbacks are deferred microtasks).
   */
  private cascadeKeepProviderConfig(
    tx: DatabaseTransaction,
    providerTable: string,
    localProviderId: string,
    serverProviderId: string,
  ): void {
    const logFailure = (_: any, error: any) => {
      log.error(
        `  ❌ Provider config cascade FAILED for ${providerTable}:${localProviderId} → ${serverProviderId}`,
      );
      log.error(`  Error: ${error.message} (code: ${(error as any).code || 'unknown'})`);
      return false; // Rollback
    };

    const key = `${providerTable}:${serverProviderId}`;
    if (!this.keepCascadedProviderKeys.has(key)) {
      // Track synchronously (used as the duplicate-cascade guard AND for the
      // post-commit serverRecordIds cleanup).
      this.keepCascadedProviderKeys.add(key);

      if (localProviderId !== serverProviderId) {
        tx.executeSql(
          `UPDATE ${providerTable} SET id = ?, updated_at = ? WHERE id = ?`,
          [serverProviderId, new Date().toISOString(), localProviderId],
          () => {
            log.debug(`  ↳ ✓ Renamed local provider config ${providerTable}:${localProviderId} → ${serverProviderId}`);
          },
          logFailure,
        );
      } else {
        // Same id locally + on the server — just bump updated_at so the kept
        // (local) provider values are re-sent.
        tx.executeSql(
          `UPDATE ${providerTable} SET updated_at = ? WHERE id = ?`,
          [new Date().toISOString(), serverProviderId],
          () => {
            log.debug(`  ↳ ✓ Bumped updated_at on kept provider config ${key}`);
          },
          logFailure,
        );
      }
    } else {
      log.debug(`  ↳ Provider config ${key} already adopted by another keep — skipping rename`);
    }

    // Re-point every module config that still references the local id at the
    // server id (the kept module config was already re-pointed; this covers
    // any OTHER rows — e.g. module configs not part of this sync). Iterates
    // PROVIDER_CONFIG_REFERENCES because stt_configs uses two provider
    // reference columns (transcription + VAD) instead of provider_config_id.
    for (const table of Object.keys(PROVIDER_CONFIG_REFERENCES)) {
      for (const ref of PROVIDER_CONFIG_REFERENCES[table]) {
        tx.executeSql(
          `UPDATE ${table} SET ${ref.configColumn} = ? WHERE ${ref.configColumn} = ?`,
          [serverProviderId, localProviderId],
          () => {
            log.debug(
              `  ↳ ✓ Remapped ${table}.${ref.configColumn} ${localProviderId} → ${serverProviderId}`,
            );
          },
          logFailure,
        );
      }
    }
  }
}

export default SyncService.getInstance();
