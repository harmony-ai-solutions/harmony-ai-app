# Phase 2-2 — App: Sampling Preset Dropdown + Form Structure

**Repo:** harmony-ai-app · **Depends on:** 2-1 · **Blocks:** 6-3
**Refs:** plan.md §6.1, §7 flow, §11 audit decisions (preset semantics) · engine `management/routes_presets.go`

## Objective

Replace the blind `sampling_preset_name` text input with a dropdown fed by
the engine's existing `GET /api/presets`, and restructure the module-config
form into clear sections (Provider → Credentials → Capability → Module)
with advanced sampling params collapsed by default.

**Preset semantics (owner ruling A3, matches engine truth verified at
providers/openai.go:129-193): the preset supplies DEFAULTS; explicit local
values override it.** Never claim the preset "overrides" local input.

## Implementation steps

1. `EngineApiClient` (src/services/engine/EngineApiClient.ts — existing
   getJson/sendJson pattern): add `listPresets()` (GET `/api/presets` →
   `{presets:[{name, source, param_count, description?}]}` — note
   `param_count`; `description` omitempty) and `getPreset(name)`
   (GET `/api/presets/:name` → detail INCLUDING the `params` map of
   override values) with mock-fetch tests
2. New hook `src/hooks/usePresets.ts` — net-new data-fetch hook
   (src/hooks/ has no fetch precedent; keep it simple: fetch-on-mount +
   cache + `{presets, loading, error, refresh}`)
3. Capability form (ModuleConfigEditScreen):
   - `sampling_preset_name` becomes a dropdown: "Manual" + preset names
   - **Add `sampling_preset_name` to `SIMPLE_FIELD_KEYS`**
     (moduleConfigVisibility.ts:21-41) so it is visible in simple mode —
     explicit visibility-rule change
   - Selecting a preset shows preview chips from `getPreset().params`:
     "preset sets temperature=0.7 — your explicit value (0.9) wins" style;
     local inputs STAY ENABLED (locals-override semantics; no SelectPicker
     disabled prop needed)
4. Form restructure (one save path, visual + state only):
   - Partition `PROVIDER_SCHEMAS` fields per provider into Credentials
     (api_key/base_url/endpoint-like) vs Capability (model + sampling +
     provider params) via an explicit field-classification list in this
     phase (interim until 6-2's accountFieldSchemas.ts owns the split)
   - Section 1 Provider · Section 2 Credentials · Section 3 Capability
     (model picker from 2-1, preset dropdown, common params visible,
     advanced collapsed) · Section 4 Module (unchanged)
   - **STT dual-slot:** BOTH provider sections (transcription + VAD,
     screen L833-892) get the same section treatment
5. `moduleConfigVisibility.ts` alignment: expert mode unaffected; the only
   intended visibility change is step 3's SIMPLE_FIELD_KEYS addition

## Test gates

- EngineApiClient preset-method tests with the real mock shapes above
- Component tests (net-new harness from 2-1): dropdown renders engine
  presets; preset selection shows preview chips; local values remain
  editable and labeled as overriding; "Manual" clears the preset
- `npx.cmd tsc --noEmit` + `npm.cmd run test` green

## Checklist

- [ ] EngineApiClient list/get presets + tests (param_count shape)
- [ ] usePresets hook (net-new fetch pattern)
- [ ] Preset dropdown + locals-override preview chips; inputs stay enabled
- [ ] SIMPLE_FIELD_KEYS gains sampling_preset_name
- [ ] Field→section partition list; 4-section restructure incl. STT dual-slot
- [ ] Component tests (harness from 2-1) + gates green
