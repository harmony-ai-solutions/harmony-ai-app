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
 *    warnings: a model whose `param_support` is DECLARED and omits a param →
 *    warn (never block); UNDECLARED → no warning (sparse coverage pre-5-2,
 *    plan 6-3 step 3). `capabilities` is NEVER consulted here — it carries
 *    modality tags, not sampling-parameter names.
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
 *
 * IMPORTANT: only `param_support` is consulted. `capabilities` carries
 * high-level modality/feature tags (`"vision"`, `"reasoning"`, `"tools"`, …),
 * NEVER sampling-parameter names — merging it in produced false-positive
 * `⚠ Not supported` badges on every sampling param (R12 regression).
 */
export function supportedParams(
  model: ModelInfoDto | null | undefined,
): ReadonlySet<string> | null {
  if (!model) return null;
  const declared = model.param_support ?? [];
  if (declared.length === 0) return null;
  return new Set(declared);
}

/**
 * Split capability fields into the ones the selected model supports and the
 * ones it genuinely does not. When the model declares no `param_support`
 * (`supportedParams` → `null`) NOTHING is unsupported: every field is
 * supported (unknown ⇒ never warn/hide).
 */
export function partitionFieldsBySupport<T extends { key: string }>(
  fields: readonly T[],
  model: ModelInfoDto | null | undefined,
): { supportedFields: T[]; unsupportedFields: T[] } {
  const supported = supportedParams(model);
  if (!supported) {
    return { supportedFields: [...fields], unsupportedFields: [] };
  }
  const supportedFields: T[] = [];
  const unsupportedFields: T[] = [];
  for (const field of fields) {
    if (supported.has(field.key)) supportedFields.push(field);
    else unsupportedFields.push(field);
  }
  return { supportedFields, unsupportedFields };
}

/**
 * Capability-tree metadata attached by the engine to TTS model descriptors
 * (`ModelInfo.meta.speech_options`, Phase 2-4 / 3-5). Loose by design: the
 * engine owns the shape and may add fields without an app DTO break.
 */
export interface SpeechOptionsMeta {
  /** `single_speaker_tts` / `voice_cloning` / `instant_clone` / `voice_design`. */
  operation_modes?: string[];
  supports_voice_cloning?: boolean;
  supports_voice_design?: boolean;
  /**
   * The model's speakable languages. Shape varies per provider (research
   * soulvoice §3.2 / the gateway's `SpeechOptions`):
   *  - soulvoice (HSE live): plain language NAMES — `["default", "en", …]`
   *  - soulbitscloud (gateway): descriptors — `[{code: "EN", name: "English",
   *    voices: ["Bella", …]}, …]`, where `voices` is scoped to that language
   *  - the app's offline catalog: absent (fallback list applies)
   */
  languages?: Array<
    | string
    | {
        code?: string;
        name?: string;
        language?: string;
        id?: string;
        voices?: Array<string | { id?: string; name?: string; voice?: string }>;
      }
  >;
  /**
   * Built-in voice ids/names. Also shape-varied: plain strings
   * (`soulbitscloud` gateway flat voices — present only when the model accepts
   * `voice` WITHOUT a language scope, e.g. KittenTTS) or descriptors
   * (`{voice, language?, styles?}` — soulvoice live; `{id?, name?}` — the
   * app's interim assumption).
   */
  voices?: Array<string | { id?: string; name?: string; voice?: string }>;
  /** Chatterbox-style tags (`[laughter]`, `[sigh]`, …). */
  paralinguistic_tags?: string[];
  /** Generation params the model accepts (`pitch`, `speed`, `cfg_weight`, …). */
  supported_generation_params?: string[];
  [key: string]: unknown;
}

/**
 * Read `model.meta.speech_options` (the engine's TTS capability tree), or
 * `null` when the model (or its metadata) does not declare any.
 */
export function getSpeechOptions(
  model: ModelInfoDto | null | undefined,
): SpeechOptionsMeta | null {
  const raw = (model?.meta as Record<string, unknown> | undefined)?.['speech_options'];
  if (!raw || typeof raw !== 'object') return null;
  return raw as SpeechOptionsMeta;
}

/**
 * Resolve the effective TTS `SpeechOptionsMeta` for a provider + model ID,
 * enriching sparse/cached catalog descriptors on `soulbitscloud` and
 * `soulvoice` so the UI always knows whether the model belongs to the
 * OpenVoice/HarmonySpeech family (`speed`, `pitch`, `energy`, `style`, `seed`)
 * or the Chatterbox family (`exaggeration`, `cfg_weight`, paralinguistic tags,
 * sampling params, `norm_loudness`) and exposes the Voice Cloning workflow.
 */
export function resolveEffectiveSpeechOptions(
  model: ModelInfoDto | null | undefined,
  modelId?: string | null,
  providerType?: string | null,
): SpeechOptionsMeta | null {
  const declared = getSpeechOptions(model);
  if (declared && Array.isArray(declared.supported_generation_params) && declared.supported_generation_params.length > 0) {
    return declared;
  }

  const slug = String(modelId ?? model?.id ?? '').toLowerCase();
  const isSoul = providerType === 'soulbitscloud' || providerType === 'soulvoice';

  if (slug.includes('chatterbox')) {
    return {
      ...declared,
      supports_voice_cloning: true,
      operation_modes: declared?.operation_modes ?? ['single_speaker_tts', 'voice_cloning'],
      paralinguistic_tags: declared?.paralinguistic_tags ?? [
        '[laughter]',
        '[sigh]',
        '[gasp]',
        '[chuckle]',
        '[clears throat]',
      ],
      supported_generation_params: [
        'exaggeration',
        'cfg_weight',
        'temperature',
        'repetition_penalty',
        'top_p',
        'min_p',
        'top_k',
        'norm_loudness',
        'seed',
      ],
    };
  }

  if (isSoul) {
    return {
      ...declared,
      supports_voice_cloning: declared?.supports_voice_cloning ?? true,
      operation_modes: declared?.operation_modes ?? ['single_speaker_tts', 'voice_cloning'],
      supported_generation_params: ['speed', 'pitch', 'energy', 'style', 'seed'],
    };
  }

  return declared;
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
