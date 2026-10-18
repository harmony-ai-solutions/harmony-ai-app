/**
 * Shared engine management-API wire fixtures (task 5-1).
 *
 * The golden JSON payloads the app's management-API layer is written against —
 * the app-side half of the plan's "shared fixtures file consumed by both repos'
 * CI". Each fixture is **typed as the wire DTO** it represents, so
 * `npx tsc --noEmit` already fails the moment a fixture drifts from the app's
 * declared DTO shape (the compile-time half of the conformance gate). The
 * runtime half lives in `engineContractConformance.test.ts` (mapper round-trips)
 * and `engineLoopbackSmoke.test.ts` (transport), both driven by
 * {@link CONTRACT_FIXTURES}.
 *
 * **Hosting:** the canonical copy is intended to live in the engine repo (the
 * plan's "engine hosts, app CI fetches a pinned path" choice); the engine repo is
 * a read-only reference in this task, so this vendored copy is what the app
 * consumes. Keep it byte-for-byte in sync with the engine-side copy when the
 * orchestrator lands that half — see `docs/engine-contract-gates.md`.
 *
 * No live engine or network is needed: these are plain data.
 */

import type {
  ChatListRowDto,
  ChatListResponseDto,
  CharacterImageInfoDto,
  CharacterProfileDto,
  CharacterStatsResponseDto,
  CloudAccountStatusDto,
  CloudSignInStartDto,
  ConversationMessageDto,
  EmojiActionDto,
  EmojiActionsResponseDto,
  EmotionResponseDto,
  EmotionStateDto,
  EngineLogEntryDto,
  EntityConfigDto,
  InteractionDto,
  InteractionsResponseDto,
  MemoriesResponseDto,
  MemoryDto,
  MessagesResponseDto,
  ProviderCapabilitiesDto,
  ProviderListResponseDto,
  ProviderModelsResponseDto,
  ProviderVerifyResultDto,
  ProviderWriteResponseDto,
  SyncClientStatusDto,
  SyncGroupKeyStatusDto,
} from '../EngineApiClient';
import type { LanSyncPairingPayload, SyncPairingPayload } from '../../sync/syncCloudTypes';

/**
 * The engine contract version these fixtures were captured against. MUST equal
 * {@link ENGINE_CONTRACT_VERSION} — the `engineContractConformance` canary fails
 * otherwise (bumping one side without the other is the deliberate-drift canary
 * the plan asks for).
 */
export const FIXTURE_CONTRACT_VERSION = '1.6.0';

const CREATED = '2026-10-12T09:00:00Z';
const UPDATED = '2026-10-12T10:00:00Z';

// ── Leaf wire DTOs ─────────────────────────────────────────────────────────

export const conversationMessageFixture: ConversationMessageDto = {
  id: 'msg-1',
  entity_id: 'ent-1',
  sender_entity_id: 'ent-2',
  interaction_id: 'int-1',
  content: 'Hello there',
  audio_duration: null,
  message_type: 'text',
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
  reply_to_message_id: null,
  created_at: CREATED,
  updated_at: UPDATED,
  deleted_at: null,
  reactions_json: null,
  is_pinned: false,
  is_read: true,
};

export const interactionFixture: InteractionDto = {
  id: 'int-1',
  entity_id: 'ent-1',
  interaction_scope: 'private',
  participant_key: 'ent-1+ent-2',
  participant_ids: '["ent-1","ent-2"]',
  presence_type: 'phone',
  status: 'active',
  started_at: CREATED,
  last_activity_at: UPDATED,
  ended_at: null,
  memory_id: null,
  continued_interaction_id: null,
  metadata: null,
  summary: null,
  created_at: CREATED,
  updated_at: UPDATED,
  deleted_at: null,
};

export const emojiActionFixture: EmojiActionDto = {
  id: 'ea-1',
  entity_id: 'ent-1',
  emoji_native: '😀',
  emotion_effect: null,
  metabolism_vector: null,
  substitution_text: null,
  auto_generated: false,
  is_default: true,
  deleted_at: null,
  created_at: CREATED,
  updated_at: UPDATED,
};

