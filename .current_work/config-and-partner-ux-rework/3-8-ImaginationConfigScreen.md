# Phase 3-8 — Imagination Config Screen (Cloud Image Gen & ComfyUI)

**Repo:** `harmony-ai-app` · **Depends on:** 1-2, 2-3 · **Blocks:** 5-1  
**Codebase Mapping Refs:** `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/CONVENTIONS.md`

## Objective

Rework the **Edit / New Imagination Config** screen (`moduleType = 'imagination'`) so that:
1. Only image-generation fields appear (excluding all LLM chat sampling fields like `Temperature`, `Top P`, `Max Tokens`, `Sampling Preset`, `Seed`, `Reasoning Effort`, and all TTS fields).
2. On `xai`, the dedicated `image_model` field (`grok-imagine-image-2.0`) is the primary model picker in Imagination instead of showing both the chat `model` (`grok-3`) and `image_model` side by side.
3. All cloud image providers (`soulbitscloud`, `openrouter`, `google`, `xai`) share a consistent visual **Aspect Ratio** pill selector (`type: 'chips'`: `1:1 Square`, `16:9 Landscape`, `9:16 Portrait`, `4:3`, `3:4`) in Simple mode instead of making users type raw strings like `"1:1"` on `soulbitscloud`/`openrouter`.
4. **ComfyUI** renders its live-discovered `Checkpoint Model` picker (from `/object_info`) in Simple mode and `Workflow Profiles (JSON)` in Advanced mode.

---

## Screen Structure (`moduleType === 'imagination'`)

### Card 1 — `GENERAL & PROVIDER`
- **Config Name \*** (`formValues.name`, placeholder `'e.g. Soulbits Image Gen'`)
- **Provider Type \*** (6 image-generation providers):
  `ComfyUI`, `OpenAI`, `OpenRouter`, `Soulbits Cloud`, `Google Gemini`, `xAI / Grok`
- **Account Row** (`AccountPicker`).

### Card 2 — `CAPABILITY · IMAGE GENERATION` (Header right: `Simple | Advanced`)

#### Branch A — Cloud / API Image Providers (`soulbitscloud`, `openai`, `openrouter`, `google`, `xai`)
- **Simple View:**
  1. **Image Model** (`model`, or `image_model` on `xai` per Phase 4-4 engine contract where `xai` reads `image_model` and never falls back to chat `model`):
     - Filtered to `image` models (`modelModuleType = 'imagination'`).
  2. **Aspect Ratio** (`image_aspect_ratio` / `aspect_ratio`, `type: 'chips'`, added to `SIMPLE_FIELD_KEYS`):
     - Pill options: `Default`, `1:1`, `16:9`, `9:16`, `4:3`, `3:4`.
- **Advanced View:**
  - **2-Column Resolution & Count Row (`width: 'half'`):**
    - `Image Size / Resolution` (`image_size` / `image_resolution`, placeholder `'1024x1024'`)
    - `Images per Prompt` (`n` on OpenAI / `number_of_images` on Google, placeholder `'1'`)

#### Branch B — ComfyUI (`comfyui`)
- **Simple View:**
  - **Checkpoint Model** (`model`, live-discovered from ComfyUI `/object_info` `CheckpointLoaderSimple`).
- **Advanced View:**
  - **Workflow Profiles (JSON)** (`workflow_profiles`, `type: 'text'`, placeholder `'Optional custom workflow JSON'`).

---

## Detailed Implementation Steps

### 1. Scope Imagination fields vs. Chat `model` in `src/constants/providerFieldSchemas.ts`
**File:** `src/constants/providerFieldSchemas.ts`

1. On `xai`:
   - Scope `{ key: 'model', ... }` to `modules: ['backend', 'cognition', 'movement', 'vision']` (excluding `'imagination'`) and keep `{ key: 'image_model', label: 'Image Model', type: 'text', placeholder: 'grok-imagine-image-2.0', catalog: true, modules: ['imagination'] }`.
   - In `ProviderSlotSection.tsx`, route any field with `field.catalog === true` (`field.key === 'model' || field.key === 'image_model'`) through `CatalogModelSelect` (passing `field.key` to `onCapabilityChange(field.key, m)`).
2. Convert `image_aspect_ratio` (on `openrouter`, `soulbitscloud`, `xai`) and `aspect_ratio` (on `google`) to `type: 'chips'` with options:
   ```ts
   const ASPECT_RATIO_OPTIONS = [
     { id: '', name: 'Default' },
     { id: '1:1', name: '1:1 Square' },
     { id: '16:9', name: '16:9 Landscape' },
     { id: '9:16', name: '9:16 Portrait' },
     { id: '4:3', name: '4:3' },
     { id: '3:4', name: '3:4' },
   ];
   ```
3. Add `'image_model'`, `'image_aspect_ratio'`, and `'aspect_ratio'` to `SIMPLE_FIELD_KEYS` in `src/constants/moduleConfigVisibility.ts` (and remove `'workflow_profiles'` from `SIMPLE_FIELD_KEYS` so raw ComfyUI JSON stays in Advanced mode).

---

## Files to Modify

- `src/constants/providerFieldSchemas.ts`
- `src/constants/moduleConfigVisibility.ts`
- `src/components/config/ProviderSlotSection.tsx`
- `src/screens/config/__tests__/ModuleConfigEditScreen.test.tsx`

---

## Progress Checklist

- [ ] Scope `xai`'s `model` out of `'imagination'` so `image_model` is the sole model picker on xAI Imagination configs
- [ ] Route `field.catalog === true` (`model` and `image_model`) through `CatalogModelSelect` in `ProviderSlotSection.tsx`
- [ ] Upgrade `image_aspect_ratio` and `aspect_ratio` to `type: 'chips'` with `ASPECT_RATIO_OPTIONS` and include them in `SIMPLE_FIELD_KEYS`
- [ ] Move ComfyUI `workflow_profiles` to Advanced mode (remove from `SIMPLE_FIELD_KEYS`)
- [ ] Add unit test in `ModuleConfigEditScreen.test.tsx` verifying Imagination Simple & Advanced views for both Cloud and ComfyUI providers
