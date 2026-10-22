/**
 * useProviderCapabilityCatalog — the engine's tier-2 capability registry
 * (provider-registry 6-3, plan §6.2/§6.3).
 *
 * Offline-first: the registry (`GET /api/providers/capabilities`) is fetched
 * ONCE per app session into a module-level cache and shared by every model
 * picker / capability form (the STT dual-slot's two sections share one request).
 * An unreachable engine (or a 5-2 not yet serving the route) degrades to an
 * empty catalog — the pickers then fall back to free text (never block).
 *
 * The cache + in-flight promise dedupe concurrent mounts. `resetProviderCapabilityCatalogCache`
 * is the test seam.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { engineApiClient } from '../services/engine/EngineApiClient';
import type { ModelInfoDto } from '../services/engine/EngineApiClient';

export interface ProviderCapabilityCatalog {
  /** Model catalog slices keyed by provider type (`catalog[provider] = ModelInfo[]`). */
  catalog: Record<string, ModelInfoDto[]>;
  /** Per-provider param-name mapping (wire-name translation, plan §3.5). */
  paramMapping: Record<string, Record<string, string>>;
}

const EMPTY: ProviderCapabilityCatalog = { catalog: {}, paramMapping: {} };

let catalogCache: ProviderCapabilityCatalog | null = null;
let inflight: Promise<ProviderCapabilityCatalog> | null = null;

/** Test seam — clears the module-level catalog cache + in-flight promise. */
export function resetProviderCapabilityCatalogCache(): void {
  catalogCache = null;
  inflight = null;
}

async function loadCatalog(): Promise<ProviderCapabilityCatalog> {
  if (catalogCache) return catalogCache;
  if (!inflight) {
    inflight = engineApiClient
      .getProviderCapabilities()
      .then((res) => {
        const next: ProviderCapabilityCatalog = {
          catalog: res?.catalog ?? {},
          paramMapping: res?.param_mapping ?? {},
        };
        catalogCache = next;
        return next;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export interface UseProviderCapabilityCatalogResult extends ProviderCapabilityCatalog {
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useProviderCapabilityCatalog(): UseProviderCapabilityCatalogResult {
  const [data, setData] = useState<ProviderCapabilityCatalog>(catalogCache ?? EMPTY);
  const [loading, setLoading] = useState(catalogCache === null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await loadCatalog();
      if (alive.current) setData(next);
    } catch (e) {
      if (alive.current) setError((e as Error)?.message ?? 'Failed to load model catalog');
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    if (catalogCache === null) {
      void load();
    }
    return () => {
      alive.current = false;
    };
  }, [load]);

  return { ...data, loading, error, refresh: load };
}
