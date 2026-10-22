# SoulbitsCloud Provider — Research (engine client + inference gateway)

Workstream: Provider Registry (plan.md §6.4 R11). Read-only research.
Repos read:
- Engine client: `harmony-link-private` — `providers/soulbitscloud.go`, `config/{types,soulbits,db/init}.go`, `modules/common/client.go`, `management/routes_providers.go`.
- Gateway: `soulbits-cloud-backend` — `cmd/inference-gateway/**`, `pkg/{auth,paseto,config,ratelimit,inference}/**`, `cmd/auth-service/**`, `db/migrations/**`, `pkg/openapi/openapi.yaml`.
- Client library: `soulbits-api-client-go` — `{client,config,inference,models,errors,auth}.go`, `gen/client.go`.
- App: `harmony-ai-app` — `src/config/cloud.ts`, `src/constants/{moduleDefaults,providerFieldSchemas,soulbitsModels}.ts`, `src/services/cloud/{soulbitsModelsCatalog,soulbitsTokenSync}.ts`, `src/components/config/SoulbitsModelSelect.tsx`.

Fact tags: **[engine-code]** = harmony-link-private; **[gateway-code]** = soulbits-cloud-backend; **[client-lib]** = soulbits-api-client-go; **[app-code]** = harmony-ai-app.

---

## 1. Current state

### 1.1 Engine client — what `providers/soulbitscloud.go` supports today [engine-code]

Source: `harmony-link-private/providers/soulbitscloud.go` (664 lines).

**Provider identity & config**
- `Name()` returns `config.ProviderSoulbitsCloud` = `"soulbitscloud"` (`config/config.go:42`).
- Config struct `SoulbitsCloudProviderConfig` (`config/types.go:548-578`): `BaseURL`, `APIKey`, `Model`, `MaxTokens`, `MaxCompletionTokens`, `Temperature`, `TopP`, `FrequencyPenalty`, `PresencePenalty`, `N`, `StopTokens`, `Seed`, `ResponseFormat`, `SamplingPresetName`, `ExtraParams`, `Voice`, `Speed`, `Format`, `Language`, `ImageAspectRatio`, `ImageSize`. The same struct is embedded in every module config type (backend/cognition/movement/rag/tts/stt/vision/imagination) — it is the module "capability" shape today.

**`ConnectToBackend()` (lines 61-101)**
- `inferURL = p.baseURL`; if empty, falls back to `config.SoulbitsCloudBaseURL()`.
- Builds an explicit `http.Client{Timeout: 2 * time.Minute}` (deliberate — gateway LLM timeout is 120s; vision base64 can exceed the client-lib 30s default).
- `soulbits.Config{InferenceBaseURL: inferURL, HTTPClient: httpClient}`; **`CloudBaseURL` intentionally omitted** — relies on the client lib's `ensureDefaults()` default (`https://beta.cloud.soulbits.app`). Comment: it is only used by PASETO refresh, which is disabled in cloud mode.
- **Auth mode switch by prefix:** if `apiKey` starts with `"v4.local."` → `cfg.PasetoToken = p.apiKey` (cloud mode, refresh disabled — no `RefreshToken`); else `cfg.APIKey = p.apiKey` (standalone mode).
- Then `soulbits.New(cfg)`.

**`ValidateConfig()` (lines 144-152)**
- Connects (if needed), then calls `p.client.ListModels(ctx, nil)` and returns its error.
- ⚠️ **This does NOT validate the credential** — `GET /v1/models` is public/unauthenticated on the gateway (see §2/§4). An empty or invalid `api_key` still passes `ValidateConfig`.

**`ListModels(filter)` (lines 360-393)**
- Maps `common.ModelFilterOptions{ModelType, InputData, OutputData}` → `soulbits.ModelFilter{ModelType, InputModalities, OutputModalities}`; sends them as gateway query params.
- Returns `[]common.ModelInfo{ID: m.ModelId, Name: m.DisplayName}` — **drops** `description`, `model_type`, `min_tier`, `input/output_modalities`, `context_window`, `embedding_dimensions`, `speech_options`. `common.ModelInfo` today has only `{ID, Name, Description}` (`modules/common/client.go:19-23`).

**Chat / completions**
- `buildChatParams()` (lines 163-273) builds `gen.ChatCompletionRequest`: applies a named sampling preset (`config.ApplicationConfig.ResolvePreset`), then `ExtraParams`, then direct overrides (`max_tokens`, `top_p`, `temperature`, freq/presence penalty, `seed`).
- **`max_completion_tokens` is NOT a struct field — it is pushed via `params.Set("max_completion_tokens", v)`** (line 236, comment: "HSE gateway ignores max_completion_tokens; send as extra").
- `stop` and `n` likewise go through `params.Set(...)` (the generated `Stop` is a union type).
- `response_format` is parsed from a JSON string and set as a raw map.
- `SendUserMessage` / `SendComplexPromptSync` (lines 275-358): system+user messages, `client.Chat`, read `choices[0].message.content` as a string.
- `AllowsCustomPrompting()` = true; `GetChatHistory()` returns nil (history managed by prompt assembly).

