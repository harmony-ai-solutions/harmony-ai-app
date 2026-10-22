# Phase 3-7 — Vision Config Screen (Multimodal Image Understanding)

**Repo:** `harmony-ai-app` · **Depends on:** 1-2, 2-1, 2-2, 2-3, 3-1 · **Blocks:** 5-1  
**Codebase Mapping Refs:** `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/CONVENTIONS.md`

## Objective

Refine the **Edit / New Vision Config** screen (`moduleType = 'vision'`) so its model picker filters to multimodal `vision`-capable models, includes the TextGen WebUI YAML Preset selector + `Save as…` modal, excludes all TTS and Image-Generation fields, and renders `Max Width (px)` and `Max Height (px)` side-by-side in a 2-column row inside the **Image Preprocessing** card.

---

## Screen Structure (`moduleType === 'vision'`)

### Card 1 — `GENERAL & PROVIDER`
- **Config Name \*** (`formValues.name`, placeholder `'e.g. Soulbits Vision'`)
- **Provider Type \*** (10 multimodal LLM providers):
  `OpenAI`, `OpenAI Compatible`, `OpenRouter`, `Soulbits Cloud`, `Google Gemini`, `xAI / Grok`, `Anthropic Claude`, `Mistral`, `Ollama`, `LocalAI`
- **Account Row** (`AccountPicker`).

### Card 2 — `CAPABILITY · MULTIMODAL VISION` (Header right: `Simple | Advanced`)
- **Simple View:**
  - **Vision Model** (`modelModuleType = 'vision'`, filtered by capability tag `'vision'`):
    - Displays `Live · Vision` badge.
  - **Sampling Preset (TextGen YAML)** selector + **`💾 Save as…`** modal.
- **Advanced View:**
  - 2-column sampling grid (`Temperature`, `Top P`, `Max Tokens`, `Seed`, penalties) + `Extended YAML Samplers`.

### Card 3 — `IMAGE PREPROCESSING` (Vision Module Settings)
- **2-Column Resolution Row (`width: 'half'`):**
  - Left column: **Max Width (px)** (`resolution_width`, `type: 'number'`, placeholder `'1024'`, tooltip `'Downscale input images wider than this before sending.'`)
  - Right column: **Max Height (px)** (`resolution_height`, `type: 'number'`, placeholder `'1024'`, tooltip `'Downscale input images taller than this before sending.'`)

---

## Detailed Implementation Steps

### 1. Update `vision` `moduleSpecificFields` in `src/constants/moduleConfiguration.ts`
**File:** `src/constants/moduleConfiguration.ts`

Update lines 139–142 of `src/constants/moduleConfiguration.ts` so `resolution_width` and `resolution_height` use `width: 'half'` and clear pixel labels:

```ts
moduleSpecificFields: [
  {
    key: 'resolution_width',
    label: 'Max Width (px)',
    type: 'number',
    width: 'half',
    placeholder: '1024',
    tooltip: 'Maximum image width in pixels.',
  },
  {
    key: 'resolution_height',
    label: 'Max Height (px)',
    type: 'number',
    width: 'half',
    placeholder: '1024',
    tooltip: 'Maximum image height in pixels.',
  },
]
```

### 2. Verify Vision Model Filtering & No Imagination Bleed
**Files:** `src/constants/providerFieldSchemas.ts`, `src/constants/modelCapabilities.ts`

- Because `MODULE_CAPABILITY_TAGS.vision === 'vision'`, `catalogModelsForModule` filters the offline catalog to models with `'vision'` (or undeclared tags), and live discovery passes `module: 'vision'` to `POST /api/providers/models`.
- Because `image_aspect_ratio`, `aspect_ratio`, `image_size`, `image_resolution`, `image_model`, `number_of_images` are scoped to `modules: ['imagination']` (Phase 1-2), they never bleed into `Vision` configs.

---

## Files to Modify

- `src/constants/moduleConfiguration.ts`
- `src/screens/config/ModuleConfigEditScreen.tsx`
- `src/screens/config/__tests__/ModuleConfigEditScreen.test.tsx`

---

## Progress Checklist

- [ ] Update `resolution_width` and `resolution_height` in `src/constants/moduleConfiguration.ts` with `width: 'half'` and `'Max Width (px)'` / `'Max Height (px)'` labels
- [ ] Verify `Vision` config screen renders both resolution inputs side-by-side and excludes `Imagination` / `TTS` fields
