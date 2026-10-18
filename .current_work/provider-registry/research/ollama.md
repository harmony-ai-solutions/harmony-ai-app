# Ollama — Provider Research

> Provider workstream: **Soulbits Provider Registry** (test button + live enumeration + engine capability catalog).
> Provider under study: **Ollama** (self-hosted, default `http://host:11434`).
> Research date: **October 2026**. External claims cite the official docs (`docs.ollama.com`) and the upstream repo (`github.com/ollama/ollama`).
>
> Legend:
> - `[engine-code]` = fact read from `harmony-link-private` (the Go engine / sidecar).
> - `[app-code]` = fact read from `harmony-ai-app` (React Native app).
> - `[ollama-source]` = fact read from the upstream Ollama Go source (URL cited), i.e. richer than the OpenAPI spec on the doc site.
> - Everything else cites a doc URL.

---

## 0. TL;DR for the workstream

- **Keyless by design.** The local server at `http://localhost:11434` requires **no authentication**. There is **no server-side `OLLAMA_API_KEY` / `OLLAMA_API_KEYS` gate** — `OLLAMA_API_KEY` is the *client-side cloud key* for `https://ollama.com`, not a local-server setting. Any auth on a local box is a reverse proxy the user bolted on. ([authentication](https://docs.ollama.com/api/authentication), [issue #8536](https://github.com/ollama/ollama/issues/8536))
- **Validation = reachability + version.** `GET /api/version` → `{"version":"0.12.6"}` is the cheapest, side-effect-free probe. It also *proves it is actually Ollama* (not some other HTTP server squatting the port).
- **Two API surfaces, different richness.** Native REST (`/api/*`) is the rich one; the OpenAI-compatible surface (`/v1/*`) is a **lossy subset**. For our use case (rich model metadata + full sampling params), **use the native surface**.
- **Capability source verdict: rich live.** `GET /api/tags` + `POST /api/show` expose `details.family`/`families`, `parameter_size`, `quantization_level`, `context_length`, `embedding_length`, and (modern releases) a per-model **`capabilities[]` array** with an authoritative enum (`completion`, `tools`, `insert`, `vision`, `embedding`, `thinking`, `image`, `audio`, `decision`). This is *far* richer than any generic OpenAI-compatible server and anchors our auto-detect tier. `[ollama-source]`
- **Biggest engine gap:** the engine has **no Ollama chat client at all**. `ollama` exists only as a **RAG embedding** provider and as CRUD rows. Chat/cognition/movement would fail with `unsupported backend provider: ollama`. `[engine-code]`
- **Capabilities enum is authoritative and small** — prefer it over family heuristics when present. `[ollama-source]`

---

## 1. API basics

### Base URL

- Local server: `http://localhost:11434` (native API at `/api`, OpenAI-compat at `/v1`). Cloud (not our target): `https://ollama.com/api` and `https://ollama.com/v1`. ([introduction](https://docs.ollama.com/api/introduction))
- Default bind is `127.0.0.1:11434`. `[engine-code]` stores a single `base_url` for Ollama (`database/models/provider_ollama.go` → `OllamaProviderConfig{BaseURL}`); `[app-code]` default is `http://localhost:11434` (`src/constants/moduleDefaults.ts`).

### The two API surfaces

| Surface | Base | Endpoints relevant to us | Verdict |
|---|---|---|---|
| **Native REST** | `{base}/api` | `GET /api/version`, `GET /api/tags`, `POST /api/show`, `POST /api/chat`, `POST /api/generate`, `POST /api/embed`, `POST /api/embeddings`, `GET /api/ps`, plus model mgmt (`/api/create`, `/api/copy`, `/api/pull`, `/api/push`, `/api/delete`) | **Use this.** Rich metadata + full option set. |
| **OpenAI-compatible** | `{base}/v1` | `POST /v1/chat/completions`, `POST /v1/completions`, `GET /v1/models`, `GET /v1/models/{model}`, `POST /v1/embeddings`, `POST /v1/responses` (added v0.13.3) | Lossy subset. `GET /v1/models` omits everything useful. |
| **Anthropic-compatible** | `{base}` (appends `/v1/messages`) | `POST /v1/messages` | Tangential; not for this workstream. |

Sources: [introduction](https://docs.ollama.com/api/introduction), [OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility), [api index](https://docs.ollama.com/llms.txt).

- Creating/deleting models requires a **local** server (cloud can't). Not relevant to us.
- The `/v1` surface supports a subset of OpenAI fields — notably **no `top_k`, `min_p`, `repeat_penalty`, `num_ctx`, `keep_alive`, `tool_choice`, `logit_bias`, `n`, `user`** ([OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)). This is the crux of §5.

### Auth options

- **Local API: no authentication.** "The local API at `http://localhost:11434` does not require authentication." ([authentication](https://docs.ollama.com/api/authentication))
- **`OLLAMA_API_KEY` is a *client* env var for the cloud API** (`Authorization: Bearer $OLLAMA_API_KEY` against `https://ollama.com/...`), not a server-side setting. ([authentication](https://docs.ollama.com/api/authentication))
- **There is no built-in server API-key auth.** Feature request [#8536](https://github.com/ollama/ollama/issues/8536) (Jan 2025) asked for an `OLLAMA_API_KEY` server gate; maintainers closed it and repeatedly steer users to a **reverse proxy** (nginx/caddy). Prior PRs (#5415, #8321, #9131) "fell by the wayside or stalled". As of this research the local server still has no auth gate.
- **Bearer-token reality for us:** if a user exposes Ollama behind a proxy that enforces `Authorization: Bearer <key>` (common for Open WebUI, which *requires* a Bearer token — see the issue thread), our client must be able to send it. So: **optional bearer header, not required.** `[app-code]` the Ollama schema today has **no `api_key` field at all** (`src/constants/providerFieldSchemas.ts`), so there is nowhere to enter a proxy token — a gap if we want to support proxied installs.
- The `security: []` marker in the official OpenAPI spec confirms the endpoints declare no auth. ([tags spec](https://docs.ollama.com/api/tags))

### LAN exposure + CORS (phone-to-PC)

| Setting | Default | Purpose |
|---|---|---|
| `OLLAMA_HOST` | `127.0.0.1:11434` | Bind address. Set to `0.0.0.0:11434` (or `0.0.0.0`) to accept LAN connections. |
| `OLLAMA_ORIGINS` | `127.0.0.1`, `0.0.0.0` | CORS allow-list. Add origins (or `*`) for browser UIs; needed for browser extensions (`chrome-extension://*`, …). |
| `OLLAMA_MODELS` | per-OS (`~/.ollama/models`, `C:\Users\%user%\.ollama\models`) | Model store location. |
| `OLLAMA_CONTEXT_LENGTH` | `4096` | Default context window. |
| `OLLAMA_KEEP_ALIVE` | `5m` | Default model keep-alive. |
| `OLLAMA_MAX_LOADED_MODELS` | `3 × #GPU` (or `3` CPU) | Concurrent model limit. |
| `OLLAMA_NUM_PARALLEL` | `1` | Parallel requests per model. |
| `OLLAMA_MAX_QUEUE` | `512` | Max queued requests before 503. |
| `OLLAMA_NO_CLOUD` | off | Disable cloud features (local-only mode). |

Sources: [FAQ](https://docs.ollama.com/faq.md).

- **Phone-to-PC:** the app must target the **host's LAN IP** (`http://192.168.x.y:11434`), never `localhost`. The user must set `OLLAMA_HOST=0.0.0.0:11434` and open the host firewall. ([FAQ](https://docs.ollama.com/faq.md) → "How can I expose Ollama on my network?")
- **CORS caveat:** React Native `fetch` sends **no browser `Origin`**, so `OLLAMA_ORIGINS` is **irrelevant to our RN client** — it only matters for browser-based UIs/tools hitting the same box. Do not gate our validation on CORS.

---

## 2. Endpoint validation (the "Test" button)

### Cheapest reachability + info call: `GET /api/version`

```json
{ "version": "0.12.6" }
```

Source: [get-version](https://docs.ollama.com/api-reference/get-version.md). Also declared `security: []`.

Why it's the right verify call:
- **GET, tiny, side-effect-free, always present** in stock Ollama.
- The `version` field **proves the server is Ollama**, not just any HTTP listener on 11434.
- Gives us a version string we can gate feature-detection on (e.g. `capabilities[]`, `/v1/responses` needs v0.13.3, System One needs v0.35.0+ — see §4/§6).

### Richer option: `GET /api/tags`

Returns the model list (see §3). Use as a **fallback probe** and to report "N models installed" in the same round-trip. It is still small (one JSON object, no tensors).

### Failure signals

| Symptom | Meaning | UI message |
|---|---|---|
| `dial tcp ...:11434: connectex: No connection could be made` / timeout | Server not running, wrong port, or **host firewall** (very common for LAN) | "Can't reach Ollama — is it running and is `OLLAMA_HOST` set to `0.0.0.0`?" |
| TLS handshake error / `x509` | `https://` used against a plain-HTTP server | "This endpoint is HTTP, not HTTPS." |
| `401` / `403` with HTML body | A **reverse proxy** is enforcing auth (Ollama itself never returns this) | "Your proxy requires a token — add it." |
| `200` but **HTML** body (or `/` returns the Ollama web page) | Reached *a* web server that is not the JSON API (or a proxy default page) | Parse JSON, don't trust status. |
| `404` on `/api/version` but `/v1/models` works | It's a **generic OpenAI-compatible proxy**, not stock Ollama | Fall back to the OpenAI-compatible provider, not Ollama. |
| `429` | Rate limit (possible behind a proxy/cloud) | — |
| `503` | Server overloaded (queue full; `OLLAMA_MAX_QUEUE`) | "Ollama is busy — try again shortly." |
| `{ "error": "model 'x' not found, try pulling it first" }` (HTTP 404) | Server is up; model not pulled | "Server is up but this model isn't installed." |

Errors are `application/json` with an `error` string; status codes `200/400/404/429/500/502` are documented. ([errors](https://docs.ollama.com/api/errors.md), [FAQ](https://docs.ollama.com/faq.md) for 503).

### "Server up, no models" vs "unreachable"

- **Unreachable:** transport-level failure (`connection refused` / timeout) — no HTTP response at all.
- **Server up, no models:** `/api/version` → `200 {"version": …}` **and** `/api/tags` → `200 {"models": []}`. This is a **valid** endpoint; the UI should say "Connected — no models installed yet (pull one with `ollama pull …`)". Do **not** treat an empty list as invalid.
- **Server up, model missing:** `/api/show` or a generation call → `404 {"error":"model … not found"}`.

### Timeout guidance (LAN)

- **Verify call (`/api/version` or `/api/tags`):** connect timeout **2–3 s**, total **5 s**. Anything slower is a network problem, not a slow server.
- **Enumeration (`/api/tags` + per-model `/api/show`):** total **5–10 s**; `/api/tags` is small, but if you fan out `/api/show` for every model, budget more (see §3 caching).
- **Generation:** the **first** request after load may include model load time (seconds → minutes). The response's `load_duration` (nanoseconds) tells you how much. Use a long overall timeout (the engine's existing convention is `http.Client{Timeout: 5 * time.Minute}` in `comfyui.go`; apply similar for Ollama chat).

---

## 3. Model listing (BOTH surfaces)

### 3.1 Native — `GET /api/tags` (rich; use this)

```json
{
  "models": [
    {
      "name": "gemma4:latest",
      "model": "gemma4:latest",
      "remote_model": "gemma4:31b",        // present only for remote/cloud models
      "remote_host": "https://ollama.com",  // present only for remote/cloud models
      "modified_at": "2025-10-03T23:34:03.409490317-07:00",
      "size": 9608350245,
      "digest": "c6eb396dbd5992bbe3f5cdb947e8bbc0ee413d7c17e2beaae69f5d569cf982eb",
      "details": {
        "format": "gguf",
        "family": "gemma4",
        "families": ["gemma4"],
        "parameter_size": "8.0B",
        "quantization_level": "Q4_K_M"
      },
      "capabilities": ["completion", "thinking", "vision"]   // modern releases; see note
    }
  ]
}
```

Sources: [tags](https://docs.ollama.com/api/tags) (OpenAPI), plus `[ollama-source]` [api/types.go](https://github.com/ollama/ollama/blob/main/api/types.go) (`ListModelResponse`).

**`details` schema (exhaustive):**

| Field | Type | Meaning | Auto-detect use |
|---|---|---|---|
| `format` | string | Model file format (e.g. `gguf`, `safetensors`) | sanity/metadata |
| `family` | string | Primary architecture family (e.g. `llama`, `qwen2`, `gemma3`) | → capability heuristics |
| `families` | string[] | All families (e.g. vision models list a separate projector family) | **vision signal** when `len>1` |
| `parameter_size` | string | Human label (`7B`, `8.0B`, `70B`) | VRAM/quality hints |
| `quantization_level` | string | Quant (`Q4_K_M`, `Q8_0`, `F16`) | quality/size hints |
| `context_length` | int | Trained context length (omitempty) — **`[ollama-source]` only; absent from the doc-site OpenAPI example** | context window for the picker |
| `embedding_length` | int | Embedding dimension (omitempty) — `[ollama-source]` only | embedding metadata |
| `runner` | string | Runner variant (omitempty) — `[ollama-source]` only | manifest-list models |

> **Note on `capabilities[]` in `/api/tags`:** current upstream source includes a per-model `capabilities` array (`ListModelResponse.Capabilities []model.Capability`), but the doc-site OpenAPI example does **not**. Treat it as **optional**: if present it is authoritative; if absent, call `/api/show` per model (or fall back to family heuristics). `[ollama-source]`

### 3.2 OpenAI-compatible — `GET /v1/models` (degraded; do NOT use for capability)

OpenAI-standard list shape:

```json
{ "object": "list",
  "data": [ { "id": "llama3.2:latest", "object": "model",
              "created": 1720000000, "owned_by": "library" } ] }
```

Sources: [OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility) (notes: `created` = last-modified; `owned_by` = ollama username, default `"library"`), community confirmation of `"owned_by":"library"` ([LocalLLaMA thread](https://www.reddit.com/r/LocalLLaMA/comments/1lwb5py/does_the_openai_responses_api_work_with_ollama/)).

**What `/v1/models` does NOT tell us** (everything the registry needs):
- ❌ size, digest, `modified_at`
- ❌ `details` (family/families/parameter_size/quantization/context_length/embedding_length)
- ❌ capabilities (vision/tools/thinking/embedding)
- ❌ remote/cloud provenance (`remote_model`/`remote_host`)

It gives us **only** `id` + `created` + `owned_by`. That is precisely why the engine's OpenAI-compatible `ListModels` returns `common.ModelInfo{ID, Name}` with nothing else. `[engine-code]` (`providers/openaicompatible.go`, `providers/openai.go`).

**Quirk:** `GET /v1/models/{model}` can **404 / return non-JSON for namespaced models** (e.g. `author/model:tag`). ([issue #7528](https://github.com/ollama/ollama/issues/7528)). Prefer `/api/tags`.

**Verdict:** for the model picker + capability catalog, call **`GET /api/tags`** (one call, all models, all metadata) and optionally enrich with `POST /api/show` per model. Never rely on `/v1/models`.

---

## 4. Per-model parameter support

### 4.1 Request shape

Native generation params live in a nested **`options`** object on `POST /api/generate` and `POST /api/chat`. `format` (structured output), `think`, `keep_alive`, `stream`, `tools`, `logprobs`/`top_logprobs` are **top-level** on the request. `[ollama-source]` + docs.

Sources: [generate](https://docs.ollama.com/api/generate.md), [chat](https://docs.ollama.com/api/chat.md).

### 4.2 Universal options (apply to any text model)

From `[ollama-source]` [api/types.go](https://github.com/ollama/ollama/blob/main/api/types.go) (`Options` struct) with documented defaults ([modelfile](https://docs.ollama.com/modelfile.md), [FAQ](https://docs.ollama.com/faq.md)):

| Wire name | Type | Default | Meaning |
|---|---|---|---|
| `temperature` | float | `0.8` | randomness |
| `top_k` | int | `40` | keep K most likely |
| `top_p` | float | `0.9` | nucleus sampling |
| `min_p` | float | `0.0` | min-probability floor (relative to top token) |
| `repeat_penalty` | float | `1.0` | repetition penalty (note: **not** `repetition_penalty`) |
| `repeat_last_n` | int | `64` | lookback window (`0`=off, `-1`=num_ctx) |
| `presence_penalty` | float | `0.0` | OpenAI-style presence penalty |
| `frequency_penalty` | float | `0.0` | OpenAI-style frequency penalty |
| `seed` | int | `-1` | RNG seed (`-1`=random) |
| `num_predict` | int | `-1` | max tokens to generate (`-1`=infinite) |
| `stop` | string[] | — | stop sequences |
| `num_keep` | int | `4` | tokens to keep on context shift |
| `typical_p` | float | `1.0` | **deprecated**: rejected as a model parameter, accepted per-request with a warning |
| `num_ctx` | int | `4096` (`OLLAMA_CONTEXT_LENGTH`) | context window (**runner option** — changing it reloads the model) |
| `num_batch` | int | `512` | batch size (runner) |
| `num_gpu`, `main_gpu`, `use_mmap`, `num_thread` | — | — | runner/offload options |
| `draft_num_predict` | int | `4` | speculative draft tokens (runner) |

Top-level request fields: `stream` (default **true**), `format` (`"json"` or a JSON-schema object), `think`, `keep_alive`, `tools`, `logprobs`, `top_logprobs`, `raw`, `suffix`, `images`, `system`, `truncate`, `shift`.

### 4.3 Model-gated parameters

| Param | Gate | How to detect |
|---|---|---|
| `think` (bool / named level / null) | Thinking-capable models only | `POST /api/show` → top-level `thinking: {values, default}` (see §4.4); capability `"thinking"` |
| `images` (vision input) | Vision models only | capability `"vision"`; `details.families` length > 1; `projector_info` present |
| `tools` | Tool-calling models only | capability `"tools"` (server passes them through; the model must honor them) |
| `format` JSON-schema | Works on most chat models; best-effort on small ones | capability `"completion"` (all) |
| `audio` input | Audio models | capability `"audio"` (newer enum value) |
| `decision` (System One) | System One models | capability `"decision"`; requires v0.35.0+ local / v0.40.5+ cloud |

`think` semantics ([thinking](https://docs.ollama.com/capabilities/thinking.md)):
- `true` → request thinking; `false` → request no thinking; `null` → model default; a **string** → an exact level from `thinking.values`.
- Output is split: chat returns `message.thinking` + `message.content`; generate returns `thinking` + `response`.
- `values: [false]` ⇒ model does **not** support thinking. `thinking` omitted ⇒ no metadata (model may still think by its own behavior).
- Numbers are **not** supported for `think`. `[ollama-source]` (`ThinkValue` accepts bool or string only).

### 4.4 `POST /api/show` — how capabilities are exposed

Request: `{ "model": "gemma4", "verbose": true? }`. Response fields ([show-model-details](https://docs.ollama.com/api-reference/show-model-details.md) + `[ollama-source]` `ShowResponse`):

| Field | Type | Meaning |
|---|---|---|
| `capabilities` | string[] | **Authoritative** supported features (see enum in §7). |
| `thinking` | `{values: (bool\|string)[], default: (bool\|string)}` | Thinking controls advertised by the model (omitted if none). |
| `parameters` | string | The model's Modelfile params serialized as **text** (e.g. `temperature 0.7\nnum_ctx 2048`). |
| `license` | string | License text. |
| `modified_at` | ISO8601 | Last modified. |
| `details` | object | `{parent_model, format, family, families, parameter_size, quantization_level}` (same family as tags). |
| `model_info` | object | Raw GGUF/arch metadata: `general.architecture`, `*.context_length`, `*.embedding_length`, `*.attention.head_count`, tokenizer fields, and **vision/audio sub-objects** (`gemma4.vision.*`, `gemma4.audio.*`). |
| `projector_info` | object (omitempty) | Present for multimodal models → **vision signal**. `[ollama-source]` |
| `tensors` | array (omitempty) | Tensor metadata (verbose). |
| `template` / `renderer` / `parser` / `template_source` | string | Prompt template plumbing. `template_source` ∈ `renderer_parser`\|`renderer`\|`parser`\|`harmony`\|`go_template`\|`gguf_chat_template`\|`none`. |
| `system` | string | System prompt. |
| `messages` | array (omitempty) | Example messages baked into the model. |
| `remote_model` / `remote_host` | string (omitempty) | Cloud provenance. |
| `requires` | string (omitempty) | Minimum Ollama version. |
| `manifests` | array (omitempty) | Child manifests for manifest-list models. |
| `Modelfile` | string (omitempty) | `[ollama-source]` only; full Modelfile. |

> **`context_length` discovery:** the reliable context window is `details.context_length` (tags, modern) or `model_info["<arch>.context_length"]` (show). Example: `gemma4.context_length: 131072` in the docs' show response. ([show-model-details](https://docs.ollama.com/api-reference/show-model-details.md))

---

## 5. Param name mapping (native ↔ OpenAI-compat) + engine gaps

### 5.1 Wire-name mapping table

| Capability / intent | **Native** wire name (in `options`, `/api/chat`+`/api/generate`) | **OpenAI-compat** wire name (`/v1/chat/completions`) | Notes |
|---|---|---|---|
| temperature | `temperature` | `temperature` | 1:1 |
| top_p | `top_p` | `top_p` | 1:1 |
| top_k | `top_k` | **— (unsupported on `/v1`)** | use native or Modelfile |
| min_p | `min_p` | **— (unsupported)** | use native |
| repetition penalty | `repeat_penalty` | **—** | **not** `repetition_penalty`; OpenAI `frequency_penalty`/`presence_penalty` are *different* knobs |
| repetition lookback | `repeat_last_n` | **—** | native only |
| frequency penalty | `frequency_penalty` | `frequency_penalty` | 1:1 |
| presence penalty | `presence_penalty` | `presence_penalty` | 1:1 |
| seed | `seed` | `seed` | 1:1 |
| max output tokens | `num_predict` | `max_tokens` | compat also lists `max_completion_tokens`? **No** — docs list `max_tokens` only |
| stop | `stop` (string[]) | `stop` | 1:1 |
| context window | `num_ctx` | **— (unsupported)** | must be a `PARAMETER num_ctx` in a Modelfile |
| structured output | `format` (`"json"` \| JSON-schema obj) | `response_format` (JSON mode) | compat: JSON mode only; native accepts a full schema |
| thinking (on/off) | `think` (bool) | `reasoning_effort` / `reasoning.effort` | see mapping below |
| thinking (named level) | `think: "<level>"` | `reasoning_effort: "<level>"` | model-defined names, applied exactly; unsupported names → model default |
| keep-alive | `keep_alive` (string \| number) | **— (unsupported)** | native only |
| logprobs | `logprobs` / `top_logprobs` | — (`logprobs` listed **unsupported** on `/v1`) | native only |

Sources: [generate](https://docs.ollama.com/api/generate.md), [chat](https://docs.ollama.com/api/chat.md), [OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility), `[ollama-source]` [api/types.go](https://github.com/ollama/ollama/blob/main/api/types.go).

**`think` ↔ `reasoning_effort` compatibility mapping** ([OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)):
- Models **with** thinking metadata: supported names applied exactly; unsupported names → model default.
- Boolean-only models: recognized compat efforts → `true`; `"none"` → `false`.
- Models **without** metadata (legacy aliases): `"minimal"` → `"low"`; `"xhigh"`/`"ultra"` → `"max"`.
- **GPT-OSS special-case:** `"minimal"` → `"low"`; `"xhigh"`/`"ultra"` → `"high"`; `"none"` → no thinking output.
- `/v1/responses` also accepts an Ollama extension field `think` (bool / model-defined string / null).

### 5.2 Our engine client's current mapping + gaps

There is **no Ollama client** in the engine. `[engine-code]`

- `providers/registry.go` registers 13 providers; **none is Ollama**. `config/config.go` defines chat providers (`ProviderOpenAI`, `ProviderOpenAICompatible`, …) but **no `ProviderOllama`** — only `RagProviderOllama = "ollama"`.
- `modules/backend.go` `InitBackendClient` does `providers.GlobalRegistry.New(cfg.Provider)`; for `provider="ollama"` that returns `unsupported backend provider: ollama`. Same for cognition (`modules/cognition.go:174`) and movement (`modules/movement.go:119`) — their switches omit Ollama entirely.
- Ollama is wired **only** for RAG embeddings: `chromem.NewEmbeddingFuncOllama(EmbeddingModel, BaseURL)` (`modules/rag/validation.go:114`, `modules/rag/vector_store.go:77`). Config: `config.RAGOllamaConfig{BaseURL, EmbeddingModel}`.
- Management CRUD exists for the Ollama provider row (`management/routes_providers.go` case `"ollama"`), and the app exposes it (`[app-code]` `providerFieldSchemas.ts`, `moduleDefaults.ts`, `providers.ts` → `makeProviderApi<OllamaProviderConfig>('ollama')`).

The closest analogue is `OpenAICompatibleProvider` — its mapping shows exactly what we'd inherit if we naively route Ollama through `/v1`:

- `buildParams` maps: `temperature`, `top_p`, `max_tokens`, `max_completion_tokens`, `frequency_penalty`, `presence_penalty`, `n`, `stop`, `seed`, `response_format` (as an extra field), plus free-form `extraParams` and sampling presets. `[engine-code]` (`providers/openaicompatible.go`)
- It does **not** map `top_k`, `min_p`, `repeat_penalty`, `num_ctx`, `keep_alive`, or `think`. `[engine-code]`
- **Divergence to note:** the DB model `models.OpenAICompatibleProviderConfig` carries `TopK`, `TopA`, `MinP`, `RepetitionPenalty`, but the runtime struct `config.OpenAICompatibleProviderConfig` does **not** — so those columns are silently dropped when the runtime config is built. `[engine-code]` (`database/models/provider_openai_compatible.go` vs `config/types.go`)
- `ValidateConfig`/`ListModels` for OpenAI-compatible hit `GET /v1/models` and return only `{ID, Name}` — the degraded path described in §3.2. `[engine-code]`

**Consequence:** routing Ollama through `/v1` would forfeit `top_k`, `min_p`, `repeat_penalty`, `num_ctx`, `keep_alive`, and `think` (unless smuggled via `extraParams`, which Ollama's `/v1` ignores). A **dedicated native `/api/chat` client** is required to expose the full param set.

---

## 6. Quirks

### `keep_alive` semantics ([FAQ](https://docs.ollama.com/faq.md))
- Default: models stay loaded **5 minutes** (`OLLAMA_KEEP_ALIVE`).
- Per-request `keep_alive` on `/api/generate` and `/api/chat`: a duration string (`"10m"`, `"24h"`), a number of **seconds**, any **negative** number to keep loaded indefinitely (`-1`), or `0` to unload immediately.
- Request `keep_alive` **overrides** `OLLAMA_KEEP_ALIVE`. Empty request body (`{"model":"m"}`) **preloads** the model.

### Memory / VRAM + load latency
- **First request of a session may include model load** (seconds → minutes). The response reports `load_duration` (ns) and `total_duration`; `/api/ps` reports `size_vram`, `context_length`, and `expires_at` for loaded models. ([chat](https://docs.ollama.com/api/chat.md), [ps](https://docs.ollama.com/api/ps.md))
- Loading is memory-gated: a new model loads only if it fits in RAM/VRAM, else it's queued and idle models are evicted. On GPU, a model must fit **entirely** in VRAM for concurrent loads. ([FAQ](https://docs.ollama.com/faq.md))

### Concurrent request limits ([FAQ](https://docs.ollama.com/faq.md))
- `OLLAMA_MAX_LOADED_MODELS` (default `3 × #GPU`, or `3` for CPU) — concurrent models.
- `OLLAMA_NUM_PARALLEL` (default `1`) — parallel requests per model; RAM scales by `OLLAMA_NUM_PARALLEL × OLLAMA_CONTEXT_LENGTH`.
- `OLLAMA_MAX_QUEUE` (default `512`); overflow → **503**. Windows Radeon defaults to 1 model (ROCm v5.7 VRAM-report limitation).
- A `429` is possible (rate limiting).

### Model name syntax ([name.go](https://github.com/ollama/ollama/blob/main/types/model/name.go))
- Canonical form: `{host}/{namespace}/{model}:{tag}@digest`.
- Defaults: host `registry.ollama.ai`, namespace `library`, tag `latest`. So `llama3.2` ≡ `registry.ollama.ai/library/llama3.2:latest`.
- Valid parts: `namespace` `[1,80]`, `model` `[1,80]`, `tag` `[1,80]`, `host` `[1,350]`; namespace cannot contain `.`; each part must start alphanumeric/`_`.
- Namespaced models (e.g. `author/model:tag`) can **404 on `/v1/models/{model}`** ([issue #7528](https://github.com/ollama/ollama/issues/7528)); use `/api/tags`.

### Modelfile params vs request params ([modelfile](https://docs.ollama.com/modelfile.md), [FAQ](https://docs.ollama.com/faq.md))
- `PARAMETER` sets **defaults baked into the model**; per-request `options` **override** them.
- `num_ctx`, `num_gpu`, `num_thread`, `num_batch` are **runner options set at load** — changing `num_ctx` triggers a reload. The OpenAI-compat surface can't set context; you must create a Modelfile with `PARAMETER num_ctx` and use `ollama create`.
- `/api/show` returns the baked params as a **text blob** (`parameters`), which our catalog can parse but should not treat as the runtime config.

### `/api/show` fields worth remembering
- `capabilities[]` — authoritative feature set (see §7).
- `thinking{values,default}` — drives the `think` control in the UI.
- `model_info` — arch + `*.context_length` + `*.embedding_length` + vision/audio sub-objects.
- `projector_info` — multimodal projector → vision signal.
- `template_source` — where the chat template actually comes from.

### Structured output / streaming
- `format: "json"` or a **JSON-schema object** for constrained output ([chat](https://docs.ollama.com/api/chat.md) example).
- Streaming is **on by default** (`stream: true`); set `stream: false` for single-shot. Streaming is `application/x-ndjson`; mid-stream errors arrive as `{"error": …}` **without changing the status code** ([errors](https://docs.ollama.com/api/errors.md)).

---

## 7. Auto-detect recipe (decision tree)

### 7.1 The authoritative enum (prefer over heuristics)

`[ollama-source]` [types/model/capability.go](https://github.com/ollama/ollama/blob/main/types/model/capability.go):

```
completion | tools | insert | vision | embedding | thinking | image | audio | decision
```

- `completion` — text generation (present on essentially all chat models).
- `tools` — function/tool calling.
- `insert` — fill-in-the-middle (code completion).
- `vision` — image input.
- `embedding` — produces embeddings.
- `thinking` — emits a separate reasoning trace (`think`).
- `image` — image **generation** (newer).
- `audio` — audio I/O (newer).
- `decision` — System One decision models (v0.35.0+).

### 7.2 Decision tree

```
1. GET {base}/api/version                       -> reachable? real Ollama? version
2. GET {base}/api/tags                          -> models[], details, (capabilities[])
3. For each model:
   a. IF tags[i].capabilities[] present & non-empty:
        capability set := capabilities[]                  confidence = KNOWN
   b. ELSE POST {base}/api/show {model}
        IF show.capabilities[] present & non-empty:
           capability set := show.capabilities[]           confidence = KNOWN
           + thinking controls from show.thinking{values,default}
           + context_length from details/model_info
        ELSE (older server, no capabilities):
           derive from details.family/families + model_info + id  confidence = DETECTED
   c. IF still unknown -> id signature heuristics                 confidence = ASSUMED
4. Merge into registry: live > static catalog > user override (warn, don't block)
```

### 7.3 Family / id → capability heuristics (DETECTED / ASSUMED tier)

Use these **only** when `capabilities[]` is unavailable (older Ollama) or for pre-catalog seeds. `family`/`families` come from `/api/tags` or `/api/show`.

| Capability | Families / signals | Example model ids |
|---|---|---|
| **vision** | `families` length > 1, or family ∈ {`llava`, `llama3.2-vision`/`mllama`, `minicpmv`, `moondream`, `bakllava`, `gemma3`, `gemma4`, `qwen2vl`, `qwen2.5vl`, `qwen3vl`, `granite3.2-vision`, `mistral-small3.x`}; `projector_info` present; `model_info` has `<arch>.vision.*` | `llava`, `llama3.2-vision`, `minicpm-v`, `moondream`, `qwen3-vl:8b`, `gemma4` |
| **tools** | family/id ∈ {`qwen2.5`, `qwen3`, `llama3.1`, `llama3.2`, `llama3.3`, `mistral`, `mixtral`, `hermes3`, `firefunction`, `command-r`, `granite3.x`, `gpt-oss`} | `qwen3`, `llama3.1`, `hermes3`, `gpt-oss:20b` |
| **thinking** | family/id ∈ {`qwen3`, `deepseek-r1`, `gpt-oss`, `magistral`}; `thinking` object present in `/api/show` | `qwen3`, `deepseek-r1`, `gpt-oss:20b` |
| **embedding** | family/id ∈ {`nomic-bert`/`nomic-embed-text`, `bert`/`mxbai-embed-large`, `all-minilm`, `bge-m3`, `bge-large`, `snowflake-arctic-embed`, `embeddinggemma`} | `nomic-embed-text`, `mxbai-embed-large`, `bge-m3` |
| **audio** | family ∈ {`gemma4` (audio sub-object), audio-capable multimodal} | `gemma4` (audio), audio models |
| **decision** | System One models; capability `decision` | (System One) |
| **insert** | FIM-trained coder models | `codellama`, `starcoder`, `deepseek-coder` |

Notes:
- `families` length > 1 is a **strong vision signal** (text family + projector family).
- `projector_info` / `model_info["<arch>.vision.*"]` are the most reliable structural vision signals when `capabilities[]` is absent.
- Thinking is *not* reliably inferable from family alone for all models — prefer the `thinking` object / `thinking` capability.

### 7.4 Confidence labels (for the picker chips)

| Label | Source | Meaning |
|---|---|---|
| `known` | `capabilities[]` (tags or show) | Authoritative, server-reported. |
| `detected` | `details.family`/`families` + `model_info`/`projector_info`/`thinking` | Structurally derived from metadata. |
| `assumed` | model-id substring heuristics | Best-effort; may be wrong. |

---

## 8. Recommendations

### 8.1 Exact verify call (the "Test" button)

```
GET {base_url}/api/version
Headers: (optional) Authorization: Bearer <proxy_token>   # only if user set one
Timeouts: connect 2–3s, total 5s
```

- **Success:** HTTP 200 **and** JSON parses with a non-empty `version`. Report `Ollama <version>` and, in the same flow, the model count from `GET /api/tags`.
- **Fallback chain:** `/api/version` → `/api/tags` → `/v1/models` (if the last works but the first two 404, it's a generic OpenAI-compatible proxy — route to that provider, not Ollama).
- **Distinct messages per failure class:** connection refused (not running / firewall / wrong `OLLAMA_HOST`), TLS mismatch, `401/403` (proxy auth), HTML body (wrong host/proxy page), empty list ("connected, no models installed").
- **`POST /api/providers/verify {type:"ollama", base_url}` → `{valid, detail:"Ollama 0.12.6 · 7 models"}`** (per the workstream plan §3.4). No key field required; add an **optional** `api_key` so proxied installs work.

### 8.2 Exact enumerate call (the "Fetch from provider" / model picker)

```
GET {base_url}/api/tags          -> models[] with details + (capabilities[])
POST {base_url}/api/show {model} -> per-model capabilities, thinking, context_length  (enrich lazily)
```

- **Use the native surface, never `/v1/models`** for capability data.
- `/api/tags` is one call and already carries family/families/parameter_size/quantization (and `context_length` on modern builds). Fan out `/api/show` **only** for models whose `capabilities[]` is missing, or on explicit model selection.
- **Cache:** `/api/tags` 30–60 s (or invalidate on config edit); `/api/show` per model 5–15 min.
- Shape to return: `{models:[{id, label, context, capabilities, source:"live"|"catalog"}]}` (plan §3.4), with `capabilities` from §7 and a provenance chip (`known`/`detected`/`assumed`).

### 8.3 Capability-source verdict

**Rich live.** Ollama is the best-case provider for auto-detect:
- `GET /api/tags` → per-model `details` (+ `capabilities[]` on modern builds).
- `POST /api/show` → authoritative `capabilities[]`, `thinking{values,default}`, `model_info` (context/embedding dims, vision/audio sub-objects), `projector_info`.

Seed the static catalog only as a **fallback for older Ollama versions** and for the id-signature heuristics in §7.3. The engine catalog should also carry the **native↔compat param-name mapping** (§5.1) so the UI can filter/grey params per model.

### 8.4 Engine client notes

1. **Add a dedicated `providers/ollama.go` speaking the native `/api/chat` surface.** Do **not** route Ollama through `OpenAICompatibleProvider` — that loses `top_k`, `min_p`, `repeat_penalty`, `num_ctx`, `keep_alive`, and `think` (§5.2). Register it in `GlobalRegistry` and add `config.ProviderOllama = "ollama"` (distinct from the existing `RagProviderOllama`), then include it in the `backend`/`cognition`/`movement` dispatch switches that currently omit it. `[engine-code]`
2. **Implement `ValidateConfig` as `GET /api/version`** (not `/v1/models`). Treat empty model list as valid.
3. **Implement `ListModels` against `/api/tags`**, returning richer `common.ModelInfo` (family, families, parameter_size, quantization, size, context_length, capabilities) — the current `ModelInfo{ID,Name}` is too thin for the registry.
4. **Add an optional bearer/`api_key` field** to the Ollama provider schema (app + engine) for reverse-proxied installs; keep it optional since the server is keyless by default.
5. **Expose the full option set** in the Ollama client config: `top_k`, `min_p`, `repeat_penalty`, `repeat_last_n`, `num_ctx`, `num_predict`, `stop`, `seed`, `think`, `format` (schema), `keep_alive`. Note the DB↔runtime struct divergence for `top_k`/`min_p`/`repetition_penalty` on the OpenAI-compatible side and don't repeat it here. `[engine-code]`
6. **Timeouts:** 5 s for verify/enumerate; long (minutes) for generation; surface `load_duration` so the UI can show "loading model…" on the first request.
7. **`think` handling:** read `/api/show` `thinking{values,default}` to populate the UI control; send `think` as bool or exact level string; render `message.thinking` separately from `message.content`.
8. **App-side schema (`[app-code]`):** flip `hasModelFetch: true` for `ollama` in `providerFieldSchemas.ts`; replace the free-text `model` field with a picker fed by `POST /api/providers/models`; add the (optional) `api_key` field for proxies.

---

## Sources

Doc site: https://docs.ollama.com · Upstream repo: https://github.com/ollama/ollama

- API introduction, base URLs, two surfaces: https://docs.ollama.com/api/introduction
- Authentication (local = no auth; `OLLAMA_API_KEY` = cloud client key): https://docs.ollama.com/api/authentication
- Errors (status codes, `{error}` shape, mid-stream errors): https://docs.ollama.com/api/errors.md
- List models `/api/tags` (OpenAPI + `details` schema): https://docs.ollama.com/api/tags
- Show model details `/api/show` (`capabilities`, `thinking`, `model_info`, `projector_info`): https://docs.ollama.com/api-reference/show-model-details.md
- Get version `/api/version`: https://docs.ollama.com/api-reference/get-version.md
- List running models `/api/ps` (`size_vram`, `context_length`, `expires_at`): https://docs.ollama.com/api/ps.md
- Generate `/api/generate` (`options`, `format`, `think`, `keep_alive`): https://docs.ollama.com/api/generate.md
- Chat `/api/chat` (`ModelOptions`, `ThinkValue`, tools, images): https://docs.ollama.com/api/chat.md
- OpenAI compatibility (supported fields; `reasoning_effort`↔`think` mapping; `/v1/models` notes; `/v1/responses` v0.13.3): https://docs.ollama.com/api/openai-compatibility
- Thinking capability (`thinking.values`, `think` semantics): https://docs.ollama.com/capabilities/thinking.md
- Tool calling: https://docs.ollama.com/capabilities/tool-calling.md
- Vision (`images` array, base64): https://docs.ollama.com/capabilities/vision.md
- Embeddings (`/api/embed`, L2-normalized): https://docs.ollama.com/capabilities/embeddings.md
- FAQ (`OLLAMA_HOST`, `OLLAMA_ORIGINS`, `keep_alive`, concurrency, 503, context length, storage): https://docs.ollama.com/faq.md
- Modelfile reference (`PARAMETER` names, `num_ctx`, `repeat_penalty`, defaults, `CAPABILITY`): https://docs.ollama.com/modelfile.md
- Docs index (page discovery): https://docs.ollama.com/llms.txt
- Upstream `api/types.go` (`Options`, `ListModelResponse.Capabilities`, `ModelDetails.context_length`, `ShowResponse`, `DefaultOptions`): https://github.com/ollama/ollama/blob/main/api/types.go
- Upstream `types/model/capability.go` (the capabilities enum): https://github.com/ollama/ollama/blob/main/types/model/capability.go
- Upstream `types/model/thinking.go` (`Thinking`, `ThinkValue`): https://github.com/ollama/ollama/blob/main/types/model/thinking.go
- Upstream `types/model/name.go` (model name syntax/defaults): https://github.com/ollama/ollama/blob/main/types/model/name.go
- No built-in server API-key auth; proxy guidance; PRs #5415/#8321/#9131 stalled: https://github.com/ollama/ollama/issues/8536
- Namespaced models 404/non-JSON on `/v1/models/{model}`: https://github.com/ollama/ollama/issues/7528
- `/v1/models` `owned_by:"library"` (community confirmation): https://www.reddit.com/r/LocalLLaMA/comments/1lwb5py/does_the_openai_responses_api_work_with_ollama/

### Engine/app code references (`[engine-code]` / `[app-code]`)

- Engine registry (no Ollama entry): `harmony-link-private/providers/registry.go`
- Engine provider constants (`RagProviderOllama` only; no `ProviderOllama`): `harmony-link-private/config/config.go`
- Module dispatch switches that omit Ollama: `harmony-link-private/modules/backend.go` (`InitBackendClient`), `modules/cognition.go:174`, `modules/movement.go:119`
- RAG Ollama embeddings: `harmony-link-private/modules/rag/validation.go:114`, `modules/rag/vector_store.go:77`; config `config.RAGOllamaConfig` in `config/types.go`
- Ollama DB model: `harmony-link-private/database/models/provider_ollama.go` (`OllamaProviderConfig{ID,Name,BaseURL,Model}`)
- Ollama management CRUD: `harmony-link-private/management/routes_providers.go` (case `"ollama"`)
- Closest existing analogue (OpenAI-compatible client): `harmony-link-private/providers/openaicompatible.go`; DB/runtime struct divergence in `database/models/provider_openai_compatible.go` vs `config/types.go`
- App provider schema (no `api_key`, `hasModelFetch:false`): `harmony-ai-app/src/constants/providerFieldSchemas.ts` (`ollama`)
- App defaults: `harmony-ai-app/src/constants/moduleDefaults.ts` (`ollama`)
- App DB model / repo adapter: `harmony-ai-app/src/database/models.ts` (`OllamaProviderConfig`), `src/services/engine/repositories/providers.ts`
- Workstream plan (R10 verify/models endpoints, R12 catalog): `harmony-ai-app/.current_work/provider-registry/plan.md`
