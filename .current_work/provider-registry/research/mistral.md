# Provider Research — Mistral AI (api.mistral.ai / La Plateforme / Studio)

Workstream: Soulbits provider registry (R11 research preface)
Scope: key validation, live model listing, model capability catalog, parameter-name mapping
Research date: **2026-10-18**
Author: research subagent (read-only; no code changed)

Primary doc host is **`docs.mistral.ai`**. In Oct 2026 the site is split into
`/inference/…` (models, lifecycle, regional, sampling, prompting), `/studio/…`
(chat completions, reasoning, structured outputs, function calling, audio,
embeddings), `/api/…` (OpenAPI reference, mirror of the machine-readable spec),
`/admin/…` (org / workspace / API-key management) and `/resources/…` (error
glossary, known limitations). The **machine-readable OpenAPI spec lives at
`https://docs.mistral.ai/openapi.yaml`** and is the authoritative source for
schemas (the HTML reference is a rendering of it).

Facts taken from our own engine are tagged **[engine-code]**
(`harmony-link-private`). Sources are cited inline and listed in §9.

> **Headline for our workstream:** Mistral's `GET /v1/models` returns a rich
> per-model `capabilities` dict (14 booleans) **plus** `max_context_length`,
> `aliases`, `deprecation`, `deprecation_replacement_model` and
> `default_model_temperature`. This is one of the strongest live-discovery
> surfaces of any provider we have — the live tier can carry most of the catalog
> for Mistral. The static catalog is only needed for **parameter-level gating**
> and **wire-name mapping** (see §4/§5/§8).

---

## 1. API basics

