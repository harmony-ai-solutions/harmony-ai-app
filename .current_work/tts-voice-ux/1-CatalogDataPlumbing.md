# Phase 1: Catalog Data Plumbing

## Objective

Make the engine's kinded `audio_tags` capability block available to the app,
and remove the two stale hardcoded tag fallback lists. No UI changes in this
phase. No engine changes.

## Context (verified)

- `GET /api/providers/capabilities` → `providers.<type>.models.<id>` is the
  engine's `providers.CatalogModel`, which has
  `AudioTags *config.AudioTagCapabilities \`json:"audio_tags,omitempty"\``
  (`harmony-link-private/providers/catalog.go:96-101`, `CapabilitiesPayload()`).
  The kinded block is ALREADY on the wire.
- Wire shape (engine `config/audio_tags.go`):
  ```json
  {
    "syntax": "[{}]",
    "cues":   {"mode": "none|closed|open", "vocabulary": ["laughs", ...]},
    "tones":  {"mode": "none|closed|open", "vocabulary": ["excited", ...]},
    "breaks": {"mode": "none|closed|open", "vocabulary": ["pause", ...]}
  }
  ```
  Absent kind = mode `none`. Seeds: eleven_v3/v4 (open/open/open, 12/48/3),
  chatterbox_turbo ×2 providers (closed/closed, 9/10), everyone else no block.
- `useProviderCapabilityCatalog.ts:94-122` (`catalogModelToModelInfo`) copies
  only `speech_options`, `status`, `family`, … into `meta`. Everything else is
  dropped.
- `ProviderSlotSection.tsx:414` uses `liveModels ?? catalog…`; live descriptors
  (`elevenlabs.go:elevenSpeechOptions`, `soulvoice.go:soulvoiceSpeechOptions`)
  carry the derived flat `paralinguistic_tags` but NOT `audio_tags`. Therefore
  the block must be resolved by (providerType, modelId) from the tier-2 catalog,
  which both screens already hold via `useProviderCapabilityCatalog()`.
- Stale fallbacks to delete: `constants/modelCapabilities.ts:271-277`
  (`resolveEffectiveSpeechOptions` chatterbox branch injects 5 legacy tags) and
  `components/config/ProviderSlotSection.tsx:1135-1140` (same 5 as pill
  fallback). Both advertise tags on Chatterbox base/multilingual, which the
  engine de-tagged in Phase 7 (they have NO tag tokens).

## Steps

1. `src/services/engine/EngineApiClient.ts`
   - Add `AudioTagKindDto { mode?: string; vocabulary?: string[] }` and
     `AudioTagCapabilitiesDto { syntax?: string; cues?, tones?, breaks?: AudioTagKindDto }`.
   - Add `audio_tags?: AudioTagCapabilitiesDto` to `CatalogModelDto`.
2. `src/hooks/useProviderCapabilityCatalog.ts`
   - In `catalogModelToModelInfo`, copy `dto.audio_tags` into `meta.audio_tags`
     (only when present, keep the "omit empty" convention).
3. `src/constants/modelCapabilities.ts`
   - Export `AudioTagMode = 'none' | 'closed' | 'open'` (fold unknown → `none`).
   - Export `getAudioTagCapabilities(catalog, providerType, modelId)`:
     find the catalog row by id, read `model.meta.audio_tags`, normalize kinds
     (missing → `{mode:'none', vocabulary:[]}`), return a stable typed object.
   - Export `getAudioTagCapabilitiesForModel(model)` convenience for the test
     panel (reads `meta.audio_tags` from a catalog `ModelInfoDto`).
   - Keep `paralinguistic_tags` as the legacy flat display list; add
     `getLegacyTagList(model)` for old-engine fallback only. Never fabricate.
   - Delete the 5-tag fallback in `resolveEffectiveSpeechOptions` (keep the
     `supported_generation_params` family fallbacks — they are still correct).
4. `src/components/config/ProviderSlotSection.tsx`
   - Delete the pill fallback copy; use the typed accessor with the flat list
     as legacy fallback (Phase 2 replaces the pills entirely).
5. Tests
   - `useProviderCapabilityCatalog.test.ts`: `audio_tags` survives normalization
     into `meta.audio_tags`; absent block → no `meta.audio_tags`.
   - `modelCapabilities.test.ts`: accessor from catalog by (provider, id);
     missing kinds fold to `none`; unknown mode folds to `none`; legacy list
     untouched for untagged models.
   - Add an `audio_tags` fixture mirroring the engine's cataloggen count test
     (EL = 12 + 48 + 3, turbo = 9 + 10).
   - Fixture/parity: `managementContract.fixtures.ts` may need an `audio_tags`
     row for conformance tests — additive only.

## Files

- `src/services/engine/EngineApiClient.ts` (types)
- `src/hooks/useProviderCapabilityCatalog.ts`
- `src/constants/modelCapabilities.ts`
- `src/components/config/ProviderSlotSection.tsx` (fallback deletion only)
- `src/hooks/__tests__/useProviderCapabilityCatalog.test.ts`
- `src/constants/__tests__/modelCapabilities.test.ts`
- `src/services/engine/__fixtures__/managementContract.fixtures.ts` (if needed)

## Checklist

- [ ] `AudioTagCapabilitiesDto` + `CatalogModelDto.audio_tags` added
- [ ] `catalogModelToModelInfo` copies `audio_tags` into `meta`
- [ ] Typed accessors added (catalog lookup by provider+modelId)
- [ ] Both stale 5-tag fallbacks deleted
- [ ] Unit tests listed above pass (`Test Suites: N passed`)
- [ ] No UI change, no engine change, nothing committed
