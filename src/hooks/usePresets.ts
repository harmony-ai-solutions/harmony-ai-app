/**
 * usePresets — engine sampling-preset list (provider-registry 2-2).
 *
 * Net-new data-fetch hook (`src/hooks/` had no fetch precedent). Kept minimal
 * per the phase doc: fetch-on-mount + a module-level cache so multiple forms
 * (e.g. the STT dual-slot's two capability sections) share one request, plus a
 * `refresh` for pull-to-refresh / retry.
 *
 * The list is the engine's existing `GET /api/presets` (name + source +
 * `param_count` + optional description). A preset's `params` preview is fetched
 * on demand by the preset dropdown itself (`EngineApiClient.getPreset`).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { engineApiClient } from '../services/engine/EngineApiClient';
import type { PresetListItemDto } from '../services/engine/EngineApiClient';

/** Module-level cache so the presets are fetched once per app session. */
let presetsCache: PresetListItemDto[] | null = null;

/** Test seam — clears the module-level cache between cases. */
export function resetPresetsCache(): void {
  presetsCache = null;
}

export interface UsePresetsResult {
  presets: PresetListItemDto[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function usePresets(): UsePresetsResult {
  const [presets, setPresets] = useState<PresetListItemDto[]>(presetsCache ?? []);
  const [loading, setLoading] = useState(presetsCache === null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await engineApiClient.listPresets();
      presetsCache = res?.presets ?? [];
      if (alive.current) setPresets(presetsCache);
    } catch (e) {
      if (alive.current) {
        setError((e as Error)?.message ?? 'Failed to load presets');
      }
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    // Fetch on mount unless the module-level cache already has the list.
    if (presetsCache === null) {
      void load();
    }
    return () => {
      alive.current = false;
    };
  }, [load]);

  return { presets, loading, error, refresh: load };
}
