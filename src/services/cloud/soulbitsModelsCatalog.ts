/**
 * soulbitsModelsCatalog — fetch + cache service for the public model catalog.
 *
 * Builds a credential-less client (no paseto/apiKey) because the GET /v1/models
 * endpoint is public (unauthenticated).  Results are cached for 5 minutes and
 * single-flighted so concurrent calls for the same module type share one request.
 *
 * NEVER throws — on any error it falls back to the static fallback list so the
 * UI stays usable offline.
 */

import { createClient } from '@harmony-ai-solutions/soulbits-api-client';
import { CLOUD_HOSTS } from '../../config/cloud';
import { getModelsQueryForModule, getFallbackModelsForModule } from '../../constants/soulbitsModels';
import { createLogger } from '../../utils/logger';

// ── Logging ──────────────────────────────────────────────────────────────
const log = createLogger('[soulbitsModelsCatalog]');

// ── Credential-less client (public catalog only) ─────────────────────────
const catalogClient = createClient({ inferenceURL: CLOUD_HOSTS.inference });

// ── Exported types ───────────────────────────────────────────────────────
export interface CatalogModel {
  id: string;
  name?: string;
  description?: string;
}

export interface FetchModelsResult {
  models: CatalogModel[];
  source: 'live' | 'fallback';
}

// ── Cache ────────────────────────────────────────────────────────────────
const TTL_MS = 5 * 60_000; // 5 minutes

interface CacheEntry {
  models: CatalogModel[];
  at: number;
}

const cache = new Map<string, CacheEntry>();

// ── Single-flight ────────────────────────────────────────────────────────
const inflight = new Map<string, Promise<FetchModelsResult>>();

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Fetch models for a given module type from the live catalog.
 *
 * Returns cached data if fresh (< TTL_MS).  On error or empty results it
 * falls back to the static fallback list.  NEVER throws.
 */
export async function fetchModelsForModule(
  moduleType: string,
): Promise<FetchModelsResult> {
  // 1. Resolve catalog query — if unmapped, return fallback immediately.
  const query = getModelsQueryForModule(moduleType);
  if (!query) {
    log.warn(`No catalog query for module type "${moduleType}" — using fallback`);
    return {
      models: getFallbackModelsForModule(moduleType).map(id => ({ id })),
      source: 'fallback',
    };
  }

  // 2. Check cache (fresh)
  const cached = cache.get(moduleType);
  if (cached && Date.now() - cached.at < TTL_MS) {
    return { models: cached.models, source: 'live' };
  }

  // 3. Single-flight — reuse an in-flight promise for the same module type
  const existing = inflight.get(moduleType);
  if (existing) {
    return existing;
  }

  // 4. Create the fetch promise
  const promise = doFetch(moduleType, query);
  inflight.set(moduleType, promise);

  try {
    return await promise;
  } finally {
    inflight.delete(moduleType);
  }
}

/**
 * Clear all cached model data (and any in-flight promises).
 */
export function clearModelsCache(): void {
  cache.clear();
  inflight.clear();
}

// ── Internal ─────────────────────────────────────────────────────────────

async function doFetch(
  moduleType: string,
  query: NonNullable<Parameters<typeof catalogClient.models.listModelsOrThrow>[0]>,
): Promise<FetchModelsResult> {
  try {
    const entries = await catalogClient.models.listModelsOrThrow(query);

    // Defensive: empty array from the live endpoint → fallback
    if (!entries || entries.length === 0) {
      log.warn(`Live catalog returned 0 entries for "${moduleType}" — using fallback`);
      return {
        models: getFallbackModelsForModule(moduleType).map(id => ({ id })),
        source: 'fallback',
      };
    }

    const models: CatalogModel[] = entries.map(e => ({
      id: e.model_id,
      name: e.display_name ?? e.model_id,
      description: e.description,
    }));

    cache.set(moduleType, { models, at: Date.now() });

    return { models, source: 'live' };
  } catch (err: unknown) {
    log.warn(`Failed to fetch models for "${moduleType}" — using fallback`, err);
    return {
      models: getFallbackModelsForModule(moduleType).map(id => ({ id })),
      source: 'fallback',
    };
  }
}
