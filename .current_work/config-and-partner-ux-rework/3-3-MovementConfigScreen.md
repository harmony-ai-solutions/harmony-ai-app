# Phase 3-3 — Movement Config Screen (Action & Avatar Execution)

**Repo:** `harmony-ai-app` · **Depends on:** 1-2, 2-1, 2-2, 2-3, 3-2 · **Blocks:** 5-1  
**Codebase Mapping Refs:** `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/CONVENTIONS.md`

## Objective

Refine the **Edit / New Movement Config** screen (`moduleType = 'movement'`) so its LLM capability section includes the clean Model + TextGen YAML Preset selector and its **Movement Settings** card renders `Startup Sync Timeout (ms)` and `Execution Threshold` side-by-side in a compact 2-column row with clear unit labels and placeholders.

---

## Screen Structure (`moduleType === 'movement'`)

### Card 1 — `GENERAL & PROVIDER`
- **Config Name \*** (`formValues.name`, placeholder `'e.g. Default Movement'`)
- **Provider Type \*** (10 LLM providers) + inline **Account** bar.

### Card 2 — `CAPABILITY · MOVEMENT LLM` (Header right: `Simple | Advanced`)
- **Simple View:**
  - **Model** picker (`modelModuleType = 'movement'`, tag `'chat'`)
  - **Sampling Preset (TextGen YAML)** selector + **`💾 Save as…`** modal
- **Advanced View:**
  - 2-column sampling grid + `Extended YAML Samplers`.

### Card 3 — `MOVEMENT SETTINGS`
- **2-Column Numeric Row (`width: 'half'`):**
  - Left column: **Startup Sync Timeout (ms)** (`startup_sync_timeout`, `type: 'number'`, `disabledValue: 0`, placeholder `'0 ms (none)'`, tooltip `'Wait time for avatar/client sync on session start.'`)
  - Right column: **Execution Threshold** (`execution_threshold`, `type: 'number'`, `step: 0.05`, `min: 0`, `max: 1`, placeholder `'0.5'`, tooltip `'Minimum confidence required to trigger a movement.'`)

---

## Detailed Implementation Steps

### 1. Update `movement` `moduleSpecificFields` in `src/constants/moduleConfiguration.ts`
**File:** `src/constants/moduleConfiguration.ts`

Update lines 98–101 of `src/constants/moduleConfiguration.ts` to use `width: 'half'`, `step: 0.05`, and clear unit labels/placeholders:

```ts
moduleSpecificFields: [
  {
    key: 'startup_sync_timeout',
    label: 'Startup Sync Timeout (ms)',
    type: 'number',
    width: 'half',
    disabledValue: 0,
    placeholder: '0 ms (none)',
    tooltip: 'Wait time for client sync at session start.',
  },
  {
    key: 'execution_threshold',
    label: 'Execution Threshold',
    type: 'number',
    width: 'half',
    step: 0.05,
    min: 0,
    max: 1,
    placeholder: '0.5',
    tooltip: 'Minimum confidence threshold (0–1).',
  },
]
```

### 2. Verify 2-column rendering in `renderModuleSection()`
**File:** `src/screens/config/ModuleConfigEditScreen.tsx`

Because `renderModuleSection()` uses `groupFieldsIntoRows(fields)` (from Phases 3-1 & 3-2), the two `width: 'half'` fields automatically render side-by-side in a single compact row inside the **Movement Settings** card.

---

## Files to Modify

- `src/constants/moduleConfiguration.ts`
- `src/screens/config/ModuleConfigEditScreen.tsx`
- `src/screens/config/__tests__/ModuleConfigEditScreen.test.tsx`

---

## Progress Checklist

- [ ] Update `startup_sync_timeout` and `execution_threshold` in `src/constants/moduleConfiguration.ts` with `width: 'half'`, `step: 0.05`, and clear placeholders
- [ ] Verify `Movement Settings` renders both fields in a single 2-column row and persists numeric values accurately
