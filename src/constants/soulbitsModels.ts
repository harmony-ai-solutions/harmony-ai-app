/**
 * Soulbits model catalog mapping.
 *
 * Maps each app module type to:
 *   (1) the filter query used against the public `GET /v1/models` catalog, and
 *   (2) a curated static fallback model id list used when the live catalog is
 *       unreachable (offline / network error).
 *
 * Consumed by `src/services/cloud/soulbitsModelsCatalog.ts` (live fetch + cache)
 * and `src/components/config/SoulbitsModelSelect.tsx` (selector UI).
 *
 * NOTE on fallback ids: these are a best-effort offline safety net. The live
 * catalog (`GET /v1/models`, public/unauthenticated) is the source of truth —
 * model ids are DB-seeded on the backend, so the static list is intentionally
 * minimal and MUST be validated against the live catalog when one is reachable.
 */

import type { paths } from '@harmony-ai-solutions/soulbits-api-client';

/** Query shape for `GET /v1/models` (mirrors the client's own ModelsQuery type). */
type ModelsQuery = NonNullable<paths['/v1/models']['get']>['parameters']['query'];

/**
 * Module-type → catalog filter query.
 *
 * Backend `model_type` values: llm | tts | stt | vad | image | embeddings |
 * rerank | voice_embed | audio_conversion | voice_conversion.
 * `input_modalities`/`output_modalities` are superset matches (text|audio|image|embedding).
 */
export const SOULBITS_MODEL_QUERY: Record<string, ModelsQuery> = {
  backend: { model_type: 'llm' },
  cognition: { model_type: 'llm' },
  movement: { model_type: 'llm' },
  rag: { model_type: 'embeddings' },
  tts: { model_type: 'tts' },
  stt: { model_type: 'stt' },
  vision: { input_modalities: ['image'] },
  imagination: { output_modalities: ['image'] },
};

/**
 * Module-type → static fallback model ids (offline safety net only).
 * Keep minimal; the live catalog is authoritative.
 *
 * Verified against the live catalog at https://beta.api.soulbits.app/v1/models
 * on 2026-07-31 — ids below are real entries; free-tier first, then core.
 */
export const SOULBITS_FALLBACK_MODELS: Record<string, string[]> = {
  backend: ['qwen-35-9b', 'starfallen-24b', 'gemma4-meromero-26b-a4b'],
  cognition: ['qwen-35-9b', 'starfallen-24b', 'gemma4-meromero-26b-a4b'],
  movement: ['qwen-35-9b', 'starfallen-24b', 'gemma4-meromero-26b-a4b'],
  rag: ['harrier-oss-v1-0-6b', 'qwen3-embed-4b'],
  tts: [
    'harmonyspeech',
    'kitten-tts-micro',
    'kitten-tts-mini',
    'kitten-tts-nano',
    'openvoice_v1',
    'openvoice_v2',
    'chatterbox',
    'chatterbox_multilingual',
    'chatterbox_turbo',
  ],
  stt: ['faster-whisper-tiny', 'faster-whisper-large-v3-turbo'],
  vision: ['qwen-35-9b', 'gemma4-meromero-26b-a4b'],
  imagination: [],
};

/** Catalog filter query for a module type, or undefined when unmapped. */
export const getModelsQueryForModule = (moduleType: string): ModelsQuery | undefined =>
  SOULBITS_MODEL_QUERY[moduleType];

/** Static fallback model ids for a module type (empty array when none/unknown). */
export const getFallbackModelsForModule = (moduleType: string): string[] =>
  SOULBITS_FALLBACK_MODELS[moduleType] ?? [];
