/**
 * modelCapabilities — helpers over the engine's `ModelInfo` descriptors
 * (provider-registry 6-3, plan §6.2/§6.3/§3.2).
 *
 * Phase 6-3 retires the app-side interim catalog (`providerModelCatalog.ts`) in
 * favour of the engine's tier-2 capability registry (`GET
 * /api/providers/capabilities`) plus the on-demand live discovery
 * (`POST /api/providers/models`). This module holds the pure predicates the
 * pickers + capability forms share:
 *
 *  - {@link catalogModelsForModule} — filter a provider's OFFLINE catalog slice
 *    to the models applicable to a module (live lists are already
 *    engine-filtered via the route's `module` param and pass through unfiltered).
 *  - {@link isSamplingParamKey} / {@link isParamSupported} — the R12 param
 *    warnings: a model whose `param_support`/`capabilities` are DECLARED and omit
 *    a param → warn (never block); UNDECLARED → no warning (sparse coverage
 *    pre-5-2, plan 6-3 step 3).
 */

import type { ModelInfoDto } from '../services/engine/EngineApiClient';

/**
 * Module type → capability/modality tag used to filter the OFFLINE catalog. The
 * STT VAD slot is intentionally absent: VAD models are live-only (the engine's
 * `module=vad` discovery), so the offline catalog offers nothing for it.
 */
export const MODULE_CAPABILITY_TAGS: Record<string, string> = {
  backend: 'chat',
  cognition: 'chat',
  movement: 'chat',
  rag: 'embedding',
  tts: 'tts',
  stt: 'stt',
  vision: 'vision',
  imagination: 'image',
};

/** The capability/modality tags a model declares (empty = undeclared). */
function declaredTags(model: ModelInfoDto): string[] {
  return [...(model.capabilities ?? []), ...(model.modalities ?? [])];
}

/**
 * The OFFLINE catalog models applicable to a module. A model that declares NO
 * capability/modality metadata is kept (unknown ⇒ don't hide — offline-first,
 * never hide a model just because the catalog is sparse). An unknown module type
 * (e.g. the STT VAD slot) yields `[]` (live-only).
 */
export function catalogModelsForModule(
  models: ModelInfoDto[] | null | undefined,
  moduleType: string,
): ModelInfoDto[] {
  const tag = MODULE_CAPABILITY_TAGS[moduleType];
  if (!tag) return [];
  return (models ?? []).filter((model) => {
    const tags = declaredTags(model);
    return tags.length === 0 || tags.includes(tag);
  });
}

/**
 * Sampling-parameter capability keys the R12 warnings cover. Deliberately a
 * small explicit set (not every field) so the warning is auditable and never
 * fires on structural fields (model, voice, format, …).
 */
export const SAMPLING_PARAM_KEYS: ReadonlySet<string> = new Set([
  'temperature',
  'top_p',
  'top_k',
  'top_a',
  'min_p',
  'repetition_penalty',
  'frequency_penalty',
  'presence_penalty',
  'max_tokens',
  'max_completion_tokens',
  'max_output_tokens',
  'seed',
  'stop_tokens',
  'stop_sequences',
  'response_format',
  'response_mime_type',
  'reasoning_effort',
  'extra_params',
  'n',
  'number_of_images',
]);

/** True when the field key is a sampling parameter the R12 warnings cover. */
export function isSamplingParamKey(key: string): boolean {
  return SAMPLING_PARAM_KEYS.has(key);
}

/**
 * The set of parameters a model declares support for, or `null` when the model
 * declares NONE (sparse coverage ⇒ the caller emits no warning, R12 "undefined
 * ⇒ no warning").
 */
export function supportedParams(
  model: ModelInfoDto | null | undefined,
): ReadonlySet<string> | null {
  if (!model) return null;
  const declared = [...(model.param_support ?? []), ...(model.capabilities ?? [])];
  if (declared.length === 0) return null;
  return new Set(declared);
}

/**
 * Whether a model supports a sampling param. `true`/`false` when the model
 * declares its parameter set; `null` when undeclared (no warning — never block).
 */
export function isParamSupported(
  model: ModelInfoDto | null | undefined,
  key: string,
): boolean | null {
  const supported = supportedParams(model);
  if (!supported) return null;
  return supported.has(key);
}

/** Find a model by id across a merged list (live preferred, then catalog). */
export function findModel(
  models: ModelInfoDto[] | null | undefined,
  id: string | null | undefined,
): ModelInfoDto | undefined {
  if (!id) return undefined;
  return (models ?? []).find((model) => model.id === id);
}
