/**
 * providerModelFetch — the on-demand live model/voice discovery
 * (provider-registry 6-3, plan §6.2/R10).
 *
 * Wraps `POST /api/providers/models` (`EngineApiClient.listProviderModels`) with
 * a module-level cache keyed by `(type, module, base_url, api-key tail)` so a
 * re-selected account reuses the last result instead of re-hitting the provider
 * (comfyui enumerates per-node `object_info`, soulvoice fans out per-capability —
 * both expensive). The api_key never lands in the cache key in full.
 *
 * The engine reports a listing failure as HTTP 200 with an empty list + `error`,
 * so a failed discovery degrades to `models: []` (the picker keeps free text).
 */

import { engineApiClient } from '../engine/EngineApiClient';
import type {
  ModelInfoDto,
  VoiceInfoDto,
  ProviderProbeRequestDto,
} from '../engine/EngineApiClient';

export interface ProviderModelsResult {
  models: ModelInfoDto[];
  /** Account voices (ElevenLabs) — live-only, never catalogued. */
  voices: VoiceInfoDto[];
  /** Engine-reported listing error, when discovery failed. */
  error?: string;
}

const cache = new Map<string, ProviderModelsResult>();

/** Test seam — clears the live-discovery cache. */
export function clearProviderModelCache(): void {
  cache.clear();
}

function signature(body: ProviderProbeRequestDto): string {
  const keyTail = (body.api_key ?? '').slice(-8);
  return [body.type, body.module ?? '', body.base_url ?? '', keyTail].join('|');
}

/**
 * Execute the provider's discovery recipe (cached). A transport failure throws;
 * a provider-side listing failure resolves with `models: []` + `error`.
 */
export async function fetchProviderModels(
  body: ProviderProbeRequestDto,
): Promise<ProviderModelsResult> {
  const key = signature(body);
  const hit = cache.get(key);
  if (hit) return hit;
  const res = await engineApiClient.listProviderModels(body);
  const result: ProviderModelsResult = {
    models: res?.models ?? [],
    voices: res?.voices ?? [],
    ...(res?.error ? { error: res.error } : {}),
  };
  cache.set(key, result);
  return result;
}
