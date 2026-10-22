# OpenRouter — Provider Research

> Workstream: Soulbits provider registry — key validation, live model discovery, engine capability catalog.
> Provider: **OpenRouter** (`openrouter.ai`).
> Research date: **2026-10-18**. All external claims cite the OpenRouter doc URL used; facts taken from the
> engine source are marked `[engine-code]`. Live API responses were fetched directly during this research and
> are labelled `[live-fetch 2026-10-18]`.

---

## 0. TL;DR for the workstream

- **Key validation:** `GET /api/v1/key` is the correct, side-effect-free verify call. It returns `200` + key status/limits for a valid key, `401` for an invalid/missing/revoked key, and never incurs spend. **Do not** validate by calling `/models` — that endpoint is unauthenticated and returns `200` even with a garbage key.
  - Source: <https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key>, <https://openrouter.ai/docs/api_reference/limits>
- **Live model discovery:** `GET /api/v1/models` is the single richest capability source in the ecosystem. It is public (no auth), returns ~471 models `[live-fetch 2026-10-18]`, and each model carries `supported_parameters`, `context_length`, `architecture.input_modalities`/`output_modalities`, full `pricing`, `top_provider` limits and `reasoning` capability. This **is** the recommendation: live-only, no hand-maintained catalog.
  - Source: <https://openrouter.ai/docs/guides/overview/models>
- **Capability-source verdict:** **live-only** (fetch `/api/v1/models` at runtime / cache at edge). OpenRouter publishes no separately-versioned capability manifest, and the live schema is explicitly "cached at the edge and designed for reliable integration with production applications."

---

## 1. API basics

### Base URL & surface

