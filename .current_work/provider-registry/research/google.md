# Provider Research — Google Gemini API (AI Studio / API-key flavor)

Provider key: `google` · Scope: `generativelanguage.googleapis.com` (the **Gemini Developer API**,
a.k.a. Google AI Studio / API-key flavor) — **NOT** Vertex AI (`aiplatform.googleapis.com`).
Research date: **2026-10-18**. All external claims cite the official doc URL used; engine facts are
tagged `[engine-code]`.

Repos read for the `[engine-code]` facts:
- `harmony-link-private/providers/google.go`
- `harmony-link-private/config/types.go` (`GoogleProviderConfig`, line 487)
- `harmony-link-private/database/models/provider_google.go`
- `harmony-ai-app/src/constants/providerFieldSchemas.ts` (`google:` block, line 183)
- `harmony-link-private/go.mod` → `google.golang.org/genai v1.59.0`

Sources (official unless noted):
- https://ai.google.dev/api/models — Model resource + `models.list` / `models.get`
- https://ai.google.dev/api/all-methods — `v1beta.models` method list
- https://ai.google.dev/api — authentication (`x-goog-api-key`), generateContent overview
- https://ai.google.dev/api/generate-content — `GenerateContentRequest` + `GenerationConfig` + `ThinkingConfig`/`ThinkingLevel`/`ImageConfig`/`ResponseFormatConfig`/`Modality`/`MediaResolution`
- https://ai.google.dev/gemini-api/docs/api-key — key types (standard vs authorization), origin, restrictions
- https://ai.google.dev/gemini-api/docs/api-versions — `v1` vs `v1beta`
- https://ai.google.dev/gemini-api/docs/models — current model lineup (last updated 2026-10-13)
- https://ai.google.dev/gemini-api/docs/thinking — thinking levels, thought signatures, `max_output_tokens` interaction
- https://ai.google.dev/gemini-api/docs/troubleshooting — parameter ranges, temperature/top_p/top_k deprecation, leaked-key errors
- https://ai.google.dev/gemini-api/docs/api-errors — Interactions API error codes
- https://ai.google.dev/gemini-api/docs/generate-content/api-errors — **GenerateContent (legacy) error taxonomy** + error body shape
- https://ai.google.dev/gemini-api/docs/rate-limits — RPM/TPM/RPD, usage tiers, spend limits
- https://ai.google.dev/gemini-api/docs/openai — OpenAI-compatible endpoint (cross-check only)

---

## 1. API basics

### Base URL + version path