| Item | Value | Source |
|---|---|---|
| Base URL (global) | `https://api.mistral.ai/v1` — all public endpoints live under `/v1` | [Models endpoint](https://docs.mistral.ai/api/endpoint/models), [Chat endpoint](https://docs.mistral.ai/api/endpoint/chat) |
| Regional base URLs | `https://api.eu.mistral.ai/v1`, `https://api.us.mistral.ai/v1` (opt-in, **1.1× list price**) | [Regional inference](https://docs.mistral.ai/inference/regional-inference) |
| Auth header | `Authorization: Bearer <API_KEY>` (HTTP Bearer) | [Models endpoint](https://docs.mistral.ai/api/endpoint/models) |
| Org/workspace scoping header | **None documented.** The key is bound to a Workspace at creation time; there is no `OpenAI-Organization`-style selector header on the public API. | [Admin — API keys](https://docs.mistral.ai/admin/identity-access/api-keys) |
| API versioning | URL path `/v1` only. **No client-supplied version header** (unlike Anthropic). Model *versions* are encoded in model IDs (`major-minor`) and aliases. | [Model lifecycle](https://docs.mistral.ai/inference/model-lifecycle) |
| Content type | `application/json` (request + response) | [Chat endpoint](https://docs.mistral.ai/api/endpoint/chat) |
| Default processing location | Served from **EU data centers by default** on the global endpoint | [Known limitations](https://docs.mistral.ai/resources/known-limitations) |

### Key creation

- **Studio console** (the developer console + API): `https://console.mistral.ai`
  → **API Keys** → **Create new key**. Optional `Name`, optional `Expiration`,
  and a **Connector access scope** (`Shared connectors only` vs
  `Private and shared connectors`). The full key is shown **once**.
  [Activate Studio & generate a key](https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key)
- **Free mode**: API access is enabled by default **with no credit card
  required**; usage and rate limits apply. (The same page shows the curl
  verification call.)
  [Activate Studio & generate a key](https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key)
- **Admin panel** (org control plane, `https://admin.mistral.ai`):
  **API → API Keys** lists active/expired keys with key type, Workspace,
  last-used and expiration; admins can rotate/delete and set an org-level
  **API key expiration policy**.
  [Admin — API keys](https://docs.mistral.ai/admin/identity-access/api-keys)
- **Programmatic key management** exists via the Beta Admin API
  (`POST /v1/admin/api-keys`, plus list/delete), returning `key_id`,
  `hidden_key` (e.g. `"HQSx...Ug6Y"`), `expiration_date`, `actions`.
  [Beta Admin Api Keys](https://docs.mistral.ai/api/endpoint/beta/admin/api-keys)

### Key format (prefixes)

- Mistral's docs do **not** publish a key grammar. Unlike OpenAI's `sk-…`
  prefixes, Mistral keys are **opaque random alphanumeric strings with no
  documented prefix**; the admin API masks them as e.g. `HQSx...Ug6Y`
  ([Beta Admin Api Keys](https://docs.mistral.ai/api/endpoint/beta/admin/api-keys)).
- There is **no checksum**, so a format/regex pre-check can only reject clearly
  malformed input — real validity requires an API call (§2).

### Console vs platform keys — what the terms mean now

- **"La Plateforme"** is the legacy brand for the Mistral inference platform
  (still referenced by third-party integrations, e.g.
  [api-evangelist/mistral](https://github.com/api-evangelist/mistral)). The
  product-facing name in Oct 2026 is **Studio** (`console.mistral.ai`) for
  developer keys, with **Admin** (`admin.mistral.ai`) as the org control plane.
- The OpenAPI spec also defines an internal **dashboard gateway** auth scheme
  `DashboardUserContextAuth` using an `x-api-key` header
  (`securitySchemes` in [openapi.yaml](https://docs.mistral.ai/openapi.yaml)).
  **This is not the public API** — public calls use `Authorization: Bearer`.
  Our client must use Bearer.
- **Regional inference** is a separate control from **zero data retention**;
  neither is an auth mode.

---

## 2. Key validation

### Recommended verify call

```
GET https://api.mistral.ai/v1/models
Authorization: Bearer <API_KEY>
```

- `GET /v1/models` is documented as "List all models available to the user" and
  is the cheapest account-scoped, **side-effect-free** request.
  [Models endpoint](https://docs.mistral.ai/api/endpoint/models).
- Optional query params `provider` (string|null) and `model` (string|null) exist
  — see §3. There is **no page-size / limit / cursor parameter** (Mistral does
  not paginate the model list).
- **Quota cost:** metadata-only. No tokens are billed; it is subject only to
  request-rate limits. It is the standard "cheapest endpoint" for a BYOK check.

### Expected 2xx shape (200)

Authoritative schema (`ModelList` in
[openapi.yaml](https://docs.mistral.ai/openapi.yaml)):

```json
{
  "object": "list",
  "data": [
    {
      "id": "mistral-large-4",
      "object": "model",
      "created": 1756746619,
      "owned_by": "mistralai",
      "capabilities": {
        "completion_chat": true, "completion_fim": false, "function_calling": true,
        "fine_tuning": false, "vision": true, "ocr": false, "classification": false,
        "moderation": false, "audio": false, "audio_transcription": false,
        "audio_transcription_realtime": false, "audio_speech": false,
        "reasoning": true, "unified_resources": false
      },
      "name": "Mistral Large 4",
      "description": "…",
      "max_context_length": 1000000,
      "aliases": ["mistral-large-latest"],
      "deprecation": null,
      "deprecation_replacement_model": null,
      "default_model_temperature": 0.7,
      "internal": false,
      "billing_model_name": null,
      "type": "base"
    }
  ]
}
```

> ⚠️ **Rendering caveat:** the HTML API-reference "200" example renders the list
> body as a **bare array** `[ {…} ]`, and shows the discriminator as uppercase
> `"TYPE": "fine-tuned"`. The **OpenAPI schema is authoritative**: the body is
> an **object** `{ "object": "list", "data": [...] }` and the discriminator
> property is lowercase **`type`** (values `base` / `fine-tuned`). Parse
> defensively: accept both `{data:[…]}` and a top-level array.

### Failure signals (401 vs 402 vs 403 vs 429)

Mistral's error body is uniform across statuses
([Error glossary](https://docs.mistral.ai/resources/error-glossary)):

```json
{
  "object": "error",
  "message": "A human-readable description of the error.",
  "type": "invalid_request_error",
  "param": "model",
  "code": "unknown_model"
}
```

| Status | Meaning | Verdict for "is this key valid?" |
|---|---|---|
| **401 Unauthorized** | Missing / incorrect / expired key; credentials not accepted. (The quickstart maps 401 → "API key is incorrect or not set".) | **Invalid** |
| **402 Payment required** | Key is valid but the account has **no payment method / billing not set up**. | **Valid key, unusable account** — surface distinctly ("key OK, billing required") |
| **403 Forbidden** | Authenticated but not permitted for the resource (e.g. workspace/region/scope restrictions). | **Key is real but not usable here** |
| **404 Not found** | Resource/model ID not found (also the failure mode for **retired model IDs**). | Key fine; bad target |
| **422 Validation error** | Request failed schema validation (see the `additionalProperties:false` quirk in §6). | Key fine; request malformed |
| **429 Too many requests** | Rate limit (RPS or TPM) exceeded. | **Valid key** — currently throttled |
| **5xx** | Server-side (500/502/503/504). | Transient — key fine |

Sources: [Error glossary](https://docs.mistral.ai/resources/error-glossary),
[First API request](https://docs.mistral.ai/getting-started/quickstarts/developer/first-api-request),
[Model lifecycle](https://docs.mistral.ai/inference/model-lifecycle) (404 on retired IDs).

- `error.type` is one of `invalid_request_error`, `authentication_error`,
  `rate_limit_error`, `server_error`.
  [Error glossary](https://docs.mistral.ai/resources/error-glossary)
- **Retry strategy:** exponential backoff for 429/500/502/503/504 (official SDKs
  do this automatically).
  [Error glossary](https://docs.mistral.ai/resources/error-glossary)
- **Rate-limit header:** `X-RateLimit-Remaining` is the one header Mistral
  documents (to monitor remaining quota before hitting the limit).
  [Known limitations](https://docs.mistral.ai/resources/known-limitations)
- **Caveat:** `/v1/models` validates **authentication**, not **entitlement to a
  specific model or region**. Regional endpoints serve only region-hosted
  models, so a key can list global models yet be denied on a regional call
  ([Regional inference](https://docs.mistral.ai/inference/regional-inference)).

> Note: the Error-glossary page renders the per-status explanatory prose in
> client-side accordions that are not present in the server HTML/`.md`; the
> status list and the error body schema above are extractable, the prose is not.
> The 401/403/402 semantics above are consistent with the official
> quickstart's error table and the glossary's status list.

---

## 3. Model listing

```
GET https://api.mistral.ai/v1/models            # list
GET https://api.mistral.ai/v1/models/{model_id} # retrieve one
```

Query params (both optional, `string|null`): `provider`, `model`.
[Models endpoint](https://docs.mistral.ai/api/endpoint/models)

### Response shape

`ModelList` = `{ "object": "list", "data": [BaseModelCard | FTModelCard] }`,
discriminated by `type`.

**BaseModelCard** (schema: `BaseModelCard` in
[openapi.yaml](https://docs.mistral.ai/openapi.yaml)):

| Field | Type | Notes |
|---|---|---|
| `id` | string | **required**; the identifier used in requests |
| `object` | string | default `"model"` |
| `created` | integer | Unix **seconds** (not `created_at`) |
| `owned_by` | string | default `"mistralai"` |
| `capabilities` | object | **required**; see the dict below |
| `name` | string\|null | human label |
| `description` | string\|null | human description |
| `max_context_length` | integer | default `32768` |
| `aliases` | string[] | default `[]`; e.g. `mistral-large-latest` |
| `deprecation` | date-time\|null | ISO-8601 deprecation timestamp |
| `deprecation_replacement_model` | string\|null | recommended successor |
| `default_model_temperature` | number\|null | per-model default temperature |
| `internal` | boolean | default `false` |
| `billing_model_name` | string\|null | billing identifier |
| `type` | string | const `"base"` |

**FTModelCard** adds (for fine-tuned models): `type` const `"fine-tuned"`,
`job` (required, job id), `root` (required, base model id), `archived`
(boolean, default `false`). The fine-tune *update* response example also shows
`root_version` and `workspace_id`.
[Models endpoint](https://docs.mistral.ai/api/endpoint/models),
[openapi.yaml](https://docs.mistral.ai/openapi.yaml)

> There is **no `archived` field on base models** — base models are retired
> outright (retired IDs return **404**). `archived` is a fine-tuned-model
> concept only.

### The `capabilities` object — exhaustive schema

From the `ModelCapabilities` schema in
[openapi.yaml](https://docs.mistral.ai/openapi.yaml) (the schema's own
description: *"This is populated by Harmattan, but some fields have a name that
we don't want to expose in the API."*). **All 14 fields are booleans, default
`false`:**

| Field | Meaning |
|---|---|
| `completion_chat` | Chat-completions capable (`/v1/chat/completions`) |
| `completion_fim` | Fill-in-the-middle capable (`/v1/fim/completions`, Codestral) |
| `function_calling` | Tool/function calling supported |
| `reasoning` | Reasoning model (`reasoning_effort` adjustable) |
| `fine_tuning` | Can be fine-tuned |
| `vision` | Image input supported |
| `ocr` | OCR service model (`/v1/ocr`) |
| `classification` | Classifier endpoint (`/v1/classifiers`) |
| `moderation` | Moderation model (`/v1/moderations`) |
| `audio` | Audio input capable (Voxtral) |
| `audio_transcription` | Speech-to-text (`/v1/audio/transcriptions`) |
| `audio_transcription_realtime` | Realtime streaming transcription |
| `audio_speech` | Text-to-speech (`/v1/audio/speech`) |
| `unified_resources` | Internal unified-resource flag |

> ⚠️ Our task brief mentioned a dict of `completion` / `chat` / `function_calling`
> / `fine_tuning`. The **current** field names are the 14 above — note
> `completion_chat` (not `chat` or `completion`) and `completion_fim`. The HTML
> API-reference example only shows a 6-field subset
> (`completion_chat`, `completion_fim`, `function_calling`, `fine_tuning`,
> `vision`, `classification`); the **full schema has 14**. Treat missing keys as
> `false` rather than absent.

### Pagination

**None.** `/v1/models` returns the entire list in one response; there is no
`limit`, `offset`, `cursor` or `page` parameter — only the `provider`/`model`
filters. (This differs from OpenAI, which also has no pagination, but confirms
we should not send a page-size param.)

---

## 4. Per-model parameter support

All parameters come from the `ChatCompletionRequest` schema
([openapi.yaml](https://docs.mistral.ai/openapi.yaml),
[Chat endpoint](https://docs.mistral.ai/api/endpoint/chat)).

### Universal (accepted on every chat model)

`model`*, `messages`* (`system|user|assistant|tool`), `temperature`
(`0 ≤ x ≤ 1.5`), `top_p` (`0 < x ≤ 1`), `max_tokens` (`≥ 0`), `stream`
(default `false`), `stop` (string or string[]), `n`, `random_seed` (`≥ 0`),
`metadata`, `frequency_penalty`, `presence_penalty`, `safe_prompt`
(default `false`), `response_format` (`text|json_object|json_schema`),
`tool_choice` (`auto|none|any|required` or a specific function), `tools`,
`parallel_tool_calls` (default `true`), `logprobs`, `top_logprobs`,
`prompt_logprobs`, `top_prompt_logprobs`, `min_tokens`, `prediction`,
`repetition_penalty`, `top_k`, `service_tier` (`auto|standard_only`),
`prompt_mode` (`"reasoning"`), `reasoning_effort`
(`none|minimal|low|medium|high|xhigh`), `guardrails`, `prompt_cache_key`.
(*=required)

### Model-gated

| Parameter / feature | Gate | Source |
|---|---|---|
| `reasoning_effort` | Only reasoning-capable models: `mistral-small-latest`, `mistral-medium-3-5`, `mistral-large-4-0`, `zai-glm-5-3`. **`zai-glm-5-3` supports only `low`/`high`/`max`** (no `none`), and always returns chunk-list content. | [Reasoning](https://docs.mistral.ai/studio/conversations/reasoning) |
| `n` (N completions) | **`mistral-large-2512` does not support N completions.** | [Sampling](https://docs.mistral.ai/inference/sampling) |
| `response_format: json_schema` | Models advertising structured outputs; JSON mode needs `"JSON"` in the prompt. | [Structured outputs](https://docs.mistral.ai/studio/conversations/structured-output), [Known limitations](https://docs.mistral.ai/resources/known-limitations) |
| `tools` / `tool_choice` | Models with `function_calling` (max **128 tools**/request; `tool_choice:"any"` forces a call but not which one). | [Function calling](https://docs.mistral.ai/studio/conversations/function-calling), [Known limitations](https://docs.mistral.ai/resources/known-limitations) |
| Vision (image content parts) | Vision models only (`image_url` accepts URL or base64; ≤ 20 MB/image; PNG/JPG/JPEG/GIF/WEBP). | [Vision](https://docs.mistral.ai/studio/conversations/vision), [Known limitations](https://docs.mistral.ai/resources/known-limitations) |
| FIM (`/v1/fim/completions`) | Codestral. | [Codestral card](https://docs.mistral.ai/models/codestral-25-08) |
| `prefix` (on an assistant message) | Chat models; prepends fixed text to the answer. | [Chat completions](https://docs.mistral.ai/studio/conversations/chat-completion) |

### Where documented / queryable?

- **Partially queryable:** the `capabilities` dict (§3) is per-model and
  queryable at runtime, but it is **coarse boolean feature flags** — it does not
  express parameter-level support (temperature range, `n` gating,
  `reasoning_effort` enum values, `prompt_mode`, `service_tier`).
- **Documented only:** the parameter-level rules live in the per-feature pages
  (reasoning, sampling, function calling, structured outputs) and in the OpenAPI
  schema constraints. There is **no per-model "supported parameters" endpoint**.
- **Our catalog must carry** the parameter-level gating and the
  `reasoning_effort` enum differences (esp. `zai-glm-5-3`).

---

## 5. Param name mapping

### OpenAI-compatible surface (same wire names)

`model`, `messages`, `temperature`, `top_p`, `max_tokens`, `stream`, `stop`,
`n`, `frequency_penalty`, `presence_penalty`, `response_format`, `tools`,
`tool_choice`, `parallel_tool_calls`, `logprobs`, `top_logprobs`, `metadata`.
[Chat endpoint](https://docs.mistral.ai/api/endpoint/chat)

### Mistral-specific fields

| Mistral wire name | Notes |
|---|---|
| `safe_prompt` | bool — injects a safety prompt before all conversations (Mistral-specific). |
| `random_seed` | **Mistral uses `random_seed`, NOT `seed`.** Deterministic sampling. |
| `top_k` | Nucleus/`top_k` sampling (Mistral-specific). |
| `repetition_penalty` | Mistral-specific (in addition to freq/presence penalties). |
| `min_tokens` | Minimum tokens to generate. |
| `prediction` | Predicted-outputs optimization. |
| `prompt_mode` | enum `"reasoning"` — high-level intent hint. |
| `reasoning_effort` | `none|minimal|low|medium|high|xhigh` (per-model subset). |
| `service_tier` | `auto|standard_only` (Priority Tier). |
| `prompt_cache_key` | Prompt-cache key (cached input billed at 10%). |
| `guardrails` | array of `GuardrailConfig`. |
| `prefix` | On an assistant message — prepend fixed content. |

### Wire-name quirks to watch

- **`random_seed` ≠ `seed`.** An OpenAI-shaped client that emits `seed` will
  either be rejected (422) or ignored.
- **`max_tokens` only** — Mistral has **no `max_completion_tokens`**.
- **`response_format`** shape: `{"type":"text"|"json_object"|"json_schema", "json_schema": {…}}`.
- **`tool_choice`**: `auto|none|any|required` (both `any` and `required` force).
- **Strict schema**: `ChatCompletionRequest` declares **`additionalProperties: false`**
  ([openapi.yaml](https://docs.mistral.ai/openapi.yaml)). Unknown keys →
  **422 `extra_forbidden`**. There is **no "extra params" passthrough** (this
  historically broke OpenAI-drop-in clients — see the public issue
  [mistralai/platform-docs-public#7](https://github.com/mistralai/platform-docs-public/issues/7)
  and the CrewAI report of `extra_forbidden` for `frequency_penalty`).

### Our engine client's mapping notes **[engine-code]**

- **There is no Mistral chat provider in the engine.** Mistral exists only as a
  **RAG embedding** provider:
  `database/repository/providers/mistral.go` (CRUD only, `provider_config_mistral`
  table), `config/types.go` `RAGMistralConfig{MistralApiKey}`, wired in
  `modules/rag/vector_store.go` and `modules/rag/validation.go` via
  `chromem.NewEmbeddingFuncMistral(apiKey)`. `providers/registry.go` has **no
  `mistral` entry**.
- The embedding call (from the pinned `chromem-go@v0.7.1` fork,
  `embed_compat.go` + `embed_openai.go`): `POST https://api.mistral.ai/v1/embeddings`,
  body `{"input": text, "model": "mistral-embed"}`, `Authorization: Bearer <key>`,
  **only `200` accepted**, **model and base URL hard-coded**, and the response is
  read from `data[0].embedding` (normalized=true). It does **not** send
  `output_dimension`/`output_dtype`.
- **`providers/openaicompatible.go` is unsafe for Mistral as-is.** It is
  OpenAI-shaped and will break on Mistral's strict schema:
  - sets `params.Seed` → serialized as `seed` (Mistral expects `random_seed`);
  - sets `params.MaxCompletionTokens` → `max_completion_tokens` (unsupported);
  - `SetExtraFields(...)` passes arbitrary keys (sampling-preset overflow,
    `response_format` raw JSON, user extras) → **422 `extra_forbidden`**;
  - always sends `n` when `p.n >= 0` (default `0`), i.e. `n: 0` on every call;
  - has **no `reasoning_effort`** wiring (only `openai.go` has it);
  - `ValidateConfig()` uses `Models.List()` — which **is** the correct Mistral
    verify call, so the validation path is fine.
- **Recommendation:** add a dedicated Mistral chat provider (or a "strict"
  mode on the compatible client) that emits `random_seed`, drops
  `max_completion_tokens`, validates extras against the OpenAPI allow-list, and
  gates `reasoning_effort`/`n`. Base URL for any Mistral client:
  `https://api.mistral.ai/v1`.

---

## 6. Quirks

### Error-code taxonomy
Uniform JSON body `{object,message,type,param,code}`; statuses 400, 401, 402,
403, 404, 422, 429, 500, 502, 503, 504.
[Error glossary](https://docs.mistral.ai/resources/error-glossary)
Notable: **`422` is common** because of strict schema validation; **`404`** for
retired model IDs; **`402`** specifically means "no payment method on account".
[Model lifecycle](https://docs.mistral.ai/inference/model-lifecycle),
[First API request](https://docs.mistral.ai/getting-started/quickstarts/developer/first-api-request)

### Strict request schema
`additionalProperties: false` on `ChatCompletionRequest` (and other requests) →
unknown params are rejected, not ignored. This is the single biggest behavioural
difference from OpenAI.
[openapi.yaml](https://docs.mistral.ai/openapi.yaml)

### Model aliasing & archived behavior
- Alias formats ([Model lifecycle](https://docs.mistral.ai/inference/model-lifecycle)):
  | Alias | Example | Points to |
  |---|---|---|
  | `model-name-latest` | `mistral-medium-latest` | latest version, across generations |
  | `model-name-major` | `mistral-medium-3` | latest minor of that major |
  | `model-name-major-minor` | `mistral-medium-3-5` | fixed major.minor |
- **Warning:** aliases may expose you to silent behaviour/pricing updates; pin
  to `major-minor` for stability. The `aliases` array in the model card lists
  the aliases pointing at a given model.
- **Labs** models use a `labs-` prefix and are free, silently updatable, and
  **not** production-recommended.
  [Labs](https://docs.mistral.ai/inference/labs)
- **Archived** is a fine-tuned-model flag (`FTModelCard.archived`) with
  archive/unarchive endpoints; base models are simply retired (404).
- **Deprecation notice periods**: Labs 1 month, Public Preview 1 month,
  General Availability **6 months**, third-party 1 month. Retired → 404.
  [Model lifecycle](https://docs.mistral.ai/inference/model-lifecycle)

### Free tier vs paid
- **Free mode** is on by default (no card), with usage/rate limits.
  [Activate Studio](https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key)
- **Labs models are free**; **Mistral Moderation 2 is Free** (input/output).
  [Labs](https://docs.mistral.ai/inference/labs),
  [Pricing](https://docs.mistral.ai/inference/pricing)
- Missing payment method → **402**.
  [First API request](https://docs.mistral.ai/getting-started/quickstarts/developer/first-api-request)
- Third-party (non-official) notes report a Free tier of ~1 RPS and paid ~10 RPS
  / 5M TPM, but the **official** docs only state limits vary by tier/model and
  point at `admin.mistral.ai/plateforme/limits` — treat RPS/TPM numbers as
  unverified.
  [api-evangelist/mistral](https://github.com/api-evangelist/mistral),
  [Known limitations](https://docs.mistral.ai/resources/known-limitations)

### Regional endpoints
- `api.eu.mistral.ai` (EU/EFTA DCs) and `api.us.mistral.ai` (US DCs);
  **1.1× list price** on input, output, cached reads and cache writes.
- **Feature limits:** only **function calling** among tools is regional;
  **Agents, Batch and the Files API are unavailable** regionally; **available
  models vary by region** — list models against the regional base URL.
- Regional inference controls *where* processing happens; it is separate from
  zero-data-retention.
  [Regional inference](https://docs.mistral.ai/inference/regional-inference)

### Rate-limit headers
- **`X-RateLimit-Remaining`** is the documented response header.
  [Known limitations](https://docs.mistral.ai/resources/known-limitations)
- RPS and TPM are enforced **independently**, **per organization**; Batch does
  not count against real-time limits; 429 on exceed.
  [Known limitations](https://docs.mistral.ai/resources/known-limitations)

### Service tiers
`service_tier: auto|standard_only`; response `usage.service_tier` is
`priority|standard`; Priority Tier is **1.75×** standard list pricing.
[Priority Tier](https://docs.mistral.ai/inference/priority-tier)

### Other operational quirks
- Streaming connections **time out after 10 minutes of inactivity**;
  `stream_options.include_usage` must be set to get usage in stream events.
- Context window overflow → **400**; input+output share the window.
- JSON mode requires the word "JSON" in the prompt or the model may emit
  infinite whitespace.
- Max 128 tools/request; vision ≤ 20 MB/image; audio ≤ 60 min / 500 MB; files
  ≤ 512 MB retained 30 days.
  [Known limitations](https://docs.mistral.ai/resources/known-limitations)
- Reasoning multi-turn: **replay the full assistant message including
  `ThinkChunk`** back into history (dropping it degrades quality).
  [Reasoning](https://docs.mistral.ai/studio/conversations/reasoning)

---

## 7. Catalog seed table (current lineup, 2026-10-18)

Active lineup from [Models overview](https://docs.mistral.ai/models) and each
model card; context windows from the model cards and
[Known limitations](https://docs.mistral.ai/resources/known-limitations).

> **`capabilities` column caveat:** the per-model `capabilities` dict is *not*
> published per model in the docs — it comes from the live `GET /v1/models`
> response. The values below are **inferred** from each model card's
> features/endpoints and the capability semantics (§3); **verify against live
> discovery** before seeding. `ctx` = `max_context_length`.

### Generalist / chat

| Model (card) | Primary API id | ctx | Tags | Inferred capabilities dict (true flags) | Notable params | Notes |
|---|---|---|---|---|---|---|
| Mistral Large 4 | `mistral-large-4` (+1 alias) | **1M** | chat, vision, reasoning, tools | `completion_chat, function_calling, vision, reasoning` | `reasoning_effort`; structured outputs; prefix; batching | **Public Preview**, v26.10, open-weight MoE (52B active / 1.05T total) |
| Mistral Medium 3.5 | `mistral-medium-3-5` (+2) | 256k | chat, vision, reasoning, tools | `completion_chat, function_calling, vision, reasoning` | `reasoning_effort` (recommend `high` for agentic/code); predicted outputs | GA, v26.04, modified MIT |
| Mistral Small 4 | `mistral-small-2603` (+1) | 256k | chat, reasoning, tools | `completion_chat, function_calling, reasoning` | hybrid instruct/reasoning/coding; predicted outputs | GA, v26.03, Apache-2.0, 119B/6.5B active |
| Mistral Large 3 | `mistral-large-2512` (+1) | 256k | chat, vision, tools | `completion_chat, function_calling, vision` | structured outputs; prefix | GA, v25.12; note `n`-completions **not** supported per sampling page |
| Ministral 3 14B | `ministral-14b-2512` | 256k | chat, vision, tools | `completion_chat, function_calling, vision` | structured outputs | GA, Apache-2.0, edge |
| Ministral 3 8B | `ministral-8b-2512` | 256k | chat, vision, tools | `completion_chat, function_calling, vision` | structured outputs | GA, Apache-2.0, edge |
| Ministral 3 3B | `ministral-3b-2512` | 256k | chat, vision, tools | `completion_chat, function_calling, vision` | structured outputs | GA, Apache-2.0, edge |
| Z.ai GLM 5.3 | `zai-glm-5-3` | **1M** (max output 128k) | chat, reasoning, tools | `completion_chat, function_calling, reasoning` | `reasoning_effort` = **`low`/`high`/`max` only**; content always chunk-list | GA, third-party (hosted by Mistral, unmodified) |

### Code

| Model | API id | ctx | Tags | Inferred capabilities | Notable params | Notes |
|---|---|---|---|---|---|---|
| Codestral | `codestral-2508` | 128k | code, chat, tools, fim | `completion_chat, completion_fim, function_calling` | FIM endpoint `/v1/fim/completions` | GA, v25.08, Premier |
| Codestral Embed | `codestral-embed-2505` | 8k | embedding (code) | (embeddings endpoint) | `/v1/embeddings`, `output_dimension` | GA, v25.05; 1536-dim (3rd-party) |

### Embeddings

| Model | API id | ctx | Tags | Notes |
|---|---|---|---|---|
| Mistral Embed | `mistral-embed-2312` | 8k | embedding | GA, v23.12; **1024-dim**, normalized; used by our engine RAG |

### Audio (Voxtral)

| Model | API id | ctx | Tags | Notable | Notes |
|---|---|---|---|---|---|
| Voxtral TTS | `voxtral-mini-tts-2603` | — | tts, voice-clone | `/v1/audio/speech`, `/v1/audio/voices`; 9 languages, ~90 ms TTFB | GA, CC BY-NC 4.0 |
| Voxtral Mini Transcribe 2 | `voxtral-mini-2602` | — | stt | `/v1/audio/transcriptions`; diarization, word timestamps, up to 3 h | GA, Premier |
| Voxtral Mini Transcribe Realtime | `voxtral-mini-transcribe-realtime-2602` | — | stt (realtime) | `/v1/audio/transcriptions`; sub-200 ms; **incompatible with `diarize`** | GA, Apache-2.0 |
| Voxtral Small | `voxtral-small-2507` | 32k | audio-in, chat, tools | audio-input instruct; function calling | GA, v25.07, Apache-2.0 |

### OCR / Document AI

| Model | API id | ctx | Tags | Notes |
|---|---|---|---|---|
| OCR 4.1 | `mistral-ocr-4-1` | — | ocr | GA, v4.1; `/v1/ocr`; paragraph bboxes, block labels, confidence; $4/1000 pages |
| OCR 3 | (v25.12) | — | ocr | GA, prior service, kept for existing integrations |

### Moderation / safety

| Model | API id | ctx | Tags | Notes |
|---|---|---|---|---|
| Shieldstral 1.0 | (labs) | 32k | moderation, vision | Public Preview; multimodal text+image moderation, yes/no classification |
| Mistral Moderation 2 | `mistral-moderation-2603` | 128k | moderation | GA, Premier, **Free**; `/v1/moderations`; jailbreak detection |

### Time series

| Model | API id | Tags | Notes |
|---|---|---|---|
| Timestral 1.0 (123M / 209M / 28M / 5M) | `timestral-*` | timeseries | Modified MIT; zero-shot forecasting |

### Labs / deprecated (for filter lists, not seeding)

- **Labs:** `labs-leanstral-1-5`, `labs-leanstral-2603`, `labs-mistral-small-creative`,
  `labs-devstral-small-2512`; plus Shieldstral 1.0.
  [Labs](https://docs.mistral.ai/inference/labs)
- **Deprecated/retired (excerpt):** `zai-glm-5-2`, `mistral-medium-2508`,
  `mistral-small-2506`, `mistral-ocr-4-0`, `voxtral-mini-2507`, `devstral-2512`,
  `magistral-medium-2507`/`2509`, `magistral-small-2506`/`2507`/`2509`,
  `mistral-large-2411`, `pixtral-large-2411`, `mistral-moderation-2411`,
  `open-mistral-nemo-2407`, `mistral-small-2503`/`2501`/`2409`, `codestral-2501`/`2405`,
  `ministral-3b-2410`, `ministral-8b-2410`, `mistral-medium-2505`, etc.
  (Full table with deprecation/retirement dates and replacements on the
  [Models overview](https://docs.mistral.ai/models).)

> The deprecated table shows **deprecation and retirement dates** and the
> recommended alternative — but the *authoritative, machine-readable* deprecation
> signal is the `deprecation` / `deprecation_replacement_model` fields on
> `GET /v1/models`.

---

## 8. Recommendations

### Exact verify call (R10 `POST /api/providers/verify`)

```
GET https://api.mistral.ai/v1/models
Authorization: Bearer <api_key>
Accept: application/json
```

Map:
- `200` → `{valid: true, detail: "<n> models available>"}` (optionally echo
  `X-RateLimit-Remaining`).
- `401` → `{valid: false, detail: error.message}`.
- `402` → `{valid: true, detail: "Key valid but account has no payment method"}`.
- `403` → `{valid: true, detail: "Key valid but forbidden for this resource"}`.
- `429` → `{valid: true, detail: "Rate limited (key valid)"}`.
- `5xx`/network → `{valid: null, detail: "Transient — retry"}`.
Parse the uniform `{object,message,type,param,code}` body for the detail string.

### Exact models call (R10 `POST /api/providers/models`)

```
GET https://api.mistral.ai/v1/models
Authorization: Bearer <api_key>
```

Parse defensively (`body.data` if present, else a top-level array), then map
each card to our `ModelInfo`:

| Our field | Mistral source |
|---|---|
| `id` | `id` |
| `label` | `name` (fallback `id`) |
| `context` | `max_context_length` |
| `capabilities` | `capabilities` dict (14 booleans) |
| `aliases` | `aliases` |
| `deprecated` / replacement | `deprecation` / `deprecation_replacement_model` |
| `default_temperature` | `default_model_temperature` |
| `source` | `"live"` |
| (hide from picker) | `archived === true` (fine-tuned), `internal === true` |

For **regional** base URLs, call the same path against
`api.eu.mistral.ai` / `api.us.mistral.ai`.

### Capability-source verdict

- **Live fields cover most of the catalog.** For Mistral, `GET /v1/models`
  supplies per-model: capability booleans (14), context length, aliases,
  deprecation + replacement, and default temperature. This is the best
  live-discovery surface in our provider set — **prefer live over static** for
  these fields.
- **Static catalog is still required for:**
  1. **Parameter-level gating** not present in the dict — `reasoning_effort`
     applicability and the **`zai-glm-5-3` `low/high/max`-only** exception,
     `n` gating (`mistral-large-2512`), `temperature` max `1.5`, `prompt_mode`,
     `service_tier`, `prefix`, `guardrails`, `prompt_cache_key`.
  2. **Wire-name mapping** — `random_seed` (not `seed`), no
     `max_completion_tokens`, `additionalProperties:false` allow-list.
  3. **Curated labels/ordering/endpoint hints** (`/v1/fim/completions`,
     `/v1/embeddings`, `/v1/audio/*`, `/v1/ocr`, `/v1/moderations`) since the
     capability dict is coarse.
- **Merge order** (per plan §6.3): live > catalog > user override. For Mistral
  the live tier should win on `capabilities`/`max_context_length`; the catalog
  should win on param gating + wire mapping (live never carries these).

### Engine client notes (what's right / wrong for these purposes) **[engine-code]**

- ✅ **Right:** `ValidateConfig()` calling `Models.List()` is exactly our
  recommended verify call for Mistral — reuse it.
- ✅ **Right:** RAG embedding path already targets `https://api.mistral.ai/v1`
  with Bearer and model `mistral-embed` (via the pinned `chromem-go` fork).
- ❌ **Wrong / risky for a chat provider:**
  - `providers/openaicompatible.go` emits `seed` (Mistral wants `random_seed`)
    and `max_completion_tokens` (unsupported) — both will 422.
  - It forwards arbitrary keys via `SetExtraFields` (preset overflow,
    `response_format`, user extras) — Mistral's `additionalProperties:false`
    turns these into **422 `extra_forbidden`**. Must validate against the
    OpenAPI allow-list.
  - It always sends `n` (default `0`); confirm Mistral accepts `n: 0` or omit
    when unset.
  - No `reasoning_effort` wiring on the compatible client (only `openai.go`).
  - `ListModels` in `openaicompatible.go` maps only `ID`/`Name` and drops the
    rich fields — for Mistral we should surface `max_context_length`,
    `capabilities`, `aliases`, `deprecation`, `default_model_temperature`.
  - `chromem` embedding func **hard-codes** base URL + `mistral-embed` and
    accepts only HTTP 200 — fine for today, but it can't honor a user base URL
    or the newer `output_dimension` param.
- ➡️ **Recommendation:** add a dedicated Mistral chat provider (or a strict mode
  on the compatible client) with an explicit allow-list of Mistral wire names,
  `random_seed`, no `max_completion_tokens`, and capability-aware gating; and
  extend the models mapper to preserve the Mistral card fields above. No change
  to the RAG embedding path is required for the registry work.

---

## 9. Sources

Official (Mistral):
- OpenAPI spec (authoritative schemas): https://docs.mistral.ai/openapi.yaml
- Models endpoints: https://docs.mistral.ai/api/endpoint/models
- Chat endpoint: https://docs.mistral.ai/api/endpoint/chat
- Embeddings endpoint: https://docs.mistral.ai/api/endpoint/embeddings
- Beta Admin API keys: https://docs.mistral.ai/api/endpoint/beta/admin/api-keys
- Models overview / lineup: https://docs.mistral.ai/models
- Model lifecycle policy: https://docs.mistral.ai/inference/model-lifecycle
- Regional inference: https://docs.mistral.ai/inference/regional-inference
- Priority Tier: https://docs.mistral.ai/inference/priority-tier
- Labs: https://docs.mistral.ai/inference/labs
- Sampling: https://docs.mistral.ai/inference/sampling
- Prompting: https://docs.mistral.ai/inference/prompting
- Pricing: https://docs.mistral.ai/inference/pricing
- Reasoning: https://docs.mistral.ai/studio/conversations/reasoning
- Structured outputs: https://docs.mistral.ai/studio/conversations/structured-output
- Function calling: https://docs.mistral.ai/studio/conversations/function-calling
- Vision: https://docs.mistral.ai/studio/conversations/vision
- Chat completions: https://docs.mistral.ai/studio/conversations/chat-completion
- Audio overview: https://docs.mistral.ai/studio/audio/overview
- Embeddings guide: https://docs.mistral.ai/studio/knowledge-rag/embeddings
- Error glossary: https://docs.mistral.ai/resources/error-glossary
- Known limitations: https://docs.mistral.ai/resources/known-limitations
- Glossary: https://docs.mistral.ai/resources/glossary
- Admin — API keys: https://docs.mistral.ai/admin/identity-access/api-keys
- Quickstart — first API request: https://docs.mistral.ai/getting-started/quickstarts/developer/first-api-request
- Quickstart — activate Studio & generate a key: https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key
- Model cards: https://docs.mistral.ai/models/mistral-large-4-0,
  /mistral-medium-3-5-26-04, /mistral-small-4-0-26-03, /mistral-large-3-25-12,
  /ministral-3-14b-25-12, /ministral-3-8b-25-12, /ministral-3-3b-25-12,
  /codestral-25-08, /codestral-embed-25-05, /mistral-embed-23-12,
  /voxtral-small-25-07, /voxtral-tts-26-03, /voxtral-mini-transcribe-26-02,
  /voxtral-mini-transcribe-realtime-26-02, /mistral-moderation-26-03,
  /ocr-4-1, /shieldstral-1-0, /zai-glm-5-3

Third-party (context only; not authoritative):
- mistralai/platform-docs-public issue #7 (extra params / `extra_forbidden`):
  https://github.com/mistralai/platform-docs-public/issues/7
- api-evangelist/mistral (legacy "La Plateforme" naming, free-tier RPS claims):
  https://github.com/api-evangelist/mistral
- Spring AI / Vercel (embedding dims 1024 / 1536): https://docs.spring.io/spring-ai/reference/api/embeddings/mistralai-embeddings.html,
  https://vercel.com/ai-gateway/models/mistral-embed
- Kong AI Gateway (Bearer is part of the token value): https://developer.konghq.com/cookbooks/mistral-ai-with-kong-ai-gateway

Engine (this repo, `harmony-link-private`):
- `database/repository/providers/mistral.go` (CRUD only)
- `config/types.go` (`RAGMistralConfig`), `modules/rag/vector_store.go`,
  `modules/rag/validation.go`
- `providers/openaicompatible.go`, `providers/openai.go`, `providers/registry.go`
- pinned `github.com/harmony-ai-solutions/chromem-go@v0.7.1`:
  `embed_compat.go`, `embed_openai.go`
