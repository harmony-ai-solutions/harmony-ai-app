# Phase 3-1: Module-type → Models Query Mapping + Static Fallback

## Objective

Define (a) the mapping from each app module type to the Soulbits
`GET /v1/models` filter query, and (b) a curated **static fallback** model list
per module type, used when the live catalog is unreachable. This constant module
is consumed by the catalog service (3-2) and the selector UI (3-3).

## Background / References

- Backend endpoint: public
  [`GET /v1/models`](../../soulbits-cloud-backend/cmd/inference-gateway/main.go)
  supports query params `model_type` (`llm | tts | stt | embeddings | image | …`),
  `input_modalities`, `output_modalities` (each `text | audio | image | embedding`).
  See `parseModelFilterQuery` tests in `models_public_test.go` for the contract.
- Client type: [`ModelsQuery`](../../soulbits-api-client-js/src/models.ts) (from
  the generated OpenAPI `paths['/v1/models']['get']['parameters']['query']`).
- Module types: [`MODULE_TYPES`](../../src/constants/moduleConfiguration.ts)
  (`backend, cognition, movement, rag, stt, tts, vision, imagination`).
- Note: `model_type=stt` maps to STT/Whisper models (the worker `adapter_test.go`
  uses `{"model":"whisper"}` with workloadType `stt`).

## Module-type → filter mapping

| Module type(s) | Filter query |
|---|---|
| `backend`, `cognition`, `movement` | `{ model_type: 'llm' }` (text in → text out) |
| `rag` | `{ model_type: 'embeddings' }` |
| `tts` | `{ model_type: 'tts' }` (text → audio) |
| `stt` | `{ model_type: 'stt' }` (audio → text, e.g. Whisper) |
| `vision` | `{ input_modalities: ['image'] }` |
| `imagination` | `{ output_modalities: ['image'] }` (image generation) |

> STT is dual-slot (`transcription` + `vad`). For STT, the **transcription** slot
> uses `{ model_type: 'stt' }`; the **VAD** slot is a different concern (voice
> activity detection) — if a Soulbits VAD model exists, map it; otherwise leave
> VAD as free text. Confirm against the live catalog.

## Files to create

- `src/constants/soulbitsModels.ts` — exports:
  - `SOULBITS_MODEL_QUERY: Record<string, ModelsQuery>` keyed by module type.
  - `SOULBITS_FALLBACK_MODELS: Record<string, string[]>` keyed by module type.
  - `getModelsQueryForModule(moduleType: string): ModelsQuery | undefined`
  - `getFallbackModelsForModule(moduleType: string): string[]`

## Implementation steps

1. Add the type import: `import type { paths } from '@harmony-ai-solutions/soulbits-api-client';`
   then `type ModelsQuery = NonNullable<paths['/v1/models']['get']>['parameters']['query'];`
   (mirror the client's own `models.ts`).
2. Implement `SOULBITS_MODEL_QUERY` per the table above.
3. Implement `SOULBITS_FALLBACK_MODELS` with curated IDs. **These must be verified
   against the live catalog / backend config before shipping** — seed from known
   values:
   - `llm`: `['soulchat-v1']` (default in `moduleDefaults.ts`)
   - `stt`: `['whisper']` (seen in backend worker tests)
   - `tts`: `['soul-tts-v1']` ← **placeholder; verify**
   - `embeddings`: `['soul-embed-v1']` ← **placeholder; verify**
   - `vision` / `imagination`: `[]` until verified (selector will then rely on
     live fetch / free text).
4. Add the two helper functions.
5. Unit test (see Phase 5): assert each module type maps to the expected query
   and returns a fallback array.

## Code sketch

```ts
import type { paths } from '@harmony-ai-solutions/soulbits-api-client';
type ModelsQuery = NonNullable<paths['/v1/models']['get']>['parameters']['query'];

export const SOULBITS_MODEL_QUERY: Record<string, ModelsQuery> = {
  backend:      { model_type: 'llm' },
  cognition:    { model_type: 'llm' },
  movement:     { model_type: 'llm' },
  rag:          { model_type: 'embeddings' },
  tts:          { model_type: 'tts' },
  stt:          { model_type: 'stt' },
  vision:       { input_modalities: ['image'] },
  imagination:  { output_modalities: ['image'] },
};

export const SOULBITS_FALLBACK_MODELS: Record<string, string[]> = {
  backend: ['soulchat-v1'],
  cognition: ['soulchat-v1'],
  movement: ['soulchat-v1'],
  rag: ['soul-embed-v1'],
  tts: ['soul-tts-v1'],
  stt: ['whisper'],
  vision: [],
  imagination: [],
};

export const getModelsQueryForModule = (m: string) => SOULBITS_MODEL_QUERY[m];
export const getFallbackModelsForModule = (m: string) => SOULBITS_FALLBACK_MODELS[m] ?? [];
```

## Progress checklist

- [ ] `soulbitsModels.ts` created with query map + fallback map + helpers
- [ ] Fallback IDs verified against live catalog (placeholders resolved)
- [ ] STT transcription/VAD slot handling decided and documented
- [ ] Unit test added (Phase 5)
