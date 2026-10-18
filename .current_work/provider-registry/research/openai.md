# Provider Research — OpenAI (platform.openai.com)

Workstream: Soulbits provider registry (R11 research preface)
Scope: key validation, live model listing, model capability catalog, parameter-name mapping
Research date: **2026-10-18**
Author: research subagent (read-only; no code changed)

Primary doc host as of this date is **`developers.openai.com`** (the old
`platform.openai.com/docs` paths redirect there). Endpoint reference lives under
`/api/reference/…`; conceptual guides under `/api/docs/…`. Markdown twins are
available by appending `.md` to any page URL.

Facts taken from our own engine client are tagged **[engine-code]**
(`harmony-link-private/providers/openai.go`, `modules/common/openai.go`,
`config/types.go`).

---

## 1. API basics

| Item | Value | Source |
|---|---|---|
| Base URL | `https://api.openai.com/v1` (all endpoints live under `/v1`) | [API Overview](https://developers.openai.com/api/reference/overview/) |
| Auth header | `Authorization: Bearer <API_KEY>` (HTTP Bearer). Short-lived tokens from workload identity federation are also accepted as Bearer. | [API Overview](https://developers.openai.com/api/reference/overview/) |
| Org scoping header | `OpenAI-Organization: <org_id>` — needed when the key/account belongs to more than one org | [API Overview](https://developers.openai.com/api/reference/overview/) |
| Project scoping header | `OpenAI-Project: <project_id>` — needed with legacy user keys that can reach several projects | [API Overview](https://developers.openai.com/api/reference/overview/) |
| REST API version | `v1`. There is **no client-supplied version header** (unlike Anthropic). Responses carry `openai-version: 2020-10-01`. | [API Overview](https://developers.openai.com/api/reference/overview/) |
| Other response headers | `openai-organization`, `openai-processing-ms`, `x-request-id`; client may send `X-Client-Request-Id` (ASCII, ≤512 chars, else 400) | [API Overview](https://developers.openai.com/api/reference/overview/) |
| Header size budget | Keep total request headers < 64 KiB (custom header values ≤ 60 KiB); oversized headers may fail before reaching the API | [API Overview](https://developers.openai.com/api/reference/overview/) |
| Backwards-compat policy | No breaking changes in major versions "when reasonably possible"; adding optional params/properties is explicitly allowed. **Model prompting behaviour between snapshots is subject to change** — pin snapshot IDs for stable behaviour. | [API Overview](https://developers.openai.com/api/reference/overview/) |

### Key format (prefixes)

OpenAI's own docs do **not** publish a key grammar; the following is the
well-documented third-party/community consensus and matches observed behaviour:

| Prefix | Type | Can call model endpoints? |
|---|---|---|
| `sk-proj-…` | **Project key** (default since mid-2024) | Yes |
| `sk-svcacct-…` | **Service-account key** | Yes |
| `sk-admin-…` | **Org admin key** (Admin API only) | **No** — calling `/chat/completions` returns `403` |
| `sk-…` | **Legacy user key** (no longer issued) | Yes, but being retired — see below |

- Body is a base64url random payload (~155 chars); total length ~165 chars; **no checksum**, so format validation is only a prefix/regex pre-check and real validity requires an API call.
  Sources: [VibeKit — OpenAI API key format](https://vibekit.bot/openai-api-key-format), [Airbyte — OpenAI API Key Explained](https://airbyte.com/agentic-data/openai-api-key).
- **Legacy `sk-` (user) keys are being deactivated by OpenAI on 2026-10-22** (email notice, discussed publicly). After that date only project/service-account/admin keys are valid.
  Source: [OpenAI Community — legacy/user API keys shut off October 22](https://community.openai.com/t/api-organization-legacy-user-api-keys-to-be-shut-off-october-22/1400541).

> **Implication for Soulbits:** users pasting an `sk-admin-…` key will "pass" a naive format check and even a `/v1/models` check (admin keys can list), but every inference call will 403. Validation must not treat "models listed" as "key can run inference".

---

## 2. Key validation

### Recommended verify call

```
GET https://api.openai.com/v1/models
Authorization: Bearer <API_KEY>
```

- **Method/endpoint:** `GET /v1/models` — documented as the canonical listing call, and it is the cheapest account-scoped, **side-effect-free** request.
  Source: [List models reference](https://developers.openai.com/api/reference/resources/models/methods/list/).
- **Expected 2xx shape (200):**
  ```json
  {
    "object": "list",
    "data": [
      { "id": "gpt-6-astra", "object": "model", "created": 1686935002,
        "owned_by": "openai", "shutdown_date": null }
    ]
  }
  ```
  Source: [List models reference](https://developers.openai.com/api/reference/resources/models/methods/list/).
- **Quota cost:** `GET /v1/models` is metadata-only. It consumes **no tokens** and is not billed; it is subject only to request-rate limits. This is the standard "cheapest endpoint" used for BYOK key checks ([VibeKit](https://vibekit.bot/openai-api-key-format) uses exactly this call).

### Failure signals (401 vs 403 vs 429)

| Status | Meaning | `error.type` / `error.code` | Verdict for "is this key valid?" |
|---|---|---|---|
| **401** | Invalid authentication: revoked/typo'd key, wrong org, or key lacking permission for the endpoint | `invalid_request_error` (`invalid_api_key`, `incorrect_api_key`, etc.) | **Invalid** |
| **403** | Region/country not supported, **or** admin key hitting a model endpoint, **or** project IP-allowlist mismatch (401 for IP) | — | **Key is real but not usable for inference** — surface distinctly |
| **429** | Rate limit (`rate_limit_error`) **or** credit exhausted (`credit_balance_exhausted`) **or** spend limit (`organization_spend_limit_exceeded`, `project_spend_limit_exceeded`) | see left | **Valid key** — but cannot currently serve; distinguish from invalid |
| **503** | `service_unavailable_error` / `server_is_overloaded` (model temporarily overloaded) | | Transient — key is fine |

Sources: [Error codes guide](https://developers.openai.com/api/docs/guides/error-codes.md), [Rate limits guide](https://developers.openai.com/api/docs/guides/rate-limits.md).

- **Rate-limit headers** appear on responses (including the validation call): `x-ratelimit-limit-requests`, `x-ratelimit-limit-tokens`, `x-ratelimit-remaining-requests`, `x-ratelimit-remaining-tokens`, `x-ratelimit-reset-requests`, `x-ratelimit-reset-tokens`, plus project-scoped `x-ratelimit-*-project-tokens`. Temporary errors may carry `Retry-After`.
  Source: [Rate limits guide](https://developers.openai.com/api/docs/guides/rate-limits.md).
- Note: `/v1/models` validates **authentication**, not **authorization for a specific model**. A restricted project key can list models yet be denied on a model it has no access to; the definitive check for "can I use model X" is a minimal call to that model's endpoint.

---

## 3. Model listing

```
GET https://api.openai.com/v1/models
GET https://api.openai.com/v1/models/{model}   # single model
```

Sources: [List models](https://developers.openai.com/api/reference/resources/models/methods/list/), [Retrieve model](https://developers.openai.com/api/reference/resources/models/methods/retrieve/).

### Full response shape

```json
{
  "object": "list",
  "data": [
    {
      "id": "gpt-6-astra",        // string — model identifier used in requests
      "object": "model",           // always "model"
      "created": 1686935002,       // Unix seconds
      "owned_by": "openai",        // owning organization
      "shutdown_date": "2026-10-23" // optional string "YYYY-MM-DD" or null
    }
  ]
}
```

### Fields per model

| Field | Type | Notes |
|---|---|---|
| `id` | string | Model identifier |
| `created` | number | Unix seconds |
| `object` | `"model"` | Constant |
| `owned_by` | string | Usually `openai`; `system`/org for fine-tunes |
| `shutdown_date` | string \| null | **New field (present in Oct 2026 docs)** — announced shutdown date, or `null` |

### Capability metadata

**There is none.** The list endpoint exposes only the five fields above.
There is **no** context window, no modalities, no `supported_parameters`, no
capability flags — nothing that tells you whether a model does chat vs
embedding vs TTS. The community has asked for exactly this and it has not been
added ([community thread](https://community.openai.com/t/expose-model-capabilities-in-the-v1-models-api-response/1314117)).

### Pagination

**No pagination.** `GET /v1/models` returns the entire `data` array in one
response; there are no `after`/`limit`/`has_more` fields (contrast with
Anthropic's Models API, which does paginate).

### What the list contains

The list is **org/account-wide and noisy**: it includes current models *and*
many legacy/deprecated ones still callable until their shutdown date. The
`shutdown_date` field is the only machine-readable signal for "this is going
away". Models the key cannot actually invoke may still appear.

---

## 4. Per-model parameter support

### Where it is documented

- **Chat Completions create reference** — states outright: *"Parameter support can differ depending on the model used… Parameters that are only supported for reasoning models are noted below. For the current state of unsupported parameters in reasoning models, refer to the reasoning guide."* ([Chat resource / Create chat completion](https://developers.openai.com/api/reference/resources/chat.md))
- **Reasoning models guide** — the authoritative source for which params reasoning models accept, effort values, and the `pro` mode ([Reasoning models](https://developers.openai.com/api/docs/guides/reasoning.md)).
- **Per-model pages** — each model page (`/api/docs/models/<id>.md`) carries an **Endpoints** support matrix (Chat Completions / Responses / Realtime / Embeddings / Image generation / Speech / Transcription / Moderation …), a **Supported features** list (`streaming`, `structured_outputs`, `function_calling`, `image_input`, `web_search`, `prompt_caching`, …), a **Supported tools** list, **input/output modalities**, and the **context window / max output**.
  Example: [gpt-6-astra](https://developers.openai.com/api/docs/models/gpt-6-astra.md), [gpt-image-2.5-sunburst](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst.md).

### Queryable via API?

**No.** Capability/param support is **not** exposed by any API endpoint. It
exists only as documentation prose. For Soulbits this means OpenAI's Tier-1
"live discovery" yields nothing beyond model IDs; capability must come from our
static catalog (Tier 2).

### Universal vs model-gated (Chat Completions)

**Broadly accepted (subject to model):** `messages`, `model`, `temperature`,
`top_p`, `n`, `stream`, `stream_options`, `stop`, `max_completion_tokens`,
`frequency_penalty`, `presence_penalty`, `logit_bias`, `logprobs`,
`top_logprobs`, `seed`, `response_format`, `tools`, `tool_choice`,
`parallel_tool_calls`, `metadata`, `store`, `service_tier`, `verbosity`,
`safety_identifier`, `prompt_cache_key`.

**Model-gated:**

| Parameter | Gate |
|---|---|
| `reasoning_effort` | Reasoning models only. Values `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`; **model-dependent subsets**. |
| `max_tokens` | **Deprecated**; *"not compatible with o-series models"* — use `max_completion_tokens`. |
| `stop` | *"Not supported with latest reasoning models `o3` and `o4-mini`."* |
| `modalities` / `audio` | Audio-capable models only (`gpt-audio-1.5`, `gpt-4o-audio-preview`, …). |
| `web_search_options` | Search-capable models only. |
| `prediction` | Predicted-Outputs-capable models. |
| `prompt_cache_options` | **`gpt-5.6` and later only.** |
| `n > 1` | Many reasoning models do not support multiple choices. |

Sources: [Create chat completion](https://developers.openai.com/api/reference/resources/chat.md), [Reasoning models](https://developers.openai.com/api/docs/guides/reasoning.md).

### Notable per-model constraints from the reasoning guide

- **GPT-6 Astra** does **not** support `reasoning.effort = none` (returns HTTP 400).
- **GPT-6.1 Sol** supports neither `none` nor `minimal`; defaults to `medium`.
- **Chat Completions does not support function calling with GPT-6 Astra or GPT-6.1 Sol** — use the Responses API. **GPT-6 Luna** supports Chat Completions function calling **only when `reasoning_effort = none`**.
- `reasoning.mode: "pro"` (Responses only) exists for GPT-5.6 / GPT-6 families.
- Reasoning tokens are billed as output tokens and occupy the context window.
  Source: [Reasoning models](https://developers.openai.com/api/docs/guides/reasoning.md).

### `top_k`

**Not an OpenAI parameter at all** (no `top_k`, no `top_a`, no
`repetition_penalty`). OpenAI uses `temperature` / `top_p` /
`frequency_penalty` / `presence_penalty`. The catalog's param-name mapping for
OpenAI should therefore declare `top_k` **unsupported**.

---

## 5. Param name mapping (wire-name quirks)

| Concept | Chat Completions wire name | Responses API wire name | Notes |
|---|---|---|---|
| Output token cap | `max_completion_tokens` (current) / `max_tokens` (**deprecated**, incompatible with o-series) | `max_output_tokens` | Our config exposes both `MaxTokens` and `MaxCompletionTokens` — see §8. |
| Reasoning effort | `reasoning_effort` (top-level enum) | `reasoning.effort` (object) | Values now include `none`, `minimal`, `xhigh`, `max`. |
| Reasoning mode | *(none)* | `reasoning.mode` (`standard`\|`pro`) | Responses only; GPT-5.6/GPT-6. |
| Structured output | `response_format` (`{type:"json_schema"\|"json_object"\|"text"}`) | `text.format` (`ResponseFormatTextConfig`) | Different nesting. |
| Verbosity | `verbosity` (top-level) | `text.verbosity` | |
| End-user id | `user` (**deprecated**) | `user` (deprecated) | Replaced by `safety_identifier` + `prompt_cache_key`. |
| Cache retention | `prompt_cache_retention` (**deprecated**) | `prompt_cache_retention` (deprecated) | Replaced by `prompt_cache_options.ttl` (min lifetime, currently only `"30m"`). |
| Tools | `tools` + `tool_choice` | `tools` + `tool_choice` | `functions`/`function_call` **deprecated** in Chat. |
| Sampling | `temperature`, `top_p`, `seed`, `logit_bias` | `temperature`, `top_p` (no `logit_bias`) | |
| Stop sequences | `stop` | *(no direct equivalent)* | |
| Audio output | `modalities:["text","audio"]` + `audio:{voice,format}` | `modalities` | |
| Service tier | `service_tier` (`auto`\|`default`\|`flex`\|`scale`\|`priority`\|`fast`; `ultrafast` access-controlled) | `service_tier` | |

Sources: [Create chat completion](https://developers.openai.com/api/reference/resources/chat.md), [Create a response](https://developers.openai.com/api/reference/resources/responses/methods/create.md), [Reasoning models](https://developers.openai.com/api/docs/guides/reasoning.md).

### Deprecated params still accepted

`max_tokens`, `user`, `prompt_cache_retention`, `functions`, `function_call`,
`response_format` (image `url`/`b64_json` legacy modes), image `style`/`user`.
Accepting them works today but produces no benefit and some (e.g. `max_tokens`
on o-series) error outright.

---

## 6. Quirks (things that break naive clients)

1. **401 vs 403 vs 429 semantics.** `401` = invalid/revoked/permission-denied-for-endpoint. `403` = unsupported region, admin-key-calling-models, or Daybreak access programs. `429` = *valid* key that is throttled or out of credit — **must not be reported as "invalid"**.
   Source: [Error codes](https://developers.openai.com/api/docs/guides/error-codes.md).
2. **Billing 429s don't recover by retrying.** `credit_balance_exhausted`, `organization_spend_limit_exceeded`, `project_spend_limit_exceeded`, `organization_usage_limit_exceeded` require user action; only temporary rate limits should be retried (respect `Retry-After`).
   Source: [Error codes](https://developers.openai.com/api/docs/guides/error-codes.md).
3. **`slow_down` (429, `rate_limit_error`) vs `server_is_overloaded` (503, `service_unavailable_error`).** The semantics changed recently: rapid traffic increases now return `429 slow_down`; model overload returns `503 server_is_overloaded`. Handle both `429` and `503`.
   Source: [Rate limits](https://developers.openai.com/api/docs/guides/rate-limits.md).
4. **Key types.** `sk-admin-…` keys list models fine but **cannot call model endpoints** (403). Legacy `sk-` user keys are deactivated **2026-10-22**. Format alone cannot confirm validity (no checksum).
   Sources: [VibeKit](https://vibekit.bot/openai-api-key-format), [community](https://community.openai.com/t/api-organization-legacy-user-api-keys-to-be-shut-off-october-22/1400541).
5. **`/v1/models` is account-wide, not capability-scoped, and not paginated.** It returns legacy models too; `shutdown_date` is the only deprecation signal. Never treat presence in the list as "usable for inference".
6. **Reasoning-model param minefield.** `max_tokens` breaks on o-series; `stop` unsupported on `o3`/`o4-mini`; `none` effort is 400 on GPT-6 Astra; Chat Completions function calling unsupported on GPT-6 Astra / 6.1 Sol.
   Source: [Reasoning models](https://developers.openai.com/api/docs/guides/reasoning.md).
7. **Snapshots vs aliases.** `gpt-5.6` aliases to `gpt-5.6-sol`. Behaviour can shift between snapshots; the docs advise pinning snapshots and running evals.
   Source: [API Overview](https://developers.openai.com/api/reference/overview/) / [gpt-5.6-sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol.md).
8. **No regional endpoints.** Unlike Azure OpenAI, `api.openai.com` is single-host. **EU data residency** is a processing option (not a separate host), offered on some models (e.g. `gpt-6-luna`) with a 10% premium; eligible via Standard/Fast/Flex/Batch.
   Source: [gpt-6-luna](https://developers.openai.com/api/docs/models/gpt-6-luna.md).
9. **Platform churn.** Assistants API retired 2026-08-26; Evals API and reusable prompt objects shut down 2026-11-30; `/v1/audio/translations` retires 2027-02-26. Build only on Responses / Chat Completions / Images / Audio / Embeddings.
   Source: [Deprecations](https://developers.openai.com/api/docs/deprecations.md).
10. **`n` semantics.** Charged for all choices; many reasoning models only support `n = 1`.
11. **Streaming errors.** Pre-stream HTTP errors apply before SSE starts; an error after streaming begins arrives as a stream event — don't blindly replay.
    Source: [Rate limits](https://developers.openai.com/api/docs/guides/rate-limits.md).

---

## 7. Catalog seed table (current lineup, 2026-10-18)

Capability tags: `chat` (text in/out), `vision` (image in), `reasoning`,
`embedding`, `image` (gen/edit), `tts`, `stt`, `audio` (audio in/out),
`moderation`, `realtime`, `open-weights`.
"Context" = context window / max input tokens where documented.

### Text / chat / reasoning (text + image in → text out)

| Model ID | Tags | Context | Notable params | Notes |
|---|---|---|---|---|
| `gpt-6-astra` | chat, vision, reasoning | 1,050,000 (max in 922,000; 128,000 out) | `reasoning.effort` low→max (**no `none`**); streaming, structured_outputs, function_calling (Responses), image_input, web_search, prompt_caching | Flagship. Chat Completions supported but **no function calling** there. |
| `gpt-6.1-sol` | chat, vision, reasoning | 1,050,000 / 128,000 | effort **no `none`/`minimal`**, default `medium` | Near-Astra, lower cost. |
| `gpt-6-sol` | chat, vision, reasoning, coding | 1,050,000 / 128,000 | effort `none`→`max` | Coding/agentic. |
| `gpt-6-luna` | chat, vision, reasoning | 1,050,000 / 128,000 | effort `none`→`max` | Cheapest GPT-6. Chat Completions function calling only with `reasoning_effort=none`. EU residency. |
| `gpt-5.6-sol` | chat, vision, reasoning | 1,050,000 / 128,000 | effort `none`→`max`; `reasoning.mode` pro | GPT-5.6 flagship (`gpt-5.6` alias). |
| `gpt-5.6-terra` | chat, vision, reasoning | 1,050,000 / 128,000 | effort `none`→`max` (default medium) | Mini tier. |
| `gpt-5.6-luna` | chat, vision, reasoning | 1,050,000 / 128,000 | effort `none`→`max` | Cheapest GPT-5.6 (family ctx). |
| `gpt-5.5`, `gpt-5.5-pro` | chat, vision, reasoning | 1.05M class / 128,000 | effort; `reasoning.mode` pro on `-pro` | `gpt-5.5` defaults to `medium`. |
| `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-pro` | chat, vision, reasoning | (family) | effort | `gpt-5.4-nano` deprecated 2027-04-01. |
| `gpt-5.2`, `gpt-5.2-pro`, `gpt-5.1`, `gpt-5` | chat, vision, reasoning | (family) | effort | Older; `gpt-5.1` deprecated 2027-04-01. |
| `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano` | chat, vision | (family) | non-reasoning | **Deprecated** — shutdown 2027-01-14. |
| `gpt-4o`, `gpt-4o-mini` | chat, vision | 128,000 | non-reasoning | **Deprecated** — shutdown 2027-01-14. |
| `o3`, `o3-pro`, `o4-mini`, `o1` | chat, vision, reasoning | (o-series) | `reasoning_effort`; `stop` **unsupported** on o3/o4-mini | Snapshots shutdown 2026-10-23 / 2026-12-11. |
| `gpt-5.6-cyber`, `gpt-rosalind-research` | chat, reasoning (specialized) | — | — | Access-controlled (Daybreak / life-sciences). |
| `gpt-oss-120b`, `gpt-oss-20b` | chat, open-weights | — | — | Apache-2.0 open weights. |
| `chat-latest`, `gpt-5.3-chat-latest` | chat | — | — | ChatGPT-internal; **not recommended for API use**. |

### Embeddings

| Model ID | Tags | Max input | Dims | Notes |
|---|---|---|---|---|
| `text-embedding-3-large` | embedding | 8,192 tokens (per-input; 300k total per request) | 3072 (supports `dimensions`) | Most capable. |
| `text-embedding-3-small` | embedding | 8,192 | 1536 | `dimensions` supported. |
| `text-embedding-ada-002` | embedding | 8,192 | 1536 | Legacy. |

Params: `input`, `model`, `dimensions` (3-series+), `encoding_format`
(`float`/`base64`), `user`. Source: [Create embeddings](https://developers.openai.com/api/reference/resources/embeddings/methods/create.md).

### Image generation / editing

| Model ID | Tags | Params | Notes |
|---|---|---|---|
| `gpt-image-2.5-sunburst` | image | `size` (arbitrary WxH, /16, ratio 1:3–3:1, ≤3840x2160), `quality` low/medium/high/**xhigh/max**/auto, `background`, `output_format` png/jpeg/webp, `n`, `moderation`, `input_fidelity` (edit) | Most capable; **default for edits**. |
| `gpt-image-2.5-flare` | image | same | Fastest everyday generation. |
| `gpt-image-2` (+ `-2026-04-21`) | image | same | — |
| `gpt-image-1.5`, `gpt-image-1`, `gpt-image-1-mini` | image | — | **Deprecated** — shutdown 2026-12-01. |

Endpoints: `POST /v1/images/generations`, `POST /v1/images/edits`
(`/v1/images/variations` **retired**). GPT-image models always return
`b64_json`. Source: [Images reference](https://developers.openai.com/api/reference/resources/images.md).

### Text-to-speech

| Model ID | Tags | Params | Notes |
|---|---|---|---|
| `gpt-4o-mini-tts` | tts | `input` (≤4096 chars), `voice`, `response_format` (mp3/opus/aac/flac/wav/pcm), `speed` (0.25–4.0), `instructions`, `stream_format` (sse/audio) | Current recommended TTS. 13 voices (`marin`/`cedar` best). |
| `tts-1`, `tts-1-hd` | tts | subset (9 voices; no `instructions`) | **Deprecated** — shutdown 2027-01-06. |

Endpoint: `POST /v1/audio/speech`. Source: [Create speech](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create.md), [Text to speech guide](https://developers.openai.com/api/docs/guides/text-to-speech.md).

### Speech-to-text (transcription)

| Model ID | Tags | Notes |
|---|---|---|
| `gpt-transcribe` | stt | File + realtime-input; `languages` detection. $0.0045/min. |
| `gpt-live-transcribe` | stt, realtime | Streaming deltas; $0.017/min. |
| `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, `gpt-4o-transcribe-diarize` | stt | **Deprecated** — shutdown 2027-02-26. |
| `whisper-1` | stt | **Deprecated** — shutdown 2027-02-26. |

Endpoint: `POST /v1/audio/transcriptions` (multipart). Source: [Create transcription](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create.md), [Deprecations](https://developers.openai.com/api/docs/deprecations.md).

### Audio (audio in/out) & Realtime

| Model ID | Tags | Notes |
|---|---|---|
| `gpt-audio-1.5` | audio, chat | Chat Completions audio in/out; 128,000 ctx; 16,384 out. |
| `gpt-live-1`, `gpt-realtime-2.1`, `gpt-realtime-2.1-mini`, `gpt-realtime-2`, `gpt-realtime-translate` | audio, realtime | Realtime / Live APIs. |
| `gpt-realtime-whisper`, `gpt-realtime-1.5` | audio, realtime | Older/deprecated audio paths. |

### Moderation

| Model ID | Tags | Notes |
|---|---|---|
| `omni-moderation-latest` | moderation, vision | Free; text + image input. Endpoint `POST /v1/moderations`. |

---

## 8. Recommendations

### Exact verify call

```
POST /api/providers/verify  →  engine performs:
GET https://api.openai.com/v1/models
Headers: Authorization: Bearer <key>
```

Interpretation to return in `{valid, detail}`:

| Upstream | `valid` | `detail` |
|---|---|---|
| `200` | `true` | `"ok"` (+ optional org from `openai-organization` header) |
| `401` | `false` | `"invalid_api_key"` |
| `403` | `false` (with `reason: "forbidden"`) | `"forbidden"` — key is real but lacks access / region blocked / admin key |
| `429` | `true` (with `reason: "rate_limited"`/`"quota"`) | pass through `error.code` |
| `5xx`/timeout | `false` (transient) | `"upstream_unavailable"` |

Do **not** collapse 403/429 into "invalid". No billing cost; safe to call on
save.

### Exact models call

```
POST /api/providers/models → engine performs:
GET https://api.openai.com/v1/models
```

- Parse `data[]`, surface `{id, created, owned_by, shutdown_date}`.
- **Filter**: drop `owned_by != "openai"` if we only want first-party, and
  optionally hide entries with a past `shutdown_date`. Do **not** rely on the
  response for capability tags.
- Augment each id from our static catalog (Tier 2) to produce the picker's
  `{id, label, context, capabilities, source:"catalog"}`.

### Capability-source verdict

**For OpenAI, live discovery yields zero capability data.** `/v1/models`
returns only `id/created/object/owned_by/shutdown_date`. Therefore:

- Tier 1 (live) = **model IDs + shutdown dates only**.
- Tier 2 (static catalog) = **the only source** of context window, modalities,
  endpoint support, supported params, and param-name mapping.
- The catalog must be **hand-curated from the per-model doc pages**
  (`/api/docs/models/<id>.md`), which are the authoritative structured source
  (Endpoints matrix, Supported features/tools, modalities, ctx/max-out).
- Param-name mapping for OpenAI must record: `max_tokens`→`max_completion_tokens`
  (deprecated→current), `response_format`→`text.format`,
  `reasoning_effort`→`reasoning.effort`, and mark `top_k` unsupported.

### What our engine client already does right

- **[engine-code]** `ValidateConfig()` calls `client.Models.List()` and returns
  its error — this is already the correct cheapest side-effect-free check
  (`providers/openai.go:104-112`). It maps cleanly onto `POST /api/providers/verify`.
- **[engine-code]** `ListModels()` (`providers/openai.go:276-290`) already
  fetches `/v1/models` and returns `{ID, Name}` — a fine base for
  `POST /api/providers/models`.
- **[engine-code]** `ConnectToBackend()` builds the SDK client from the API key
  only; no bogus base URL for OpenAI (correct — OpenAI is a fixed host).

### What needs attention (cites)

1. **[engine-code] Stale hard-coded model allow-lists.**
   `modules/common/openai.go` defines `OpenAITextInputModels` /
   `OpenAITextOutputModels` that stop at `gpt-5*` and omit the entire
   **GPT-5.6 / GPT-6** families, `gpt-5.2`, `gpt-5.5`, etc. `filterModels()`
   (`providers/openai.go:292-307`) drops any live model not in those lists, so
   today it would silently hide `gpt-6-astra` and friends. The two lists are
   byte-identical (copy-paste), so they also don't actually distinguish
   vision-capable from text-only. **Replace with the capability catalog.**
2. **[engine-code] `max_tokens` vs `max_completion_tokens`.**
   `buildParams()` sets `MaxTokens` and `MaxCompletionTokens` from config
   (`providers/openai.go:175-180`). For reasoning models `max_tokens` is
   incompatible — the catalog should gate it off and route to
   `max_completion_tokens`.
3. **[engine-code] `reasoning_effort` enum drift.**
   `params.ReasoningEffort = shared.ReasoningEffort(...)`
   (`providers/openai.go:210-212`) relies on the SDK enum; current API values
   include `none`, `minimal`, `xhigh`, `max`. Validate against the catalog
   rather than trusting the enum.
4. **[engine-code] `response_format` passthrough.**
   `buildParams()` injects `response_format` via `extraFields`
   (`providers/openai.go:204-209`) — valid for Chat Completions, but Responses
   uses `text.format`. Fine for now (we call Chat Completions) but should be
   documented in the mapping.
5. **[engine-code] `n` edge case.** `if p.n >= 0 { params.N = ... }`
   (`providers/openai.go:186-188`) will send `n: 0` when the field is 0, which
   is invalid; and many reasoning models reject `n > 1`.
6. **[engine-code] Deprecated hard-coded models.**
   - `TranscribeAudio` / `DetectVoiceActivity` hard-code
     `openaigo.AudioModelWhisper1` (`providers/openai.go:434,452`) — `whisper-1`
     is deprecated (shutdown 2027-02-26); move to `gpt-4o-transcribe` /
     `gpt-transcribe`.
   - `GenerateImages` / selfie paths default to `GPTImage1`
     (`providers/openai.go:490,562`) — `gpt-image-1` is deprecated; default to
     `gpt-image-2.5-flare` (fast) / `gpt-image-2.5-sunburst` (quality).
7. **[engine-code] Chat Completions only.** The client uses
   `Chat.Completions.New` throughout. Note that **GPT-6 Astra and GPT-6.1 Sol
   do not support function calling on Chat Completions**, and OpenAI
   recommends Responses for reasoning models — a catalog flag
   ("responses_recommended"/"chat_function_calling:false") should surface this
   in the UI.

### Suggested catalog row shape for OpenAI

```json
{
  "gpt-6-luna": {
    "capabilities": ["chat", "vision", "reasoning"],
    "context_window": 1050000,
    "max_output_tokens": 128000,
    "endpoints": { "chat_completions": true, "responses": true, "batch": true },
    "supported_params": ["messages","model","max_completion_tokens","temperature",
      "top_p","reasoning_effort","response_format","tools","tool_choice",
      "stream","service_tier","seed","verbosity","safety_identifier"],
    "unsupported_params": ["max_tokens","top_k","logit_bias"],
    "param_map": { "max_tokens": "max_completion_tokens" },
    "notes": "Chat Completions function calling only with reasoning_effort=none"
  }
}
```

---

## Sources

All URLs retrieved 2026-10-18.

- API Overview — https://developers.openai.com/api/reference/overview/
- List models — https://developers.openai.com/api/reference/resources/models/methods/list/
- Retrieve model — https://developers.openai.com/api/reference/resources/models/methods/retrieve/
- Create chat completion (Chat resource) — https://developers.openai.com/api/reference/resources/chat.md
- Create a response (Responses) — https://developers.openai.com/api/reference/resources/responses/methods/create.md
- Create embeddings — https://developers.openai.com/api/reference/resources/embeddings/methods/create.md
- Create speech — https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create.md
- Create transcription — https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create.md
- Images — https://developers.openai.com/api/reference/resources/images.md
- Error codes — https://developers.openai.com/api/docs/guides/error-codes.md
- Rate limits — https://developers.openai.com/api/docs/guides/rate-limits.md
- Reasoning models — https://developers.openai.com/api/docs/guides/reasoning.md
- Text to speech — https://developers.openai.com/api/docs/guides/text-to-speech.md
- Models catalog — https://developers.openai.com/api/docs/models.md and /all.md, /compare.md
- Deprecations — https://developers.openai.com/api/docs/deprecations.md
- Model pages — /api/docs/models/{gpt-6-astra, gpt-6-luna, gpt-5.6-sol, gpt-5.6-terra, gpt-image-2.5-sunburst, gpt-image-2.5-flare, gpt-audio-1.5, gpt-transcribe, gpt-live-transcribe, gpt-4o-mini-tts, text-embedding-3-large, omni-moderation-latest}.md
- Key format (third-party) — https://vibekit.bot/openai-api-key-format ; https://airbyte.com/agentic-data/openai-api-key
- Legacy key shutdown — https://community.openai.com/t/api-organization-legacy-user-api-keys-to-be-shut-off-october-22/1400541
- Capability-metadata request — https://community.openai.com/t/expose-model-capabilities-in-the-v1-models-api-response/1314117

### Engine files read [engine-code]

- `harmony-link-private/providers/openai.go`
- `harmony-link-private/modules/common/openai.go`
- `harmony-link-private/config/types.go` (`OpenAIProviderConfig`)
