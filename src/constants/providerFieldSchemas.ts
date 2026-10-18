/**
 * providerFieldSchemas — CAPABILITY-only provider form fields.
 *
 * provider-registry 6-2 owns the account-vs-capability schema split (plan
 * §3.2). Account-scoped fields (`name`, `api_key`, `base_url`/`endpoint`, and
 * the typed account extras) now live in `accountFieldSchemas.ts`; this module
 * carries ONLY the **capability** fields (model + sampling params + provider
 * params) that plan §3.2 moves onto a module config's capability overlay.
 *
 * `ModuleConfigEditScreen` composes the two: its Credentials section reads
 * `accountFieldSchemas.ts`, its Capability section reads this module. 6-3
 * consumes the capability-only view directly for the reworked flow.
 *
 * (2-2's `providerFieldSections.ts` remains the key→section classifier used by
 * the interim module-config screen to keep account extras out of the
 * capability form.)
 */

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
  /**
   * Render the field read-only (managed/engine-owned values). `FormField`
   * honours this for text/number/checkbox inputs; the account form also forces
   * read-only for system-managed account types.
   */
  readOnly?: boolean;
  /**
   * Marks a field as catalog-backed. The form renderer routes such fields
   * through the model picker (`CatalogModelSelect`) — fed by the engine's
   * capability registry + live discovery (provider-registry 6-3). Only the
   * `model` field uses this today.
   */
  catalog?: boolean;
}

export interface ProviderSchema {
  fields: FieldDefinition[];
  hasModelFetch?: boolean;
}

/**
 * Capability-only provider field schemas (account fields removed — see the
 * module docblock). Keys match the 13 surviving provider types.
 */
