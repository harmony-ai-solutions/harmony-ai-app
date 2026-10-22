# Phase 3-2 — Cognition Config Screen (Emotion & Inner Monologue)

**Repo:** `harmony-ai-app` · **Depends on:** 1-2, 2-1, 2-2, 2-3, 3-1 · **Blocks:** 5-1  
**Codebase Mapping Refs:** `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/CONVENTIONS.md`

## Objective

Refine the **Edit / New Cognition Config** screen (`moduleType = 'cognition'`) so its LLM capability section matches Backend (including TextGen WebUI YAML Preset selection & saving, e.g. for deterministic cognition presets) and its **Cognition Settings** card replaces the raw `Generate Expressions (0/1)` number input with a proper boolean `Switch` toggle row.

---

## Screen Structure (`moduleType === 'cognition'`)

### Card 1 — `GENERAL & PROVIDER`
- **Config Name \*** (`formValues.name`, placeholder `'e.g. Soulbits Subconscious'`)
- **Provider Type \*** (10 LLM providers) + inline **Account** bar.

### Card 2 — `CAPABILITY · COGNITION LLM` (Header right: `Simple | Advanced`)
- **Simple View:**
  - **Model** picker (`modelModuleType = 'cognition'`, tag `'chat'`)
  - **Sampling Preset (TextGen YAML)** selector + **`💾 Save as…`** modal
- **Advanced View:**
  - 2-column sampling grid (`Temperature`, `Top P`, `Max Tokens`, `Seed`, penalties) + `Extended YAML Samplers`.

### Card 3 — `COGNITION SETTINGS`
- **Max Cognition Events** (`max_cognition_events`):
  - Numeric input (`keyboardType="number-pad"`, placeholder `'10'`)
  - Subtitle hint: `"Number of recent interaction events evaluated per cognition cycle."`
- **Generate Expressions** (`generate_expressions`):
  - **Reworked from raw `0 or 1` number input to a boolean `Switch` toggle (`type: 'toggle'`, `toggleValueType: 'numeric'`):**
  - Title: `"Generate Expressions"`
  - Subtitle: `"Emit emotional and facial expression updates during cognition turns"`
  - Persists `1` when enabled and `0` when disabled (matching the engine's `CognitionConfig.GenerateExpressions` int column).

---

## Detailed Implementation Steps

### 1. Update `cognition` `moduleSpecificFields` in `src/constants/moduleConfiguration.ts`
**File:** `src/constants/moduleConfiguration.ts`

Update lines 83–86 of `src/constants/moduleConfiguration.ts`:
```ts
moduleSpecificFields: [
  {
    key: 'max_cognition_events',
    label: 'Max Cognition Events',
    type: 'number',
    placeholder: '10',
    tooltip: 'Number of recent interaction events evaluated per cognition cycle.',
  },
  {
    key: 'generate_expressions',
    label: 'Generate Expressions',
    type: 'toggle',
    toggleValueType: 'numeric',
    tooltip: 'Emit emotional and facial expression updates during cognition turns.',
  },
]
```

### 2. Route `renderModuleSection()` in `ModuleConfigEditScreen.tsx` through `FormField`
**File:** `src/screens/config/ModuleConfigEditScreen.tsx`

Currently, `renderModuleSection()` (lines 638–677) manually renders a bare `<TextInput>` for every entry in `moduleSpecificFields`, ignoring `field.type === 'toggle'`, `field.tooltip`, and `width: 'half'`!
- Replace the manual `<TextInput>` loop in `renderModuleSection()` with `<FormField>` (paired via `groupFieldsIntoRows(fields)` when `width: 'half'` is used) and update the section title from generic `"Module Settings"` to `${moduleConfig.name} Settings` (e.g. `"Cognition Settings"`).

---

## Files to Modify

- `src/constants/moduleConfiguration.ts`
- `src/screens/config/ModuleConfigEditScreen.tsx`
- `src/screens/config/__tests__/ModuleConfigEditScreen.test.tsx`

---

## Progress Checklist

- [ ] Convert `generate_expressions` in `src/constants/moduleConfiguration.ts` from `type: 'number'` (`Generate Expressions (0/1)`) to `type: 'toggle'`, `toggleValueType: 'numeric'`
- [ ] Add descriptive `tooltip` to `max_cognition_events` and `generate_expressions`
- [ ] Update `renderModuleSection()` in `ModuleConfigEditScreen.tsx` to render `moduleSpecificFields` via `<FormField>` with `${moduleConfig.name} Settings` header
- [ ] Add unit test verifying `generate_expressions` toggle writes `1` / `0` on Cognition config save
