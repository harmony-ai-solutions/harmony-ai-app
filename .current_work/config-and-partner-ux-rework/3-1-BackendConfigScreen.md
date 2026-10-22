# Phase 3-1 — Backend Config Screen (Main Chat LLM)

**Repo:** `harmony-ai-app` · **Depends on:** 1-2, 2-1, 2-2, 2-3 · **Blocks:** 5-1  
**Codebase Mapping Refs:** `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/CONVENTIONS.md`

## Objective

Deliver the target UI/UX for the **Edit / New Backend Config** screen (`moduleType = 'backend'`), ensuring only LLM chat capabilities are shown, the TextGen WebUI YAML Preset selector + `Save as…` modal is front-and-center, and Advanced sampling parameters render in a clean 2-column numeric grid without false-positive warning badges or TTS/Imagination field bleed.

---

## Screen Structure (`moduleType === 'backend'`)

### Card 1 — `GENERAL & PROVIDER`
- **Config Name \*** (`formValues.name`, placeholder `'e.g. Soulbits Main Chat'`)
- **Provider Type \*** chip selector (10 providers):
  `OpenAI`, `OpenAI Compatible`, `OpenRouter`, `Soulbits Cloud`, `Google Gemini`, `xAI / Grok`, `Anthropic Claude`, `Mistral`, `Ollama`, `LocalAI`
- **Account Row** (`AccountPicker`):
  - For `soulbitscloud`: compact read-only status bar (`🔑 Account: Soulbits Cloud (system-managed) · Active`), no `+ Add account…` button.
  - For user-managed providers: inline single-account bar with `+ Add / Switch` or multi-account chip selector.

### Card 2 — `CAPABILITY · CHAT` (Header right: `Simple | Advanced` segmented switch)
- **Simple View:**
  1. **Model** (`CatalogModelSelect` / `SoulbitsModelSelect` unified):
     - Right-aligned metadata badge on label row: e.g. `Live · 128k ctx · Vision` (derived from `selectedModel.source`, `selectedModel.context`, `selectedModel.capabilities`).
  2. **Sampling Preset (TextGen YAML)** (`SamplingPresetSelect`):
     - Dropdown (`None (Manual)` + engine YAML presets with param counts) + **`💾 Save as…`** button.
     - Active YAML parameter preview pills below the selector.
  - *Strict exclusion:* `voice`, `language`, `speed`, `format`, `image_aspect_ratio`, `image_size`, `number_of_images`, `image_model` are **never** rendered or seeded into `capability_json` on Backend configs.

- **Advanced View (adds below Sampling Preset):**
  1. **2-Column Core Sampling Grid (`width: 'half'`):**
     - Row 1: `Temperature` (`0–2`, step `0.01`, placeholder `'0.7'`) | `Top P` (`0–1`, step `0.01`, placeholder `'1.0'`)
     - Row 2: `Max Tokens` (placeholder `'Unlimited'`, `disabledValue: -1`) | `Seed` / `Random Seed` (placeholder `'Random'`, `disabledValue: 0`)
     - Row 3 (when supported by provider): `Frequency Penalty` (`-2–2`, placeholder `'0.0'`) | `Presence Penalty` (`-2–2`, placeholder `'0.0'`)
     - Row 4 (OpenAI/xAI/OpenRouter/LocalAI/SoulbitsCloud): `Max Completion Tokens` (placeholder `'Default'`, `disabledValue: 0`) | `N (Completions)` (placeholder `'1 (default)'`, `disabledValue: 0`)
  2. **Reasoning / Thinking Controls (provider-specific):**
     - `Reasoning Effort` (`openai`, `xai`, `mistral`, `localai`)
     - `Thinking Level` + `Thinking Budget` (`google`)
     - `Think` (`ollama`)
  3. **Stop & Format Controls:**
     - `Stop Tokens` / `Stop Sequences` / `Stop` (`comma-list`, placeholder `'e.g. \\n, <|im_end|>'`)
     - `Response Format` / `Response MIME Type`
  4. **Extended YAML Samplers (`AdvancedSamplingParams`):**
     - Collapsible drawer showing active count badge (`e.g. 3 active ▾`) for extended TextGen WebUI parameters (`top_k`, `min_p`, `repetition_penalty`, `typical_p`, `tfs`, `dry_*`, `xtc_*`, `mirostat_*`, `dynatemp_*`).
  5. **Collapsed Unsupported Params Drawer (only when `unsupportedFields.length > 0`):**
     - Tucked at the bottom of the card so active inputs are never interrupted by orange warning walls.

### Card 3 — `DANGER ZONE` (Edit mode only)
- `Delete This Config` button.

---

## Detailed Implementation Steps

1. **Mark paired numeric fields in `PROVIDER_SCHEMAS` (`src/constants/providerFieldSchemas.ts`) with `width: 'half'`:**
   - Set `width: 'half'` on `temperature`, `top_p`, `max_tokens`, `max_output_tokens`, `max_completion_tokens`, `seed`, `random_seed`, `frequency_penalty`, `presence_penalty`, `top_k`, `min_p`, `repetition_penalty`, `repeat_penalty`, `repeat_last_n`, `num_ctx`, `num_predict`, and `n`.
2. **Render consecutive `width: 'half'` fields in 2-column rows inside `ProviderSlotSection.tsx`:**
   - Add a layout grouping pass `groupFieldsIntoRows(fields)` in `ProviderSlotSection.tsx` that pairs adjacent `width: 'half'` fields into a `<View style={styles.twoColRow}>` (`flexDirection: 'row', gap: 12`), while `width: 'full'` (default) fields occupy a full row.
3. **Strip non-chat defaults when creating/switching a Backend slot:**
   - Ensure `emptySlotFor(providerType, 'backend')` only populates keys belonging to `getProviderFieldsForModule(providerType, 'backend')`.

---

## Files to Modify

- `src/constants/providerFieldSchemas.ts`
- `src/components/config/ProviderSlotSection.tsx`
- `src/screens/config/ModuleConfigEditScreen.tsx`
- `src/screens/config/__tests__/ModuleConfigEditScreen.test.tsx`

---

## Progress Checklist

- [ ] Mark standard numeric sampling fields with `width: 'half'` and human-friendly placeholders (`Unlimited`, `Random`, `Default`) in `providerFieldSchemas.ts`
- [ ] Implement 2-column row grouping (`groupFieldsIntoRows`) in `ProviderSlotSection.tsx`
- [ ] Verify `moduleType === 'backend'` renders only `Model` + `Sampling Preset` in Simple mode and never renders or persists TTS/Imagination keys
- [ ] Add component test assertions in `ModuleConfigEditScreen.test.tsx` for Backend Simple & Advanced views
