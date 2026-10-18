# Phase 2-1 — App: Model Catalog + Model Pickers (current API)

**Repo:** harmony-ai-app · **Depends on:** Phase 1-2 · **Blocks:** 2-2
**Refs:** plan.md R6, §6.2 · research docs `openai.md`/`anthropic.md`/`google.md`/`xai.md`/`mistral.md` §7 seed tables, SYNTHESIS §3

## Objective

Replace free-text model fields with catalog-backed pickers (with "Custom…"
fallback) using an app-side catalog constant distilled from the research
seed tables — the interim tier-2 until the engine catalog lands (Phase 5-2;
the constant is then retired).

## Implementation steps

1. New `src/constants/providerModelCatalog.ts`:
   - `ModelCatalogEntry = { id, label, tags: Array<'chat'|'vision'|'embedding'|'tts'|'image'|'stt'>, context?, notes? }`
   - Per provider type (the 10 picker-offered types post-Phase-1): entries
     transcribed from each research doc §7 seed table (openai, anthropic,
     google, xai, mistral — note: mistral/localai/ollama not yet in pickers;
     Phase 6-5 adds them, include their tables now so they're ready)
   - Export `getModelsForModule(providerType, moduleType)` filtering by tag
     (backend/cognition/movement → chat; rag → embedding; tts → tts; stt →
     stt; vision → vision; imagination → image)
2. `providerFieldSchemas.ts`: mark the `model` field as picker-backed
   (add `catalog: true` or equivalent metadata the form renderer reads)
3. `ModuleConfigEditScreen.tsx`: render the model field as a picker when
   catalog entries exist for (provider, module): options = catalog entries +
     "Custom…" (free-text input); remember manual choice per config
4. STT dual-slot form: same treatment for transcription + VAD model fields
5. Context-window note chip next to selected model when `context` known
   (from catalog) — provenance label `catalog`

## Test gates

- New unit test `src/constants/__tests__/providerModelCatalog.test.ts`:
  tag filtering per module type; every picker-offered provider has ≥1 entry
  per applicable module (or explicit empty-list allowance)
- `ModuleConfigEditScreen` component test: picker renders options, Custom
  fallback keeps free text, value round-trips
- `npx.cmd tsc --noEmit` + `npm.cmd run test` green

## Checklist

- [ ] providerModelCatalog.ts created from research seed tables
- [ ] getModelsForModule filtering + unit tests
- [ ] Model field renders picker + Custom fallback in module form
- [ ] STT dual-slot coverage
- [ ] Context chip + provenance label
- [ ] tsc + jest gates green
