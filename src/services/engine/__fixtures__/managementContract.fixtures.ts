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
  AudioTagCapabilitiesDto,
  ChatListRowDto,
  CharacterImageInfoDto,
  CharacterProfileDto,
  CharacterStatsResponseDto,
  CloudAccountStatusDto,
  CloudSignInStartDto,
  CollectionInfoDto,
  CollectionStatsDto,
  ConversationMessageDto,
  DocumentDetailsDto,
  DocumentInfoDto,
  ElevenLabsVoiceCloneResponseDto,
  ElevenLabsVoiceDesignResponseDto,
  EmojiActionDto,
  EmojiActionsResponseDto,
  EmotionDerivedDto,
  EmotionResponseDto,
  EmotionStateDto,
  EngineLogEntryDto,
  EntityConfigDto,
  GroupedCollectionViewDto,
  InteractionDto,
  InteractionsResponseDto,
  MemoriesResponseDto,
  MemoryDto,
  MessagesResponseDto,
  ProviderAccountDto,
  ProviderCapabilitiesDto,
  ProviderListResponseDto,
  ProviderModelsResponseDto,
  ProviderVerifyResultDto,
  ProviderWriteResponseDto,
  QueryResultDto,
  RagCollectionDetailResponseDto,
  RagCollectionsResponseDto,
  RagDocumentsResponseDto,
  RagTestQueryResponseDto,
  SpeakerEmbeddingResponseDto,
  SyncClientStatusDto,
  SyncGroupKeyStatusDto,
  TtsSpeechTestResponseDto,
} from '../EngineApiClient';
import type { LanSyncPairingPayload, SyncPairingPayload } from '../../sync/syncCloudTypes';

/**
 * The engine contract version these fixtures were captured against. MUST equal
 * {@link ENGINE_CONTRACT_VERSION} — the `engineContractConformance` canary fails
 * otherwise (bumping one side without the other is the deliberate-drift canary
 * the plan asks for).
 */
export const FIXTURE_CONTRACT_VERSION = '1.12.0';

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

/**
 * The engine's derived emotional view (A2). `intensity_label` carries the new
 * `>= 9.0 → "overwhelming"` string from the engine's `IntensityLabel()`; the
 * `intensity_labels` map covers all 8 Ekman names.
 */
export const emotionDerivedFixture: EmotionDerivedDto = {
  dominant_emotion: 'joy',
  dominant_intensity: 9.4,
  intensity_label: 'overwhelming',
  intensity_labels: {
    joy: 'overwhelming',
    sadness: 'neutral',
    trust: 'intense',
    disgust: 'neutral',
    fear: 'neutral',
    anger: 'neutral',
    surprise: 'neutral',
    anticipation: 'moderate',
  },
  active_dyads: [
    {
      keyword: 'affection',
      type: 'primary',
      source_emotions: ['joy', 'trust'],
      source_intensities: [9.4, 6.2],
      combined_intensity: 15.6,
      description: 'a warm sense of affection blooms in your heart',
    },
    {
      keyword: 'excitement',
      type: 'primary',
      source_emotions: ['joy', 'anticipation'],
      source_intensities: [9.4, 4.8],
      combined_intensity: 14.2,
      description: 'excitement bubbles up within you',
    },
  ],
  top_emotions: [
    { emotion: 'joy', intensity: 9.4, label: 'overwhelming' },
    { emotion: 'trust', intensity: 6.2, label: 'intense' },
    { emotion: 'anticipation', intensity: 4.8, label: 'moderate' },
  ],
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
  vocal_expressiveness: 'expressive',
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
  // Contract 1.8.0: a usable derived 256px preview exists. The list is
  // metadata-only — deliberately no `data_url`.
  thumbnail_state: 'ready',
  has_thumbnail: true,
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
  awaiting_group_key: false,
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
  emotion_derived: emotionDerivedFixture,
};

/** No live state: both keys present, both null. */
export const emotionEmptyFixture: EmotionResponseDto = {
  emotion_state: null,
  emotion_derived: null,
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

/**
 * One OpenCode Go provider account (contract 1.12.0). Same account shape as
 * every other type: the console key is required, `base_url` empty means the
 * engine's canonical endpoint (`https://opencode.ai/inference/go/openai/v1`).
 */
export const openCodeGoAccountFixture: ProviderAccountDto = {
  id: 'prov-og',
  type: 'opencodego',
  name: 'Go',
  api_key: 'redacted',
  base_url: '',
  extra: '{}',
  created_at: CREATED,
  updated_at: UPDATED,
  deleted_at: null,
};

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
    opencodego: [openCodeGoAccountFixture],
  },
};