**Vision**
- `AnalyzeImage` / `AnalyzeImages` (lines 395-504): builds a `ChatMessageContent1` parts array (`text` + `image_url` with `data:<mime>;base64,<...>`), sends via `client.Chat`. Same model as chat config (`p.model`) — vision reuses the chat model id (must be a multimodal model).

**STT / VAD**
- `TranscribeAudio` (lines 510-526): `gen.STTRequest{Model, InputAudio}` → `client.STT`.
- `DetectVoiceActivity` (lines 532-548): `gen.VADRequest{Model, InputAudio}` → `client.VAD`.
- Both reuse `p.model` (each module config owns its own provider row; STT owns two rows — transcription + VAD).

**TTS**
- `RenderSpeech` (lines 557-607): `gen.TTSRequest{Model, Input, Mode: SingleSpeakerTts, Voice (default "claire"), OutputOptions{Format}, Language (optional), GenerationOptions{Speed}}` → `client.TTS`; returns base64 WAV.
- `EmbedSpeaker` is **not available** (returns error).
- Note default voice literal is `"claire"` (line 570) — differs from the app default `"Bella"` and the engine seed `"bella"` (see §7).

**Imagination / image**
- `GenerateImages` (lines 614-653): calls the deprecated `client.ImageGen`; comment says the endpoint "will likely 503" (no worker deployed); returns an empty slice on success (the API returns only an error, no image data).

**Interfaces satisfied:** `tts.Client`, `imagination.Client`, `stt.STTClient`, `stt.VADClient` (lines 661-664).

**Registry:** `GlobalRegistry.Register(config.ProviderSoulbitsCloud, …)` (`providers/registry.go:71`).

### 1.2 The gateway's route table [gateway-code]

Source: `cmd/inference-gateway/main.go` + `cmd/inference-gateway/handlers/handlers.go` (`Route`, lines 518-586).

| Method | Path | Workload | Auth | Body cap |
|---|---|---|---|---|
| GET | `/health` | — | public | — |
| GET | `/metrics` | — | public (internal) | — |
| GET | `/readyz` | — | public | — |
| **GET** | **`/v1/models`** | catalog | **public (no auth)** | — |
| POST | `/v1/chat/completions` | llm | yes | 1 MB text / 10 MB multimodal |
| POST | `/v1/audio/speech` | tts | yes | 10 MB |
| POST | `/v1/audio/transcriptions` | stt | yes | 10 MB |
| POST | `/v1/audio/vad` | vad | yes | 10 MB |
| POST | `/v1/embeddings` | embeddings | yes | 1 MB |
| POST | `/v1/rerank` | rerank | yes | 1 MB |
| POST | `/v1/embed/speaker` | voice_embed | yes | 10 MB |
| POST | `/v1/audio/convert` | audio_conversion | yes | 10 MB |
| POST | `/v1/voice/convert` | voice_conversion | yes | 10 MB |
| POST | `/v1/images/generations` | image | yes (+photo quota) | 10 MB |

- `/v1/models` is registered **outside** the `r.Route("/v1", …)` auth group precisely so it stays public (`main.go:213-216`).
- All other `/v1/*` are behind `auth.Middleware(...)` (`main.go:221-235`), plus a global 10 MB `MaxBytesReader`.
- The gateway forwards the request body **opaquely** to a RabbitMQ worker, rewriting only the `model` field. `stream:true` is ignored (non-streaming only) — `openapi.yaml:985`.
- **There is no image worker deployed** — `/v1/images/generations` is deprecated and returns 503/timeout; no production `image`-type model is seeded (the only `image` rows are E2E test fixtures `sdxl/flux-1/dall-e-mini` in `tests/e2e/helpers.go`).

**Is it OpenAI-compatible in shape?** Partially:
- Chat completions request/response ≈ OpenAI (non-streaming); extra passthrough params allowed via `additionalProperties`.
- Embeddings ≈ OpenAI/Infinity (adds `id`, `created`, `dimensions`, `modality`).
- Rerank is **Cohere-compatible** (not OpenAI).
- TTS/STT/VAD are **Harmony Speech Engine (HSE) shapes**, NOT OpenAI — JSON-only, base64 audio, `mode` required for TTS, `output_options.format` not `response_format`, `input_audio` not multipart.
- `/v1/models` is **NOT** OpenAI-shaped — it returns a bare JSON array, not `{"object":"list","data":[…]}` (see §4).

### 1.3 How the PASETO flows [engine-code] + [app-code]

