# Phase 2-1 — Preset CRUD API Client & TextGen YAML Serializer

**Repo:** `harmony-ai-app` · **Depends on:** 1-2 · **Blocks:** 2-2, 3-1, 3-2, 3-3, 3-7  
**Codebase Mapping Refs:** `.planning/codebase/ARCHITECTURE.md` (Services & EngineApiClient), `.planning/codebase/CONVENTIONS.md`, engine `management/routes_presets.go` + `config/presets.go`

## Objective

Complete the app-side TextGen WebUI YAML preset management plumbing against the engine's existing `/api/presets` CRUD routes:
1. Add `savePreset(name, content)` (`POST /api/presets`) and `deletePreset(name)` (`DELETE /api/presets/:name`) to `EngineApiClient.ts`.
2. Create a pure, unit-tested TextGen WebUI YAML serializer & validator (`src/utils/presetYaml.ts`) that converts a module slot's current capability overlay + `extra_params` JSON into a clean TextGen WebUI YAML document matching `harmony-link-private/config/presets.go` (`SamplingPreset`).
3. Extend `usePresets.ts` with `savePreset` and `deletePreset` actions that refresh the cached preset list automatically.

---

## Engine Wire Contract (`harmony-link-private/management/routes_presets.go`)

- **`GET /api/presets`** → `{ presets: Array<{ name: string; source: string; param_count: number; description?: string }> }`
- **`GET /api/presets/:name`** → `{ name: string; source: string; description?: string; params: Record<string, any> }`
- **`POST /api/presets`**
  - Request body: `{ name: string; content: string }`
    - `name`: preset filename stem (no `/`, `\`, or `..`).
    - `content`: UTF-8 YAML string unmarshaled by the engine into `config.SamplingPreset` and saved to `<DataDir>/presets/<name>.yaml`.
  - Response (`201 Created`): `{ name: string; status: 'created' }`
- **`DELETE /api/presets/:name`**
  - Response (`200 OK`): `{ status: 'deleted'; name: string }`

---

## Detailed Implementation Steps

### 1. Extend `EngineApiClient.ts` with `savePreset` and `deletePreset`
**File:** `src/services/engine/EngineApiClient.ts`

Add the response DTOs and client methods next to `listPresets()` and `getPreset()` (around line 515 & line 1425):

```ts
export interface PresetSaveResponseDto {
  name: string;
  status: string;
}

export interface PresetDeleteResponseDto {
  name: string;
  status: string;
}
```

```ts
/**
 * Create or overwrite a TextGen WebUI YAML preset on the engine
 * (`POST /api/presets`). The engine validates the YAML against
 * `config.SamplingPreset` and writes `<DataDir>/presets/<name>.yaml`.
 */
savePreset(name: string, content: string): Promise<PresetSaveResponseDto> {
  return this.sendJson<PresetSaveResponseDto>('POST', '/api/presets', {
    name,
    content,
  });
}

/**
 * Delete a sampling preset by name (`DELETE /api/presets/:name`).
 */
deletePreset(name: string): Promise<PresetDeleteResponseDto> {
  return this.sendJson<PresetDeleteResponseDto>(
    'DELETE',
    `/api/presets/${encodeURIComponent(name)}`,
  );
}
```

### 2. Create `src/utils/presetYaml.ts` (Pure TextGen WebUI YAML Serializer & Validator)
**File:** `src/utils/presetYaml.ts` (new)

The engine's `config.SamplingPreset` (`config/presets.go:31-90`) supports these exact YAML keys:
- **Standard:** `temperature`, `top_p`, `max_tokens`, `frequency_penalty`, `presence_penalty`, `seed`
- **Extended (common):** `top_k`, `min_p`, `repetition_penalty`
- **Rich samplers:** `typical_p`, `tfs`, `dry_multiplier`, `dry_base`, `dry_allowed_length`, `xtc_probability`, `xtc_threshold`, `top_a`, `mirostat_mode`, `mirostat_tau`, `mirostat_eta`, `dynatemp_range`, `dynatemp_exponent`, `top_n_sigma`
- **TextGen-specific & additional:** `penalty_alpha`, `repetition_penalty_range`, `do_sample`, `epsilon_cutoff`, `eta_cutoff`, `smoothing_factor`, `temperature_last`, `encoder_repetition_penalty`, `no_repeat_ngram_size`, `smoothing_curve`, `min_tokens`, `dynatemp_low`, `dynatemp_high`, `ignore_eos`

Implement and export:
1. `PRESET_YAML_KEYS`: ordered list of the supported `SamplingPreset` YAML keys, plus provider-alias normalization (`repeat_penalty` → `repetition_penalty`, `random_seed` → `seed`, `num_predict` → `max_tokens`, `max_output_tokens` → `max_tokens`).
2. `buildPresetYamlFromCapability(capability: Record<string, any>, description?: string): string`:
   - Reads top-level capability values + parsed `capability.extra_params` JSON.
   - Skips unset/sentinel values (`undefined`, `null`, `''`, `max_tokens <= 0`, `seed === 0`, numeric `0` on optional penalties/cutoffs unless explicitly set).
   - Emits clean, deterministic `key: value` YAML lines (with optional `description: "..."` header).
   - If no parameters are set yet, emits a sensible starter template (`temperature: 0.7\ntop_p: 0.9\ntop_k: 40\nrepetition_penalty: 1.1\n`).
3. `validatePresetName(name: string): string | null`:
   - Rejects empty names or names containing `/`, `\`, `..`, or leading/trailing dots.

### 3. Extend `src/hooks/usePresets.ts`
**File:** `src/hooks/usePresets.ts`

Add `savePreset(name: string, content: string)` and `deletePreset(name: string)` callbacks to `usePresets()` that call `engineApiClient.savePreset` / `engineApiClient.deletePreset`, update the shared module-level cache, and trigger a fresh `refresh()` so all mounted preset pickers see the updated list immediately.

---

## Files to Create / Modify

- `src/services/engine/EngineApiClient.ts`
- `src/services/engine/__tests__/EngineApiClient.presets.test.ts`
- `src/utils/presetYaml.ts` (new)
- `src/utils/__tests__/presetYaml.test.ts` (new)
- `src/hooks/usePresets.ts`
- `src/hooks/__tests__/usePresets.test.ts`

---

## Progress Checklist

- [ ] Add `savePreset` and `deletePreset` to `EngineApiClient.ts` + unit tests
- [ ] Create `src/utils/presetYaml.ts` with `buildPresetYamlFromCapability` and `validatePresetName` + unit tests
- [ ] Extend `usePresets.ts` with `savePreset` and `deletePreset` mutations + cache invalidation
