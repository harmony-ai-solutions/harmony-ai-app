/**
 * Database Models for Soulbits App
 * These interfaces exactly match the Go structs in Soulbits Engine's database/models.go
 * to ensure schema compatibility for data synchronization.
 */

import type { EmotionEffect, MetabolismVector } from '../types/emoji';

// ============================================================================
// Core Entity & Character Models
// ============================================================================

export interface CharacterProfile {
  id: string;
  name: string;
  description: string;
  personality: string;
  voice_characteristics: string;
  base_prompt: string;
  scenario: string;
  typing_speed_wpm: number;
  audio_response_chance_percent: number;
  vision_config_id: string | null;
  lifecycle_config: string; // Opaque JSON blob
  // Character Card V3 standard fields (migration 000037). Columns are NOT NULL
  // DEFAULT '' (absent = empty string, never null). Optional (`?`) only because
  // some in-memory construction sites predate these fields; persisted rows and
  // engine-synced rows always carry them.
  first_mes?: string;
  mes_example?: string;
  alternate_greetings?: string; // JSON []
  post_history_instructions?: string;
  creator_notes?: string;
  creator?: string;
  character_version?: string;
  nickname?: string;
  tags?: string; // JSON []
  group_only_greetings?: string; // JSON []
  extensions?: string; // JSON {}
  assets?: string; // JSON []
  card_provenance?: string; // JSON {}
  character_book?: string; // JSON {}
  // Favorite flag (migration 000044): replaced the favorites sidecar table.
  // 0/1 number (same convention as Entity's is_muted/is_disabled) — NO
  // boolean normalization, it rides the profile sync row as a JSON number.
  // Optional (`?`) because some in-memory construction sites predate the column;
  // persisted / synced rows always carry it.
  is_favorite?: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface Entity {
  id: string;
  alias: string; // Human-readable display name
  character_profile_id: string | null;
  lifecycle_config: string | null; // Opaque JSON blob
  rag_reindex_required: number; // 0 or 1 flag for RAG vector store re-index
  // Entity typing / flags (migration 000042). `entity_type` = 'ai' | 'user'
  // (Q9); `is_muted` / `is_disabled` are 0/1 flags (Q8). Optional (`?`) only
  // because some in-memory construction sites predate these columns — the same
  // convention as CharacterProfile's V3 fields; persisted / synced rows always
  // carry them.
  entity_type?: string;
  is_muted?: number;
  is_disabled?: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface EntityModuleMapping {
  entity_id: string;
  backend_config_id: string | null;
  cognition_config_id: string | null;
  imagination_config_id: string | null;
  movement_config_id: string | null;
  rag_config_id: string | null;
  stt_config_id: string | null;
  tts_config_id: string | null;
  vision_config_id: string | null;
  deleted_at: Date | null;
}

// ============================================================================
// Provider Configuration Models
// ============================================================================

export interface OpenAIProviderConfig {
  id: string;
  name: string;
  api_key: string;
  model: string | null;
  max_tokens: number | null;
  temperature: number | null;
  top_p: number | null;
  n: number | null;
  stop_tokens: string | null; // JSON array
  voice: string | null;
  speed: number | null;
  format: string | null;
  // New LLM params (Migration 20)
  frequency_penalty: number | null;
  presence_penalty: number | null;
  max_completion_tokens: number | null;
  seed: number | null;
  response_format: string | null; // JSON string
  reasoning_effort: string | null;
  top_k: number | null;
  top_a: number | null;
  min_p: number | null;
  repetition_penalty: number | null;
  sampling_preset_name: string;
  extra_params: string; // JSON string e.g. '{"typical_p": 0.95}'
  deleted_at: Date | null;
}

export interface OpenRouterProviderConfig {
  id: string;
  name: string;
  api_key: string;
  model: string | null;
  max_tokens: number | null;
  temperature: number | null;
  top_p: number | null;
  n: number | null;
  stop_tokens: string | null; // JSON array
  // New LLM params (Migration 20)
  frequency_penalty: number | null;
  presence_penalty: number | null;
  max_completion_tokens: number | null;
  seed: number | null;
  response_format: string | null; // JSON string
  top_k: number | null;
  top_a: number | null;
  min_p: number | null;
  repetition_penalty: number | null;
  sampling_preset_name: string;
  extra_params: string; // JSON string e.g. '{"typical_p": 0.95}'
  // Provider expansion fields (Migration 30)
  voice: string | null;
  speed: number | null;
  format: string | null;
  image_aspect_ratio: string | null;
  image_size: string | null;
  deleted_at: Date | null;
}

export interface OpenAICompatibleProviderConfig {
  id: string;
  name: string;
  base_url: string;
  api_key: string | null;
  model: string | null;
  max_tokens: number | null;
  temperature: number | null;
  top_p: number | null;
  n: number | null;
  stop_tokens: string | null; // JSON array
  // New LLM params (Migration 20)
  frequency_penalty: number | null;
  presence_penalty: number | null;
  max_completion_tokens: number | null;
  seed: number | null;
  response_format: string | null; // JSON string
  top_k: number | null;
  top_a: number | null;
  min_p: number | null;
  repetition_penalty: number | null;
  sampling_preset_name: string;
  extra_params: string; // JSON string e.g. '{"typical_p": 0.95}'
  deleted_at: Date | null;
}

export interface SoulvoiceProviderConfig {
  id: string;
  name: string;
  endpoint: string;
  api_key: string;
  model: string | null;
  voice_config_file: string | null;
  format: string | null;
  sample_rate: number | null;
  stream: number | null;
  deleted_at: Date | null;
}

export interface ElevenLabsProviderConfig {
  id: string;
  name: string;
  api_key: string;
  voice_id: string | null;
  model_id: string | null;
  stability: number | null;
  similarity_boost: number | null;
  style: number | null;
  speaker_boost: number | null;
  deleted_at: Date | null;
}

export interface LocalAIProviderConfig {
  id: string;
  name: string;
  model: string;
  deleted_at: Date | null;
}

export interface MistralProviderConfig {
  id: string;
  name: string;
  api_key: string;
  deleted_at: Date | null;
}

export interface OllamaProviderConfig {
  id: string;
  name: string;
  base_url: string;
  model: string | null;
  deleted_at: Date | null;
}

export interface ComfyUIProviderConfig {
  id: string;
  name: string;
  base_url: string;
  api_key: string;
  workflow_profiles: string;
  deleted_at: Date | null;
}

export interface XAIProviderConfig {
  id: string;
  name: string;
  api_key: string;
  model: string | null;
  max_tokens: number | null;
  max_completion_tokens: number | null;
  temperature: number | null;
  top_p: number | null;
  frequency_penalty: number | null;
  presence_penalty: number | null;
  n: number | null;
  stop_tokens: string | null; // JSON array
  seed: number | null;
  response_format: string | null;
  reasoning_effort: string | null;
  sampling_preset_name: string;
  extra_params: string; // JSON string
  image_aspect_ratio: string | null;
  image_resolution: string | null;
  deleted_at: Date | null;
}

export interface GoogleProviderConfig {
  id: string;
  name: string;
  api_key: string;
  model: string | null;
  max_output_tokens: number | null;
  temperature: number | null;
  top_p: number | null;
  top_k: number | null;
  stop_tokens: string | null; // JSON array
  seed: number | null;
  response_mime_type: string | null;
  sampling_preset_name: string;
  extra_params: string; // JSON string
  number_of_images: number | null;
  aspect_ratio: string | null;
  deleted_at: Date | null;
}

export interface AnthropicProviderConfig {
  id: string;
  name: string;
  api_key: string;
  model: string | null;
  max_tokens: number | null;
  temperature: number | null;
  top_p: number | null;
  top_k: number | null;
  stop_sequences: string | null; // JSON array
  sampling_preset_name: string;
  extra_params: string; // JSON string
  deleted_at: Date | null;
}

export interface SoulbitsCloudProviderConfig {
  id: string;
  name: string;
  base_url: string;
  api_key: string;
  model: string | null;
  max_tokens: number | null;
  max_completion_tokens: number | null;
  temperature: number | null;
  top_p: number | null;
  frequency_penalty: number | null;
  presence_penalty: number | null;
  n: number | null;
  stop_tokens: string | null; // JSON array
  seed: number | null;
  response_format: string | null; // JSON string
  sampling_preset_name: string;
  extra_params: string; // JSON string
  voice: string | null;
  language: string | null;
  speed: number | null;
  format: string | null;
  image_aspect_ratio: string | null;
  image_size: string | null;
  deleted_at: Date | null;
}

// ============================================================================
// Provider Account Model (provider-registry Option B / plan §3.1)
// ============================================================================

/**
 * A shared provider account — one row per real credential (name, api_key,
 * base_url, typed `extra`) that many module configs reference. Capability
 * fields (model, sampling, …) do NOT live here; they live on the module config's
 * `capability_json` overlay (plan §3.2). Backs the accounts API in
 * `services/engine/repositories/providers.ts`. `created_at`/`updated_at` are
 * coerced from the engine's RFC3339 strings to `Date` at the repo boundary.
 */
export interface ProviderAccount {
  id: string;
  /** One of the 13 surviving provider types. */
  type: string;
  name: string;
  /** Empty string == keyless self-hosted. */
  api_key: string;
  /** Empty string == the provider's canonical default endpoint. */
  base_url: string;
  /** Typed account-level extras (headers, auth style, fingerprint) as JSON. */
  extra: string;
  created_at: Date | null;
  updated_at: Date | null;
  deleted_at: Date | null;
}

// ============================================================================
// Module Configuration Models
// ============================================================================
//
// Interim dual shape (provider-registry 6-1): the legacy flat `provider_config_id`
// FK REMAINS (the legacy provider adapter still maps it) alongside the new
// `provider_account_id` FK + `capability_json` overlay (plan §3.2). The adapter
// maps between the two so the module-config screens keep compiling/functioning
// until 6-3 removes the legacy consumption.

export interface BackendConfig {
  id: string;
  name: string;
  provider: string;
  provider_config_id: string | null;
  provider_account_id: string | null;
  capability_json: string; // JSON string (capability overlay)
  deleted_at: Date | null;
}

export interface MovementConfig {
  id: string;
  name: string;
  provider: string;
  provider_config_id: string | null;
  provider_account_id: string | null;
  capability_json: string;
  startup_sync_timeout: number | null;
  execution_threshold: number | null;
  deleted_at: Date | null;
}

export interface STTConfig {
  id: string;
  name: string;
  main_stream_time_millis: number | null;
  transition_stream_time_millis: number | null;
  max_buffer_count: number | null;
  transcription_provider: string;
  transcription_provider_config_id: string | null;
  transcription_provider_account_id: string | null;
  transcription_capability_json: string;
  vad_provider: string;
  vad_provider_config_id: string | null;
  vad_provider_account_id: string | null;
  vad_capability_json: string;
  deleted_at: Date | null;
}

export interface CognitionConfig {
  id: string;
  name: string;
  provider: string;
  provider_config_id: string | null;
  provider_account_id: string | null;
  capability_json: string;
  max_cognition_events: number | null;
  generate_expressions: number | null;
  deleted_at: Date | null;
}

export interface RAGConfig {
  id: string;
  name: string;
  provider: string;
  provider_config_id: string | null;
  provider_account_id: string | null;
  capability_json: string;
  embedding_concurrency: number | null;
  deleted_at: Date | null;
}

export interface TTSConfig {
  id: string;
  name: string;
  provider: string;
  provider_config_id: string | null;
  provider_account_id: string | null;
  capability_json: string;
  output_type: string | null;
  words_to_replace: string | null;
  vocalize_nonverbal: number | null;
  deleted_at: Date | null;
}

export interface VisionConfig {
  id: string;
  name: string;
  provider: string;
  provider_config_id: string | null;
  provider_account_id: string | null;
  capability_json: string;
  resolution_width: number;
  resolution_height: number;
  deleted_at: Date | null;
}

export interface ImaginationConfig {
  id: string;
  name: string;
  provider: string;
  provider_config_id: string | null;
  provider_account_id: string | null;
  capability_json: string;
  deleted_at: Date | null;
}

// ============================================================================
// Character Image Models
// ============================================================================

export interface CharacterImage {
  id: string;
  character_profile_id: string;
  image_data: string; // Base64 encoded image
  mime_type: string;
  description: string;
  is_primary: boolean;
  display_order: number;
  vl_model_interpretation: string;
  vl_model: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface Interaction {
  id: string;
  entity_id: string;
  interaction_scope: string;
  participant_key: string | null;
  participant_ids: string;
  status: string;
  started_at: string;
  last_activity_at: string;
  ended_at: string | null;
  memory_id: string | null;
  continued_interaction_id: string | null;
  metadata: string | null;
  summary: string | null;
  presence_type: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ConversationMessage {
  id: string;
  entity_id: string;
  sender_entity_id: string;
  interaction_id: string | null;
  content: string;
  audio_duration: number | null;
  message_type: 'text' | 'audio' | 'combined' | 'image' | 'greeting';

  // Audio storage (base64 encoded)
  audio_data?: string | null;
  audio_mime_type?: string | null;

  // Image fields (base64 encoded)
  image_data?: string | null;
  image_mime_type?: string | null;
  vl_model?: string | null;
  vl_model_interpretation?: string | null;

  // Emotional state (Migrations 14-16)
  emotional_state_bits: number | 0; // Compact Ekman8 bitfield, opaque

  // Recon tracking (Migration 19)
  is_recon_followup: boolean;       // true if message originated from recon evaluation
  is_edited: boolean;              // true if message was edited via recon
  edit_of_message_id?: string | null; // references original message for edits

  // Message actions (Migration 46)
  reactions_json?: string | null;   // JSON array of emoji reaction strings, e.g. '["❤️","👍"]'
  reply_to_message_id?: string | null; // references the message this one replies to (dormant — UI gated off)
  is_pinned?: boolean;              // true if the message is pinned

  // Read flag (Migration 41 / A2): 0/1, born 0, written ONLY by the app read
  // action. "The counterpart has read it" per-record.
  is_read?: boolean;

  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface CharacterImageInfo {
  id: string;
  character_profile_id: string;
  mime_type: string;
  description: string;
  is_primary: boolean;
  display_order: number;
  data_url: string; // Base64 data URL for frontend
  created_at: Date;
}

// ============================================================================
// Helper Types for Database Operations
// ============================================================================

/**
 * Any provider-config shape the app reads/writes. During the interim (6-1) this
 * spans BOTH the legacy per-type flat configs (still produced by the legacy
 * provider adapter) AND the new account-shaped row (`ProviderAccount`) the
 * accounts API returns.
 */
export type ProviderConfig =
  | OpenAIProviderConfig
  | OpenRouterProviderConfig
  | OpenAICompatibleProviderConfig
  | SoulvoiceProviderConfig
  | ElevenLabsProviderConfig
  | LocalAIProviderConfig
  | MistralProviderConfig
  | OllamaProviderConfig
  | ComfyUIProviderConfig
  | XAIProviderConfig
  | GoogleProviderConfig
  | AnthropicProviderConfig
  | SoulbitsCloudProviderConfig
  | ProviderAccount;

export type ModuleConfig =
  | BackendConfig
  | MovementConfig
  | STTConfig
  | CognitionConfig
  | RAGConfig
  | TTSConfig
  | VisionConfig
  | ImaginationConfig;

// ============================================================================
// Inner Life Models (Migrations 14-16)
// ============================================================================

export interface EmotionState {
  entity_id: string;

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

  joy_crystallize_start: Date | null;
  sadness_crystallize_start: Date | null;
  trust_crystallize_start: Date | null;
  disgust_crystallize_start: Date | null;
  fear_crystallize_start: Date | null;
  anger_crystallize_start: Date | null;
  surprise_crystallize_start: Date | null;
  anticipation_crystallize_start: Date | null;

  last_update: Date;
  decay_tau: number;
  high_threshold: number;
  low_threshold: number;
  crystallize_intensity: number;
  crystallize_min_hours: number;

  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface LifecycleState {
  entity_id: string;
  exhaustion: number;
  sleeping: boolean;
  sleep_start_time: number | null; // unix seconds
  last_beat_at: number | null; // unix seconds
  last_outreach_at: number | null; // unix seconds (N1-A: outreach cooldown)
  inner_monologue: string; // JSON array of last-N entries
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface Memory {
  id: string;
  entity_id: string;
  compaction_level: number;
  content: string;
  emotional_state_bits: number;
  start_date: Date | null;
  end_date: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface EmojiAction {
  id: string;
  entityId: string;
  emojiNative: string;
  emotionEffect: EmotionEffect | null;
  metabolismVector: MetabolismVector | null;
  substitutionText: string | null;
  autoGenerated: boolean;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}