/**
 * A Backend module config wired to the OpenCode Go account: the read is
 * COMPOSITE — the account half (`id`/`name`/`api_key`/`base_url`) merged with
 * this config's capability overlay under the `<provider>` key (plan §3.4).
 */
export const moduleConfigOpenCodeGoFixture: Record<string, unknown> = {
  id: 'mc-og',
  name: 'default',
  provider: 'opencodego',
  provider_account_id: 'prov-og',
  opencodego: {
    id: 'prov-og',
    type: 'opencodego',
    name: 'Go',
    api_key: 'redacted',
    base_url: '',
    model: 'deepseek-v4.1-flash',
    sampling_preset_name: '',
    temperature: 0.7,
    top_p: 1.0,
    frequency_penalty: 0,
    presence_penalty: 0,
    max_completion_tokens: 0,
    seed: 0,
    extra_params: '{}',
  },
};

/**
 * `POST /api/providers/models` sample for OpenCode Go (live discovery over
 * `GET https://opencode.ai/inference/go/v1/models`). Only `id` is mandatory;
 * the richer fields arrive as the discovery tier provides them.
 */
export const providerModelsOpenCodeGoFixture: ProviderModelsResponseDto = {
  models: [
    {
      id: 'deepseek-v4.1-flash',
      label: 'DeepSeek V4.1 Flash',
      context: 128000,
      output_limit: 8192,
      modalities: ['text'],
      capabilities: ['chat', 'tools'],
      param_support: ['temperature', 'max_tokens'],
      source: 'live',
      provenance: 'detected',
      meta: { provider: 'opencodego' },
    },
    {
      id: 'kimi-k2',
      label: 'Kimi K2',
      context: 131072,
      output_limit: 8192,
      modalities: ['text'],
      capabilities: ['chat'],
      source: 'live',
      provenance: 'detected',
    },
  ],
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

/**
 * `GET /api/providers/capabilities` (tier-2 catalog, phase 5-2) in the engine's
 * REAL shape (`providers/catalog.go:CapabilitiesPayload`): `meta` snapshot
 * metadata + `providers.<type>` slices carrying the model MAP, the canonical→wire
 * param map and strictness. The retired `catalog` / `param_mapping` keys are
 * deliberately absent — the app normalizes `providers` itself.
 */
const providerCapabilitiesFixture: ProviderCapabilitiesDto = {
  meta: {
    source: 'soulbits-tier2',
    license: 'CC-BY-4.0',
    license_notice: 'Model metadata aggregated from public provider documentation.',
    snapshot_date: '2026-11-01',
    snapshot_etag: '"3f2c1e0d7a4b"',
    snapshot_sha256:
      '9f2c1e0d7a4b6c8e5f3a1b2c4d6e8f0a1b3c5d7e9f0a2b4c6d8e0f1a3b5c7d9e',
    generator: 'harmony-link/2.4.0',
  },
  providers: {
    openai: {
      wire: {
        seed: { wire: 'seed', route: 'native' },
        max_completion_tokens: { wire: 'max_completion_tokens', route: 'native' },
        temperature: { wire: 'temperature', route: 'native' },
      },
      strict: false,
      strict_allowed: ['temperature', 'top_p'],
      temperature_max: 2,
      models: {
        'gpt-4o': {
          label: 'GPT-4o',
          family: 'gpt-4o',
          context: 128000,
          output_limit: 16384,
          modalities: ['text', 'image'],
          capabilities: ['chat', 'tools', 'vision'],
          param_support: ['temperature', 'max_tokens'],
          reasoning_effort: ['low', 'medium', 'high'],
          status: 'current',
          source: 'curated',
        },
      },
    },
    mistral: {
      wire: {
        // `extra` folds into the provider's extra params; `drop` has no wire
        // name (never forwarded) — the app must omit dropped routes.
        seed: { wire: 'random_seed', route: 'extra' },
        presence_penalty: { wire: '', route: 'drop' },
      },
      strict: true,
      models: {
        'mistral-large': {
          label: 'Mistral Large',
          context: 131072,
          modalities: ['text'],
          capabilities: ['chat'],
          status: 'current',
          source: 'tier2',
        },
      },
    },
    soulbitscloud: {
      models: {
        chatterbox: {
          label: 'Chatterbox',
          family: 'chatterbox',
          modalities: ['text', 'audio'],
          capabilities: ['text_to_speech'],
          speech_options: {
            operation_modes: ['single_speaker_tts', 'voice_cloning'],
            supports_voice_cloning: true,
            languages: ['en'],
          },
          status: 'current',
          source: 'curated',
        },
      },
    },
  },
};

/**
 * The kinded `audio_tags` block of ElevenLabs v3/v4 as the engine's catalog
 * seeds it (`providers/catalog_data.json`: 12 cues / 48 tones / 3 breaks, all
 * OPEN). Mirrors the engine's `cataloggen` count test so a drift in either
 * vocab shows up as a fixture diff.
 */
export const audioTagCapabilitiesElevenV3Fixture: AudioTagCapabilitiesDto = {
  syntax: '[{}]',
  cues: {
    mode: 'open',
    vocabulary: [
      'laughs',
      'chuckles',
      'giggles',
      'sighs',
      'gasps',
      'groaning',
      'coughing',
      'clears throat',
      'snorts',
      'exhales',
      'gulps',
      'wheezing',
    ],
  },
  tones: {
    mode: 'open',
    vocabulary: [
      'excited',
      'sad',
      'happy',
      'curious',
      'sarcastic',
      'whispers',
      'playful',
      'amazed',
      'powerful',
      'proud',
      'optimistic',
      'startled',
      'mad',
      'aggressive',
      'bitter',
      'critical',
      'repelled',
      'anxious',
      'stressed',
      'scared',
      'threatened',
      'vulnerable',
      'confused',
      'busy',
      'tired',
      'bored',
      'distant',
      'despair',
      'let down',
      'peaceful',
      'content',
      'thoughtful',
      'trusting',
      'shouts',
      'whispering',
      'dramatic',
      'deadpan',
      'softly',
      'quietly',
      'nervous',
      'hesitant',
      'worried',
      'upset',
      'sorrowful',
      'angry',
      'cheerfully',
      'awed',
      'elated',
    ],
  },
  breaks: {
    mode: 'open',
    vocabulary: ['pause', 'long pause', 'short pause'],
  },
};

/**
 * The kinded `audio_tags` block of Chatterbox Turbo: CLOSED cue/tonal
 * vocabularies (9 + 10) and NO breaks kind (absent ⇒ `none`). Both providers
 * (`soulbitscloud`, `soulvoice`) seed the same block.
 */
export const audioTagCapabilitiesChatterboxTurboFixture: AudioTagCapabilitiesDto = {
  syntax: '[{}]',
  cues: {
    mode: 'closed',
    vocabulary: [
      'laugh',
      'chuckle',
      'sigh',
      'gasp',
      'groan',
      'cough',
      'clear throat',
      'sniff',
      'shush',
    ],
  },
  tones: {
    mode: 'closed',
    vocabulary: [
      'angry',
      'fear',
      'surprised',
      'whispering',
      'advertisement',
      'dramatic',
      'narration',
      'crying',
      'happy',
      'sarcastic',
    ],
  },
};

/**
 * A tier-2 catalog slice carrying `audio_tags` rows, PLUS a tag-free row for
 * none-state assertions. Consumed by the capability accessor / conformance
 * tests of Phases 2-3 (additive on top of {@link providerCapabilitiesFixture}).
 */
export const providerCapabilitiesAudioTagsFixture: ProviderCapabilitiesDto = {
  providers: {
    elevenlabs: {
      models: {
        eleven_v3: {
          label: 'Eleven v3',
          family: 'eleven_v3',
          modalities: ['text', 'audio'],
          capabilities: ['text_to_speech'],
          speech_options: {
            operation_modes: ['single_speaker_tts'],
            paralinguistic_tags: ['[laughs]', '[sighs]', '[pause]'],
            supported_generation_params: ['stability', 'style', 'seed'],
            supports_voice_cloning: true,
          },
          audio_tags: audioTagCapabilitiesElevenV3Fixture,
          status: 'current',
          source: 'curated',
        },
        eleven_multilingual_v2: {
          label: 'Eleven Multilingual v2',
          family: 'eleven_multilingual',
          modalities: ['text', 'audio'],
          capabilities: ['text_to_speech'],
          speech_options: {
            operation_modes: ['single_speaker_tts'],
            // The de-tagged v2 family: speaks tags aloud, so it declares NO
            // kinded block and an EMPTY flat list.
            paralinguistic_tags: [],
            supported_generation_params: ['stability', 'style'],
          },
          status: 'current',
          source: 'curated',
        },
      },
    },
    soulbitscloud: {
      models: {
        chatterbox_turbo: {
          label: 'Chatterbox Turbo',
          family: 'chatterbox',
          modalities: ['text', 'audio'],
          capabilities: ['text_to_speech'],
          speech_options: {
            operation_modes: ['single_speaker_tts', 'voice_cloning'],
            supports_voice_cloning: true,
          },
          audio_tags: audioTagCapabilitiesChatterboxTurboFixture,
          status: 'current',
          source: 'curated',
        },
      },
    },
  },
};

const characterStatsFixture: CharacterStatsResponseDto = {
  stats: { 'ent-1': { likes: 3, chats: 5 } },
};

// ── TTS voice cloning / design (2-4 follow-up, contract 1.7.0) ─────────────
// Mirrors the engine-side canonical `speakerEmbedding` / `ttsSpeechTest` /
// `elevenLabsVoiceClone` / `elevenLabsVoiceDesign` fixtures. The engine answers
// these with `{status:"success", …}` envelopes; the DTOs keep `status` optional.
export const speakerEmbeddingFixture: SpeakerEmbeddingResponseDto = {
  status: 'success',
  data: 'AACAPwAAAEA=',
};

export const ttsSpeechTestFixture: TtsSpeechTestResponseDto = {
  status: 'success',
  audio_base64: 'UklGRg==',
  format: 'audio/mpeg',
  // tts-voice-ux Phase 3: the engine echoes the input and the EXACT
  // provider-bound string (`*asterisks*` → `[brackets]`).
  input_text: '*sighs* Well… *pause* I did not expect that.',
  text: '[sighs] Well… [short pause] I did not expect that.',
};

export const elevenLabsVoiceCloneFixture: ElevenLabsVoiceCloneResponseDto = {
  status: 'success',
  data: { voice_id: '21m00Tcm4TlvDq8ikWAM' },
};

export const elevenLabsVoiceDesignFixture: ElevenLabsVoiceDesignResponseDto = {
  status: 'success',
  data: {
    previews: [
      {
        generated_voice_id: 'gd-1',
        audio_base_64: 'UklGRg==',
        media_type: 'audio/mpeg',
        duration_secs: 2.4,
        language: 'en',
      },
    ],
    text: 'Hello there',
  },
};

// ── RAG collection browser (tts-voice-ux Phase 6) ──────────────────────────
// Mirrors `modules/rag/base.go:145-246` EXACTLY (camelCase JSON keys) and the
// route envelopes of `management/server.go:648-678` / `routes_rag.go`.
// `embedding` is deliberately small but present: the detail sheet must never
// render it, it only reports `embeddingDim`.

export const ragCollectionLoreFixture: CollectionInfoDto = {
  name: 'lore',
  documentCount: 2,
  lastUpdated: '2026-11-16T09:00:00Z',
  embeddingDim: 1536,
};

export const ragCollectionChatHistoryFixture: CollectionInfoDto = {
  name: 'chat_history',
  documentCount: 64,
  lastUpdated: '2026-11-17T08:30:00Z',
  embeddingDim: 1536,
};

export const ragCollectionsFixture: RagCollectionsResponseDto = {
  collections: [ragCollectionLoreFixture, ragCollectionChatHistoryFixture],
};

export const ragCollectionStatsFixture: CollectionStatsDto = {
  name: 'lore',
  totalDocuments: 2,
  archetypeBreakdown: { character: 1, place: 1 },
  categoryBreakdown: { character: { bio: 1 }, place: { world: 1 } },
  nameBreakdown: { 'The lighthouse keeper': 1, 'Harbor lighthouse': 1 },
  embeddingDimension: 1536,
  lastUpdated: '2026-11-16T09:00:00Z',
};

export const ragCollectionDetailFixture: RagCollectionDetailResponseDto = {
  info: ragCollectionLoreFixture,
  stats: ragCollectionStatsFixture,
};

export const ragDocumentLighthouseFixture: DocumentInfoDto = {
  id: 'doc-1',
  content: 'The lighthouse keeper has watched the harbor for thirty years.',
  metadata: { source: 'manual', entry_id: 'lore-1' },
  archetype: 'character',
  category: 'bio',
  name: 'The lighthouse keeper',
  createdAt: '2026-11-16T09:00:00Z',
};

export const ragDocumentHarborFixture: DocumentInfoDto = {
  id: 'doc-2',
  content: 'The harbor freezes over in late December.',
  metadata: { source: 'manual' },
  archetype: 'place',
  category: 'world',
  name: 'Harbor lighthouse',
  createdAt: '2026-11-16T09:05:00Z',
};

export const ragDocumentsFixture: RagDocumentsResponseDto = {
  documents: [ragDocumentLighthouseFixture, ragDocumentHarborFixture],
  total: 2,
};

export const ragDocumentDetailsFixture: DocumentDetailsDto = {
  ...ragDocumentLighthouseFixture,
  embedding: [0.012, -0.034, 0.056],
};

export const ragQueryResultFixture: QueryResultDto = {
  documentId: 'doc-1',
  content: 'The lighthouse keeper has watched the harbor for thirty years.',
  metadata: { source: 'manual', entry_id: 'lore-1' },
  similarity: 0.91,
  archetype: 'character',
  category: 'bio',
  name: 'The lighthouse keeper',
};

export const ragTestQueryFixture: RagTestQueryResponseDto = {
  query: 'who keeps the lighthouse?',
  results: [ragQueryResultFixture],
};

export const ragGroupsFixture: GroupedCollectionViewDto = {
  collectionName: 'lore',
  groups: {
    character: [
      {
        archetype: 'character',
        name: 'The lighthouse keeper',
        documentCount: 1,
        categories: { bio: 1 },
        lastUpdated: '2026-11-16T09:00:00Z',
      },
    ],
    place: [
      {
        archetype: 'place',
        name: 'Harbor lighthouse',
        documentCount: 1,
        categories: { world: 1 },
        lastUpdated: '2026-11-16T09:05:00Z',
      },
    ],
  },
  totalDocuments: 2,
  supported: true,
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
  messagesPage: messagesPageFixture,
  interaction: interactionFixture,
  interactionsPage: interactionsPageFixture,
  emojiAction: emojiActionFixture,
  emojiActions: emojiActionsFixture,
  emotion: emotionFixture,
  emotionState: emotionStateFixture,
  emotionDerived: emotionDerivedFixture,
  emotionEmpty: emotionEmptyFixture,
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
  openCodeGoAccount: openCodeGoAccountFixture,
  moduleConfigOpenCodeGo: moduleConfigOpenCodeGoFixture,
  providerModelsOpenCodeGo: providerModelsOpenCodeGoFixture,
  providerWrite: providerWriteFixture,
  providerRefresh: providerRefreshFixture,
  providerVerify: providerVerifyFixture,
  providerModels: providerModelsFixture,
  providerCapabilities: providerCapabilitiesFixture,
  providerCapabilitiesAudioTags: providerCapabilitiesAudioTagsFixture,
  audioTagCapabilitiesElevenV3: audioTagCapabilitiesElevenV3Fixture,
  audioTagCapabilitiesChatterboxTurbo: audioTagCapabilitiesChatterboxTurboFixture,
  speakerEmbedding: speakerEmbeddingFixture,
  ttsSpeechTest: ttsSpeechTestFixture,
  elevenLabsVoiceClone: elevenLabsVoiceCloneFixture,
  elevenLabsVoiceDesign: elevenLabsVoiceDesignFixture,
  ragCollections: ragCollectionsFixture,
  ragCollectionDetail: ragCollectionDetailFixture,
  ragCollectionStats: ragCollectionStatsFixture,
  ragDocuments: ragDocumentsFixture,
  ragDocumentDetails: ragDocumentDetailsFixture,
  ragTestQuery: ragTestQueryFixture,
  ragGroups: ragGroupsFixture,
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
