# Provider Research — xAI / Grok (api.x.ai)

Workstream: Soulbits provider registry (R11 research preface)
Scope: key validation, live model listing, model capability catalog, parameter-name mapping
Research date: **2026-10-18**
Author: research subagent (read-only; no code changed)

Provider naming note: xAI was acquired by SpaceX and rebranded **"SpaceXAI"** on the
developer platform in July 2026. The docs site is still **`docs.x.ai`**, the inference
host is still **`api.x.ai`**, and model IDs still start with `grok-`. Some doc pages
self-refer as "SpaceXSI/SpaceXAI" — same provider. ([x.ai/api](https://x.ai/api),
[docs.x.ai models](https://docs.x.ai/developers/models))

Facts taken from our own engine client are tagged **[engine-code]**
(`harmony-link-private/providers/xai.go`, `config/types.go`).

> **Headline finding for our registry work:** xAI is the **strongest provider we have
> seen for live capability discovery**. Unlike OpenAI (whose `/v1/models` exposes no
> capability data), xAI ships a **second, richer listing endpoint —
> `GET /v1/language-models`** — that returns per-model `input_modalities`,
> `output_modalities`, `aliases`, `fingerprint`, `version`, and a `capabilities` object
> with the exact accepted `reasoning_effort` values and the default. It is not a legacy
> duplicate of `/v1/models`; it is a documented, current, first-class endpoint with a
> different field set. This is the natural anchor for our Tier-1 live-discovery for xAI.

---

## 1. API basics

| Item | Value | Source |
|---|---|---|
| Inference base URL | `https://api.x.ai` (resource table); OpenAI-compatible clients use **`https://api.x.ai/v1`** — every endpoint example targets `/v1/…` | [REST API overview](https://docs.x.ai/developers/rest-api-reference/inference), [Quickstart](https://docs.x.ai/developers/quickstart) |
| Management base URL | `https://management-api.x.ai` (separate host + separate key) | [REST API overview](https://docs.x.ai/developers/rest-api-reference/inference), [Using Management API](https://docs.x.ai/developers/management-api-guide) |
| Auth header | `Authorization: Bearer <xAI API key>` — standard HTTP Bearer, no custom header name | [REST API overview](https://docs.x.ai/developers/rest-api-reference/inference), [Debugging Errors](https://docs.x.ai/developers/debugging) |
| Compatibility | "The xAI REST API is compatible with the OpenAI REST API." Point the OpenAI/Anthropic SDK at `https://api.x.ai/v1`. | [REST API overview](https://docs.x.ai/developers/rest-api-reference/inference), [x.ai/api](https://x.ai/api) |
| API versioning | Path-versioned (`/v1/…`). **No client-supplied version header** (unlike Anthropic's `anthropic-version`). | [REST API overview](https://docs.x.ai/developers/rest-api-reference/inference) |
| Key format | Prefix **`xai-`** (masked console examples show `xai-••••••••••••••••3kf9`). No published length/checksum; treat format as a prefix pre-check only. | [x.ai/api](https://x.ai/api) (console key mask), community bug report showing `xai-Pv3CBlhI` prefix ([goose #7904](https://github.com/aaif-goose/goose/issues/7904)) |
| Key creation | Console → **API Keys** page; **shown once at creation**, store securely. | [Quickstart](https://docs.x.ai/developers/quickstart), [x.ai/api](https://x.ai/api) |
| Team / org scoping | Keys belong to a **team**; console URLs are team-scoped (`console.x.ai/team/default/…`). A team can hold multiple keys; **ACLs** on a key restrict which models/endpoints it may call. | [Using Management API](https://docs.x.ai/developers/management-api-guide) |
| Management keys | Separate from inference keys; created at Console → Settings → **Management Keys**. Manage keys/teams/billing/audit programmatically. Validate via `GET https://management-api.x.ai/auth/management-keys/validation`. | [Using Management API](https://docs.x.ai/developers/management-api-guide) |
| Key propagation | After creating a key there can be a short cluster-propagation delay; `GET /auth/api-keys/{id}/propagation` reports status. | [Using Management API](https://docs.x.ai/developers/management-api-guide) |

### Key ACLs (management API) — affects "valid key, wrong scope"

Keys carry ACL strings; when creating via the management API you pass e.g.:

- `api-key:model:*` / `api-key:endpoint:*` — all models / all endpoints
- `api-key:endpoint:chat` — chat + vision models only
- `api-key:endpoint:image` — image generation models only
- `api-key:model:<model name>` — one specific model

A key can also be created with per-key `qps`/`qpm`/`tpm` limits. **A key can therefore
authenticate fine yet be forbidden (403) for a given model or endpoint** — exactly the
"valid but not usable" case our verify UI must distinguish from "invalid".
Source: [Using Management API](https://docs.x.ai/developers/management-api-guide).

---

## 2. Key validation

### Recommended verify call

```
GET https://api.x.ai/v1/models
Authorization: Bearer <xAI API key>
```

- **Why this call:** it is the cheapest account-scoped, **side-effect-free** request.
  It lists models available to the authenticating key; no inference, no tokens billed.
  Sources: [Models API reference](https://docs.x.ai/developers/rest-api-reference/inference/models),
  [Debugging Errors](https://docs.x.ai/developers/debugging).
- **Expected 2xx shape (200)** — `object: "list"` + `data[]` (trimmed example):
  ```json
  {
    "object": "list",
    "data": [
      {
        "id": "grok-420-reasoning",
        "aliases": [],
        "created": 1768003200,
        "object": "model",
        "owned_by": "xai",
        "context_length": 256000,
        "prompt_text_token_price": 20000,
        "completion_text_token_price": 80000,
        "capabilities": {
          "reasoning_effort": ["low", "medium", "high", "xhigh"],
          "default_reasoning_effort": "high"
        }
      }
    ]
  }
  ```
  Source: [Models API reference](https://docs.x.ai/developers/rest-api-reference/inference/models).
- **Quota/credit cost:** metadata-only; **no tokens, no billed cost**; only request-rate
  limits apply (per-team RPS). Safe to call automatically on account save.
  Source: [Rate Limits](https://docs.x.ai/developers/rate-limits).

### Failure signals (401 vs 403 vs 429)

| Status | Meaning (xAI docs) | Verdict for "is this key valid?" |
|---|---|---|
| **400** Bad Request | Malformed request body/URL | Not a key verdict (our verify call is well-formed) |
| **401** Unauthorized | "No authorization header or an invalid authorization token was provided." | **Invalid** — revoked/typo'd key or missing header |
| **403** Forbidden | Authenticated but not permitted — team/ACL denies the model/endpoint ("Ask your team admin for permission.") | **Valid key, wrong scope** — surface distinctly, do not call "invalid" |
| **404** Not Found | Bad URL | Not a key verdict |
| **422** Unprocessable Entity | A POST body field has invalid format | Not applicable to GET verify |
| **429** Too Many Requests | Inference endpoints: request rate exceeded | **Valid key** — throttled; distinguish from invalid |

Source: [Debugging Errors](https://docs.x.ai/developers/debugging).

### Error body shape (important quirk)

xAI's error envelope is **not** the nested OpenAI shape. It is a **flat two-key object**:

```json
{ "code": "Client specified an invalid argument",
  "error": "Model grok-4-1-fast does not support parameter reasoningEffort." }
```

Observed 400s from real clients return `{'code': 'Client specified an invalid argument',
'error': 'Invalid arguments passed to the model.'}`; a 401 returns an OpenAI-style
message such as `Incorrect API key provided: xai-Pv3CBlhI.`
Sources: [hermes-agent #23088](https://github.com/NousResearch/hermes-agent/issues/23088),
[hermes-agent #27197](https://github.com/NousResearch/hermes-agent/issues/27197),
[goose #7904](https://github.com/aaif-goose/goose/issues/7904).

**Implication:** parse `status` first (authoritative), and read `error`/`code` for the
human-facing `detail`. Do **not** assume `error.type` / `error.code` nesting.

> Note: the deferred image/chat poll endpoints use a **different** structured error:
> `{"code": "<enum>", "message": "<text>"}` with `code ∈ {invalid_argument,
> permission_denied, failed_precondition, service_unavailable, internal_error}`.
> Source: [Images API reference](https://docs.x.ai/developers/rest-api-reference/inference/images).

---

## 3. Model listing — BOTH endpoints

xAI exposes **four** list endpoints (plus single-model GETs). All are `GET`, none paginate.

| Endpoint | Returns | Source |
|---|---|---|
| `GET /v1/models` | Minimal: id, aliases, created, object, owned_by, **context_length**, prices, `capabilities` | [Models ref](https://docs.x.ai/developers/rest-api-reference/inference/models) |
| `GET /v1/language-models` | **Richer**: + `input_modalities`, `output_modalities`, `fingerprint`, `version`, `search_price`, `aliases`, `capabilities` | [Models ref](https://docs.x.ai/developers/rest-api-reference/inference/models) |
| `GET /v1/image-generation-models` | Image models: `max_prompt_length`, `image_price`, `pricing[]` (quality×resolution), modalities | [Models ref](https://docs.x.ai/developers/rest-api-reference/inference/models) |
| `GET /v1/video-generation-models` | Video models: modalities, version | [Models ref](https://docs.x.ai/developers/rest-api-reference/inference/models) |
| `GET /v1/models/{model_id}` | Single model, same fields as `/v1/models` | [Models ref](https://docs.x.ai/developers/rest-api-reference/inference/models) |
| `GET /v1/language-models/{model_id}` | Single language model, same fields as list | [Models ref](https://docs.x.ai/developers/rest-api-reference/inference/models) |
| `GET /v1/image-generation-models/{model_id}` | Single image model | [Models ref](https://docs.x.ai/developers/rest-api-reference/inference/models) |
| `GET /v1/video-generation-models/{model_id}` | Single video model | [Models ref](https://docs.x.ai/developers/rest-api-reference/inference/models) |

### `/v1/models` — full response shape

```json
{
  "object": "list",
  "data": [
    {
      "id": "grok-420-reasoning",          // string, required
      "aliases": [],                        // string[] — alias IDs usable in `model`
      "created": 1768003200,                // Unix seconds
      "object": "model",
      "owned_by": "xai",
      "context_length": 256000,             // max context in tokens (nullable)
      "prompt_text_token_price": 20000,     // USD cents per 100M tokens
      "cached_prompt_text_token_price": 2000,
      "prompt_image_token_price": 0,
      "completion_text_token_price": 80000,
      "prompt_text_token_price_long_context": 40000,
      "completion_text_token_price_long_context": 160000,
      "long_context_threshold": 128000,     // token count at/above which long-ctx prices apply
      "capabilities": {                     // present on reasoning models
        "reasoning_effort": ["low","medium","high","xhigh"],
        "default_reasoning_effort": "high"
      }
    }
  ]
}
```

Image-generation entries in `/v1/models` add `image_price` and a `pricing[]` array with
`{price_per_image, quality(low|medium|high), resolution(1k|1.5k|2k)}` (omitted when all
tiers price identically). Source: [Models ref](https://docs.x.ai/developers/rest-api-reference/inference/models).

### `/v1/language-models` — full response shape (the richer endpoint)

```json
{
  "models": [
    {
      "id": "grok-420-reasoning",
      "fingerprint": "fp_5319828d69",       // xAI system-config fingerprint
      "created": 1768003200,
      "object": "model",
      "owned_by": "xai",
      "version": "1.0",
      "input_modalities": ["text"],          // e.g. ["text","image"]
      "output_modalities": ["text"],         // e.g. ["text"] / ["image"]
      "prompt_text_token_price": 20000,
      "cached_prompt_text_token_price": 2000,
      "prompt_image_token_price": 0,
      "completion_text_token_price": 80000,
      "search_price": 0,                      // USD cents per 100M searches
      "prompt_text_token_price_long_context": 40000,
      "cached_prompt_text_token_price_long_context": 0,   // 0 → fall back to cached price
      "completion_text_token_price_long_context": 160000, // 0 → standard price applies
      "long_context_threshold": 128000,       // 0 → no long-context tier
      "aliases": ["grok-4.3-latest"],
      "capabilities": {
        "reasoning_effort": ["low","medium","high","xhigh"],
        "default_reasoning_effort": "high"
      }
    }
  ]
}
```

### Differences between the two (for our discovery tier)

| Field | `/v1/models` | `/v1/language-models` |
|---|---|---|
| `id`, `created`, `object`, `owned_by`, `aliases` | ✅ | ✅ |
| `context_length` | ✅ | ❌ (not in the documented field list) |
| Pricing (`*_token_price`, long-context, `image_price`, `pricing[]`) | ✅ | ✅ (token prices; no `image_price`) |
| `capabilities.reasoning_effort` + `default_reasoning_effort` | ✅ | ✅ |
| `input_modalities` / `output_modalities` | ❌ | ✅ |
| `fingerprint`, `version` | ❌ | ✅ |
| `search_price` | ❌ | ✅ |
| Scope | all models incl. image/video | **chat + image-understanding models only** |

> **Neither endpoint alone is complete:** `/v1/language-models` adds modalities +
> capabilities + fingerprint but (per docs) **omits `context_length`**, which only
> `/v1/models` provides. Plan to call **both** and merge by `id` (see §8).
> Both docs pages are the same URL: [Models ref](https://docs.x.ai/developers/rest-api-reference/inference/models).

### Pagination

**None on any list endpoint.** Responses return the full array in one call; there is no
`limit`/`after`/`has_more`. (Contrast: the *management* API's key/audit listings **do**
paginate via `pageSize` + `paginationToken`.) Source:
[Models ref](https://docs.x.ai/developers/rest-api-reference/inference/models),
[Using Management API](https://docs.x.ai/developers/management-api-guide).

### The special `latest` id / aliasing

Doc examples show a model `id` of `"latest"` (e.g. with `aliases: ["grok-4.3-latest"]`),
and request examples use `"model": "latest"`. Treat this as a documented example
placeholder / possible global alias rather than a model we should surface.
Source: [Models ref](https://docs.x.ai/developers/rest-api-reference/inference/models).

---

## 4. Per-model parameter support

### Where it is documented

- **Chat Completions reference** — authoritative field-by-field list with per-param
  caveats ("Not supported by reasoning models", etc.).
  Source: [Chat Completions](https://docs.x.ai/developers/rest-api-reference/inference/chat-completions).
- **Reasoning guide** — `reasoning_effort` values/defaults per model, and the rule that
  `presencePenalty`, `frequencyPenalty`, `stop` **error** on reasoning models.
  Source: [Reasoning](https://docs.x.ai/developers/model-capabilities/text/reasoning).
- **Per-model pages** (`/developers/models/<id>`) — a structured **At a glance +
  Capabilities** block: modalities, context window, Batch API support, function calling,
  structured outputs, reasoning, and the supported/default reasoning efforts.
  Example: [grok-4.7](https://docs.x.ai/developers/models/grok-4.7),
  [grok-4.3](https://docs.x.ai/developers/models/grok-4.3).
- **Models page** — global notes (`logprobs`/`top_logprobs` ignored on `grok-4.20`+;
  image-input limits; aliases).
  Source: [Models](https://docs.x.ai/developers/models).

### Queryable via API?

**Partially — uniquely among our providers.** The two model-list endpoints expose a
`capabilities` object containing `reasoning_effort` (accepted values) and
`default_reasoning_effort`. That is **live, per-model, queryable** param support for the
reasoning param. Everything else (function calling / structured outputs / tools / batch)
is **not** in any API response and must come from the static catalog.

### Universal vs model-gated (Chat Completions)

**Broadly accepted (subject to model):** `messages`, `model`, `temperature`, `top_p`,
`n`, `stream`, `stream_options`, `stop`, `max_completion_tokens`, `seed`,
`response_format`, `tools`, `tool_choice`, `parallel_tool_calls`, `user`,
`search_parameters` (Live Search), `web_search_options` (compat), `service_tier`,
`safety_identifier`, `prompt_cache_key`, `deferred`, `guidelines`.

**Model-gated / caveated (verbatim from the reference):**

| Parameter | Gate |
|---|---|
| `reasoning_effort` | Reasoning models only. Supported values + default **depend on the model** (live via `capabilities`). |
| `frequency_penalty` | "(Not supported by reasoning models)" |
| `presence_penalty` | "(Not supported by `grok-3` and reasoning models)" |
| `stop` | "(Not supported by reasoning models)" — up to 4 sequences |
| `max_tokens` | **[DEPRECATED]** — use `max_completion_tokens` (defaults to 128,000 when unset) |
| `logprobs`, `top_logprobs` | **Not supported by `grok-4.20` and newer — silently ignored** |
| `logit_bias` | "(Unsupported)" |
| `n` | Supported, but you are **charged for all choices** |
| `service_tier` | `"default"` \| `"priority"` \| `"fast"` |
| `deferred` | Returns a `request_id`; poll `GET /v1/chat/deferred-completion/{request_id}` (202 while pending) |

Sources: [Chat Completions](https://docs.x.ai/developers/rest-api-reference/inference/chat-completions),
[Reasoning](https://docs.x.ai/developers/model-capabilities/text/reasoning),
[Models](https://docs.x.ai/developers/models).

### Live Search (Chat Completions) vs tools (Responses)

- **Chat Completions** uses `search_parameters` (this is xAI's "Live Search"):
  `mode` (`off`|`on`(default)|`auto`), `sources` (default = web + X), `from_date`,
  `to_date`, `max_search_results`, `return_citations`.
  Source: [Chat Completions](https://docs.x.ai/developers/rest-api-reference/inference/chat-completions).
- **Responses** uses server-side tools `web_search` / `x_search` with their own
  parameters (see §5/§6). Source: [Web Search](https://docs.x.ai/developers/tools/web-search),
  [X Search](https://docs.x.ai/developers/tools/x-search).

---

## 5. Param name mapping (wire-name quirks)

### Chat Completions ↔ Responses

| Concept | Chat Completions wire name | Responses wire name | Notes |
|---|---|---|---|
| Input messages | `messages` | `input` | — |
| Output token cap | `max_completion_tokens` (current) / `max_tokens` (**deprecated**) | `max_output_tokens` | Chat default cap = 128,000 |
| Reasoning effort | `reasoning_effort` (top-level string) | `reasoning.effort` (object) | Values model-dependent; live in `capabilities` |
| Encrypted reasoning | *(none — "Chat Completions is unaffected; it has no field for the ciphertext")* | `include: ["reasoning.encrypted_content"]` | Always returned for `grok-4.7` regardless of `include` |
| Conversation state | *(stateless — resend history)* | `previous_response_id`, `store` (default `true`) | Responses stored 30 days |
| Search | `search_parameters` (Live Search) | `tools: [{type:"web_search"}]` / `[{type:"x_search"}]` | Different models of operation |
| OpenAI compat search | `web_search_options.search_context_size` | — | "mapped to `max_search`"; `filters`/`user_location` are "compatibility only" |
| Structured output | `response_format` | `text.format` (per Responses config) | — |

Sources: [Chat Completions](https://docs.x.ai/developers/rest-api-reference/inference/chat-completions),
[Comparison with Chat Completions](https://docs.x.ai/developers/model-capabilities/text/comparison),
[Reasoning](https://docs.x.ai/developers/model-capabilities/text/reasoning).

### xAI-specific params (no OpenAI equivalent)

- `search_parameters` — Live Search (Chat Completions). Values `off`/`on`/`auto`.
- `service_tier` — `"default"` | `"priority"` | `"fast"` ("Fast and Priority are
  interchangeable: the model's fast deployment and its rates where configured, else
  higher scheduling priority at a higher price").
- `prompt_cache_key` — sticky routing / prompt-cache hits (plumbed to `x-grok-conv-id`).
- `safety_identifier` — end-user attribution (hash your user id).
- `guidelines` — per-category output instructions (array).
- `deferred` — async request (`request_id`).
- `tools` types on Responses: `web_search`, `x_search` (+ server-side code execution,
  MCP, file/document search per usage block).

### Deprecated / unsupported names

- `max_tokens` — deprecated (Chat Completions and `/v1/completions`).
- `logit_bias`, `top_k` — unsupported (top_k only appears on the deprecated
  Anthropic-compat `/v1/messages` and is marked "(Unsupported)").
- `logprobs` / `top_logprobs` — accepted but **silently ignored** on `grok-4.20`+.
- `/v1/completions`, `/v1/messages`, `/v1/complete` — legacy endpoints; `/v1/messages`
  and `/v1/complete` are explicitly deprecated ("migrate to Responses or gRPC").
- `presence_penalty`, `frequency_penalty`, `stop` — **error** on reasoning models.

Sources: [Chat Completions](https://docs.x.ai/developers/rest-api-reference/inference/chat-completions),
[Legacy & Deprecated](https://docs.x.ai/developers/rest-api-reference/inference/legacy),
[Models](https://docs.x.ai/developers/models).

### Our engine client's mapping notes [engine-code]

`providers/xai.go`:

- **Base URL:** `const xaiBaseURL = "https://api.x.ai/v1"` (line 75) — **correct**;
  fed to `openaigo.NewClient(option.WithBaseURL(xaiBaseURL), …)` (lines 87–90).
- **Chat params** are set on `openaigo.ChatCompletionNewParams`: `Temperature`, `TopP`,
  `MaxTokens`, `MaxCompletionTokens`, `FrequencyPenalty`, `PresencePenalty`, `N`,
  `Stop`, `Seed`, `ReasoningEffort` (`shared.ReasoningEffort`), and `response_format`
  injected via `SetExtraFields` (lines 152–249).
  - `reasoning_effort` is sent **top-level**, which matches xAI Chat Completions ✅.
  - ⚠️ **The client can send params that xAI reasoning models reject**:
    `FrequencyPenalty`/`PresencePenalty` are sent when non-zero (lines 225–230) and
    `Stop` when set (lines 212–214) — xAI returns **400** on reasoning models for these.
  - ⚠️ `if p.n >= 0 { params.N = … }` (line 216) sends `n: 0` when the field is unset,
    which is invalid (should be omitted or `≥1`).
  - ⚠️ `MaxTokens` is deprecated at xAI; for reasoning models prefer
    `max_completion_tokens`.
- **Image generation** posts directly to `/v1/images/generations` (lines 436–487) with
  `{model, prompt, n, aspect_ratio, resolution, response_format:"b64_json"}` — matches
  the documented image schema ✅ (`aspect_ratio` enum and `resolution` `1k|1.5k|2k` both
  exist). **But the default model is `"grok-2-image"`** (line 439) — a **retired** id
  (not in the current lineup; the `grok-imagine-image-*` family replaced it).
- **`ValidateConfig()`** calls `p.client.Models.List()` (lines 132–140) → `GET /v1/models`
  — **already the correct cheapest side-effect-free check**; maps cleanly onto
  `POST /api/providers/verify`.
- **`ListModels()`** (lines 305–318) also calls `client.Models.List()` and returns only
  `{ID, Name}`. The OpenAI SDK's `Models.List` only hits `/v1/models`, so to use the
  richer `/v1/language-models` we must issue a **custom HTTP GET** (or the SDK's
  raw-request helper) — see §8.
- **Config fields** (`config/types.go` `XAIProviderConfig`, lines 508–531) expose
  `Model, MaxTokens, MaxCompletionTokens, Temperature, TopP, FrequencyPenalty,
  PresencePenalty, N, StopTokens, Seed, ResponseFormat, ReasoningEffort,
  SamplingPresetName, ExtraParams, ImageAspectRatio, ImageResolution`. `ExtraParams`
  is the escape hatch for `search_parameters`, `service_tier`, etc.

---

## 6. Quirks (things that break naive clients)

1. **Flat error envelope.** Errors are `{"code": "<string>", "error": "<string>"}` —
   **not** OpenAI's nested `{"error": {"type","code","message"}}`. Branch on HTTP status;
   read `error`/`code` for display. (§2)
2. **401 vs 403 vs 429.** `401` = no/invalid key. `403` = authenticated but **ACL/team
   forbids** the model/endpoint ("valid but not usable"). `429` = **valid key**,
   rate-limited. Never collapse 403/429 into "invalid".
   Source: [Debugging Errors](https://docs.x.ai/developers/debugging).
3. **Model aliasing + retirement by redirect.** Aliases: `<model>` → latest stable,
   `<model>-latest` → latest, `<model>-<date>` → pinned. Retired slugs **keep resolving
   and silently redirect** (e.g. `grok-3`, `grok-4-0709`, `grok-4-fast-*`,
   `grok-4-1-fast-*` → `grok-4.3`; `grok-code-fast-1` → `grok-build-0.1`) — a request can
   succeed on a *different, differently-priced* model than requested.
   Sources: [Models](https://docs.x.ai/developers/models),
   [May 15, 2026 Model Retirement](https://docs.x.ai/developers/migration/may-15-retirement).
4. **Reasoning-model param minefield.** `frequency_penalty`, `presence_penalty`, `stop`
   **return errors** on reasoning models; `logprobs`/`top_logprobs` are **silently
   ignored** on `grok-4.20`+; reasoning cannot be disabled on `grok-4.7`/4.6/4.5.
   Sources: [Reasoning](https://docs.x.ai/developers/model-capabilities/text/reasoning),
   [Models](https://docs.x.ai/developers/models).
5. **Vision vs text split is live.** Every current *text* model is `["text","image"] →
   ["text"]`; `input_modalities`/`output_modalities` on `/v1/language-models` is the
   authoritative signal. Image-input limits: max 20 MiB/image, jpg/jpeg/png only, no
   image-count limit.
   Sources: [Models](https://docs.x.ai/developers/models), per-model pages.
6. **Separate image/video model families.** Image generation lives in
   `grok-imagine-image-*` (not the chat models), with its own list endpoint and
   `quality`/`resolution` pricing matrix. `grok-imagine-image-quality` **retires
   2026-11-02** (slug redirects to `grok-imagine-image-2.0` at `quality: low`).
   `grok-imagine-image-pro` already retired (2026-05-15).
   Sources: [Images ref](https://docs.x.ai/developers/rest-api-reference/inference/images),
   [Release Notes](https://docs.x.ai/developers/release-notes),
   [May 15 Retirement](https://docs.x.ai/developers/migration/may-15-retirement).
7. **Rate limits are tiered per model (RPS + TPM).** Tier is driven by cumulative spend
   since 2026-01-01; T0 default. Exceeding returns **429**; use exponential backoff.
   Per-second limit derives from the per-minute budget (RPM/48, min 2). "Rate limit tiers
   apply to text, embedding, and voice models." Metadata calls like `GET /v1/models`
   are subject only to RPS.
   Source: [Rate Limits](https://docs.x.ai/developers/rate-limits).
8. **Long-context pricing doubles.** Requests whose prompt reaches **200k tokens** are
   billed at the higher rate for **all** tokens in the request; `long_context_threshold`
   in the model payload marks the boundary (examples use 128k for some models).
   Sources: [Models](https://docs.x.ai/developers/models),
   [Models ref](https://docs.x.ai/developers/rest-api-reference/inference/models).
9. **`n` charges all choices.** Keep `n = 1` to minimize cost.
   Source: [Chat Completions](https://docs.x.ai/developers/rest-api-reference/inference/chat-completions).
10. **Async/deferred paths return 202.** Deferred chat/image requests return `request_id`
    and must be polled (`GET /v1/chat/deferred-completion/{id}`,
    `GET /v1/images/{id}`); a *failed* deferred image is a 200 body with `error`, not an
    HTTP error.
    Sources: [Chat Completions](https://docs.x.ai/developers/rest-api-reference/inference/chat-completions),
    [Images ref](https://docs.x.ai/developers/rest-api-reference/inference/images).
11. **Encrypted reasoning default-on for `grok-4.7` (Responses only).** It always returns
    `reasoning.encrypted_content`; Chat Completions has no ciphertext field.
    Source: [Reasoning](https://docs.x.ai/developers/model-capabilities/text/reasoning).
12. **Docs-domain churn.** Old `docs.x.ai/docs/…` paths now live under
    `docs.x.ai/developers/…`; the developer platform rebranded to "SpaceXAI". Endpoints
    and hostnames are unchanged.
    Sources: [x.ai/api](https://x.ai/api), [REST API overview](https://docs.x.ai/developers/rest-api-reference/inference).

---

## 7. Catalog seed table (current lineup, 2026-10-18)

Capability tags: `chat` (text in/out), `vision` (image in), `reasoning`, `tools`
(function calling), `structured`, `image` (gen/edit), `video`, `tts`, `stt`, `audio`.
"Batch" = Batch API supported (20% discount).
Context = context window from the model page / `/v1/models.context_length`.

### Text / chat / reasoning (all `text,image → text`)

| Model ID | Tags | Context | Reasoning efforts (default) | Batch | Notable params / notes |
|---|---|---|---|---|---|
| `grok-4.7` | chat, vision, reasoning, tools, structured | 500k | low/medium/high/xhigh (**high**) | ✗ | Flagship. **No text output limit.** `reasoning` cannot be disabled. Encrypted reasoning always returned (Responses). Knowledge cutoff May 2026. |
| `grok-4.6` | chat, vision, reasoning, tools, structured | 500k | low/medium/high/xhigh (**high**) | ✗ | Prior flagship; same price as 4.7. |
| `grok-4.5` | chat, vision, reasoning, tools, structured | 500k | low/medium/high/xhigh (**high**) | ✗ | Aliases `grok-4.5-latest`, `grok-build-latest`. Reasoning guide says `xhigh` is *treated as* `high` on 4.5 (model page lists it supported) — **docs disagree; gate `xhigh` cautiously.** |
| `grok-4.3` | chat, vision, reasoning, tools, structured | 1M | **none**/low/medium/high/xhigh (**low**) | ✓ | The current retirement redirect target. Alias `grok-4.3-latest`. |
| `grok-4.20-0309-reasoning` | chat, vision, reasoning, tools, structured | 1M | low/medium/high/xhigh (**high**) | ✓ | Many aliases (`grok-4.20`, `grok-4.20-reasoning`, …). `logprobs`/`top_logprobs` **ignored**. |
| `grok-4.20-0309-non-reasoning` | chat, vision, tools, structured | 1M | *(non-reasoning)* | ✓ | Non-reasoning sibling. |
| `grok-4.20-multi-agent-0309` | chat, vision, reasoning, tools, structured | 1M | low/medium/high/xhigh | ✓ | `reasoning.effort` controls **agent count (4 or 16)**, not depth. Aliases incl. `grok-4.20-multi-agent`. |
| `grok-build-0.1` | chat, vision, reasoning, tools, structured, coding | 256k | (reasoning) | ✗ | Aliases `grok-code-fast-1`, `grok-code-fast`, `grok-code-fast-1-0825`. |

### Image generation

| Model ID | Tags | Params | Notes |
|---|---|---|---|
| `grok-imagine-image-2.0` | image | `prompt`, `n`, `aspect_ratio`, `resolution` (1k/1.5k/2k), `response_format` (url/b64_json), `image`/`images` (edits) | $0.04/img. Current recommended. |
| `grok-imagine-image-quality` | image | same | $0.05/img. **Retires 2026-11-02** → served by `-2.0` at `quality: low`. |
| `grok-imagine-image` | image | same | $0.02/img. 1.0; not affected by the Nov retirement. |

Endpoints: `POST /v1/images/generations`, `POST /v1/images/edits`.
Source: [Images ref](https://docs.x.ai/developers/rest-api-reference/inference/images),
[Models](https://docs.x.ai/developers/models).

### Video generation

| Model ID | Tags | Modalities | Price |
|---|---|---|---|
| `grok-imagine-video-1.5` | video | text,image,audio → video | $0.080/sec |
| `grok-imagine-video-1.5-lite` | video | text,image → video | $0.020/sec |
| `grok-imagine-video` | video | text,image,video → video | $0.050/sec |

Source: [Models](https://docs.x.ai/developers/models), [x.ai/api](https://x.ai/api).

### Voice / audio

| Model / mode | Tags | Price |
|---|---|---|
| `grok-voice-3.0` | audio (speech-to-speech) | $0.08/min |
| `grok-voice-2.0` | audio — **Deprecated** | $0.08/min |
| Text to Speech | tts | $15.00 / 1M chars |
| Speech to Text | stt | $0.10/hr (REST), $0.20/hr (streaming) |

Source: [Models](https://docs.x.ai/developers/models).

### Retired / redirecting (do NOT seed; may still resolve)

`grok-3`, `grok-4-0709`, `grok-4-fast-reasoning`, `grok-4-fast-non-reasoning`,
`grok-4-1-fast-reasoning`, `grok-4-1-fast-non-reasoning` → redirect to `grok-4.3`
(reasoning/non-reasoning mapped to `low`/`none` effort); `grok-code-fast-1` →
`grok-build-0.1`; `grok-imagine-image-pro` retired.
Source: [May 15, 2026 Model Retirement](https://docs.x.ai/developers/migration/may-15-retirement).

---

## 8. Recommendations

### Exact verify call

```
POST /api/providers/verify → engine performs:
GET https://api.x.ai/v1/models
Headers: Authorization: Bearer <key>
```

| Upstream | `valid` | `detail` |
|---|---|---|
| `200` | `true` | `"ok"` |
| `401` | `false` | `"invalid_api_key"` |
| `403` | `false` (`reason: "forbidden"`) | `"forbidden"` — key real but ACL/team denies access |
| `429` | `true` (`reason: "rate_limited"`) | pass through status |
| `5xx`/timeout | `false` (transient) | `"upstream_unavailable"` |

No billing cost (metadata-only); safe to call on save. Parse the flat
`{code,error}` body for the message, but branch on **status**.

### Exact models call (which endpoint)

Recommend the engine call **both** list endpoints and merge by `id`:

```
GET https://api.x.ai/v1/language-models   # primary: modalities + capabilities + aliases + fingerprint
GET https://api.x.ai/v1/models            # secondary: context_length (+ pricing)
```

- Primary source = **`/v1/language-models`** — it is the richer, current endpoint and the
  best live-discovery anchor we have across all providers.
- Merge in **`context_length`** from `/v1/models` (language-models omits it).
- Also fetch `/v1/image-generation-models` (+ `/v1/video-generation-models`) if the
  Imagination module picker needs them.
- Emit `{id, label, context, capabilities, source:"live"}`; capability chips from the
  live `capabilities.reasoning_effort`/`default_reasoning_effort` and modalities.
- For a single-model refresh, `GET /v1/language-models/{model_id}`.

Because the OpenAI Go SDK's `Models.List()` only hits `/v1/models`, use a **raw HTTP GET**
for `/v1/language-models` (or the SDK's request helper) — do not try to force it through
`client.Models`.

### Capability-source verdict

xAI is a **hybrid** provider — much better than OpenAI, but still not fully self-describing:

- **Tier 1 (live) covers:** model IDs, aliases, **input/output modalities**,
  **accepted `reasoning_effort` values + default**, `context_length`, long-context
  threshold, pricing, `fingerprint`, `version`, `search_price`.
- **Tier 1 does NOT cover (needs Tier 2 static catalog):** function-calling support,
  structured-output support, Batch API support, tool availability (web/X search),
  image `quality`/`resolution` matrix semantics, and any human-facing label/description.
  These live only on the per-model doc pages.
- **Tier 2 must therefore carry:** `tools`, `structured`, `batch`, `search` flags per
  model, plus the per-provider **param-name mapping** (`max_tokens`→
  `max_completion_tokens`; Responses `max_output_tokens`/`reasoning.effort`;
  `search_parameters` vs `tools.web_search`) and the reasoning-model exclusion list
  (`frequency_penalty`, `presence_penalty`, `stop`).
- **Tier 3 (user override)** unchanged.

### Engine client notes (what to change / watch) [engine-code]

1. **`ValidateConfig()` is already correct** — keep `Models.List()` (`GET /v1/models`) as
   the verify call. It maps 1:1 to `POST /api/providers/verify`.
2. **Extend `ListModels()`** to call `/v1/language-models` (custom HTTP) and merge
   `/v1/models` for `context_length`; return richer `common.ModelInfo` (context,
   modalities, reasoning efforts). This is the single biggest win for the picker.
3. **Fix the image default model** — `generateImageAPI()` defaults to `"grok-2-image"`
   (retired). Use `grok-imagine-image-2.0`.
4. **Guard reasoning-model params** — do not send `frequency_penalty`,
   `presence_penalty`, or `stop` when the selected model is a reasoning model (xAI
   **400**s). Gate via the catalog / live `capabilities`.
5. **Fix `n`** — `if p.n >= 0` sends `n: 0`; omit when unset or clamp to `≥1`.
6. **Prefer `max_completion_tokens`** over deprecated `max_tokens` for reasoning models.
7. **Live Search is reachable today** via `ExtraParams["search_parameters"]`
   (`{mode:"auto", sources:[…], return_citations:true}`) — surface it as a capability,
   not a hard-coded field, for now.
8. **Add `service_tier` / `safety_identifier` / `prompt_cache_key`** to the mapping table
   so the UI can pass them through `ExtraParams`.

### Suggested catalog row shape for xAI

```json
{
  "grok-4.7": {
    "capabilities": ["chat", "vision", "reasoning", "tools", "structured"],
    "context_window": 500000,
    "input_modalities": ["text", "image"],
    "output_modalities": ["text"],
    "reasoning_effort": ["low", "medium", "high", "xhigh"],
    "default_reasoning_effort": "high",
    "batch": false,
    "search": ["web_search", "x_search"],
    "supported_params": ["messages","model","max_completion_tokens","temperature",
      "top_p","reasoning_effort","response_format","tools","tool_choice","stream",
      "service_tier","seed","search_parameters"],
    "unsupported_params": ["max_tokens","logit_bias","frequency_penalty",
      "presence_penalty","stop","top_k"],
    "param_map": { "max_tokens": "max_completion_tokens" },
    "live": true,
    "notes": "reasoning cannot be disabled; encrypted reasoning always returned (Responses)"
  }
}
```

---

## Sources

All URLs retrieved **2026-10-18**.

- REST API overview / base URLs + auth — https://docs.x.ai/developers/rest-api-reference/inference
- Models API reference (all four list endpoints + single-model GETs) — https://docs.x.ai/developers/rest-api-reference/inference/models
- Chat Completions reference — https://docs.x.ai/developers/rest-api-reference/inference/chat-completions
- Images reference — https://docs.x.ai/developers/rest-api-reference/inference/images
- Legacy & Deprecated reference — https://docs.x.ai/developers/rest-api-reference/inference/legacy
- Debugging Errors (status codes) — https://docs.x.ai/developers/debugging
- Rate Limits — https://docs.x.ai/developers/rate-limits
- Models & pricing + aliases — https://docs.x.ai/developers/models
- Per-model pages — https://docs.x.ai/developers/models/{grok-4.7, grok-4.6, grok-4.5, grok-4.3, grok-4.20-0309-reasoning, grok-4.20-multi-agent-0309, grok-build-0.1, grok-imagine-image-2.0}
- Reasoning guide (`reasoning_effort`, encrypted content) — https://docs.x.ai/developers/model-capabilities/text/reasoning
- Comparison with Chat Completions (Responses migration) — https://docs.x.ai/developers/model-capabilities/text/comparison
- Web Search tool — https://docs.x.ai/developers/tools/web-search
- X Search tool — https://docs.x.ai/developers/tools/x-search
- Using Management API (keys, ACLs, teams, management-key validation) — https://docs.x.ai/developers/management-api-guide
- Quickstart (key creation) — https://docs.x.ai/developers/quickstart
- Release Notes (Imagine retirements) — https://docs.x.ai/developers/release-notes
- May 15, 2026 Model Retirement (redirect behaviour) — https://docs.x.ai/developers/migration/may-15-retirement
- SpaceXSI API landing (key prefix, pricing, enterprise) — https://x.ai/api
- Error-body evidence (third-party bug reports): https://github.com/NousResearch/hermes-agent/issues/23088 , https://github.com/NousResearch/hermes-agent/issues/27197 , https://github.com/aaif-goose/goose/issues/7904

### Engine files read [engine-code]

- `harmony-link-private/providers/xai.go`
- `harmony-link-private/config/types.go` (`XAIProviderConfig`, lines 508–531)
- `harmony-link-private/providers/registry.go` (provider registration)