export const emotionStateFixture: EmotionStateDto = {
  entity_id: 'ent-1',
  last_update: UPDATED,
  created_at: CREATED,
  updated_at: UPDATED,
  deleted_at: null,
  joy_intensity: 0.5,
  sadness_intensity: 0.1,
  trust_intensity: 0.4,
  disgust_intensity: 0,
  fear_intensity: 0,
  anger_intensity: 0,
  surprise_intensity: 0.2,
  anticipation_intensity: 0.3,
  joy_baseline: 0.4,
  sadness_baseline: 0.1,
  trust_baseline: 0.4,
  disgust_baseline: 0,
  fear_baseline: 0,
  anger_baseline: 0,
  surprise_baseline: 0.2,
  anticipation_baseline: 0.3,
  joy_crystallize_start: null,
  sadness_crystallize_start: null,
  trust_crystallize_start: null,
  disgust_crystallize_start: null,
  fear_crystallize_start: null,
  anger_crystallize_start: null,
  surprise_crystallize_start: null,
  anticipation_crystallize_start: null,
  decay_tau: 6,
  high_threshold: 0.7,
  low_threshold: 0.2,
  crystallize_intensity: 0.9,
  crystallize_min_hours: 24,
};

export const memoryFixture: MemoryDto = {
  id: 'mem-1',
  entity_id: 'ent-1',
  compaction_level: 0,
  content: 'A remembered detail',
  emotional_state_bits: 0,
  start_date: null,
  end_date: null,
  created_at: CREATED,
  updated_at: UPDATED,
  deleted_at: null,
};

export const characterProfileFixture: CharacterProfileDto = {
  id: 'prof-1',
  name: 'Aria',
  description: 'A gentle companion',
  personality: 'warm',
  scenario: 'A quiet cafe',
  first_mes: 'Hi!',
  mes_example: '',
  alternate_greetings: '[]',
  post_history_instructions: '',
  creator_notes: '',
  creator: 'soulbits',
  character_version: '1',
  nickname: 'Ari',
  tags: '[]',
  group_only_greetings: '[]',
  extensions: '{}',
  assets: '[]',
  card_provenance: '{}',
  character_book: '{}',
  voice_characteristics: '',
  base_prompt: '',
  typing_speed_wpm: 60,
  audio_response_chance_percent: 50,
  vision_config_id: 'vc-1',
  lifecycle_config: '{}',
  is_favorite: 1,
  created_at: CREATED,
  updated_at: UPDATED,
  deleted_at: null,
};

export const characterImageInfoFixture: CharacterImageInfoDto = {
  id: 'img-1',
  character_profile_id: 'prof-1',
  mime_type: 'image/png',
  description: 'primary',
  is_primary: true,
  display_order: 0,
  created_at: CREATED,
};

export const entityConfigFixture: EntityConfigDto = {
  character_profile: characterProfileFixture,
  modules: {},
  lifecycle_config: '{}',
  alias: 'Aria',
  entity_type: 'ai',
  is_muted: false,
  is_disabled: false,
  character_profile_id: 'prof-1',
  rag_reindex_required: false,
  created_at: CREATED,
  updated_at: UPDATED,
  deleted_at: null,
};

export const chatListRowFixture: ChatListRowDto = {
  interaction_id: 'int-1',
  participant_key: 'ent-1+ent-2',
  interaction_scope: 'private',
  participant_ids: '["ent-1","ent-2"]',
  last_message: conversationMessageFixture,
  last_message_at: UPDATED,
  unread_count: 1,
  pinned: false,
  archived: false,
  reply_mode: 'realistic',
};

export const syncClientStatusFixture: SyncClientStatusDto = {
  enabled: true,
  state: 'syncing',
  last_error: null,
  local_authoritative: false,
  baseline_path: null,
  dataset_id: 'ds-1',
  pending_writes: 0,
  sync_group: 'member',
  rotation_required: false,
  cognition_authority: 'local',
  narration_paused: false,
  relay: {
    connected: true,
    auth_needed: false,
    last_seq: 12,
    last_seq_age_ms: 500,
    acked_seq: 10,
    buffered_frames: 2,
    buffered_bytes: 2048,
    cap: 4194304,
    overflow: false,
    rejected_frames: 0,
    decrypt_failures: 0,
    sync_buffer_mb: 64,
    sync_devices: 3,
    backup_storage_mb: 1024,
  },
  config: {
    enabled: true,
    transport: 'relay',
    peer_address: '',
    peer_wss_address: '',
    security_mode: 'secure',
    relay_url: 'wss://sync.example/v1/sync/ws',
    relay_token: '',
    device_id: 'phone-1',
    dataset_id: 'ds-1',
    group_join_pending: false,
    device_name: 'Phone',
    device_type: 'phone',
    device_platform: 'ios',
    peer_fingerprint:
      'sha256:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89',
  },
};

