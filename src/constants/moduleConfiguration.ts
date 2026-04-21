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

export const MODULE_TYPES: ModuleTypeConfig[] = [
  { id: 'backend', name: 'Backend', icon: 'brain', description: 'Main chat backend', providerOptions: [
    { id: 'openai', name: 'OpenAI', icon: 'api' },
    { id: 'openaicompatible', name: 'OpenAI Compatible', icon: 'server' },
    { id: 'openrouter', name: 'OpenRouter', icon: 'router-wireless' },
    { id: 'kindroid', name: 'Kindroid', icon: 'robot' },
    { id: 'kajiwoto', name: 'Kajiwoto', icon: 'chat' },
    { id: 'characterai', name: 'Character.AI', icon: 'account-voice' },
  ], hasGeneralSettings: false, moduleSpecificFields: [] },
  { id: 'cognition', name: 'Cognition', icon: 'lightbulb-outline', description: 'Emotional cognition engine', providerOptions: [
    { id: 'openai', name: 'OpenAI', icon: 'api' },
    { id: 'openaicompatible', name: 'OpenAI Compatible', icon: 'server' },
    { id: 'openrouter', name: 'OpenRouter', icon: 'router-wireless' },
  ], hasGeneralSettings: true, moduleSpecificFields: [
    { key: 'max_cognition_events', label: 'Max Cognition Events', type: 'number', placeholder: '10' },
    { key: 'generate_expressions', label: 'Generate Expressions (0/1)', type: 'number', placeholder: '0 or 1' },
  ] },
  { id: 'movement', name: 'Movement', icon: 'run', description: 'Movement execution', providerOptions: [
    { id: 'openai', name: 'OpenAI', icon: 'api' },
    { id: 'openaicompatible', name: 'OpenAI Compatible', icon: 'server' },
    { id: 'openrouter', name: 'OpenRouter', icon: 'router-wireless' },
  ], hasGeneralSettings: false, moduleSpecificFields: [
    { key: 'startup_sync_timeout', label: 'Startup Sync Timeout', type: 'number', placeholder: '0' },
    { key: 'execution_threshold', label: 'Execution Threshold', type: 'number', placeholder: '0' },
  ] },
  { id: 'rag', name: 'RAG', icon: 'brain', description: 'Retrieval augmented generation', providerOptions: [
    { id: 'openai', name: 'OpenAI', icon: 'api' },
    { id: 'openaicompatible', name: 'OpenAI Compatible', icon: 'server' },
    { id: 'openrouter', name: 'OpenRouter', icon: 'router-wireless' },
  ], hasGeneralSettings: false, moduleSpecificFields: [
    { key: 'embedding_concurrency', label: 'Embedding Concurrency', type: 'number', placeholder: '0' },
  ] },
  { id: 'stt', name: 'STT', icon: 'microphone', description: 'Speech to text', providerOptions: [
    { id: 'openai', name: 'OpenAI', icon: 'api' },
    { id: 'openaicompatible', name: 'OpenAI Compatible', icon: 'server' },
    { id: 'openrouter', name: 'OpenRouter', icon: 'router-wireless' },
    { id: 'elevenlabs', name: 'ElevenLabs', icon: 'microphone' },
  ], hasGeneralSettings: false, moduleSpecificFields: [] },  // STT is special: handled separately in ModuleConfigEditScreen
  { id: 'tts', name: 'TTS', icon: 'volume-high', description: 'Text to speech', providerOptions: [
    { id: 'openai', name: 'OpenAI', icon: 'api' },
    { id: 'openaicompatible', name: 'OpenAI Compatible', icon: 'server' },
    { id: 'openrouter', name: 'OpenRouter', icon: 'router-wireless' },
    { id: 'elevenlabs', name: 'ElevenLabs', icon: 'microphone' },
    { id: 'harmonyspeech', name: 'HarmonySpeech', icon: 'volume-high' },
  ], hasGeneralSettings: false, moduleSpecificFields: [
    { key: 'output_type', label: 'Output Type', type: 'text', placeholder: 'e.g. mp3, wav' },
    { key: 'words_to_replace', label: 'Words to Replace', type: 'text', placeholder: 'Comma-separated words' },
    { key: 'vocalize_nonverbal', label: 'Vocalize Nonverbal (0/1)', type: 'number', placeholder: '0 or 1' },
  ] },
  { id: 'vision', name: 'Vision', icon: 'eye', description: 'Vision processing', providerOptions: [
    { id: 'openai', name: 'OpenAI', icon: 'api' },
    { id: 'openaicompatible', name: 'OpenAI Compatible', icon: 'server' },
    { id: 'openrouter', name: 'OpenRouter', icon: 'router-wireless' },
  ], hasGeneralSettings: false, moduleSpecificFields: [
    { key: 'resolution_width', label: 'Resolution Width', type: 'number', placeholder: '1024' },
    { key: 'resolution_height', label: 'Resolution Height', type: 'number', placeholder: '1024' },
  ] },
  { id: 'imagination', name: 'Imagination', icon: 'lightbulb', description: 'Imagination engine', providerOptions: [
    { id: 'openai', name: 'OpenAI', icon: 'api' },
    { id: 'openaicompatible', name: 'OpenAI Compatible', icon: 'server' },
    { id: 'openrouter', name: 'OpenRouter', icon: 'router-wireless' },
  ], hasGeneralSettings: false, moduleSpecificFields: [] },
];