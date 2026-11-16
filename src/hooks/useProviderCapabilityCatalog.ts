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
 * The engine answers with a per-provider MAP payload
 * (`{meta, providers: {<type>: {wire, strict, models: {<id>: {...}}}}}`). This
 * hook normalizes that into the app's flat `{catalog, paramMapping}` view:
 *  - `catalog[provider]` — the model MAP as a `ModelInfoDto[]`, ordered by
 *    catalog status (`current`, `previous`, `deprecated`, then anything else)
 *    and then by id, each stamped `source: 'catalog'` / `provenance: 'known'`
 *    with the catalog extras (`speech_options`, `status`, `family`, …) under
 *    `meta`;
 *  - `paramMapping[provider]` — `{canonical: wire}` derived from `wire`,
 *    EXCLUDING entries with an empty `wire` or `route: 'drop'` (a dropped param
 *    is never forwarded to the provider, so it has no wire name).
 * The legacy `{catalog, param_mapping}` shape is still honoured when
 * `providers` is absent.
 *
 * The cache + in-flight promise dedupe concurrent mounts. `resetProviderCapabilityCatalogCache`
 * is the test seam.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { engineApiClient } from '../services/engine/EngineApiClient';
import type {
  CatalogModelDto,
  ModelInfoDto,
  ProviderCapabilitiesDto,
  ProviderCapabilitySliceDto,
} from '../services/engine/EngineApiClient';

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

/** Non-empty string array, or `undefined` (absent ⇒ omit the field entirely). */
function nonEmpty(values: string[] | undefined): string[] | undefined {
  return Array.isArray(values) && values.length > 0 ? values : undefined;
}

/**
 * Picker order for catalog rows: lifecycle first (`current`, `previous`,
 * `deprecated`, then anything else such as `preview`/`free`/undeclared), then
 * model id. This mirrors the engine's
 * `providers.CatalogModelInfosForCapability` order, so a deprecated model (e.g.
 * `scribe_v1`) never leads the list. The wire payload is a JSON object, so its
 * key order is alphabetical anyway — the sort has to come from the data.
 */
const CATALOG_STATUS_RANK: Record<string, number> = {
  current: 0,
  previous: 1,
  deprecated: 2,
};

function catalogRowOrder(a: ModelInfoDto, b: ModelInfoDto): number {
  const rank = (model: ModelInfoDto): number => {
    const status =
      typeof model.meta?.status === 'string'
        ? model.meta.status.trim().toLowerCase()
        : '';
    return CATALOG_STATUS_RANK[status] ?? 3;
  };
  const byStatus = rank(a) - rank(b);
  if (byStatus !== 0) return byStatus;
  return a.id.localeCompare(b.id);
}

/**
 * One catalog map entry → the app's `ModelInfoDto`. Only present fields are
 * emitted (no empty arrays/objects); the catalog extras land under `meta`, and
 * every catalog descriptor is stamped `source: 'catalog'` / `provenance:
 * 'known'` because the tier-2 registry IS the offline catalog tier.
 */
function catalogModelToModelInfo(id: string, dto: CatalogModelDto | null | undefined): ModelInfoDto {
  const label = dto?.label ?? id;
  if (!dto) return { id, label, source: 'catalog', provenance: 'known' };

  const model: ModelInfoDto = { id, label, source: 'catalog', provenance: 'known' };
  if (dto.context !== undefined) model.context = dto.context;
  if (dto.output_limit !== undefined) model.output_limit = dto.output_limit;
  const modalities = nonEmpty(dto.modalities);
  if (modalities) model.modalities = modalities;
  const capabilities = nonEmpty(dto.capabilities);
  if (capabilities) model.capabilities = capabilities;
  const paramSupport = nonEmpty(dto.param_support);
  if (paramSupport) model.param_support = paramSupport;

  const meta: Record<string, unknown> = {};
  if (dto.speech_options && typeof dto.speech_options === 'object') {
    meta.speech_options = dto.speech_options;
  }
  if (dto.status) meta.status = dto.status;
  if (dto.family) meta.family = dto.family;
  const reasoningEffort = nonEmpty(dto.reasoning_effort);
  if (reasoningEffort) meta.reasoning_effort = reasoningEffort;
  const unsupportedParams = nonEmpty(dto.unsupported_params);
  if (unsupportedParams) meta.unsupported_params = unsupportedParams;
  if (dto.source) meta.source = dto.source;
  if (Object.keys(meta).length > 0) model.meta = meta;

  return model;
}

/**
 * `wire` → `{canonical: providerField}`, skipping entries the provider does not
 * take (`route: 'drop'`) or that carry no wire name.
 */
function wireParamMapping(
  wire: ProviderCapabilitySliceDto['wire'],
): Record<string, string> | null {
  if (!wire || typeof wire !== 'object') return null;
  const mapping: Record<string, string> = {};
  for (const [canonical, entry] of Object.entries(wire)) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.route === 'drop') continue;
    const target = entry.wire;
    if (typeof target !== 'string' || target.length === 0) continue;
    mapping[canonical] = target;
  }
  return Object.keys(mapping).length > 0 ? mapping : null;
}

/** Normalize either the engine's `providers` payload or the legacy shape. */
function normalizeCapabilities(
  res: ProviderCapabilitiesDto | null | undefined,
): ProviderCapabilityCatalog {
  if (!res || typeof res !== 'object') return EMPTY;

  const providers = res.providers;
  if (providers && typeof providers === 'object') {
    const catalog: Record<string, ModelInfoDto[]> = {};
    const paramMapping: Record<string, Record<string, string>> = {};
    for (const [providerType, slice] of Object.entries(providers)) {
      if (!slice || typeof slice !== 'object') continue;
      const models = slice.models;
      if (models && typeof models === 'object') {
        catalog[providerType] = Object.keys(models)
          .map((id) => catalogModelToModelInfo(id, models[id]))
          .sort(catalogRowOrder);
      } else {
        catalog[providerType] = [];
      }
      const mapping = wireParamMapping(slice.wire);
      if (mapping) paramMapping[providerType] = mapping;
    }
    return { catalog, paramMapping };
  }

  return {
    catalog: res.catalog ?? {},
    paramMapping: res.param_mapping ?? {},
  };
}

async function loadCatalog(): Promise<ProviderCapabilityCatalog> {
  if (catalogCache) return catalogCache;
  if (!inflight) {
    inflight = engineApiClient
      .getProviderCapabilities()
      .then((res) => {
        let next: ProviderCapabilityCatalog;
        try {
          next = normalizeCapabilities(res);
        } catch {
          // Malformed payload must never break the pickers (offline-first).
          next = EMPTY;
        }
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