1. The **app** holds the cloud PASETO (from login/refresh). `updateAllSoulbitsCloudApiKeys(paseto)` (`src/services/engine/repositories/providers.ts:338`) pushes it to the engine via `POST /api/providers/soulbitscloud/refresh-token` (body `{api_key, base_url}`), which wraps `providersRepo.RefreshAllActiveTokens` — a fan-out UPDATE over every non-deleted `soulbitscloud` provider row [engine-code `management/routes_providers.go:287-325`, `database/repository/providers/soulbitscloud.go:242`].
2. The engine stores the PASETO as the provider row's `api_key`.
3. `ConnectToBackend` detects the `v4.local.` prefix → sets `cfg.PasetoToken` (refresh disabled). The soulbits client injects `Authorization: Bearer <paseto>` via a RoundTripper [client-lib `client.go:88-141`, `auth.go`].
4. The gateway middleware validates the PASETO in-process (§2).

The app also seeds the token on new soulbitscloud configs (`injectSoulbitsToken`) and one-shot syncs on startup (`soulbitsTokenSync.ts`) [app-code].

---

## 2. Auth model [gateway-code]

### 2.1 Header & token format
- Header: `Authorization: Bearer <token>` (`pkg/auth/auth.go:127-149`). WS fallbacks also accept `Sec-WebSocket-Protocol: Bearer.<token>` or `?token=` — not relevant to REST.
- Token routing by prefix (`auth.go:155-180`):
  - `sa_…` → service-account path (worker LLM only; requires `X-Soulbits-User-ID`).
  - `sb_cloud_…` → API key path (SHA-256 hash → Valkey cache → Postgres).
  - `v4.local.…` → PASETO path.
  - anything else → `401 {"error":"invalid token"}`.

### 2.2 PASETO validation (`pkg/paseto/paseto.go`, `pkg/auth/auth.go`)
- **Format:** PASETO **v4.local** (symmetric `V4Encrypt`), 32-byte key from AWS Secrets Manager (`PASETO_KEY_SECRET_NAME`); dev fallback = 32 zero bytes when `APP_NAME=development` and secret unset.
- **Claims:** `sub` (user id), `iat`, `exp`, `email_verified` (bool), and optional `session_id` (refresh-token family id — additive; old tokens have none).
- **Lifetime:** `tokenLifetime = time.Hour` (1 hour) for normal login tokens (`paseto.go:15`). A separate `IssueTokenWithLifetime` exists for session-broker inference tokens (session plane retired).
- **Validation pipeline (in-process, no network hop):**
  1. `ValidateToken` → `parser.AddRule(NotExpired())` + `ParseV4Local`.
  2. Valkey **user cutoff** check (`GetCutoff`): if `iat` is before the cutoff → `401 "token revoked"`. Fail-closed on Valkey error → `401 "authentication service unavailable"`.
  3. Valkey **per-session revocation** (`IsSessionRevoked`, only if the token carries `session_id`): → `401 "session revoked"`. Also records session liveness (`TouchSessionThrottled`, coalesced ~once/min) and resolves the subscription tier (Valkey cache → DB, fail-open to `free`).
- **Expired vs invalid:** `auth.go:184-190` maps errors containing `expir` → `401 {"error":"token expired"}`; otherwise `401 {"error":"invalid token"}`.
- **Device binding:** there is **no device binding on inference auth**. The PASETO is account/session-scoped, not device-scoped. (The `user_devices` table + device-authorization gate `D-DEV-04` guarded *cloud sessions*, which were retired — it does not gate inference.)

### 2.3 Cheapest verification call (the key finding)

**`GET /v1/models` does NOT validate the token** — it is public. The engine's `ValidateConfig()` therefore gives a false positive on a bad/empty key.

There is **no dedicated authenticated GET/ping** on the gateway. The cheapest *authenticated* probe against the provider's own `base_url` (the inference host) is:

```
POST <base_url>/v1/chat/completions
Authorization: Bearer <paseto>
Content-Type: application/json

{}
```

Why it is side-effect-free and cheap: the auth middleware runs **before** the handler; the handler's `extractChatCompletionsRequest` rejects a missing `model` with `400 invalid_request_error "model field required"` **before** model-access check, rate limiting, quota, or task publish (`handlers.go:495-516, 254-286`). So:
- **valid token** → `400 {"error":"invalid_request_error","message":"model field required"}` (no quota consumed, no model touched, no task published).
- The only writes are the coalesced session-touch and the tier cache read/write.

Status → state-machine mapping:

