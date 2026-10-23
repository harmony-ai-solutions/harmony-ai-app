/**
 * soulbitsModelDefaults — per-model default capability values for the
 * `soulbitscloud` provider.
 *
 * Source of truth: `.current_work/provider-registry/research/soulbits-model-defaults.md`
 * (code-expert research, 2026-10-23) built on the gateway research §8.3 and
 * the upstream model families' documented generation configs.
 *
 * Two hard rules from that research:
 *  1. HSE (the TTS/STT/VAD worker) **raises** on cross-family generation
 *     params — it does not ignore them. A key the model does not support must
 *     be ABSENT from the request, never `0`/`false`. Switching models prunes
 *     those keys (see {@link SOULBITS_MODEL_UNSUPPORTED}).
 *  2. `format`/`sample_rate` are never read by the worker — output is always
 *     WAV at the model's native rate. Defaults seed the truthful values so the
 *     label matches reality.
 *
 * NOTE (engine prerequisite): the Go engine's
 * `SoulbitsCloudProviderConfig`/`RenderSpeech` currently forwards only
 * `voice`, `speed`, `format`, `language` for TTS — `pitch`, `energy`,
 * `exaggeration`, `cfg_weight`, `style`, `seed`, `norm_loudness` are dropped
 * engine-side until `harmony-link-private` is extended. Seeding them here is
 * still correct (they become effective the moment the engine forwards them)
 * and keeps the UI's supported/unsupported gating honest in the meantime.
 */

import type { ModuleCapabilityScope } from './providerFieldSchemas';
import { getProviderFieldsForModule } from './providerFieldSchemas';

/** A single default value; `norm_loudness` is boolean, selects are strings. */
export type SoulbitsDefaultValue = number | string | boolean;

/**
 * Per-module default model ids (research soulbitscloud.md §8.3 — free-tier,
 * catalog-valid choices aligned with the engine seeder). Imagination is
 * intentionally absent: no production image model exists.
 */
export const SOULBITS_MODULE_DEFAULT_MODEL: Record<string, string> = {
  backend: 'qwen-35-9b',
  cognition: 'qwen-35-9b',
  movement: 'qwen-35-9b',
  vision: 'qwen-35-9b',
  rag: 'harrier-oss-v1-0-6b',
  tts: 'kitten-tts-mini',
  stt: 'faster-whisper-tiny',
  vad: 'silero-vad',
};

/**
 * Base defaults per model id. ONLY keys the model actually honours —
 * unsupported keys are deliberately absent (rule 1 above). Provenance:
 * qwen-35-9b [official Qwen3.5 card, non-thinking]; starfallen-24b [derived:
 * Mistral-Small-3.2-24B base, roleplay-tuned]; gemma4 [official Google
 * generation_config 1.0/0.95]; TTS/VAD [hse + upstream defaults].
 */
export const SOULBITS_MODEL_DEFAULTS: Record<string, Record<string, SoulbitsDefaultValue>> = {
  // ── LLM ────────────────────────────────────────────────────────────────
  'qwen-35-9b': {
    temperature: 0.7, top_p: 0.8, max_tokens: 1024,
    frequency_penalty: 0, presence_penalty: 0,
    max_completion_tokens: 0, seed: 0, n: 0,
    stop_tokens: '', response_format: '', sampling_preset_name: '',
  },
  // Derived: Mistral-Small-3.2-24B-Instruct base via the Starfallen merge.
  // Mistral's 0.15/1.00 is a benchmark setting — too greedy for roleplay.
  'starfallen-24b': {
    temperature: 0.75, top_p: 0.95, max_tokens: 1024,
    frequency_penalty: 0, presence_penalty: 0,
    max_completion_tokens: 0, seed: 0, n: 0,
    stop_tokens: '', response_format: '', sampling_preset_name: '',
  },
  // Google's standardized config: temp 1.0 / top_p 0.95 (top_k 64 not on the
  // schema). 1.0 runs hot for a companion — module overrides tone it down.
  'gemma4-meromero-26b-a4b': {
    temperature: 1.0, top_p: 0.95, max_tokens: 1024,
    frequency_penalty: 0, presence_penalty: 0,
    max_completion_tokens: 0, seed: 0, n: 0,
    stop_tokens: '', response_format: '', sampling_preset_name: '',
  },

  // ── Embeddings / STT (no tunables on the current schema) ───────────────
  'harrier-oss-v1-0-6b': {},
  'qwen3-embed-4b': {},
  'faster-whisper-tiny': {},
  'faster-whisper-large-v3-turbo': {},

  // ── TTS ────────────────────────────────────────────────────────────────
  'kitten-tts-mini': { voice: 'Bella', language: 'default', speed: 1.0, format: 'wav', sample_rate: '24000' },
  'kitten-tts-micro': { voice: 'Bella', language: 'default', speed: 1.0, format: 'wav', sample_rate: '24000' },
  'kitten-tts-nano': { voice: 'Bella', language: 'default', speed: 1.0, format: 'wav', sample_rate: '24000' },
  // HarmonySpeech: speaker comes from an embedding — no voice/language ids.
  'harmonyspeech': {
    speed: 1.0, pitch: 1.0, energy: 1.0,
    voice: '', language: '', format: 'wav', sample_rate: '22050',
  },
  'openvoice_v1': { voice: 'default', language: 'EN', speed: 1.0, format: 'wav', sample_rate: '22050' },
  'openvoice_v2': { voice: 'EN-Newest', language: 'EN', speed: 1.0, format: 'wav', sample_rate: '44100' },
  'chatterbox': {
    exaggeration: 0.5, cfg_weight: 0.5,
    voice: '', language: '', format: 'wav', sample_rate: '24000',
  },
  'chatterbox_multilingual': {
    exaggeration: 0.5, cfg_weight: 0.5, language: 'en',
    voice: '', format: 'wav', sample_rate: '24000',
  },
  // Turbo REJECTS exaggeration/cfg_weight/min_p — they must be absent.
  'chatterbox_turbo': { norm_loudness: true, format: 'wav', sample_rate: '24000' },

  // ── VAD ────────────────────────────────────────────────────────────────
  'silero-vad': {
    threshold: 0.5, min_speech_duration_ms: 250,
    min_silence_duration_ms: 100, speech_pad_ms: 30, return_seconds: 0,
  },
};