- Base host: `https://generativelanguage.googleapis.com`.
- Two API versions: **`v1beta`** (default for the SDKs; carries preview features) and **`v1`** (stable).
  All models are reachable on both; the version selects which *endpoint routes and schema parameters*
  are available. The GenAI SDKs default to `v1beta`. [https://ai.google.dev/gemini-api/docs/api-versions]
- Endpoint forms (all under `/v1beta` or `/v1`):
  - `GET  /v1beta/models` — list models
  - `GET  /v1beta/models/{model}` — get one model
  - `POST /v1beta/models/{model}:generateContent` — generate (the "chat" call)
  - `POST /v1beta/models/{model}:streamGenerateContent`, `:countTokens`, `:embedContent`, `:batchEmbedContents`, `:predict`, `:predictLongRunning`, `:batchGenerateContent`, `:asyncBatchEmbedContent`
  - `POST /v1beta/interactions` — **new** Interactions API (GA in `v1`; see quirks §6)
  [https://ai.google.dev/api/all-methods]
- **Recommendation for us:** use **`v1beta`** (SDK default; the model-list + generateContent shapes we use
  are identical across versions, and `v1beta` keeps preview models reachable). Do not hardcode `v1`.

### API-key auth variants

The Gemini Developer API accepts the key in exactly two places:
1. **`x-goog-api-key: <KEY>` request header** — **documented as the required/recommended method.**
   "All requests to the Gemini API must include a `x-goog-api-key` header with your API key."
   [https://ai.google.dev/api]
2. **`?key=<KEY>` query parameter** — still accepted (used throughout the cookbook `curl` examples), but
   it leaks the key into proxy/CDN/access logs, browser history and Referer headers. Community PRs
   actively migrate callers off it. [https://ai.google.dev/api/models ; security rationale: github.com/continuedev/continue#12190]

Notes:
- **`Authorization: Bearer <KEY>` is NOT a valid auth scheme for this API** — it is ignored, so the request
  arrives keyless and fails. Bearer is only used by the separate OpenAI-compatibility shim
  (`/v1beta/openai/...`). [community corroboration: kunavo.com/guides/gemini-api-key-not-valid; forum thread discuss.ai.google.dev/t/.../187266]
- **Verdict:** use the **`x-goog-api-key` header** everywhere (verify + models + generation). The SDK
  (`genai.NewClient`) already does this; our engine never hand-builds the URL, so we are fine.

### Key format / origin

- Keys are minted in **Google AI Studio** (https://aistudio.google.com/apikey). Every key is tied to a
  Google Cloud project (billing + quota are **per project, not per key**). New AI Studio users get an
  auto-created default project + key. [https://ai.google.dev/gemini-api/docs/api-key]
- **Key types (this changed in 2026 — important for UX copy):**
  - **Standard keys** — "traffic" keys, no caller identity. Classic AI Studio format is `AIzaSy…`
    (≈39 chars). [https://ai.google.dev/gemini-api/docs/api-key ; prefix detail: cloud.google.com/docs/authentication/api-keys and third-party bfd.studio/blog/two-google-keys-two-endpoints]
  - **Authorization ("auth") keys** — bound to a Google Cloud service account; **all keys created in
    AI Studio since 2026-05-28 are auth keys**. These are the `AQ.…` prefix (≈53 chars).
    [https://ai.google.dev/gemini-api/docs/api-key ; forum: discuss.ai.google.dev/t/.../169242]
  - **Unrestricted standard keys are being rejected** (announced cutoff **2026-06-19**; also dormant
    unrestricted keys blocked from 2026-05-07). AI Studio keys are restricted to the Gemini API by
    default. [https://ai.google.dev/gemini-api/docs/api-key ; forum: discuss.ai.google.dev/t/.../187266]
- **Implication:** a user may paste either `AIzaSy…` or `AQ.…`. Both are valid AI Studio keys and both
  authenticate at `generativelanguage.googleapis.com` with `x-goog-api-key`. Do **not** validate the key
  by prefix/length — validate by calling the API. A **Vertex** key (`AQ.` from Vertex Express, or an OAuth
  token) sent to the AI Studio endpoint returns `API_KEY_SERVICE_BLOCKED` / `PERMISSION_DENIED`; surface
  that as "this looks like a Vertex AI key, not an AI Studio key". [forum: discuss.ai.google.dev/t/.../187266 ; third-party: bfd.studio]

### Restrictions

Keys can carry (a) **API restrictions** (limit to `generativelanguage.googleapis.com`) and (b)
**application restrictions** (website / IP / Android package+cert / iOS bundle). Server-side/backend calls
send no Referer, so a website-restricted key can 403 from the engine; IP restrictions are the correct
backend control. [https://ai.google.dev/gemini-api/docs/api-key ; cloud.google.com/blog/topics/developers-practitioners/api-keys-are-open-secrets]

---

## 2. Key validation

### Cheapest side-effect-free call

**`GET https://generativelanguage.googleapis.com/v1beta/models?pageSize=1`** with the `x-goog-api-key` header.

This is exactly what the engine already does. `[engine-code]` `google.go` → `ValidateConfig()`:
`p.client.Models.List(ctx, &genai.ListModelsConfig{QueryBase: genai.Ptr(true), PageSize: 1})`, then it
treats an empty page with no `NextPageToken` as "check API key". Keep this — it is the right call.

- Side-effect-free (read-only, no token spend, no billable generation).
- Returns fast and is the same endpoint the model-list feature uses.
- `pageSize=1` bounds the payload. (Docs: default 50, max 1000 per page.)
  [https://ai.google.dev/api/models]

### Expected 2xx shape

```json
{
  "models": [
    {
      "name": "models/gemini-3.8-flash",
      "displayName": "Gemini 3.8 Flash",
      "description": "…",
      "inputTokenLimit": 1048576,
      "outputTokenLimit": 65536,
      "supportedGenerationMethods": ["generateContent", "countTokens", "createCachedContent", "batchGenerateContent"],
      "thinking": true
    }
  ],
  "nextPageToken": "…"   // present only if more pages exist
}
```
Any HTTP 200 with a non-empty `models` array (or a non-empty `nextPageToken`) ⇒ key is valid.
[https://ai.google.dev/api/models]

### Failure signals (and what they actually mean)

The GenerateContent API returns a **gRPC-status-shaped body** with a numeric `code`, a `status`
`SCREAMING_CASE` string, and a `details[]` array carrying `reason` (e.g. `API_KEY_INVALID`).
[https://ai.google.dev/gemini-api/docs/generate-content/api-errors]

```json
{ "error": { "code": 400, "message": "API key not valid. Please pass a valid API key.",
  "status": "INVALID_ARGUMENT",
  "details": [ { "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                 "reason": "API_KEY_INVALID", "domain": "googleapis.com",
                 "metadata": { "service": "generativelanguage.googleapis.com" } } ] } }
```

| HTTP | `status` | `reason` (if present) | Meaning for the "Test key" button |
|------|----------|----------------------|-----------------------------------|
| **400** | `INVALID_ARGUMENT` | `API_KEY_INVALID` | **Key is invalid.** This is the canonical bad-key signal. `message` = "API key not valid. Please pass a valid API key." |
| **403** | `PERMISSION_DENIED` | `API_KEY_SERVICE_BLOCKED` / other | Key is real but **not allowed here** — e.g. a Vertex key against the AI Studio endpoint, or an over-restricted key. Show a targeted hint, not "invalid". |
| **403** | `PERMISSION_DENIED` | — | Key lacks permission (wrong project / tuned-model auth). |
| **401** | `UNAUTHENTICATED` | `API_KEY_SERVICE_BLOCKED` | Almost always the caller used `Authorization: Bearer` (ignored) or sent no key at all. |
| **400** | `FAILED_PRECONDITION` | — | "free tier not available in your country" / billing prerequisite not met. **Key is valid**; region/billing problem. |
| **402** | `RESOURCE_EXHAUSTED` | — | Prepay credit balance depleted (billing account). Key valid; do not retry. |
| **429** | `RESOURCE_EXHAUSTED` | — | **Key is valid but rate-limited / quota exhausted** (RPM/TPM/RPD or spend). |
| **404** | `NOT_FOUND` | — | Resource (not the key) missing. |
| **503** | `UNAVAILABLE` | — | Transient overload; retry with backoff. |

[https://ai.google.dev/gemini-api/docs/generate-content/api-errors ; https://ai.google.dev/gemini-api/docs/api-errors ; https://ai.google.dev/gemini-api/docs/troubleshooting]

**Verify logic we should implement:** treat only **400 + `reason==API_KEY_INVALID`** as *invalid key*.
Everything else (403/401/402/429/5xx) ⇒ *key accepted / inconclusive* with a specific `detail` string —
never a flat "invalid", because 429 and 402 both mean the key works. A leaked/blocked key returns
`message` = "Your API key was reported as leaked. Please use another API key."
[https://ai.google.dev/gemini-api/docs/troubleshooting]

### Quota implications

`models.list` is a metadata call and is **not** token-billed; it does count toward the project's **RPM**
(requests per minute) budget, which is negligible for a one-shot test. RPD quotas reset at midnight
Pacific. Rate limits are **per project**, so two accounts sharing one GCP project share the quota.
[https://ai.google.dev/gemini-api/docs/rate-limits]

---

## 3. Model listing

### Endpoint

- **`GET /v1beta/models`** (also `/v1/models`). Request body must be **empty**.
- Query params: `pageSize` (default 50, max 1000/page) and `pageToken` (opaque cursor from the previous
  response's `nextPageToken`; when paginating, all other params must match the original call).
  [https://ai.google.dev/api/models]
- Single-model variant: **`GET /v1beta/models/{name=models/*}`** (e.g. `/v1beta/models/gemini-3.8-flash`).
- The Go SDK exposes `client.Models.List(ctx, &genai.ListModelsConfig{...})` returning a page with
  `.Items`, `.NextPageToken`, and `.Next(ctx)`. `[engine-code]` `ListModels()` already pages correctly.
  [https://ai.google.dev/api/models]

### Response shape (ListModelsResponse)

```json
{ "models": [ { Model }, … ], "nextPageToken": "string" }
```

### Model resource fields

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | `models/{model}`, e.g. `models/gemini-3.8-flash`. **Pass this verbatim** as the model id. |
| `baseModelId` | string | Base model name to pass to generation, e.g. `gemini-1.5-flash`. |
| `version` | string | Major version (`1.0`, `1.5`, `2.5`, …). |
| `displayName` | string | Human-readable, e.g. "Gemini 1.5 Flash" (≤128 chars). Good for picker labels. |
| `description` | string | Short description. |
| `inputTokenLimit` | integer | Max input tokens ⇒ **live context-window metadata**. |
| `outputTokenLimit` | integer | Max output tokens. |
| `supportedGenerationMethods[]` | string[] | **Capability metadata** — the model's supported API methods (see below). |
| `thinking` | boolean | **New live capability flag** — whether the model supports thinking. |
| `temperature` | number | Backend default temperature (not a capability). |
| `maxTemperature` | number | Upper bound of the supported temperature range. |
| `topP` | number | Backend default top-P. |
| `topK` | integer | Backend default top-K; **empty ⇒ model does not use top-k sampling and `topK` is not allowed on requests.** |
| `tunedModel` | object | Present on tuned models (points to the base model). |

[https://ai.google.dev/api/models]

### `supportedGenerationMethods` — enumerate + semantics

Values are **Pascal-case API method names** (e.g. `generateMessage`, `generateContent`).
[https://ai.google.dev/api/models] Enumerated from the `v1beta.models` method list
[https://ai.google.dev/api/all-methods] plus legacy/caching/live methods:

| Value | Meaning |
|-------|---------|
| `generateContent` | **Text/multimodal generation** (chat, vision, structured output). The gate our chat modules care about. |
| `streamGenerateContent` | Streaming variant of generateContent. **Usually NOT listed** per-model — treat as implied by `generateContent`. |
| `countTokens` | Runs the tokenizer on input content. |
| `embedContent` | Single embedding vector (embedding models only). |
| `batchEmbedContents` | Synchronous batch of embeddings. |
| `asyncBatchEmbedContent` | Async batch embeddings (LRO). |
| `createCachedContent` | Explicit context caching. |
| `batchGenerateContent` | Batch generation (LRO). |
| `predict` | Media prediction (Imagen-style) — image/video generation endpoints. |
| `predictLongRunning` | Same as predict, returns an LRO (Veo video). |
| `bidiGenerateContent` | **Live API** bidirectional WebSocket streaming (voice/audio). |
| `bidiGenerateMusic` | Live Music API (Lyria realtime). |
| `generateAnswer` | Legacy grounded-answers (AQA). |
| `generateMessage` / `countMessageTokens` | Legacy PaLM 2 chat (chat-bison). |
| `generateText` / `countTextTokens` / `createTunedTextModel` | Legacy PaLM 2 text + tuning. |
| `createTunedModel` | Legacy tuning. |

### Pagination

`pageToken` / `nextPageToken` as above. In practice the full catalog fits in **one page** (default 50, max
1000), so `pageSize` can be left default or set high; keep the paging loop for safety. `[engine-code]`
`ListModels()` uses `QueryBase: genai.Ptr(true)` (filters to base models) and iterates `page.Next(ctx)`.

---

## 4. Per-model parameter support

All generation knobs live inside **`generationConfig`** on the request
(`POST /v1beta/models/{model}:generateContent`). The doc is explicit: *"Not all parameters are configurable
for every model."* [https://ai.google.dev/api/generate-content]

### `GenerationConfig` fields (complete, current)

| Field | Type | Universal? | Notes |
|-------|------|-----------|-------|
| `temperature` | number | **Deprecated on 3.6+** | Range `[0.0, 2.0]`. **"No longer supported and silently ignored on Gemini 3.6 Flash and newer models"** (and Gemini 4). Will return **400 in a future release**. |
| `topP` | number | **Deprecated on 3.6+** | Same deprecation as temperature. |
| `topK` | integer | **Deprecated on 3.6+** | Same. Also: empty `topK` in model metadata ⇒ model doesn't use top-k and **disallows `topK` on requests**. |
| `maxOutputTokens` | integer | Universal (model-capped) | Default = model's `outputTokenLimit`. Gemini 4 sync cap = 65536; >65536 with `background=false` ⇒ 400. |
| `candidateCount` | integer | Universal-ish | Default 1; valid range **1–8**. Doesn't work on Gemini 1.0 family. |
| `stopSequences[]` | string[] | Universal | Up to **5** sequences; not included in the output. |
| `seed` | integer | Universal | If unset, a random seed is used. |
| `presencePenalty` | number | Model-gated | Binary on/off penalty for already-seen tokens. |
| `frequencyPenalty` | number | Model-gated | Scales with token reuse; negative values cause repetition. |
| `responseMimeType` | string | Universal | `text/plain` (default), `application/json`, `text/x.enum`. |
| `responseSchema` | Schema | **Deprecated** | OpenAPI-subset schema; requires compatible `responseMimeType`. Docs now say *use `responseFormat` instead*. |
| `_responseJsonSchema` / `responseJsonSchema` | Value (JSON Schema) | **Deprecated / internal** | JSON-Schema alternative; docs are mid-migration and mark these deprecated in favor of `responseFormat`. |
| `responseFormat` | ResponseFormatConfig | **New path** | Flat config for text/audio/image output format. |
| `responseModalities[]` | Modality[] | **Model-gated (required for image/audio out)** | Empty ⇒ text only. `TEXT` / `IMAGE` / `AUDIO`. If requested modalities don't match a supported combo ⇒ error. **This is how image generation is triggered** (our `GenerateImages`). |
| `speechConfig` | SpeechConfig | Model-gated (TTS models) | Speech-generation config. |
| `thinkingConfig` | ThinkingConfig | **Model-gated (reasoning models)** | **"An error will be returned if this field is set for models that don't support thinking."** |
| `imageConfig` | ImageConfig | Model-gated (image models) | `aspectRatio` + `imageSize`. Error if unsupported. |
| `mediaResolution` | MediaResolution | Model-gated | `LOW`(64 tok) / `MEDIUM`(256) / `HIGH`(zoomed reframing, 256). |
| `responseLogprobs` | boolean | Model-gated | Export logprobs. |
| `logprobs` | integer | Model-gated | Requires `responseLogprobs=true`; range `[0, 20]`. |
| `enableEnhancedCivicAnswers` | boolean | Model-gated | "may not be available for all models." |
| `enableAffectiveDialog` | boolean | Model-gated | Emotion-aware responses. |
| `translationConfig` | TranslationConfig | Model-gated (translate models) | |
| `audioTranscriptionConfig` | AudioTranscriptionConfig | Model-gated (transcribe models) | |

### Thinking config (the big model-gated axis)

`thinkingConfig` = `{ includeThoughts: bool, thinkingBudget: int, thinkingLevel: enum }`.
- `thinkingLevel` ∈ `MINIMAL | LOW | MEDIUM | HIGH` (**recommended for Gemini 3+**; "Use with earlier
  models results in an error").
- Gemini **2.5** models use integer **`thinkingBudget`**; Gemini **3.x** use **`thinkingLevel`** — sending
  both returns 400.
- **Gemini 3.x models have thinking ON by default** (dynamic). Per-model defaults + supported levels are
  tabulated in the thinking guide, e.g. `gemini-4-argon` On(medium) {low,medium,high};
  `gemini-3.8-flash` On(medium) {low,medium,high}; `gemini-3.6-flash` On(medium) {minimal,low,medium,high};
  `gemini-3.5-flash-lite` On(minimal); `gemini-3.1-pro-preview` On(high); `gemini-2.5-pro` On {low,medium,high};
  `gemini-2.5-flash-lite` Off. [https://ai.google.dev/gemini-api/docs/thinking]
- **`maxOutputTokens` covers thinking + output tokens**; a low cap can truncate (status `"incomplete"`)
  while still billing the thought tokens. For Gemini 4, input+thinking+output share one **1,048,576-token**
  window. [https://ai.google.dev/gemini-api/docs/thinking]

### Where documented

- Field reference: https://ai.google.dev/api/generate-content (`GenerationConfig`, `ThinkingConfig`,
  `ThinkingLevel`, `ImageConfig`, `ResponseFormatConfig`, `Modality`, `MediaResolution`).
- Per-model availability: the individual model pages under https://ai.google.dev/gemini-api/docs/models
  (and the thinking table above for `thinkingLevel`). There is **no single machine-readable
  "params supported by model X" endpoint** — this is exactly the gap the capability catalog fills (§7/§8).

### Parameter ranges (troubleshooting table)

Candidate count **1–8**; Temperature **0.0–1.0** (troubleshooting) vs **0.0–2.0** (`GenerationConfig`) —
**note the discrepancy**; TopP **0.0–1.0**; max output tokens = per-model.
[https://ai.google.dev/gemini-api/docs/troubleshooting]

---

## 5. Param name mapping (wire names)

### Wire names are camelCase, nested under `generationConfig`

```
POST /v1beta/models/gemini-3.8-flash:generateContent
{
  "systemInstruction": { "parts": [{ "text": "…" }] },     // top-level, NOT in generationConfig
  "contents": [ { "role": "user", "parts": [ { "text": "…" } ] } ],
  "generationConfig": {
    "temperature": 0.7, "topP": 0.95, "topK": 40, "maxOutputTokens": 800,
    "stopSequences": ["x"], "seed": 1, "candidateCount": 1,
    "responseMimeType": "application/json",
    "responseModalities": ["TEXT"], "thinkingConfig": { "thinkingLevel": "LOW" },
    "imageConfig": { "aspectRatio": "16:9", "imageSize": "2K" }
  }
}
```

### Mapping vs OpenAI / our engine

| Capability | Gemini wire name | OpenAI analogue | Notes |
|-----------|------------------|-----------------|-------|
| System prompt | **`systemInstruction`** (top-level `Content`) | `messages[role=system]` | Separate field, **not** a message. Text-only currently. |
| Max output | `maxOutputTokens` | `max_tokens` / `max_completion_tokens` | Single field here. |
| Sampling | `temperature`, `topP`, **`topK`** | `temperature`, `top_p` (**no topK**) | **`topK` exists in Gemini but not OpenAI** — our schema already exposes `top_k` for google. |
| Stop | `stopSequences` (array) | `stop` | |
| Determinism | `seed` | `seed` | |
| Structured output | `responseMimeType` + `responseSchema` / **`responseFormat`** | `response_format` | Gemini splits MIME + schema. |
| Output modality | `responseModalities` (`TEXT`/`IMAGE`/`AUDIO`) | n/a (model-specific) | Drives image generation. |
| Reasoning | `thinkingConfig.thinkingLevel` / `thinkingBudget` | `reasoning_effort` | Gemini uses an enum + optional token budget. |
| Penalties | `presencePenalty`, `frequencyPenalty` | `presence_penalty`, `frequency_penalty` | |
| Roles | `"user"` / `"model"` | `"user"` / `"assistant"` | **`model`, not `assistant`.** |

### Our current engine mapping `[engine-code]`

`google.go` → `buildGenConfig()` maps only these into `*genai.GenerateContentConfig`:
`SystemInstruction`, `ResponseModalities`, `Temperature`, `TopP`, `TopK`, `MaxOutputTokens`, `Seed`,
`StopSequences`, `ResponseMIMEType`. **Not mapped (gaps):** `thinkingConfig`, `responseSchema`/
`responseFormat`, `candidateCount`, `imageConfig`, `mediaResolution`, `safetySettings`, `presencePenalty`,
`frequencyPenalty`, `logprobs`. There is an unused `extraParams map[string]any` passthrough.

Config → wire chain `[engine-code]`:
- `config.GoogleProviderConfig` (types.go:487) fields: `apikey, model, maxoutputtokens, temperature, topp,
  topk, stoptokens, seed, responsemimetype, samplingpresetname, extraparams, numberofimages, aspectratio`.
- DB columns `models.GoogleProviderConfig` (provider_google.go): `api_key, model, max_output_tokens,
  temperature, top_p, top_k, stop_tokens, seed, response_mime_type, sampling_preset_name, extra_params,
  number_of_images, aspect_ratio`.
- App schema `providerFieldSchemas.ts` `google:` (line 183): `model, sampling_preset_name,
  max_output_tokens, temperature, top_p, top_k, stop_tokens, response_mime_type, number_of_images,
  aspect_ratio`, `hasModelFetch: false`.
- Note: presets use snake_case keys (`temperature`, `top_p`, `top_k`, `max_output_tokens`, `seed`,
  `stop_sequences`) that the engine translates to the camelCase wire names above.

---

## 6. Quirks

1. **Error taxonomy differs by API surface.** The legacy **GenerateContent** API uses the gRPC shape
   (`code:int`, `status:SCREAMING_CASE`, `details[].reason`, e.g. `API_KEY_INVALID`, `RESOURCE_EXHAUSTED`).
   The **new Interactions** API uses `snake_case` codes (`invalid_request`, `authentication`,
   `rate_limit_exceeded`, `quota_exceeded`, `permission_denied`, …) with **different HTTP mappings**
   (e.g. `authentication`→401, `out_of_range`→416). Since our engine uses `generateContent`, parse the
   **legacy** shape. [https://ai.google.dev/gemini-api/docs/generate-content/api-errors vs https://ai.google.dev/gemini-api/docs/api-errors]
2. **A new `interactions` endpoint exists** (`POST /v1beta/interactions`) as the successor surface to
   `generateContent`. `generateContent` is still fully supported (docs keep a dedicated "Generate Content
   API (Legacy)" tree). **Do not migrate now**; note it as a future watch item.
   [https://ai.google.dev/gemini-api/docs/api-versions]
3. **`-latest` aliases are moving targets.** `gemini-flash-latest`, `gemini-pro-latest`,
   `gemini-flash-lite-latest` are hot-swapped on each release of that variant; breaking changes get a
   **2-week email notice**. Prefer pinned stable ids (`gemini-3.8-flash`) for production; flag `-latest`
   in the picker. Model string patterns: **stable** / **preview** (`…-preview-09-2025`) / **latest** /
   **experimental**. [https://ai.google.dev/gemini-api/docs/models]
4. **temperature / top_p / top_k deprecation is real and imminent.** Gemini 4 and Gemini 3.6+ **ignore**
   them today (deprecation warning headers) and **will 400** in a future release. Our engine sends them
   unconditionally ⇒ harmless now on new models, but the catalog/UI should **hide or warn** them for
   3.6+/4 and the engine should stop sending them for those models.
   [https://ai.google.dev/gemini-api/docs/troubleshooting]
5. **`responseSchema` is deprecated** in favor of `responseFormat`; the docs currently show both plus a
   `_responseJsonSchema` "internal" field — a mid-migration state. Our engine only sets `responseMimeType`.
   [https://ai.google.dev/api/generate-content]
6. **Safety settings** are per-request (`safetySettings[]`, categories: HATE_SPEECH, SEXUALLY_EXPLICIT,
   DANGEROUS_CONTENT, HARASSMENT, CIVIC_INTEGRITY, JAILBREAK). Blocked generations surface as
   `finishReason` / `BlockedReason` or `safety`-class codes, **not** HTTP errors.
   [https://ai.google.dev/api/generate-content ; https://ai.google.dev/gemini-api/docs/api-errors]
7. **Regional restrictions.** The **free tier is not available in all countries** — requests there return
   **400 `FAILED_PRECONDITION`** ("free tier is not available in your country… enable billing").
   [https://ai.google.dev/gemini-api/docs/generate-content/api-errors]
8. **Free-tier vs billing keys.** Limits are per **project**; Free tier exists but spend-based limits and
   higher tiers require a linked billing account (Tier 1–3). Tier 1–3 spend caps per rolling 10-min window:
   $10 / $50 / $200. Hitting spend limits ⇒ `429 RESOURCE_EXHAUSTED`.
   [https://ai.google.dev/gemini-api/docs/rate-limits]
9. **Leaked/dormant keys are auto-blocked** — distinct message ("Your API key was reported as leaked…");
   unrestricted standard keys blocked from 2026-05-07, unrestricted keys rejected from 2026-06-19.
   [https://ai.google.dev/gemini-api/docs/troubleshooting ; https://ai.google.dev/gemini-api/docs/api-key]
10. **Vision is not a model property you can query directly.** There is no "supports image input" flag in
    the Model resource. Our engine works around this with a hardcoded name heuristic `[engine-code]`
    (`isVisionModel()` string-matches `gemini-2.0-flash`, `gemini-2.5`, `gemini-1.5-pro`, …) — brittle and
    already stale (misses all 3.x/4 models). The catalog must carry vision/multimodal-input capability.

---

## 7. Catalog seed table

Current lineup as of **2026-10-18** (source: https://ai.google.dev/gemini-api/docs/models, updated
2026-10-13). `sgm` = `supportedGenerationMethods` (authoritative values come from **live** `models.list`
per account, so treat the column below as expected/typical). Token limits are **not** enumerated on the
landing page — read `inputTokenLimit`/`outputTokenLimit` from live `models.list` (Gemini 4 Argon is
documented as a shared **1,048,576-token** window). "Live" = Live API (WebSocket, `bidiGenerateContent`),
not `generateContent`.

| Model id | Display | Tags | sgm (expected) | Notable params | Notes |
|----------|---------|------|----------------|----------------|-------|
| `gemini-4-argon` | Gemini 4 Argon | chat, vision, thinking | `generateContent`, `countTokens`, `createCachedContent`, `batchGenerateContent` | `thinkingConfig.thinkingLevel` {low,medium,high}; **no temp/topP/topK**; `maxOutputTokens`≤65536 sync, >65536 needs `background=true` | Flagship reasoning; unified 1M context + long decode to 1M. |
| `gemini-3.8-flash` | Gemini 3.8 Flash | chat, vision, thinking | `generateContent`, `countTokens`, `createCachedContent`, `batchGenerateContent` | thinking On(medium) {low,medium,high}; **no temp/topP/topK** | Current default Flash; best for our backend/cognition/vision defaults. |
| `gemini-3.8-live` | Gemini 3.8 Live | live, audio, chat | `bidiGenerateContent` | Live-only (audio config) | Live API default. **Not usable via generateContent.** |
| `gemini-3.8-live-extended-thinking` | Gemini 3.8 Live Ext. Thinking | live, audio, thinking | `bidiGenerateContent` | Live + thinking | |
| `gemini-3.8-flash-tts` | Gemini 3.8 Flash TTS | tts, audio | `generateContent` (+ `speechConfig`) | `speechConfig` | Studio-grade TTS; candidate for our `tts` module. |
| `gemini-3.8-flash-lite-tts` | Gemini 3.8 Flash-Lite TTS | tts, audio | `generateContent` (+ `speechConfig`) | `speechConfig` | Cheaper TTS. |
| `gemini-3.6-flash` | Gemini 3.6 Flash | chat, vision, thinking | `generateContent`, `countTokens`, `createCachedContent`, `batchGenerateContent` | thinking {minimal,low,medium,high}; **no temp/topP/topK** | |
| `gemini-3.5-flash-lite` | Gemini 3.5 Flash-Lite | chat, vision, thinking | `generateContent`, `countTokens`, `createCachedContent`, `batchGenerateContent` | thinking On(minimal) {minimal..high} | |
| `gemini-3.1-flash-lite` | Gemini 3.1 Flash-Lite | chat, vision, thinking | `generateContent`, … | | |
| `gemini-nano-banana-2.1` | Nano Banana 2.1 | image | `generateContent` (+ `responseModalities:[IMAGE]`, `imageConfig`) | `imageConfig.aspectRatio`, `imageSize` {512,1K,2K,4K} | Image gen/edit. |
| `gemini-3.1-flash-image` | Nano Banana 2 | image | `generateContent`, `batchGenerateContent` | `imageConfig` | |
| `gemini-3.1-flash-lite-image` | Nano Banana 2 Lite | image | `generateContent` | `imageConfig` | |
| `gemini-3-pro-image` | Nano Banana Pro | image, thinking | `generateContent`, `batchGenerateContent` | `imageConfig` | |
| `gemini-3.1-pro-preview` | Gemini 3.1 Pro | chat, vision, thinking | `generateContent`, `countTokens`, `createCachedContent`, `batchGenerateContent` | thinking On(high) {low,medium,high} | Preview. |
| `gemini-3-flash-preview` | Gemini 3 Flash | chat, vision, thinking | `generateContent`, … | thinking On(high) {minimal..high} | Preview. |
| `gemini-3.5-transcribe` / `-live` | Gemini 3.5 Transcribe | stt, audio | `generateContent` / `bidiGenerateContent` | `audioTranscriptionConfig` | Candidate for our `stt` module. |
| `gemini-3.5-live-translate-preview` | Gemini 3.5 Live Translate | live, translate, audio | `bidiGenerateContent` | `translationConfig` | Preview. |
| `gemini-3.1-flash-live-preview` | Gemini 3.1 Flash Live | live, audio | `bidiGenerateContent` | | Legacy Live preview. |
| `gemini-3.1-flash-tts-preview` | Gemini 3.1 Flash TTS | tts, audio | `generateContent` (+ `speechConfig`) | | Legacy TTS preview. |
| `gemini-omni-1.1-flash` | Gemini Omni Flash | video, audio | `generateContent` | | Video gen/edit + native audio. |
| `gemini-embedding-2` / `-preview` | Gemini Embedding 2 | embedding, multimodal | `embedContent`, `batchEmbedContents`, `asyncBatchEmbedContent`, `countTokens` | | Candidate for our `rag` module (text+image+video+audio+PDF). |
| `gemini-embedding-001` | Gemini Embedding | embedding | `embedContent`, `batchEmbedContents`, `asyncBatchEmbedContent`, `countTokens` | | Text embeddings. |
| `veo-3.1-generate-preview` / `-fast-` / `-lite-` | Veo 3.1 | video | `predictLongRunning` | | Video; LRO only. |
| `lyria-3.5`, `lyria-3-clip-preview`, `lyria-3-pro-preview` | Lyria | music | `generateContent` | | Music generation. |
| `lyria-realtime-exp` | Lyria RealTime | music, live | `bidiGenerateMusic` | | |
| `gemini-robotics-er-2-preview` | Gemini Robotics ER 2 | vision, thinking, robotics | `generateContent`, `countTokens`, `createCachedContent`, `batchGenerateContent` | thinking On(high) | |
| `deep-research-preview-04-2026` / `-max-` | Gemini Deep Research | agent | `generateContent` | | |
| `antigravity-preview-09-2026` | Antigravity Agent | agent | `generateContent` | | Managed agent. |

**Deprecated / shut down (do not seed):** `gemini-2.0-flash`, `gemini-2.0-flash-lite`,
`gemini-3.1-flash-lite-preview`, `gemini-3-pro-preview`, `gemini-2.5-computer-use-preview-10-2025`,
`imagen-4.0-generate`. **Legacy 2.5 models** (`gemini-2.5-pro/flash/flash-lite`, TTS/Image variants) are
restricted to existing users ("not automatically granted to new projects") — keep out of default seeds.
[https://ai.google.dev/gemini-api/docs/models ; forum: discuss.ai.google.dev/t/.../187266]

---

## 8. Recommendations

### Exact verify call

```
GET https://generativelanguage.googleapis.com/v1beta/models?pageSize=1
x-goog-api-key: <KEY>
```
- Keep the engine's existing `ValidateConfig()` implementation `[engine-code]` (it already does this).
- **Result mapping** (surface as `{valid, detail}`):
  - `200` + non-empty `models` (or non-empty `nextPageToken`) → `valid: true`.
  - `400` + `details[].reason == "API_KEY_INVALID"` → `valid: false`, detail "API key not valid".
  - `403 PERMISSION_DENIED` / `reason == "API_KEY_SERVICE_BLOCKED"` → `valid: false`? No — **`valid: true`
    with a targeted hint** ("key rejected here — is this a Vertex AI key or over-restricted?").
  - `401 UNAUTHENTICATED` → hint about `x-goog-api-key` (never use `Authorization: Bearer`).
  - `429` → `valid: true`, detail "key works but rate/quota limited".
  - `402` → `valid: true`, detail "billing credits depleted".
  - `400 FAILED_PRECONDITION` → `valid: true`, detail "free tier unavailable in this region / billing required".
  - `5xx` → `valid: unknown`, retryable.
- Never branch on key prefix (`AIzaSy`/`AQ.`) — validate by call only.

### Exact models call

```
GET https://generativelanguage.googleapis.com/v1beta/models   (optionally ?pageSize=1000)
x-goog-api-key: <KEY>
```
- Page through `nextPageToken`. Use `name` as the id (strip `models/` for display), `displayName` as the
  label, `inputTokenLimit`/`outputTokenLimit` as the context window, `supportedGenerationMethods` +
  `thinking` as capability hints.
- **Filter rule for chat modules:** keep models whose `supportedGenerationMethods` contains
  `generateContent`. Do **not** use the current `isVisionModel()` string heuristic `[engine-code]` — it is
  stale; gate vision on the catalog (Tier 2) instead.
- For our `tts`/`stt`/`rag` modules, filter on `speechConfig`/`audioTranscriptionConfig`/`embedContent`
  respectively (from the catalog), since the list endpoint does not expose those.

### Capability-source verdict

**`supportedGenerationMethods` is live and useful, but shallow.** It answers *"which verb does this model
serve?"* — chat vs embedding vs predict vs Live — which is enough to route modules and to filter the model
picker. Combined with the new **`thinking` boolean**, **`inputTokenLimit`/`outputTokenLimit`**, and the
defaults (`temperature`/`topP`/`topK`/`maxTemperature`), live `models.list` gives us: verb, reasoning
support, context window, and default sampling.

**What `supportedGenerationMethods` does NOT tell us** (and therefore must come from the static catalog,
Tier 2):
- **Modality in/out** — no "accepts image/audio/video input" or "can emit IMAGE/AUDIO" flag. Vision and
  image-generation capability are invisible to the list API.
- **Structured-output support** — no `responseSchema`/`responseFormat` flag.
- **Function calling / tools, code execution, grounding (Search/Maps), URL context, caching** — not
  surfaced (caching only indirectly via `createCachedContent`).
- **Per-parameter support** — e.g. that `temperature`/`topP`/`topK` are **ignored on 3.6+/4**; that
  `thinkingLevel` vs `thinkingBudget` is version-dependent; that `candidateCount` is invalid on 1.0.
- **Safety-config behavior** and content-policy differences.
- **Which thinking levels** a model accepts (only the `thinking` boolean is exposed).

⇒ **Verdict: Tier 1 (live) provides verb + thinking + context; Tier 2 (catalog) must supply modality,
tools, structured-output, and parameter-level support.** Merge order stays live > catalog > user (plan §6.3).

### Engine client notes

1. **`ValidateConfig`** `[engine-code]`: correct as-is (models.list, pageSize 1). Just enrich the
   error classification per §8 to distinguish invalid vs blocked vs throttled.
2. **`ListModels`** `[engine-code]`: correct paging; **replace the `isVisionModel()` heuristic** with
   catalog-driven capability filtering. Also capture `inputTokenLimit`/`outputTokenLimit`/`thinking` into
   `common.ModelInfo` (currently only `ID`/`Name` are populated) so the picker can show context + badges.
3. **`buildGenConfig`** `[engine-code]`: add `ThinkingConfig` (map our reasoning control → `thinkingLevel`
   for 3.x, `thinkingBudget` for 2.5) and `responseFormat`/`responseSchema`; **suppress
   `Temperature`/`TopP`/`TopK` for Gemini 3.6+/4** (ignored now, 400 later). `extraParams` passthrough is
   currently unused — wire it or drop it.
4. **Image generation** `[engine-code]`: `GenerateImages` sets `ResponseModalities:[IMAGE]` but never sets
   `imageConfig`, so the config `aspect_ratio` field is **not actually applied**. Map it to
   `imageConfig.aspectRatio` (and consider `imageSize`) when the model supports image output; widen the app
   `aspect_ratio` options to the documented set (`1:1,1:4,4:1,1:8,8:1,2:3,3:2,3:4,4:3,4:5,5:4,9:16,16:9,21:9`).
5. **SDK**: `google.golang.org/genai v1.59.0` `[engine-code]`. `SupportedActions` is the Go field name for
   `supportedGenerationMethods`; `client.Models.List`/`GenerateContent` are the surfaces we use. The SDK
   defaults to `v1beta` — keep that.
6. **Auth**: never hand-build `?key=` URLs; the SDK sets `x-goog-api-key`. If a future manual verify path is
   added, use the header, not the query param.
7. **Key type in UX**: label the account with a neutral "AI Studio API key" and rely on the verify call to
   catch Vertex keys — do not infer from prefix.

### Open items / watch

- The **Interactions API** (`/v1beta/interactions`) is the designated successor to `generateContent`; plan a
  future migration review, but not now (generateContent remains fully supported).
- `-latest` alias hot-swapping: default seeds should use **pinned stable** ids (e.g. `gemini-3.8-flash`),
  not `gemini-flash-latest`.
- Exact per-model token limits must be pulled from live `models.list` (the landing page does not tabulate
  them); seed the catalog with capability tags + `sgm` and hydrate context windows at runtime.