| Probe outcome | Gateway signal | Our state |
|---|---|---|
| `400 invalid_request_error` | token accepted, no model | **valid** |
| `401 invalid token` | bad signature/format | **invalid** |
| `401 token expired` | past `exp` | **invalid** (sub: `expired`) |
| `401 token revoked` | user cutoff | **invalid** (sub: `revoked`) |
| `401 session revoked` | per-session revocation | **invalid** (sub: `session_revoked`) |
| `401 authentication service unavailable` | Valkey down (fail-closed) | **throttled**/retry (transient, not "invalid") |
| `429 rate_limit_exceeded` | only reachable if a valid `model` is sent | **throttled** |
| `403 forbidden` (tier) | model requires higher tier | **scope_limited** |
| `403 scope_denied` | service-account scope (N/A to user PASETO) | **scope_limited** |
| `402 payment_required` | image quota exhausted (N/A to verify) | **blocked** |

**No account-level "blocked"/banned state exists** in the gateway — `blocked` has no distinct signal for a user PASETO today; the nearest is the tier `403` and the image `402`. Reserve those enum arms for future gateway features.

**Alternative (cleaner, but cross-host):** `GET https://<cloud-host>/v1/auth/me` (auth-service, `cmd/auth-service/main.go:349`, `handlers/me.go`) returns `200 {profile}` for a valid PASETO, `401` if invalid, `403` for API keys. It is the canonical "is my session valid" call, but it lives on the **cloud** host (`cloud.soulbits.app`), not the inference host the provider persists. Using it requires the engine to derive/know the cloud base URL (the client's `CloudBaseURL` default is `beta.cloud.soulbits.app`, wrong on prod). Recommend the chat probe above unless the gateway adds a dedicated authenticated endpoint.

---

## 3. Model lineup (gateway CONFIGURED/ROUTED models as of today)

The lineup is **config-driven via the Postgres table `model_tier_access`**, seeded by migrations (`db/migrations/*.up.sql`). `GET /v1/models` reads `WHERE active = true ORDER BY model_type, display_name` (`cmd/inference-gateway/db/modelaccess.go:137-147`). Request-time access control also reads this table (tier gating via `min_tier` sort order).

Schema columns: `model_id` (PK), `display_name`, `model_type`, `min_tier`, `active`, `description` (i18n key), `input_modalities`, `output_modalities`, `context_window`, `embedding_dimensions`, `speech_options` (JSONB).

**Active rows (production seeds):**

| model_id | type | min_tier | input → output | context | dims | source |
|---|---|---|---|---|---|---|
| `starfallen-24b` | llm | free | text → text | 32768 | — | *(see note)* |
| `qwen-35-9b` | llm | free | text,image,video → text | 32768 | — | 000015 |
| `gemma4-meromero-26b-a4b` | llm | core | text,image,video,audio → text | 32768 | — | 000015 |
| `qwen3-embed-4b` | embeddings | free | text → embedding | 32768 | 2560 | 000016 |
| `harrier-oss-v1-0-6b` | embeddings | free | text → embedding | 32768 | 1024 | 000015 |
| `qwen3-rerank-0-6b` | rerank | free | text → text | 32768 | — | 000016 |
| `kitten-tts-mini` | tts | free | text → audio | — | — | 000014 |
| `kitten-tts-micro` | tts | free | text → audio | — | — | 000014 |
| `kitten-tts-nano` | tts | free | text → audio | — | — | 000014 |
| `harmonyspeech` | tts | free | text,audio → audio,embedding | — | — | 000014/15 |
| `openvoice_v1` | tts | free | text,audio → audio,embedding | — | — | 000014/15 |
| `openvoice_v2` | tts | free | text,audio → audio,embedding | — | — | 000014/15 |
| `chatterbox` | tts | core | text,audio → audio,embedding | — | — | 000014/15 |
| `chatterbox_multilingual` | tts | core | text,audio → audio,embedding | — | — | 000014/15 |
| `chatterbox_turbo` | tts | infinite | text,audio → audio,embedding | — | — | 000014/15 |
| `faster-whisper-large-v3-turbo` | stt | core | audio → text | — | — | 000014 |
| `faster-whisper-tiny` | stt | free | audio → text | — | — | 000014 |
| `silero-vad` | vad | free | audio → text | — | — | 000014 |
| `chatterbox_vc` | voice_conversion | core | audio → audio | — | — | 000014 |
| `voicefixer` | audio_conversion | free | audio → audio | — | — | 000014 |

Notes:
- **`starfallen-24b` has no `INSERT` in `db/migrations`** — it is referenced by the portal fallback (`portal/src/data/models.ts:58`), docs (`docs/api-usage.md:953`), tests, and the engine seed, and is backfilled by 000015 (`model_type='llm'` → modalities+32768). It must be seeded out-of-band; treat the **live `GET /v1/models` as the source of truth** for it.
- The engine's own DB-seed defaults (`config/db/init.go`) use: Backend `starfallen-24b`, Cognition `qwen-35-9b`, Movement `qwen-35-9b`, Vision `qwen-35-9b`, TTS `kitten-tts-mini` (voice `bella`, language `default`), RAG `harrier-oss-v1-0-6b`, STT transcription `faster-whisper-tiny`, STT VAD `silero-vad`; Imagination is intentionally **not** seeded [engine-code `config/db/init.go:156-277`].
- The app's default soulbitscloud model is `qwen-35-9b` [app-code `moduleDefaults.ts:182`].

**Which backend each routes to:** routing is by `model` field → RabbitMQ queue per workload (`llm-requests`, `tts-requests`, `stt-requests`, `whisper-requests`, `image-requests`) to worker fleets. The gateway does **not** keep a per-model backend map in the catalog; upstream engines are named in comments: LLM = Aphrodite/vLLM/sglang (`openapi.yaml:989`), embeddings/rerank = Infinity, TTS/STT/VAD = Harmony Speech Engine. Worker deploy scripts: `scripts/hse-deploy-all.sh`, `scripts/infinity-embed-deploy-all.sh`.

**Capability flags derivable from the catalog:**
- **vision** = `input_modalities` contains `image` → `qwen-35-9b`, `gemma4-meromero-26b-a4b`.
- **embedding** = `model_type=embeddings` → `qwen3-embed-4b`, `harrier-oss-v1-0-6b`.
- **tts** = `model_type=tts`.
- **tools / thinking (reasoning): NOT advertised per model** — no catalog column, no per-model flag. Tools are a passthrough capability of the upstream engine; thinking/reasoning is not a documented gateway parameter (see §5).

**`speech_options` (JSONB, migration 000017 + fix 000029)** — per-TTS-model parameter matrix: `languages[]` (code/name/voices) ⟺ model accepts `language`; top-level `voices[]` ⟺ `voice` without language; `supports_single_speaker`, `supports_voice_cloning`, `paralinguistic_tags[]`.

---

## 4. Model listing endpoint

**Yes — `GET /v1/models` exists and is public/unauthenticated** (`main.go:216`, `handlers/models_public.go`).

**Shape** (bare JSON array, `models_public.go:11-22`):

```jsonc
[
  {
    "model_id": "qwen-35-9b",
    "display_name": "Qwen 3.5 9B",
    "model_type": "llm",                 // llm|tts|stt|vad|image|embeddings|rerank|voice_embed|audio_conversion|voice_conversion
    "min_tier": "free",                  // free|core|infinite
    "description": "models.descriptions.qwen-35-9b",  // i18n KEY, not plaintext
    "input_modalities": ["text","image","video"],
    "output_modalities": ["text"],
    "context_window": 32768,
    "embedding_dimensions": 2560,        // embeddings only
    "speech_options": {                  // speech models only
      "languages": [{"code":"EN","name":"English","voices":["default","…"]}],
      "voices": ["Bella","Jasper","…"],
      "supports_single_speaker": true,
      "supports_voice_cloning": false,
      "paralinguistic_tags": ["[laughter]","…"]
    }
  }
]
```

**Query filters** (all optional, OpenRouter-style; superset match for modalities):
`?model_type=<type>&input_modalities=<m>&input_modalities=<m2>&output_modalities=<m>…`

**Gaps vs our `ModelInfo` merge target** (`{id, label?, context?, capabilities?, source}`):
- It is a **bare array** (not `{"data":[…]}`) — not OpenAI-shaped.
- No `tools`/`thinking` capability flags; vision must be inferred from `input_modalities` containing `image`; embedding from `model_type`.
- `description` is an i18n key, not display text.
- The engine's `SoulbitsCloudProvider.ListModels` currently drops everything except `model_id` + `display_name` [engine-code].

**Recommendation:** keep the existing route (no gateway change needed to *list*). For richer capability data, the gateway can either (a) extend `modelResponse` with explicit `capabilities: {vision, tools, thinking, embedding, tts}` derived server-side, or (b) the engine's embedded catalog mirrors the gateway DB (see §8). If an OpenAI-shaped alias is ever needed, add `{"object":"list","data":[…]}` — but the engine client already parses the current array, so this is optional.

---

## 5. Per-model parameter support

The gateway **forwards the request body opaquely** to the worker; it rewrites only the `model` field (`openapi.yaml:987-993`). So the gateway accepts anything the upstream engine accepts; unknown fields pass through (Go structs use `AdditionalProperties map[string]interface{}`).

**Chat (`/v1/chat/completions`)** — documented pass-through: `temperature`, `max_tokens`, `top_p`, `frequency_penalty`, `presence_penalty`, `seed`, `stop`, `response_format` (`{type:text|json_object}`), `logprobs`, `top_logprobs`, `tools`, `tool_choice`. `stream` is ignored. `max_completion_tokens` is not a named field (engine sends it via extra-params). `top_k`/`min_p`/`repetition_penalty`/`reasoning_effort` are **not** in the gateway schema — they pass through as extras and are honoured only if the upstream engine supports them.

**Embeddings (`/v1/embeddings`)** — `input` (string|array|base64/URL for multimodal), `encoding_format` (`float|base64`), `dimensions` (Infinity Matryoshka), `modality` (`text|image|audio`), `user`.

**Rerank (`/v1/rerank`, Cohere-compatible)** — `query`, `documents`, `top_n`, `return_documents`, `raw_scores`.

**TTS (`/v1/audio/speech`, HSE)** — `input`, `mode` (required: `single_speaker_tts`|`voice_cloning`), `language` (conditional), `voice` (conditional), `input_audio`/`input_embedding` (cloning), `input_vad_data`/`input_vad_mode`, `generation_options` (seed, style, speed, pitch, energy, exaggeration, cfg_weight, temperature, repetition_penalty, top_p, min_p, top_k, norm_loudness — model-specific, unsupported silently ignored), `output_options` (`format` wav/mp3/flac, `sample_rate`), `pre_/post_generation_filters`.

**STT (`/v1/audio/transcriptions`)** — `input_audio` (base64), `get_language`, `get_timestamps`.
**VAD (`/v1/audio/vad`)** — `input_audio`, `get_timestamps`, `threshold`, `min_speech_duration_ms`, `min_silence_duration_ms`, `speech_pad_ms` (Silero only).

**Per-model restrictions the gateway itself enforces:** only model *existence* (`404 model_not_found`), *active* flag, and *tier* (`403 forbidden`). Parameter-level restrictions are enforced by the **worker** (e.g. `kitten-tts` requires `language`; rejects anything but `default` — see migration 000029 and the worker error envelope handling in `handlers.go:57-106`). Worker rejections are relayed with the upstream HTTP status.

**Thinking/reasoning:** no gateway support or per-model flag. Not in the OpenAPI schema; would pass through as an unknown field only.

---

## 6. Param name mapping (gateway wire names vs OpenAI surface; engine mapping and gaps)

| Concern | OpenAI surface | Gateway wire name | Engine client mapping |
|---|---|---|---|
| max output tokens | `max_tokens` | `max_tokens` | named field (`params.MaxTokens`) |
| newer cap | `max_completion_tokens` | *(not a named field)* | **sent via `params.Set("max_completion_tokens", v)`** [engine-code:236] |
| stop | `stop` (string or array) | `stop` (union) | **sent via `params.Set("stop", []string)`** [engine-code:240] |
| n | `n` | `n` | **sent via `params.Set("n", …)`** [engine-code:243] |
| response format | `response_format` | `response_format` (object) | JSON string parsed → `params.Set("response_format", map)` [engine-code:265-270] |
| temperature/top_p/freq/presence/seed | same | same | named fields |
| tools / tool_choice | same | same | **not set by engine** (no field usage in `buildChatParams`; would need extra-params) |
| top_k / min_p / repetition_penalty / reasoning_effort | non-OpenAI | pass-through extras | only via `ExtraParams` / sampling preset unknown-keys branch [engine-code:207-219] |
| TTS format | `response_format` | **`output_options.format`** | engine sets `gen.OutputOptions{Format}` [engine-code:578] |
| TTS audio input | multipart `file` | **JSON `input_audio`** (base64) | engine sets `InputAudio` bytes |
| STT audio input | multipart `file` | **JSON `input_audio`** (base64) | engine sets `InputAudio` bytes |

**Gaps / quirks in the engine mapping:**
- `tools`/`tool_choice` are **never sent** by the engine client — function calling is unreachable via the soulbitscloud provider today even though the gateway supports it.
- `max_completion_tokens`, `stop`, `n`, `response_format` are pushed through the generated client's `Set` escape hatch, bypassing typed fields — fine on the wire, but fragile if the generated client changes.
- The engine drops `model_type`/modalities/context from `ListModels` output — no capability filtering available to callers.
- `ValidateConfig` uses the public `/v1/models` (false-positive validator).

---

## 7. Quirks

**Token expiry / rotation [app-code]**
- PASETO lifetime = **1 hour** (`paseto.go:15`). Refresh via `POST /v1/auth/refresh` (opaque rotating refresh token; reuse detection revokes the whole family — `openapi.yaml:384-387`).
- The engine provider **disables refresh** (no `RefreshToken` in cloud mode) — it relies entirely on the app re-pushing fresh tokens.
- Rotation flow: `AuthService.auth:changed` (login/register/refresh) → `updateAllSoulbitsCloudApiKeys(paseto)` → `POST /api/providers/soulbitscloud/refresh-token` → fan-out UPDATE across every `soulbitscloud` row → `SyncService.initiateSync()` [app-code `soulbitsTokenSync.ts`, `providers.ts:338`; engine-code `management/routes_providers.go`]. iOS lifecycle/maintenance paths also call `refreshCredentials` (`IOSLifecycleWakeHandler.ts`, `IOSMaintenanceScheduler.ts`).
- **Consequence:** between app-driven refreshes the engine holds a token that expires within ≤1h; a call after expiry returns `401 token expired` until the app re-pushes. There is no engine-side auto-refresh.

**Rate limiting / quota semantics (per user) [gateway-code]**
- Per-minute fixed window (`rl:inference:{workload}:{user}:min:{ts}`) and per-day (`…:{date}`), Valkey-backed; limits come from the subscription tier.
- LLM: per-minute = `chat_requests_per_min`, per-day = `chat_requests_per_day` (free 5/1000, core 10/5000, infinite 20/10000).
- TTS/STT/audio/voice conversion: per-minute = `audio_requests_per_min` (free 20, core 50, infinite 100).
- VAD/embeddings/rerank/voice_embed: per-minute = `vad_embed_per_min` (free 100, core 150, infinite 200).
- `429 rate_limit_exceeded` with `X-RateLimit-Limit/Remaining/Reset` + `Retry-After` headers.
- Image: per-day photo quota (`402 payment_required` when tier quota + coins exhausted; coin deduction is a V1 stub that always succeeds).
- Service accounts (`sa_`) bypass user limits and meter under `budget:autonomy:{user}:{month}`.

**Multi-device concurrency**
- PASETO is **session-scoped** (`session_id` = refresh-token family). Multiple devices = multiple sessions; each can be revoked individually or all at once (`/v1/auth/sessions`). No device binding on inference; concurrent requests from the same user share the same per-user rate-limit counters and tier.

**Error taxonomy [gateway-code]**
- Inference gateway: `{"error":"<code>","message":"<text>"}`. Codes seen: `unauthorized`, `invalid token`, `token expired`, `token revoked`, `session revoked`, `authentication service unavailable`, `scope_denied`, `invalid_request_error`, `model_not_found`, `forbidden`, `rate_limit_exceeded`, `payment_required`, `gateway_timeout`, `service_unavailable`, `worker_error`, `internal_error`.
- Auth-service: `{"error":"<message>"}` (message-only) — branchy flows use the gateway shape with a stable code (e.g. `device_not_registered`).
- **Matches the 401/403/429 taxonomy:** 401 (missing/invalid/expired/revoked), 403 (tier `forbidden`, `scope_denied`), 429 (`rate_limit_exceeded` + `Retry-After`), 402 (image quota), 404 (`model_not_found`), 504 (`gateway_timeout`), 502 (`worker_error`).
- **No "blocked"/banned account state** exists.

**Model-id inconsistencies (flagged)**
- `harrier-oss-v1-0-6b` (DB seed, migration 000015:79; app fallback `soulbitsModels.ts:54`; docs) **vs** `harrier-oss-v1-06b` (worker deploy script `scripts/infinity-embed-deploy-all.sh:162`; `portal/src/data/models.ts:90`). The catalog id and the worker registration differ → risk of `404 model_not_found` or misrouting. There is also an open engine memory-bank note: "RAG embeddings 404 on beta.api.soulbits.app (separate follow-up)".
- Voice case: engine seed uses `"bella"` (`config/db/init.go:186`) and `RenderSpeech` default is `"claire"` (`soulbitscloud.go:570`), while the catalog advertises `"Bella"` and the app default is `"Bella"` (`moduleDefaults.ts:195`). Voice matching may be case-sensitive at the worker.
- `kitten-tts` **requires** `language` and accepts only `"default"` (migration 000029; worker rejects missing/wrong language).

**Other**
- Engine sets a 2-minute HTTP client timeout; the gateway's LLM timeout is 120s and its `WriteTimeout` is `max(LLM+10s, 310s)`.
- Vision reuses the chat `model` — a non-multimodal model id will fail worker-side.
- `CloudBaseURL` is not persisted by the engine provider (defaults to beta cloud); refresh is disabled, so the cloud client is effectively unused.
- `stream:true` is silently ignored (non-streaming only).

---

## 8. Recommendations

### 8.1 Exact verify call (`POST /api/providers/verify`, plan R10)
For `type=soulbitscloud`, engine-side via the existing soulbits client / raw HTTP against the provider's `base_url` (inference host):

```
POST {base_url}/v1/chat/completions
Authorization: Bearer {api_key}      // the PASETO (or sb_cloud_ key in standalone)
Content-Type: application/json
{}
```

Interpret: `400 invalid_request_error` ⇒ **valid**; `401` ⇒ **invalid** (inspect `message` for `expired`/`revoked`/`session revoked`); `401 authentication service unavailable` ⇒ transient (retry); `403` ⇒ **scope_limited**; `429` ⇒ **throttled**. Return `{valid, detail}` (optionally the tier from a successful auth, though the probe body doesn't carry it).

Optional gateway improvement (recommended for cleanliness): add a tiny authenticated `GET /v1/auth/check` (or a `GET /v1/me`) that returns `200 {"valid":true,"tier":"…"}` after the auth middleware and does nothing else — removes the "probe with a deliberately invalid body" idiom.

### 8.2 Exact models call
- **Existing:** `GET {base_url}/v1/models` (public, no auth) with optional `model_type` / `input_modalities` / `output_modalities` filters. No gateway change required.
- **Engine-side change needed:** `SoulbitsCloudProvider.ListModels` must stop dropping fields — return id, display name, model_type, modalities, context_window, embedding_dimensions, speech_options so the capability overlay can be built. Consider a richer `common.ModelInfo` (or a `ModelCapability` struct) to carry `capabilities`.
- **Capability source verdict:** **authoritative = the gateway** (`model_tier_access` surfaced by `GET /v1/models`). We own the gateway, so the engine-embedded catalog (plan R12 Tier-2) is a *mirror/offline fallback*, not the source of truth. Merge order stays live > catalog > user (R12).

### 8.3 Seeding defaults (per module type)

Baseline = the engine's existing seeds (`config/db/init.go`); recommended overlay = the free-tier, catalog-valid choice. Capability overlay = `{model, voice?, language?, sampling params}`.

| Module | Backend route | Recommended default `model_id` | Capability overlay notes |
|---|---|---|---|
| **backend** (chat) | `POST /v1/chat/completions` (llm) | `qwen-35-9b` (recommended) — engine currently seeds `starfallen-24b` | free; text→text; add `temperature 0.7`, `top_p 1.0`; set `vision:false` for the chat slot |
| **cognition** | `POST /v1/chat/completions` (llm) | `qwen-35-9b` | free; matches engine seed; deterministic preset desirable |
| **movement** | `POST /v1/chat/completions` (llm) | `qwen-35-9b` | free; matches engine seed; module config pre-seeded but disabled by default |
| **rag** | `POST /v1/embeddings` | `harrier-oss-v1-0-6b` | free; **dims 1024**, context 32768. Alt: `qwen3-embed-4b` (dims 2560). ⚠️ resolve the `-06b` vs `-0-6b` id mismatch first |
| **tts** | `POST /v1/audio/speech` (tts) | `kitten-tts-mini` | free; `mode=single_speaker_tts`; `voice="Bella"` (catalog case), `language="default"`; `format="wav"` (worker returns WAV) |
| **stt-transcription** | `POST /v1/audio/transcriptions` (stt) | `faster-whisper-tiny` (free) / `faster-whisper-large-v3-turbo` (core) | audio→text |
| **stt-vad** | `POST /v1/audio/vad` (vad) | `silero-vad` | free; engine seeds it; note plan R5 says "VAD stays unset" — recommend seeding `silero-vad` since the gateway supports it |
| **vision** | `POST /v1/chat/completions` (llm, multimodal) | `qwen-35-9b` | free; `input_modalities` includes `image`; alt `gemma4-meromero-26b-a4b` (core) |
| **imagination** | `POST /v1/images/generations` (image) | **none** | No production image model; endpoint deprecated/503. Leave unset (matches engine's intentional non-seed) |

Resolve plan §10.1 (default model lineup) with this table: the gateway's real ids are `qwen-35-9b`/`starfallen-24b`/`gemma4-meromero-26b-a4b` (LLM), `harrier-oss-v1-0-6b`/`qwen3-embed-4b` (embeddings), `kitten-tts-*`/`harmonyspeech`/`openvoice_*`/`chatterbox*` (TTS), `faster-whisper-*` (STT), `silero-vad` (VAD). Recommend **`qwen-35-9b`** as the single chat default (free, multimodal, matches the app's existing default) and flag the engine's `starfallen-24b` backend seed as an intentional difference to reconcile.

### 8.4 Engine / gateway client notes
- **Fix `ValidateConfig`** — it must not use the public `/v1/models`; use the §8.1 probe.
- **Enrich `ListModels`** to carry full catalog metadata (and add `capabilities` to `common.ModelInfo`).
- **Add a dedicated authenticated verify endpoint** on the gateway (optional but recommended) to avoid the invalid-body probe.
- **Send `tools`/`tool_choice`** if function calling is desired (currently never sent).
- **Reconcile model ids** (`harrier-oss-v1-0-6b` vs `-06b`) between the DB catalog and the worker deploy script.
- **Unify the TTS voice default** (`"claire"` / `"bella"` / `"Bella"`) and confirm worker case-sensitivity.
- **Document the 1h PASETO lifetime** in the provider UX; the engine has no auto-refresh, so "token expired" is an expected transient until the app re-pushes.