/**
 * The sync-group key status (plan 7-2). Mirrors the engine-side canonical
 * `syncGroupKeyStatus` fixture (key material is never in key-status).
 */
export const syncGroupKeyStatusFixture: SyncGroupKeyStatusDto = {
  state: 'member',
  has_key: true,
  fingerprint: '9f2c1e0d7a4b6c8e5f3a1b2c4d6e8f0a1b3c5d7e9f0a2b4c6d8e0f1a3b5c7d9e',
  rotation_required: false,
};

// ── QR pairing mint + desktop cloud identity (plan 7-15, contract 1.5.0) ────
// Mirrors the engine-side canonical `lanPairingPayload` / `lanPairingPayloadEnrolled`
// / `cloudPairingPayload` / `cloudAccountStatus` / `cloudSignInStart` fixtures.

const LAN_FINGERPRINT =
  'sha256:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89';
const LAN_SECRET = '9f2c1e0d7a4b6c8e5f3a1b2c4d6e8f0a1b3c5d7e9f0a2b4c6d8e0f1a3b5c7d9e';
const ENROLL_GRANT = 'kQ9f2c1e0d7a4b6c8e5f3a1b2c4d6e8f0a1b3c5d7e9f0a2b4c6d8e';

export const lanPairingPayloadFixture: LanSyncPairingPayload = {
  v: 1,
  kind: 'soulbits-lan',
  ws: '192.168.1.10:28080',
  wss: '192.168.1.10:28443',
  mode: 'secure',
  fingerprint: LAN_FINGERPRINT,
  dataset_id: 'engine-8f0a1b3c5d7e9f02',
  name: 'Studio-PC',
  secret: LAN_SECRET,
  ttl: 300,
};

/**
 * Signed-in variant of {@link lanPairingPayloadFixture} (plan 7-15 E2): the
 * `enrollment` block is present only when the desktop is signed in and the grant
 * was freshly minted. `account_hint` is MASKED here (the phone shows it on the
 * signed-out confirmation sheet).
 */
export const lanPairingPayloadEnrolledFixture: LanSyncPairingPayload = {
  ...lanPairingPayloadFixture,
  enrollment: {
    relay_url: 'wss://sync.soulbits.app/v1/sync/ws',
    grant: ENROLL_GRANT,
    account_hint: 'u***@example.com',
  },
};

/** The cloud QR payload — IDENTICAL to the portal shape the phone already parses. */
export const cloudPairingPayloadFixture: SyncPairingPayload = {
  relay_url: 'wss://sync.soulbits.app/v1/sync/ws',
  pairing_token: ENROLL_GRANT,
  account_hint: 'user@example.com',
};

/** `GET /api/cloud/account` (plan 7-15 E2). Never carries a token. */
export const cloudAccountStatusFixture: CloudAccountStatusDto = {
  signed_in: true,
  account_hint: 'u***@example.com',
  email: 'user@example.com',
  device_id: 'b1f0c5d9-8a7e-4c3b-9f21-2d6e8a0b4c7d',
  device_authorized: true,
  device_authorization_pending: false,
};

/**
 * `POST /api/cloud/signin/start` (plan 7-15 E2): the portal connect URL the
 * frontend opens. Mirrors the engine-side canonical `cloudSignInStart` fixture —
 * the engine mints a connect session (`POST /v1/devices/connect-session`) and
 * returns the portal `/connect` page URL; the `connect_id` + session secret stay
 * in engine memory only and are never returned.
 */
export const cloudSignInStartFixture: CloudSignInStartDto = {
  url: 'https://cloud.soulbits.app/connect?request=3f2c1e0d-7a4b-4c8e-9f3a-1b2c4d6e8f0a',
};