export const PROVIDER_SCHEMAS: Record<string, ProviderSchema> = {
  openai: {
    hasModelFetch: true,
    fields: [
      { key: 'model', label: 'Model', type: 'text', placeholder: 'gpt-4o', catalog: true },
      { key: 'sampling_preset_name', label: 'Sampling Preset', type: 'text', placeholder: 'Leave empty for manual', tooltip: 'Name of a preset on the Soulbits Engine server. Preset values are applied server-side.' },
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
      { key: 'model', label: 'Model', type: 'text', required: true, catalog: true },
      { key: 'sampling_preset_name', label: 'Sampling Preset', type: 'text', placeholder: 'Leave empty for manual', tooltip: 'Name of a preset on the Soulbits Engine server.' },
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
      { key: 'model', label: 'Model', type: 'text', required: true, placeholder: 'google/gemini-flash-2.5', catalog: true },
      { key: 'sampling_preset_name', label: 'Sampling Preset', type: 'text', placeholder: 'Leave empty for manual', tooltip: 'Name of a preset on the Soulbits Engine server.' },
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
      { key: 'voice_id', label: 'Voice ID', type: 'text', placeholder: '21m00Tcm4TlvDq8ikWAM' },
      { key: 'model_id', label: 'Model ID', type: 'text', placeholder: 'eleven_monolingual_v1' },
      { key: 'stability', label: 'Stability', type: 'number', step: 0.01, min: 0, max: 1 },
      { key: 'similarity_boost', label: 'Similarity Boost', type: 'number', step: 0.01, min: 0, max: 1 },
      { key: 'style', label: 'Style', type: 'number', step: 0.01, min: 0, max: 1 },
      { key: 'speaker_boost', label: 'Speaker Boost', type: 'number', step: 1, min: 0, max: 1 },
      // provider-registry 4-6: `speed` is v2-family only (not Eleven v3/v4).
      { key: 'speed', label: 'Speed', type: 'number', step: 0.05, min: 0.25, max: 4, tooltip: 'v2-family models only (not supported on Eleven v3/v4).' },
    ],
  },
  soulvoice: {
    hasModelFetch: false,
    fields: [
      { key: 'model', label: 'Model', type: 'text', catalog: true },
      { key: 'voice_config_file', label: 'Voice Config File', type: 'text' },
      { key: 'format', label: 'Format', type: 'text', placeholder: 'wav' },
      { key: 'sample_rate', label: 'Sample Rate', type: 'number', placeholder: '22050' },
      { key: 'stream', label: 'Stream', type: 'number', step: 1, min: 0, max: 1 },
      // provider-registry 4-11: Silero VAD dynamic params (VAD slot only).
      { key: 'threshold', label: 'VAD Threshold', type: 'number', step: 0.01, min: 0, max: 1, placeholder: '0.5', tooltip: 'Silero VAD (VAD slot).' },
      { key: 'min_speech_duration_ms', label: 'Min Speech Duration (ms)', type: 'number', placeholder: '250', tooltip: 'Silero VAD (VAD slot).' },
      { key: 'min_silence_duration_ms', label: 'Min Silence Duration (ms)', type: 'number', placeholder: '100', tooltip: 'Silero VAD (VAD slot).' },
      { key: 'speech_pad_ms', label: 'Speech Pad (ms)', type: 'number', placeholder: '30', tooltip: 'Silero VAD (VAD slot).' },
      { key: 'return_seconds', label: 'Return Seconds (0/1)', type: 'number', step: 1, min: 0, max: 1, placeholder: '0', tooltip: 'Silero VAD (VAD slot): 1 returns timestamps in seconds.' },
    ],
  },
  localai: {
    hasModelFetch: true,
    fields: [
      { key: 'model', label: 'Model', type: 'text', catalog: true },
      { key: 'sampling_preset_name', label: 'Sampling Preset', type: 'text', placeholder: 'Leave empty for manual', tooltip: 'Name of a preset on the Soulbits Engine server.' },
      { key: 'max_tokens', label: 'Max Tokens', type: 'number', disabledValue: -1 },
      { key: 'temperature', label: 'Temperature', type: 'number', step: 0.01, min: 0, max: 2 },
      { key: 'top_p', label: 'Top P', type: 'number', step: 0.01, min: 0, max: 1 },
      // LocalAI's /v1 surface is a SUPERSET that also accepts the native names
      // (top_k / min_p / repeat_penalty / repeat_last_n) — research §5.1/§8.4.
      { key: 'top_k', label: 'Top K', type: 'number', disabledValue: 0, tooltip: 'Native name, accepted on /v1.' },
      { key: 'min_p', label: 'Min P', type: 'number', step: 0.01, disabledValue: 0, tooltip: 'Native name, accepted on /v1.' },
      { key: 'repeat_penalty', label: 'Repeat Penalty', type: 'number', step: 0.01, disabledValue: 0, tooltip: 'Native name — not repetition_penalty.' },
      { key: 'repeat_last_n', label: 'Repeat Last N', type: 'number', disabledValue: 0 },
      { key: 'frequency_penalty', label: 'Frequency Penalty', type: 'number', step: 0.01, min: -2, max: 2 },
      { key: 'presence_penalty', label: 'Presence Penalty', type: 'number', step: 0.01, min: -2, max: 2 },
      { key: 'max_completion_tokens', label: 'Max Completion Tokens', type: 'number', disabledValue: 0 },
      { key: 'seed', label: 'Seed', type: 'number', disabledValue: 0 },
      { key: 'reasoning_effort', label: 'Reasoning Effort', type: 'select', options: [
        { id: '', name: 'Default' },
        { id: 'none', name: 'None' },
        { id: 'minimal', name: 'Minimal' },
        { id: 'low', name: 'Low' },
        { id: 'medium', name: 'Medium' },
        { id: 'high', name: 'High' },
      ]},
      { key: 'response_format', label: 'Response Format', type: 'text', placeholder: 'JSON string or empty' },
      { key: 'stop_tokens', label: 'Stop Tokens', type: 'comma-list' },
    ],
  },
  mistral: {
    hasModelFetch: false,
    fields: [
      { key: 'model', label: 'Model', type: 'text', required: true, placeholder: 'mistral-large-4', catalog: true },
      { key: 'sampling_preset_name', label: 'Sampling Preset', type: 'text', placeholder: 'Leave empty for manual', tooltip: 'Name of a preset on the Soulbits Engine server.' },
      // Mistral accepts `max_tokens` only — there is NO `max_completion_tokens`.
      { key: 'max_tokens', label: 'Max Tokens', type: 'number', disabledValue: -1 },
      // Mistral temperature range is 0 ≤ x ≤ 1.5 (not OpenAI's 0–2).
      { key: 'temperature', label: 'Temperature', type: 'number', step: 0.01, min: 0, max: 1.5 },
      { key: 'top_p', label: 'Top P', type: 'number', step: 0.01, min: 0, max: 1 },
      { key: 'top_k', label: 'Top K', type: 'number', disabledValue: 0 },
      { key: 'repetition_penalty', label: 'Repetition Penalty', type: 'number', step: 0.01, disabledValue: 0 },
      // Mistral uses `random_seed` — NOT `seed` (research §4/§5).
      { key: 'random_seed', label: 'Random Seed', type: 'number', disabledValue: 0, tooltip: 'Mistral uses random_seed (not seed).' },
      // reasoning_effort is model-gated and its value enum varies per model
      // (e.g. zai-glm-5-3 accepts low/high/max only) — research §4/§5.
      { key: 'reasoning_effort', label: 'Reasoning Effort', type: 'select', tooltip: 'Reasoning-capable models only; the accepted values vary per model.', options: [
        { id: '', name: 'Default' },
        { id: 'none', name: 'None' },
        { id: 'minimal', name: 'Minimal' },
        { id: 'low', name: 'Low' },
        { id: 'medium', name: 'Medium' },
        { id: 'high', name: 'High' },
        { id: 'xhigh', name: 'X-High' },
      ]},
      { key: 'response_format', label: 'Response Format', type: 'text', placeholder: 'JSON string or empty' },
      { key: 'stop_tokens', label: 'Stop Tokens', type: 'comma-list' },
    ],
  },
  ollama: {
    hasModelFetch: true,
    fields: [
      { key: 'model', label: 'Model', type: 'text', catalog: true },
      { key: 'sampling_preset_name', label: 'Sampling Preset', type: 'text', placeholder: 'Leave empty for manual', tooltip: 'Name of a preset on the Soulbits Engine server.' },
      // Full native option set (research §4.2 universal options + §8.5) — the
      // `/v1` surface would drop these, which is why the native client exists.
      { key: 'temperature', label: 'Temperature', type: 'number', step: 0.01, min: 0, max: 2 },
      { key: 'top_p', label: 'Top P', type: 'number', step: 0.01, min: 0, max: 1 },
      { key: 'top_k', label: 'Top K', type: 'number', disabledValue: 0, tooltip: 'Native option (server default 40).' },
      { key: 'min_p', label: 'Min P', type: 'number', step: 0.01, disabledValue: 0 },
      { key: 'repeat_penalty', label: 'Repeat Penalty', type: 'number', step: 0.01, disabledValue: 0, tooltip: 'Native name — not repetition_penalty.' },
      { key: 'repeat_last_n', label: 'Repeat Last N', type: 'number', disabledValue: 0 },
      { key: 'num_ctx', label: 'Context Window (num_ctx)', type: 'number', disabledValue: 0 },
      { key: 'num_predict', label: 'Max Tokens (num_predict)', type: 'number', disabledValue: 0 },
      { key: 'stop', label: 'Stop', type: 'comma-list', placeholder: 'e.g. \\n, STOP' },
      { key: 'seed', label: 'Seed', type: 'number', disabledValue: 0 },
      { key: 'think', label: 'Think', type: 'select', tooltip: 'Thinking-capable models only (bool; native levels are model-defined).', options: [
        { id: '', name: 'Default' },
        { id: 'false', name: 'Off' },
        { id: 'true', name: 'On' },
      ]},
      { key: 'format', label: 'Format', type: 'text', placeholder: 'json or a JSON schema' },
      { key: 'keep_alive', label: 'Keep Alive', type: 'text', placeholder: '5m' },
    ],
  },
  comfyui: {
    hasModelFetch: false,
    fields: [
      { key: 'model', label: 'Model', type: 'text', catalog: true, tooltip: 'Checkpoint the workflow loads.' },
      { key: 'workflow_profiles', label: 'Workflow Profiles', type: 'text', placeholder: 'JSON string' },
    ],
  },
  google: {
    hasModelFetch: false,
    fields: [
      { key: 'model', label: 'Model', type: 'text', placeholder: 'gemini-2.5-flash', catalog: true },
      { key: 'sampling_preset_name', label: 'Sampling Preset', type: 'text', placeholder: 'Leave empty for manual', tooltip: 'Name of a preset on the Soulbits Engine server.' },
      { key: 'max_output_tokens', label: 'Max Output Tokens', type: 'number', disabledValue: 0 },
      { key: 'temperature', label: 'Temperature', type: 'number', step: 0.01, min: 0, max: 2 },
      { key: 'top_p', label: 'Top P', type: 'number', step: 0.01, min: 0, max: 1 },
      { key: 'top_k', label: 'Top K', type: 'number', disabledValue: 0 },
      { key: 'stop_tokens', label: 'Stop Tokens', type: 'comma-list' },
      { key: 'response_mime_type', label: 'Response MIME Type', type: 'text', placeholder: 'application/json or empty' },
      // provider-registry 4-3: Gemini thinking control. Gemini 3.x uses an enum
      // `thinking_level`; Gemini 2.5 uses an integer `thinking_budget` — never
      // set both (the engine emits only one).
      { key: 'thinking_level', label: 'Thinking Level', type: 'select', tooltip: 'Gemini 3.x. Do not combine with Thinking Budget.', options: [
        { id: '', name: 'Default' },
        { id: 'minimal', name: 'Minimal' },
        { id: 'low', name: 'Low' },
        { id: 'medium', name: 'Medium' },
        { id: 'high', name: 'High' },
      ]},
      { key: 'thinking_budget', label: 'Thinking Budget', type: 'number', disabledValue: 0, tooltip: 'Gemini 2.5 token budget. Do not combine with Thinking Level.' },
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
      { key: 'model', label: 'Model', type: 'text', placeholder: 'grok-3', catalog: true },
      { key: 'sampling_preset_name', label: 'Sampling Preset', type: 'text', placeholder: 'Leave empty for manual', tooltip: 'Name of a preset on the Soulbits Engine server.' },
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
      // provider-registry 4-4: dedicated image model — NEVER falls back to the
      // chat model (retired slugs redirect; grok-imagine-image-2.0 is current).
      { key: 'image_model', label: 'Image Model', type: 'text', placeholder: 'grok-imagine-image-2.0', catalog: true, tooltip: 'Used by Imagination module. Never falls back to the chat model.' },
    ],
  },
  anthropic: {
    hasModelFetch: false,
    fields: [
      { key: 'model', label: 'Model', type: 'text', placeholder: 'claude-sonnet-4-20250514', catalog: true },
      { key: 'sampling_preset_name', label: 'Sampling Preset', type: 'text', placeholder: 'Leave empty for manual', tooltip: 'Name of a preset on the Soulbits Engine server.' },
      { key: 'max_tokens', label: 'Max Tokens', type: 'number', required: true, placeholder: '4096' },
      { key: 'temperature', label: 'Temperature', type: 'number', step: 0.01, min: 0, max: 1 },
      { key: 'top_p', label: 'Top P', type: 'number', step: 0.01, min: 0, max: 1 },
      { key: 'top_k', label: 'Top K', type: 'number', disabledValue: 0 },
      { key: 'stop_sequences', label: 'Stop Sequences', type: 'comma-list' },
    ],
  },
  soulbitscloud: {
    hasModelFetch: false,
    fields: [
      { key: 'model', label: 'Model', type: 'text', placeholder: 'qwen-35-9b' },
      { key: 'sampling_preset_name', label: 'Sampling Preset', type: 'text', placeholder: 'Leave empty for manual', tooltip: 'Name of a preset on the Soulbits Engine server.' },
      { key: 'max_tokens', label: 'Max Tokens', type: 'number', disabledValue: -1 },
      { key: 'max_completion_tokens', label: 'Max Completion Tokens', type: 'number', disabledValue: 0 },
      { key: 'temperature', label: 'Temperature', type: 'number', step: 0.01, min: 0, max: 2 },
      { key: 'top_p', label: 'Top P', type: 'number', step: 0.01, min: 0, max: 1 },
      { key: 'frequency_penalty', label: 'Frequency Penalty', type: 'number', step: 0.01, min: -2, max: 2 },
      { key: 'presence_penalty', label: 'Presence Penalty', type: 'number', step: 0.01, min: -2, max: 2 },
      { key: 'seed', label: 'Seed', type: 'number', disabledValue: 0, tooltip: 'Set for reproducible outputs' },
      { key: 'response_format', label: 'Response Format', type: 'text' },
      { key: 'stop_tokens', label: 'Stop Tokens', type: 'comma-list' },
      { key: 'n', label: 'N', type: 'number', disabledValue: 0, tooltip: 'Number of completions.' },
      { key: 'voice', label: 'Voice', type: 'text', placeholder: 'alloy', tooltip: 'Used by TTS module.' },
      { key: 'language', label: 'Language', type: 'text', placeholder: 'default', tooltip: 'Used by TTS module.' },
      { key: 'speed', label: 'Speed', type: 'number', step: 0.1, min: 0.25, max: 4, tooltip: 'Used by TTS module.' },
      { key: 'format', label: 'Format', type: 'text', placeholder: 'mp3', tooltip: 'Used by TTS module.' },
      { key: 'image_aspect_ratio', label: 'Image Aspect Ratio', type: 'text', placeholder: '1:1', tooltip: 'Used by Imagination module.' },
      { key: 'image_size', label: 'Image Size', type: 'text', placeholder: '1024x1024', tooltip: 'Used by Imagination module.' },
    ],
  },
};
