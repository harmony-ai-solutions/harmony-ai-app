/**
 * EngineApiClient — the management-API HTTP client (task 3-2).
 *
 * A thin, typed transport over the embedded engine's local management REST API
 * (`http://127.0.0.1:<adminPort>`). It carries the loopback token parsed from
 * the sidecar readiness line as `X-Loopback-Token` (falling back to
 * `X-Admin-API-Key` for non-loopback binds — desktop parity).
 *
 * Scope (3-1b consolidated surface — the former `/api/mobile/*` group dissolved):
 *   - entity conversation reads: `/api/entities/:id/{chat-list,interactions,
 *     emotion,memories,emoji-actions}` and
 *     `/api/entities/:id/conversations/:participantKey/messages`
 *   - message writes + byte endpoints: `/api/messages/:id` (PATCH/DELETE) and
 *     `/api/messages/:id/{audio,image}`
 *   - entity conversation writes: clear / mark-read / chat-settings / emoji CRUD
 *   - the existing entity / character-profile / module-config / provider reads
 *   - the existing entity / character-profile CRUD writes
 *
 * The client returns **wire DTOs** (snake_case, exactly the engine's JSON);
 * mapping to the app's domain models is the mappers' job
 * (`engineApiMappers.ts`) so the wire→domain split stays explicit (a regression
 * lesson from the memory bank: Go silently drops unknown camelCase keys, so we
 * always speak snake_case on the wire).
 *
 * No local caching: the engine is local, so only in-memory request-level
 * memoization is allowed (and only where a screen provably re-reads the same
 * page in one tick — currently none).
 */

import { uint8ArrayToBase64 } from '../../database/base64';
import type { LanSyncPairingPayload, SyncPairingPayload } from '../sync/syncCloudTypes';
import { requireEngineConnection } from './EngineService';
import type { EngineConnection } from './EngineService';

// ── Errors ───────────────────────────────────────────────────────────────

/** An error from the management API (non-2xx) or a transport failure. */
export class EngineApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly body: unknown;

  constructor(message: string, status: number, path: string, body: unknown = null) {
    super(message);
    this.name = 'EngineApiError';
    this.status = status;
    this.path = path;
    this.body = body;
  }

  /** True when the resource was absent (404). */
  get isNotFound(): boolean {
    return this.status === 404;
  }
}

/** Thrown when the API-backed layer is asked to do something the engine has no
 * endpoint for yet (write paths without a management route — see the 3-2 doc's
 * "writes audit"). Distinct so callers can fall back deliberately. */
export class EngineApiUnsupportedError extends Error {
  constructor(operation: string) {
    super(`Management API has no endpoint for "${operation}" yet (see 3-2 write audit)`);
    this.name = 'EngineApiUnsupportedError';
  }
}

// ── Wire DTOs (snake_case, exactly the engine JSON) ──────────────────────
// Times are RFC3339 strings; nullable Go pointers are `T | null`; `omitempty`
// fields are optional.

export interface ConversationMessageDto {
  id: string;
  entity_id: string;
  sender_entity_id: string;
  interaction_id?: string | null;
  content: string;
  audio_duration?: number | null;
  message_type: string;
  audio_data?: string | null;
  audio_mime_type?: string | null;
  image_data?: string | null;
  image_mime_type?: string | null;
  vl_model?: string | null;
  vl_model_interpretation?: string | null;
  emotional_state_bits: number;
  is_recon_followup: boolean;
  is_edited: boolean;
  edit_of_message_id?: string | null;
  reply_to_message_id?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  reactions_json?: string | null;
  is_pinned?: boolean | null;
  is_read?: boolean | null;
}

