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
  created_at: Date;
  updated_at: Date;
}

export interface Entity {
  id: string;
  character_profile_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface EntityModuleMapping {
  entity_id: string;
  backend_config_id: number | null;
  cognition_config_id: number | null;
  movement_config_id: number | null;
  rag_config_id: number | null;
  stt_config_id: number | null;
  tts_config_id: number | null;
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
}

export interface KindroidProviderConfig {
  id: number;
  name: string;
  api_key: string;
  kindroid_id: string;
}

export interface KajiwotoProviderConfig {
  id: number;
  name: string;
  username: string;
  password: string;
  room_url: string;
}

export interface CharacterAIProviderConfig {
  id: number;
  name: string;
  api_token: string;
  chatroom_url: string;
}

export interface LocalAIProviderConfig {
  id: number;
  name: string;
  embedding_model: string;
}

export interface MistralProviderConfig {
  id: number;
  name: string;
  api_key: string;
}

export interface OllamaProviderConfig {
  id: number;
  name: string;
  base_url: string;
  embedding_model: string | null;
}

// ============================================================================
// Module Configuration Models
// ============================================================================

export interface BackendConfig {
  id: number;
  name: string;
  provider: string;
  provider_config_id: number;
}

export interface MovementConfig {
  id: number;
  name: string;
  provider: string;
  provider_config_id: number;
  startup_sync_timeout: number | null;
  execution_threshold: number | null;
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
}

export interface CognitionConfig {
  id: number;
  name: string;
  provider: string;
  provider_config_id: number;
  max_cognition_events: number | null;
  generate_expressions: number | null;
}

export interface RAGConfig {
  id: number;
  name: string;
  provider: string;
  provider_config_id: number;
  embedding_concurrency: number | null;
}

export interface TTSConfig {
  id: number;
  name: string;
  provider: string;
  provider_config_id: number;
  output_type: string | null;
  words_to_replace: string | null;
  vocalize_nonverbal: number | null;
}

// ============================================================================
// Character Image Models
// ============================================================================

export interface CharacterImage {
  id: number;
  character_profile_id: string;
  image_data: Uint8Array; // BLOB data
  mime_type: string;
  description: string;
  is_primary: boolean;
  display_order: number;
  vl_model_interpretation: string;
  vl_model: string;
  vl_model_embedding: Uint8Array | null; // BLOB data
  created_at: Date;
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
  | OllamaProviderConfig;

export type ModuleConfig =
  | BackendConfig
  | MovementConfig
  | STTConfig
  | CognitionConfig
  | RAGConfig
  | TTSConfig;