| Item | Value | Source |
| --- | --- | --- |
| Base URL | `https://openrouter.ai/api/v1` | [auth docs](https://openrouter.ai/docs/api_reference/authentication) |
| Chat completions | `POST /api/v1/chat/completions` | [API reference](https://openrouter.ai/docs/api_reference/overview) |
| OpenAI-compatible | Yes — "very similar to the OpenAI Chat API"; set `base_url=https://openrouter.ai/api/v1` in the OpenAI SDK | [API reference](https://openrouter.ai/docs/api_reference/overview) |
| Other skins | `/api/v1/responses` (OpenAI Responses), `/api/v1/messages` (Anthropic Messages) | [errors doc](https://openrouter.ai/docs/api_reference/errors-and-debugging) |
| OpenAPI spec | `https://openrouter.ai/openapi.yaml` / `openapi.json` | [API reference](https://openrouter.ai/docs/api_reference/overview) |

### Auth header format

```
Authorization: Bearer <OPENROUTER_API_KEY>
```

- Bearer token auth. Works with `curl` and the OpenAI SDK directly.
- Source: <https://openrouter.ai/docs/api_reference/authentication>

**Optional attribution headers** (identify your app on openrouter.ai rankings; not required for function):

| Header | Purpose | Source |
| --- | --- | --- |
| `HTTP-Referer` | Site URL for rankings | [API reference](https://openrouter.ai/docs/api_reference/overview) |
| `X-OpenRouter-Title` (alias `X-Title` also accepted) | App title | [API reference](https://openrouter.ai/docs/api_reference/overview) |
| `X-OpenRouter-Categories` | Marketplace categories | [API reference](https://openrouter.ai/docs/api_reference/overview) |
| `X-OpenRouter-Metadata: enabled` | Opt-in routing metadata in response (`openrouter_metadata`) | [errors doc](https://openrouter.ai/docs/api_reference/errors-and-debugging) |

`[engine-code]` `providers/openrouter.go` `ConnectToBackend()` already sets these:
`openrouter.NewClient(apiKey, openrouter.WithXTitle("Soulbits Engine - AI Character Engine"), openrouter.WithHTTPReferer("https://project-harmony.ai/"))`.

### Key format & creation

- Key format: `sk-or-v1-…` (prefix visible in `label` example `"sk-or-v1-au7...890"`). Source: [get-current-api-key](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key).
- Create keys at `https://openrouter.ai/keys` — give a name and choose a credit limit (or none). Source: [auth docs](https://openrouter.ai/docs/api_reference/authentication).
- Keys created during onboarding get a **$100 credit limit** and **expire after 180 days**. Source: [auth docs](https://openrouter.ai/docs/api_reference/authentication).
- Keys support optional per-key **credit limit** and **reset interval** (daily/weekly/monthly/lifetime). Once spent, requests with that key are rejected until the limit is raised or resets. Source: [auth docs](https://openrouter.ai/docs/api_reference/authentication), [limits](https://openrouter.ai/docs/api_reference/limits).
- OpenRouter is a GitHub secret-scanning partner and notifies on detected exposure. Source: [auth docs](https://openrouter.ai/docs/api_reference/authentication).

### Credits vs key scoping

Three distinct layers govern spend (checked in order):

1. **Account balance / credits** — shared across the account; negative balance → `402` even on free models.
2. **Per-key credit limit** (`limit`, `limit_remaining`, `limit_reset`) — optional cap on an individual API key.
3. **Budget limits** (guardrails / workspace / key's own limit) — org-admin spend caps; blocked with `403`.

Plus an **in-flight spending budget**: estimated cost of running/recently-completed paid requests is held against the balance; exceeding it → `402` with `metadata.reason: "in_flight_budget_exhausted"`.
Source: <https://openrouter.ai/docs/api_reference/limits>

There are also key capability flags in the `/key` response: `is_free_tier`, `is_management_key`, `is_provisioning_key`. Management keys (for the Management API) and provisioning keys are scoped differently from normal inference keys — relevant when deciding which key type the app should ask users for. Source: [get-current-api-key](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key).

---

## 2. Key validation

### The verify call

```
GET https://openrouter.ai/api/v1/key
Authorization: Bearer <OPENROUTER_API_KEY>
```

- **Side-effect-free**: reads key metadata only; no tokens, no spend.
- **Cheapest** correct validation call: a single GET, small JSON body.
- Source: <https://openrouter.ai/docs/api_reference/limits> ("To check the rate limit or credits left on an API key, make a GET request to `https://openrouter.ai/api/v1/key`"), and <https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key>

### Response shape (valid key → `200`)

```jsonc
{
  "data": {
    "label": "sk-or-v1-au7...890",          // masked key label
    "limit": 100,                            // per-key credit cap in USD, or null if unlimited
    "limit_remaining": 74.5,                 // remaining credits for the key, or null if unlimited
    "limit_reset": "monthly",                // "daily"|"weekly"|"monthly"|null
    "include_byok_in_limit": false,

    "usage": 25.5,                           // credits used, all time
    "usage_daily": 25.5,
    "usage_weekly": 25.5,
    "usage_monthly": 25.5,

    "byok_usage": 17.38,                     // external BYOK usage (same 4 windows)
    "byok_usage_daily": 17.38,
    "byok_usage_weekly": 17.38,
    "byok_usage_monthly": 17.38,

    "is_free_tier": false,                   // has the user ever paid for credits?
    "is_management_key": false,
    "is_provisioning_key": false,
    "expires_at": "2027-12-31T23:59:59Z",    // or null

    "free_model_daily_requests": {           // gates :free-variant requests
      "used": 12, "limit": 50, "remaining": 38
    },

    "budgets": [ /* Budget[] — every budget enforced for this key, in enforcement order */ ],
    "effective_budget": { /* Budget | null — the one that blocks first */ },

    "creator_user_id": "user_...",
    "organization_id": null,
    "workspace_id": "0df9e665-...",
    "allowed_data_regions": ["global", "europe", "us"],

    "rate_limit": { "interval": "1h", "requests": 1000,
                    "note": "This field is deprecated and safe to ignore." }
  }
}
```

`Budget` shape (from the limits doc):

```jsonc
{
  "scope": "workspace_default_member" | "workspace_default_key" | "member"
         | "api_key" | "workspace" | "key_limit",
  "guardrail_id": string | null,
  "budget_id": string | null,
  "limit_usd": number,
  "spend_usd": number,        // spend counted against the limit this window
  "remaining_usd": number,    // limit_usd - spend_usd; <= 0 blocks requests
  "reset_interval": "daily" | "weekly" | "monthly" | null,
  "resets_at": string | null, // ISO 8601 UTC, or null
  "include_byok": boolean
}
```

Sources: <https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key>, <https://openrouter.ai/docs/api_reference/limits>.

### 401 vs 403 vs 402 semantics

| Status | `error_type` (inference) | Meaning for a key check | Source |
| --- | --- | --- | --- |
| `401` | `authentication` | Key missing, invalid, or revoked (OAuth session expired / disabled key) | [errors](https://openrouter.ai/docs/api_reference/errors-and-debugging) |
| `402` | `payment_required` | Account/key out of credits | [errors](https://openrouter.ai/docs/api_reference/errors-and-debugging) |
| `403` | `permission_denied` | Key valid but lacks permission, or blocked by guardrail/budget/moderation | [errors](https://openrouter.ai/docs/api_reference/errors-and-debugging) |
| `429` | `rate_limit_exceeded` | Rate limited (platform or upstream provider) | [errors](https://openrouter.ai/docs/api_reference/errors-and-debugging) |

Error envelope (all endpoints):

```jsonc
{ "error": { "code": 401, "message": "…", "metadata": { /* optional */ } } }
```

`[live-fetch 2026-10-18]` confirmed against `GET /api/v1/key`:
- No auth header → `401 {"error":{"message":"No cookie auth credentials found","code":401}}`
- Bad key → `401 {"error":{"message":"User not found.","code":401}}`

> **Important for the test button:** a *valid* key on an *unfunded* account still returns `200` from `/key` (the account balance is separate). Use the `data.is_free_tier` flag and `effective_budget.remaining_usd` / `limit_remaining` to distinguish "key valid but broke" from "key invalid". A `401` means the key itself is bad; `402`/`403` only appear on inference, not on `/key`.

### Rate-limit headers

- `X-RateLimit-*` headers are present on rate-limit **error** responses (`429`). Source: [limits](https://openrouter.ai/docs/api_reference/limits).
- `Retry-After` (seconds) is returned on `429`, `503`, and on `402` whose `error.metadata.limit_source` is `openrouter_in_flight_budget`. Source: [errors](https://openrouter.ai/docs/api_reference/errors-and-debugging).
- Free-variant limits: `<10` credits purchased → 20 req/min & 50 req/day; `>=10` credits → 20 req/min & 1000 req/day. Source: [limits](https://openrouter.ai/docs/api_reference/limits).

---

## 3. Model listing

### Endpoint

```
GET https://openrouter.ai/api/v1/models
```

- **Public — no authentication required.** `[live-fetch 2026-10-18]` returned `200` with no headers.
- Source: <https://openrouter.ai/docs/guides/overview/models>

### Root response object

```jsonc
{
  "data": [ /* Model[] */ ],
  "total_count": 471,
  "links": { "next": "/api/v1/models?offset=500&limit=500" } // or null on last page
}
```

`[live-fetch 2026-10-18]` root keys: `data`, `total_count`, `links`; `total_count: 471`.

### Full per-model schema (union of documented + live-observed fields)

`[live-fetch 2026-10-18]` observed keys on a Model object:
`id, canonical_slug, hugging_face_id, name, created, description, context_length, architecture, pricing, top_provider, per_request_limits, supported_parameters, default_parameters, supported_voices, knowledge_cutoff, expiration_date, links, benchmarks, reasoning`.

| Field | Type | Meaning | Source |
| --- | --- | --- | --- |
| `id` | string | Request identifier, e.g. `google/gemini-2.5-pro` | [models doc](https://openrouter.ai/docs/guides/overview/models) |
| `canonical_slug` | string | Permanent slug that never changes (alias target) | [models doc](https://openrouter.ai/docs/guides/overview/models) |
| `hugging_face_id` | string\|null | HF model id if applicable | [TS Model](https://openrouter.ai/docs/client-sdks/typescript/models/model) |
| `name` | string | Display name | [models doc](https://openrouter.ai/docs/guides/overview/models) |
| `created` | number | Unix ts when added to OpenRouter | [models doc](https://openrouter.ai/docs/guides/overview/models) |
| `description` | string | Capability description | [models doc](https://openrouter.ai/docs/guides/overview/models) |
| `context_length` | number | Max context window (tokens) | [models doc](https://openrouter.ai/docs/guides/overview/models) |
| `architecture` | object | See below | [models doc](https://openrouter.ai/docs/guides/overview/models) |
| `pricing` | object | See below | [models doc](https://openrouter.ai/docs/guides/overview/models) |
| `top_provider` | object | See below | [models doc](https://openrouter.ai/docs/guides/overview/models) |
| `per_request_limits` | object\|null | Rate-limit info (null if none) | [models doc](https://openrouter.ai/docs/guides/overview/models) |
| `supported_parameters` | string[] | Which request params the model accepts | [models doc](https://openrouter.ai/docs/guides/overview/models) |
| `default_parameters` | object\|null | Default param values for the model | [models doc](https://openrouter.ai/docs/guides/overview/models) |
| `supported_voices` | string[]\|null | Voice ids for TTS models (null for non-TTS) | [TS Model](https://openrouter.ai/docs/client-sdks/typescript/models/model) |
| `knowledge_cutoff` | string\|null | ISO date of training cutoff | [TS Model](https://openrouter.ai/docs/client-sdks/typescript/models/model) |
| `expiration_date` | string\|null | Deprecation date (ISO) or null | [models doc](https://openrouter.ai/docs/guides/overview/models) |
| `links` | object | `{ "details": "/api/v1/models/{author}/{slug}/endpoints" }` | [live-fetch 2026-10-18] |
| `benchmarks` | object\|omitted | Third-party rankings (Design Arena + Artificial Analysis); omitted when absent | [models doc](https://openrouter.ai/docs/guides/overview/models) |
| `reasoning` | object\|omitted | Reasoning capability descriptor; omitted for non-reasoning / dynamic-router models | [TS Model](https://openrouter.ai/docs/client-sdks/typescript/models/model) |

#### `architecture` object

```jsonc
{
  "modality": "text+image->text",        // legacy string; deprecated in favour of the two arrays
  "input_modalities": ["text","image"],  // observed set: text | image | file | audio | video
  "output_modalities": ["text"],         // observed set: text | image | audio
  "tokenizer": "GPT",                    // GPT | Claude | Gemini | Gemma | Grok | DeepSeek | Qwen |
                                         // Qwen3 | Llama2/3/4 | Mistral | Nova | Cohere | Router | Other
  "instruct_type": "chatml"              // or null
}
```

Sources: [models doc](https://openrouter.ai/docs/guides/overview/models), [TS Model](https://openrouter.ai/docs/client-sdks/typescript/models/model). Observed modality sets `[live-fetch 2026-10-18]`: input `audio, file, image, text, video`; output `audio, image, text`.

> The `modality` string is explicitly deprecated: "OpenRouter removed this option, use `input_modalities` and `output_modalities` instead" ([openrouter-rs source](https://docs.rs/openrouter/latest/src/openrouter/models.rs.html)). Parse the arrays.

#### `pricing` object

All values are **strings** (USD, decimal, per token / per request / per unit); `"0"` means free.

```jsonc
{
  "prompt": "0.0000025",          // per input token
  "completion": "0.00001",        // per output token
  "request": "0",                 // fixed cost per request
  "image": "0",                   // per image input
  "image_output": "0",            // per image output (observed)
  "audio": "0",                   // per audio unit (observed)
  "audio_output": "0",            // (observed)
  "web_search": "0",              // per web search op
  "internal_reasoning": "0",      // reasoning tokens
  "input_cache_read": "0",        // cached input read
  "input_cache_write": "0",       // cached input write
  "input_cache_write_1h": "0",    // (observed)
  "input_audio_cache": "0",       // (observed)
  "overrides": [ /* PricingOverride[] */ ]
}
```

Observed pricing keys `[live-fetch 2026-10-18]`: `audio, audio_output, completion, image, image_output, input_audio_cache, input_cache_read, input_cache_write, input_cache_write_1h, internal_reasoning, overrides, prompt, web_search`.

**Pricing overrides** (conditional pricing — long-context and/or time-of-day):

```jsonc
{
  "min_prompt_tokens": 200000,          // applies when prompt tokens > threshold
  "utc_start": 1630, "utc_end": 30,     // HHMM UTC window (wrap-aware)
  "utc_days": ["monday","tuesday",…],   // optional weekday scoping
  "prompt": "0.000005", "completion": "0.00002" // overridden prices
}
```

Time-window entries tile the whole day/week, so exactly one matches any instant. Consumers should **skip entries containing condition fields they don't recognise**. Source: [models doc](https://openrouter.ai/docs/guides/overview/models).

#### `top_provider` object

```jsonc
{
  "context_length": 128000,        // provider-specific context limit
  "max_completion_tokens": 16384,  // max output tokens (ceiling for max_tokens)
  "is_moderated": true             // whether content moderation applies
}
```

Source: [models doc](https://openrouter.ai/docs/guides/overview/models). `max_completion_tokens` is a ceiling, not a guarantee: effective output = context remaining after input. `[live-fetch 2026-10-18]` confirmed keys `context_length, is_moderated, max_completion_tokens`.

#### `reasoning` object (observed `[live-fetch 2026-10-18]`)

```jsonc
{
  "mandatory": false,                     // reasoning cannot be disabled
  "default_enabled": true,
  "supported_efforts": ["max","high","low","none"],
  "default_effort": "high"
}
```

337 of 471 models carried a `reasoning` field `[live-fetch 2026-10-18]`. Omitted for non-reasoning and dynamic-router models ([TS Model](https://openrouter.ai/docs/client-sdks/typescript/models/model)).

#### `benchmarks` object (observed `[live-fetch 2026-10-18]`)

```jsonc
{
  "design_arena": [ { "arena":"models","category":"website","elo":1385.2,"win_rate":62.5,"rank":5 } ],
  "artificial_analysis": { "intelligence_index": 71.4, "coding_index": 63.2, "agentic_index": 55.8 }
}
```

Source: [models doc](https://openrouter.ai/docs/guides/overview/models).

### Pagination

- **Opt-in.** When `offset` and `limit` are both omitted, the full list is returned and `links.next` is `null`. `[live-fetch 2026-10-18]` confirmed the default full-list behaviour (471 models in one response).
- When paginating: `limit` defaults to **500**, max **1000**; `links.next` holds the ready-to-use next-page URL.
- Example: `GET /api/v1/models?offset=0&limit=500`
- Source: <https://openrouter.ai/docs/guides/overview/models>

### Query parameters (filters/sort) — new and useful for the catalog

| Param | Values | Source |
| --- | --- | --- |
| `output_modalities` | comma list or `all`; `text` (default), `image`, `video`, `audio`, `speech`, `transcription`, `embeddings`, `rerank`, `decisions` | [models doc](https://openrouter.ai/docs/guides/overview/models) |
| `supported_parameters` | e.g. `tools` — filter to models supporting a param | [models doc](https://openrouter.ai/docs/guides/overview/models) |
| `sort` | `pricing-low-to-high`, `pricing-high-to-low`, `context-high-to-low`, `throughput-high-to-low`, `latency-low-to-high`, `most-popular` / `top-weekly`, `newest` | [models doc](https://openrouter.ai/docs/guides/overview/models) |

> **Default filter caveat:** when `output_modalities` is omitted, the endpoint returns **text-output models only**. Image/audio/embedding/decision models are excluded by default. For a full catalog, either pass `output_modalities=all` or make targeted calls per modality. Source: [models doc](https://openrouter.ai/docs/guides/overview/models). `[live-fetch 2026-10-18]`: default `/models` returned 471 (text-output); `/models?supported_parameters=tools` returned 376.

### Related endpoints

| Endpoint | Purpose | Source |
| --- | --- | --- |
| `GET /api/v1/model/{author}/{slug}` | Single-model lookup; resolves aliases; `404` if absent | [models doc](https://openrouter.ai/docs/guides/overview/models) |
| `GET /api/v1/models/{author}/{slug}/endpoints` | Per-provider endpoints for a model (`endpoints[]` with provider slug, pricing, `supported_parameters`, uptime, latency, quantization) | [variants doc](https://openrouter.ai/docs/guides/routing/model-variants/overview) |
| `GET /api/v1/models/count` | Total count consistent with list | [models doc](https://openrouter.ai/docs/guides/overview/models) |
| `GET /api/v1/models?use_rss=true` | RSS feed to stay updated on new models | [models doc](https://openrouter.ai/docs/guides/overview/models) |

`[live-fetch 2026-10-18]` per-endpoint object keys:
`name, model_id, model_name, context_length, pricing, provider_name, tag, service_tier, quantization, max_completion_tokens, max_prompt_tokens, supported_parameters, supports_tool_choice{none,auto,required,function}, status, uptime_last_30m/5m/1d, supports_implicit_caching, native_tools, supports_voice_cloning, supports_multiple_audio_references, supports_image_reference, supports_diarization, latency_last_30m, throughput_last_30m`.

### Update cadence

- "Our Models API makes the most important information about all LLMs freely available **as soon as we confirm it**." The schema is "cached at the edge."
- RSS feed available for change notifications.
- Source: <https://openrouter.ai/docs/guides/overview/models>

---

## 4. Per-model parameter support

### How to know which wire params a model accepts

Read `supported_parameters[]` on the model object. It is the authoritative, per-model list of accepted request parameters. Note the docs describe these as "OpenAI-compatible parameters" — routing/preference params are **not** listed here because they are OpenRouter-level, not model-level. Source: <https://openrouter.ai/docs/guides/overview/models>.

### Full observed value set of `supported_parameters`

`[live-fetch 2026-10-18]` — union across all 471 models (26 values):

```
frequency_penalty
include_reasoning
logit_bias
logprobs
max_completion_tokens
max_tokens
min_p
parallel_tool_calls
prediction
presence_penalty
reasoning
reasoning_effort
repetition_penalty
response_format
seed
stop
structured_outputs
temperature
tool_choice
tools
top_a
top_k
top_logprobs
top_p
verbosity
web_search_options
```

### Semantics (from the Parameters doc, <https://openrouter.ai/docs/api_reference/parameters>)

**Sampling / generation params** (model-level; appear in `supported_parameters`):

| Param | Type / range | Default | Notes |
| --- | --- | --- | --- |
| `temperature` | float 0.0–2.0 | 1.0 | randomness |
| `top_p` | float 0.0–1.0 | 1.0 | nucleus sampling |
| `top_k` | int ≥ 0 | 0 (disabled) | not available for OpenAI models |
| `frequency_penalty` | float -2.0–2.0 | 0.0 | scales with occurrences |
| `presence_penalty` | float -2.0–2.0 | 0.0 | flat penalty |
| `repetition_penalty` | float 0.0–2.0 | 1.0 | scales with token probability |
| `min_p` | float 0.0–1.0 | 0.0 | relative to most-likely token |
| `top_a` | float 0.0–1.0 | 0.0 | dynamic top-p |
| `seed` | int | — | deterministic sampling (not guaranteed) |
| `max_tokens` | int ≥ 1 | — | output cap; reasoning models may consume it all |
| `max_completion_tokens` | int ≥ 1 | — | shares `max_tokens` semantics |
| `logit_bias` | map | — | token-id → bias (-100..100) |
| `logprobs` | bool | — | return log probs |
| `top_logprobs` | int 0–20 | — | requires `logprobs: true` |
| `stop` | string\|string[] | — | stop sequences |
| `response_format` | map | — | `{type:"json_object"}` or `{type:"json_schema",…}` |
| `structured_outputs` | bool | — | model can honour json_schema `response_format` |
| `tools` | array | — | OpenAI tool-calling shape |
| `tool_choice` | string\|object | — | `none`/`auto`/`required`/forced function |
| `parallel_tool_calls` | bool | true | |
| `reasoning` | map | — | enable/effort/max tokens/exclude |
| `reasoning_effort` | enum `xhigh,high,medium,low,minimal,none` | — | OpenAI-style effort |
| `include_reasoning` | bool | — | **deprecated** alias for `reasoning.exclude` |
| `prediction` | object `{type:"content",content}` | — | latency optimization |
| `web_search_options` | map | — | native web-search config |
| `verbosity` | enum `low,medium,high,xhigh,max` | medium | Anthropic maps to `output_config.effort` |

**Key behaviour — absent ≠ injected:** "When a sampling parameter is absent from your request, OpenRouter omits it upstream rather than substituting a hardcoded value… The 'Default' listed … is the conventional value, not one OpenRouter injects." Source: [parameters](https://openrouter.ai/docs/api_reference/parameters).

**Unsupported param handling:** "If the chosen model doesn't support a request parameter … then the parameter is ignored. The rest are forwarded to the underlying model API." Source: [API reference](https://openrouter.ai/docs/api_reference/overview).

**Provider-side soft preference:** even with `require_parameters:false`, `tools`, `response_format`/`structured_outputs`, and `verbosity` act as soft routing preferences (prefer providers that support them). Source: [provider routing](https://openrouter.ai/docs/guides/routing/provider-selection).

### Routing/preference params — NOT in `supported_parameters`

These are OpenRouter-level request fields, accepted regardless of the model (they shape routing, not generation):

| Param | Meaning | Source |
| --- | --- | --- |
| `provider` | ProviderPreferences object (see §5) | [provider routing](https://openrouter.ai/docs/guides/routing/provider-selection) |
| `models` | fallback model list (`string[]`) | [API reference](https://openrouter.ai/docs/api_reference/overview) |
| `route` | e.g. `"fallback"` | [API reference](https://openrouter.ai/docs/api_reference/overview) |
| `plugins` | plugin array (`web`, `file-parser`, `response-healing`, `context-compression`, …) | [plugins](https://openrouter.ai/docs/guides/features/plugins) |
| `user` | stable end-user identifier for abuse detection | [API reference](https://openrouter.ai/docs/api_reference/overview) |
| `debug` | `{echo_upstream_body:true}` (streaming only) | [errors](https://openrouter.ai/docs/api_reference/errors-and-debugging) |

---

## 5. Param name mapping

### OpenAI-compatible surface (pass through unchanged)

`messages`, `model`, `stream`, `stop`, `max_tokens`, `max_completion_tokens`, `temperature`, `top_p`, `frequency_penalty`, `presence_penalty`, `seed`, `logit_bias`, `logprobs`, `top_logprobs`, `response_format`, `tools`, `tool_choice`, `parallel_tool_calls`, `n`, `user`, `stream_options`, `prediction`.
Source: <https://openrouter.ai/docs/api_reference/overview>, <https://openrouter.ai/docs/api_reference/parameters>.

### OpenRouter-specific additions

| Field | Type | Purpose |
| --- | --- | --- |
| `models` | `string[]` | Fallback models to try in order when the primary fails |
| `route` | `string` | Routing strategy, e.g. `"fallback"` |
| `provider` | object | ProviderPreferences (below) |
| `transforms` | `string[]` | **Legacy/removed** from the current request schema — replaced by `plugins` |
| `plugins` | `Plugin[]` | Extend/repair requests (`context-compression`, `response-healing`, `file-parser`, …) |
| `top_k` | int | Not in OpenAI — OpenRouter forwards to providers that support it |
| `min_p` | float | OpenRouter-specific sampling |
| `top_a` | float | OpenRouter-specific sampling |
| `repetition_penalty` | float | OpenRouter-specific sampling |
| `reasoning` / `reasoning_effort` / `include_reasoning` | — | Reasoning controls |

Sources: [API reference](https://openrouter.ai/docs/api_reference/overview), [parameters](https://openrouter.ai/docs/api_reference/parameters), [plugins](https://openrouter.ai/docs/guides/features/plugins).

### `provider` (ProviderPreferences) fields

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `order` | string[] | — | Provider slugs to try in order |
| `allow_fallbacks` | bool | true | Allow backup providers |
| `require_parameters` | bool | false | Only providers supporting all request params |
| `data_collection` | `allow`\|`deny` | allow | Training/storage policy filter |
| `zdr` | bool | — | Zero-Data-Retention endpoints only |
| `enforce_distillable_text` | bool | — | Distillation-allowed models only |
| `only` | string[] | — | Allowlist of providers |
| `ignore` | string[] | — | Blocklist of providers |
| `quantizations` | string[] | — | e.g. `["int4","int8"]` |
| `sort` | string\|object | — | `"price"`/`"throughput"`/`"latency"` or `{by,partition}` |
| `preferred_min_throughput` | number\|object | — | tokens/sec (number = p50, or `{p50,p75,p90,p99}`) |
| `preferred_max_latency` | number\|object | — | seconds (same percentile shape) |
| `max_price` | object | — | Cap: `{prompt,completion,request,image}` (blocks if unavailable) |

Source: <https://openrouter.ai/docs/guides/routing/provider-selection>

### Deprecated / renamed names

| Deprecated | Replacement | Source |
| --- | --- | --- |
| `functions` | `tools` | [dify issue #971](https://github.com/langgenius/dify-official-plugins/issues/971) (400 on some providers) |
| `function_call` | `tool_choice` | [dify issue #971](https://github.com/langgenius/dify-official-plugins/issues/971) |
| `include_reasoning` | `reasoning` (it is now an alias) | [parameters](https://openrouter.ai/docs/api_reference/parameters) |
| `transforms` | `plugins` | [message-transforms](https://openrouter.ai/docs/guides/features/message-transforms) |
| `cost_quality_tradeoff` (auto-router) | `cost_tier` plugin setting | [auto router](https://openrouter.ai/docs/guides/routing/routers/auto-router) |
| `:online` variant | `openrouter:web_search` server tool | [plugins](https://openrouter.ai/docs/guides/features/plugins) |
| `modality` (architecture) | `input_modalities`/`output_modalities` | [openrouter-rs source](https://docs.rs/openrouter/latest/src/openrouter/models.rs.html) |
| `rate_limit` (in `/key`) | — (field deprecated, safe to ignore) | [get-current-api-key](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key) |

> **Soulbits relevance:** the engine's `openrouter.go` currently sends `frequency_penalty`, `presence_penalty`, `top_k`, `top_a`, `min_p`, `repetition_penalty`, `seed`, `response_format`, `stop`, `max_tokens`, `max_completion_tokens`, `n`, `temperature`, `top_p` `[engine-code]`. All are valid OpenRouter wire names. The capability catalog should gate each on the model's `supported_parameters` before sending.

---

## 6. Quirks

### Error codes (canonical)

| HTTP | `error_type` | Meaning |
| --- | --- | --- |
| 400 | `invalid_request`, `invalid_prompt`, `context_length_exceeded`, `max_tokens_exceeded`, `token_limit_exceeded`, `string_too_long`, image errors | Bad request / limits |
| 401 | `authentication` | Missing/invalid/revoked key |
| 402 | `payment_required` | Insufficient credits (or in-flight budget) |
| 403 | `permission_denied`, `content_policy_violation`, `refusal` | Guardrail/budget/policy |
| 404 | `not_found` | Unknown model/resource |
| 408 | — | Request timeout |
| 412 | `precondition_failed` | Precondition header |
| 413 | `payload_too_large` | Body too large |
| 422 | `unprocessable` | Semantically invalid |
| 429 | `rate_limit_exceeded` | Rate limited |
| 500 | `server`, `unmapped` | Internal (message masked) |
| 502 | `provider_unavailable` | Upstream invalid/empty response |
| 503 | `provider_overloaded` | Provider overloaded |
| 504 | `timeout` | Provider timeout |

Source: <https://openrouter.ai/docs/api_reference/errors-and-debugging>.

### Credit-exhaustion signals

- `402` with `error.metadata.limit_source`:
  - `openrouter_in_flight_budget` → running/recent requests fill the in-flight budget; **transient**, has `Retry-After`.
  - `openrouter_key_limit` → the key's own credit limit is spent.
  - `openrouter_credits` → account balance can't cover it, or single request too expensive (`reason: weight_exceeds_budget`).
- `403` with `limit_source` ∈ `openrouter_guardrail_budget` | `openrouter_workspace_budget` | `openrouter_key_limit`; metadata carries `scope`, `limit_usd`, `spend_usd`, `resets_at`.
- Check proactively via `GET /api/v1/key` (`limit_remaining`, `effective_budget.remaining_usd`).
- Source: <https://openrouter.ai/docs/api_reference/limits>.

### Model deprecation / aliasing

- **Catalog variants** (separate entries in `/models`, own metadata/pricing):
  - `:free` — free tier, own rate limits/context. Source: [free variant](https://openrouter.ai/docs/guides/routing/model-variants/free).
  - `:batch` — batch-priced version (Batch API). Source: [variants](https://openrouter.ai/docs/guides/routing/model-variants/overview). `[live-fetch 2026-10-18]` 78 such entries.
  - `:thinking` — **deprecated** (use `reasoning` param). Source: [variants](https://openrouter.ai/docs/guides/routing/model-variants/overview).
  - `:extended` — **deprecated**, no model currently offers it. Source: [variants](https://openrouter.ai/docs/guides/routing/model-variants/overview).
- **Routing variants** (accepted on any model id, **not** listed in `/models`, metadata = base model):
  - `:nitro` (throughput sort), `:floor` (price sort), `:exacto` (tool-calling quality sort).
  - `:online` — **deprecated** (use `openrouter:web_search` server tool).
  - Source: [variants](https://openrouter.ai/docs/guides/routing/model-variants/overview).
- **Resolution rule for a requested id:** split on `:`, keep the catalog variant (`:free`/`:batch`/`:thinking`/`:extended`), drop routing variants; result is the catalog `id` to read metadata from. The server resolves this itself on `/model/{…}` and `/models/{…}/endpoints`. Source: [variants](https://openrouter.ai/docs/guides/routing/model-variants/overview).
- **Aliases:** `/api/v1/model/{author}/{slug}` resolves aliases (e.g. `anthropic/claude-3-5-sonnet` → `anthropic/claude-3.5-sonnet`). `~`-prefixed families exist in the live catalog (`~openai`, `~anthropic`, …) — these are tilde-latest alias families. `[live-fetch 2026-10-18]` observed families: `~unbiased`, `~deepseek`, `~openai`, `~z-ai`, `~x-ai`, `~anthropic`, `~google`, `~moonshotai`. A `:free`-suffixed model with no free entry returns `404` on single-model lookup / empty `endpoints` on the endpoints route — treat as unavailable. Source: [variants](https://openrouter.ai/docs/guides/routing/model-variants/overview), [models doc](https://openrouter.ai/docs/guides/overview/models).
- `expiration_date` on the model object carries the deprecation date when set. Source: [models doc](https://openrouter.ai/docs/guides/overview/models).

### BYO-key options (BYOK)

- OpenRouter supports both its own credits and **BYOK** (bring your own provider keys). Keys are encrypted; managed at `https://openrouter.ai/integrations`.
- **Cost:** BYOK inference costs **5% of what the same model/provider would cost normally on OpenRouter**, deducted from OpenRouter credits. Free allowance is plan-dependent (PAYG: `$25,000`/month list-price inference; Enterprise custom).
- BYOK keys are **Prioritized** or **Fallback**; tried before/after OpenRouter shared capacity per routing order.
- Filters per key: `allowed_models`, `allowed_api_key_hashes`, `allowed_user_ids`; shared-capacity behaviour via `is_required` / `is_byok_only`.
- Managed via `POST/GET/PATCH/DELETE /api/v1/byok` (management key required).
- Source: <https://openrouter.ai/docs/guides/overview/auth/byok>.

### Other quirks

- **`/models` is unauthenticated** — a valid-looking models response does NOT prove a key is valid. `[live-fetch 2026-10-18]`.
- **Mid-stream errors**: once `200` headers are sent, failures arrive as an SSE `error` event (with `finish_reason: "error"`) or an error body — the HTTP status stays `200`. Check the body even on `200`. Source: [errors](https://openrouter.ai/docs/api_reference/errors-and-debugging).
- **No content generated**: reasoning models can spend the whole `max_tokens` on reasoning → `finish_reason: "length"`, empty `content`. Source: [errors](https://openrouter.ai/docs/api_reference/errors-and-debugging).
- **Free-tier gates**: `:free` variants are capped (20 req/min; 50 or 1000 req/day by credits purchased). Source: [limits](https://openrouter.ai/docs/api_reference/limits).
- **`pricing` values are strings**, not numbers — parse as decimal, don't `float`-truncate. `[live-fetch 2026-10-18]`.
- **Dynamic routers** (`openrouter/auto`, `openrouter/auto-beta`) report `pricing.prompt = "-1"` and no `top_provider` limits; they accept the widest param set (23) but actual price/model varies per request. Source: [auto router](https://openrouter.ai/docs/guides/routing/routers/auto-router).
- **No embedding models in `/models`**: `[live-fetch 2026-10-18]` found none with `embeddings` output modality; embeddings/rerank are served by separate endpoints and surfaced via `output_modalities=embeddings|rerank`. Source: [models doc](https://openrouter.ai/docs/guides/overview/models).
- **Regional domains** `eu.openrouter.ai` / `us.openrouter.ai` (Business/Enterprise) for in-region routing. Source: [provider routing](https://openrouter.ai/docs/guides/routing/provider-selection).

---

## 7. Catalog seed table

Representative slice of **current** models, all values from `GET /api/v1/models` `[live-fetch 2026-10-18]`.
Capability tags: `chat` (text out), `vision` (image in), `audio-in`, `video-in`, `file-in`, `image-out`, `audio-out`, `reasoning`.

| id | Context | In→Out | Params | Tags | Notes |
| --- | ---: | --- | ---: | --- | --- |
| `openai/gpt-5` | 400,000 | text,image,file→text | 11 | chat, vision, file-in, reasoning | Flagship GPT-5; 128k max out |
| `openai/gpt-5.5` | 1,050,000 | file,image,text→text | 11 | chat, vision, file-in, reasoning | 1M ctx; $5/$30 per M |
| `openai/gpt-5.4` | 1,050,000 | text,image,file→text | 11 | chat, vision, file-in, reasoning | $2.50/$15 per M |
| `openai/gpt-4o` | 128,000 | text,image,file→text | 17 | chat, vision, file-in | Knowledge cutoff 2023-10-31; 16k out |
| `openai/gpt-4o-mini` | 128,000 | text,image,file→text | 17 | chat, vision, file-in | Cheap workhorse |
| `openai/o3` | 200,000 | image,text,file→text | 8 | chat, vision, reasoning | Reasoning model |
| `anthropic/claude-opus-5` | 1,000,000 | text,image,file→text | 11 | chat, vision, file-in, reasoning | $5/$25 per M |
| `anthropic/claude-opus-5.5` | 1,000,000 | text,image,file→text | 11 | chat, vision, file-in, reasoning | $4/$20 per M |
| `google/gemini-4-argon` | 1,048,576 | audio,file,image,text,video→text | 12 | chat, vision, audio-in, video-in, file-in, reasoning | Widest modality set |
| `google/gemini-3.8-flash` | 1,048,576 | text,image,video,file,audio→text | 12 | chat, vision, audio-in, video-in, reasoning | Fast tier |
| `google/gemini-2.5-pro` | 1,048,576 | text,image,file,audio,video→text | 11 | chat, vision, audio-in, video-in, reasoning | |
| `google/gemini-3-pro-image` | 131,072 | image,text→image,text | 11 | image-out, vision | "Nano Banana Pro" |
| `google/gemini-3.1-flash-image` | 131,072 | image,text→image,text | 9 | image-out, vision | "Nano Banana 2" |
| `google/gemini-nano-banana-2.1` | 65,536 | image,text→image,text | 11 | image-out, vision | Image gen/editing |
| `deepseek/deepseek-v4.1-flash-1017` | 1,048,576 | text,image→text | 22 | chat, vision, reasoning | Cheapest large-ctx; $0.15/$0.60 per M |
| `deepseek/deepseek-v3.2` | 163,840 | text→text | 19 | chat, reasoning | Rich param set |
| `deepseek/deepseek-r1` | 64,000 | text→text | 14 | chat, reasoning | 16k max out |
| `x-ai/grok-4.7` | 500,000 | text,image,file→text | 13 | chat, vision, file-in, reasoning | 450k max out |
| `meta-llama/llama-4-maverick` | 1,048,576 | text,image→text | 16 | chat, vision | Open-weights, 16k out |
| `qwen/qwen3-32b` | 131,072 | text→text | 20 | chat, reasoning | Open-weights, broad params |
| `mistralai/mistral-nemo` | 131,072 | text→text | 17 | chat | Very cheap |
| `amazon/nova-pro-v1` | 300,000 | text,image→text | 6 | chat, vision | Narrow param set |
| `perplexity/sonar-pro` | 200,000 | text,image→text | 7 | chat, vision | Web-grounded |
| `openai/gpt-audio` | 128,000 | text,audio→text,audio | 14 | chat, audio-in, audio-out | Speech in/out |
| `google/lyria-3-pro-preview` | 1,048,576 | text,image→text,audio | 5 | audio-out | Music generation |
| `openrouter/auto` | 2,000,000 | text,image,audio,file,video→text,image | 23 | chat, vision, router | Dynamic router; `pricing=-1` |
| `openai/gpt-5.4-image-2` | 272,000 | image,text,file→image,text | 10 | image-out, vision | $8/$15 per M |

**The full list is live-fetchable — that IS the recommendation.** 471 models `[live-fetch 2026-10-18]`; do not hand-maintain. Cache the `/models` response and refresh on the RSS feed signal.

---

## 8. Recommendations

### Exact verify call (key validation)

```
GET https://openrouter.ai/api/v1/key
Authorization: Bearer <key>
```

- `200` → key valid; read `data.limit_remaining`, `data.is_free_tier`, `data.effective_budget.remaining_usd`, `data.free_model_daily_requests`.
- `401` → key invalid/revoked/disabled → surface "Invalid API key".
- Network error / other → "Could not verify".
- **Never** use `GET /models` as the validator (unauthenticated → always 200). `[live-fetch 2026-10-18]`
- `[engine-code]` note: `OpenRouterProvider.ValidateConfig()` currently calls `client.ListModels()` — this does **not** verify the key. Replace/augment with the `/api/v1/key` call. `go-openrouter v1.6.0` (`[engine-code]` `go.mod` line 33) may expose a key-data method; otherwise issue a raw GET.

### Exact models call (live discovery + capability catalog)

```
GET https://openrouter.ai/api/v1/models
```

- Public; no key needed. Optionally `?output_modalities=all` to include image/audio/embedding/decision models, or per-modality calls.
- Optionally `?sort=most-popular` to seed a "recommended" list, and `?supported_parameters=tools` etc. to pre-filter.
- Parse per model: `id`, `canonical_slug`, `name`, `context_length`, `architecture.{input_modalities,output_modalities,tokenizer}`, `pricing.*`, `supported_parameters`, `top_provider.{context_length,max_completion_tokens,is_moderated}`, `reasoning.*`, `supported_voices`, `expiration_date`.
- For per-provider detail (optional), `GET /api/v1/models/{author}/{slug}/endpoints`.

### Capability-source verdict

**Live-only.** OpenRouter's `/models` is the richest, self-describing capability source in the ecosystem and is explicitly designed for production integration and edge caching. There is no separate versioned capability manifest worth embedding. Embed a **fallback seed** (the §7 table) for offline first-run only; treat the live `/models` response as the source of truth and refresh it (RSS signal + periodic poll).

### Engine client notes (`[engine-code]` — for the implementing team)

- `providers/openrouter.go` already sets `HTTP-Referer` and `X-Title` via `go-openrouter` options in `ConnectToBackend()` — keep these.
- `ListModels()` currently maps models to `common.ModelInfo{ID, Name}` only and discards `supported_parameters`, `pricing`, `context_length`, and `architecture`. To build the capability catalog, either (a) upgrade/extend `go-openrouter` to surface `supported_parameters`/`pricing`, or (b) add a raw `GET /api/v1/models` path that unmarshals the full schema. `go-openrouter v1.6.0`'s `Model` already carries `Architecture.InputModalities`/`OutputModalities` (used by the current `filterModels`), so the library exposes at least part of the schema.
- `filterModels()` uses `vision.DefaultFilter` (text in/out) and matches `architecture.input_modalities`/`output_modalities` — correct fields; extend it to gate on `supported_parameters` for the param-support feature.
- Sampling params already wired (`temperature`, `top_p`, `top_k`, `top_a`, `min_p`, `repetition_penalty`, `frequency_penalty`, `presence_penalty`, `seed`, `stop`, `max_tokens`, `max_completion_tokens`, `n`, `response_format`) are all valid OpenRouter names. Gate each on the model's `supported_parameters` before sending; OpenRouter silently ignores unsupported ones but the catalog should reflect true support.
- Validate keys with `GET /api/v1/key` (raw GET), not `ListModels()`.
- TTS/STT/image paths (`RenderSpeech`, `TranscribeAudio`, `GenerateImages`) map to `SpeechRequest`/`TranscriptionRequest`/`Modalities` — these are separate OpenRouter surfaces; the `/models` catalog only covers chat-style entries (audio-out/image-out models appear with the relevant output modality).

---

## Sources

- Key API: <https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key>
- Limits (credits/rate/budgets): <https://openrouter.ai/docs/api_reference/limits>
- Authentication: <https://openrouter.ai/docs/api_reference/authentication>
- API reference (request/response schema, headers): <https://openrouter.ai/docs/api_reference/overview>
- Parameters: <https://openrouter.ai/docs/api_reference/parameters>
- Errors and debugging: <https://openrouter.ai/docs/api_reference/errors-and-debugging>
- Models guide (schema, pagination, filters, single lookup): <https://openrouter.ai/docs/guides/overview/models>
- Model variants: <https://openrouter.ai/docs/guides/routing/model-variants/overview>
- Free variant: <https://openrouter.ai/docs/guides/routing/model-variants/free>
- Provider routing: <https://openrouter.ai/docs/guides/routing/provider-selection>
- Auto router: <https://openrouter.ai/docs/guides/routing/routers/auto-router>
- BYOK: <https://openrouter.ai/docs/guides/overview/auth/byok>
- Plugins: <https://openrouter.ai/docs/guides/features/plugins>
- Message transforms: <https://openrouter.ai/docs/guides/features/message-transforms>
- TS Model type: <https://openrouter.ai/docs/client-sdks/typescript/models/model>
- Rust model struct: <https://docs.rs/openrouter/latest/src/openrouter/models.rs.html>
- Deprecated `functions`/`function_call`: <https://github.com/langgenius/dify-official-plugins/issues/971>
- Live API fetches (`/api/v1/models`, `/api/v1/model/{…}`, `/api/v1/models/{…}/endpoints`, `/api/v1/key`): performed 2026-10-18.
