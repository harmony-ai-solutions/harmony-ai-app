/**
 * useProviderModels — per-slot live model/voice discovery hook
 * (provider-registry 6-3, plan §6.2/§3.2).
 *
 * Owns the on-demand "Fetch from provider" state for ONE provider slot:
 *  - `fetchNow()` runs the discovery immediately (the explicit button);
 *  - `scheduleFetch()` debounces it (account-switch revalidation, plan §3.2);
 *  - the underlying {@link fetchProviderModels} caches by account signature.
 *
 * `models`/`voices` stay `null` until the first fetch so the caller can tell
 * "not fetched yet" (show the offline catalog) from "fetched, empty".
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModelInfoDto, VoiceInfoDto } from '../services/engine/EngineApiClient';
import { fetchProviderModels } from '../services/providers/providerModelFetch';
import { parseAccountExtra } from '../constants/accountFieldSchemas';
import type { ProviderAccount } from '../database/models';

/** Default debounce for account-switch revalidation (ms). */
export const PROVIDER_MODEL_DEBOUNCE_MS = 200;

export interface UseProviderModelsResult {
  /** Live-discovered models, or null before the first fetch. */
  models: ModelInfoDto[] | null;
  /** Live-discovered account voices (ElevenLabs), or null before the first fetch. */
  voices: VoiceInfoDto[] | null;
  fetching: boolean;
  error: string | null;
  /** Run the discovery immediately (button press). */
  fetchNow: () => void;
  /** Run the discovery after a short debounce (account switch). */
  scheduleFetch: () => void;
}

interface UseProviderModelsParams {
  type: string;
  account: ProviderAccount | null;
  module: string;
  debounceMs?: number;
}

export function useProviderModels({
  type,
  account,
  module,
  debounceMs = PROVIDER_MODEL_DEBOUNCE_MS,
}: UseProviderModelsParams): UseProviderModelsResult {
  const [models, setModels] = useState<ModelInfoDto[] | null>(null);
  const [voices, setVoices] = useState<VoiceInfoDto[] | null>(null);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  // Guards against a slow in-flight fetch clobbering a newer one.
  const requestSeq = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const accountId = account?.id ?? '';
  const accountKey = account?.api_key ?? '';
  const accountBase = account?.base_url ?? '';
  const accountExtra = account?.extra ?? '';

  const run = useCallback(async () => {
    if (!type || !accountId) return;
    const seq = ++requestSeq.current;
    setFetching(true);
    setError(null);
    try {
      const res = await fetchProviderModels({
        type,
        module,
        ...(accountKey ? { api_key: accountKey } : {}),
        ...(accountBase ? { base_url: accountBase } : {}),
        extra: parseAccountExtra(accountExtra),
      });
      if (!alive.current || seq !== requestSeq.current) return;
      setModels(res.models);
      setVoices(res.voices);
      setError(res.error ?? null);
    } catch (e) {
      if (!alive.current || seq !== requestSeq.current) return;
      setError((e as Error)?.message ?? 'Failed to fetch models');
    } finally {
      if (alive.current && seq === requestSeq.current) setFetching(false);
    }
  }, [type, accountId, accountKey, accountBase, accountExtra, module]);

  const fetchNow = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    void run();
  }, [run]);

  const scheduleFetch = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void run();
    }, debounceMs);
  }, [run, debounceMs]);

  return { models, voices, fetching, error, fetchNow, scheduleFetch };
}
