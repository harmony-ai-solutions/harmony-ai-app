/**
 * providerFieldSchemas — CAPABILITY-only provider form fields.
 *
 * provider-registry 6-2 owns the account-vs-capability schema split (plan
 * §3.2). Account-scoped fields (`name`, `api_key`, `base_url`/`endpoint`, and
 * the typed account extras) now live in `accountFieldSchemas.ts`; this module
 * carries ONLY the **capability** fields (model + sampling params + provider
 * params) that plan §3.2 moves onto a module config's capability overlay.
 *
 * ## Per-module scoping (Phase 1-2)
 *
 * A multi-capability provider (`soulbitscloud`, `openai`, `openrouter`,
 * `google`, `xai`, `soulvoice`, `ollama`, …) declares chat, TTS, VAD and
 * image-generation fields in ONE flat array. Each field now carries
 * `modules?: ModuleCapabilityScope[]` and
 * {@link getProviderFieldsForModule} filters the applicable subset so a
 * Backend config never renders/seeds TTS or Imagination keys.
 *
 * `ModuleConfigEditScreen` composes the two: its Credentials section reads
 * `accountFieldSchemas.ts`, its Capability section reads this module.
 */

export type ModuleCapabilityScope =
  | 'backend'
  | 'cognition'
  | 'movement'
  | 'rag'
  | 'tts'
  | 'stt'
  | 'vad'
  | 'vision'
  | 'imagination';

/** The modules that speak the LLM chat dialect (sampling params et al.). */
export const LLM_CHAT_MODULES: readonly ModuleCapabilityScope[] = [
  'backend',
  'cognition',
  'movement',
  'vision',
];

/** The 11 built-in OpenAI TTS voices (`gpt-4o-mini-tts` catalog). */
export const OPENAI_TTS_VOICES: Array<{ id: string; name: string }> = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'onyx',
  'nova',
  'sage',
  'shimmer',
  'verse',
].map((id) => ({ id, name: id }));

/** Shared aspect-ratio pills for the cloud image providers (Phase 3-8). */
export const ASPECT_RATIO_OPTIONS: Array<{ id: string; name: string }> = [
  { id: '', name: 'Default' },
  { id: '1:1', name: '1:1 Square' },
  { id: '16:9', name: '16:9 Landscape' },
  { id: '9:16', name: '9:16 Portrait' },
  { id: '4:3', name: '4:3' },
  { id: '3:4', name: '3:4' },
];

export interface FieldDefinition {
  key: string;
  label: string;
  type:
    | 'text'
    | 'password'
    | 'number'
    | 'select'
    | 'checkbox'
    | 'toggle'
    | 'comma-list'
    | 'chips';
  /** When set, this capability field only applies to the listed module scopes. */
  modules?: readonly ModuleCapabilityScope[];
  /** For `type === 'toggle'`, the persisted representation (`0`/`1` or boolean). */
  toggleValueType?: 'numeric' | 'boolean';
  placeholder?: string;
  tooltip?: string;
  step?: number;
  min?: number;
  max?: number;
  /**
   * Sentinel that means "unset" for numeric fields (`-1` unlimited, `0`
   * random/auto). `FormField` renders it as an empty input so the placeholder
   * shows through, and emits it again when the input is cleared.
   */
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
   * capability registry + live discovery (provider-registry 6-3). `model` and
   * xAI's `image_model` use this today.
   */
  catalog?: boolean;
}

export interface ProviderSchema {
  fields: FieldDefinition[];
  hasModelFetch?: boolean;
}

/**
 * The capability fields that apply to `modelModuleType` for a provider type.
 * Fields without a `modules` list apply everywhere.
 */
