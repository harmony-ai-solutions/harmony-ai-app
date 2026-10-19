# Phase 1-2 — Capability Warnings, Module Field Scoping & FormField Upgrades

**Repo:** `harmony-ai-app` · **Depends on:** none · **Blocks:** 2-2, 2-3, 3-1..3-8  
**Codebase Mapping Refs:** `.planning/codebase/ARCHITECTURE.md` (Configuration & Constants), `.planning/codebase/CONVENTIONS.md`

## Objective

1. Fix the R12 capability-warning bug in `src/constants/modelCapabilities.ts` where `model.capabilities` (`["vision"]`, `["reasoning"]`) was merged into `model.param_support`, causing false-positive `⚠ Not supported by <model>` badges on every sampling parameter.
2. Add explicit per-module scoping (`modules?: ModuleCapabilityScope[]`) to `FieldDefinition` in `src/constants/providerFieldSchemas.ts` so TTS fields (`voice`, `language`, `speed`, `format`), Imagination fields (`image_aspect_ratio`, `image_size`, `image_model`, `number_of_images`), and VAD fields (`threshold`, `min_speech_duration_ms`, etc.) only appear on — and only seed defaults into — their matching module types.
3. Upgrade `FormField.tsx` to support boolean `toggle` (`0`/`1` or `boolean` Switch rows), 2-column `width: 'half'` layout rows, and clean placeholder rendering when a numeric field holds its sentinel `disabledValue` (`0` or `-1`).

---

## Root Cause Analysis

1. **False-positive `⚠ Not supported by <model>` warnings (`src/constants/modelCapabilities.ts:99-106`):**
   - Currently:
     ```ts
     export function supportedParams(
       model: ModelInfoDto | null | undefined,
     ): ReadonlySet<string> | null {
       if (!model) return null;
       const declared = [...(model.param_support ?? []), ...(model.capabilities ?? [])];
       if (declared.length === 0) return null;
       return new Set(declared);
     }
     ```
   - `model.capabilities` contains high-level modality/feature tags (`"vision"`, `"reasoning"`, `"tools"`, `"embedding"`, `"chat"`), **never** sampling parameter names.
   - When `model.param_support` is `undefined` or `[]` (as on `SoulbitsCloud` where `qwen-35-9b` and `gemma4-meromero-26b-a4b` have `capabilities: ["vision"]`), `declared` becomes `["vision"]`, so `supportedParams` returns `Set(["vision"])` instead of `null`. Every sampling parameter (`temperature`, `max_tokens`, `top_p`, etc.) then evaluates `isParamSupported(model, key) === false`!

2. **Cross-module capability field bleed (`src/constants/providerFieldSchemas.ts` & `src/constants/accountFieldSchemas.ts`):**
   - `PROVIDER_SCHEMAS` is keyed solely by `providerType`. A multi-capability provider like `soulbitscloud`, `openai`, `openrouter`, `google`, `xai`, `soulvoice`, or `ollama` includes chat, TTS, VAD, and image-generation fields in one flat `fields` array.
   - Because `voice`, `language`, `speed`, `format` are in `SIMPLE_FIELD_KEYS`, opening **Edit Backend Config** renders TTS fields in Simple mode and saves `voice: 'alloy'`, `speed: 1`, `format: 'mp3'` into the Backend config's `capability_json`.

3. **Raw `0 or 1` number inputs and `-1` / `0` sentinel clutter (`FormField.tsx`):**
   - Boolean flags (`generate_expressions`, `vocalize_nonverbal`, `speaker_boost`, `stream`, `return_seconds`) are defined as `type: 'number'` with labels like `Vocalize Nonverbal (0/1)`.
   - Numeric fields with `disabledValue: -1` or `disabledValue: 0` (`max_tokens`, `max_completion_tokens`, `seed`, `n`) render literal `0` or `-1` in the `TextInput` instead of showing an empty field with a descriptive placeholder (`"Unlimited"`, `"Random"`, `"1 (default)"`).

---

## Detailed Implementation Steps

### 1. Fix `supportedParams()` in `src/constants/modelCapabilities.ts`
Change `supportedParams` so it inspects **only** `model.param_support`:

```ts
export function supportedParams(
  model: ModelInfoDto | null | undefined,
): ReadonlySet<string> | null {
  if (!model) return null;
  const declared = model.param_support ?? [];
  if (declared.length === 0) return null;
  return new Set(declared);
}
```
- When `model.param_support` is `undefined` or `[]`, `supportedParams(model)` returns `null` → `isParamSupported(model, key)` returns `null` → **zero false-positive warnings**.
- Add a helper `partitionFieldsBySupport(fields, selectedModel)` that splits capability fields into `{ supportedFields, unsupportedFields }` so `ProviderSlotSection` can tuck genuinely unsupported fields into a single collapsed footer drawer in Advanced mode instead of rendering 10 orange warning badges.

### 2. Add `modules?: ModuleCapabilityScope[]` to `FieldDefinition` & Scope `PROVIDER_SCHEMAS`
**Files:** `src/constants/providerFieldSchemas.ts`, `src/constants/accountFieldSchemas.ts`