/**
 * Capability keys each model MUST NOT carry (HSE raises on cross-family
 * params — `is not None` checks, so `0`/`false` are just as fatal). Stripped
 * when switching to the model.
 */
export const SOULBITS_MODEL_UNSUPPORTED: Record<string, string[]> = {
  'kitten-tts-mini': ['pitch', 'energy', 'exaggeration', 'cfg_weight', 'style', 'seed', 'norm_loudness'],
  'kitten-tts-micro': ['pitch', 'energy', 'exaggeration', 'cfg_weight', 'style', 'seed', 'norm_loudness'],
  'kitten-tts-nano': ['pitch', 'energy', 'exaggeration', 'cfg_weight', 'style', 'seed', 'norm_loudness'],
  'harmonyspeech': ['style', 'exaggeration', 'cfg_weight', 'seed', 'norm_loudness'],
  'openvoice_v1': ['pitch', 'energy', 'style', 'exaggeration', 'cfg_weight', 'seed', 'norm_loudness'],
  'openvoice_v2': ['pitch', 'energy', 'style', 'exaggeration', 'cfg_weight', 'seed', 'norm_loudness'],
  'chatterbox': ['speed', 'pitch', 'energy', 'style', 'seed', 'norm_loudness'],
  'chatterbox_multilingual': ['speed', 'pitch', 'energy', 'style', 'seed', 'norm_loudness'],
  'chatterbox_turbo': ['exaggeration', 'cfg_weight', 'style', 'seed', 'speed', 'pitch', 'energy'],
};

/**
 * Module-scoped sampling overrides — same model, different job. Chat stays
 * creative; cognition/movement/vision run cooler with capped max_tokens so
 * cheap classification turns don't burn the context budget.
 */
export const SOULBITS_MODEL_MODULE_OVERRIDES: Record<
  string,
  Partial<Record<ModuleCapabilityScope, Record<string, SoulbitsDefaultValue>>>
> = {
  'qwen-35-9b': {
    cognition: { temperature: 0.3, top_p: 0.8, max_tokens: 256 },
    movement: { temperature: 0.2, top_p: 0.8, max_tokens: 256 },
    vision: { temperature: 0.3, top_p: 0.8, max_tokens: 512 },
  },
  'starfallen-24b': {
    cognition: { temperature: 0.3, top_p: 0.9, max_tokens: 256 },
    movement: { temperature: 0.2, top_p: 0.9, max_tokens: 192 },
  },
  'gemma4-meromero-26b-a4b': {
    backend: { temperature: 0.95, top_p: 0.95, max_tokens: 1024 },
    cognition: { temperature: 0.3, top_p: 0.9, max_tokens: 256 },
    movement: { temperature: 0.2, top_p: 0.9, max_tokens: 256 },
    vision: { temperature: 0.2, top_p: 0.9, max_tokens: 512 },
  },
};

/**
 * The next capability object for a model selection:
 *  - prunes keys the new model does not support (prevents
 *    chatterbox → chatterbox_turbo "ValueError: exaggeration is not supported"),
 *  - prunes keys the module's field schema does not expose,
 *  - overlays the model's defaults + module overrides (a `temperature` tuned
 *    for Qwen is meaningless for Gemma — switching models reseeds),
 *  - sets `model` last.
 *
 * Unknown model ids (gateway rows we have no research for) keep the pruned
 * previous overlay + the module-scoped provider defaults, so nothing breaks
 * when the catalog grows.
 */
export function nextSoulbitsCapability(
  prev: Record<string, unknown> | null | undefined,
  modelId: string,
  moduleType: string,
): Record<string, unknown> {
  const unsupported = new Set(SOULBITS_MODEL_UNSUPPORTED[modelId] ?? []);
  const allowed = new Set(
    getProviderFieldsForModule('soulbitscloud', moduleType).map((f) => f.key),
  );
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(prev ?? {})) {
    if (key === 'model') continue; // set below
    if (unsupported.has(key)) continue; // model-incompatible
    if (allowed.size > 0 && !allowed.has(key)) continue; // module-foreign
    next[key] = value;
  }
  const base = SOULBITS_MODEL_DEFAULTS[modelId] ?? {};
  const over = SOULBITS_MODEL_MODULE_OVERRIDES[modelId]?.[moduleType as ModuleCapabilityScope] ?? {};
  for (const [key, value] of Object.entries({ ...base, ...over })) {
    if (allowed.size > 0 && !allowed.has(key)) continue;
    next[key] = value;
  }
  next.model = modelId;
  return next;
}