// ── Engine logs (plan 7-11) ────────────────────────────────────────────────
// Mirrors the engine-side canonical `engineLogEntry` fixture. The log entry is
// camelCase (the engine's `logging.LogEntry` JSON tags), unlike the data-layer
// DTOs.
export const engineLogEntryFixture: EngineLogEntryDto = {
  id: 42,
  timestamp: '2026-10-12T10:00:00Z',
  level: 'info',
  component: 'chat',
  entityId: 'ent-1',
  subSystem: '',
  message: 'composed reply',
  data: { latency: '12ms' },
  isPrompt: false,
};

// ── Response envelopes ─────────────────────────────────────────────────────

const chatListPageFixture: ChatListResponseDto = {
  conversations: [chatListRowFixture],
  has_more: false,
  next_offset: null,
};

const messagesPageFixture: MessagesResponseDto = {
  messages: [conversationMessageFixture],
  has_more: false,
  next_cursor: null,
};

const interactionsPageFixture: InteractionsResponseDto = {
  interactions: [interactionFixture],
  has_more: false,
  next_offset: null,
};

const emojiActionsFixture: EmojiActionsResponseDto = {
  emoji_actions: [emojiActionFixture],
};

const emotionFixture: EmotionResponseDto = {
  emotion_state: emotionStateFixture,
};

const memoriesPageFixture: MemoriesResponseDto = {
  memories: [memoryFixture],
  has_more: false,
  next_offset: null,
};

const characterProfilesFixture: CharacterProfileDto[] = [characterProfileFixture];

const characterImagesFixture: CharacterImageInfoDto[] = [characterImageInfoFixture];

const entitiesMapFixture: Record<string, EntityConfigDto> = { 'ent-1': entityConfigFixture };

// ── Module-config + provider-account fixtures (provider-registry 6-1) ──────
// The module read is COMPOSITE (nested merged provider object with top-level
// `id`); the module write response is `{id, status}`. Provider reads are
// account-shaped rows; `GET /api/providers/:id` returns the merged object.

const moduleConfigFixture: unknown = {
  id: 'mc-1',
  name: 'default',
  provider: 'openaicompatible',
  provider_account_id: 'prov-1',
  openaicompatible: { id: 'prov-1', baseurl: 'http://localhost:8000', model: 'llama3' },
};

const moduleConfigListFixture: unknown[] = [moduleConfigFixture];

const moduleConfigCreateFixture = { id: 'mc-1', status: 'module configuration created' };

const providerListFixture: ProviderListResponseDto = {
  providers: {
    soulbitscloud: [
      {
        id: 'prov-1',
        type: 'soulbitscloud',
        name: 'Default',
        api_key: 'redacted',
        base_url: '',
        extra: '{}',
        created_at: CREATED,
        updated_at: UPDATED,
        deleted_at: null,
      },
    ],
  },
};

const providerWriteFixture: ProviderWriteResponseDto = {
  provider: 'soulbitscloud',
  config: { id: 'prov-1', type: 'soulbitscloud', name: 'Default', api_key: 'redacted' },
};

const providerRefreshFixture = { updated: 1 };

const providerVerifyFixture: ProviderVerifyResultDto = {
  state: 'valid',
  detail: 'Ollama 0.12.6 · 7 models',
};

const providerModelsFixture: ProviderModelsResponseDto = {
  models: [
    {
      id: 'gpt-4o',
      label: 'GPT-4o',
      context: 128000,
      output_limit: 16384,
      modalities: ['text', 'image'],
      capabilities: ['reasoning', 'tools'],
      param_support: ['temperature', 'max_tokens'],
      source: 'catalog',
      provenance: 'known',
      meta: { top_provider: 'openai' },
    },
  ],
  voices: [
    {
      voice_id: '21m00Tcm4TlvDq8ikWAM',
      name: 'Rachel',
      category: 'premade',
      labels: { accent: 'american' },
      preview_url: 'https://example/voice.mp3',
    },
  ],
};

const providerCapabilitiesFixture: ProviderCapabilitiesDto = {
  catalog: {
    openai: [{ id: 'gpt-4o', label: 'GPT-4o', context: 128000, source: 'catalog' }],
  },
  param_mapping: { mistral: { seed: 'random_seed' } },
};

const characterStatsFixture: CharacterStatsResponseDto = {
  stats: { 'ent-1': { likes: 3, chats: 5 } },
};

const backupTargetsFixture = {
  targets: [{ type: 'local', label: 'Local folder', v1: true, note: 'device storage' }],
};

const dataVersionFixture = { dataVersion: 'dv-1' };