export interface InteractionDto {
  id: string;
  entity_id: string;
  interaction_scope: string;
  participant_key: string | null;
  participant_ids: string;
  presence_type: string;
  status: string;
  started_at: string;
  last_activity_at: string;
  ended_at: string | null;
  memory_id?: string | null;
  continued_interaction_id?: string | null;
  metadata: string | null;
  summary?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface EmojiActionDto {
  id: string;
  entity_id: string;
  emoji_native: string;
  emotion_effect?: string | null;
  metabolism_vector?: string | null;
  substitution_text?: string | null;
  auto_generated: boolean;
  is_default: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmotionStateDto {
  entity_id: string;
  last_update: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  joy_intensity: number;
  sadness_intensity: number;
  trust_intensity: number;
  disgust_intensity: number;
  fear_intensity: number;
  anger_intensity: number;
  surprise_intensity: number;
  anticipation_intensity: number;
  joy_baseline: number;
  sadness_baseline: number;
  trust_baseline: number;
  disgust_baseline: number;
  fear_baseline: number;
  anger_baseline: number;
  surprise_baseline: number;
  anticipation_baseline: number;
  joy_crystallize_start: string | null;
  sadness_crystallize_start: string | null;
  trust_crystallize_start: string | null;
  disgust_crystallize_start: string | null;
  fear_crystallize_start: string | null;
  anger_crystallize_start: string | null;
  surprise_crystallize_start: string | null;
  anticipation_crystallize_start: string | null;
  decay_tau: number;
  high_threshold: number;
  low_threshold: number;
  crystallize_intensity: number;
  crystallize_min_hours: number;
}

export interface MemoryDto {
  id: string;
  entity_id: string;
  compaction_level: number;
  content: string;
  emotional_state_bits: number;
  start_date?: string | null;
  end_date?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** One chat-list row (`GET /api/entities/:id/chat-list`). */
export interface ChatListRowDto {
  interaction_id: string;
  participant_key: string;
  interaction_scope: string;
  participant_ids: string;
  last_message: ConversationMessageDto | null;
  last_message_at: string | null;
  unread_count: number;
  pinned: boolean;
  archived: boolean;
  reply_mode: string;
}

export interface ChatListResponseDto {
  conversations: ChatListRowDto[];
  has_more: boolean;
  next_offset: number | null;
}

export interface MessagesResponseDto {
  messages: ConversationMessageDto[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface InteractionsResponseDto {
  interactions: InteractionDto[];
  has_more: boolean;
  next_offset: number | null;
}

export interface EmojiActionsResponseDto {
  emoji_actions: EmojiActionDto[];
}

export interface EmotionResponseDto {
  emotion_state: EmotionStateDto | null;
}

export interface MemoriesResponseDto {
  memories: MemoryDto[];
  has_more: boolean;
  next_offset: number | null;
}

/**
 * A character profile as returned by `/api/character-profiles` (config DTO).
 *
 * 3-1b additive read fields: `is_favorite` (0/1 JSON number) and the row
 * timestamps are now populated on management reads.
 */
export interface CharacterProfileDto {
  id: string;
  name: string;
  description: string;
  personality: string;
  scenario?: string;
  first_mes?: string;
  mes_example?: string;
  alternate_greetings?: string;
  post_history_instructions?: string;
  creator_notes?: string;
  creator?: string;
  character_version?: string;
  nickname?: string;
  tags?: string;
  group_only_greetings?: string;
  extensions?: string;
  assets?: string;
  card_provenance?: string;
  character_book?: string;
  voice_characteristics?: string;
  base_prompt?: string;
  typing_speed_wpm?: number;
  audio_response_chance_percent?: number;
  vision_config_id?: string;
  lifecycle_config?: string;
  /** Additive read field (3-1b): 0/1 JSON number. */
  is_favorite?: number;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

/**
 * An entity config as returned by `/api/entities` (map value) / `/:id`.
 *
 * 3-1b additive read fields: the top-level raw `character_profile_id`, the row
 * timestamps and `rag_reindex_required` are now populated on management reads.
 */
export interface EntityConfigDto {
  character_profile: CharacterProfileDto;
  modules: Record<string, unknown>;
  lifecycle_config: string;
  alias: string;
  entity_type: string;
  is_muted: boolean;
  is_disabled: boolean;
  /** Additive read field (3-1b): the raw FK, alongside the nested profile. */
  character_profile_id?: string;
  rag_reindex_required?: boolean;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface CharacterImageInfoDto {
  id: string;
  character_profile_id: string;
  mime_type: string;
  description: string;
  is_primary: boolean;
  display_order: number;
  created_at?: string;
  [key: string]: unknown;
}

/** Create/update body for `/api/entities/:id/emoji-actions` (snake_case). */
export interface EmojiActionWriteDto {
  id?: string;
  emoji_native: string;
  emotion_effect?: string | null;
  metabolism_vector?: string | null;
  substitution_text?: string | null;
  auto_generated?: boolean;
  is_default?: boolean;
}

/** PATCH body for `/api/messages/:id` (snake_case; at least one field). */
export interface MessagePatchDto {
  content?: string;
  is_pinned?: boolean;
  reactions_json?: string | null;
  is_edited?: boolean;
  edit_of_message_id?: string | null;
}

/** PUT body for `/api/entities/:id/chat-settings/:participantKey` (≥1 field). */
export interface ChatSettingsWriteDto {
  pinned?: boolean;
  archived?: boolean;
}

export interface ProviderListResponseDto {
  providers: Record<string, unknown[]>;
}

export interface ProviderGetResponseDto {
  provider: string;
  config: unknown;
}

/** Response of the provider CRUD routes (`{provider, config}`). */
export interface ProviderWriteResponseDto {
  provider: string;
  config: unknown;
}

/** One entity's aggregated social stats (`GET /api/stats/characters`). */
export interface CharacterStatDto {
  likes: number;
  chats: number;
}

export interface CharacterStatsResponseDto {
  stats: Record<string, CharacterStatDto>;
}

/** `POST /api/module-configs/:module` body (nested config, snake_case). */
export interface ModuleConfigWriteDto {
  name: string;
  config: unknown;
}

/** `GET /public/appversion` response (mirrors the engine's `constants.AppVersion`). */
export interface AppVersionDto {
  appVersion: string;
}

// ── Engine logs (plan 7-11) ──────────────────────────────────────────────
// The embedded engine's Dev-Tools log surface, now reachable with the loopback
// token (the handlers moved onto the app-facing /api group; paths unchanged).
// Wire shapes mirror the engine's `logging.LogEntry` / `logging.LogFilter` /
// `logging.LogLevelConfig` EXACTLY — note the log entry is camelCase
// (`entityId`/`isPrompt`/`promptType`), unlike the snake_case data-layer DTOs.

/** One ring-buffer log entry (`logging.LogEntry`). */
export interface EngineLogEntryDto {
  id: number;
  timestamp: string;
  level: string;
  component: string;
  entityId: string;
  subSystem?: string;
  message: string;
  /** Structured fields attached to the entry (`omitempty`). */
  data?: Record<string, unknown> | null;
  isPrompt: boolean;
  promptType?: string;
  promptSummary?: string;
}

/** Filter set for `GET /api/development/logs` (query params). */
export interface EngineLogQuery {
  component?: string;
  entityId?: string;
  minLevel?: string;
  search?: string;
  /** RFC3339 timestamp; only entries after this time. */
  since?: string;
  limit?: number;
  offset?: number;
  /** `true` = only prompts, `false` = exclude prompts, omitted = all. */
  isPrompt?: boolean;
  promptType?: string;
}

/** `GET /api/development/logs` response envelope. */
export interface EngineLogsResponseDto {
  entries: EngineLogEntryDto[];
  count: number;
  offset: number;
  limit: number;
}

/** `GET/PUT /api/development/logs/level` (`logging.LogLevelConfig`). */
export interface EngineLogLevelConfigDto {
  defaultLevel: string;
  componentLevels: Record<string, string>;
  promptVerbosity: string;
}

// ── Sync client (task 3-5) ───────────────────────────────────────────────
// The engine's changeset-v1 desktop↔phone sync role, driven live over
// `/api/sync/client*` (loopback-authed). Wire shapes are exactly the engine's
// snake_case JSON.

/** The observable client states (`state` in the status object). */
export type SyncClientState =
  | 'idle'
  | 'pairing'
  | 'connecting'
  | 'pending_approval'
  | 'rejected'
  | 'syncing'
  | 'promoted'
  | 'backoff'
  | 'stopped'
  | 'auth_needed'
  | 'quota_exceeded';

/** The sync transport (plan 7-2). `lan` = direct 2-4 dial; `relay` = cloud relay. */
export type SyncClientTransport = 'lan' | 'relay';

/** The sync-group membership state (plan 7-2). */
export type SyncGroupState = 'uninitialized' | 'member' | 'key_pending';

/** The observable relay-connection state (plan 7-2; `relay` in the status). */
export interface RelayStatusDto {
  connected: boolean;
  auth_needed: boolean;
  last_seq: number;
  last_seq_age_ms: number;
  acked_seq: number;
  buffered_frames: number;
  buffered_bytes: number;
  cap: number;
  overflow: boolean;
  rejected_frames: number;
  decrypt_failures: number;
  /**
   * Tier sync-buffer quota in MB from the relay welcome (plan 7-6).
   * `0` = unlimited.
   */
  sync_buffer_mb: number;
  /** Tier device cap for the sync group from the relay welcome (plan 7-6). `0` = unlimited. */
  sync_devices: number;
  /** Tier hosted-backup storage quota in MB from the relay welcome (plan 7-6). `0` = unlimited. */
  backup_storage_mb: number;
}

/** The persisted sync-client config block (status.config). */
export interface SyncClientConfigDto {
  enabled: boolean;
  transport: SyncClientTransport;
  peer_address: string;
  peer_wss_address: string;
  security_mode: string;
  relay_url: string;
  relay_token: string;
  device_id: string;
  dataset_id: string;
  group_join_pending: boolean;
  device_name: string;
  device_type: string;
  device_platform: string;
  /**
   * The persisted TOFU pin for the peer's WSS certificate (plan 7-15),
   * canonical `sha256:AB:CD:…`. Echoed on reads; enforced fail-closed on WSS
   * dials when set. The write-only `lan_pairing_secret` is never echoed.
   */
  peer_fingerprint?: string;
}

/** `GET /api/sync/client/status` response. */
export interface SyncClientStatusDto {
  enabled: boolean;
  state: SyncClientState;
  last_error: string | null;
  local_authoritative: boolean;
  baseline_path: string | null;
  dataset_id: string;
  pending_writes: number;
  /** The sync-group membership state (plan 7-2). */
  sync_group: SyncGroupState;
  /** The portal-triggered rotation-pending flag the app relays to the engine. */
  rotation_required: boolean;
  /**
   * Where cognition runs for this engine's dataset (plan 7-8): `'local'` when
   * this engine holds write authority, else the authority device id, else null.
   */
  cognition_authority: string | null;
  /** True when local narration is paused because the authority lease expired (plan 7-8). */
  narration_paused: boolean;
  /** Relay-connection observability; null in LAN mode. */
  relay: RelayStatusDto | null;
  config: SyncClientConfigDto;
}

/**
 * `PUT /api/sync/client` body — any subset (≥1 field). `pairing_token` is
 * TRANSIENT: applied in-memory for the next relay connect only, never persisted.
 */
export interface SyncClientConfigPatchDto {
  enabled?: boolean;
  transport?: SyncClientTransport;
  peer_address?: string;
  peer_wss_address?: string;
  security_mode?: string;
  relay_url?: string;
  relay_token?: string;
  device_id?: string;
  dataset_id?: string;
  group_join_pending?: boolean;
  device_name?: string;
  device_type?: string;
  device_platform?: string;
  /**
   * TOFU pin for the peer WSS certificate (`sha256:AB:CD:…`); when set, WSS
   * dials verify the fingerprint and fail closed on mismatch (plan 7-15).
   */
  peer_fingerprint?: string;
  /**
   * Single-use LAN pairing secret presented in the device-approval handshake
   * (plan 7-15). WRITE-ONLY + transient: never persisted and never echoed in
   * the status config.
   */
  lan_pairing_secret?: string;
  /** One-time relay pairing credential presented on the next connect (transient). */
  pairing_token?: string;
}

// ── Sync-group key lifecycle (plan 7-2, consumed by 7-3) ────────────────
// Loopback-authed `/api/sync/group/*`. `group_key_base64` is the RAW group key
// and is returned ONLY by the mutating routes (init/import/rotate) so the app
// can wrap + escrow it; key-status never returns it.

/** `GET /api/sync/group/key-status` + the mutating routes' response. */
export interface SyncGroupKeyStatusDto {
  state: SyncGroupState;
  has_key: boolean;
  /** Non-secret sha256 identifier of the current key. */
  fingerprint?: string;
  rotation_required: boolean;
  /** RAW group key (init/import/rotate responses only). */
  group_key_base64?: string;
  /** True after a rotate — prior frames are unreadable and the engines re-baseline. */
  baseline_required?: boolean;
  created?: boolean;
  imported?: boolean;
  rotated?: boolean;
}

// ── QR pairing mint + desktop cloud identity (plan 7-15, contract 1.5.0) ─
// Desktop-first surfaces on the same management API. The phone consumes the LAN
// pairing payload (parser v2) and the enrollment block; the cloud pairing payload
// keeps the portal shape. All admin-key authed like the rest of `/api/sync/*`.

/** `GET /api/cloud/account` (plan 7-15 E2). NEVER carries a token. */
export interface CloudAccountStatusDto {
  signed_in: boolean;
  /** Masked signed-in identifier (`u***@example.com`); empty when signed out. */
  account_hint: string;
  /** The full signed-in email; omitted when signed out. */
  email?: string;
  /** The stable desktop device id. */
  device_id?: string;
  device_authorized: boolean;
  device_authorization_pending: boolean;
}

/**
 * `POST /api/cloud/signin/start` → the portal connect URL the frontend opens
 * (plan 7-15 E2; E2b reworked desktop sign-in to a portal-connect + loopback flow,
 * so `url` is the Soulbits portal `/connect` page rather than a provider consent
 * URL).
 */
export interface CloudSignInStartDto {
  url: string;
}

// ── Backup & restore (plan 2-6) ──────────────────────────────────────────
// The engine stages/snapshots and moves bytes to the caller-supplied target;
// W1 account escrow is the app's own call (see services/backup).

/**
 * The backup conflict policy for `POST /api/backup/artifact` (owner ruling
 * 2026-10-17, generation guard). `hold` (the default) refuses to overwrite a
 * cloud manifest another device wrote and returns a `held` result instead;
 * `overwrite` is the explicit user "push mine" decision.
 */
export type BackupConflictPolicy = 'hold' | 'overwrite';

/** A target descriptor (engine BackupTarget selection + auth material). */
export interface BackupTargetDescriptor {
  type: string;
  destDir?: string;
  baseUrl?: string;
  username?: string;
  password?: string;
  accessToken?: string;
  inboxDir?: string;
  /** The hosted target's backup slot id (plan 7-5; `soulbits-cloud` only). */
  device?: string;
}

/** One content-addressed object reference in the manifest. */
export interface BackupObjectRefDto {
  key: string;
  plainSha256: string;
  objectSha256: string;
  plainSize: number;
  objectSize: number;
  kind: string;
  name?: string;
}

/** A DEK wrap entry (W1/W2 informational; W3/W4 carry wrapped bytes). */
export interface BackupWrapEntryDto {
  kind: string;
  nonce?: string;
  wrapped?: string;
  hint?: string;
}

/** The artifact manifest (the single commit point). */
export interface BackupManifestDto {
  formatVersion: number;
  engineSchemaVersion: number;
  createdAt: string;
  deviceLabel: string;
  targetAccount?: string;
  dataVersion: string;
  generation: number;
  baseline: BackupObjectRefDto;
  sideObjects: BackupObjectRefDto[] | null;
  aead: { algo: string; nonceSize: number };
  wraps: BackupWrapEntryDto[] | null;
}

/**
 * The engine's generation-guard "held" result (owner ruling 2026-10-17): the
 * cloud manifest belongs to a different generation, so the engine uploaded
 * NOTHING. Present on `BackupCreateResponseDto.held` on a held run (HTTP 200,
 * `skipped: false`). The app persists this as a pending conflict and surfaces
 * the modal.
 */
export interface BackupHeldDto {
  /** The generation the cloud manifest currently holds (the other device's). */
  remoteGeneration: number;
  /** The data version the cloud manifest currently holds. */
  remoteDataVersion: string;
  /** A human label for the device that wrote the cloud manifest. */
  remoteDeviceLabel?: string;
  /** When that device synced (RFC3339). */
  remoteSyncedAt?: string;
  /** The sync-group fingerprint of the cloud manifest (empty when none). */
  remoteSyncGroupFingerprint?: string;
}

export interface BackupCreateResponseDto {
  skipped: boolean;
  recoveryCode: string;
  recoveryCodeIsNew: boolean;
  dataVersion: string;
  uploadedObjects: number;
  dedupedObjects: number;
  totalBytes: number;
  manifest: BackupManifestDto;
  /**
   * Present when the generation guard HELD the backup: another device wrote the
   * cloud manifest, nothing was uploaded, and the user must resolve it.
   */
  held?: BackupHeldDto;
}

export interface BackupRestoreResponseDto {
  unwrapKind: string;
  dataVersion: string;
  schemaVersion: number;
  sideObjects: number;
  dbRows: number;
  dataDir: string;
  dbPath: string;
  manifest: BackupManifestDto;
}

export interface BackupKeyResponseDto {
  recoveryCode: string;
  dekBase64: string;
  /**
   * Canonical aliases (owner ruling 2026-10-17): the shared-account escrow
   * payload is built from both the DEK and the recovery code. `dekBase64` /
   * `recoveryCode` are kept for backward compatibility.
   */
  dek?: string;
  code?: string;
}

/** Result of `POST /api/backup/key/adopt` (shared-account DEK adoption). */
export interface BackupAdoptResponseDto {
  /** True when a (different) account key replaced the local lineage key. */
  adopted: boolean;
  /** True when the engine minted a fresh code and the caller must re-escrow. */
  reEscrowNeeded: boolean;
  /** Mirrors reEscrowNeeded: a fresh code was generated. */
  codeGenerated: boolean;
}

export interface BackupTargetStatusDto {
  available: boolean;
  account?: string;
  detail?: string;
}

export interface BackupTargetInfoDto {
  type: string;
  label: string;
  v1: boolean;
  note?: string;
}

// ── Query helpers ────────────────────────────────────────────────────────

export type QueryValue = string | number | boolean | null | undefined;

export function buildQuery(params: Record<string, QueryValue>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

/** Minimal fetch surface the client needs (injectable for tests). */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

// ── Client ───────────────────────────────────────────────────────────────

export class EngineApiClient {
  private readonly getConnection: () => EngineConnection;
  private fetchImpl: FetchLike;
  private adminApiKey = '';

  constructor(
    getConnection: () => EngineConnection = requireEngineConnection,
    fetchImpl: FetchLike = (typeof fetch !== 'undefined' ? fetch : (undefined as unknown as FetchLike)),
  ) {
    this.getConnection = getConnection;
    this.fetchImpl = fetchImpl;
  }

  /** Configure the `X-Admin-API-Key` fallback (desktop/non-loopback binds). */
  setAdminApiKey(key: string): void {
    this.adminApiKey = key;
  }

  /** Replace the fetch implementation (test seam). */
  setFetchImpl(fetchImpl: FetchLike): void {
    this.fetchImpl = fetchImpl;
  }

  private authHeaders(connection: EngineConnection): Record<string, string> {
    if (connection.token) {
      return { 'X-Loopback-Token': connection.token };
    }
    if (this.adminApiKey) {
      return { 'X-Admin-API-Key': this.adminApiKey };
    }
    return {};
  }

  private url(connection: EngineConnection, path: string): string {
    return `${connection.adminBaseUrl}${path}`;
  }

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const connection = this.getConnection();
    const url = this.url(connection, path);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...this.authHeaders(connection),
      ...((init.headers as Record<string, string>) ?? {}),
    };
    let response: Response;
    try {
      response = await this.fetchImpl(url, { ...init, headers });
    } catch (e) {
      throw new EngineApiError(
        `Engine request failed: ${path} (${(e as Error)?.message ?? e})`,
        0,
        path,
      );
    }
    if (!response.ok) {
      const body = await safeJson(response);
      const message =
        (body && typeof body === 'object' && 'error' in body
          ? String((body as { error: unknown }).error)
          : '') || `Engine request failed (${response.status})`;
      throw new EngineApiError(message, response.status, path, body);
    }
    return response;
  }

  private async getJson<T>(path: string): Promise<T> {
    const response = await this.request(path);
    return (await response.json()) as T;
  }

  private async sendJson<T>(
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await this.request(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  // ── Entity conversation reads (3-1b consolidated) ──────────────────────

  /** One row per phone conversation for the POV entity (newest first). */
  entityChatList(
    entityId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<ChatListResponseDto> {
    const q = buildQuery({ limit: opts.limit, offset: opts.offset });
    return this.getJson<ChatListResponseDto>(
      `/api/entities/${encodeURIComponent(entityId)}/chat-list${q}`,
    );
  }

  /**
   * Paginated, blob-free, chronological message window. The participant key is
   * a PATH SEGMENT (a `+` must be encoded `%2B`; `encodeURIComponent` does this);
   * `before` is the OPAQUE `next_cursor` from the previous page.
   */
  entityMessages(
    entityId: string,
    participantKey: string,
    opts: { limit?: number; before?: string } = {},
  ): Promise<MessagesResponseDto> {
    const q = buildQuery({ limit: opts.limit, before: opts.before });
    return this.getJson<MessagesResponseDto>(
      `/api/entities/${encodeURIComponent(entityId)}/conversations/${encodeURIComponent(
        participantKey,
      )}/messages${q}`,
    );
  }

  entityInteractions(
    entityId: string,
    filters: {
      presence_type?: string;
      scope?: string;
      status?: string;
      participant_key?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<InteractionsResponseDto> {
    const q = buildQuery(filters);
    return this.getJson<InteractionsResponseDto>(
      `/api/entities/${encodeURIComponent(entityId)}/interactions${q}`,
    );
  }

  entityEmojiActions(entityId: string): Promise<EmojiActionsResponseDto> {
    return this.getJson<EmojiActionsResponseDto>(
      `/api/entities/${encodeURIComponent(entityId)}/emoji-actions`,
    );
  }

  entityEmotion(entityId: string): Promise<EmotionResponseDto> {
    return this.getJson<EmotionResponseDto>(
      `/api/entities/${encodeURIComponent(entityId)}/emotion`,
    );
  }

  entityMemories(
    entityId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<MemoriesResponseDto> {
    const q = buildQuery({ limit: opts.limit, offset: opts.offset });
    return this.getJson<MemoriesResponseDto>(
      `/api/entities/${encodeURIComponent(entityId)}/memories${q}`,
    );
  }

  // ── Message writes + byte endpoints (`/api/messages`) ──────────────────

  /**
   * Patch a message (`PATCH /api/messages/:id`). Updatable fields: content,
   * is_pinned, reactions_json, is_edited, edit_of_message_id (≥1). A content
   * change marks the row `is_edited` engine-side. NOT patchable:
   * message_type, audio_duration, blobs, interaction_id.
   */
  patchMessage(messageId: string, body: MessagePatchDto): Promise<{ status: string }> {
    return this.sendJson<{ status: string }>(
      'PATCH',
      `/api/messages/${encodeURIComponent(messageId)}`,
      body,
    );
  }

  /** Soft-delete a single message (`DELETE /api/messages/:id`). */
  deleteMessage(messageId: string): Promise<{ status: string }> {
    return this.sendJson<{ status: string }>(
      'DELETE',
      `/api/messages/${encodeURIComponent(messageId)}`,
    );
  }

  /**
   * Fetch raw audio/image bytes for a message. Returns null when the message
   * has no such blob (404) so the two-phase loader can treat "no audio" as a
   * normal empty result rather than an error.
   */
  async fetchMessageBytes(
    messageId: string,
    kind: 'audio' | 'image',
  ): Promise<Uint8Array | null> {
    try {
      const response = await this.request(
        `/api/messages/${encodeURIComponent(messageId)}/${kind}`,
        { headers: { Accept: '*/*' } },
      );
      const buffer = await response.arrayBuffer();
      return new Uint8Array(buffer);
    } catch (e) {
      if (e instanceof EngineApiError && e.isNotFound) return null;
      throw e;
    }
  }

  /** Base64 audio bytes for a message (empty string when none). */
  async fetchMessageAudioBase64(messageId: string): Promise<string> {
    const bytes = await this.fetchMessageBytes(messageId, 'audio');
    return bytes ? uint8ArrayToBase64(bytes) : '';
  }

  /** Base64 image bytes for a message (empty string when none). */
  async fetchMessageImageBase64(messageId: string): Promise<string> {
    const bytes = await this.fetchMessageBytes(messageId, 'image');
    return bytes ? uint8ArrayToBase64(bytes) : '';
  }

  // ── Entity conversation writes ─────────────────────────────────────────

  /** Clear a conversation: tombstone its messages + interactions + settings. */
  clearConversation(
    entityId: string,
    participantKey: string,
  ): Promise<{ status: string; interactions: number; messages: number }> {
    return this.sendJson<{ status: string; interactions: number; messages: number }>(
      'DELETE',
      `/api/entities/${encodeURIComponent(entityId)}/conversations/${encodeURIComponent(
        participantKey,
      )}/messages`,
    );
  }

  /**
   * Mark a conversation read (`read: true`, optional `up_to_message_id`) or the
   * last partner-sent message unread (`read: false`). `read` is required.
   */
  markConversationRead(
    entityId: string,
    participantKey: string,
    body: { up_to_message_id?: string; read: boolean },
  ): Promise<{ status: string; updated: number }> {
    return this.sendJson<{ status: string; updated: number }>(
      'POST',
      `/api/entities/${encodeURIComponent(entityId)}/conversations/${encodeURIComponent(
        participantKey,
      )}/read`,
      body,
    );
  }

  /**
   * Merge-preserving partial upsert of a conversation's pin/archive flags
   * (`PUT /api/entities/:id/chat-settings/:participantKey`). reply_mode is
   * deliberately NOT writable here (it flows via the WS `SET_REPLY_MODE` path).
   */
  upsertChatSettings(
    entityId: string,
    participantKey: string,
    body: ChatSettingsWriteDto,
  ): Promise<unknown> {
    return this.sendJson<unknown>(
      'PUT',
      `/api/entities/${encodeURIComponent(entityId)}/chat-settings/${encodeURIComponent(
        participantKey,
      )}`,
      body,
    );
  }

  // ── Emoji action CRUD ──────────────────────────────────────────────────

  createEmojiAction(entityId: string, body: EmojiActionWriteDto): Promise<unknown> {
    return this.sendJson<unknown>(
      'POST',
      `/api/entities/${encodeURIComponent(entityId)}/emoji-actions`,
      body,
    );
  }

  updateEmojiAction(
    entityId: string,
    actionId: string,
    body: EmojiActionWriteDto,
  ): Promise<unknown> {
    return this.sendJson<unknown>(
      'PUT',
      `/api/entities/${encodeURIComponent(entityId)}/emoji-actions/${encodeURIComponent(
        actionId,
      )}`,
      body,
    );
  }

  deleteEmojiAction(entityId: string, actionId: string): Promise<{ status: string }> {
    return this.sendJson<{ status: string }>(
      'DELETE',
      `/api/entities/${encodeURIComponent(entityId)}/emoji-actions/${encodeURIComponent(
        actionId,
      )}`,
    );
  }

  /** Delete all emoji actions, or only defaults with `scope: 'default'`. */
  deleteEmojiActions(
    entityId: string,
    scope?: 'default',
  ): Promise<{ status: string; deleted: number }> {
    const q = buildQuery({ scope });
    return this.sendJson<{ status: string; deleted: number }>(
      'DELETE',
      `/api/entities/${encodeURIComponent(entityId)}/emoji-actions${q}`,
    );
  }

  // ── Entity / profile / module / provider reads ─────────────────────────

  /** All entities keyed by id (the engine returns a map, not an array). */
  listEntities(): Promise<Record<string, EntityConfigDto>> {
    return this.getJson<Record<string, EntityConfigDto>>('/api/entities');
  }

  getEntityConfig(entityId: string): Promise<EntityConfigDto> {
    return this.getJson<EntityConfigDto>(`/api/entities/${encodeURIComponent(entityId)}`);
  }

  listCharacterProfiles(): Promise<CharacterProfileDto[]> {
    return this.getJson<CharacterProfileDto[]>('/api/character-profiles');
  }

  getCharacterProfile(profileId: string): Promise<CharacterProfileDto> {
    return this.getJson<CharacterProfileDto>(
      `/api/character-profiles/${encodeURIComponent(profileId)}`,
    );
  }

  listCharacterImages(profileId: string): Promise<CharacterImageInfoDto[]> {
    return this.getJson<CharacterImageInfoDto[]>(
      `/api/character-profiles/${encodeURIComponent(profileId)}/images`,
    );
  }

  /** Raw image bytes for a character image (`GET .../images/:image_id`). */
  async fetchCharacterImageBase64(profileId: string, imageId: string): Promise<string> {
    const response = await this.request(
      `/api/character-profiles/${encodeURIComponent(profileId)}/images/${encodeURIComponent(imageId)}`,
      { headers: { Accept: '*/*' } },
    );
    const buffer = await response.arrayBuffer();
    return uint8ArrayToBase64(new Uint8Array(buffer));
  }

  /**
   * Upload a character image as `multipart/form-data`
   * (`POST /api/character-profiles/:id/images`, form field `file` + optional
   * `description`). The engine always stores the image with `is_primary=false`;
   * callers that need a primary image follow up with
   * {@link setCharacterImagePrimary}.
   */
  async uploadCharacterImage(
    profileId: string,
    image: { bytes: Uint8Array; mimeType: string; description?: string },
  ): Promise<{ id: string }> {
    // RN's FormData/Blob typings are narrower than the DOM lib's; the runtime
    // (RN fetch polyfill / node) accepts the Blob + filename form.
    const form: any = new FormData();
    const blob = new Blob([image.bytes as any], {
      type: image.mimeType || 'application/octet-stream',
    } as any);
    form.append('file', blob, 'image');
    if (image.description) form.append('description', image.description);
    const response = await this.request(
      `/api/character-profiles/${encodeURIComponent(profileId)}/images`,
      { method: 'POST', body: form },
    );
    const text = await response.text();
    return (text ? JSON.parse(text) : {}) as { id: string };
  }

  /** Update an image's metadata (`PUT .../images/:image_id`, JSON). */
  updateCharacterImageMetadata(
    profileId: string,
    imageId: string,
    body: { description?: string; display_order?: number },
  ): Promise<{ status: string }> {
    return this.sendJson<{ status: string }>(
      'PUT',
      `/api/character-profiles/${encodeURIComponent(profileId)}/images/${encodeURIComponent(imageId)}`,
      body,
    );
  }

  /** Soft-delete an image (`DELETE .../images/:image_id`). */
  deleteCharacterImage(profileId: string, imageId: string): Promise<{ status: string }> {
    return this.sendJson<{ status: string }>(
      'DELETE',
      `/api/character-profiles/${encodeURIComponent(profileId)}/images/${encodeURIComponent(imageId)}`,
    );
  }

  /** Set an image as the profile's primary (`PUT .../images/:image_id/set-primary`). */
  setCharacterImagePrimary(profileId: string, imageId: string): Promise<{ status: string }> {
    return this.sendJson<{ status: string }>(
      'PUT',
      `/api/character-profiles/${encodeURIComponent(profileId)}/images/${encodeURIComponent(imageId)}/set-primary`,
    );
  }

  listModuleConfigs(module: string): Promise<unknown[]> {
    return this.getJson<unknown[]>(`/api/module-configs/${encodeURIComponent(module)}`);
  }

  getModuleConfig(module: string, id: string): Promise<unknown> {
    return this.getJson<unknown>(
      `/api/module-configs/${encodeURIComponent(module)}/${encodeURIComponent(id)}`,
    );
  }

  // ── Module-config writes (existing management endpoints) ───────────────
  // The body is `{name, config}` where `config` is the module's own (nested)
  // config model — NOT the app's flat module row. Callers map both ways.

  createModuleConfig(
    module: string,
    body: ModuleConfigWriteDto,
  ): Promise<{ id: string; status: string }> {
    return this.sendJson<{ id: string; status: string }>(
      'POST',
      `/api/module-configs/${encodeURIComponent(module)}`,
      body,
    );
  }

  updateModuleConfig(
    module: string,
    id: string,
    body: ModuleConfigWriteDto,
  ): Promise<{ status: string }> {
    return this.sendJson<{ status: string }>(
      'PUT',
      `/api/module-configs/${encodeURIComponent(module)}/${encodeURIComponent(id)}`,
      body,
    );
  }

  deleteModuleConfig(module: string, id: string): Promise<{ status: string }> {
    return this.sendJson<{ status: string }>(
      'DELETE',
      `/api/module-configs/${encodeURIComponent(module)}/${encodeURIComponent(id)}`,
    );
  }

  /** Provider configs grouped by type (`?type=` restricts to one type). */
  listProviders(type?: string): Promise<ProviderListResponseDto> {
    const q = buildQuery({ type });
    return this.getJson<ProviderListResponseDto>(`/api/providers${q}`);
  }

  /** A single provider config by id across all provider types. */
  getProvider(id: string): Promise<ProviderGetResponseDto> {
    return this.getJson<ProviderGetResponseDto>(`/api/providers/${encodeURIComponent(id)}`);
  }

  // ── Engine identity (plan 7-10 §3) ─────────────────────────────────────

  /**
   * The running engine's advertised version (`GET /public/appversion` →
   * `{"appVersion":"v0.3.0-dev"}`). A loopback-PUBLIC route (no auth change);
   * the client still attaches the token header. Backs the About block via
   * `EngineService.refreshEngineVersion` (informational; the contract match is
   * a build-time gate).
   */
  engineAppVersion(): Promise<AppVersionDto> {
    return this.getJson<AppVersionDto>('/public/appversion');
  }

  // ── Engine logs (plan 7-11) ────────────────────────────────────────────

  /**
   * Query the engine's ring-buffer log history (`GET /api/development/logs`).
   * Newest-first; `limit` caps at the buffer capacity (10 000 engine-side).
   */
  engineLogs(params: EngineLogQuery = {}): Promise<EngineLogsResponseDto> {
    const q = buildQuery({
      component: params.component,
      entityId: params.entityId,
      minLevel: params.minLevel,
      search: params.search,
      since: params.since,
      limit: params.limit,
      offset: params.offset,
      isPrompt: params.isPrompt,
      promptType: params.promptType,
    });
    return this.getJson<EngineLogsResponseDto>(`/api/development/logs${q}`);
  }

  /** Total visible entry count in the engine's ring buffer. */
  engineLogCount(): Promise<{ count: number }> {
    return this.getJson<{ count: number }>('/api/development/logs/count');
  }

  /** Unique component names present in the buffer (+ registered components). */
  engineLogComponents(): Promise<{ components: string[] }> {
    return this.getJson<{ components: string[] }>('/api/development/logs/components');
  }

  /** Unique entity ids present in the buffer. */
  engineLogEntities(): Promise<{ entities: string[] }> {
    return this.getJson<{ entities: string[] }>('/api/development/logs/entities');
  }

  /** Unique prompt types among the buffer's prompt entries. */
  engineLogPromptTypes(): Promise<{ promptTypes: string[] }> {
    return this.getJson<{ promptTypes: string[] }>('/api/development/logs/prompt-types');
  }

  /** The engine's current log-level configuration (runtime verbosity). */
  engineLogLevels(): Promise<EngineLogLevelConfigDto> {
    return this.getJson<EngineLogLevelConfigDto>('/api/development/logs/level');
  }

  /** Apply a log-level configuration (`PUT /api/development/logs/level`). */
  setEngineLogLevels(config: Partial<EngineLogLevelConfigDto>): Promise<{ status: string }> {
    return this.sendJson<{ status: string }>('PUT', '/api/development/logs/level', config);
  }

  // ── Provider config writes (task 3-4 engine follow-up) ─────────────────

  /**
   * Create a provider config of the named type (`POST /api/providers`). The
   * engine mints the id; the response carries it as `config.id`.
   */
  createProvider(provider: string, config: unknown): Promise<ProviderWriteResponseDto> {
    return this.sendJson<ProviderWriteResponseDto>('POST', '/api/providers', {
      provider,
      config,
    });
  }

  /**
   * Update a provider config (`PUT /api/providers/:id`, partial merge). The
   * engine resolves the type from the id; omitted config fields keep their
   * current values.
   */
  updateProvider(id: string, config: unknown): Promise<ProviderWriteResponseDto> {
    return this.sendJson<ProviderWriteResponseDto>(
      'PUT',
      `/api/providers/${encodeURIComponent(id)}`,
      { config },
    );
  }

  /**
   * Delete a provider config (`DELETE /api/providers/:id`). Throws an
   * {@link EngineApiError} with status 409 when a live module config still
   * references it (`{error:"provider_in_use"}`), or 404 when absent.
   */
  deleteProvider(id: string): Promise<{ status: string }> {
    return this.sendJson<{ status: string }>(
      'DELETE',
      `/api/providers/${encodeURIComponent(id)}`,
    );
  }

  // ── Sync client runtime control (task 3-5) ─────────────────────────────

  /**
   * Read the sync-client status (`GET /api/sync/client/status`): the live state,
   * last error, authority flag, staged baseline path, dataset id, the buffered
   * `pending_writes` count and the persisted config block.
   */
  getSyncClientStatus(): Promise<SyncClientStatusDto> {
    return this.getJson<SyncClientStatusDto>('/api/sync/client/status');
  }

  /**
   * Merge a partial sync-client config (`PUT /api/sync/client`, ≥1 field),
   * applied live and persisted. Returns the post-apply status.
   */
  updateSyncClientConfig(partial: SyncClientConfigPatchDto): Promise<SyncClientStatusDto> {
    return this.sendJson<SyncClientStatusDto>('PUT', '/api/sync/client', partial);
  }

  /**
   * Hand write authority to the connected peer (`POST /api/sync/client/yield`).
   * Throws an {@link EngineApiError} with status 409 when the client is not
   * connected.
   */
  yieldSyncClient(): Promise<{ status: string; state: SyncClientState }> {
    return this.sendJson<{ status: string; state: SyncClientState }>(
      'POST',
      '/api/sync/client/yield',
    );
  }

  /**
   * Stop the client but keep `enabled=true` persisted
   * (`POST /api/sync/client/disconnect`). Returns the status object.
   */
  disconnectSyncClient(): Promise<SyncClientStatusDto> {
    return this.sendJson<SyncClientStatusDto>('POST', '/api/sync/client/disconnect');
  }

  // ── Sync-group key lifecycle (plan 7-2, consumed by 7-3) ───────────────

  /**
   * Read the sync-group key state (`GET /api/sync/group/key-status`):
   * `uninitialized` (no key), `key_pending` (joining, awaiting the escrowed
   * key) or `member` (holds the key). Never returns key material.
   */
  getSyncGroupKeyStatus(): Promise<SyncGroupKeyStatusDto> {
    return this.getJson<SyncGroupKeyStatusDto>('/api/sync/group/key-status');
  }

  /**
   * Mint the dataset's 256-bit sync-group key (`POST /api/sync/group/init`).
   * Returns the RAW `group_key_base64` so the app can wrap + escrow it (W1
   * account-escrow style). Throws an {@link EngineApiError} with status 409 when
   * a key already exists (use {@link rotateSyncGroup}).
   */
  initSyncGroup(): Promise<SyncGroupKeyStatusDto> {
    return this.sendJson<SyncGroupKeyStatusDto>('POST', '/api/sync/group/init');
  }

  /**
   * Install a RAW sync-group key recovered from the account escrow
   * (`POST /api/sync/group/import`) — the join path.
   */
  importSyncGroup(groupKeyBase64: string): Promise<SyncGroupKeyStatusDto> {
    return this.sendJson<SyncGroupKeyStatusDto>('POST', '/api/sync/group/import', {
      group_key_base64: groupKeyBase64,
    });
  }

  /**
   * Rotate the sync-group key (`POST /api/sync/group/rotate`). Returns the RAW
   * `group_key_base64` for the app to re-wrap + re-escrow; `baseline_required`
   * is true (prior frames become unreadable; engines re-baseline on reconnect).
   */
  rotateSyncGroup(): Promise<SyncGroupKeyStatusDto> {
    return this.sendJson<SyncGroupKeyStatusDto>('POST', '/api/sync/group/rotate');
  }

  /**
   * Relay the portal-triggered rotation-required flag to the engine
   * (`POST /api/sync/group/rotation-required`). Does not change the key.
   */
  setSyncGroupRotationRequired(required: boolean): Promise<SyncGroupKeyStatusDto> {
    return this.sendJson<SyncGroupKeyStatusDto>('POST', '/api/sync/group/rotation-required', {
      required,
    });
  }

  // ── QR pairing mint + desktop cloud identity (plan 7-15, contract 1.5.0) ─

  /**
   * Mint the LAN QR pairing payload (`POST /api/sync/pairing/lan`) — the
   * desktop management surface. Returns the v2 LAN payload the phone parses.
   */
  mintLanPairing(): Promise<LanSyncPairingPayload> {
    return this.sendJson<LanSyncPairingPayload>('POST', '/api/sync/pairing/lan');
  }

  /** Mint the cloud QR pairing payload (`POST /api/sync/pairing/cloud`). */
  mintCloudPairing(): Promise<SyncPairingPayload> {
    return this.sendJson<SyncPairingPayload>('POST', '/api/sync/pairing/cloud');
  }

  /** Desktop cloud-account status (`GET /api/cloud/account`; never a token). */
  cloudAccount(): Promise<CloudAccountStatusDto> {
    return this.getJson<CloudAccountStatusDto>('/api/cloud/account');
  }

  /** Start the loopback browser-OAuth sign-in (`POST /api/cloud/signin/start`). */
  startCloudSignIn(): Promise<CloudSignInStartDto> {
    return this.sendJson<CloudSignInStartDto>('POST', '/api/cloud/signin/start');
  }

  /** Sign out of Soulbits Cloud (`POST /api/cloud/signin/signout`). */
  cloudSignOut(): Promise<{ status: string }> {
    return this.sendJson<{ status: string }>('POST', '/api/cloud/signin/signout');
  }

  // ── Cross-entity stats (task 3-4 engine follow-up) ─────────────────────

  /**
   * Per-entity `{likes, chats}` for every live entity
   * (`GET /api/stats/characters`). Backs the app's `getCharacterStats`.
   */
  characterStats(): Promise<CharacterStatsResponseDto> {
    return this.getJson<CharacterStatsResponseDto>('/api/stats/characters');
  }

  /**
   * Refresh the api_key (and optional base_url) on every live `soulbitscloud`
   * provider config in the embedded engine — the on-device equivalent of the
   * cloud-mode token seed. Called during cloud-mode startup (task 2-5) and on
   * every cloud token refresh so a rotated PASETO takes effect immediately.
   *
   * REQUIRED ENGINE-SIDE CONTRACT (prerequisite — see the 2-5 report):
   *   `POST /api/providers/soulbitscloud/refresh-token`
   *   body `{ "api_key": string, "base_url"?: string }`
   *   → `{ "updated": number }` (count of refreshed rows)
   *
   * The engine mirrors its cloud-mode `RefreshAllActiveTokens` seed behind this
   * route. Until the route exists the call returns 404 and cloud-mode
   * orchestration logs it as non-fatal (the engine's own default soulbitscloud
   * rows still exist; only the fresh token is not injected).
   */
  refreshSoulbitsCloudProviderConfigs(
    apiKey: string,
    baseUrl?: string,
  ): Promise<{ updated: number }> {
    return this.sendJson<{ updated: number }>(
      'POST',
      '/api/providers/soulbitscloud/refresh-token',
      { api_key: apiKey, base_url: baseUrl },
    );
  }

  /** Toggle a character profile's favorite bit (`PUT .../favorite`). */
  setCharacterProfileFavorite(
    profileId: string,
    isFavorite: boolean,
  ): Promise<{ id: string; is_favorite: boolean }> {
    return this.sendJson<{ id: string; is_favorite: boolean }>(
      'PUT',
      `/api/character-profiles/${encodeURIComponent(profileId)}/favorite`,
      { is_favorite: isFavorite },
    );
  }

  // ── Writes (existing management endpoints) ─────────────────────────────

  createEntity(body: {
    name: string;
    character_profile_id?: string | null;
    entity_type?: string;
    dedupe_id_if_taken?: boolean;
  }): Promise<{ id: string; alias: string; entity_type: string; character_profile_id: string | null }> {
    return this.sendJson('POST', '/api/entities', body);
  }

  updateEntity(
    entityId: string,
    body: {
      character_profile_id?: string | null;
      lifecycle_config?: string;
      alias?: string;
      is_disabled?: boolean;
      /**
       * 3-4: `PUT /api/entities/:id` now accepts optional `is_muted` (mirrors
       * `is_disabled` exactly). Present → updates `entities.is_muted`
       * (suppresses engine-side outreach/push delivery; lifecycle continues);
       * absent → untouched. An unknown id surfaces as 500 (no 404 branch).
       */
      is_muted?: boolean;
    },
  ): Promise<unknown> {
    return this.sendJson('PUT', `/api/entities/${encodeURIComponent(entityId)}`, body);
  }

  updateEntityMappings(
    entityId: string,
    body: Record<string, string | null>,
  ): Promise<unknown> {
    return this.sendJson(
      'PUT',
      `/api/entities/${encodeURIComponent(entityId)}/mappings`,
      body,
    );
  }

  deleteEntity(entityId: string): Promise<unknown> {
    return this.sendJson('DELETE', `/api/entities/${encodeURIComponent(entityId)}`);
  }

  duplicateEntity(entityId: string): Promise<{ id: string; alias: string; entity_type: string }> {
    return this.sendJson('POST', `/api/entities/${encodeURIComponent(entityId)}/duplicate`);
  }

  createCharacterProfile(body: CharacterProfileDto): Promise<CharacterProfileDto> {
    return this.sendJson('POST', '/api/character-profiles', body);
  }

  updateCharacterProfile(profileId: string, body: CharacterProfileDto): Promise<CharacterProfileDto> {
    return this.sendJson(
      'PUT',
      `/api/character-profiles/${encodeURIComponent(profileId)}`,
      body,
    );
  }

  deleteCharacterProfile(profileId: string): Promise<unknown> {
    return this.sendJson(
      'DELETE',
      `/api/character-profiles/${encodeURIComponent(profileId)}`,
    );
  }

  /** Full-card copy of a profile (`POST /api/character-profiles/:id/duplicate`). */
  duplicateCharacterProfile(profileId: string, name?: string): Promise<CharacterProfileDto> {
    return this.sendJson<CharacterProfileDto>(
      'POST',
      `/api/character-profiles/${encodeURIComponent(profileId)}/duplicate`,
      name ? { name } : {},
    );
  }

  // ── Backup & restore (plan 2-6) ────────────────────────────────────────

  /**
   * Create a backup artifact and upload it to the target
   * (`POST /api/backup/artifact`). The engine snapshots the DB, builds the
   * content-addressed objects, and commits the manifest. Returns the manifest
   * summary + the recovery code (W3).
   */
  createBackupArtifact(
    target: BackupTargetDescriptor,
    opts: {
      deviceLabel?: string;
      targetAccount?: string;
      passphrase?: string;
      force?: boolean;
      dryRun?: boolean;
      includeSideObjects?: boolean;
      /**
       * Generation-guard conflict policy (owner ruling 2026-10-17). Defaults to
       * `hold` engine-side; `overwrite` is the explicit "push mine" decision.
       */
      onConflict?: BackupConflictPolicy;
    } = {},
  ): Promise<BackupCreateResponseDto> {
    return this.sendJson<BackupCreateResponseDto>('POST', '/api/backup/artifact', {
      target,
      deviceLabel: opts.deviceLabel,
      targetAccount: opts.targetAccount,
      passphrase: opts.passphrase,
      force: opts.force,
      dryRun: opts.dryRun,
      includeSideObjects: opts.includeSideObjects,
      onConflict: opts.onConflict,
    });
  }

  /**
   * Restore an artifact from the target (`POST /api/backup/restore`). The
   * artifact is assembled into `destDataDir` (defaults to a staging dir under
   * the engine data dir — a live DB is never clobbered).
   */
  restoreBackupArtifact(
    target: BackupTargetDescriptor,
    opts: {
      recoveryCode?: string;
      passphrase?: string;
      dekBase64?: string;
      destDataDir?: string;
      skipSideObjects?: boolean;
    } = {},
  ): Promise<BackupRestoreResponseDto> {
    return this.sendJson<BackupRestoreResponseDto>('POST', '/api/backup/restore', {
      target,
      recoveryCode: opts.recoveryCode,
      passphrase: opts.passphrase,
      dekBase64: opts.dekBase64,
      destDataDir: opts.destDataDir,
      skipSideObjects: opts.skipSideObjects,
    });
  }

  /** Read the DB's skip-if-unchanged marker (`GET /api/backup/data-version`). */
  backupDataVersion(): Promise<{ dataVersion: string }> {
    return this.getJson<{ dataVersion: string }>('/api/backup/data-version');
  }

  /** Re-read the recovery code + DEK (`GET /api/backup/key`). */
  backupKey(): Promise<BackupKeyResponseDto> {
    return this.getJson<BackupKeyResponseDto>('/api/backup/key');
  }

  /** Reset the backup key (`POST /api/backup/key/reset`). */
  resetBackupKey(): Promise<BackupKeyResponseDto> {
    return this.sendJson<BackupKeyResponseDto>('POST', '/api/backup/key/reset');
  }

  /**
   * Adopt the account's shared lineage key (`POST /api/backup/key/adopt`). The
   * app forwards the W1 escrow blob it fetched from the cloud; the engine
   * decodes it (both payload shapes) and reconciles the local DEK + recovery
   * code — all policy lives engine-side (owner ruling 2026-10-17).
   */
  adoptBackupKey(payload: string): Promise<BackupAdoptResponseDto> {
    return this.sendJson<BackupAdoptResponseDto>('POST', '/api/backup/key/adopt', { payload });
  }

  /** List selectable target types (`GET /api/backup/targets`). */
  listBackupTargets(): Promise<{ targets: BackupTargetInfoDto[] }> {
    return this.getJson<{ targets: BackupTargetInfoDto[] }>('/api/backup/targets');
  }

  /** Probe a target's availability + account (`POST /api/backup/targets/probe`). */
  probeBackupTarget(target: BackupTargetDescriptor): Promise<BackupTargetStatusDto> {
    return this.sendJson<BackupTargetStatusDto>('POST', '/api/backup/targets/probe', target);
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Shared singleton used by the API-backed repositories. */
export const engineApiClient = new EngineApiClient();
