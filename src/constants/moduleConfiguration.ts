import { FieldDefinition } from './providerFieldSchemas';

export interface ProviderOption {
  id: string;       // e.g., 'openai', 'openaicompatible', 'openrouter'
  name: string;     // e.g., 'OpenAI', 'OpenAI Compatible', 'OpenRouter'
  icon: string;     // MaterialCommunityIcons name
}

export interface ModuleTypeConfig {
  id: string;
  name: string;
  icon: string;
  description: string;
  providerOptions: ProviderOption[];
  hasGeneralSettings: boolean;
  moduleSpecificFields: FieldDefinition[];
}

// ── Reactivated/new provider option entries (provider-registry 6-5) ──────────
// Shared option objects so the same provider renders identically wherever it
// appears (module pickers + the STT per-slot lists below).
const MISTRAL_OPTION: ProviderOption = { id: 'mistral', name: 'Mistral', icon: 'weather-windy' };
const OLLAMA_OPTION: ProviderOption = { id: 'ollama', name: 'Ollama', icon: 'paw' };
const LOCALAI_OPTION: ProviderOption = { id: 'localai', name: 'LocalAI', icon: 'server-network' };

// ── Per-slot STT provider lists (provider-registry 6-5 step 2, A11, R-AUDIO) ─
// The transcription and VAD slots no longer share one list. The lists are
// scoped to the engine clients that actually implement each capability:
//   • transcription — every provider with a transcription client, plus
//     soulvoice (A11: engine STT client exists; the app never offered it) and
//     the reactivated ollama (R-AUDIO: `POST /v1/audio/transcriptions` exists —
//     EXPERIMENTAL, no timestamps/segments, gemma4-only) and localai.
//   • vad — ONLY the two providers with real VADClient implementations
//     (soulbitscloud gateway `silero-vad`, soulvoice Silero). Today's shared
//     list over-offered VAD on providers with no VAD client; fixing that is
//     in-scope here.
export const STT_TRANSCRIPTION_PROVIDERS: ProviderOption[] = [
  { id: 'openai', name: 'OpenAI', icon: 'api' },
  { id: 'openaicompatible', name: 'OpenAI Compatible', icon: 'server' },
  { id: 'openrouter', name: 'OpenRouter', icon: 'router-wireless' },
  { id: 'soulbitscloud', name: 'Soulbits Cloud', icon: 'cloud' },
  { id: 'elevenlabs', name: 'ElevenLabs', icon: 'microphone' },
  { id: 'soulvoice', name: 'Soulvoice', icon: 'volume-high' },
  { id: 'ollama', name: 'Ollama (experimental)', icon: 'paw' },
  { id: 'localai', name: 'LocalAI', icon: 'server-network' },
];

export const STT_VAD_PROVIDERS: ProviderOption[] = [
  { id: 'soulbitscloud', name: 'Soulbits Cloud', icon: 'cloud' },
  { id: 'soulvoice', name: 'Soulvoice', icon: 'volume-high' },
];

/** Per-slot STT provider lists (the two STT slots never share a list). */
export const STT_SLOT_PROVIDER_OPTIONS: Record<'transcription' | 'vad', ProviderOption[]> = {
  transcription: STT_TRANSCRIPTION_PROVIDERS,
  vad: STT_VAD_PROVIDERS,
};

