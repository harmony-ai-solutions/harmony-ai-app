# Phase 3-2: Soulbits Models Catalog Service

## Objective

Add a service that fetches the live model catalog from the **public**
`GET /v1/models` endpoint (filtered by module type), caches it with a TTL, and
falls back to the static list (3-1) on error/offline. Consumed by the selector
UI (3-3).

## Background / References

- Endpoint is **public / unauthenticated**
  ([`GET /v1/models`](../../soulbits-cloud-backend/cmd/inference-gateway/main.go)).
- First-party client:
  [`createClient({ inferenceURL })`](../../soulbits-api-client-js/src/config.ts)
  accepts **no credentials**; `client.models.listModelsOrThrow({ model_type,
  input_modalities, output_modalities })`
  ([`models.ts`](../../soulbits-api-client-js/src/models.ts)).
- Base URL: [`CLOUD_HOSTS.inference`](../../src/config/cloud.ts) (beta-aware).
- Existing client factory [`buildSoulbitsClient`](../../src/services/cloud/soulbitsClient.ts)
  is **PASETO-only** (unsuitable here — no PASETO available for a public read).
  Build a credential-less client instead.
- Existing app client dependency is a GitHub git dependency (see memory-bank
  `activeContext.toon` 2026-07-30 note). The app already imports
  `@harmony-ai-solutions/soulbits-api-client`.

## Files to create

- `src/services/cloud/soulbitsModelsCatalog.ts` — the fetch+cache service.

## API surface

```ts
export interface CatalogModel {
  id: string;          // canonical model id (use as the saved `model` value)
  name?: string;       // display name (fallback to id)
  description?: string;
}
export interface FetchModelsResult {
  models: CatalogModel[];   // empty array when nothing available
  source: 'live' | 'fallback';
}
export async function fetchModelsForModule(moduleType: string): Promise<FetchModelsResult>;
export function clearModelsCache(): void; // for tests / manual refresh
```

## Implementation steps

1. Build a credential-less client once (module-level singleton):
   ```ts
   import { createClient } from '@harmony-ai-solutions/soulbits-api-client';
   import { CLOUD_HOSTS } from '../../config/cloud';
   const catalogClient = createClient({ inferenceURL: CLOUD_HOSTS.inference });
   ```
   (No `paseto`/`apiKey` → no auth header; public endpoint works.)
2. Cache: module-level `Map<moduleType, { models: CatalogModel[]; at: number }>`
   with `TTL_MS = 5 * 60_000` (5 min). Return cached if fresh.
3. `fetchModelsForModule`:
   - Look up query via `getModelsQueryForModule(moduleType)` (3-1). If none,
     return `{ models: [], source: 'fallback' }`.
   - In-memory single-flight per module type (dedupe concurrent calls).
   - `try`: `const data = await catalogClient.models.listModelsOrThrow(query);`
     Map the response items → `CatalogModel[]`. The response shape is the
     OpenAPI `modelResponse` (array of objects with at least `id`). Inspect the
     generated `src/generated.d.ts` / `openapi.yaml` of the client for exact
     fields; default `name = item.id` when missing.
     Return `{ models, source: 'live' }` and populate the cache.
   - `catch` (network/parse/empty): return
     `{ models: getFallbackModelsForModule(moduleType).map(id => ({ id })), source: 'fallback' }`.
     Log via the app logger (`createLogger('[soulbitsModelsCatalog]')`).
4. Do **not** throw on failure — always resolve (UI stays usable offline).

## Notes / risks

- If the client's generated types differ from the runtime JSON (e.g. envelope vs
  bare array), normalize defensively: accept `Array | { data: Array }`.
- Confirm the public endpoint is reachable from the app's network config (no
  extra ACL beyond the gateway). It is intentionally public per the backend.
- Consider exposing `source` in the UI ("cached/offline fallback") for
  transparency (optional).

## Progress checklist

- [ ] `soulbitsModelsCatalog.ts` created with fetch + TTL cache + single-flight
- [ ] Credential-less client built from `CLOUD_HOSTS.inference`
- [ ] Fallback to static list on error; never throws
- [ ] Unit test (mocked client) added in Phase 5
