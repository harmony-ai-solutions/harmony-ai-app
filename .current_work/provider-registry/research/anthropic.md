# Anthropic Claude API — Provider Research (Soulbits provider registry)

**Provider:** Anthropic Claude API (`api.anthropic.com`)
**Research date:** October 2026
**Scope:** key validation, live model listing, and an engine-embedded model capability catalog.
**Sources:** official Claude Platform docs (`platform.claude.com/docs/...`) plus the engine client `harmony-link-private/providers/anthropic.go` (marked `[engine-code]`). Every external claim cites a doc URL; see [Sources](#sources).

> **Headline finding (changes the plan):** As of this research date `GET /v1/models` is **not thin**. It returns `max_input_tokens`, `max_tokens`, a `line` grouping, and a rich `capabilities` object (thinking types, effort levels, image/PDF input, server tools, structured outputs, batch, citations). The engine can drive most of the catalog from the live Models API. A small static catalog is still needed only as an *overlay* for the few things `/v1/models` does **not** expose (sampling-param deprecation, `stop_sequences`, prefill support, effort *default*, forced-tool-use support). Details in §3, §4, §8.

---

## 1. API basics

### 1.1 Base URL and required headers
- REST base URL: `https://api.anthropic.com` (Messages API `POST /v1/messages`; Models API `GET /v1/models`). [docs: api/overview]
- Headers on every request [docs: api/overview], [docs: manage-claude/authentication]:

| Header | Value | Required |
|---|---|---|
| `Authorization` | `Bearer <token>` — API key or short-lived WIF access token | Yes, **unless** `x-api-key` is set |
| `x-api-key` | The API key from Console | No — **legacy fallback** for `Authorization`, still supported |
| `anthropic-version` | API version, e.g. `2023-06-01` | **Yes** |
| `content-type` | `application/json` | Yes |
| `anthropic-workspace-id` | `wrkspc_...` workspace ID | Required for multi-workspace keys; optional otherwise |
| `anthropic-beta` | comma-separated beta names | Only for beta features |

**Auth-header note for the "test key" button:** the modern primary header is `Authorization: Bearer`, and `x-api-key` is now described as a *legacy fallback*. Both work against `api.anthropic.com`. However, `x-api-key` is the convention most Anthropic-compatible gateways expect, and the engine's official Go SDK (`option.WithAPIKey`) sends `x-api-key`. For the direct Anthropic provider we can keep `x-api-key`; document that `Authorization: Bearer` is the current preferred form. [docs: api/overview], [docs: manage-claude/authentication]

### 1.2 `anthropic-version` semantics
- A **single, stable version string** (`2023-06-01`) that must be sent. Only two versions have ever existed: `2023-01-01` (initial) and `2023-06-01` (current, introduced incremental SSE). [docs: api/versioning]
- The version is a **compatibility contract**: Anthropic preserves existing input/output parameters, but may *add* optional inputs, *add* output values, change error conditions, and *add* enum variants. It explicitly warns "the `type` values will grow over time". So the engine must treat `error.type` and response fields as open sets. [docs: api/versioning], [docs: api/errors]

### 1.3 Key formats (`sk-ant-…` prefixes)
Confirmed from docs and Console pages:

| Prefix | Meaning | Source |
|---|---|---|
| `sk-ant-api03-…` | Standard Claude Console API key, 3rd-generation format (`api01`/`api02` were earlier). Body is a long random base64url string; **no checksum**, so validity is only confirmable via an API call. | [docs: manage-claude/authentication] (Go example `sk-ant-api03-…`), [docs: manage-claude/admin-api-keys] |
| `sk-ant-admin01-…` | **Admin API key** (Console Admin keys page). Calls Admin/Analytics/Compliance/Spend-Limits/Usage/Rate-Limits APIs, **not** Messages. | [docs: manage-claude/admin-api-keys] |
| `sk-ant-api01-…` | **Claude Enterprise** key created at `claude.ai` admin settings (scoped Admin/Compliance/Analytics/Spend-Limits). | [docs: manage-claude/admin-api-keys] |
| `sk-ant-oat01-…` | OAuth token (`claude setup-token`); bills against a Pro/Max subscription rather than Console credit. | [web: vibekit.bot key-format explainer] (secondary source) |
| `sk-ant-sid01-…` | claude.ai session key. | secondary / community sources |

**Important correction to the brief:** there is **no "starter vs tier" distinction encoded in the key prefix**. `api03` denotes *format generation*, not tier. Usage tier is an **organization-level** property (see §6.5), and the real *key* distinction is **key type** — personal / service account / workspace (legacy) — not a prefix [docs: manage-claude/authentication]. Practical rule for validation UX: any `sk-ant-api03-` key is a candidate for the Messages/Models API; `sk-ant-admin01-` and `sk-ant-api01-` are admin/enterprise keys that will typically fail against `/v1/messages` (or succeed only for admin endpoints).

### 1.4 Beta headers
- `anthropic-beta: feature-name-YYYY-MM-DD`; multiple names comma-separated **or** the header repeated. Unknown/inaccessible beta → `400 invalid_request_error`. [docs: api/beta-headers]
- **Deprecation note:** on the Models methods the `anthropic-beta` param is explicitly marked *Deprecated* — "to use beta features, call the beta models methods (`client.beta.models`) instead." [docs: api/models/list], [docs: api/models/retrieve]
- Example current beta names relevant here: `context-1m-2025-08-07`, `interleaved-thinking-2025-05-14`, `output-300k-2026-03-24`, `thinking-display-updates-2026-08-18`, `thinking-binding-controls-2026-08-01`. [docs: api/models/list]
- For a *plain* model list / key test, **no beta header is needed**. Do not send one.

### 1.5 Org / workspace scoping
- `anthropic-workspace-id` header selects the workspace. Required **only** when the key can act on more than one workspace; a single-workspace key may omit it (and if sent, it must match). [docs: api/overview], [docs: manage-claude/authentication]
- If an **identity-linked** (personal/service-account) key that is *not* workspace-scoped omits the header, the API returns `400 invalid_request_error`: `"anthropic-workspace-id is required when authenticating with an identity-linked API key…"`. [docs: manage-claude/authentication]
- Responses carry `anthropic-organization-id` and `anthropic-workspace-id` headers — useful to display "which org/workspace this key resolved to" in the UI. [docs: api/overview]

---

## 2. Key validation ("is this API key valid?")

### 2.1 Cheapest side-effect-free call
**`GET /v1/models`** — a metadata read. It performs no inference and produces no token billing; Anthropic bills per input/output token on the **Messages** API, not on model metadata. It is still subject to **RPM** rate limits (it is an API request), but consumes no ITPM/OTPM. [docs: api/overview] (endpoint list + billing/token model), [docs: api/rate-limits]

- Recommended: `GET https://api.anthropic.com/v1/models?limit=1`
  - headers: `x-api-key: <key>` (or `Authorization: Bearer <key>`) + `anthropic-version: 2023-06-01`.
  - `limit=1` keeps the payload minimal (default page size is 20). [docs: api/models/list]
- This is exactly what the engine already does in `ValidateConfig` — **but without `limit`**, so it pulls 20 models. Add `limit=1`. `[engine-code]` (`anthropic.go:105-108`)

> Do **not** validate by calling `POST /v1/messages`: it costs tokens, requires a valid model, and can 400 on unrelated param gating. The Models call is strictly cheaper and side-effect-free.

### 2.2 2xx success shape
`200` → `{ "data": [ …ModelInfo… ], "first_id": …, "has_more": bool, "last_id": … }`. A `200` with any well-formed body means the credential authenticated. [docs: api/models/list]

### 2.3 Failure signals (map these in the UI)
Error body shape is always `{ "type": "error", "error": { "type", "message" }, "request_id" }`. [docs: api/errors]

| HTTP | `error.type` | Meaning for validation |
|---|---|---|
| **401** | `authentication_error` | **Key invalid** — malformed, revoked, or expired. Definitive "bad key". [docs: api/errors] |
| **403** | `permission_error` | Key is **valid but not permitted** for the resource (e.g. admin key on Messages, scope mismatch). Treat as "valid but wrong key type", not "invalid". [docs: api/errors], [docs: manage-claude/admin-api-keys] |
| **429** | `rate_limit_error` | Key is **valid but throttled** or over spend cap. For a tier spend-cap, `error.details.error_code == "enforced_spend_limit_reached"` and there is **no `retry-after`**. [docs: api/rate-limits], [docs: api/errors] |
| **400** | `invalid_request_error` | Request problem — e.g. identity-linked key missing `anthropic-workspace-id`. Key is valid. [docs: manage-claude/authentication] |
| **402** | `billing_error` | Billing/payment problem; key is valid. [docs: api/errors] |
| **404** | `not_found_error` | Path/resource wrong (not a key problem). [docs: api/errors] |
| **500 / 529 / 504** | `api_error` / `overloaded_error` / `timeout_error` | Transient server-side; **do not** mark key invalid. [docs: api/errors] |

**UI rule of thumb:** `401` ⇒ invalid key. `403` ⇒ valid key, wrong type/scope. `429` ⇒ valid key, over limit. `400` ⇒ valid key, request/config issue. `5xx`/network ⇒ unknown, retry.

### 2.4 Quota implications of the validation call
- Counts against **RPM** only (not token limits). One call is negligible. [docs: api/rate-limits]
- New/low-history orgs may sit in the **Evaluation tier** with lower starting limits, then auto-upgrade — a `429` on a fresh account is possible and does **not** imply a bad key. [docs: api/rate-limits]
- SDK auto-retry: the official SDK retries transient failures (rate limits, 5xx, connection errors) with exponential backoff, honoring `retry-after`. For a *validation* button you likely want to **disable retries** (`option.WithMaxRetries(0)` in Go) so the user gets a fast, unambiguous answer. [docs: api/errors]

---

## 3. Model listing (`GET /v1/models`)

### 3.1 Request
- Query params [docs: api/models/list]:
  - `after_id` / `before_id` — cursor by model object ID.
  - `lifecycle` — array of `"active" | "deprecated" | "retired"` (up to 3). **Default: active + deprecated.** `retired` only appears if explicitly requested.
  - `limit` — 1–1000, **default 20**.
- Headers: `anthropic-version` (optional per doc, but send it), `anthropic-workspace-id` (as needed). `anthropic-beta` is **deprecated** on this method. [docs: api/models/list]

### 3.2 Response shape
`data[]` of `ModelInfo` [docs: api/models/list], [docs: api/models/retrieve]:

| Field | Type | Notes |
|---|---|---|
| `id` | string | e.g. `claude-opus-5-5`. Unique model identifier. |
| `type` | `"model"` | Always. |
| `display_name` | string | Human-readable, e.g. "Claude Opus 5.5". |
| `created_at` | RFC 3339 | Release time. |
| `deprecated_at` | RFC 3339 \| null | Null while `active`. |
| `retires_at` | RFC 3339 \| null | Scheduled retirement; null while active. |
| `lifecycle` | `"active"｜"deprecated"｜"retired"` | Current stage. |
| `line` | `"haiku"｜"sonnet"｜"opus"｜"fable"｜"mythos"｜null` | Model family grouping. **Read this instead of parsing `id`.** |
| `max_input_tokens` | number \| null | **Context window.** |
| `max_tokens` | number \| null | **Max value for the `max_tokens` request param** (max output). |
| `capabilities` | object \| null | See §3.3. |

Top-level cursor fields: `first_id`, `last_id`, `has_more`. [docs: api/models/list]

> ⚠️ The **example JSON in the docs is placeholder garbage** (`max_input_tokens: 0`, `max_tokens: 0`, `line: "haiku"` on `claude-opus-5-5`, `deprecated_at` populated on an `active` model). Trust the **field schema**, not the example values. [docs: api/models/list]

### 3.3 `capabilities` object (this is the big one)
Keys are **always present for all known capabilities** [docs: api/models/list]:

- `batch.supported` — Batch API.
- `citations.supported` — citation generation.
- `code_execution.supported` — whether code run in the code-execution tool can call the request's other tools (programmatic tool calling). *Distinct from* `server_tools.code_execution`.
- `context_management` — `supported`, plus strategy flags `clear_thinking_20251015`, `clear_tool_uses_20250919`, `compact_20260112`.
- `effort` — `supported`, plus per-level flags `low`, `medium`, `high`, `xhigh`, `max`.
- `image_input.supported` — **vision** (accepts image content blocks).
- `pdf_input.supported` — accepts PDF content blocks.
- `server_tools` — `supported`, `web_search.supported`, `code_execution.supported`.
- `structured_outputs.supported` — JSON mode / strict tool schemas.
- `thinking` — `supported`, and `types.{adaptive,enabled,disabled}.supported`.
  - `disabled.supported` is **false exactly when** a request sending `thinking:{type:"disabled"}` gets a 400; it is **true on a model that does not support thinking at all**. [docs: models/overview]

### 3.4 Pagination
- **Cursor scheme is `after_id`/`before_id` + `has_more`/`first_id`/`last_id`**, **not** the newer `page`/`next_page` scheme used by some other list endpoints. [docs: api/models/list], [docs: api/overview]
- To page forward: pass `last_id` as `after_id`. Backward: `first_id` as `before_id`.

### 3.5 What is *missing* from `/v1/models` (the catalog gap)
The Models API does **not** report:
- whether `temperature` / `top_p` / `top_k` are accepted (they are deprecated on 4.7+; §4);
- `stop_sequences` support;
- assistant **prefill** support;
- the **default** effort level (only *which levels exist*);
- forced-tool-use (`tool_choice: any|tool`) support;
- streaming/tool-use generally (assumed universal).

These are the only fields that require a static catalog overlay. [docs: api/models/list], [docs: model-deprecations], [docs: build-with-claude/thinking]

---

## 4. Per-model parameter support

### 4.1 Universal (all models)
`model`, `messages`, `max_tokens` (**required**), `system`, `stop_sequences`, `stream`, `metadata`, `tools` + `tool_choice` (tool use), `thinking` (shape varies), `output_config`, `service_tier`, `cache_control`, `container`, `diagnostics`, `inference_geo`, `speed`. [docs: api/messages/create]

- **`max_tokens` is required and has no server default.** `minimum: 0`; setting `0` pre-warms the prompt cache without generating output. Different models have different maxima. [docs: api/messages/create]
- `system` is a **top-level** parameter (string or array of `TextBlockParam`), *not* a message role. [docs: api/messages/create]

### 4.2 Model-gated
| Param | Gating | Source |
|---|---|---|
| `temperature`, `top_p`, `top_k` | **Deprecated on Claude 4.7+ and Claude Mythos Preview**: setting a **non-default value returns 400**. Recommended: omit them and steer via prompting. | [docs: model-deprecations] |
| `thinking.type` | Per-model: `adaptive` vs `enabled` (manual extended) vs `disabled` vs `between_tools`. Claude 4.7+ reject `enabled` (400). 4.6 deprecated `enabled`. 4.5-and-earlier support only `enabled` (reject `adaptive`, 400). `disabled` rejected on Fable 5.1, Mythos 5.1, Fable 5, Mythos 5, Opus 5.5, Mythos Preview. Sonnet 5.5 uses `between_tools` instead of `disabled`. | [docs: build-with-claude/thinking], [docs: build-with-claude/extended-thinking], [docs: api/errors] |
| `thinking.budget_tokens` | Required for `type:"enabled"`; **≥1024 and < `max_tokens`** (exception: interleaved thinking). | [docs: api/messages/create], [docs: build-with-claude/extended-thinking] |
| `output_config.effort` | Only some models; levels (`low/medium/high/xhigh/max`) vary. Query via `capabilities.effort`. Defaults: Opus 5.5 & Haiku 5.5 `medium`; Fable 5.1, Sonnet 5.5 `high`. | [docs: models/overview], [docs: api/messages/create] |
| `output_config.format` (structured outputs) | Model-gated; query via `capabilities.structured_outputs`. | [docs: api/models/list] |
| assistant **prefill** | **Not supported on Claude 4.6+ and Mythos Preview** → 400 `invalid_request_error` ("This model does not support assistant message prefill…"). | [docs: api/errors], [docs: api/messages/create] |
| forced tool use (`tool_choice: any|tool`) | Not supported on Opus 5.5, Sonnet 5.5, Fable 5.1, Mythos 5.1 → 400. `auto`/`none` always OK. | [docs: api/errors] |
| `speed: "fast"` | Model-gated; may need `fast-mode-2026-02-01` beta. | [docs: api/messages/create] |
| server tools (`web_search`, `code_execution`) | Query via `capabilities.server_tools`; org admin settings can still disable. | [docs: models/overview] |

### 4.3 Where documented / can it be queried?
- Documented in: Messages create reference (params), Errors page (validation errors), Thinking page (per-model table), Model deprecations (parameter deprecations), Models overview.
- **Queryable now:** `thinking.types.*`, `effort.*`, `image_input`, `pdf_input`, `server_tools`, `structured_outputs`, `batch`, `citations`, plus `max_input_tokens` / `max_tokens` / `line` — **all via `/v1/models`**.
- **Not queryable:** temperature/top_p/top_k deprecation, `stop_sequences`, prefill, effort default, forced-tool-use. ⇒ small static overlay needed.

---

## 5. Param name mapping (wire names + engine client)

### 5.1 Wire names (Anthropic Messages API)
```
max_tokens      number    REQUIRED, minimum 0            # max output; 0 = cache pre-warm
model           string    e.g. "claude-opus-5-5"
system          string | TextBlockParam[]                # TOP-LEVEL, not a message role
messages        MessageParam[]                           # roles: user | assistant (strictly alternating)
stop_sequences  string[]
temperature     number                                   # deprecated on 4.7+ (400 if non-default)
top_p           number                                   # deprecated on 4.7+
top_k           integer                                  # deprecated on 4.7+
stream          boolean
metadata        { user_id?: string }
tools           ToolUnion[]
tool_choice     { type: "auto"|"any"|"tool"|"none", name?, disable_parallel_tool_use? }
thinking        { type: "adaptive"|"enabled"|"disabled"|"between_tools",
                  budget_tokens?: int (>=1024, < max_tokens, only with "enabled"),
                  display?: "summarized"|"omitted" }
output_config   { effort?: "low"|"medium"|"high"|"xhigh"|"max",
                  format?: { type: "json_schema", schema: {...} } }
service_tier    "auto" | "standard_only"
speed           "standard" | "fast"
cache_control   { type: "ephemeral", ttl?: "5m"|"1h" }
```
[docs: api/messages/create]

### 5.2 Notes / gotchas for our engine client
`[engine-code]` (`providers/anthropic.go`, `config/types.go:533`, `database/models/provider_anthropic.go`):

- The engine already models the correct wire set: config fields `Model`, `MaxTokens`, `Temperature`, `TopP`, `TopK`, `StopSequences`, `SamplingPresetName`, `ExtraParams`; DB columns `model`, `max_tokens`, `temperature`, `top_p`, `top_k`, `stop_sequences`, `sampling_preset_name`, `extra_params`. It correctly maps `System` as a top-level `[]anthropic.TextBlockParam` and `StopSequences` (not "stop tokens"). `[engine-code]`
- `defaultMaxTokens = 4096` is applied when config `MaxTokens <= 0`, since Anthropic requires `max_tokens` positive. Keep this, but note the model-specific maxima (128K for current models) are now available from `/v1/models.max_tokens`. `[engine-code]` (`anthropic.go:150-157`)
- **⚠️ Sampling-param bug risk on Claude 4.7+:** the client sets `params.Temperature` whenever `p.temperature >= 0`, `params.TopP` whenever `p.topP >= 0`, and `params.TopK` whenever `p.topK > 0`. Because the Go zero value is `0`, a config with untouched sampling will send `temperature: 0` and `top_p: 0` — both **non-default** — which returns **400** on Claude 4.7+ / Mythos Preview. Fix options: gate these three params per-model (omit on 4.7+ unless explicitly set), or represent "unset" as a negative sentinel and only send when the user opted in. `[engine-code]` (`anthropic.go:200-212`) + [docs: model-deprecations]
- `ExtraParams` are injected via `option.WithJSONSet(k, v)` — a good escape hatch for `thinking`, `output_config`, `metadata`, `service_tier`, `speed` without new struct fields. `[engine-code]` (`anthropic.go:214-217`)
- **`ListModels` does not paginate** — it uses only `page.Data` from the first page (default 20). Should loop on `has_more` / `last_id` → `after_id`. `[engine-code]` (`anthropic.go:317-337`) + [docs: api/models/list]
- **Vision detection is a string heuristic:** `isAnthropicVisionModel` matches `"claude-3"` / `"claude-4"`. This misses `claude-5*`, `claude-fable-*`, `claude-mythos-*` and will misclassify future IDs. Replace with `capabilities.image_input.supported` from the Models API. `[engine-code]` (`anthropic.go:362-367`) + [docs: api/models/list]
- SDK: `github.com/anthropics/anthropic-sdk-go v1.46.0`. The Models API and the `capabilities` object are surfaced through `client.Models.List(...)`. `[engine-code]` (`go.mod:15`, `go.sum:22`)
- `common.ModelInfo` today is only `{ID, Name, Description}` — too thin to carry context window / max output / capability tags. The catalog workstream will need to extend it (or add a parallel struct). `[engine-code]` (`modules/common/client.go:19-23`)

---

## 6. Quirks

### 6.1 Error type taxonomy (open set)
`error.type` values seen in docs: `invalid_request_error` (400), `authentication_error` (401), `billing_error` (402), `permission_error` (403), `not_found_error` (404), `conflict_error` (409), `request_too_large` (413), `rate_limit_error` (429), `api_error` (500), `timeout_error` (504), `overloaded_error` (529). Error body: `{type:"error", error:{type,message}, request_id}`. Values **may grow** per the versioning policy. Go SDK: one type `*anthropic.Error`; branch on `StatusCode`. [docs: api/errors], [docs: api/versioning]

### 6.2 Model aliasing (the `-latest` assumption is outdated)
- **Claude 4.6+ uses dateless IDs that are *pinned snapshots*, NOT evergreen aliases.** `claude-sonnet-4-6` is not "latest Sonnet 4.6"; it *is* the snapshot. Anthropic does not mutate an existing ID's weights. [docs: model-ids-and-versions]
- **Pre-4.6 models have convenience aliases**: e.g. `claude-haiku-4-5` → `claude-haiku-4-5-20251001`; `claude-sonnet-4-5` → most recent dated snapshot. [docs: models/haiku-4-5/overview], [docs: model-ids-and-versions]
- **There is no `claude-*-latest` suffix in the current docs.** That was a Claude 3-era convention (e.g. `claude-3-5-sonnet-latest`); those models are **retired**. Do not build alias logic around `-latest`. [docs: model-deprecations], [web: totalum deprecation recap]
- Retired aliases stop resolving and return `404 not_found_error`. [docs: model-deprecations]

### 6.3 Context-window differences between models
- **1M-token context** (default, no beta header, standard pricing): Fable 5.1, Mythos 5.1, Fable 5, Mythos 5, Opus 5.5, Opus 5, Opus 4.8, Opus 4.7, Opus 4.6, Sonnet 5.5, Sonnet 5, Sonnet 4.6, Haiku 5.5, Mythos Preview. **Max output 128K.** [docs: build-with-claude/context-windows], [docs: models/overview]
- **200K-token context:** Opus 4.5, Sonnet 4.5, Haiku 4.5 (and earlier). Haiku 4.5 max output **64K**. [docs: build-with-claude/context-windows], [docs: models/haiku-4-5/overview]
- Batch API raises max output to **300K** for several models with `output-300k-2026-03-24`. [docs: models/overview]
- Overflow behavior: if input alone exceeds the window → `400 invalid_request_error` ("prompt is too long"). On 4.5+ if input + `max_tokens` exceeds the window, the request is accepted and stops with `stop_reason: "model_context_window_exceeded"`. [docs: build-with-claude/context-windows]
- Tokenizer change at Opus 4.7: 1M ≈ 555k words (was ≈750k words on the older tokenizer). [docs: models/overview]

### 6.4 Credit / tier limits that affect validation calls
- Tiers: **Evaluation** (low-history/new, below standard limits, auto-upgrades) → **Start** ($500/mo cap) → **Build** ($1,000) → **Scale** ($200,000) → **Custom** (no cap). [docs: api/rate-limits]
- Messages rate limits are per model-class in RPM / ITPM / OTPM. **Cache reads generally do not count toward ITPM** (except Haiku 3.5). Models API calls count toward RPM only. [docs: api/rate-limits]
- Hitting the tier spend cap returns **429 `rate_limit_error`** with **no `retry-after`** and `error.details.error_code: "enforced_spend_limit_reached"`. A user-set spend limit instead returns **400 `invalid_request_error`**. Distinguish these in the UI. [docs: api/rate-limits]
- Response headers expose live limits: `anthropic-ratelimit-requests-*`, `-input-tokens-*`, `-output-tokens-*` (RFC 3339 reset times). Could power a "quota" display. [docs: api/rate-limits]

### 6.5 Streaming quirks
- SSE uses **named events** with **incremental deltas** (since `2023-06-01`); no `data: [DONE]`. [docs: api/versioning]
- Errors can occur **after a `200`** mid-stream (SSE `error` event) — normal HTTP error handling does not apply. [docs: api/errors]
- Thinking streams as `thinking_delta` events then a single `signature_delta` before `content_block_stop`; with `display:"omitted"` the thinking delta carries an empty string. Text streams after. [docs: build-with-claude/thinking]
- Streaming is recommended for long `max_tokens`; the SDKs warn that non-streaming requests expected to exceed a 10-minute timeout are rejected. [docs: api/errors]

### 6.6 Other quirks worth encoding
- Thinking blocks from the latest assistant turn must be passed back **unmodified, in order**; edits → 400. New accounts (created ≥ 2026-08-31) enforce `thinking.block_binding` signature/prefix checks. [docs: api/errors], [docs: build-with-claude/thinking]
- Consecutive same-role messages are **combined** into one turn server-side. [docs: api/messages/create]
- `max_tokens: 0` is legal (cache pre-warm) but cannot be combined with `thinking.budget_tokens`. [docs: api/messages/create], [docs: build-with-claude/extended-thinking]
- The Messages reference schema lists `role` enum as `"user" | "assistant" | "system"`, yet the prose states "there is no `system` role for input messages." Treat this as a **doc inconsistency**; always use the top-level `system` param. [docs: api/messages/create]

---

## 7. Catalog seed table (current Claude lineup, Oct 2026)

**All current/active models accept text + image input and tool use** ("All current models support text and image input, text output, multilingual capabilities, vision, and tool use.") [docs: models/overview]. PDF input is reported per model via `capabilities.pdf_input`.

`T` = temperature/top_p/top_k. "Adaptive" = `thinking.type: adaptive`; "Extended" = `thinking.type: enabled` + `budget_tokens`.

| Model ID | Line | Context | Max out | Thinking | T params | Notes |
|---|---|---|---|---|---|---|
| `claude-fable-5-1` | fable | 1M | 128K | Adaptive (always on) | 400 if set | Effort default `high`; frontier reasoning. No `disabled`. No forced tool use. |
| `claude-mythos-5-1` | mythos | 1M | 128K | Adaptive (always on) | 400 if set | Cyber/bio research, trusted-access. No `disabled`. No forced tool use. |
| `claude-fable-5` | fable | 1M | 128K | Adaptive (always on) | 400 if set | No `disabled`. |
| `claude-mythos-5` | mythos | 1M | 128K | Adaptive (always on) | 400 if set | No `disabled`. |
| `claude-opus-5-5` | opus | 1M | 128K | Adaptive (always on) | 400 if set | Effort default `medium`. No `disabled`, no forced tool use, no prefill. |
| `claude-opus-5` | opus | 1M | 128K | Adaptive | 400 if set | `disabled` OK at effort ≤ `high`. |
| `claude-opus-4-8` | opus | 1M | 128K | Off by default; Adaptive opt-in | 400 if set | `disabled` OK. |
| `claude-opus-4-7` | opus | 1M | 128K | Off by default; Adaptive opt-in | **400 if set** | First model with the tokenizer/1M change. |
| `claude-opus-4-6` | opus | 1M | 128K | Off; Adaptive opt-in | OK | Extended thinking **deprecated** (still succeeds). |
| `claude-opus-4-5` (`-20251101`) | opus | 200K | 128K | Extended only | OK | `adaptive` → 400. The only extended-only model that also supports `effort`. |
| `claude-sonnet-5-5` | sonnet | 1M | 128K | Adaptive | 400 if set | No `disabled` (use `between_tools`); no forced tool use; no prefill. Effort default `high`. |
| `claude-sonnet-5` | sonnet | 1M | 128K | Adaptive | 400 if set | `disabled` OK. Context awareness. |
| `claude-sonnet-4-6` | sonnet | 1M | 128K | Off; Adaptive opt-in (extended deprecated) | OK | Context awareness; 300K output on Batches (beta). |
| `claude-sonnet-4-5` (`-20250929`) | sonnet | 200K | 128K | Extended only | OK | **DEPRECATED** — retires 2026-11-30. |
| `claude-haiku-5-5` | haiku | 1M | 128K | Adaptive | 400 if set | `disabled` OK at effort ≤ `high`. Effort default `medium`. Long prompts >100K cost more. |
| `claude-haiku-4-5` (`-20251001`) | haiku | 200K | **64K** | Extended only | OK | No `effort`; no interleaved thinking; no context-window tags. |
| `claude-mythos-preview` | mythos | 1M | 128K | Adaptive (both modes) | OK | **DEPRECATED** (since 2026-06-09). |

**Retired (do not list):** `claude-opus-4-1`, `claude-opus-4`, `claude-sonnet-4`, `claude-3-7-sonnet`, `claude-3-5-haiku`, `claude-3-haiku`, `claude-3-5-sonnet`, `claude-3-opus`, `claude-2.x`, `claude-instant-*`, `claude-1.x`. [docs: model-deprecations]

**Sources for the table:** [docs: models/overview], [docs: model-deprecations], [docs: build-with-claude/thinking] (per-model thinking table), [docs: build-with-claude/context-windows], [docs: build-with-claude/extended-thinking], [docs: models/sonnet-4-6/overview], [docs: models/haiku-4-5/overview].

> **Note on "capability tags" (chat/vision/tool-use):** for the current lineup these are effectively **all true** (text, vision, tool use). The meaningful differentiators are: context window, max output, thinking mode, sampling-param acceptance, effort support/levels, structured outputs, server tools, and batch. Pull those from `/v1/models.capabilities`.

---

## 8. Recommendations

### 8.1 Exact verify (key test) call
```
GET https://api.anthropic.com/v1/models?limit=1
x-api-key: <key>                 # or: Authorization: Bearer <key>
anthropic-version: 2023-06-01
anthropic-workspace-id: <wrkspc_...>   # only if the key is multi-workspace
```
- **Disable SDK retries** for a snappy, unambiguous result (Go: `option.WithMaxRetries(0)`).
- Map: `200` valid · `401` invalid · `403` valid/wrong-scope · `429` valid/throttled (check `details.error_code == "enforced_spend_limit_reached"`) · `400` valid but config issue (often missing workspace header) · `5xx`/network unknown.
- Never validate with `POST /v1/messages` (costs tokens).

### 8.2 Exact models call
```
GET https://api.anthropic.com/v1/models?limit=1000&lifecycle=active
x-api-key: <key>
anthropic-version: 2023-06-01
```
- Or paginate: follow `has_more`, pass `last_id` as `after_id`.
- Map into the engine model list: `ID = id`, `Name = display_name`, `Description = display_name` (as today), **plus** new fields for `max_input_tokens`, `max_tokens`, `line`, `capabilities`, `lifecycle`.

### 8.3 Capability-source verdict
**Revised from the brief's expectation.** `/v1/models` is **rich, not thin**:
- **Use the live Models API as the primary source** for: context window (`max_input_tokens`), max output (`max_tokens`), model family (`line`), vision (`image_input`), PDF input (`pdf_input`), thinking modes (`thinking.types.*`), effort levels (`effort.*`), server tools, structured outputs, batch, citations, and lifecycle/deprecation.
- **Still keep a small static catalog overlay** for the gaps the API does not cover:
  1. `temperature`/`top_p`/`top_k` deprecation (400 on 4.7+ / Mythos Preview) — needed to stop the engine sending non-default sampling.
  2. `stop_sequences` support (currently assumed universal).
  3. assistant **prefill** support (false on 4.6+).
  4. forced-tool-use (`tool_choice any|tool`) support (false on Opus 5.5, Sonnet 5.5, Fable 5.1, Mythos 5.1).
  5. the **default** effort level per model (the API only lists which levels exist).
  6. human-facing capability tags / UI hints and offline fallback when no key is configured.
- Design: **live fetch first, static overlay for the six gaps above, keyed by `line` + generation.** Cache the live list (it changes rarely) and refresh on demand.

### 8.4 Engine client notes (`[engine-code]`, `providers/anthropic.go`)
1. `ValidateConfig` → add `limit=1` to `Models.List`. (`anthropic.go:105-108`)
2. Fix the sampling-param gating so `temperature`/`top_p`/`top_k` are **omitted** (not sent as `0`) on Claude 4.7+ / Mythos Preview. Consider a tri-state "unset" representation. (`anthropic.go:200-212`)
3. Add pagination to `ListModels` (`has_more` / `last_id` → `after_id`). (`anthropic.go:317-337`)
4. Replace `isAnthropicVisionModel` string matching with `capabilities.image_input.supported`. (`anthropic.go:362-367`)
5. Extend `common.ModelInfo` (or add a provider-capability struct) to carry context window, max output, and capability flags — today it is `{ID, Name, Description}`. (`modules/common/client.go:19-23`)
6. Keep `ExtraParams` → `option.WithJSONSet` for `thinking` / `output_config` / `metadata` / `service_tier` / `speed`. (`anthropic.go:214-217`)
7. `defaultMaxTokens = 4096` is a sane floor, but current models allow up to 128K output — surface `max_tokens` from `/v1/models` in the config UI. (`anthropic.go:150-157`)
8. SDK `v1.46.0` already supports `client.Models.List` and the `capabilities` object; verify the generated struct fields before wiring the catalog. (`go.mod:15`)

---

## Sources

Official Claude Platform docs (fetched Oct 2026):
- API overview — https://platform.claude.com/docs/en/api/overview
- List Models — https://platform.claude.com/docs/en/api/models/list
- Get a Model — https://platform.claude.com/docs/en/api/models/retrieve
- Create a Message — https://platform.claude.com/docs/en/api/messages/create
- Errors — https://platform.claude.com/docs/en/api/errors
- Versions — https://platform.claude.com/docs/en/api/versioning
- Beta headers — https://platform.claude.com/docs/en/api/beta-headers
- Rate limits — https://platform.claude.com/docs/en/api/rate-limits
- Authentication — https://platform.claude.com/docs/en/manage-claude/authentication
- Admin API keys — https://platform.claude.com/docs/en/manage-claude/admin-api-keys
- Models overview — https://platform.claude.com/docs/en/about-claude/models/overview
- Model IDs and versioning — https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions
- Model deprecations — https://platform.claude.com/docs/en/about-claude/model-deprecations
- Extended thinking — https://platform.claude.com/docs/en/build-with-claude/extended-thinking
- Thinking — https://platform.claude.com/docs/en/build-with-claude/thinking
- Context windows — https://platform.claude.com/docs/en/build-with-claude/context-windows
- Claude Sonnet 4.6 overview — https://platform.claude.com/docs/en/models/sonnet-4-6/overview
- Claude Haiku 4.5 overview — https://platform.claude.com/docs/en/models/haiku-4-5/overview
- Get your Claude API key — https://platform.claude.com/docs/en/get-api-key

Secondary (key-prefix detail, corroboration only):
- Anthropic API key format explainer — https://vibekit.bot/anthropic-api-key-format
- Claude 4 deprecation recap — https://www.totalum.app/blog/claude-4-deprecation-migration-2026

Engine source (`[engine-code]`):
- `harmony-link-private/providers/anthropic.go`
- `harmony-link-private/config/types.go:533` (`AnthropicProviderConfig`)
- `harmony-link-private/database/models/provider_anthropic.go`
- `harmony-link-private/modules/common/client.go:19` (`ModelInfo`)
- `harmony-link-private/go.mod:15` (`anthropic-sdk-go v1.46.0`)
