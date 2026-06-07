export interface FieldDefinition {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'select' | 'checkbox' | 'comma-list';
  placeholder?: string;
  tooltip?: string;
  step?: number;
  min?: number;
  max?: number;
  disabledValue?: number;
  options?: Array<{ id: string; name: string }>;
  required?: boolean;
  width?: 'full' | 'half';
}

export interface ProviderSchema {
  fields: FieldDefinition[];
  hasModelFetch?: boolean;
}

export const PROVIDER_SCHEMAS: Record<string, ProviderSchema> = {
  openai: {
    hasModelFetch: true,
    fields: [
      { key: 'name', label: 'Config Name', type: 'text', required: true },
      { key: 'api_key', label: 'API Key', type: 'password', required: true },
      { key: 'model', label: 'Model', type: 'text', placeholder: 'gpt-4o' },
      { key: 'sampling_preset_name', label: 'Sampling Preset', type: 'text', placeholder: 'Leave empty for manual', tooltip: 'Name of a preset on the Harmony Link server. Preset values are applied server-side.' },
      { key: 'max_tokens', label: 'Max Tokens', type: 'number', placeholder: '-1 for unlimited', disabledValue: -1 },
      { key: 'temperature', label: 'Temperature', type: 'number', step: 0.01, min: 0, max: 2 },
      { key: 'top_p', label: 'Top P', type: 'number', step: 0.01, min: 0, max: 1 },
      { key: 'frequency_penalty', label: 'Frequency Penalty', type: 'number', step: 0.01, min: -2, max: 2 },
      { key: 'presence_penalty', label: 'Presence Penalty', type: 'number', step: 0.01, min: -2, max: 2 },
      { key: 'max_completion_tokens', label: 'Max Completion Tokens', type: 'number', disabledValue: 0 },
      { key: 'seed', label: 'Seed', type: 'number', disabledValue: 0, tooltip: 'Set for reproducible outputs' },
      { key: 'stop_tokens', label: 'Stop Tokens', type: 'comma-list', placeholder: 'e.g. \\n, STOP' },
      { key: 'reasoning_effort', label: 'Reasoning Effort', type: 'select', options: [
        { id: '', name: 'Default' },
        { id: 'low', name: 'Low' },
        { id: 'medium', name: 'Medium' },
        { id: 'high', name: 'High' },
      ]},
      { key: 'voice', label: 'Voice', type: 'text', placeholder: 'alloy' },
      { key: 'speed', label: 'Speed', type: 'number', step: 0.1, min: 0.25, max: 4 },
      { key: 'format', label: 'Format', type: 'text', placeholder: 'mp3' },
      { key: 'n', label: 'Number of Images', type: 'number', placeholder: '1', tooltip: 'Used by Imagination module.' },
    ],
  },
  openaicompatible: {
    hasModelFetch: false,
    fields: [
      { key: 'name', label: 'Config Name', type: 'text', required: true },
      { key: 'base_url', label: 'Base URL', type: 'text', required: true, placeholder: 'http://localhost:8080/v1' },
      { key: 'api_key', label: 'API Key', type: 'password' },
      { key: 'model', label: 'Model', type: 'text', required: true },
      { key: 'sampling_preset_name', label: 'Sampling Preset', type: 'text', placeholder: 'Leave empty for manual', tooltip: 'Name of a preset on the Harmony Link server.' },
      { key: 'max_tokens', label: 'Max Tokens', type: 'number', disabledValue: -1 },
      { key: 'temperature', label: 'Temperature', type: 'number', step: 0.01, min: 0, max: 2 },
      { key: 'top_p', label: 'Top P', type: 'number', step: 0.01, min: 0, max: 1 },
      { key: 'top_k', label: 'Top K', type: 'number', disabledValue: 0 },
      { key: 'top_a', label: 'Top A', type: 'number', step: 0.01, disabledValue: 0 },
      { key: 'min_p', label: 'Min P', type: 'number', step: 0.01, disabledValue: 0 },
      { key: 'repetition_penalty', label: 'Repetition Penalty', type: 'number', step: 0.01, disabledValue: 0 },
      { key: 'frequency_penalty', label: 'Frequency Penalty', type: 'number', step: 0.01, min: -2, max: 2 },
      { key: 'presence_penalty', label: 'Presence Penalty', type: 'number', step: 0.01, min: -2, max: 2 },
      { key: 'max_completion_tokens', label: 'Max Completion Tokens', type: 'number', disabledValue: 0 },
      { key: 'seed', label: 'Seed', type: 'number', disabledValue: 0 },
      { key: 'response_format', label: 'Response Format', type: 'text', placeholder: 'JSON string or empty' },
      { key: 'stop_tokens', label: 'Stop Tokens', type: 'comma-list' },
    ],
  },
  openrouter: {
    hasModelFetch: false,
    fields: [
      { key: 'name', label: 'Config Name', type: 'text', required: true },
      { key: 'api_key', label: 'API Key', type: 'password', required: true },
      { key: 'model', label: 'Model', type: 'text', required: true, placeholder: 'google/gemini-flash-2.5' },
      { key: 'sampling_preset_name', label: 'Sampling Preset', type: 'text', placeholder: 'Leave empty for manual', tooltip: 'Name of a preset on the Harmony Link server.' },
      { key: 'max_tokens', label: 'Max Tokens', type: 'number', disabledValue: -1 },
      { key: 'temperature', label: 'Temperature', type: 'number', step: 0.01, min: 0, max: 2 },
      { key: 'top_p', label: 'Top P', type: 'number', step: 0.01, min: 0, max: 1 },
      { key: 'top_k', label: 'Top K', type: 'number', disabledValue: 0 },
      { key: 'top_a', label: 'Top A', type: 'number', step: 0.01, disabledValue: 0 },
      { key: 'min_p', label: 'Min P', type: 'number', step: 0.01, disabledValue: 0 },
      { key: 'repetition_penalty', label: 'Repetition Penalty', type: 'number', step: 0.01, disabledValue: 0 },
      { key: 'frequency_penalty', label: 'Frequency Penalty', type: 'number', step: 0.01, min: -2, max: 2 },
      { key: 'presence_penalty', label: 'Presence Penalty', type: 'number', step: 0.01, min: -2, max: 2 },
      { key: 'max_completion_tokens', label: 'Max Completion Tokens', type: 'number', disabledValue: 0 },
      { key: 'seed', label: 'Seed', type: 'number', disabledValue: 0 },
      { key: 'response_format', label: 'Response Format', type: 'text' },
      { key: 'stop_tokens', label: 'Stop Tokens', type: 'comma-list' },
      { key: 'voice', label: 'Voice', type: 'text', placeholder: 'alloy', tooltip: 'Used by TTS module.' },
      { key: 'speed', label: 'Speed', type: 'number', step: 0.1, min: 0.25, max: 4, tooltip: 'Used by TTS module.' },
      { key: 'format', label: 'Format', type: 'text', placeholder: 'mp3', tooltip: 'Used by TTS module.' },
      { key: 'image_aspect_ratio', label: 'Image Aspect Ratio', type: 'text', placeholder: '1:1', tooltip: 'Used by Imagination module.' },
      { key: 'image_size', label: 'Image Size', type: 'text', placeholder: '1024x1024', tooltip: 'Used by Imagination module.' },
    ],
  },
  elevenlabs: {
    hasModelFetch: false,
    fields: [
      { key: 'name', label: 'Config Name', type: 'text', required: true },
      { key: 'api_key', label: 'API Key', type: 'password', required: true },
      { key: 'voice_id', label: 'Voice ID', type: 'text', placeholder: '21m00Tcm4TlvDq8ikWAM' },
      { key: 'model_id', label: 'Model ID', type: 'text', placeholder: 'eleven_monolingual_v1' },
      { key: 'stability', label: 'Stability', type: 'number', step: 0.01, min: 0, max: 1 },
      { key: 'similarity_boost', label: 'Similarity Boost', type: 'number', step: 0.01, min: 0, max: 1 },
      { key: 'style', label: 'Style', type: 'number', step: 0.01, min: 0, max: 1 },
      { key: 'speaker_boost', label: 'Speaker Boost', type: 'number', step: 1, min: 0, max: 1 },
    ],
  },
  harmonyspeech: {
    hasModelFetch: false,
    fields: [
      { key: 'name', label: 'Config Name', type: 'text', required: true },
      { key: 'endpoint', label: 'Endpoint URL', type: 'text', required: true, placeholder: 'http://localhost:5000' },
      { key: 'model', label: 'Model', type: 'text' },
      { key: 'voice_config_file', label: 'Voice Config File', type: 'text' },
      { key: 'format', label: 'Format', type: 'text', placeholder: 'wav' },
      { key: 'sample_rate', label: 'Sample Rate', type: 'number', placeholder: '22050' },
      { key: 'stream', label: 'Stream', type: 'number', step: 1, min: 0, max: 1 },
    ],
  },
  kindroid: {
    hasModelFetch: false,
    fields: [
      { key: 'name', label: 'Config Name', type: 'text', required: true },
      { key: 'api_key', label: 'API Key', type: 'password', required: true },
      { key: 'kindroid_id', label: 'Kindroid ID', type: 'text', required: true },
    ],
  },
  kajiwoto: {
    hasModelFetch: false,
    fields: [
      { key: 'name', label: 'Config Name', type: 'text', required: true },
      { key: 'username', label: 'Username', type: 'text', required: true },
      { key: 'password', label: 'Password', type: 'password', required: true },
      { key: 'room_url', label: 'Room URL', type: 'text' },
    ],
  },
  characterai: {
    hasModelFetch: false,
    fields: [
      { key: 'name', label: 'Config Name', type: 'text', required: true },
      { key: 'api_token', label: 'API Token', type: 'password', required: true },
      { key: 'chatroom_url', label: 'Chatroom URL', type: 'text' },
    ],
  },
  localai: {
    hasModelFetch: false,
    fields: [
      { key: 'name', label: 'Config Name', type: 'text', required: true },
      { key: 'model', label: 'Model', type: 'text' },
    ],
  },
  mistral: {
    hasModelFetch: false,
    fields: [
      { key: 'name', label: 'Config Name', type: 'text', required: true },
      { key: 'api_key', label: 'API Key', type: 'password', required: true },
    ],
  },
  ollama: {
    hasModelFetch: false,
    fields: [
      { key: 'name', label: 'Config Name', type: 'text', required: true },
      { key: 'base_url', label: 'Base URL', type: 'text', required: true, placeholder: 'http://localhost:11434' },
      { key: 'model', label: 'Model', type: 'text' },
    ],
  },
  comfyui: {
    hasModelFetch: false,
    fields: [
      { key: 'name', label: 'Config Name', type: 'text', required: true },
      { key: 'base_url', label: 'Base URL', type: 'text', required: true, placeholder: 'http://localhost:8188' },
      { key: 'api_key', label: 'API Key', type: 'password' },
      { key: 'workflow_profiles', label: 'Workflow Profiles', type: 'text', placeholder: 'JSON string' },
    ],
  },
  google: {
    hasModelFetch: false,
    fields: [
      { key: 'name', label: 'Config Name', type: 'text', required: true },
      { key: 'api_key', label: 'API Key', type: 'password', required: true },
      { key: 'model', label: 'Model', type: 'text', placeholder: 'gemini-2.5-flash' },
      { key: 'sampling_preset_name', label: 'Sampling Preset', type: 'text', placeholder: 'Leave empty for manual', tooltip: 'Name of a preset on the Harmony Link server.' },
      { key: 'max_output_tokens', label: 'Max Output Tokens', type: 'number', disabledValue: 0 },
      { key: 'temperature', label: 'Temperature', type: 'number', step: 0.01, min: 0, max: 2 },
      { key: 'top_p', label: 'Top P', type: 'number', step: 0.01, min: 0, max: 1 },
      { key: 'top_k', label: 'Top K', type: 'number', disabledValue: 0 },
      { key: 'stop_tokens', label: 'Stop Tokens', type: 'comma-list' },
      { key: 'response_mime_type', label: 'Response MIME Type', type: 'text', placeholder: 'application/json or empty' },
      { key: 'number_of_images', label: 'Number of Images', type: 'number', placeholder: '1', tooltip: 'Used by Imagination module.' },
      { key: 'aspect_ratio', label: 'Aspect Ratio', type: 'select', tooltip: 'Used by Imagination module.', options: [
        { id: '', name: 'Default' },
        { id: '1:1', name: '1:1 (Square)' },
        { id: '16:9', name: '16:9 (Landscape)' },
        { id: '9:16', name: '9:16 (Portrait)' },
        { id: '4:3', name: '4:3' },
        { id: '3:4', name: '3:4' },
      ]},
    ],
  },
  xai: {
    hasModelFetch: false,
    fields: [
      { key: 'name', label: 'Config Name', type: 'text', required: true },
      { key: 'api_key', label: 'API Key', type: 'password', required: true },
      { key: 'model', label: 'Model', type: 'text', placeholder: 'grok-3' },
      { key: 'sampling_preset_name', label: 'Sampling Preset', type: 'text', placeholder: 'Leave empty for manual', tooltip: 'Name of a preset on the Harmony Link server.' },
      { key: 'max_tokens', label: 'Max Tokens', type: 'number', disabledValue: -1 },
      { key: 'temperature', label: 'Temperature', type: 'number', step: 0.01, min: 0, max: 2 },
      { key: 'top_p', label: 'Top P', type: 'number', step: 0.01, min: 0, max: 1 },
      { key: 'frequency_penalty', label: 'Frequency Penalty', type: 'number', step: 0.01, min: -2, max: 2 },
      { key: 'presence_penalty', label: 'Presence Penalty', type: 'number', step: 0.01, min: -2, max: 2 },
      { key: 'max_completion_tokens', label: 'Max Completion Tokens', type: 'number', disabledValue: 0 },
      { key: 'seed', label: 'Seed', type: 'number', disabledValue: 0 },
      { key: 'response_format', label: 'Response Format', type: 'text' },
      { key: 'reasoning_effort', label: 'Reasoning Effort', type: 'select', options: [
        { id: '', name: 'Default' },
        { id: 'low', name: 'Low' },
        { id: 'medium', name: 'Medium' },
        { id: 'high', name: 'High' },
      ]},
      { key: 'stop_tokens', label: 'Stop Tokens', type: 'comma-list' },
      { key: 'image_aspect_ratio', label: 'Image Aspect Ratio', type: 'select', tooltip: 'Used by Imagination module.', options: [
        { id: '', name: 'Default' },
        { id: '1:1', name: '1:1 (Square)' },
        { id: '16:9', name: '16:9 (Landscape)' },
        { id: '9:16', name: '9:16 (Portrait)' },
      ]},
      { key: 'image_resolution', label: 'Image Resolution', type: 'text', placeholder: '1024x1024', tooltip: 'Used by Imagination module.' },
    ],
  },
  anthropic: {
    hasModelFetch: false,
    fields: [
      { key: 'name', label: 'Config Name', type: 'text', required: true },
      { key: 'api_key', label: 'API Key', type: 'password', required: true },
      { key: 'model', label: 'Model', type: 'text', placeholder: 'claude-sonnet-4-20250514' },
      { key: 'sampling_preset_name', label: 'Sampling Preset', type: 'text', placeholder: 'Leave empty for manual', tooltip: 'Name of a preset on the Harmony Link server.' },
      { key: 'max_tokens', label: 'Max Tokens', type: 'number', required: true, placeholder: '4096' },
      { key: 'temperature', label: 'Temperature', type: 'number', step: 0.01, min: 0, max: 1 },
      { key: 'top_p', label: 'Top P', type: 'number', step: 0.01, min: 0, max: 1 },
      { key: 'top_k', label: 'Top K', type: 'number', disabledValue: 0 },
      { key: 'stop_sequences', label: 'Stop Sequences', type: 'comma-list' },
    ],
  },
};
