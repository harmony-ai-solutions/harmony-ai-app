/**
 * providerModelCatalog — interim app-side (tier-2) model catalog.
 *
 * Phase 2-1 of the provider-registry workstream. This is the *tier-2* static
 * catalog that backs the model pickers in the provider config forms until the
 * engine's `go:embed` capability registry lands (Phase 5-2, R12/§6.3), at
 * which point this constant is retired and replaced by
 * `GET /api/providers/capabilities`.
 *
 * Provenance: every entry is transcribed from the per-provider research seed
 * tables in `.current_work/provider-registry/research/*.md` §7
 * (openai/anthropic/google/xai/mistral). Per plan §11 A7, 2-1 covers ONLY the
 * providers that HAVE a research seed table; the remaining picker-offered
 * providers are **live-authoritative** (SYNTHESIS §3) and carry an explicit
 * empty list here — their pickers keep the free-text behaviour until the
 * engine's live discovery (`POST /api/providers/models`) is wired in Phase 6-5.
 *
 * Tag vocabulary is the app-side subset of the research capability tags; the
 * engine's richer `ModelInfo` (modalities/capabilities/param_support) is
 * intentionally out of scope here.
 *
 * Labels: `label` carries the provider's display name where the research seed
 * table supplies one (Google's Display column); otherwise it defaults to the
 * model id. The engine catalog (5-2) will supply richer labels later.
 *
 * Retired / "do NOT seed" rows from the research docs are deliberately absent
 * (they would offer dead models); deprecated-but-working rows are included with
 * a `notes` flag so the picker can still resolve them until shutdown.
 */

/** Capability tag vocabulary used by the app-side catalog. */
export type ModelTag = 'chat' | 'vision' | 'embedding' | 'tts' | 'image' | 'stt';

export interface ModelCatalogEntry {
  /** The wire model id sent to the provider. */
  id: string;
  /** Human-readable label for the picker (defaults to `id`). */
  label: string;
  /** Capability tags this model satisfies. */
  tags: ModelTag[];
  /** Context window / max input tokens, where the research documents it. */
  context?: number;
  /** Free-text note surfaced to the user (deprecation, quirks, …). */
  notes?: string;
}

/**
 * Module type → capability tag. The model picker for a module only offers
 * catalog entries carrying the mapped tag (plan 6.2 / phase 2-1 step 1).
 *
 * The STT VAD slot is intentionally absent: VAD models (e.g. `silero-vad`) are
 * live-only and never catalogued (SYNTHESIS §3) — `getModelsForModule` returns
 * `[]` for it, so the VAD model field keeps its free-text fallback.
 */
export const MODULE_TYPE_TAGS: Record<string, ModelTag> = {
  backend: 'chat',
  cognition: 'chat',
  movement: 'chat',
  rag: 'embedding',
  tts: 'tts',
  stt: 'stt',
  vision: 'vision',
  imagination: 'image',
};

/** All provider types known to the app (matches PROVIDER_SCHEMAS keys). */
export const CATALOG_PROVIDER_TYPES: readonly string[] = [
  'openai',
  'openaicompatible',
  'openrouter',
  'elevenlabs',
  'soulvoice',
  'localai',
  'mistral',
  'ollama',
  'comfyui',
  'google',
  'xai',
  'anthropic',
  'soulbitscloud',
];

/**
 * The static catalog, keyed by provider type. Live-authoritative providers map
 * to `[]` (explicit empty-list allowance — see the module docblock).
 */
