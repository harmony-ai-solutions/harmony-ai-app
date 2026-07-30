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
 */
export const SOULBITS_FALLBACK_MODELS: Record<string, string[]> = {
  backend: ['soulchat-v1'],
  cognition: ['soulchat-v1'],
  movement: ['soulchat-v1'],
  rag: ['soul-embed-v1'], // placeholder — verify against live catalog
  tts: ['soul-tts-v1'], // placeholder — verify against live catalog
  stt: ['whisper'],
  vision: [],
  imagination: [],
};

/** Catalog filter query for a module type, or undefined when unmapped. */
export const getModelsQueryForModule = (moduleType: string): ModelsQuery | undefined =>
  SOULBITS_MODEL_QUERY[moduleType];

/** Static fallback model ids for a module type (empty array when none/unknown). */
export const getFallbackModelsForModule = (moduleType: string): string[] =>
  SOULBITS_FALLBACK_MODELS[moduleType] ?? [];