const favoriteToggleFixture = { id: 'prof-1', is_favorite: true };

const statusOkFixture = { status: 'ok' };

// ── Engine-log response envelopes (plan 7-11) ──────────────────────────────
const engineLogsPageFixture = {
  entries: [engineLogEntryFixture],
  count: 1,
  offset: 0,
  limit: 200,
};

const engineLogCountFixture = { count: 1 };

const engineLogComponentsFixture = { components: ['chat', 'management_api'] };

const engineLogEntitiesFixture = { entities: ['ent-1'] };

const engineLogPromptTypesFixture = { promptTypes: ['system'] };

const engineLogLevelsFixture = {
  defaultLevel: 'debug',
  componentLevels: { chat: 'info' },
  promptVerbosity: 'summary',
};

const engineLogLevelOkFixture = { status: 'ok' };

// ── Outreach notification events (plan 7-12) ───────────────────────────────
// Mirrors the engine-side canonical `outreachNotificationEvent` fixture. The
// event is snake_case (the engine `notifications.Event` JSON tags). `delivery`
// is present ("live") only for events emitted from the eventserver live path.
export const outreachNotificationEventFixture = {
  type: 'outreach',
  entity_id: 'ent-1',
  entity_name: 'Aria',
  message_id: 'msg-1',
  title: 'Aria',
  body_preview: 'Thinking of you.',
  created_at: '2026-10-12T10:00:00Z',
  eligibility: 'eligible',
};

export const outreachNotificationLiveEventFixture = {
  ...outreachNotificationEventFixture,
  delivery: 'live',
};

/**
 * Every fixture keyed by the `fixture` field of a
 * {@link import('../engineContract').ContractEndpoint}. The loopback smoke uses
 * these as the mock server's response bodies.
 */
export const CONTRACT_FIXTURES: Record<string, unknown> = {
  conversationMessage: conversationMessageFixture,
  chatListRow: chatListRowFixture,
  chatListPage: chatListPageFixture,
  messagesPage: messagesPageFixture,
  interaction: interactionFixture,
  interactionsPage: interactionsPageFixture,
  emojiAction: emojiActionFixture,
  emojiActions: emojiActionsFixture,
  emotion: emotionFixture,
  emotionState: emotionStateFixture,
  memory: memoryFixture,
  memoriesPage: memoriesPageFixture,
  characterProfile: characterProfileFixture,
  characterProfiles: characterProfilesFixture,
  characterImageInfo: characterImageInfoFixture,
  characterImages: characterImagesFixture,
  entityConfig: entityConfigFixture,
  entitiesMap: entitiesMapFixture,
  moduleConfig: moduleConfigFixture,
  moduleConfigList: moduleConfigListFixture,
  moduleConfigCreate: moduleConfigCreateFixture,
  providerList: providerListFixture,
  providerWrite: providerWriteFixture,
  providerRefresh: providerRefreshFixture,
  providerVerify: providerVerifyFixture,
  providerModels: providerModelsFixture,
  providerCapabilities: providerCapabilitiesFixture,
  syncClientStatus: syncClientStatusFixture,
  syncGroupKeyStatus: syncGroupKeyStatusFixture,
  lanPairingPayload: lanPairingPayloadFixture,
  lanPairingPayloadEnrolled: lanPairingPayloadEnrolledFixture,
  cloudPairingPayload: cloudPairingPayloadFixture,
  cloudAccountStatus: cloudAccountStatusFixture,
  cloudSignInStart: cloudSignInStartFixture,
  characterStats: characterStatsFixture,
  backupTargets: backupTargetsFixture,
  dataVersion: dataVersionFixture,
  favoriteToggle: favoriteToggleFixture,
  statusOk: statusOkFixture,
  engineLogEntry: engineLogEntryFixture,
  engineLogsPage: engineLogsPageFixture,
  engineLogCount: engineLogCountFixture,
  engineLogComponents: engineLogComponentsFixture,
  engineLogEntities: engineLogEntitiesFixture,
  engineLogPromptTypes: engineLogPromptTypesFixture,
  engineLogLevels: engineLogLevelsFixture,
  engineLogLevelOk: engineLogLevelOkFixture,
  outreachNotificationEvent: outreachNotificationEventFixture,
  outreachNotificationLiveEvent: outreachNotificationLiveEventFixture,
};
