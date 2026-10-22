# LocalAI — Provider Research

> Provider workstream: **Soulbits Provider Registry** (test button + live enumeration + engine capability catalog).
> Provider under study: **LocalAI** (self-hosted, default `http://host:8080`).
> Research date: **October 2026**. External claims cite the official docs (`localai.io`) and the upstream repo (`github.com/mudler/LocalAI`, `master`).
>
> Legend:
> - `[engine-code]` = fact read from `harmony-link-private` (the Go engine / sidecar).
> - `[app-code]` = fact read from `harmony-ai-app` (React Native app).
> - `[localai-source]` = fact read from the upstream LocalAI Go source (URL cited), i.e. richer/more exact than the doc-site prose.
> - Everything else cites a doc URL.

---

## 0. TL;DR for the workstream

- **Two API surfaces.** OpenAI-compatible under `/v1/*` **and** a LocalAI-native surface: `GET /models` (alias of `/v1/models`), `GET /models/capabilities` (alias), `POST /tts`, `POST /vad`, `POST /video`, `POST /stores/*`, `POST /v1/detection|depth|face/*|voice/*`, `POST /3d/*`, plus admin/UI JSON under `/api/*` and `/models/*`. The `/v1/*` surface is **not** lossy here — LocalAI's request schema is a superset that also accepts native params (`top_k`, `min_p`, `repeat_penalty`) on `/v1/chat/completions`. ([text-generation](https://localai.io/docs/features/text-generation/index.html), `[localai-source]` `core/schema/prediction.go`)
- **Keyless by default, optional key by design.** With no `LOCALAI_API_KEY` set, everything is open. Set `LOCALAI_API_KEY` (comma-separated) and clients present `Authorization: Bearer`, `x-api-key`, `xi-api-key`, or the `token` cookie. **Health probes and discovery stay anonymous** — `/healthz`, `/readyz`, `/.well-known/localai.json`, `/api/instructions*`, Swagger. ([authentication](https://localai.io/docs/features/authentication/index.html), `[localai-source]` `core/http/routes/health.go`)
- **Cheapest verify = `GET /healthz`; best fingerprint = `GET /.well-known/localai.json`.** `/healthz` → `200` empty (liveness); `/readyz` → `200` empty or `503 {"status":"starting","reason":"startup preload in progress"}`. The well-known file is anonymous and returns `version` + an endpoint map — it *proves it is actually LocalAI* and gives us a version to gate feature-detection on. ([api-discovery](https://localai.io/docs/features/api-discovery/index.html))
- **`GET /v1/models` is thin (id + object only).** The rich, LocalAI-specific listing is **`GET /v1/models/capabilities`** (same set of models, plus `capabilities[]`, `input_modalities[]`, `output_modalities[]`, `context_size`). The UI JSON **`GET /api/models/capabilities`** adds `backend`, `disabled`, `pinned`, `voice_cloning`. Full per-model config (backend, quantization, context, template, …) is `GET /api/models/config-json/:name`. ([api-discovery](https://localai.io/docs/features/api-discovery/index.html), `[localai-source]` `core/http/endpoints/openai/list.go`, `list_capabilities.go`, `core/http/routes/ui_api.go`)
- **There is no `GET /models/local`.** That endpoint does not exist in current LocalAI (checked all route registrations). The "native richer listing" role is filled by `/v1/models/capabilities`, `/api/models/capabilities`, and `/api/models/config-json/:name`. `[localai-source]` `core/http/routes/localai.go`, `openai.go`, `ui_api.go`
- **Capability source verdict: rich live.** `/v1/models/capabilities` gives canonical usecase strings + modalities + effective `context_size` directly from LocalAI's own usecase resolver; `/api/models/capabilities` adds the serving `backend`. This anchors the auto-detect tier without name heuristics for configured models.
- **Biggest engine gaps:** (1) the engine has **no LocalAI chat client** — LocalAI chat must ride `OpenAICompatibleProvider` (`base_url` = `http://host:8080/v1`), which is fine because LocalAI's `/v1` accepts native params; (2) the engine's **RAG LocalAI embedding path is hardcoded to `http://localhost:8080/v1` with an empty API key** and no configurable base URL (`RAGLocalAIConfig` has only `EmbeddingModel`). `[engine-code]`
- **Hot-loading is real:** the first request for a cold model includes load time (seconds → minutes); LocalAI returns **HTTP 503 (retryable)** while a model is cold-loading or within the load-failure cooldown (`--model-load-failure-cooldown`, default 10s, doubling to 5m). ([api-errors](https://localai.io/docs/reference/api-errors/index.html), [runtime-errors](https://localai.io/docs/reference/runtime-errors/index.html))

---

## 1. API basics

### Base URL

- Default bind is `:8080` (`--address`, env `LOCALAI_ADDRESS`). Local: `http://localhost:8080`; LAN: `http://<host-ip>:8080`. ([cli-reference](https://localai.io/docs/reference/cli-reference/index.html))
- The OpenAI SDK pattern is `base_url="http://localhost:8080/v1/"`; the OpenAI-compatible routes are registered both with and without the `/v1` prefix (`/v1/chat/completions` **and** `/chat/completions`, etc.). `[localai-source]` `core/http/routes/openai.go`
- `[engine-code]` `config.OpenAICompatibleProviderConfig.BaseURL` (`config/types.go`) is the single endpoint field; there is no dedicated `localai` chat provider. `[app-code]` the app's `localai` schema has **no `base_url` and no `api_key`** today (`src/constants/providerFieldSchemas.ts:152`, `moduleDefaults.ts:110`).

### The two API surfaces

| Surface | Base | Endpoints relevant to us | Verdict |
|---|---|---|---|
| **OpenAI-compatible** | `{base}/v1` | `GET /v1/models`, `GET /v1/models/capabilities`, `POST /v1/chat/completions`, `/v1/completions`, `/v1/embeddings`, `/v1/messages` (Anthropic), `/v1/responses`, `/v1/images/generations`, `/v1/images/edits`, `/v1/images/upscale`, `/v1/audio/transcriptions`, `/v1/audio/speech`, `/v1/audio/voices`, `/v1/audio/diarization`, `/v1/audio/classification`, `/v1/sound-generation`, `/v1/video/generations`, `/v1/detection`, `/v1/depth`, `/v1/face/*`, `/v1/voice/*`, `/v1/tokenize`, `/v1/detokenize`, `/v1/rerank` | **Use this.** Superset schema; most endpoints live here. |
| **LocalAI-native / aliases** | `{base}` | `GET /models` (= `/v1/models`), `GET /models/capabilities` (= `/v1/models/capabilities`), `POST /tts`, `POST /vad`, `POST /video`, `POST /stores/*`, `POST /3d/*`, `POST /mcp/chat/completions`, `POST /audio/transcriptions`… | Thin aliases; same handlers. No extra metadata. |
| **Admin / UI JSON** | `{base}/api`, `{base}/models` | `GET /system`, `GET /version`, `GET /api/models/capabilities`, `GET /api/models/config-json/:name`, `GET /api/models/config-metadata`, `GET/PATCH` config, `GET /models/available` (gallery), `GET /models/galleries`, `POST /models/apply|import`, `GET /api/backends*`, `GET /api/resources`, `GET /api/models/storage`, `POST /api/models/vram-estimate` | **Rich metadata.** Most are admin-gated when auth is on. |
| **Discovery (anonymous)** | `{base}` | `GET /.well-known/localai.json`, `GET /api/instructions`, `GET /api/instructions/{name}`, `GET /swagger*` | Use for fingerprinting/versioning. |

Sources: [text-generation](https://localai.io/docs/features/text-generation/index.html), [api-discovery](https://localai.io/docs/features/api-discovery/index.html), [image-generation](https://localai.io/docs/features/image-generation/index.html), [text-to-audio](https://localai.io/docs/features/text-to-audio/index.html), [audio-to-text](https://localai.io/docs/features/audio-to-text/index.html); `[localai-source]` `core/http/routes/openai.go`, `core/http/routes/localai.go`, `core/http/routes/ui_api.go`.

### Auth options

Two modes; the relevant one for a self-hosted single box is **legacy API keys**.

| Mode | Enable | How the client sends the key |
|---|---|---|
| **Legacy API key** (simple shared key) | `LOCALAI_API_KEY=sk-...` / `--api-keys` (comma-separated for multiple) | `Authorization: Bearer <key>`, `x-api-key: <key>`, `xi-api-key: <key>`, or `token` cookie |
| **User auth system** (roles, sessions, OAuth/OIDC) | `LOCALAI_AUTH=true` (or a GitHub/OIDC client id) | `Authorization: Bearer <key-or-session>`, `x-api-key`, `session`/`token` cookie |

- **Legacy keys grant full admin** — no role separation. ([authentication](https://localai.io/docs/features/authentication/index.html))
- **Anonymous routes even with auth on:** `GET /healthz`, `GET /readyz`, `GET /.well-known/localai.json`, `GET /api/instructions*`, Swagger GET, `OPTIONS` (CORS preflight), auth bootstrap routes. ([authentication](https://localai.io/docs/features/authentication/index.html))
- **401 shape:** `{"error":{"code":401,"message":"An authentication key is required","type":"invalid_request_error"}}` with a `WWW-Authenticate: Bearer` header. **403** = non-admin on an admin route. ([api-errors](https://localai.io/docs/reference/api-errors/index.html))
- **`LOCALAI_OPAQUE_ERRORS=true`** replaces error bodies with empty responses (status only) — a hardening option that would blind our error messages. ([api-errors](https://localai.io/docs/reference/api-errors/index.html))

**For us:** LocalAI auth is **optional**, so our "Test" button must send an optional bearer token and treat `401` as "reachable but key required" rather than "unreachable".

### CORS / LAN config (phone-to-PC)

| Setting | Default | Purpose |
|---|---|---|
| `--address` / `LOCALAI_ADDRESS` | `:8080` | Bind address. Set `0.0.0.0:8080` (or `:8080`) to accept LAN connections; `127.0.0.1:8080` restricts to loopback. |
| `--cors` / `LOCALAI_CORS` | `false` | Enable CORS middleware. |
| `--cors-allow-origins` / `LOCALAI_CORS_ALLOW_ORIGINS` | — | Comma-separated allow-list of origins. |
| `--disable-webui` / `LOCALAI_DISABLE_WEBUI` | `false` | Serve API only (drops the SPA). |

Sources: [cli-reference](https://localai.io/docs/reference/cli-reference/index.html), [authentication](https://localai.io/docs/features/authentication/index.html).

- **Phone-to-PC:** the app must target the **host's LAN IP** (`http://192.168.x.y:8080`), never `localhost`, and the host must bind a non-loopback address + open its firewall. This mirrors the Ollama situation.
- **CORS caveat (same as Ollama):** React Native `fetch` sends **no browser `Origin`**, so `LOCALAI_CORS*` is **irrelevant to our RN client** — it only matters for browser UIs/tools. Do **not** gate our validation on CORS.
- LocalAI serves **API + Web UI on the same port** (noted in `[engine-code]` `integration/manager.go` comment about same-port integrations). `--disable-webui` is the clean way to separate concerns if needed.

---

## 2. Endpoint validation (the "Test" button)

### Cheapest reachability + info calls

| Call | Auth | Response | Use |
|---|---|---|---|
| `GET {base}/healthz` | anonymous | `200` **empty body** (no content) | Cheapest liveness probe. `[localai-source]` `core/http/routes/health.go` |
| `GET {base}/readyz` | anonymous | `200` empty, or `503 {"status":"starting","reason":"startup preload in progress"}` | Readiness. Distinguishes "up but still preloading". `[localai-source]` `core/http/routes/health.go` |
| `GET {base}/.well-known/localai.json` | anonymous | `{"version","endpoints{...}","endpoint_groups{...}","capabilities{...}}` | **Best fingerprint + version.** Proves it is LocalAI. ([api-discovery](https://localai.io/docs/features/api-discovery/index.html)) |
| `GET {base}/v1/models` | required when auth on | `{"object":"list","data":[{"id","object":"model"}]}` | Confirms the OpenAI surface + model count. `[localai-source]` `core/http/endpoints/openai/list.go` |
| `GET {base}/version` | required (any authenticated user) | `{"version":"2.26.0 (a1b2c3d4)"}` | Version, but **not** anonymous. ([system-info](https://localai.io/docs/reference/system-info/index.html)) |

`/.well-known/localai.json` example (abbreviated), per [api-discovery](https://localai.io/docs/features/api-discovery/index.html):

```json
{
  "version": "v2.28.0",
  "endpoints": {
    "chat_completions": "/v1/chat/completions",
    "models": "/v1/models",
    "models_capabilities": "/v1/models/capabilities",
    "config_metadata": "/api/models/config-metadata",
    "instructions": "/api/instructions",
    "swagger": "/swagger/index.html"
  },
  "endpoint_groups": { "openai_compatible": {...}, "config_management": {...}, "model_management": {...}, "monitoring": {...} },
  "capabilities": { "config_metadata": true, "config_patch": true, "vram_estimate": true, "model_storage": true, "mcp": true, "agents": false, "p2p": false }
}
```

### Failure signals

| Symptom | Meaning | UI message |
|---|---|---|
| `dial tcp ...:8080: connectex: No connection could be made` / timeout | Server not running, wrong port, or **host firewall / loopback-only bind** | "Can't reach LocalAI — is it running, bound to `0.0.0.0:8080`, and is the firewall open?" |
| TLS handshake / `x509` | `https://` used against a plain-HTTP server | "This endpoint is HTTP, not HTTPS." |
| `200` with **HTML** body on `/v1/models` | Reached the LocalAI **Web UI** or a proxy page, not the JSON API | Parse JSON; don't trust status. |
| `401` `{"error":{"code":401,"message":"An authentication key is required",...}}` + `WWW-Authenticate: Bearer` | Server up; auth is enabled and no/invalid key | "LocalAI requires an API key — add it." |
| `403` | Non-admin user on an admin route (`/system`, `/api/models/*`, `/models/available`) | "Connected, but this account lacks admin for model details." |
| `404` on `/healthz` and `/.well-known/localai.json` but `/v1/models` works | Not stock LocalAI — a generic OpenAI-compatible server | Route to the OpenAI-compatible provider instead. |
| `429` with `Retry-After`, `type:"rate_limit_error"` | Per-model `max_concurrent` or process-wide `--max-concurrent-backend-requests` saturated | "LocalAI is busy — try again shortly." |
| `503` | Model cold-loading / load-failure cooldown / no healthy node | "LocalAI is loading the model — retry in a moment." |
| `500` | Backend inference failure (message usually generic; real cause in server log) | Surface status + best-effort message. |

Sources: [api-errors](https://localai.io/docs/reference/api-errors/index.html), [runtime-errors](https://localai.io/docs/reference/runtime-errors/index.html).

### "Up, empty" vs "unreachable"

- **Unreachable:** transport-level failure (connection refused / timeout) — no HTTP response.
- **Up, no models:** `/healthz` → `200` **and** `/v1/models` → `200 {"object":"list","data":[]}`. This is **valid**; say "Connected — no models configured yet" (LocalAI can auto-download gallery models on demand, see §6).
- **Up, but not ready:** `/readyz` → `503 {"status":"starting",...}`. Say "LocalAI is starting up".
- **Up, key required:** `/healthz` `200` but `/v1/models` `401`. Say "Connected — API key required".

### Does anything report backend/GPU info? (the `/system_stats` analogue)

Yes — richer than a single stats route:

- **`GET /system`** (admin): `{"backends":[...], "loaded_models":[{"id","backend","size_vram","process":{"pid","rss_bytes","memory_percent","cpu_percent","started_at"}}]}`. Reports available backends, which backend serves each **loaded** model, per-process host memory/CPU, and (Linux) DRM-accounted `size_vram`. ([system-info](https://localai.io/docs/reference/system-info/index.html))
- **`GET /api/resources`** (admin): device list (GPU/CPU memory) — used by the UI placement bars.
- **`POST /api/models/vram-estimate`** (admin): `{sizeBytes, sizeDisplay, vramBytes, vramDisplay, model_max_context, context_note}` for a model at a given `context_size`. ([api-discovery](https://localai.io/docs/features/api-discovery/index.html))
- **`GET /metrics`**, **`GET /api/backend/monitor`**, **`GET /api/backend-traces`**, **`GET /api/backend-logs/:modelId`** (admin).
- Note `size_vram` is Linux/DRM-only and omitted on macOS/NVIDIA proprietary/driver gaps — treat an absent field as **unknown**, not zero. ([system-info](https://localai.io/docs/reference/system-info/index.html))

### Timeout guidance (LAN)

- **Verify (`/healthz` / `/.well-known/localai.json` / `/v1/models`):** connect **2–3 s**, total **5 s**. Anything slower is a network problem.
- **Enumeration (`/v1/models/capabilities` + `/api/models/capabilities`):** total **5–10 s**; both are single small JSON calls (no fan-out needed — capabilities are inline).
- **Per-model config (`/api/models/config-json/:name`):** small, but fan-out is O(models) — fetch lazily (on model select) or cap it.
- **Generation:** the **first** request after load may include model load time (seconds → minutes). Use a long overall timeout (engine convention elsewhere is minutes). A `503` on the first call is expected for a cold model — retry with backoff honoring `Retry-After`.

---

## 3. Model listing (every surface)

### 3.1 OpenAI-standard — `GET /v1/models` and `GET /models` (thin)

Both paths are **the same handler**. Response is id-only:

```json
{ "object": "list", "data": [ { "id": "qwen3-8b", "object": "model" } ] }
```

- Struct: `schema.OpenAIModel{ ID string json:"id"; Object string json:"object" }` — **no** `created`, **no** `owned_by`, **no** metadata. `[localai-source]` `core/http/endpoints/openai/list.go`, `core/schema/openai.go`
- **Query params:** `filter` (name filter), `excludeConfigured` (`""`/`true` = hide loose files already referenced by a config; `false` = include them). Per-user allowlist applies when auth is on. `[localai-source]` `core/http/endpoints/openai/list.go`

### 3.2 LocalAI-specific enriched — `GET /v1/models/capabilities` and `GET /models/capabilities` (**use this**)

Same set of models, enriched. Response (per [api-discovery](https://localai.io/docs/features/api-discovery/index.html) and `[localai-source]` `core/schema/openai.go`):

```json
{
  "object": "list",
  "data": [
    {
      "id": "qwen2.5-omni",
      "object": "model",
      "capabilities": ["chat", "vision", "tools"],
      "input_modalities": ["text", "image", "audio"],
      "output_modalities": ["text"],
      "context_size": 8192
    },
    {
      "id": "realesrgan-x4plus-anime-6b",
      "object": "model",
      "capabilities": ["upscale"],
      "input_modalities": ["image"],
      "output_modalities": ["image"],
      "upscale_scale": 4
    }
  ]
}
```

**Exhaustive per-model field set** (`schema.ModelCapabilities`):

| Field | Type | Meaning | Auto-detect use |
|---|---|---|---|
| `id` | string | Model name (API-callable) | identity |
| `object` | string | always `"model"` | — |
| `capabilities` | string[] | Canonical usecase strings + modifiers `tools`/`thinking` | **authoritative capability set** |
| `input_modalities` | string[] | subset of `{text,image,audio,video}` accepted | route attachments |
| `output_modalities` | string[] | subset of `{text,image,audio,video}` produced | route outputs |
| `context_size` | int (omitempty) | **effective** context window the backend runs with (`0` = unknown, e.g. loose file) | context budget/auto-compaction |
| `upscale_scale` | int (omitempty) | native upscale factor for `[upscale]` models | image upscaler UI |
| `three_d_operations` | string[] (omitempty) | 3D ops for 3D models | 3D UI |

Notes from the docs + source:
- `context_size` uses a **positive model-level value first**, else Settings → Performance → Default Context Size, else the backend fallback of **4096**; for llama.cpp with separate KV caches it accounts for the number of parallel slots. ([api-discovery](https://localai.io/docs/features/api-discovery/index.html))
- The docs list the canonical capability vocabulary as: **`chat`, `vision`, `transcript`, `tts`, `embeddings`, `image`, `video`** plus the modifiers **`tools`** and **`thinking`**; the source additionally resolves the full usecase set (see §7.1). ([api-discovery](https://localai.io/docs/features/api-discovery/index.html), `[localai-source]` `core/schema/openai.go`)
- Honors the same `filter`/`excludeConfigured` params and per-user allowlist as `/v1/models`. ([api-discovery](https://localai.io/docs/features/api-discovery/index.html))

### 3.3 UI JSON — `GET /api/models/capabilities` (adds the serving backend)

Not to be confused with `/v1/models/capabilities`. `[localai-source]` `core/http/routes/ui_api.go`:

```json
{
  "data": [
    {
      "id": "qwen3-8b",
      "capabilities": ["chat", "tools", "thinking"],
      "backend": "llama-cpp",
      "disabled": false,
      "pinned": false,
      "voice_cloning": { /* present only for cloning-capable TTS models */ },
      "upscaleScale": 0,
      "three_d_operations": ["..."],
      "loaded_on": [ { "node_id": "...", "node_name": "...", "state": "...", "node_status": "..." } ],
      "source": "registry-only"
    }
  ]
}
```

**Extra fields vs `/v1/models/capabilities`:** `backend` (**the serving backend name — the single best capability signal**), `disabled`, `pinned`, `voice_cloning`, `loaded_on` (distributed mode), `source`. It also lists loose files (no config) with `capabilities: []`. `[localai-source]` `core/http/routes/ui_api.go`

### 3.4 Full per-model config — `GET /api/models/config-json/:name` (admin)

Returns the **entire model YAML as JSON** — this is the endpoint that exposes everything the task asked about (backend, context, family, quantization, modalities, template, function, diffusers/tts blocks):

```bash
curl http://localhost:8080/api/models/config-json/my-model
```

`PATCH` deep-merges a JSON patch and writes YAML. ([api-discovery](https://localai.io/docs/features/api-discovery/index.html))

### 3.5 Config field metadata — `GET /api/models/config-metadata` (admin)

Structured metadata for **every** model config field (YAML path, Go type, UI type, label, description, default, validation, options), filterable by `?section=parameters`. Plus `GET /api/models/config-metadata/autocomplete/{backends|models|models:chat|models:tts|models:transcript|models:vad}` for dynamic values. ([api-discovery](https://localai.io/docs/features/api-discovery/index.html))

### 3.6 Gallery / availability (admin)

- `GET /models/available` — gallery entries (not installed configs) with `name`, `description`, `backend`, `tags`, license, variants. ([cli-reference/](https://localai.io/docs/reference/cli-reference/index.html), `[localai-source]` `core/http/routes/localai.go`)
- `GET /api/models` — the UI gallery browser (search/tag/backend/capability filters, `collapse_variants`). It is **gallery** data, not installed-model metadata. `[localai-source]` `core/http/routes/ui_api.go`
- `GET /models/galleries`, `GET /models/jobs[/:uuid]`, `POST /models/apply|import|import-uri`, `POST /models/delete/:name`, `POST /models/reload`, `PUT /models/toggle-state|toggle-pinned`, `GET /api/models/storage`.

### 3.7 `GET /models/local` — does **not exist**

There is no `/models/local` (or `/api/models/local`) route in current LocalAI. The closest equivalents are `/v1/models/capabilities` (§3.2), `/api/models/capabilities` (§3.3), and `/api/models/config-json/:name` (§3.4). `[localai-source]` `core/http/routes/localai.go`, `openai.go`, `ui_api.go` (full route scan).

**Verdict:** for the model picker + capability catalog, call **`GET /v1/models/capabilities`** (one call, capabilities + modalities + context). Enrich with **`GET /api/models/capabilities`** when the user has admin (adds `backend`), and **`GET /api/models/config-json/:name`** on model select for full detail. Never rely on `/v1/models`.

---

## 4. Per-model parameter support

### 4.1 Request shape

LocalAI's `/v1/chat/completions` request schema is a **union superset**: standard OpenAI fields **plus** LocalAI extensions, all top-level. `[localai-source]` `core/schema/openai.go` (`OpenAIRequest`), `core/schema/prediction.go` (`PredictionOptions`).

**Common sampling/decoding (any text model):**

| Wire name | Type | Default (config) | Notes |
|---|---|---|---|
| `temperature` | float | `0.9` | 0.0–2.0 |
| `top_p` | float | `0.95` | nucleus |
| `top_k` | int | `40` | **native name, accepted on `/v1`** |
| `min_p` | float | — | **native name, accepted on `/v1`** |
| `max_tokens` | int | `0` (unlimited) | |
| `max_completion_tokens` | int | — | modern alias; middleware collapses to `max_tokens` |
| `n` | int | `1` | number of completions |
| `stop` | string \| string[] | — | stop sequences |
| `seed` | int | `-1` (random) | |
| `repeat_penalty` | float | `1.1` | **native name** |
| `repeat_last_n` | int | `64` | **native name** |
| `frequency_penalty` | float | `0.0` | OpenAI |
| `presence_penalty` | float | `0.0` | OpenAI |
| `typical_p` | float | `1.0` | |
| `tfz` | float | `1.0` | tail-free-z |
| `n_keep` (`keep`) | int | `0` | tokens kept from prompt |
| `logprobs` | bool | `false` | |
| `top_logprobs` | int | `0` | 0–20 |
| `logit_bias` | map | `{}` | token-id → bias |
| `echo` | bool | `false` | |
| `batch` | int | — | native |
| `ignore_eos` | bool | — | native |
| `negative_prompt`, `rope_freq_base`, `rope_freq_scale`, `negative_prompt_scale`, `clip_skip`, `tokenizer` | — | — | image/RWKV-ish extensions |
| `stream`, `stream_options` | bool / object | — | SSE; `stream_options.include_usage` |

**Structured output / tools / reasoning (chat):**

| Feature | Wire field(s) | Notes |
|---|---|---|
| JSON mode / schema | `response_format` (any: `{"type":"json_object"}` or a `json_schema`) | Supported on llama.cpp-compatible models out of the box. ([openai-functions](https://localai.io/docs/features/openai-functions/index.html)) |
| Constrained grammar | `grammar` (string), `grammar_json_functions` (JSON schema object) | LocalAI extension. ([openai-functions](https://localai.io/docs/features/openai-functions/index.html)) |
| Function/tool calling | `tools`, `tool_choice`, `functions`, `function_call` | OpenAI shape; per-backend extraction (§4.3). ([openai-functions](https://localai.io/docs/features/openai-functions/index.html)) |
| Reasoning control | `reasoning_effort` (`none`/`minimal`/`low`/`medium`/`high`) | Forwarded as chat-template kwarg; also per-model `reasoning_effort:` in YAML. ([model-configuration](https://localai.io/docs/advanced/model-configuration/index.html)) |
| Per-request metadata | `metadata` (string→string) | e.g. `{"enable_thinking":"false","preserve_thinking":"true"}`. ([model-configuration](https://localai.io/docs/advanced/model-configuration/index.html)) |
| LocalAI routing hints | `backend`, `model_base_name` | LocalAI-specific; **omitempty** (leaking them upstream 400s). `[localai-source]` `core/schema/openai.go` |

### 4.2 Images / audio

- **`POST /v1/images/generations`** — `prompt`, `size`, `model`, `step`, `mode`, `negative_prompt`, `cfg_scale` (via config), `ref_images[]` (Flux Kontext), `file` (img2img/depth), `quality`. Negative prompts can also be inline via `prompt|negatives`. ([image-generation](https://localai.io/docs/features/image-generation/index.html))
- **`POST /v1/images/edits`** (inpainting) and **`/v1/images/inpainting`** — multipart `image`, `mask`, `prompt`, `model`.
- **`POST /v1/images/upscale`** — multipart `model`, `image`, `scale` (integer **1–16**, required; ESRGAN requires exact native scale). ([image-generation](https://localai.io/docs/features/image-generation/index.html))
- **`POST /v1/audio/transcriptions`** — multipart `file`, `model`, `language`, `prompt`, `temperature`, `timestamp_granularities[]` (`word`/`segment`), `response_format` (`json`|`verbose_json`|`text`|`srt`|`vtt`|`lrc`), `stream`, `diarize` (LocalAI extension). ([audio-to-text](https://localai.io/docs/features/audio-to-text/index.html))
- **`POST /v1/audio/speech`** (and **`POST /tts`**) — `input`, `model`, `voice`, `instructions` (delivery/tone), `response_format` (`wav`|`mp3`|`aac`|`flac`|`opus`; needs ffmpeg), `speed`, `stream` (SSE/chunked on supported backends), plus backend-specific `params` (string→string). ([text-to-audio](https://localai.io/docs/features/text-to-audio/index.html))
- **`GET /v1/audio/voices[?model=]`** — named voices with `language`/`gender`. ([text-to-audio](https://localai.io/docs/features/text-to-audio/index.html))
- **`POST /v1/sound-generation`**, **`/v1/audio/diarization`**, **`/v1/audio/classification`**, **`/v1/audio/vad`** (`/vad`), **`/v1/detection`**, **`/v1/depth`**, **`/v1/video/generations`**, **`/v1/3d/*`**, **`/v1/face/*`**, **`/v1/voice/*`**, **`/v1/tokenize`**, **`/v1/detokenize`**, **`/v1/rerank`**.

### 4.3 Which params are backend-dependent, and how to know what a model supports

Capability and parameter support is a function of the **backend** (see the compatibility matrix) plus the **model family**:

| Backend | GPT | Functions/tools | Embeddings | Multimodal | Streaming | Notes |
|---|---|---|---|---|---|---|
| `llama-cpp` | yes | yes | yes | (via `mmproj`) | yes | GGUF; the default. Native parser for tools; JSON mode built in. |
| `ik-llama-cpp` | yes | — | yes | (clip/llava) | yes | CPU/hybrid, IQK quants, AVX2+ |
| `turboquant` | yes | yes | yes | (mmproj) | yes | llama.cpp fork; TurboQuant KV types |
| `ds4` | yes | — | no | no | yes | DeepSeek V4 Flash single-model; `max_tokens` clamp quirk |
| `vllm.cpp` | yes | yes | no | — | yes | C++ vLLM port; engine-enforced structured output |
| `vLLM` / `vLLM Omni` | yes | yes | no | yes | yes | tool/reasoning parsers selected per model |
| `SGLang` | yes | yes | no | yes | yes | `tool_parser:`/`reasoning_parser:` |
| `transformers` | yes | — | yes | yes | yes* | |
| `MLX` / `MLX-VLM` | yes | yes | no | (VLM) | yes | Apple Silicon; tool parser auto-detected |
| `diffusers` | no | no | no | image/video | n/a | image/video generation |
| `stablediffusion-ggml` | no | no | no | image | n/a | SD/Flux/Ideogram/Qwen-Image; ESRGAN upscale |
| `whisper`/`whisper.cpp`, `faster-whisper`, `parakeet-cpp`, `voxtral`, `moonshine`, `NeMo-Speech.cpp`, `audio.cpp`, `CrispASR`, `sherpa-onnx` | no | no | no | audio→text | yes | transcription/diarization/classification |
| `piper`, `coqui`, `fish-speech`, `pocket-tts`, `qwen-tts`/`qwen3-tts-cpp`, `omnivoice-cpp`, `vibevoice`, `chatterbox`, `magpie-tts.cpp`, `moss-tts.cpp`, `audio.cpp`, `NeMo-Speech.cpp` | no | no | no | text→audio | yes (subset) | TTS / voice cloning |

Full matrix: [model-compatibility](https://localai.io/docs/model-compatibility/index.html).

**How to know what a given model supports:**
1. **`GET /v1/models/capabilities`** → `capabilities[]` + `input_modalities[]` + `output_modalities[]` + `context_size`. This is LocalAI's own resolver output — **authoritative** for configured models.
2. **`GET /api/models/capabilities`** → adds the serving `backend` (the key to parameter support) and `voice_cloning`.
3. **`GET /api/models/config-json/:name`** → the full YAML: `backend`, `context_size`, `parameters.*`, `mmproj`, `known_usecases`, `known_input_modalities`/`known_output_modalities`, `template`, `function`, `diffusers{}`, `tts{}`, `options[]`.
4. **`GET /api/models/config-metadata`** → every config field's definition/validation.

---

## 5. Param name mapping (native ↔ OpenAI-compat) + engine gaps

### 5.1 Wire-name mapping

LocalAI is unusual: the **`/v1` surface accepts the native names too**, so mapping is mostly 1:1. Differences are only where the *native* endpoint uses a non-OpenAI request shape (`/tts`, `/vad`, image params).

| Capability / intent | OpenAI-compat (`/v1/chat/completions`) | Native / other | Notes |
|---|---|---|---|
| temperature | `temperature` | `parameters.temperature` (YAML default) | 1:1 |
| top_p | `top_p` | `parameters.top_p` | 1:1 |
| top_k | `top_k` | `parameters.top_k` | **accepted on `/v1`** (LocalAI extension) |
| min_p | `min_p` | `parameters`/`options` | **accepted on `/v1`** |
| repeat penalty | `repeat_penalty` | `parameters.repeat_penalty` | **native name**, not `repetition_penalty` |
| repeat lookback | `repeat_last_n` | `parameters.repeat_last_n` | native name |
| frequency / presence penalty | `frequency_penalty` / `presence_penalty` | `parameters.*` | OpenAI |
| seed | `seed` | `parameters.seed` | 1:1 |
| max output tokens | `max_tokens` / `max_completion_tokens` | `parameters.max_tokens` | both accepted |
| stop | `stop` | `parameters`/`stopwords`/`cutstrings` | 1:1 |
| n | `n` | `parameters.n` | 1:1 |
| logprobs | `logprobs` / `top_logprobs` | `parameters.logprobs`/`top_logprobs` | 1:1 |
| structured output | `response_format` | `grammar` / `grammar_json_functions` | JSON mode + full schema |
| tools | `tools` / `tool_choice` / `functions` / `function_call` | `template.function`, `function{}` YAML | per-backend extraction |
| reasoning | `reasoning_effort` | YAML `reasoning_effort`, `reasoning{}`, `options.reasoning_format` | levels; `metadata.enable_thinking` per-request |
| TTS input | `input` (`/v1/audio/speech`) | `input` (`/tts`) | same field |
| TTS voice | `voice` | `voice` | named voice / `localai://voice-profiles/...` URI |
| TTS format | `response_format` (`wav`/`mp3`/`aac`/`flac`/`opus`) | `response_format` | needs ffmpeg for non-wav |
| TTS delivery | `instructions` | `instructions` | backend-dependent; ignored if unsupported |
| image size | `size` (`"256x256"`) | config `size`/`step`/`cfg_scale` | |
| image negative | `negative_prompt` or `prompt\|neg` | `negative_prompt` YAML | combined, comma-joined |
| image steps | `step` | `step` | |
| image mode | `mode` | — | img2img/depth |
| transcription format | `response_format` (`json`/`verbose_json`/`text`/`srt`/`vtt`/`lrc`) | same | |
| backend-specific extras | — | `params` map (TTS) / `options:` list (model YAML) | string→string |

Sources: [text-generation](https://localai.io/docs/features/text-generation/index.html), [model-configuration](https://localai.io/docs/advanced/model-configuration/index.html), [image-generation](https://localai.io/docs/features/image-generation/index.html), [text-to-audio](https://localai.io/docs/features/text-to-audio/index.html), [audio-to-text](https://localai.io/docs/features/audio-to-text/index.html); `[localai-source]` `core/schema/prediction.go`, `core/schema/openai.go`.

### 5.2 Our engine client's current mapping + gaps

There is **no dedicated LocalAI chat client** in the engine. `[engine-code]`

- `providers/registry.go` registers 13 providers; **none is `localai`**. `config/config.go` defines chat providers (`ProviderOpenAI`, `ProviderOpenAICompatible`, `ProviderOpenRouter`, …) but **no `ProviderLocalAI`** — only `RagProviderLocalAI = "localai"`.
- LocalAI chat therefore rides **`OpenAICompatibleProvider`** (`providers/openaicompatible.go`) pointed at `http://host:8080/v1`. Its mapping:
  - `buildParams` maps: `temperature`, `top_p`, `max_tokens`, `max_completion_tokens`, `frequency_penalty`, `presence_penalty`, `n`, `stop`, `seed`, `response_format` (as an extra field), plus sampling presets and free-form `extraParams` (via `SetExtraFields`). `[engine-code]`
  - It does **not** map `top_k`, `min_p`, `repeat_penalty`, `reasoning_effort` as typed fields — but because `extraParams` is passed through `SetExtraFields` verbatim, a user **can** send `top_k`/`min_p`/`repeat_penalty` via `extraparams` and **LocalAI will honor them** (unlike Ollama's `/v1`, which ignores them). This is the LocalAI-specific win. `[engine-code]`
  - `providers/openai.go` (the first-party OpenAI client) additionally maps `reasoning_effort`; `openaicompatible.go` does **not** carry a `reasoningEffort` field. `[engine-code]`
  - `ValidateConfig` / `ListModels` for the OpenAI-compatible provider call `GET /v1/models` and return only `{ID, Name}` — the thin path. `[engine-code]`
- **RAG LocalAI is a separate, hardcoded path:** `modules/rag/validation.go:107` and `vector_store.go:62` call `chromem.NewEmbeddingFuncLocalAI(model)`; the fork (`harmony-ai-solutions/chromem-go v0.7.1`, `embed_compat.go`) hardcodes `const baseURLLocalAI = "http://localhost:8080/v1"` and an **empty API key**. `[engine-code]` `config.RAGLocalAIConfig` carries **only `EmbeddingModel`** (`config/types.go:644`) — no `base_url`, no `api_key`. So a LocalAI instance that is not on `localhost:8080`, or that requires a key, is **unreachable** through the engine's RAG path today.
- `[app-code]` the app's `localai` schema is name + model only, `hasModelFetch: false` (`src/constants/providerFieldSchemas.ts:152`, `moduleDefaults.ts:110`, `src/database/models.ts:227`). And LocalAI is **not** even listed in the RAG module's `providerOptions` (`src/constants/moduleConfiguration.ts:56` lists only `openai`, `openaicompatible`, `openrouter`, `soulbitscloud`).

**Consequence:** the engine has a working path for LocalAI chat via the OpenAI-compatible client (and native params survive via `extraParams`), but it is **mislabeled**, has **no `localai` account type**, has **no configurable base URL/key on the RAG side**, and its model listing is the thin `/v1/models` path. All four need fixing for this workstream.

---

## 6. Quirks

### Model hot-loading latency

- The **first** request for a model that is not loaded triggers a load (seconds → minutes depending on size/quant/offload). LocalAI returns **HTTP 503 (retryable)** while a model is **cold-loading**, and again during the **load-failure cooldown** (`--model-load-failure-cooldown`, default `10s`, doubling per consecutive failure up to `5m`, reset on success; `0` disables). ([api-errors](https://localai.io/docs/reference/api-errors/index.html), [runtime-errors](https://localai.io/docs/reference/runtime-errors/index.html))
- Backends can be **evicted**: `--max-active-backends` (LRU eviction; `1` = single-backend mode), plus idle/busy watchdogs (`--watchdog-idle-timeout` default `15m`). A request after eviction re-loads. ([cli-reference](https://localai.io/docs/reference/cli-reference/index.html))
- `[engine-code]` the engine's OpenAI-compatible client uses `context.Background()` with no per-call timeout override; ensure a long timeout for the first (cold) request.

### config.yaml vs auto-download models

- Models are defined by **YAML config files** in the models directory, or a single `--models-config-file` (a list), or remote YAML URLs. Minimal config: `{name, backend, parameters.model, context_size, threads}`. ([model-configuration](https://localai.io/docs/advanced/model-configuration/index.html))
- **Auto-download / auto-configure:** referencing a gallery model name that is not configured makes LocalAI download and configure it on demand (galleries enabled by default). `local-ai run <gallery-name>`, `local-ai models install <name>`, `POST /models/apply`. ([text-generation](https://localai.io/docs/features/text-generation/index.html), [getting-started/models](https://localai.io/docs/getting-started/models/index.html))
- **Auto backend selection:** LocalAI tries to auto-detect the backend for unconfigured models; not all backends support autoload, so pin `backend:` when it matters. ([model-compatibility](https://localai.io/docs/model-compatibility/index.html))
- **"Only one model ⇒ used for all requests"**, and **the model name may be embedded in the OpenAI token** (the `Authorization: Bearer <model>` trick). ([text-generation](https://localai.io/docs/features/text-generation/index.html), `[localai-source]` `model_listing_routes_test.go`)
- **GGUF header cache:** when a config omits values, LocalAI reads the GGUF header (layer count, trained context, chat template, token ids, MTP head) and caches it in `header-cache.json`. Not client-visible, but explains why the first load of a GGUF is slower. ([model-configuration](https://localai.io/docs/advanced/model-configuration/index.html))

### Backend matrix

See §4.3 and the full [model-compatibility](https://localai.io/docs/model-compatibility/index.html) table. Key point for auto-detect: **`backend` is exposed per installed model** via `GET /api/models/capabilities` and per loaded model via `GET /system`.

### Threads / parallelism

- `--threads` / `LOCALAI_THREADS` (server-wide), per-model `threads:` (a nonzero server `--threads` wins over the YAML value).
- `--max-concurrent-backend-requests` (default `1024`) — process-wide inference ceiling; overflow → **429 + Retry-After**.
- Per-model `MaxConcurrent` → **429** when exceeded.
- llama.cpp: `options: [parallel:N]` / `LLAMACPP_PARALLEL` for continuous batching; python backends: `PYTHON_GRPC_MAX_WORKERS`. ([cli-reference](https://localai.io/docs/reference/cli-reference/index.html), [advanced](https://localai.io/docs/advanced/index.html))

### Gallery models

- Galleries are JSON indexes (e.g. HuggingFace). `GET /models/galleries`, `GET /models/available`, `POST /models/apply`. Install/import runs as an async **job** (`/models/jobs/:uuid`) with progress. `[localai-source]` `core/http/routes/localai.go`; [getting-started/models](https://localai.io/docs/getting-started/models/index.html)

### Differences from the OpenAI spec

- **`/v1/models` is id-only** — no `created`/`owned_by`. `[localai-source]` `core/schema/openai.go`
- **Error shape** is OpenAI-ish (`{"error":{"code","message","type","param"}}`) for most endpoints, but `/v1/messages` returns Anthropic shape and `/v1/responses` returns an Open Responses shape. `[localai-source]` [api-errors](https://localai.io/docs/reference/api-errors/index.html)
- **Streaming quirk (llama.cpp):** if the backend fails **before the first chunk** (e.g. prompt exceeds context), the request fails with an **HTTP error** and the message is **not** streamed as assistant content; an error **after** streaming starts is reported **inside the stream**. ([text-generation](https://localai.io/docs/features/text-generation/index.html))
- **Extra response fields:** `Extra-Usage: true` request header adds `usage.timing_prompt_processing` / `usage.timing_token_generation` (ms). ([advanced](https://localai.io/docs/advanced/index.html))
- **Extra endpoints** beyond OpenAI: `/v1/messages` (Anthropic), `/v1/responses` (Open Responses, incl. WebSocket), `/v1/slots/save|restore` (llama.cpp prompt-cache), `/v1/tokenize|detokenize`, `/v1/detection|depth`, `/v1/face/*`, `/v1/voice/*`, `/v1/audio/diarization|classification|voices`, `/v1/sound-generation`, `/v1/video/generations`, `/v1/3d/*`, `/stores/*`, `/mcp/*`, `/api/*` admin/UI. ([api-discovery](https://localai.io/docs/features/api-discovery/index.html), `[localai-source]` route scan)
- **`--opaque-errors`** blank-out mode; **`--disable-api-key-requirement-for-http-get`** GET exemption for legacy keys.

---

## 7. Auto-detect recipe (decision tree)

### 7.1 Capability vocabulary (what to look for)

From `capabilities[]` (canonical usecase strings + modifiers):

`chat`, `completion`, `edit`, `embeddings`, `rerank`, `transcript`, `diarization`, `sound_classification`, `sound_generation`, `tts`, `image`, `upscale`, `detection`, `depth`, `face_recognition`, `speaker_recognition`, `audio_transform`, `vad`, `video`, `3d`, `3d_animation`, `tokenize`, `decisions`, plus the modifiers **`tools`** and **`thinking`**.

Docs-documented subset: `chat`, `vision`, `transcript`, `tts`, `embeddings`, `image`, `video`, `tools`, `thinking`. ([api-discovery](https://localai.io/docs/features/api-discovery/index.html); the broader set is visible in `[localai-source]` `core/http/routes/model_listing_routes_test.go` and `core/schema/openai.go`.)

Modality vocabulary: `text`, `image`, `audio`, `video` (input/output).

### 7.2 Decision tree

```
1. GET {base}/.well-known/localai.json         -> is it LocalAI? version? which endpoints exist?
2. GET {base}/healthz (or /readyz)             -> alive / ready
3. GET {base}/v1/models/capabilities           -> per model: capabilities[], in/out modalities, context_size
   (fallback: GET {base}/v1/models              -> names only, if capabilities endpoint 404s on an old build)
4. GET {base}/api/models/capabilities          -> per model: + backend, disabled, pinned, voice_cloning
   (requires admin when auth is on; skip/soft-fail otherwise)
5. For each model:
   a. IF /v1/models/capabilities entry has non-empty capabilities[]:
         capability set := capabilities[]                    confidence = KNOWN
         context         := context_size (if >0)             confidence = KNOWN
   b. ELSE IF /api/models/capabilities gives backend:
         derive from backend + name family (§7.3)            confidence = DETECTED
   c. ELSE (no config, loose file; capabilities[] empty):
         derive from model id signature heuristics (§7.3)    confidence = ASSUMED
6. OPTIONAL deep-dive on model select:
      GET {base}/api/models/config-json/:name  -> backend, quantization, mmproj, template, function, tts{}
7. Merge into registry: live > static catalog > user override (warn, don't block)
```

### 7.3 Backend / name → capability heuristics (DETECTED / ASSUMED tier)

Use these only when `capabilities[]` is empty (unconfigured loose files) or for catalog seeding. `backend` comes from `/api/models/capabilities` or `/system`; the name is the model id.

| Capability | Signals | Example ids |
|---|---|---|
| **chat / completion** | backend ∈ {`llama-cpp`, `ik-llama-cpp`, `turboquant`, `ds4`, `vllm.cpp`, `vllm`, `vllm-omni`, `sglang`, `transformers`, `mlx`, `mlx-vlm`, `tinygrad`, `rkllm`}; name ∋ {`llama`, `qwen`, `mistral`, `mixtral`, `gemma`, `phi`, `deepseek`, `granite`, `hermes`, `yi`, `falcon`, `rwkv`, `starcoder`, `gpt-oss`} | `qwen3-8b`, `llama-3.2-1b-instruct` |
| **vision** | name ∋ {`llava`, `vision`, `vl`, `qwen2-vl`/`qwen2.5-vl`/`qwen3-vl`, `minicpm-v`, `moondream`, `bakllava`, `gemma3`/`gemma4`, `pixtral`, `internvl`, `omni`}; config has `mmproj`; `input_modalities` ∋ `image` | `llava`, `qwen3-vl-8b`, `qwen2.5-omni` |
| **tools** | `capabilities` modifier `tools`; name ∋ {`qwen2.5`, `qwen3`, `llama3.1`/`3.2`/`3.3`, `mistral`, `mixtral`, `hermes`, `command-r`, `granite`, `gpt-oss`}; vLLM `tool_parser:` set | `qwen3-8b`, `hermes-2-theta-llama-3-8b` |
| **thinking** | `capabilities` modifier `thinking`; name ∋ {`deepseek-r1`, `qwen3`, `gpt-oss`, `magistral`, `reasoning`} | `deepseek-r1`, `qwen3` |
| **embeddings** | backend ∈ {`llama-cpp`, `transformers`, `tinygrad`} **and** name ∋ {`embed`, `bge`, `gte`, `e5`, `minilm`, `nomic`, `mxbai`, `jina`, `snowflake`}; `/api/models/config-metadata/autocomplete/models:chat` excludes it | `bert-cpp-minilm-v6`, `bge-m3`, `all-MiniLM-L6-v2` |
| **rerank** | name ∋ {`rerank`, `bge-reranker`, `jina-reranker`} | `bge-reranker-v2-m3` |
| **transcript** | backend ∈ {`whisper`, `faster-whisper`, `whisperx`, `parakeet-cpp`, `voxtral`, `moonshine`, `nemo`, `nemo-speech-cpp`, `audio.cpp`, `crispasr`, `sherpa-onnx`, `qwen-asr`, `llama-cpp`+audio `mmproj`}; name ∋ {`whisper`, `parakeet`, `moonshine`, `voxtral`, `asr`, `canary`} | `whisper-1`, `parakeet-110m`, `qwen3-asr` |
| **diarization / sound_classification / vad** | backend ∈ {`parakeet-cpp`, `audio.cpp`, `nemo-speech-cpp`}; name ∋ {`diar`, `vad`, `silero`, `ced`} | `nemotron-3-diarization`, `silero-vad` |
| **tts** | backend ∈ {`piper`, `coqui`, `fish-speech`, `pocket-tts`, `qwen-tts`, `qwen3-tts-cpp`, `omnivoice-cpp`, `vibevoice`, `chatterbox`, `magpie-tts.cpp`, `moss-tts.cpp`, `audio.cpp`, `nemo-speech-cpp`} **or** `llama-cpp` with `known_usecases:[tts]`; `voice_cloning` present | `pocket-tts`, `qwen3-tts-llamacpp` |
| **image** | backend ∈ {`stablediffusion-ggml`, `diffusers`, `vllm-omni`}; name ∋ {`sd`, `flux`, `animagine`, `sdxl`, `sana`, `kontext`, `qwen-image`} | `flux.1-dev-ggml`, `animagine-xl` |
| **upscale** | `capabilities` ∋ `upscale` / `upscale_scale>0`; name ∋ {`upscaler`, `esrgan`, `realesrgan`} | `realesrgan-x4plus-anime-6b` |
| **video** | backend ∈ {`diffusers`, `mlx-video`, `vllm-omni`}; name ∋ {`video`, `svd`, `wan`, `ltx`} | `txt2vid`, `img2vid` |
| **detection / depth / face_recognition / speaker_recognition / audio_transform / 3d** | backend ∈ {`rf-detr(.cpp)`, `locate-anything.cpp`, `depth-anything.cpp`, `sam3.cpp`, `face-detect.cpp`, `insightface`, `voice-detect.cpp`, `speaker-recognition`, `localvqe`, `ace-step(.cpp)`} | `rf-detr`, `depth-anything` |

Backend sets from [model-compatibility](https://localai.io/docs/model-compatibility/index.html).

### 7.4 Confidence labels (for the picker chips)

| Label | Source | Meaning |
|---|---|---|
| `known` | `capabilities[]` / `input_modalities[]` / `output_modalities[]` / `context_size` from `/v1/models/capabilities` | Authoritative, server-resolved. |
| `detected` | `backend` from `/api/models/capabilities` (or `/system`) + §7.3 heuristics | Structurally derived from the serving backend. |
| `assumed` | model-id substring heuristics only (unconfigured loose file) | Best-effort; may be wrong. |

---

## 8. Recommendations

### 8.1 Exact verify call (the "Test" button)

```
1. GET {base_url}/.well-known/localai.json       # anonymous; identity + version + endpoint map
   Headers: (optional) Authorization: Bearer <api_key>
   Timeouts: connect 2-3s, total 5s
   Success: HTTP 200 AND JSON parses with a non-empty "version"
            -> "LocalAI <version>"

2. GET {base_url}/healthz                          # anonymous; liveness fallback
   Success: HTTP 200 (empty body)

3. GET {base_url}/v1/models                        # auth-aware; OpenAI surface + model count
   Headers: (optional) Authorization: Bearer <api_key>
   Success: HTTP 200 AND data[] parses -> "LocalAI <version> · N models"
```

- **Primary verify:** `GET /.well-known/localai.json` — anonymous, proves it is LocalAI, gives a version, and (via `capabilities{}`) tells us which features exist. This is strictly better than `/v1/models` (which 401s when a key is required).
- **Fallback chain:** `/.well-known/localai.json` → `/healthz` → `/readyz` → `/v1/models`. If only `/v1/models` works (and the well-known/healthz 404), it's a **generic OpenAI-compatible server** — route to the OpenAI-compatible provider, not LocalAI.
- **Distinct messages per failure class:** connection refused (not running / loopback-only bind / firewall), TLS mismatch, `401` "key required", `403` "connected, admin needed for details", `503` "starting/loading", HTML body (wrong host / Web UI), empty list ("connected, no models configured").
- **Optional key:** the UI must offer an **optional API key** field. `POST /api/providers/verify {type:"localai", base_url, api_key?}` → `{valid, detail:"LocalAI v2.28.0 · 3 models"}`.
- **Per workstream plan §3.4**, keep it side-effect-free and DB-free (it is: all GETs).

### 8.2 Exact enumerate call (the "Fetch from provider" / model picker)

```
1. GET {base_url}/v1/models/capabilities           # PRIMARY: id + capabilities[] + modalities + context_size
   Headers: (optional) Authorization: Bearer <api_key>
2. GET {base_url}/api/models/capabilities          # ENRICH (admin): + backend, disabled, pinned, voice_cloning
3. GET {base_url}/api/models/config-json/:name     # DEEP (admin, on model select): full config
```

- **Use `/v1/models/capabilities`, never `/v1/models`** for capability data. One call carries everything the picker needs.
- **Fallback:** if `/v1/models/capabilities` 404s (older LocalAI), fall back to `/v1/models` and derive capabilities from the model-id heuristics in §7.3 (`assumed`).
- **Cache:** `/v1/models/capabilities` 30–60 s; `/api/models/capabilities` 30–60 s; `/api/models/config-json/:name` 5–15 min per model.
- **Shape to return** (per plan §3.4): `{models:[{id, label, context, capabilities, source:"live"|"catalog"}]}` with a provenance chip (`known`/`detected`/`assumed`).
- **Auth note:** `/api/models/*` is admin-only when auth is enabled; the picker must degrade to `/v1/models/capabilities` (any authenticated user) and mark `backend` as unknown in that case.

### 8.3 Capability-source verdict

**Rich live.** LocalAI is a best-case provider for auto-detect:
- `GET /v1/models/capabilities` → per-model `capabilities[]` + `input_modalities[]` + `output_modalities[]` + `context_size` — LocalAI's own resolver output, anonymous-friendly.
- `GET /api/models/capabilities` → adds the serving `backend` and `voice_cloning`.
- `GET /api/models/config-json/:name` → the full config (backend, quantization, `mmproj`, template, function, diffusers/tts blocks).
- `GET /system` → backends + loaded models + VRAM/CPU.

Seed the static catalog only as a **fallback for older LocalAI builds** (missing `/v1/models/capabilities`) and for the id-signature heuristics in §7.3. The engine catalog should also carry the **native↔compat param-name mapping** (§5.1) — but note that for LocalAI the `/v1` surface already accepts native names, so the "unsupported param" set is small (only truly backend-specific params, e.g. TTS `params`, image `mode`).

### 8.4 Engine client notes

1. **Route LocalAI chat through the OpenAI-compatible client** (`base_url = http://host:8080/v1`), but **label it correctly**. Options: (a) add `config.ProviderLocalAI = "localai"` as an alias that instantiates `OpenAICompatibleProvider` with LocalAI defaults (recommended — keeps one code path, gives the UI a distinct type), or (b) keep `openaicompatible` and document it. Either way, a LocalAI chat request must work out of the box with no key. `[engine-code]`
2. **Make the key optional and sent when present.** `ConnectToBackend` already does `option.WithAPIKey(p.apiKey)`; ensure an empty key is not rejected by LocalAI (it isn't) and that `extraParams`/`response_format`/`reasoning_effort` survive.
3. **`ValidateConfig` should not use `/v1/models` as the only probe.** Prefer `GET /.well-known/localai.json` (anonymous, proves LocalAI, returns version), then `/healthz`, then `/v1/models`. Treat empty `data[]` as **valid** ("connected, no models"). `[engine-code]`
4. **Implement `ListModels` against `/v1/models/capabilities`**, returning richer `common.ModelInfo` (capabilities, input/output modalities, context_size). The current `ModelInfo{ID,Name}` is too thin for the registry. `[engine-code]`
5. **Expose the full option set:** map `top_k`, `min_p`, `repeat_penalty`, `repeat_last_n`, `reasoning_effort` as first-class fields on the LocalAI/OpenAI-compatible config (they are currently only reachable via `extraparams`). Note the DB↔runtime divergence risk (the Ollama research flagged `TopK`/`MinP`/`RepetitionPenalty` present in a DB model but absent from the runtime struct) — do not repeat it here. `[engine-code]`
6. **Fix the RAG LocalAI path.** `chromem.NewEmbeddingFuncLocalAI` hardcodes `http://localhost:8080/v1` and an empty key; `config.RAGLocalAIConfig` has only `EmbeddingModel`. Add `BaseURL` + `ApiKey` to `RAGLocalAIConfig` and switch the call to `chromem.NewEmbeddingFuncOpenAICompat(baseURL, apiKey, model, nil)` (the LocalAI constructor is a thin wrapper over it). Otherwise any non-localhost or key-protected LocalAI is unreachable. `[engine-code]`
7. **Timeouts:** 5 s for verify/enumerate; long (minutes) for generation; handle **503 cold-load** as retryable (backoff honoring `Retry-After`) and surface a "loading model…" state.
8. **App-side schema (`[app-code]`):** add `base_url` (placeholder `http://localhost:8080`) and an optional `api_key` to the `localai` schema in `providerFieldSchemas.ts`; flip `hasModelFetch: true` and replace the free-text `model` field with a picker fed by `POST /api/providers/models`; add `localai` to the RAG module's `providerOptions` in `moduleConfiguration.ts` (currently absent) and update `moduleDefaults.ts`/`models.ts`/`providers.ts` accordingly.

---

## Sources

Doc site: https://localai.io · Upstream repo: https://github.com/mudler/LocalAI (`master`)

- API discovery & instructions (`/.well-known/localai.json`, `/api/instructions`, `/v1/models/capabilities`, config-metadata, VRAM estimate): https://localai.io/docs/features/api-discovery/index.html
- Text generation (`/v1/chat/completions`, params, Anthropic `/v1/messages`, Open Responses `/v1/responses`, llama.cpp options, prompt cache): https://localai.io/docs/features/text-generation/index.html
- Authentication & authorization (legacy `LOCALAI_API_KEY`, header list, anonymous routes, admin routes, 401/403): https://localai.io/docs/features/authentication/index.html
- Advanced usage (YAML config, backends, env vars, request headers, concurrency, `.env`): https://localai.io/docs/advanced/index.html
- Model configuration (all YAML fields, parameters, known modalities, reasoning, templates, diffusers/tts blocks): https://localai.io/docs/advanced/model-configuration/index.html
- System info & version (`/system`, `/version`, `size_vram`, process stats): https://localai.io/docs/reference/system-info/index.html
- CLI reference (`--address`, `--cors`, `--cors-allow-origins`, `--threads`, `--max-concurrent-backend-requests`, `--model-load-failure-cooldown`, `--max-active-backends`, watchdogs, `--api-keys`): https://localai.io/docs/reference/cli-reference/index.html
- API error reference (error envelopes, status codes incl. 429/503, 401 body, `--opaque-errors`): https://localai.io/docs/reference/api-errors/index.html
- Runtime errors & troubleshooting (cold-load 503, cooldown, `could not load model`, VRAM OOM, SIGILL, slow performance): https://localai.io/docs/reference/runtime-errors/index.html
- Model compatibility table (backend → capability/acceleration matrix): https://localai.io/docs/model-compatibility/index.html
- Image generation (`/v1/images/generations`, edits, upscale, ESRGAN, diffusers pipelines, schedulers): https://localai.io/docs/features/image-generation/index.html
- Text to audio (TTS) (`/tts`, `/v1/audio/speech`, `/v1/audio/voices`, `instructions`, `params`, streaming, `response_format`): https://localai.io/docs/features/text-to-audio/index.html
- Audio to text (`/v1/audio/transcriptions`, form fields, `response_format`, `stream`, `diarize`, backends): https://localai.io/docs/features/audio-to-text/index.html
- OpenAI functions & tools (per-backend tool extraction, JSON mode, `grammar_json_functions`, parallel calls): https://localai.io/docs/features/openai-functions/index.html
- Setting up models (galleries, imports, HuggingFace/OCI/Ollama URIs, `local-ai models list`, `GET /api/tags`): https://localai.io/docs/getting-started/models/index.html

### Upstream source (`[localai-source]`)

- Route registrations, `/models` + `/v1/models` + `/v1/models/capabilities`: https://github.com/mudler/LocalAI/blob/master/core/http/routes/openai.go
- Native/admin routes (no `/models/local`), `/.well-known/localai.json` content: https://github.com/mudler/LocalAI/blob/master/core/http/routes/localai.go
- Health probes (`/healthz`, `/readyz`): https://github.com/mudler/LocalAI/blob/master/core/http/routes/health.go
- UI JSON routes (`/api/models/capabilities`, `/api/models`, config-json, resources): https://github.com/mudler/LocalAI/blob/master/core/http/routes/ui_api.go
- `ListModelsEndpoint` + `listVisibleModelNames` (id-only, `filter`/`excludeConfigured`): https://github.com/mudler/LocalAI/blob/master/core/http/endpoints/openai/list.go
- `ListModelCapabilitiesEndpoint` (enriched listing): https://github.com/mudler/LocalAI/blob/master/core/http/endpoints/openai/list_capabilities.go
- `schema.OpenAIModel`, `ModelsDataResponse`, `ModelCapabilities`, `OpenAIRequest`: https://github.com/mudler/LocalAI/blob/master/core/schema/openai.go
- `schema.PredictionOptions` (native param names: `top_k`, `min_p`, `repeat_penalty`, …): https://github.com/mudler/LocalAI/blob/master/core/schema/prediction.go

### Engine/app code references (`[engine-code]` / `[app-code]`)

- Engine registry (no `localai` chat provider): `harmony-link-private/providers/registry.go`
- OpenAI-compatible client (`buildParams`, `ValidateConfig`→`/v1/models`, `ListModels`→`{ID,Name}`, `SetExtraFields`): `harmony-link-private/providers/openaicompatible.go`
- First-party OpenAI client (maps `reasoning_effort`): `harmony-link-private/providers/openai.go`
- Provider constants (`ProviderOpenAICompatible`, `RagProviderLocalAI`): `harmony-link-private/config/config.go`
- Chat provider struct: `harmony-link-private/config/types.go:397` (`OpenAICompatibleProviderConfig`)
- RAG config (`RAGConfig` / `RAGLocalAIConfig{EmbeddingModel}`): `harmony-link-private/config/types.go:626,644`
- RAG LocalAI wiring (hardcoded constructor): `harmony-link-private/modules/rag/validation.go:107`, `modules/rag/vector_store.go:62`
- chromem fork hardcoded base URL (`const baseURLLocalAI = "http://localhost:8080/v1"`, empty key): `harmony-ai-solutions/chromem-go v0.7.1`, `embed_compat.go`
- LocalAI DB model/repo: `harmony-link-private/database/models/provider_localai.go`, `database/repository/providers/localai.go`
- App provider schema (name+model only, `hasModelFetch:false`): `harmony-ai-app/src/constants/providerFieldSchemas.ts:152`
- App defaults: `harmony-ai-app/src/constants/moduleDefaults.ts:110`
- App DB model: `harmony-ai-app/src/database/models.ts:227`
- App repo adapters: `harmony-ai-app/src/services/engine/repositories/providers.ts:259`
- App RAG module provider options (LocalAI absent): `harmony-ai-app/src/constants/moduleConfiguration.ts:56`
- Workstream plan (R10 verify/models endpoints, R12 catalog): `harmony-ai-app/.current_work/provider-registry/plan.md`
