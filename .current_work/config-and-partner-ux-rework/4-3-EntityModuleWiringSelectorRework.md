# Phase 4-3 — CreateAIScreen: Module Wiring Selector Alignment & Provider/Model Subtitles

**Repo:** `harmony-ai-app` · **Depends on:** 4-1, 4-2 · **Blocks:** 5-1  
**Codebase Mapping Refs:** `.planning/codebase/ARCHITECTURE.md` (Components / Entities), `.planning/codebase/CONVENTIONS.md`

## Objective

Implement the final third of the 1:1 **Edit AI Partner (`CreateAIScreen.tsx`)** rework:
1. Rename the bottom collapsible card from `ADVANCED SETTINGS` (with vague `AI MODEL / VOICE / CONFIG` subheaders) to **`MODULE WIRING`** (or keep `testID="advanced-toggle"` for compatibility) with clear group labels (**`CONVERSATION & COGNITION`**, **`VOICE & SPEECH`**, **`MEMORY, VISION & WORLD`**).
2. Fix the **dropdown width jump** in `EntityModuleSelectorWithActions.tsx`: move the `✎ Edit config` action out of the right-hand horizontal flex row and into the **label row** (`Backend (Chat)` on the left, `✎ Edit config` on the right), so all 8 module dropdowns stay 100% equal width regardless of whether a config is selected or `Disabled`.
3. Enrich `ModuleConfigOption` (`EntityModuleSelector.tsx`) with optional `subtitle?: string` (`"Soulbits Cloud · Qwen 3.5 9B"`) rendered both inside the closed selector button and on each row of the bottom-sheet picker so users can distinguish configs (`Soulbits` vs `Test` vs `Default SoulbitsCloud`) without opening each one.

---

## Root Cause Analysis

1. **Right-edge misalignment (`src/components/entities/EntityModuleSelectorWithActions.tsx:86-112`):**
   - Currently, `EntityModuleSelectorWithActions` renders `<View style={styles.row}>` containing `<View style={styles.selectorWrapper}>` (`flex: 1`) and, only when `selectedId !== ''`, a `36×36` `<TouchableOpacity style={styles.actionButton}>` with `marginLeft: 6`.
   - Whenever a module config is selected (e.g. `Backend: Soulbits`), its dropdown shrinks by `42dp` relative to `Cognition: Disabled` right below it.
2. **Blind config names in the selector and bottom sheet (`src/components/entities/EntityModuleSelector.tsx:15-18`):**
   - `ModuleConfigOption` only carries `{ id: string; name: string }`. Even though `CreateAIScreen` loads the full module config objects from `getAllBackendConfigs()`, `getAllTTSConfigs()`, etc. (which include `provider` and `capability_json`), it strips everything except `{ id, name }`.

---

## Detailed Implementation Steps

### 1. Enrich `ModuleConfigOption` with `subtitle?: string`
**Files:** `src/components/entities/EntityModuleSelector.tsx`, `src/screens/CreateAIScreen.tsx`

1. Extend `ModuleConfigOption` in `src/components/entities/EntityModuleSelector.tsx`:
   ```ts
   export interface ModuleConfigOption {
     id: string;
     name: string;
     /** Optional provider + model summary, e.g. "Soulbits Cloud · qwen-35-9b" */
     subtitle?: string;
   }
   ```
2. Add a pure formatter helper `formatModuleConfigSubtitle(config: Record<string, any>): string | undefined`:
   - For standard single-slot configs (`config.provider`, `config.capability_json`): formats `${PROVIDER_LABELS[config.provider] || config.provider}${model ? ` · ${model}` : ''}`.
   - For STT dual-slot configs (`config.transcription_provider`, `config.vad_provider`): formats `${PROVIDER_LABELS[txProvider]}${vadProvider ? ` + VAD: ${PROVIDER_LABELS[vadProvider]}` : ''}`.
3. In `EntityModuleSelector.tsx`:
   - When the selected option has a `subtitle`, render the config `name` (`size={14} weight="medium"`) with its muted `subtitle` (`size={11} variant="muted"`) underneath inside the selector button.
   - In the bottom-sheet `FlatList`, render each option's `subtitle` underneath its `name` so the sheet clearly shows what each config actually runs.
   - Replace the double-indicator on the selected sheet row (currently both a left purple bar and a right checkmark) with a clean tinted row + checkmark.

### 2. Move `✎ Edit config` into the Label Row in `EntityModuleSelectorWithActions.tsx`
**File:** `src/components/entities/EntityModuleSelectorWithActions.tsx`

Update the layout of `EntityModuleSelectorWithActions.tsx`:
```tsx
<View style={styles.outer}>
  {/* Label row: module label on left, "✎ Edit config" link on right when selected */}
  <View style={styles.labelRow}>
    <ThemedText size={13} variant="secondary" style={styles.label}>
      {label}
    </ThemedText>
    {selectedId && selectedId !== '' ? (
      <TouchableOpacity
        onPress={() => {
          hapticLightPress();
          handleEdit();
        }}
        style={styles.editLink}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityLabel={`Edit ${label} configuration`}
        testID={`edit-module-config-${moduleType}`}
      >
        <Icon name="pencil-outline" size={13} color={theme.colors.accent.primary} />
        <ThemedText size={12} variant="accent" weight="medium">
          Edit config
        </ThemedText>
      </TouchableOpacity>
    ) : null}
  </View>

  {/* Full-width selector */}
  <EntityModuleSelector
    label={label}
    hideLabel
    configs={configs}
    selectedId={selectedId}
    onChange={onChange}
    isLoading={isLoading}
    onCreateNew={handleCreate}
  />
</View>
```

---

## Files to Modify

- `src/components/entities/EntityModuleSelector.tsx`
- `src/components/entities/EntityModuleSelectorWithActions.tsx`
- `src/screens/CreateAIScreen.tsx`
- `src/i18n/locales/en/createAI.json`
- `src/screens/__tests__/CreateAIScreen.test.tsx`

---

## Progress Checklist

- [ ] Extend `ModuleConfigOption` with `subtitle?: string` and render subtitles in `EntityModuleSelector` (both closed button and bottom-sheet rows)
- [ ] Populate `subtitle` via `formatModuleConfigSubtitle(cfg)` when loading module configs in `CreateAIScreen.tsx`
- [ ] Move the `✎ Edit config` action into the label row in `EntityModuleSelectorWithActions.tsx` so all module dropdowns stay 100% equal width
- [ ] Update `CreateAIScreen.test.tsx` to cover module config subtitles and the label-row edit trigger