export const MODULE_TYPES: ModuleTypeConfig[] = [
  { id: 'backend', name: 'Backend', icon: 'brain', description: 'Main chat backend', providerOptions: [
    { id: 'openai', name: 'OpenAI', icon: 'api' },
    { id: 'openaicompatible', name: 'OpenAI Compatible', icon: 'server' },
    { id: 'openrouter', name: 'OpenRouter', icon: 'router-wireless' },
    { id: 'soulbitscloud', name: 'Soulbits Cloud', icon: 'cloud' },
    { id: 'google', name: 'Google Gemini', icon: 'google' },
    { id: 'xai', name: 'xAI / Grok', icon: 'rocket-launch' },
    { id: 'anthropic', name: 'Anthropic Claude', icon: 'head-lightbulb' },
    MISTRAL_OPTION,
    OLLAMA_OPTION,
    LOCALAI_OPTION,
  ], hasGeneralSettings: false, moduleSpecificFields: [] },
  { id: 'cognition', name: 'Cognition', icon: 'lightbulb-outline', description: 'Emotional cognition engine', providerOptions: [
    { id: 'openai', name: 'OpenAI', icon: 'api' },
    { id: 'openaicompatible', name: 'OpenAI Compatible', icon: 'server' },
    { id: 'openrouter', name: 'OpenRouter', icon: 'router-wireless' },
    { id: 'soulbitscloud', name: 'Soulbits Cloud', icon: 'cloud' },
    { id: 'google', name: 'Google Gemini', icon: 'google' },
    { id: 'xai', name: 'xAI / Grok', icon: 'rocket-launch' },
    { id: 'anthropic', name: 'Anthropic Claude', icon: 'head-lightbulb' },
    MISTRAL_OPTION,
    OLLAMA_OPTION,
    LOCALAI_OPTION,
  ], hasGeneralSettings: true, moduleSpecificFields: [
    {
      key: 'max_cognition_events',
      label: 'Max Cognition Events',
      type: 'number',
      placeholder: '10',
      tooltip: 'Number of recent interaction events evaluated per cognition cycle.',
    },
    {
      key: 'generate_expressions',
      label: 'Generate Expressions',
      type: 'toggle',
      toggleValueType: 'numeric',
      tooltip: 'Emit emotional and facial expression updates during cognition turns.',
    },
  ] },
  { id: 'movement', name: 'Movement', icon: 'run', description: 'Movement execution', providerOptions: [
    { id: 'openai', name: 'OpenAI', icon: 'api' },
    { id: 'openaicompatible', name: 'OpenAI Compatible', icon: 'server' },
    { id: 'openrouter', name: 'OpenRouter', icon: 'router-wireless' },
    { id: 'soulbitscloud', name: 'Soulbits Cloud', icon: 'cloud' },
    { id: 'google', name: 'Google Gemini', icon: 'google' },
    { id: 'xai', name: 'xAI / Grok', icon: 'rocket-launch' },
    { id: 'anthropic', name: 'Anthropic Claude', icon: 'head-lightbulb' },
    MISTRAL_OPTION,
    OLLAMA_OPTION,
    LOCALAI_OPTION,
  ], hasGeneralSettings: false, moduleSpecificFields: [
    {
      key: 'startup_sync_timeout',
      label: 'Startup Sync Timeout (ms)',
      type: 'number',
      width: 'half',
      disabledValue: 0,
      placeholder: '0 ms (none)',
      tooltip: 'Wait time for client sync at session start.',
    },
    {
      key: 'execution_threshold',
      label: 'Execution Threshold',
      type: 'number',
      width: 'half',
      step: 0.05,
      min: 0,
      max: 1,
      placeholder: '0.5',
      tooltip: 'Minimum confidence threshold (0–1).',
    },
  ] },
  { id: 'rag', name: 'RAG', icon: 'brain', description: 'Retrieval augmented generation', providerOptions: [
    { id: 'openai', name: 'OpenAI', icon: 'api' },
    { id: 'openaicompatible', name: 'OpenAI Compatible', icon: 'server' },
    { id: 'openrouter', name: 'OpenRouter', icon: 'router-wireless' },
    { id: 'soulbitscloud', name: 'Soulbits Cloud', icon: 'cloud' },
    MISTRAL_OPTION,
    OLLAMA_OPTION,
    LOCALAI_OPTION,
  ], hasGeneralSettings: false, moduleSpecificFields: [
    {
      key: 'embedding_concurrency',
      label: 'Embedding Concurrency',
      type: 'number',
      disabledValue: 0,
      placeholder: 'Auto (default)',
      tooltip: 'Maximum parallel embedding requests (leave empty for engine default).',
    },
  ] },
  { id: 'stt', name: 'STT', icon: 'microphone', description: 'Speech to text', providerOptions: STT_TRANSCRIPTION_PROVIDERS,
    hasGeneralSettings: false, moduleSpecificFields: [] },  // STT is special: two slots (transcription + VAD) — see STT_SLOT_PROVIDER_OPTIONS and ModuleConfigEditScreen
  { id: 'tts', name: 'TTS', icon: 'volume-high', description: 'Text to speech', providerOptions: [
    { id: 'openai', name: 'OpenAI', icon: 'api' },
    { id: 'openaicompatible', name: 'OpenAI Compatible', icon: 'server' },
    { id: 'openrouter', name: 'OpenRouter', icon: 'router-wireless' },
    { id: 'soulbitscloud', name: 'Soulbits Cloud', icon: 'cloud' },
    { id: 'elevenlabs', name: 'ElevenLabs', icon: 'microphone' },
    { id: 'soulvoice', name: 'Soulvoice', icon: 'volume-high' },
    LOCALAI_OPTION,
  ], hasGeneralSettings: false, moduleSpecificFields: [
    // Legacy scalar kept so saving a config never wipes it (hidden in the UI).
    { key: 'output_type', label: 'Output Type', type: 'text', placeholder: 'e.g. mp3, wav' },
    { key: 'vocalize_nonverbal', label: 'Vocalize Nonverbal Actions', type: 'toggle', toggleValueType: 'numeric', tooltip: 'Speak roleplay actions inside *asterisks*' },
    { key: 'words_to_replace', label: 'Pronunciation Overrides (Words to Replace)', type: 'comma-list', placeholder: 'e.g. Soulbits=Soul-bits, Ciel=See-el' },
  ] },
  { id: 'vision', name: 'Vision', icon: 'eye', description: 'Vision processing', providerOptions: [
    { id: 'openai', name: 'OpenAI', icon: 'api' },
    { id: 'openaicompatible', name: 'OpenAI Compatible', icon: 'server' },
    { id: 'openrouter', name: 'OpenRouter', icon: 'router-wireless' },
    { id: 'soulbitscloud', name: 'Soulbits Cloud', icon: 'cloud' },
    { id: 'google', name: 'Google Gemini', icon: 'google' },
    { id: 'xai', name: 'xAI / Grok', icon: 'rocket-launch' },
    { id: 'anthropic', name: 'Anthropic Claude', icon: 'head-lightbulb' },
    MISTRAL_OPTION,
    OLLAMA_OPTION,
    LOCALAI_OPTION,
  ], hasGeneralSettings: false, moduleSpecificFields: [
    {
      key: 'resolution_width',
      label: 'Max Width (px)',
      type: 'number',
      width: 'half',
      placeholder: '1024',
      tooltip: 'Maximum image width in pixels.',
    },
    {
      key: 'resolution_height',
      label: 'Max Height (px)',
      type: 'number',
      width: 'half',
      placeholder: '1024',
      tooltip: 'Maximum image height in pixels.',
    },
  ] },
  { id: 'imagination', name: 'Imagination', icon: 'lightbulb', description: 'Imagination engine', providerOptions: [
    { id: 'comfyui', name: 'ComfyUI', icon: 'palette' },
    { id: 'openai', name: 'OpenAI', icon: 'api' },
    { id: 'openrouter', name: 'OpenRouter', icon: 'router-wireless' },
    { id: 'soulbitscloud', name: 'Soulbits Cloud', icon: 'cloud' },
    { id: 'google', name: 'Google Gemini', icon: 'google' },
    { id: 'xai', name: 'xAI / Grok', icon: 'rocket-launch' },
  ], hasGeneralSettings: false, moduleSpecificFields: [] },
];