export function getProviderFieldsForModule(
  providerType: string,
  modelModuleType: string,
): FieldDefinition[] {
  const all = PROVIDER_SCHEMAS[providerType]?.fields ?? [];
  return all.filter(
    (f) => !f.modules || f.modules.includes(modelModuleType as ModuleCapabilityScope),
  );
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
      { key: 'sampling_preset_name', label: 'Sampling Preset', type: 'text', placeholder: 'Leave empty for manual', tooltip: 'Name of a preset on the Soulbits Engine server. Preset values are applied server-side.', modules: LLM_CHAT_MODULES },
      { key: 'max_tokens', label: 'Max Tokens', type: 'number', placeholder: 'Unlimited', disabledValue: -1, width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'temperature', label: 'Temperature', type: 'number', step: 0.01, min: 0, max: 2, placeholder: '0.7', width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'top_p', label: 'Top P', type: 'number', step: 0.01, min: 0, max: 1, placeholder: '1.0', width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'frequency_penalty', label: 'Frequency Penalty', type: 'number', step: 0.01, min: -2, max: 2, placeholder: '0.0', width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'presence_penalty', label: 'Presence Penalty', type: 'number', step: 0.01, min: -2, max: 2, placeholder: '0.0', width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'max_completion_tokens', label: 'Max Completion Tokens', type: 'number', placeholder: 'Default', disabledValue: 0, width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'seed', label: 'Seed', type: 'number', placeholder: 'Random', disabledValue: 0, width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'stop_tokens', label: 'Stop Tokens', type: 'comma-list', placeholder: 'e.g. \\n, STOP', modules: LLM_CHAT_MODULES },
      { key: 'reasoning_effort', label: 'Reasoning Effort', type: 'select', modules: LLM_CHAT_MODULES, options: [
        { id: '', name: 'Default' },
        { id: 'low', name: 'Low' },
        { id: 'medium', name: 'Medium' },
        { id: 'high', name: 'High' },
      ]},
      { key: 'voice', label: 'Voice', type: 'chips', options: OPENAI_TTS_VOICES, modules: ['tts'] },
      { key: 'speed', label: 'Speed (0.25–4.0)', type: 'number', step: 0.05, min: 0.25, max: 4, placeholder: '1.0', width: 'half', modules: ['tts'] },
      { key: 'format', label: 'Response Format', type: 'select', placeholder: 'mp3', width: 'half', options: [
        { id: 'mp3', name: 'mp3' },
        { id: 'wav', name: 'wav' },
        { id: 'opus', name: 'opus' },
        { id: 'aac', name: 'aac' },
        { id: 'flac', name: 'flac' },
      ], modules: ['tts'] },
      { key: 'instructions', label: 'Voice Design Instructions (gpt-4o-mini-tts)', type: 'text', placeholder: 'Speak in a warm, playful tone with a slightly brisk pace and soft emotional inflection.', modules: ['tts'] },
      { key: 'n', label: 'Number of Images', type: 'number', placeholder: '1 (default)', disabledValue: 0, width: 'half', modules: ['imagination'] },
    ],
  },
  openaicompatible: {
    hasModelFetch: false,
    fields: [
      { key: 'model', label: 'Model', type: 'text', required: true, catalog: true },
      { key: 'sampling_preset_name', label: 'Sampling Preset', type: 'text', placeholder: 'Leave empty for manual', tooltip: 'Name of a preset on the Soulbits Engine server.', modules: LLM_CHAT_MODULES },
      { key: 'max_tokens', label: 'Max Tokens', type: 'number', placeholder: 'Unlimited', disabledValue: -1, width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'temperature', label: 'Temperature', type: 'number', step: 0.01, min: 0, max: 2, placeholder: '0.7', width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'top_p', label: 'Top P', type: 'number', step: 0.01, min: 0, max: 1, placeholder: '1.0', width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'top_k', label: 'Top K', type: 'number', placeholder: 'Default', disabledValue: 0, width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'top_a', label: 'Top A', type: 'number', step: 0.01, placeholder: 'Default', disabledValue: 0, width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'min_p', label: 'Min P', type: 'number', step: 0.01, placeholder: 'Default', disabledValue: 0, width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'repetition_penalty', label: 'Repetition Penalty', type: 'number', step: 0.01, placeholder: 'Default', disabledValue: 0, width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'frequency_penalty', label: 'Frequency Penalty', type: 'number', step: 0.01, min: -2, max: 2, placeholder: '0.0', width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'presence_penalty', label: 'Presence Penalty', type: 'number', step: 0.01, min: -2, max: 2, placeholder: '0.0', width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'max_completion_tokens', label: 'Max Completion Tokens', type: 'number', placeholder: 'Default', disabledValue: 0, width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'seed', label: 'Seed', type: 'number', placeholder: 'Random', disabledValue: 0, width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'response_format', label: 'Response Format', type: 'text', placeholder: 'JSON string or empty', modules: LLM_CHAT_MODULES },
      { key: 'stop_tokens', label: 'Stop Tokens', type: 'comma-list', modules: LLM_CHAT_MODULES },
    ],
  },
  openrouter: {
    hasModelFetch: false,
    fields: [
      { key: 'model', label: 'Model', type: 'text', required: true, placeholder: 'google/gemini-flash-2.5', catalog: true },
      { key: 'sampling_preset_name', label: 'Sampling Preset', type: 'text', placeholder: 'Leave empty for manual', tooltip: 'Name of a preset on the Soulbits Engine server.', modules: LLM_CHAT_MODULES },
      { key: 'max_tokens', label: 'Max Tokens', type: 'number', placeholder: 'Unlimited', disabledValue: -1, width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'temperature', label: 'Temperature', type: 'number', step: 0.01, min: 0, max: 2, placeholder: '0.7', width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'top_p', label: 'Top P', type: 'number', step: 0.01, min: 0, max: 1, placeholder: '1.0', width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'top_k', label: 'Top K', type: 'number', placeholder: 'Default', disabledValue: 0, width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'top_a', label: 'Top A', type: 'number', step: 0.01, placeholder: 'Default', disabledValue: 0, width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'min_p', label: 'Min P', type: 'number', step: 0.01, placeholder: 'Default', disabledValue: 0, width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'repetition_penalty', label: 'Repetition Penalty', type: 'number', step: 0.01, placeholder: 'Default', disabledValue: 0, width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'frequency_penalty', label: 'Frequency Penalty', type: 'number', step: 0.01, min: -2, max: 2, placeholder: '0.0', width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'presence_penalty', label: 'Presence Penalty', type: 'number', step: 0.01, min: -2, max: 2, placeholder: '0.0', width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'max_completion_tokens', label: 'Max Completion Tokens', type: 'number', placeholder: 'Default', disabledValue: 0, width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'seed', label: 'Seed', type: 'number', placeholder: 'Random', disabledValue: 0, width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'response_format', label: 'Response Format', type: 'text', modules: LLM_CHAT_MODULES },
      { key: 'stop_tokens', label: 'Stop Tokens', type: 'comma-list', modules: LLM_CHAT_MODULES },
      { key: 'voice', label: 'Voice', type: 'text', placeholder: 'alloy', modules: ['tts'] },
      { key: 'speed', label: 'Speed', type: 'number', step: 0.1, min: 0.25, max: 4, placeholder: '1.0', width: 'half', modules: ['tts'] },
      { key: 'format', label: 'Format', type: 'text', placeholder: 'mp3', width: 'half', modules: ['tts'] },
      { key: 'image_aspect_ratio', label: 'Image Aspect Ratio', type: 'chips', options: ASPECT_RATIO_OPTIONS, modules: ['imagination'] },
      { key: 'image_size', label: 'Image Size', type: 'text', placeholder: '1024x1024', width: 'half', modules: ['imagination'] },
    ],
  },
  elevenlabs: {
    hasModelFetch: false,
    fields: [
      // `model` is shared with the STT slot (Phase 3-6 wires ElevenLabs Scribe).
      { key: 'model', label: 'Model', type: 'text', placeholder: 'eleven_multilingual_v2', modules: ['tts', 'stt'] },
      { key: 'voice_id', label: 'Voice ID', type: 'text', placeholder: '21m00Tcm4TlvDq8ikWAM', modules: ['tts'] },
      { key: 'model_id', label: 'Model ID', type: 'text', placeholder: 'eleven_monolingual_v1', modules: ['tts'] },
      { key: 'stability', label: 'Stability', type: 'number', step: 0.05, min: 0, max: 1, placeholder: '0.5', width: 'half', modules: ['tts'] },
      { key: 'similarity_boost', label: 'Similarity Boost', type: 'number', step: 0.05, min: 0, max: 1, placeholder: '0.75', width: 'half', modules: ['tts'] },
      { key: 'style', label: 'Style', type: 'number', step: 0.05, min: 0, max: 1, placeholder: '0.0', width: 'half', modules: ['tts'] },
      // provider-registry 4-6: `speed` is v2-family only (not Eleven v3/v4).
      { key: 'speed', label: 'Speed', type: 'number', step: 0.05, min: 0.25, max: 4, placeholder: '1.0', width: 'half', tooltip: 'v2-family models only (not supported on Eleven v3/v4).', modules: ['tts'] },
      { key: 'speaker_boost', label: 'Speaker Boost', type: 'toggle', toggleValueType: 'numeric', modules: ['tts'] },
      { key: 'output_format', label: 'Output Format', type: 'select', options: [
        { id: 'mp3_44100_128', name: 'MP3 44.1 kHz / 128 kbps' },
        { id: 'mp3_44100_192', name: 'MP3 44.1 kHz / 192 kbps' },
        { id: 'pcm_24000', name: 'PCM 24 kHz' },
        { id: 'opus_48000_128', name: 'Opus 48 kHz / 128 kbps' },
      ], modules: ['tts'] },
      { key: 'language_code', label: 'Language Code', type: 'text', placeholder: 'Auto (ISO 639-1)', width: 'half', modules: ['tts'] },
      { key: 'apply_text_normalization', label: 'Text Normalization', type: 'select', width: 'half', options: [
        { id: 'auto', name: 'Auto' },
        { id: 'on', name: 'On' },
        { id: 'off', name: 'Off' },
      ], modules: ['tts'] },
      { key: 'seed', label: 'Seed', type: 'number', placeholder: 'Random', disabledValue: 0, width: 'half', modules: ['tts'] },
    ],
  },
  soulvoice: {
    hasModelFetch: false,
    fields: [
      { key: 'model', label: 'Model', type: 'text', catalog: true, modules: ['tts', 'stt', 'vad'] },
      { key: 'voice_config_file', label: 'Voice Config File', type: 'text', modules: ['tts'] },
      { key: 'voice', label: 'Voice', type: 'text', placeholder: 'Claire', modules: ['tts'] },
      { key: 'language', label: 'Language', type: 'text', placeholder: 'Auto', width: 'half', modules: ['tts'] },
      // Acoustic / prosody tuning (Phase 3-5, Chatterbox + HarmonySpeech).
      { key: 'speed', label: 'Speed', type: 'number', step: 0.05, min: 0.25, max: 4.0, placeholder: '1.0', width: 'half', modules: ['tts'] },
      { key: 'pitch', label: 'Pitch', type: 'number', step: 0.05, min: 0.5, max: 2.0, placeholder: '1.0', width: 'half', modules: ['tts'] },
      { key: 'energy', label: 'Energy', type: 'number', step: 0.05, min: 0.5, max: 2.0, placeholder: '1.0', width: 'half', modules: ['tts'] },
      { key: 'exaggeration', label: 'Exaggeration', type: 'number', step: 0.05, min: 0, max: 1, placeholder: '0.5', width: 'half', modules: ['tts'] },
      { key: 'cfg_weight', label: 'CFG Weight', type: 'number', step: 0.05, min: 0, max: 1, placeholder: '0.5', width: 'half', modules: ['tts'] },
      { key: 'style', label: 'Style Index', type: 'number', step: 0.05, min: 0, max: 1, placeholder: '0', width: 'half', modules: ['tts'] },
      { key: 'seed', label: 'Seed', type: 'number', placeholder: 'Random', disabledValue: 0, width: 'half', modules: ['tts'] },
      { key: 'format', label: 'Audio Format', type: 'select', placeholder: 'wav', width: 'half', options: [
        { id: 'wav', name: 'wav (PCM 16-bit)' },
        { id: 'mp3', name: 'mp3' },
        { id: 'opus', name: 'opus' },
        { id: 'flac', name: 'flac' },
      ], modules: ['tts'] },
      { key: 'sample_rate', label: 'Sample Rate', type: 'select', placeholder: '22050', width: 'half', options: [
        { id: '22050', name: '22050 Hz' },
        { id: '24000', name: '24000 Hz' },
        { id: '44100', name: '44100 Hz' },
      ], modules: ['tts'] },
      { key: 'norm_loudness', label: 'Normalize Loudness (pyloudnorm)', type: 'toggle', toggleValueType: 'boolean', tooltip: 'Balances output gain on Chatterbox Turbo', modules: ['tts'] },
      { key: 'stream', label: 'Stream', type: 'toggle', toggleValueType: 'numeric', modules: ['tts'] },
      // provider-registry 4-11: Silero VAD dynamic params (VAD slot only).
      { key: 'threshold', label: 'Speech Threshold', type: 'number', step: 0.05, min: 0.05, max: 0.95, placeholder: '0.5', width: 'half', modules: ['vad'] },
      { key: 'speech_pad_ms', label: 'Speech Pad (ms)', type: 'number', placeholder: '30', width: 'half', modules: ['vad'] },
      { key: 'min_speech_duration_ms', label: 'Min Speech Duration (ms)', type: 'number', placeholder: '250', width: 'half', modules: ['vad'] },
      { key: 'min_silence_duration_ms', label: 'Min Silence (Auto-Stop)', type: 'number', placeholder: '100', width: 'half', modules: ['vad'] },
      { key: 'return_seconds', label: 'Return Seconds', type: 'toggle', toggleValueType: 'numeric', modules: ['vad'] },
    ],
  },
  localai: {
    hasModelFetch: true,
    fields: [
      { key: 'model', label: 'Model', type: 'text', catalog: true },
      { key: 'sampling_preset_name', label: 'Sampling Preset', type: 'text', placeholder: 'Leave empty for manual', tooltip: 'Name of a preset on the Soulbits Engine server.', modules: LLM_CHAT_MODULES },
      { key: 'max_tokens', label: 'Max Tokens', type: 'number', placeholder: 'Unlimited', disabledValue: -1, width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'temperature', label: 'Temperature', type: 'number', step: 0.01, min: 0, max: 2, placeholder: '0.7', width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'top_p', label: 'Top P', type: 'number', step: 0.01, min: 0, max: 1, placeholder: '1.0', width: 'half', modules: LLM_CHAT_MODULES },
      // LocalAI's /v1 surface is a SUPERSET that also accepts the native names
      // (top_k / min_p / repeat_penalty / repeat_last_n) — research §5.1/§8.4.
      { key: 'top_k', label: 'Top K', type: 'number', placeholder: 'Default', disabledValue: 0, width: 'half', tooltip: 'Native name, accepted on /v1.', modules: LLM_CHAT_MODULES },
      { key: 'min_p', label: 'Min P', type: 'number', step: 0.01, placeholder: 'Default', disabledValue: 0, width: 'half', tooltip: 'Native name, accepted on /v1.', modules: LLM_CHAT_MODULES },
      { key: 'repeat_penalty', label: 'Repeat Penalty', type: 'number', step: 0.01, placeholder: 'Default', disabledValue: 0, width: 'half', tooltip: 'Native name — not repetition_penalty.', modules: LLM_CHAT_MODULES },
      { key: 'repeat_last_n', label: 'Repeat Last N', type: 'number', placeholder: 'Default', disabledValue: 0, width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'frequency_penalty', label: 'Frequency Penalty', type: 'number', step: 0.01, min: -2, max: 2, placeholder: '0.0', width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'presence_penalty', label: 'Presence Penalty', type: 'number', step: 0.01, min: -2, max: 2, placeholder: '0.0', width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'max_completion_tokens', label: 'Max Completion Tokens', type: 'number', placeholder: 'Default', disabledValue: 0, width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'seed', label: 'Seed', type: 'number', placeholder: 'Random', disabledValue: 0, width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'reasoning_effort', label: 'Reasoning Effort', type: 'select', modules: LLM_CHAT_MODULES, options: [
        { id: '', name: 'Default' },
        { id: 'none', name: 'None' },
        { id: 'minimal', name: 'Minimal' },
        { id: 'low', name: 'Low' },
        { id: 'medium', name: 'Medium' },
        { id: 'high', name: 'High' },
      ]},
      { key: 'response_format', label: 'Response Format', type: 'text', placeholder: 'JSON string or empty', modules: LLM_CHAT_MODULES },
      { key: 'stop_tokens', label: 'Stop Tokens', type: 'comma-list', modules: LLM_CHAT_MODULES },
    ],
  },
  mistral: {
    hasModelFetch: false,
    fields: [
      { key: 'model', label: 'Model', type: 'text', required: true, placeholder: 'mistral-large-4', catalog: true },
      { key: 'sampling_preset_name', label: 'Sampling Preset', type: 'text', placeholder: 'Leave empty for manual', tooltip: 'Name of a preset on the Soulbits Engine server.', modules: LLM_CHAT_MODULES },
      // Mistral accepts `max_tokens` only — there is NO `max_completion_tokens`.
      { key: 'max_tokens', label: 'Max Tokens', type: 'number', placeholder: 'Unlimited', disabledValue: -1, width: 'half', modules: LLM_CHAT_MODULES },
      // Mistral temperature range is 0 ≤ x ≤ 1.5 (not OpenAI's 0–2).
      { key: 'temperature', label: 'Temperature', type: 'number', step: 0.01, min: 0, max: 1.5, placeholder: '0.7', width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'top_p', label: 'Top P', type: 'number', step: 0.01, min: 0, max: 1, placeholder: '1.0', width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'top_k', label: 'Top K', type: 'number', placeholder: 'Default', disabledValue: 0, width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'repetition_penalty', label: 'Repetition Penalty', type: 'number', step: 0.01, placeholder: 'Default', disabledValue: 0, width: 'half', modules: LLM_CHAT_MODULES },
      // Mistral uses `random_seed` — NOT `seed` (research §4/§5).
      { key: 'random_seed', label: 'Random Seed', type: 'number', placeholder: 'Random', disabledValue: 0, width: 'half', tooltip: 'Mistral uses random_seed (not seed).', modules: LLM_CHAT_MODULES },
      // reasoning_effort is model-gated and its value enum varies per model
      // (e.g. zai-glm-5-3 accepts low/high/max only) — research §4/§5.
      { key: 'reasoning_effort', label: 'Reasoning Effort', type: 'select', tooltip: 'Reasoning-capable models only; the accepted values vary per model.', modules: LLM_CHAT_MODULES, options: [
        { id: '', name: 'Default' },
        { id: 'none', name: 'None' },
        { id: 'minimal', name: 'Minimal' },
        { id: 'low', name: 'Low' },
        { id: 'medium', name: 'Medium' },
        { id: 'high', name: 'High' },
        { id: 'xhigh', name: 'X-High' },
      ]},
      { key: 'response_format', label: 'Response Format', type: 'text', placeholder: 'JSON string or empty', modules: LLM_CHAT_MODULES },
      { key: 'stop_tokens', label: 'Stop Tokens', type: 'comma-list', modules: LLM_CHAT_MODULES },
    ],
  },
  ollama: {
    hasModelFetch: true,
    fields: [
      { key: 'model', label: 'Model', type: 'text', catalog: true },
      { key: 'sampling_preset_name', label: 'Sampling Preset', type: 'text', placeholder: 'Leave empty for manual', tooltip: 'Name of a preset on the Soulbits Engine server.', modules: LLM_CHAT_MODULES },
      // Full native option set (research §4.2 universal options + §8.5) — the
      // `/v1` surface would drop these, which is why the native client exists.
      { key: 'temperature', label: 'Temperature', type: 'number', step: 0.01, min: 0, max: 2, placeholder: '0.7', width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'top_p', label: 'Top P', type: 'number', step: 0.01, min: 0, max: 1, placeholder: '1.0', width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'top_k', label: 'Top K', type: 'number', placeholder: 'Default', disabledValue: 0, width: 'half', tooltip: 'Native option (server default 40).', modules: LLM_CHAT_MODULES },
      { key: 'min_p', label: 'Min P', type: 'number', step: 0.01, placeholder: 'Default', disabledValue: 0, width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'repeat_penalty', label: 'Repeat Penalty', type: 'number', step: 0.01, placeholder: 'Default', disabledValue: 0, width: 'half', tooltip: 'Native name — not repetition_penalty.', modules: LLM_CHAT_MODULES },
      { key: 'repeat_last_n', label: 'Repeat Last N', type: 'number', placeholder: 'Default', disabledValue: 0, width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'num_ctx', label: 'Context Window (num_ctx)', type: 'number', placeholder: 'Default', disabledValue: 0, width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'num_predict', label: 'Max Tokens (num_predict)', type: 'number', placeholder: 'Unlimited', disabledValue: 0, width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'stop', label: 'Stop', type: 'comma-list', placeholder: 'e.g. \\n, STOP', modules: LLM_CHAT_MODULES },
      { key: 'seed', label: 'Seed', type: 'number', placeholder: 'Random', disabledValue: 0, width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'think', label: 'Think', type: 'select', tooltip: 'Thinking-capable models only (bool; native levels are model-defined).', modules: LLM_CHAT_MODULES, options: [
        { id: '', name: 'Default' },
        { id: 'false', name: 'Off' },
        { id: 'true', name: 'On' },
      ]},
      { key: 'format', label: 'Format', type: 'text', placeholder: 'json or a JSON schema', modules: LLM_CHAT_MODULES },
      { key: 'keep_alive', label: 'Keep Alive', type: 'text', placeholder: '5m', modules: LLM_CHAT_MODULES },
    ],
  },
  comfyui: {
    hasModelFetch: false,
    fields: [
      { key: 'model', label: 'Model', type: 'text', catalog: true, tooltip: 'Checkpoint the workflow loads.', modules: ['imagination'] },
      { key: 'workflow_profiles', label: 'Workflow Profiles', type: 'text', placeholder: 'Optional custom workflow JSON', modules: ['imagination'] },
    ],
  },
  google: {
    hasModelFetch: false,
    fields: [
      { key: 'model', label: 'Model', type: 'text', placeholder: 'gemini-2.5-flash', catalog: true },
      { key: 'sampling_preset_name', label: 'Sampling Preset', type: 'text', placeholder: 'Leave empty for manual', tooltip: 'Name of a preset on the Soulbits Engine server.', modules: LLM_CHAT_MODULES },
      { key: 'max_output_tokens', label: 'Max Output Tokens', type: 'number', placeholder: 'Default', disabledValue: 0, width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'temperature', label: 'Temperature', type: 'number', step: 0.01, min: 0, max: 2, placeholder: '0.7', width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'top_p', label: 'Top P', type: 'number', step: 0.01, min: 0, max: 1, placeholder: '1.0', width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'top_k', label: 'Top K', type: 'number', placeholder: 'Default', disabledValue: 0, width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'stop_tokens', label: 'Stop Tokens', type: 'comma-list', modules: LLM_CHAT_MODULES },
      { key: 'response_mime_type', label: 'Response MIME Type', type: 'text', placeholder: 'application/json or empty', modules: LLM_CHAT_MODULES },
      // provider-registry 4-3: Gemini thinking control. Gemini 3.x uses an enum
      // `thinking_level`; Gemini 2.5 uses an integer `thinking_budget` — never
      // set both (the engine emits only one).
      { key: 'thinking_level', label: 'Thinking Level', type: 'select', tooltip: 'Gemini 3.x. Do not combine with Thinking Budget.', modules: LLM_CHAT_MODULES, options: [
        { id: '', name: 'Default' },
        { id: 'minimal', name: 'Minimal' },
        { id: 'low', name: 'Low' },
        { id: 'medium', name: 'Medium' },
        { id: 'high', name: 'High' },
      ]},
      { key: 'thinking_budget', label: 'Thinking Budget', type: 'number', placeholder: 'Default', disabledValue: 0, width: 'half', tooltip: 'Gemini 2.5 token budget. Do not combine with Thinking Level.', modules: LLM_CHAT_MODULES },
      { key: 'number_of_images', label: 'Number of Images', type: 'number', placeholder: '1', width: 'half', modules: ['imagination'] },
      { key: 'aspect_ratio', label: 'Aspect Ratio', type: 'chips', options: ASPECT_RATIO_OPTIONS, modules: ['imagination'] },
    ],
  },
  xai: {
    hasModelFetch: false,
    fields: [
      // Chat model only — Imagination uses the dedicated `image_model` below so
      // the two pickers never appear side by side (Phase 3-8).
      { key: 'model', label: 'Model', type: 'text', placeholder: 'grok-3', catalog: true, modules: LLM_CHAT_MODULES },
      { key: 'sampling_preset_name', label: 'Sampling Preset', type: 'text', placeholder: 'Leave empty for manual', tooltip: 'Name of a preset on the Soulbits Engine server.', modules: LLM_CHAT_MODULES },
      { key: 'max_tokens', label: 'Max Tokens', type: 'number', placeholder: 'Unlimited', disabledValue: -1, width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'temperature', label: 'Temperature', type: 'number', step: 0.01, min: 0, max: 2, placeholder: '0.7', width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'top_p', label: 'Top P', type: 'number', step: 0.01, min: 0, max: 1, placeholder: '1.0', width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'frequency_penalty', label: 'Frequency Penalty', type: 'number', step: 0.01, min: -2, max: 2, placeholder: '0.0', width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'presence_penalty', label: 'Presence Penalty', type: 'number', step: 0.01, min: -2, max: 2, placeholder: '0.0', width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'max_completion_tokens', label: 'Max Completion Tokens', type: 'number', placeholder: 'Default', disabledValue: 0, width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'seed', label: 'Seed', type: 'number', placeholder: 'Random', disabledValue: 0, width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'response_format', label: 'Response Format', type: 'text', modules: LLM_CHAT_MODULES },
      { key: 'reasoning_effort', label: 'Reasoning Effort', type: 'select', modules: LLM_CHAT_MODULES, options: [
        { id: '', name: 'Default' },
        { id: 'low', name: 'Low' },
        { id: 'medium', name: 'Medium' },
        { id: 'high', name: 'High' },
      ]},
      { key: 'stop_tokens', label: 'Stop Tokens', type: 'comma-list', modules: LLM_CHAT_MODULES },
      { key: 'image_aspect_ratio', label: 'Image Aspect Ratio', type: 'chips', options: ASPECT_RATIO_OPTIONS, modules: ['imagination'] },
      { key: 'image_resolution', label: 'Image Resolution', type: 'text', placeholder: '1024x1024', width: 'half', modules: ['imagination'] },
      // provider-registry 4-4: dedicated image model — NEVER falls back to the
      // chat model (retired slugs redirect; grok-imagine-image-2.0 is current).
      { key: 'image_model', label: 'Image Model', type: 'text', placeholder: 'grok-imagine-image-2.0', catalog: true, tooltip: 'Never falls back to the chat model.', modules: ['imagination'] },
    ],
  },
  anthropic: {
    hasModelFetch: false,
    fields: [
      { key: 'model', label: 'Model', type: 'text', placeholder: 'claude-sonnet-4-20250514', catalog: true, modules: LLM_CHAT_MODULES },
      { key: 'sampling_preset_name', label: 'Sampling Preset', type: 'text', placeholder: 'Leave empty for manual', tooltip: 'Name of a preset on the Soulbits Engine server.', modules: LLM_CHAT_MODULES },
      { key: 'max_tokens', label: 'Max Tokens', type: 'number', required: true, placeholder: '4096', width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'temperature', label: 'Temperature', type: 'number', step: 0.01, min: 0, max: 1, placeholder: '0.7', width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'top_p', label: 'Top P', type: 'number', step: 0.01, min: 0, max: 1, placeholder: '1.0', width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'top_k', label: 'Top K', type: 'number', placeholder: 'Default', disabledValue: 0, width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'stop_sequences', label: 'Stop Sequences', type: 'comma-list', modules: LLM_CHAT_MODULES },
    ],
  },
  soulbitscloud: {
    hasModelFetch: false,
    fields: [
      { key: 'model', label: 'Model', type: 'text', placeholder: 'qwen-35-9b' },
      { key: 'sampling_preset_name', label: 'Sampling Preset', type: 'text', placeholder: 'Leave empty for manual', tooltip: 'Name of a preset on the Soulbits Engine server.', modules: LLM_CHAT_MODULES },
      { key: 'temperature', label: 'Temperature', type: 'number', step: 0.01, min: 0, max: 2, placeholder: '0.7', width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'top_p', label: 'Top P', type: 'number', step: 0.01, min: 0, max: 1, placeholder: '1.0', width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'max_tokens', label: 'Max Tokens', type: 'number', placeholder: 'Unlimited', disabledValue: -1, width: 'half', modules: LLM_CHAT_MODULES },
      // Shared by chat and TTS (the engine seeds one `seed` field per slot).
      { key: 'seed', label: 'Seed', type: 'number', placeholder: 'Random', disabledValue: 0, width: 'half', modules: [...LLM_CHAT_MODULES, 'tts'] },
      { key: 'frequency_penalty', label: 'Frequency Penalty', type: 'number', step: 0.01, min: -2, max: 2, placeholder: '0.0', width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'presence_penalty', label: 'Presence Penalty', type: 'number', step: 0.01, min: -2, max: 2, placeholder: '0.0', width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'max_completion_tokens', label: 'Max Completion Tokens', type: 'number', placeholder: 'Default', disabledValue: 0, width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'n', label: 'N', type: 'number', placeholder: '1 (default)', disabledValue: 0, width: 'half', modules: LLM_CHAT_MODULES },
      { key: 'stop_tokens', label: 'Stop Tokens', type: 'comma-list', placeholder: 'e.g. \\n, <|im_end|>', modules: LLM_CHAT_MODULES },
      { key: 'response_format', label: 'Response Format', type: 'text', placeholder: 'JSON string or empty', modules: LLM_CHAT_MODULES },
      { key: 'voice', label: 'Voice', type: 'text', placeholder: 'alloy', modules: ['tts'] },
      { key: 'language', label: 'Language', type: 'text', placeholder: 'default', width: 'half', modules: ['tts'] },
      { key: 'speed', label: 'Speed', type: 'number', step: 0.05, min: 0.25, max: 4.0, placeholder: '1.0', width: 'half', modules: ['tts'] },
      { key: 'pitch', label: 'Pitch', type: 'number', step: 0.05, min: 0.5, max: 2.0, placeholder: '1.0', width: 'half', modules: ['tts'] },
      { key: 'energy', label: 'Energy', type: 'number', step: 0.05, min: 0.5, max: 2.0, placeholder: '1.0', width: 'half', modules: ['tts'] },
      { key: 'exaggeration', label: 'Exaggeration', type: 'number', step: 0.05, min: 0, max: 1, placeholder: '0.5', width: 'half', modules: ['tts'] },
      { key: 'cfg_weight', label: 'CFG Weight', type: 'number', step: 0.05, min: 0, max: 1, placeholder: '0.5', width: 'half', modules: ['tts'] },
      { key: 'style', label: 'Style Index', type: 'number', step: 0.05, min: 0, max: 1, placeholder: '0', width: 'half', modules: ['tts'] },
      { key: 'format', label: 'Audio Format', type: 'select', placeholder: 'mp3', width: 'half', options: [
        { id: 'mp3', name: 'mp3' },
        { id: 'wav', name: 'wav (PCM 16-bit)' },
        { id: 'opus', name: 'opus' },
        { id: 'flac', name: 'flac' },
      ], modules: ['tts'] },
      { key: 'sample_rate', label: 'Sample Rate', type: 'select', placeholder: '22050', width: 'half', options: [
        { id: '22050', name: '22050 Hz' },
        { id: '24000', name: '24000 Hz' },
        { id: '44100', name: '44100 Hz' },
      ], modules: ['tts'] },
      { key: 'norm_loudness', label: 'Normalize Loudness (pyloudnorm)', type: 'toggle', toggleValueType: 'boolean', tooltip: 'Balances output gain on Chatterbox Turbo', modules: ['tts'] },
      { key: 'image_aspect_ratio', label: 'Image Aspect Ratio', type: 'chips', options: ASPECT_RATIO_OPTIONS, modules: ['imagination'] },
      { key: 'image_size', label: 'Image Size', type: 'text', placeholder: '1024x1024', width: 'half', modules: ['imagination'] },
      // Silero VAD tunables — same surface as soulvoice (Phase 3-6).
      { key: 'threshold', label: 'Speech Threshold', type: 'number', step: 0.05, min: 0.05, max: 0.95, placeholder: '0.5', width: 'half', modules: ['vad'] },
      { key: 'speech_pad_ms', label: 'Speech Pad (ms)', type: 'number', placeholder: '30', width: 'half', modules: ['vad'] },
      { key: 'min_speech_duration_ms', label: 'Min Speech Duration (ms)', type: 'number', placeholder: '250', width: 'half', modules: ['vad'] },
      { key: 'min_silence_duration_ms', label: 'Min Silence (Auto-Stop)', type: 'number', placeholder: '100', width: 'half', modules: ['vad'] },
      { key: 'return_seconds', label: 'Return Seconds', type: 'toggle', toggleValueType: 'numeric', modules: ['vad'] },
    ],
  },
};
