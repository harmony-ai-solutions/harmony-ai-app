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
import { setWipeRebuildFlag, hasRebuildCompletedInProcess } from './WipeRebuildFlag';
import { restartApp } from './AppRestart';
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
  /**
   * Emitted when the sticky `serverUpdateRequired` gate (3-3 / D57/D83) enters
   * (`true`) or clears (`false`). While true, the connection context suppresses
   * auto-reconnect scheduling and the on-connect sync trigger; the only
   * recovery is an accepted handshake advertising version ≥ SYNC_SCHEMA_VERSION.
   */
  'sync:server-update-required': (serverUpdateRequired: boolean) => void;
  /**
   * Emitted by the slow re-probe when it fires while the gate is sticky and the
   * sync WS is down (e.g. the engine restarted to apply the update). The
   * connection context dials the WS exactly ONCE (no reconnect loop) — the
   * on-connect handler then re-handshakes to re-evaluate the engine version.
   */
  'sync:server-update-probe-reconnect': () => void;
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
 * Typed sync-apply conflict (4-2 / D13, modeled on the `MarketplaceError`
 * precedent — `src/services/stub/StubServiceError.ts`).
 *
 * Raised when a SYNC_DATA_CONFIRM error payload carries the structured
 * `error_code` field (engine-side 1-3): `sync_conflict` for the
 * constraint-class (e.g. a UNIQUE PK collision on push) and `apply_failed`
 * for other apply-time failures. Old engines (no `error_code`) fall back to a
 * plain `Error` — `code` is then absent and callers show the generic retry
 * copy.
 */
export class SyncConflictError extends Error {
  /** The sync table whose push/apply failed (e.g. `entities`). */
  readonly table: string;
  /** The offending record's primary key value (e.g. the derived entity id). */
  readonly entityId: string;
  /** The engine's structured `error_code` (`sync_conflict` | `apply_failed`). */
  readonly code: string;

