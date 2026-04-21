/**
 * Database Models for Harmony AI App
 * These interfaces exactly match the Go structs in Harmony Link's database/models.go
 * to ensure schema compatibility for data synchronization.
 */

// ============================================================================
// Core Entity & Character Models
// ============================================================================

export interface CharacterProfile {
  id: string;
  name: string;
  description: string | null;
  personality: string | null;
  appearance: string | null;
  backstory: string | null;
  voice_characteristics: string | null;
  base_prompt: string | null;
  scenario: string | null;
  example_dialogues: string | null;
  typing_speed_wpm: number;
  audio_response_chance_percent: number;
  vision_config_id: number | null;
  lifecycle_config: string | null; // Opaque JSON blob
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface Entity {
  id: string;
  alias: string; // Human-readable display name
  character_profile_id: string | null;
  lifecycle_config: string | null; // Opaque JSON blob
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface EntityModuleMapping {
  entity_id: string;
  backend_config_id: number | null;
  cognition_config_id: number | null;
  imagination_config_id: number | null;
  movement_config_id: number | null;
  rag_config_id: number | null;
  stt_config_id: number | null;
  tts_config_id: number | null;
  vision_config_id: number | null;
  deleted_at: Date | null;
}

// ============================================================================
// Provider Configuration Models
// ============================================================================

export interface OpenAIProviderConfig {
  id: number;
  name: string;
  api_key: string;
  model: string | null;
  max_tokens: number | null;
  temperature: number | null;
  top_p: number | null;
  n: number | null;
  stop_tokens: string | null; // JSON array
  embedding_model: string | null;
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
  id: number;
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
  deleted_at: Date | null;
}

export interface OpenAICompatibleProviderConfig {
  id: number;
  name: string;
  base_url: string;
  api_key: string | null;
  model: string | null;
  max_tokens: number | null;
  temperature: number | null;
  top_p: number | null;
  n: number | null;
  stop_tokens: string | null; // JSON array
  embedding_model: string | null;
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

export interface HarmonySpeechProviderConfig {
  id: number;
  name: string;
  endpoint: string;
  model: string | null;
  voice_config_file: string | null;
  format: string | null;
  sample_rate: number | null;
  stream: number | null;
  deleted_at: Date | null;
}

export interface ElevenLabsProviderConfig {
  id: number;
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

export interface KindroidProviderConfig {
  id: number;
  name: string;
  api_key: string;
  kindroid_id: string;
  deleted_at: Date | null;
}

export interface KajiwotoProviderConfig {
  id: number;
  name: string;
  username: string;
  password: string;
  room_url: string;
  deleted_at: Date | null;
}

export interface CharacterAIProviderConfig {
  id: number;
  name: string;
  api_token: string;
  chatroom_url: string;
  deleted_at: Date | null;
}

export interface LocalAIProviderConfig {
  id: number;
  name: string;
  embedding_model: string;
  deleted_at: Date | null;
}

export interface MistralProviderConfig {
  id: number;
  name: string;
  api_key: string;
  deleted_at: Date | null;
}

export interface OllamaProviderConfig {
  id: number;
  name: string;
  base_url: string;
  embedding_model: string | null;
  deleted_at: Date | null;
}

export interface ComfyUIProviderConfig {
  id: number;
  name: string;
  base_url: string;
  api_key: string;
  workflow_profiles: string;
  deleted_at: Date | null;
}

// ============================================================================
// Module Configuration Models
// ============================================================================

export interface BackendConfig {
  id: number;
  name: string;
  provider: string;
  provider_config_id: number;
  deleted_at: Date | null;
}

export interface MovementConfig {
  id: number;
  name: string;
  provider: string;
  provider_config_id: number;
  startup_sync_timeout: number | null;
  execution_threshold: number | null;
  deleted_at: Date | null;
}

export interface STTConfig {
  id: number;
  name: string;
  main_stream_time_millis: number | null;
  transition_stream_time_millis: number | null;
  max_buffer_count: number | null;
  transcription_provider: string;
  transcription_provider_config_id: number;
  vad_provider: string;
  vad_provider_config_id: number;
  deleted_at: Date | null;
}

export interface CognitionConfig {
  id: number;
  name: string;
  provider: string;
  provider_config_id: number;
  max_cognition_events: number | null;
  generate_expressions: number | null;
  deleted_at: Date | null;
}

export interface RAGConfig {
  id: number;
  name: string;
  provider: string;
  provider_config_id: number;
  embedding_concurrency: number | null;
  deleted_at: Date | null;
}

export interface TTSConfig {
  id: number;
  name: string;
  provider: string;
  provider_config_id: number;
  output_type: string | null;
  words_to_replace: string | null;
  vocalize_nonverbal: number | null;
  deleted_at: Date | null;
}

export interface VisionConfig {
  id: number;
  name: string;
  provider: string;
  provider_config_id: number;
  resolution_width: number;
  resolution_height: number;
  deleted_at: Date | null;
}

export interface ImaginationConfig {
  id: number;
  name: string;
  provider: string;
  provider_config_id: number;
  deleted_at: Date | null;
}

// ============================================================================
// Character Image Models
// ============================================================================

export interface CharacterImage {
  id: number;
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

// ============================================================================
// Sync & Chat Models
// ============================================================================

export interface SyncDevice {
  device_id: string;
  device_name: string;
  device_type: string;
  device_platform: string | null;
  is_approved: number;
  approval_requested_at: Date | null;
  approved_by_user_at: Date | null;
  last_sync_timestamp: number;
  last_sync_initiated_by: string;
  jwt_token: string | null;
  jwt_expires_at: number | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface SyncHistory {
  id: number;
  device_id: string;
  sync_started_at: Date;
  sync_completed_at: Date | null;
  records_sent: number;
  records_received: number;
  sync_status: string;
  error_message: string | null;
  created_at: Date;
  deleted_at: Date | null;
}

export interface ConversationMessage {
  id: string;
  entity_id: string;
  sender_entity_id: string;
  session_id: string | null;
  content: string;
  audio_duration: number | null;
  message_type: 'text' | 'audio' | 'combined' | 'image';

  // Audio storage (base64 encoded)
  audio_data?: string | null;
  audio_mime_type?: string | null;

  // Image fields (base64 encoded)
  image_data?: string | null;
  image_mime_type?: string | null;
  vl_model?: string | null;
  vl_model_interpretation?: string | null;

  // Emotional state and memory (Migrations 14-16)
  emotional_state_bits: number | 0; // Compact Ekman8 bitfield, opaque
  memory_id?: string | null; // FK to memories.id, opaque

  // Recon tracking (Migration 19)
  is_recon_followup: boolean;       // true if message originated from recon evaluation
  is_edited: boolean;              // true if message was edited via recon
  edit_of_message_id?: string | null; // references original message for edits

  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface CharacterImageInfo {
  id: number;
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

export type ProviderConfig =
  | OpenAIProviderConfig
  | OpenRouterProviderConfig
  | OpenAICompatibleProviderConfig
  | HarmonySpeechProviderConfig
  | ElevenLabsProviderConfig
  | KindroidProviderConfig
  | KajiwotoProviderConfig
  | CharacterAIProviderConfig
  | LocalAIProviderConfig
  | MistralProviderConfig
  | OllamaProviderConfig
  | ComfyUIProviderConfig;

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
