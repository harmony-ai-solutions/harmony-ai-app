# Phase 3-4 — RAG Config Screen (Memory & Embeddings)

**Repo:** `harmony-ai-app` · **Depends on:** 1-2, 2-3 · **Blocks:** 5-1  
**Codebase Mapping Refs:** `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/CONVENTIONS.md`

## Objective

Clean up the **Edit / New RAG Config** screen (`moduleType = 'rag'`) so that it only shows embedding-relevant controls:
1. Exclude all LLM chat sampling fields (`temperature`, `top_p`, `max_tokens`, `sampling_preset_name`, `seed`, penalties) and all TTS/Imagination fields, since `POST /v1/embeddings` uses none of them.
2. Surface the embedding model's vector dimension count (`meta.embedding_dimensions`, e.g. `1024 dims`) right on the `Embedding Model` label header.
3. Tuck `Embedding Concurrency` (`embedding_concurrency`) into the **Advanced** view with a clean `"Auto (default)"` placeholder instead of a raw `0` input in Simple mode.

---

## Screen Structure (`moduleType === 'rag'`)

### Card 1 — `GENERAL & PROVIDER`
- **Config Name \*** (`formValues.name`, placeholder `'e.g. Soulbits Memory'`)
- **Provider Type \*** (7 embedding-capable providers):
  `OpenAI`, `OpenAI Compatible`, `OpenRouter`, `Soulbits Cloud`, `Mistral`, `Ollama`, `LocalAI`
- **Account Row** (`AccountPicker`).

### Card 2 — `CAPABILITY · EMBEDDINGS` (Header right: `Simple | Advanced`)
- **Simple View:**
  - **Embedding Model** (`modelModuleType = 'rag'`, filtered by capability tag `'embedding'`):
    - Displays `Live · 1024 dims` badge when `selectedModel?.meta?.embedding_dimensions` is present.
    - Subtitle hint: `"Used for long-term memory vectors and semantic lorebook retrieval."`
  - *No `Sampling Preset`, no `Temperature`, no `Voice`!*
- **Advanced View:**
  - **Embedding Concurrency** (`embedding_concurrency`, `disabledValue: 0`, placeholder `'Auto (default)'`, tooltip `'Maximum parallel embedding requests (leave empty for engine default).'`).

---

## Detailed Implementation Steps

### 1. Ensure `PROVIDER_SCHEMAS` excludes chat sampling fields for `moduleType === 'rag'`
**File:** `src/constants/providerFieldSchemas.ts`

Because Phase 1-2 tags `sampling_preset_name` and all chat sampling fields with `modules: LLM_CHAT_MODULES` (`['backend', 'cognition', 'movement', 'vision']`), `getProviderFieldsForModule(providerType, 'rag')` automatically returns **only** `{ key: 'model', label: 'Embedding Model', ... }`!

### 2. Surface `meta.embedding_dimensions` badge in `ProviderSlotSection.tsx`
**File:** `src/components/config/ProviderSlotSection.tsx`

When `modelModuleType === 'rag'`:
- Override the `model` field label to `t('embeddingModel', 'Embedding Model')`.
- Read `selectedModel?.meta?.embedding_dimensions` and display `${dims} dims` in the right-hand model metadata badge.
- Render a muted helper caption below the picker explaining that changing the embedding model changes vector dimensions for new memories.

### 3. Tuck `embedding_concurrency` into Advanced Mode
**Files:** `src/constants/moduleConfiguration.ts`, `src/screens/config/ModuleConfigEditScreen.tsx`

In `src/constants/moduleConfiguration.ts:110-112`:
```ts
moduleSpecificFields: [
  {
    key: 'embedding_concurrency',
    label: 'Embedding Concurrency',
    type: 'number',
    disabledValue: 0,
    placeholder: 'Auto (default)',
    tooltip: 'Maximum parallel embedding requests (leave empty for engine default).',
  },
]
```
In `ModuleConfigEditScreen.tsx`, when `moduleType === 'rag'` and `!showAdvanced`, hide the `RAG Settings` card (or render `embedding_concurrency` inside the capability card when `showAdvanced` is `true`) so Simple mode for RAG is a clean 2-card screen (`General & Provider` + `Embedding Model`).

---

## Files to Modify

- `src/constants/moduleConfiguration.ts`
- `src/components/config/ProviderSlotSection.tsx`
- `src/screens/config/ModuleConfigEditScreen.tsx`
- `src/i18n/locales/en/moduleConfig.json`

---

## Progress Checklist

- [ ] Verify `getProviderFieldsForModule(providerType, 'rag')` returns only `model` (no sampling preset, chat params, or TTS fields)
- [ ] Display `meta.embedding_dimensions` badge (`1024 dims`) on the `Embedding Model` row when available
- [ ] Update `embedding_concurrency` with `disabledValue: 0` and `'Auto (default)'` placeholder, shown only in Advanced mode
- [ ] Add unit test in `ModuleConfigEditScreen.test.tsx` for `moduleType === 'rag'`