  constructor(table: string, entityId: string, code: string, message: string) {
    super(message);
    this.name = 'SyncConflictError';
    this.table = table;
    this.entityId = entityId;
    this.code = code;
  }
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
 * Finalize-GC table list (4-1 / D72/D73): the SAME 35-table member set as
 * `SYNC_TABLES`, but in the ENGINE's child-first FK-safe dependency order
 * (D71(a), engine 1-2 step 1) — entity children first, then `entities`, then
 * `character_profiles`, then `character_image`, then provider configs, then
 * module configs. Both sides delete in the same dependency order so a persona
 * family is physically purged in ONE finalize cycle.
 *
 * The 35-member parity with `SYNC_TABLES` is pinned by
 * `src/services/__tests__/syncGcTablesParity.test.ts`; cross-repo parity with
 * the engine's `registeredSyncTables` is locked by phase 6-1.
 */
export const GC_TABLES: string[] = [
  // Entity children first: every child of `entities` must be purged before its
  // parent row, otherwise the child FK blocks the `entities` DELETE (the
  // engine's original purge-abort bug, repaired by D71(a)).
  'entity_module_mappings',
  'interactions',
  'conversation_messages',
  'memories',
  'emotion_state',
  'lifecycle_state',
  'entity_emoji_actions',
  'chat_conversation_settings',
  // `entities` is purged BEFORE `character_profiles`: the profile→entity
  // FK (entities.character_profile_id → character_profiles.id, migration
  // 000002) is ON DELETE RESTRICT, so a soft-deleted persona/entity row
  // blocks its profile's DELETE. Purging entities first lets a persona
  // cascade (entity + profile + images) be physically removed in ONE cycle
  // (persona cards 3-4). character_image rides an ON DELETE CASCADE, so its
  // own purge row is order-independent.
  'entities',
  'character_profiles',
  'character_image',
  // Provider configs (no FK dependencies)
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
 * Sync-schema version (3-3 / D6): bumped by the id-pattern migration. Version
 * 1 is implicitly pre-plan (the field is absent). The engine advertises its
 * version in HANDSHAKE_ACCEPT and keys its own gate on the version the app
 * sends in HANDSHAKE_REQUEST / SYNC_REQUEST; the app compares the engine's
 * advertised version on HANDSHAKE_ACCEPT (and maps
 * `reason: "unsupported_schema_version"` SYNC_REJECTs) to the sticky
 * `serverUpdateRequired` gate.
 *
 * D11 reading (implementation note): the app ALWAYS sends its version (2) in
 * both payloads — it cannot know whether its own post-wipe rebuild completed
 * from inside the sync layer, and the engine-side gate covers the pre-rebuild
 * window by the absent-field rule. See the phase doc for the sequencing.
 */
export const SYNC_SCHEMA_VERSION = 2;

/**
 * Slow background re-probe interval (3-3 / D57): while the
 * `serverUpdateRequired` gate is sticky, the app re-handshakes every ~10
 * minutes so it auto-recovers (and re-pulls) once the engine is updated.
 * Named constant per the phase doc.
 */
export const SERVER_UPDATE_REPROBE_INTERVAL_MS = 10 * 60 * 1000;

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

  // 4-2 / D34: whether ANY attached syncAndWait caller requested `critical`
  // mode. When true, the SHARED wait rejects on sync failure instead of
  // resolving best-effort — so a critical caller attaching to a
  // background-initiated best-effort sync still receives the rejection (the
  // incident's exact timing: on-connect background sync + user taps a chat).
  private currentSyncWaitCritical = false;

  // 4-2: the last sync failure as an Error object (kept so the typed
  // SyncConflictError survives the `sync:error` event's string payload and
  // reaches the wait's rejection). Set where a failure is produced, consumed
  // by runSyncAndWait's error handler, and reset when a new wait starts.
  private lastSyncError: Error | null = null;

  private syncPhase: 'IDLE' | 'SERVER_SENDING' | 'CLIENT_SENDING' | 'FINALIZING' = 'IDLE';
  private pendingSyncConfirmation: {
    eventId: string;
    // 4-2: the record being pushed — carried so a confirm error can build the
    // typed SyncConflictError with the offending table + entity id (the engine
    // confirm error payload only echoes event_id/status).
    table: string;
    entityId: string;
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

  // ── 3-3 / D57/D83: sticky "server update required" gate ─────────────────
  // Set when the engine advertises a sync-schema version below
  // SYNC_SCHEMA_VERSION (handleHandshakeAccept) or rejects with
  // reason 'unsupported_schema_version' (handleSyncReject). While set:
  //   - initiateSync() short-circuits at its TOP — one choke point covering
  //     EVERY sync trigger (on-connect, token refresh, session start, screen
  //     and manual pulls, syncAndWait).
  //   - the connection context suppresses auto-reconnect scheduling (D57: a
  //     WS-teardown implementation would loop connect → handshake → abort →
  //     reconnect forever; the gate is sticky instead).
  //   - a slow background re-probe (~10 min) re-handshakes, so the app
  //     auto-recovers once the engine is updated (D11).
  // The ONLY way out is an accepted handshake advertising version ≥
  // SYNC_SCHEMA_VERSION, which clears the gate and re-kicks a sync
  // ("data re-pulls once the engine is updated").
  private serverUpdateRequired = false;
  private serverUpdateProbeTimer: ReturnType<typeof setTimeout> | null = null;

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

  // ── 3-3 / D57/D83: sticky-gate API ─────────────────────────────────────

  /** Whether the engine currently cannot safely sync (schema version too old). */
  getServerUpdateRequired(): boolean {
    return this.serverUpdateRequired;
  }

  /**
   * Enter the sticky gate. Idempotent — the probe timer is (re)armed once, on
   * the false→true transition. Emits 'sync:server-update-required' so the
   * connection context can suppress reconnect scheduling + the on-connect sync.
   */
  private enterServerUpdateRequired(): void {
    if (this.serverUpdateRequired) {
      return;
    }
    log.warn(
      'Entering serverUpdateRequired: engine sync-schema version is below the app\'s — syncing is suppressed until the engine is updated',
    );
    this.serverUpdateRequired = true;
    this.emit('sync:server-update-required', true);
    this.scheduleServerUpdateProbe();
  }

  /**
   * Clear the sticky gate (an accepted handshake advertised version ≥
   * SYNC_SCHEMA_VERSION). Cancels the re-probe timer and emits the change so
   * the connection context restores normal reconnect/sync behaviour.
   */
  private clearServerUpdateRequired(): void {
    if (!this.serverUpdateRequired) {
      return;
    }
    log.info('Clearing serverUpdateRequired: engine sync-schema version is now accepted');
    this.serverUpdateRequired = false;
    if (this.serverUpdateProbeTimer !== null) {
      clearTimeout(this.serverUpdateProbeTimer);
      this.serverUpdateProbeTimer = null;
    }
    this.emit('sync:server-update-required', false);
  }

  /**
   * Arm (or re-arm) the slow background re-probe. Fires ~10 min after the gate
   * was entered; if the gate is still sticky it re-handshakes (connection up)
   * or asks the connection context for a ONE-shot re-dial (connection down).
   */
  private scheduleServerUpdateProbe(): void {
    if (this.serverUpdateProbeTimer !== null) {
      clearTimeout(this.serverUpdateProbeTimer);
    }
    this.serverUpdateProbeTimer = setTimeout(() => {
      this.serverUpdateProbeTimer = null;
      void this.runServerUpdateProbe();
    }, SERVER_UPDATE_REPROBE_INTERVAL_MS);
  }

  private async runServerUpdateProbe(): Promise<void> {
    if (!this.serverUpdateRequired) {
      return;
    }
    if (this.connectionManager.isConnected('sync')) {
      // WS is up: re-handshake over the live connection. The engine replies
      // with HANDSHAKE_ACCEPT carrying its (possibly updated) version, which
      // handleHandshakeAccept evaluates — clearing the gate if now ≥ 2.
      log.info('Server-update re-probe: connection available — re-handshaking');
      try {
        await this.requestHandshake();
      } catch (err) {
        log.warn('Server-update re-probe: handshake failed:', err);
      }
    } else {
      // WS is down (e.g. the engine restarted to apply the update). Ask the
      // connection context for ONE re-dial — no reconnect-loop — its
      // on-connect handler re-handshakes while the gate is sticky.
      log.info('Server-update re-probe: connection down — requesting one-shot re-dial');
      this.emit('sync:server-update-probe-reconnect');
    }
    // Still sticky after the attempt → keep probing on the same ~10 min
    // cadence until the engine is updated and the gate clears (true
    // auto-recovery, D11). A gate clear cancels the timer via
    // clearServerUpdateRequired.
    if (this.serverUpdateRequired) {
      this.scheduleServerUpdateProbe();
    }
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
        device_platform: Platform.OS,
        // 3-3 / D6: advertise the app's sync-schema version. Optional field —
        // a pre-plan engine ignores unknown fields (absent = version 1).
        sync_schema_version: SYNC_SCHEMA_VERSION
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

    // ── 3-3 / D6: version gate (operative v1→v2 path, app side). Absence of
    // the field = engine version 1 (pre-plan). An engine below the app's
    // version cannot safely sync (it would LWW-merge pre-migration id rows
    // with the app's post-wipe rows into duplicates) — enter the sticky
    // serverUpdateRequired gate instead of proceeding. A version ≥ the app's
    // clears the gate (and, on the true→false transition, re-kicks a sync so
    // data re-pulls once the engine is updated — D11).
    const engineVersion =
      typeof payload?.sync_schema_version === 'number' ? payload.sync_schema_version : 1;
    if (engineVersion < SYNC_SCHEMA_VERSION) {
      log.warn(
        `Engine sync-schema version ${engineVersion} < app ${SYNC_SCHEMA_VERSION} — entering serverUpdateRequired`,
      );
      this.enterServerUpdateRequired();
    } else if (this.serverUpdateRequired) {
      log.info(
        `Engine sync-schema version ${engineVersion} ≥ ${SYNC_SCHEMA_VERSION} — clearing serverUpdateRequired`,
      );
      this.clearServerUpdateRequired();
      this.initiateSync().catch((err: any) => {
        log.warn('Post-recovery sync after engine update failed:', err);
      });
    }
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
    // ── 3-3 / D57 (review-7 generalization): ONE choke point at the TOP.
    // While `serverUpdateRequired` is sticky, NO sync may start — covering
    // every trigger class (on-connect, token refresh, session start, screen
    // and manual pulls, syncAndWait) without per-trigger wiring. The gate
    // clears only on an accepted handshake advertising version ≥
    // SYNC_SCHEMA_VERSION, which then re-kicks a sync for the data re-pull.
    if (this.serverUpdateRequired) {
      log.warn('Sync suppressed: server update required (engine sync-schema version too old)');
      return;
    }

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
    //
    // NOTE (phase 3-2 / D11 wipe): this cleared-watermark → force_full_sync
    // escalation is the guarantee behind the one-time wipe + rebuild — the
    // boot wipe clears the persisted watermark (wipeDatabaseCompletely →
    // clearAllLastSyncTimestamps), so the FIRST post-wipe initiateSync lands
    // here with storedLastSync === 0 and requests a full pull. The
    // `@harmony_sync_initial_upload_done:{source}` flag is NOT cleared by
    // either wipe helper; that inconsistency is harmless — the flag never
    // gates pulls (it only shapes upload `since`-values, which forceFullSync
    // zeroes anyway), and an empty DB uploads zero SYNC_DATA events regardless.
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
        force_full_sync: effectiveForceFullSync,
        // 3-3 / D6: advertise the app's sync-schema version. Optional field —
        // a pre-plan engine ignores unknown fields (absent = version 1). The
        // engine's own gate keys on this for the handshake-less cloud path
        // (review-5).
        sync_schema_version: SYNC_SCHEMA_VERSION
      }
    };

    try {
      log.info('Initiating sync:', event);
      await this.connectionManager.sendEvent('sync', event);
    } catch (sendError) {
      log.error('Failed to send SYNC_REQUEST:', sendError);

      // Clear session since sync failed to initiate
      this.currentSession = null;

      // 4-2: preserve the real error so a `critical` syncAndWait waiter rejects
      // with it (the sync:error emit below carries only a string payload).
      this.lastSyncError = sendError instanceof Error ? sendError : new Error(String(sendError));

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
   *   - Best-effort (default): resolves (with a warning) on 'sync:error' /
   *     'sync:rejected' / 'sync:aborted' or after `timeoutMs`, so background
   *     callers are never blocked forever (e.g. a pending size-estimate
   *     confirmation the user hasn't acted on).
   *   - `critical: true` (4-2 / D34): REJECTS instead of resolving on
   *     'sync:error' / 'sync:rejected' / 'sync:aborted' and when the internal
   *     `initiateSync` throws — pre-chat pushes must not proceed into a doomed
   *     session. Timeout still resolves best-effort (a hung sync may still
   *     complete later; D55's predicate re-check covers the chat-open path).
   *   - The shared wait is gated: when ANY attached caller is critical, the
   *     whole wait rejects on failure — a critical caller attaching to a
   *     background-initiated best-effort sync still receives the rejection.
   *   - Concurrent callers share a single wait.
   */
  async syncAndWait(options?: { timeoutMs?: number; critical?: boolean }): Promise<void> {
    const critical = options?.critical ?? false;

    // If a sync is already running (started via initiateSync or another waiter),
    // attach to the shared wait promise. A critical attach upgrades the shared
    // wait to reject-on-error (D34) — this composition (on-connect background
    // sync + user taps a chat) is the incident's exact timing.
    if (this.currentSyncWait) {
      if (critical) {
        this.currentSyncWaitCritical = true;
      }
      return this.currentSyncWait;
    }

    const timeoutMs = options?.timeoutMs ?? 45_000;
    this.currentSyncWaitCritical = critical;
    this.currentSyncWait = this.runSyncAndWait(timeoutMs);
    try {
      await this.currentSyncWait;
    } finally {
      this.currentSyncWait = null;
      this.currentSyncWaitCritical = false;
    }
  }

  private runSyncAndWait(timeoutMs: number): Promise<void> {
    // 4-2: reset the per-wait typed-error slot so a stale error from a previous
    // round never leaks into this wait's rejection.
    this.lastSyncError = null;

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;

      const cleanup = () => {
        this.off('sync:completed', onDone);
        this.off('sync:error', onError);
        this.off('sync:rejected', onRejected);
        this.off('sync:aborted', onAborted);
      };

      const settle = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        if (error && this.currentSyncWaitCritical) {
          reject(error);
        } else if (error) {
          log.warn('syncAndWait: sync failed (best-effort, non-critical):', error.message);
          resolve();
        } else {
          resolve();
        }
      };

      const onDone = () => settle();
      // 4-2: prefer the typed error (SyncConflictError) captured by the
      // failure producer; fall back to the string payload when no typed error
      // was recorded (old-engine / apply-failure paths).
      const onError = (message: string) => settle(this.lastSyncError ?? new Error(message));
      const onRejected = () => settle(new Error('Sync rejected'));
      const onAborted = () => settle(new Error('Sync aborted'));

      timer = setTimeout(() => {
        log.warn(`syncAndWait timed out after ${timeoutMs}ms — proceeding (best-effort)`);
        settle();
      }, timeoutMs);

      this.on('sync:completed', onDone);
      this.on('sync:error', onError);
      this.on('sync:rejected', onRejected);
      this.on('sync:aborted', onAborted);

      // Kick off a sync if one isn't already running. initiateSync self-guards
      // (no-op when one is in progress or the connection is unavailable), so we
      // safely attach to an in-flight sync when present.
      // 4-2 / D34: a rejecting initiateSync throw must surface in critical mode
      // (previously swallowed as best-effort).
      this.initiateSync().catch(err => {
        log.warn('syncAndWait: initiateSync failed:', err);
        settle(err instanceof Error ? err : new Error(String(err)));
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

    // ── 4-5 / D76/D82: `rebuild_required` is the stale-watermark rebuild
    // signal — the engine's purge floor (max_purged_deleted_at) passed this
    // device's sync watermark. The reaction (abort in-flight sync → persist
    // the one-time wipe flag → RESTART the process) is async (flag
    // persistence), so it runs fire-and-forget and RETURNS before the generic
    // rejection path — no 'sync:rejected' toast (the "Rebuilding from
    // Soulbits Engine…" label is the only UX; the process is dying anyway).
    const isRebuildRequired = payload?.reason === 'rebuild_required';
    if (isRebuildRequired) {
      void this.handleRebuildRequired(payload);
      return;
    }

    // ── 3-3 / D83: reject-reason mapping. `unsupported_schema_version` (a
    // future engine rejecting this app build, or the belt-and-braces v1→v2
    // path) enters the SAME sticky serverUpdateRequired gate instead of the
    // generic rejection notification — no error-toast spam (D57), and the
    // slow re-probe keeps trying until the versions align.
    const isVersionGate = payload?.reason === 'unsupported_schema_version';
    if (isVersionGate) {
      this.enterServerUpdateRequired();
    }

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

    if (isVersionGate) {
      // Sticky-gate path: do NOT emit 'sync:rejected' — the UI surfaces the
      // serverUpdateRequired status instead of a generic rejection toast.
      return;
    }
    this.emit('sync:rejected', payload);
  }

  /**
   * ── 4-5 / D76/D82: stale-watermark rebuild reaction.
   *
   * The engine answered SYNC_REQUEST with `reason: "rebuild_required"` because
   * this ESTABLISHED device's sync watermark is below the engine's purge floor
   * (`max_purged_deleted_at`) — the engine holds stale live rows it can no
   * longer correct (the tombstones were GC'd; a later edit would re-push them
   * as fresh inserts — silent resurrect via 1-1's plain-insert path). The app
   * reacts by REUSING the D61 one-time boot wipe (3-2's persisted flag,
   * set-only — no new wipe code) + full re-pull:
   *
   *   1. abort the in-flight sync attempt — send NOTHING further (the engine
   *      does NOT tear down the WS on this signal — 1-2 pin; the process
   *      restart below closes it by construction),
   *   2. persist the one-time wipe flag (setWipeRebuildFlag) — CRASH-SAFETY
   *      (D82): the flag MUST be on disk before the restart is invoked, so a
   *      failed restart still wipes on the next natural launch,
   *   3. restart the app process (react-native-restart) — the D61 boot-window
   *      wipe then runs naturally (flag check inside
   *      `DatabaseContext.initializeDb` → wipe + D19 prefs sweep → clear flag
   *      → init DB → on-connect `initiateSync` full pull; the "Rebuilding from
   *      Soulbits Engine…" label rides the loading screen for the duration).
   *
   * The restart tears down everything a mid-session re-init would have to
   * manage (open WS, DB handles, in-memory sync state, mounted querying
   * screens) — the exact race class D61 was ruled to kill (D82, review 7).
   * No reconnect-suppression machinery is needed: the process dies before any
   * reconnect could fire.
   *
   * Accepted loss (same class as D11): local-only rows created since the
   * device's last successful sync. A flagged device is by definition behind
   * the engine; the loss window is its offline delta only. Logged for
   * diagnostics; the rebuild label is the only UX.
   *
   * One-shot / loop guard (D82): after the wipe, the first full pull advances
   * the watermark past the floor, so the engine does not re-flag. If the
   * signal arrives AGAIN after a rebuild completed in THIS process lifetime
   * (the boot wipe already ran and cleared the flag), something is genuinely
   * wrong (the rebuild failed to advance the watermark) — log + surface a
   * diagnostic error instead of restarting again (never a restart loop). The
   * D76 invariant makes this unreachable; the guard is defensive.
   */
  private async handleRebuildRequired(payload: any): Promise<void> {
    log.warn(
      'Sync rejected: rebuild_required — device watermark below the engine purge floor; one-time wipe + full re-pull required (4-5 / D76/D82)',
      payload,
    );

    // ── Precedence vs. 3-3 (D82, verified explicitly): the version gate wins.
    // While `serverUpdateRequired` is sticky, initiateSync() short-circuits at
    // its top — no SYNC_REQUEST goes out, so the engine cannot answer with
    // rebuild_required in response. Belt-and-braces for an out-of-band signal
    // (a reject racing the gate entry): ignore it — a wipe cannot help a
    // version-mismatched engine, and the rebuild must wait for the accepted
    // handshake (D11: "data re-pulls once the engine is updated").
    if (this.serverUpdateRequired) {
      log.warn(
        'rebuild_required received while serverUpdateRequired is sticky — ignoring (version gate wins; the rebuild fires after the engine is updated and the handshake is accepted)',
      );
      return;
    }

    // 1. Abort the in-flight sync attempt: reset the session state machine so
    //    the `initiateSync` guard is released. NOTHING further is sent — the
    //    WS stays up (the engine keeps it; 1-2 pin) and dies with the process
    //    restart below. No client-side WS teardown here.
    if (this.currentSession) {
      this.currentSession.status = 'failed';
      this.currentSession = null;
    }
    this.syncPhase = 'IDLE';
    this.incomingDataBuffer = [];
    this.serverRecordIds.clear();
    if (this.pendingNameClash) {
      const pending = this.pendingNameClash;
      this.pendingNameClash = null;
      pending.reject(new Error('Sync aborted: rebuild required'));
    }
    this.nameClashApplyToAllResolution = null;

    // ── Loop guard (D82): a rebuild already completed in THIS process
    // lifetime (the boot window wiped + cleared the flag) → a re-signal means
    // the rebuild failed to advance the watermark. NEVER restart again — log +
    // surface a diagnostic error instead. Unreachable under the D76 invariant.
    if (hasRebuildCompletedInProcess()) {
      const message =
        'rebuild_required received after a completed rebuild — the rebuild did not advance the watermark; not restarting (loop guard)';
      log.error(message, payload);
      this.emit('sync:error', message);
      return;
    }

    // 2. Persist the wipe flag BEFORE the restart (crash-safety, D82). If the
    //    persist itself fails, do NOT restart — a restart without the flag
    //    cannot wipe; the next sync round re-attempts the persist (and the
    //    engine will re-flag, since the watermark is still below the floor).
    try {
      await setWipeRebuildFlag();
    } catch (err) {
      log.error(
        'Failed to persist the wipe-rebuild flag — not restarting (a restart without the persisted flag cannot wipe; the next sync round will retry):',
        err,
      );
      return;
    }

    // 3. Restart the app process. The flag is already persisted, so a failure
    //    here (e.g. native module unavailable) still wipes on the next natural
    //    launch.
    log.warn('Wipe-rebuild flag persisted — restarting the app to run the boot-window wipe (D82)');
    try {
      restartApp();
    } catch (err) {
      log.error(
        'App restart failed — the wipe-rebuild flag is persisted; the wipe will run on the next natural launch:',
        err,
      );
    }
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
      // 4-2: preserve the typed error (SyncConflictError) so a `critical`
      // syncAndWait waiter rejects with it — the sync:error event itself only
      // carries the string message.
      this.lastSyncError = error instanceof Error ? error : new Error(String(error));
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
      // Resolve the PK via the centralized registry (4-1) — tables with a
      // non-`id` PK (entity_module_mappings, emotion_state, lifecycle_state,
      // chat_conversation_settings) key correctly.
      const pkField = getPkField(table);
      const pkValue = record[pkField];
      // 4-2: carry table + entity id so a confirm error can build the typed
      // SyncConflictError (the engine's error payload only echoes event_id).
      this.pendingSyncConfirmation = {
        eventId,
        table,
        entityId: pkValue != null ? String(pkValue) : 'unknown',
        resolve,
        reject,
      };

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
    if (this.pendingSyncConfirmation && this.pendingSyncConfirmation.eventId === payload.event_id) {
      const pending = this.pendingSyncConfirmation;
      if (payload.status === 'SUCCESS') {
        // Increment records sent counter and emit progress when confirmed
        if (this.currentSession) {
          this.currentSession.recordsSent++;
          this.emit('sync:progress', this.currentSession);
        }
        pending.resolve(true);
      } else {
        // 4-2: classify the confirm error via the structured `error_code`
        // (engine-side 1-3): present → SyncConflictError with the offending
        // table + entity id; absent (old engines) → plain Error.
        pending.reject(this.classifyConfirmError(payload, pending));
      }
      this.pendingSyncConfirmation = null;
    }
  }

  private classifyConfirmError(
    payload: any,
    pending: { table: string; entityId: string },
  ): Error {
    const code = payload?.error_code;
    const message = payload?.error_message || 'Sync failed';
    if (code) {
      return new SyncConflictError(pending.table, pending.entityId, code, message);
    }
    return new Error(message);
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
    // 4-1 (D72/D73): the full 35-table allowlist in engine child-first order —
    // see the GC_TABLES const for the order rationale + parity pin.
    const tables = GC_TABLES;

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

  /**
   * Last successful full-sync watermark for the current source (seconds since
   * epoch, 0 when never synced). 4-2 / D55: the chat-open critical-wait
   * predicate (`entity.updated_at > watermark`) uses this to decide whether a
   * locally-changed entity still needs pushing before INIT_ENTITY.
   */
  async getLastSyncTimestamp(): Promise<number> {
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