export const PROVIDER_MODEL_CATALOG: Record<string, ModelCatalogEntry[]> = {
  // ── OpenAI — research/openai.md §7 (API reports no capability metadata) ──
  openai: [
    // Text / chat / reasoning (text + image in → text out)
    { id: 'gpt-6-astra', label: 'gpt-6-astra', tags: ['chat', 'vision'], context: 1050000, notes: 'Flagship; reasoning effort low→max (no none); no function calling on Chat Completions.' },
    { id: 'gpt-6.1-sol', label: 'gpt-6.1-sol', tags: ['chat', 'vision'], context: 1050000, notes: 'Near-Astra, lower cost; effort no none/minimal.' },
    { id: 'gpt-6-sol', label: 'gpt-6-sol', tags: ['chat', 'vision'], context: 1050000, notes: 'Coding / agentic.' },
    { id: 'gpt-6-luna', label: 'gpt-6-luna', tags: ['chat', 'vision'], context: 1050000, notes: 'Cheapest GPT-6; EU residency.' },
    { id: 'gpt-5.6-sol', label: 'gpt-5.6-sol', tags: ['chat', 'vision'], context: 1050000, notes: 'GPT-5.6 flagship (alias gpt-5.6).' },
    { id: 'gpt-5.6-terra', label: 'gpt-5.6-terra', tags: ['chat', 'vision'], context: 1050000, notes: 'Mini tier.' },
    { id: 'gpt-5.6-luna', label: 'gpt-5.6-luna', tags: ['chat', 'vision'], context: 1050000, notes: 'Cheapest GPT-5.6.' },
    { id: 'gpt-5.5', label: 'gpt-5.5', tags: ['chat', 'vision'], context: 1050000 },
    { id: 'gpt-5.5-pro', label: 'gpt-5.5-pro', tags: ['chat', 'vision'], context: 1050000, notes: 'reasoning.mode pro.' },
    { id: 'gpt-5.4', label: 'gpt-5.4', tags: ['chat', 'vision'], context: 1050000 },
    { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini', tags: ['chat', 'vision'], context: 1050000 },
    { id: 'gpt-5.4-pro', label: 'gpt-5.4-pro', tags: ['chat', 'vision'], context: 1050000 },
    { id: 'gpt-5.2', label: 'gpt-5.2', tags: ['chat', 'vision'], context: 1050000 },
    { id: 'gpt-5.2-pro', label: 'gpt-5.2-pro', tags: ['chat', 'vision'], context: 1050000 },
    { id: 'gpt-5.1', label: 'gpt-5.1', tags: ['chat', 'vision'], context: 1050000, notes: 'Deprecated 2027-04-01.' },
    { id: 'gpt-5', label: 'gpt-5', tags: ['chat', 'vision'], context: 1050000 },
    { id: 'gpt-4.1', label: 'gpt-4.1', tags: ['chat', 'vision'], notes: 'Deprecated — shutdown 2027-01-14.' },
    { id: 'gpt-4.1-mini', label: 'gpt-4.1-mini', tags: ['chat', 'vision'], notes: 'Deprecated — shutdown 2027-01-14.' },
    { id: 'gpt-4.1-nano', label: 'gpt-4.1-nano', tags: ['chat', 'vision'], notes: 'Deprecated — shutdown 2027-01-14.' },
    { id: 'gpt-4o', label: 'gpt-4o', tags: ['chat', 'vision'], context: 128000, notes: 'Deprecated — shutdown 2027-01-14.' },
    { id: 'gpt-4o-mini', label: 'gpt-4o-mini', tags: ['chat', 'vision'], context: 128000, notes: 'Deprecated — shutdown 2027-01-14.' },
    { id: 'o3', label: 'o3', tags: ['chat', 'vision'], notes: 'stop unsupported.' },
    { id: 'o3-pro', label: 'o3-pro', tags: ['chat', 'vision'] },
    { id: 'o4-mini', label: 'o4-mini', tags: ['chat', 'vision'], notes: 'stop unsupported.' },
    { id: 'o1', label: 'o1', tags: ['chat', 'vision'] },
    { id: 'gpt-oss-120b', label: 'gpt-oss-120b', tags: ['chat'], notes: 'Apache-2.0 open weights.' },
    { id: 'gpt-oss-20b', label: 'gpt-oss-20b', tags: ['chat'], notes: 'Apache-2.0 open weights.' },
    // Embeddings
    { id: 'text-embedding-3-large', label: 'text-embedding-3-large', tags: ['embedding'], context: 8192, notes: '3072 dims; supports dimensions.' },
    { id: 'text-embedding-3-small', label: 'text-embedding-3-small', tags: ['embedding'], context: 8192, notes: '1536 dims.' },
    { id: 'text-embedding-ada-002', label: 'text-embedding-ada-002', tags: ['embedding'], context: 8192, notes: 'Legacy.' },
    // Image generation / editing
    { id: 'gpt-image-2.5-sunburst', label: 'gpt-image-2.5-sunburst', tags: ['image'], notes: 'Most capable; default for edits.' },
    { id: 'gpt-image-2.5-flare', label: 'gpt-image-2.5-flare', tags: ['image'], notes: 'Fastest everyday generation.' },
    { id: 'gpt-image-2', label: 'gpt-image-2', tags: ['image'] },
    { id: 'gpt-image-1.5', label: 'gpt-image-1.5', tags: ['image'], notes: 'Deprecated — shutdown 2026-12-01.' },
    { id: 'gpt-image-1', label: 'gpt-image-1', tags: ['image'], notes: 'Deprecated — shutdown 2026-12-01.' },
    { id: 'gpt-image-1-mini', label: 'gpt-image-1-mini', tags: ['image'], notes: 'Deprecated — shutdown 2026-12-01.' },
    // Text-to-speech
    { id: 'gpt-4o-mini-tts', label: 'gpt-4o-mini-tts', tags: ['tts'], notes: 'Current recommended TTS; 13 voices.' },
    { id: 'tts-1', label: 'tts-1', tags: ['tts'], notes: 'Deprecated — shutdown 2027-01-06.' },
    { id: 'tts-1-hd', label: 'tts-1-hd', tags: ['tts'], notes: 'Deprecated — shutdown 2027-01-06.' },
    // Speech-to-text (transcription)
    { id: 'gpt-transcribe', label: 'gpt-transcribe', tags: ['stt'] },
    { id: 'gpt-live-transcribe', label: 'gpt-live-transcribe', tags: ['stt'] },
    { id: 'gpt-4o-transcribe', label: 'gpt-4o-transcribe', tags: ['stt'], notes: 'Deprecated — shutdown 2027-02-26.' },
    { id: 'gpt-4o-mini-transcribe', label: 'gpt-4o-mini-transcribe', tags: ['stt'], notes: 'Deprecated — shutdown 2027-02-26.' },
    { id: 'gpt-4o-transcribe-diarize', label: 'gpt-4o-transcribe-diarize', tags: ['stt'], notes: 'Deprecated — shutdown 2027-02-26.' },
    { id: 'whisper-1', label: 'whisper-1', tags: ['stt'], notes: 'Deprecated — shutdown 2027-02-26.' },
  ],

  // ── Anthropic — research/anthropic.md §7 (all current models: text + image + tools) ──
  anthropic: [
    { id: 'claude-fable-5-1', label: 'claude-fable-5-1', tags: ['chat', 'vision'], context: 1000000, notes: 'Adaptive thinking always on; T params 400 if set.' },
    { id: 'claude-mythos-5-1', label: 'claude-mythos-5-1', tags: ['chat', 'vision'], context: 1000000, notes: 'Trusted-access; T params 400 if set.' },
    { id: 'claude-fable-5', label: 'claude-fable-5', tags: ['chat', 'vision'], context: 1000000, notes: 'Adaptive thinking always on.' },
    { id: 'claude-mythos-5', label: 'claude-mythos-5', tags: ['chat', 'vision'], context: 1000000, notes: 'Adaptive thinking always on.' },
    { id: 'claude-opus-5-5', label: 'claude-opus-5-5', tags: ['chat', 'vision'], context: 1000000, notes: 'Effort default medium; T params 400 if set.' },
    { id: 'claude-opus-5', label: 'claude-opus-5', tags: ['chat', 'vision'], context: 1000000, notes: 'T params 400 if set.' },
    { id: 'claude-opus-4-8', label: 'claude-opus-4-8', tags: ['chat', 'vision'], context: 1000000, notes: 'Thinking off by default; T params 400 if set.' },
    { id: 'claude-opus-4-7', label: 'claude-opus-4-7', tags: ['chat', 'vision'], context: 1000000, notes: 'First 1M-token model; T params 400 if set.' },
    { id: 'claude-opus-4-6', label: 'claude-opus-4-6', tags: ['chat', 'vision'], context: 1000000, notes: 'Extended thinking deprecated.' },
    { id: 'claude-opus-4-5', label: 'claude-opus-4-5', tags: ['chat', 'vision'], context: 200000, notes: 'Extended-only thinking; adaptive → 400.' },
    { id: 'claude-sonnet-5-5', label: 'claude-sonnet-5-5', tags: ['chat', 'vision'], context: 1000000, notes: 'T params 400 if set; effort default high.' },
    { id: 'claude-sonnet-5', label: 'claude-sonnet-5', tags: ['chat', 'vision'], context: 1000000, notes: 'T params 400 if set.' },
    { id: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6', tags: ['chat', 'vision'], context: 1000000 },
    { id: 'claude-sonnet-4-5', label: 'claude-sonnet-4-5', tags: ['chat', 'vision'], context: 200000, notes: 'DEPRECATED — retires 2026-11-30.' },
    { id: 'claude-haiku-5-5', label: 'claude-haiku-5-5', tags: ['chat', 'vision'], context: 1000000, notes: 'T params 400 if set.' },
    { id: 'claude-haiku-4-5', label: 'claude-haiku-4-5', tags: ['chat', 'vision'], context: 200000, notes: 'Extended-only thinking; no effort.' },
    { id: 'claude-mythos-preview', label: 'claude-mythos-preview', tags: ['chat', 'vision'], context: 1000000, notes: 'DEPRECATED since 2026-06-09.' },
  ],

  // ── Google — research/google.md §7 ──
  google: [
    { id: 'gemini-4-argon', label: 'Gemini 4 Argon', tags: ['chat', 'vision'], context: 1048576, notes: 'Flagship reasoning; no temp/topP/topK.' },
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', tags: ['chat', 'vision'], context: 1048576, notes: 'Current default Flash; no temp/topP/topK.' },
    { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', tags: ['chat', 'vision'], context: 1048576, notes: 'No temp/topP/topK.' },
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', tags: ['chat', 'vision'], context: 1048576 },
    { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', tags: ['chat', 'vision'], context: 1048576 },
    { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', tags: ['chat', 'vision'], context: 1048576, notes: 'Preview.' },
    { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash', tags: ['chat', 'vision'], context: 1048576, notes: 'Preview.' },
    { id: 'gemini-robotics-er-2-preview', label: 'Gemini Robotics ER 2', tags: ['vision'], context: 1048576, notes: 'Preview.' },
    { id: 'gemini-nano-banana-2.1', label: 'Nano Banana 2.1', tags: ['image'], notes: 'Image gen/edit.' },
    { id: 'gemini-3.1-flash-image', label: 'Nano Banana 2', tags: ['image'] },
    { id: 'gemini-3.1-flash-lite-image', label: 'Nano Banana 2 Lite', tags: ['image'] },
    { id: 'gemini-3-pro-image', label: 'Nano Banana Pro', tags: ['image'] },
    { id: 'gemini-3.8-flash-tts', label: 'Gemini 3.8 Flash TTS', tags: ['tts'], notes: 'Studio-grade TTS.' },
    { id: 'gemini-3.8-flash-lite-tts', label: 'Gemini 3.8 Flash-Lite TTS', tags: ['tts'], notes: 'Cheaper TTS.' },
    { id: 'gemini-3.1-flash-tts-preview', label: 'Gemini 3.1 Flash TTS', tags: ['tts'], notes: 'Legacy TTS preview.' },
    { id: 'gemini-3.5-transcribe', label: 'Gemini 3.5 Transcribe', tags: ['stt'] },
    { id: 'gemini-embedding-2', label: 'Gemini Embedding 2', tags: ['embedding'], notes: 'Multimodal.' },
    { id: 'gemini-embedding-001', label: 'Gemini Embedding', tags: ['embedding'], notes: 'Text embeddings.' },
  ],

  // ── xAI — research/xai.md §7 ──
  xai: [
    { id: 'grok-4.7', label: 'grok-4.7', tags: ['chat', 'vision'], context: 500000, notes: 'Flagship; reasoning cannot be disabled.' },
    { id: 'grok-4.6', label: 'grok-4.6', tags: ['chat', 'vision'], context: 500000, notes: 'Prior flagship.' },
    { id: 'grok-4.5', label: 'grok-4.5', tags: ['chat', 'vision'], context: 500000, notes: 'xhigh treated as high (gate cautiously).' },
    { id: 'grok-4.3', label: 'grok-4.3', tags: ['chat', 'vision'], context: 1000000, notes: 'Current retirement redirect target.' },
    { id: 'grok-4.20-0309-reasoning', label: 'grok-4.20-0309-reasoning', tags: ['chat', 'vision'], context: 1000000, notes: 'logprobs/top_logprobs ignored.' },
    { id: 'grok-4.20-0309-non-reasoning', label: 'grok-4.20-0309-non-reasoning', tags: ['chat', 'vision'], context: 1000000 },
    { id: 'grok-4.20-multi-agent-0309', label: 'grok-4.20-multi-agent-0309', tags: ['chat', 'vision'], context: 1000000, notes: 'reasoning.effort controls agent count.' },
    { id: 'grok-build-0.1', label: 'grok-build-0.1', tags: ['chat', 'vision'], context: 256000, notes: 'Aliases grok-code-fast-1.' },
    { id: 'grok-imagine-image-2.0', label: 'grok-imagine-image-2.0', tags: ['image'], notes: 'Current recommended.' },
    { id: 'grok-imagine-image-quality', label: 'grok-imagine-image-quality', tags: ['image'], notes: 'Retires 2026-11-02 → served by -2.0.' },
    { id: 'grok-imagine-image', label: 'grok-imagine-image', tags: ['image'], notes: '1.0; not affected by the Nov retirement.' },
  ],

  // ── Mistral — research/mistral.md §7 (dormant: not yet in pickers, Phase 6-5) ──
  mistral: [
    { id: 'mistral-large-4', label: 'mistral-large-4', tags: ['chat', 'vision'], context: 1000000, notes: 'Public Preview; reasoning_effort.' },
    { id: 'mistral-medium-3-5', label: 'mistral-medium-3-5', tags: ['chat', 'vision'], context: 256000, notes: 'reasoning_effort (recommend high).' },
    { id: 'mistral-small-2603', label: 'mistral-small-2603', tags: ['chat'], context: 256000, notes: 'Hybrid instruct/reasoning/coding.' },
    { id: 'mistral-large-2512', label: 'mistral-large-2512', tags: ['chat', 'vision'], context: 256000, notes: 'n-completions not supported.' },
    { id: 'ministral-14b-2512', label: 'ministral-14b-2512', tags: ['chat', 'vision'], context: 256000, notes: 'Edge; Apache-2.0.' },
    { id: 'ministral-8b-2512', label: 'ministral-8b-2512', tags: ['chat', 'vision'], context: 256000, notes: 'Edge; Apache-2.0.' },
    { id: 'ministral-3b-2512', label: 'ministral-3b-2512', tags: ['chat', 'vision'], context: 256000, notes: 'Edge; Apache-2.0.' },
    { id: 'zai-glm-5-3', label: 'zai-glm-5-3', tags: ['chat'], context: 1000000, notes: 'reasoning_effort low/high/max only.' },
    { id: 'codestral-2508', label: 'codestral-2508', tags: ['chat'], context: 128000, notes: 'FIM endpoint.' },
    { id: 'voxtral-small-2507', label: 'voxtral-small-2507', tags: ['chat'], context: 32000, notes: 'Audio-input instruct.' },
    { id: 'codestral-embed-2505', label: 'codestral-embed-2505', tags: ['embedding'], context: 8192, notes: '1536 dims.' },
    { id: 'mistral-embed-2312', label: 'mistral-embed-2312', tags: ['embedding'], context: 8192, notes: '1024 dims; used by engine RAG.' },
    { id: 'voxtral-mini-tts-2603', label: 'voxtral-mini-tts-2603', tags: ['tts'], notes: '9 languages.' },
    { id: 'voxtral-mini-2602', label: 'voxtral-mini-2602', tags: ['stt'], notes: 'Diarization; up to 3h.' },
    { id: 'voxtral-mini-transcribe-realtime-2602', label: 'voxtral-mini-transcribe-realtime-2602', tags: ['stt'], notes: 'Incompatible with diarize.' },
  ],

  // ── Live-authoritative providers (SYNTHESIS §3) — no static rows ──
  // openaicompatible / openrouter / elevenlabs / soulvoice / localai / ollama /
  // comfyui / soulbitscloud expose their models via live discovery only.
  openaicompatible: [],
  openrouter: [],
  elevenlabs: [],
  soulvoice: [],
  localai: [],
  ollama: [],
  comfyui: [],
  soulbitscloud: [],
};

/**
 * The catalog entries applicable to a (provider type × module type) pair,
 * filtered by the module's capability tag. Returns `[]` for an unknown module
 * type (e.g. the STT VAD slot) or a provider without a static catalog.
 */
export function getModelsForModule(
  providerType: string,
  moduleType: string,
): ModelCatalogEntry[] {
  const tag = MODULE_TYPE_TAGS[moduleType];
  if (!tag) return [];
  const entries = PROVIDER_MODEL_CATALOG[providerType];
  if (!entries) return [];
  return entries.filter(entry => entry.tags.includes(tag));
}
