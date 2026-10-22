# Phase 2-2 — SamplingPresetSelect Bar, Save-as-Preset Modal & Unsupported Param Drawer

**Repo:** `harmony-ai-app` · **Depends on:** 1-2, 2-1 · **Blocks:** 3-1, 3-2, 3-3, 3-7  
**Codebase Mapping Refs:** `.planning/codebase/ARCHITECTURE.md` (Components / Config), `.planning/codebase/CONVENTIONS.md`

## Objective

Rework `SamplingPresetSelect.tsx` and the parameter-warning rendering in `ProviderSlotSection.tsx` so that:
1. Users always get a clean **Sampling Preset (TextGen YAML)** selector bar right below **Model** on all LLM modules (`Backend`, `Cognition`, `Movement`, `Vision`) — never a raw `"Preset name — No presets available — enter manually"` text box.
2. Users can tap **`Save as…`** (or **`+ New Preset`**) right beside the selector to save their current config's hyperparameters as a named TextGen WebUI YAML preset (`POST /api/presets`) or paste/edit YAML directly, and delete custom presets (`DELETE /api/presets/:name`).
3. Active preset parameter chips clearly show what the YAML preset supplies (`temp: 0.85`, `top_p: 0.95`, `min_p: 0.05`) and highlight local overrides (`temp: 0.85 → 0.7 (local wins)`).
4. Genuinely unsupported parameters in Advanced mode collapse into a single muted footer drawer instead of rendering 10 stacked orange warning pills.

---

## Detailed Implementation Steps

### 1. Rework `SamplingPresetSelect.tsx`
**File:** `src/components/config/SamplingPresetSelect.tsx`

1. **Remove the raw `TextInput` fallback (`showFreeText`):**
   - Even when `presets.length === 0`, render the `<SelectPicker>` with `None (Manual)` selected so the control always looks like a preset selector, not a broken text input.
2. **Action Row (`SelectPicker` + `Save as…` + `Delete`):**
   - Render a horizontal row containing:
     - `<View style={{ flex: 1 }}>` with `<SelectPicker>` offering `None (Manual)` plus each preset formatted as `${p.name} (${p.param_count} params)`.
     - A compact **`Save as…`** button (`testID="preset-open-save-modal"`, icon `content-save-edit-outline`) that opens the **Save / Import YAML Preset Modal**.
     - When `value !== ''`, a compact **`Delete`** icon button (`testID="preset-delete-button"`, icon `trash-can-outline`) that confirms and calls `deletePreset(value)` then resets `onChange('')`.
3. **Save / Import YAML Preset Modal:**
   - Pre-fills the YAML editor (`TextInput` `multiline`, monospace font) using `buildPresetYamlFromCapability(localValues)` from Phase 2-1, so if the user tuned `temperature: 0.7`, `top_p: 0.95`, `min_p: 0.05`, etc. in the current config, those exact values are ready to save under a new preset name!
   - If a preset is currently selected, offers a one-tap chip to seed from the selected preset's YAML or from the current config's overrides.
   - Validates the preset name via `validatePresetName(name)`, calls `savePreset(name, yamlContent)`, closes the modal, and calls `onChange(name)` so the newly created preset is immediately active on the module config.
4. **Preset Parameter Preview Chips:**
   - When a preset is selected (`value !== ''` and `detail?.params`), render compact monospace pills inside the preset card:
     - Standard pill: `temperature: 0.85`
     - Override pill (when `explicitKeys[key]` is true and `localValues[key]` is non-empty): `temperature: 0.85 → 0.7 (local wins)` in accent pink.

### 2. Replace the Wall of Orange Warning Badges with a Collapsed Unsupported Drawer
**File:** `src/components/config/ProviderSlotSection.tsx`

In `ProviderSlotSection.tsx`:
- In **Simple** mode: only `Model` and `Sampling Preset` render for LLM modules (no individual sampling fields).
- In **Advanced** mode:
  - Partition the module-scoped capability fields via `partitionFieldsBySupport(capabilityFields, selectedModel)` from Phase 1-2.
  - Render all supported/undeclared fields normally (with 2-column grouping for `width: 'half'` numeric fields).
  - If `unsupportedFields.length > 0`, render a single collapsible footer row (`testID={`unsupported-params-drawer-${slot}`}`):
    - Collapsed label: `⚠ ${unsupportedFields.length} parameters not supported by ${selectedModel.label || selectedModel.id} (tap to show)`
    - Expanded: renders those fields with a subtle inline warning subtitle (preserving R12's "warn, never hard-block" guarantee without cluttering the primary form).

---

## Files to Create / Modify

- `src/components/config/SamplingPresetSelect.tsx`
- `src/components/config/__tests__/SamplingPresetSelect.test.tsx`
- `src/components/config/ProviderSlotSection.tsx`
- `src/i18n/locales/en/moduleConfig.json`

---

## Progress Checklist

- [ ] Replace the `showFreeText` raw input in `SamplingPresetSelect.tsx` with the persistent `SelectPicker` + `Save as…` action bar
- [ ] Implement the **Save / Import YAML Preset Modal** pre-filled via `buildPresetYamlFromCapability(localValues)`
- [ ] Add preset deletion confirmation & `deletePreset(value)` flow
- [ ] Group genuinely unsupported sampling parameters into a collapsible footer drawer in `ProviderSlotSection.tsx`
- [ ] Update `SamplingPresetSelect.test.tsx` to cover `Save as…`, YAML pre-fill, and preset deletion