1. Define the module capability scope union in `src/constants/providerFieldSchemas.ts`:
   ```ts
   export type ModuleCapabilityScope =
     | 'backend'
     | 'cognition'
     | 'movement'
     | 'rag'
     | 'tts'
     | 'stt'
     | 'vad'
     | 'vision'
     | 'imagination';

   export const LLM_CHAT_MODULES: readonly ModuleCapabilityScope[] = [
     'backend',
     'cognition',
     'movement',
     'vision',
   ];
   ```
2. Extend `FieldDefinition`:
   ```ts
   export interface FieldDefinition {
     key: string;
     label: string;
     type: 'text' | 'password' | 'number' | 'select' | 'checkbox' | 'toggle' | 'comma-list' | 'chips';
     /** When set, this capability field only applies to the listed module scopes. */
     modules?: readonly ModuleCapabilityScope[];
     /** For type === 'toggle', whether the persisted representation is 0/1 ('numeric') or boolean ('boolean'). */
     toggleValueType?: 'numeric' | 'boolean';
     ...
   }
   ```
3. Add a pure filter helper exported from `src/constants/providerFieldSchemas.ts`:
   ```ts
   export function getProviderFieldsForModule(
     providerType: string,
     modelModuleType: string,
   ): FieldDefinition[] {
     const all = PROVIDER_SCHEMAS[providerType]?.fields ?? [];
     return all.filter(
       (f) => !f.modules || f.modules.includes(modelModuleType as ModuleCapabilityScope),
     );
   }
   ```
4. Scope all fields in `PROVIDER_SCHEMAS`:
   - Sampling & preset fields (`sampling_preset_name`, `max_tokens`, `max_completion_tokens`, `max_output_tokens`, `temperature`, `top_p`, `top_k`, `top_a`, `min_p`, `repetition_penalty`, `repeat_penalty`, `repeat_last_n`, `frequency_penalty`, `presence_penalty`, `seed`, `random_seed`, `stop_tokens`, `stop_sequences`, `stop`, `response_format`, `response_mime_type`, `reasoning_effort`, `thinking_level`, `thinking_budget`, `think`, `num_ctx`, `num_predict`, `n` on chat): `modules: LLM_CHAT_MODULES`.
   - TTS fields (`voice`, `voice_id`, `language`, `speed`, `format` on speech, `stability`, `similarity_boost`, `style`, `speaker_boost`, `voice_config_file`, `sample_rate`, `stream`): `modules: ['tts']`.
   - VAD fields on `soulvoice` (`threshold`, `min_speech_duration_ms`, `min_silence_duration_ms`, `speech_pad_ms`, `return_seconds`): `modules: ['vad']`.
   - Imagination fields (`image_aspect_ratio`, `aspect_ratio`, `image_size`, `image_resolution`, `image_model`, `number_of_images`, `n` on OpenAI image, `workflow_profiles`): `modules: ['imagination']`.
   - Remove the redundant `"Used by TTS module."` / `"Used by Imagination module."` tooltips.
5. Update `capabilityDefaultsOf(providerType, defaults, modelModuleType?)` in `src/constants/accountFieldSchemas.ts` so it only seeds defaults for fields matching `getProviderFieldsForModule(providerType, modelModuleType)` (plus `extra_params` for `LLM_CHAT_MODULES`).

### 3. Upgrade `FormField.tsx` for `toggle`, `chips`, `width: 'half'`, and `disabledValue`
**File:** `src/components/config/FormField.tsx`

1. **`type: 'toggle'`:** Render a horizontal row with label + optional `tooltip` subtitle on the left and a themed `<Switch>` on the right. When `toggleValueType === 'numeric'`, convert `Boolean(value)` ↔ `val ? 1 : 0`.
2. **`type: 'chips'`:** Render a wrap row of pill chips from `field.options` (used for `Aspect Ratio` `1:1 | 16:9 | 9:16 | 4:3 | 3:4` on Imagination).
3. **`disabledValue` handling on `type: 'number'`:** When `field.disabledValue !== undefined && value === field.disabledValue`, display `''` in the `TextInput` so the user sees the clean `placeholder` (`"Unlimited"`, `"Random"`, `"Default"`) instead of literal `-1` or `0`; when cleared to `''`, emit `field.disabledValue`.

---

## Files to Create / Modify

- `src/constants/modelCapabilities.ts`
- `src/constants/__tests__/modelCapabilities.test.ts`
- `src/constants/providerFieldSchemas.ts`
- `src/constants/accountFieldSchemas.ts`
- `src/components/config/FormField.tsx`

---

## Progress Checklist

- [ ] Fix `supportedParams()` in `src/constants/modelCapabilities.ts` to only read `model.param_support`
- [ ] Add `partitionFieldsBySupport()` helper and unit tests in `modelCapabilities.test.ts`
- [ ] Add `modules?: readonly ModuleCapabilityScope[]` to `FieldDefinition` and tag all chat, TTS, VAD, and Imagination fields in `PROVIDER_SCHEMAS`
- [ ] Export `getProviderFieldsForModule(providerType, modelModuleType)` and update `capabilityDefaultsOf` to filter by `modelModuleType`
- [ ] Add `toggle`, `chips`, and `disabledValue` empty-input display support to `FormField.tsx`
