# Soulvoice Provider — Research (provider-registry Phase R)

Scope: the **soulvoice** provider — the full-variant-only, self-hosted speech engine used for TTS, STT and VAD. Researched across three repos:

- **engine** = `harmony-link-private` (the Go sidecar; owns the provider adapter) — marked **[engine-code]**
- **speech-engine** = `harmony-speech-engine` (the Python/FastAPI inference server; the actual "Soulvoice Engine") — marked **[speech-engine-code]**
- **client** = `harmony-speech-engine-client-go` (the generated Go OpenAPI client the provider uses) — marked **[client-code]**
- **app** = `harmony-ai-app` (React Native UI + repos) — marked **[app-code]**

Read-only task. No code was modified; this document is the only file written.

---

## 1. Current state

### 1.1 What the engine provider supports today

`providers/soulvoice.go` — `SoulvoiceProvider` **[engine-code]** (`harmony-link-private/providers/soulvoice.go`):

| Method | Speech-engine call | Notes |
|---|---|---|
| `ConnectToBackend` | — | Builds `soulvoiceclient.APIClient`; sets `apiConfig.Servers[0].URL = config.Endpoint` (line 46). The SDK appends `/v1/...` itself, so `endpoint` must be the **base** URL (e.g. `http://localhost:5000`), never with `/v1`. |
| `ValidateConfig` | `GET /v1/audio/speech/models` (`ShowAvailableSpeechModelsV1AudioSpeechModelsGet`, line 92) | Optional auth: if `ApiKey != ""` sets both `ApiKey(...)` → `Api-Key` header **and** `XApiKey(...)` → `x-api-key` header (lines 95-99). **Does not inspect `response.StatusCode`** — returns only `errExecute` (the SDK surfaces ≥300 as a `GenericOpenAPIError`, so a 401/404 does yield an error, but a 200 with an odd body would not be flagged). |
| `EmbedSpeaker` | `POST /v1/embed/speaker` (line 168) | `model` from **voice config** (`voiceConfig.Model`); `input_audio` = base64 audio. |
| `RenderSpeech` | `POST /v1/audio/speech` (line 220) | See §4/§5 for the field mapping. `model`/`mode`/`language`/`voice`/`input_embedding` from the voice config; `generation_options`/`output_options` from voice config + account config. |
| `TranscribeAudio` | `POST /v1/audio/transcriptions` (line 258) | `model` from **account config** (`config.Model`). |
| `DetectVoiceActivity` | `POST /v1/audio/vad` (line 293) | `model` from **account config** (`config.Model`). |
| `ListModels` | — | **Returns `errors.New("not implemented")`** (lines 321-323). This is the core gap for live listing. |
| `GetChatHistory`, `AllowsCustomPrompting`, `SetSystemPrompt`, `SendComplexPromptSync`, `SendUserMessage` | — | Not-applicable stubs (soulvoice is a speech provider, not a chat backend). |

Registered as `ProviderSoulvoice = "soulvoice"` **[engine-code]** (`config/config.go:37`, `providers/registry.go:63`).

### 1.2 Config structs (the provider's param surface)

`config.SoulvoiceConfig` **[engine-code]** (`config/types.go:470-479`) — account/provider level:
`Endpoint`, `ApiKey`, `Model`, `VoiceConfigFile`, `Format`, `SampleRate` (int32), `Stream` (bool).

`config.SoulvoiceVoiceConfig` **[engine-code]** (`config/voice.go:16-31`) — per-voice level, loaded from `VoiceConfigFile` (JSON):
`Model`, `OperationMode`, `Language`, `Voice`, `Style` (int32), `Speed`/`Pitch`/`Energy` (float32), `Seed` (int32), `TargetEmbedding`.

A **legacy V1** voice file shape (`embed`, `speedModifier`, `pitchModifier`, `energyModifier`) is auto-upgraded on load (`providers/soulvoice.go:27-32,144-155`). `VoiceConfigFile` may be a local file name (under `<dataDir>/voices/*.json`) or an `http(s)://` URL (with a special `kajiwoto.ai/v/` → `server.chiefhappiness.co/audio-embedding/` rewrite) **[engine-code]** (`providers/soulvoice.go:110-131`, `config/voice.go:74-97`).

### 1.3 How TTS / STT / VAD use the provider (engine modules)

- **TTS** **[engine-code]**: `modules/tts.go` — `InitTTSClient` requires the provider to implement `tts.Client`; `providerConfig()` → `TTSConfig.ProviderConfig()` → `SoulvoiceConfig` (`config/types.go:751-756`). `Shutdown` treats soulvoice as a plain REST client (`tts.go:99`). `RenderSpeech` result `DataB64`/`DataType` is written to a temp file or emitted (`tts.go:151-180`).
- **STT** **[engine-code]**: `modules/stt.go` — the module has **two slots**: `Transcription` and `VAD` (`config/types.go:676-678`). Both `TranscriptionConfig.ProviderConfig()` and `VADConfig.ProviderConfig()` return `SoulvoiceConfig` for soulvoice (`types.go:696-709`, `720-733`). `InitSTTClient`/`InitVADClient` require `stt.STTClient`/`stt.VADClient` (`stt.go:200-228`); `Shutdown` accepts soulvoice for both slots (`stt.go:165,176`).
- **Validation dispatch** **[engine-code]**: `integration/validation.go:24-54` — for non-RAG modules: `registry.New(provider)` → `ProviderSupportsModule` → `FromJSON` → `ValidateConfig` (which for soulvoice hits `/v1/audio/speech/models`).
- **Integration auto-discovery** **[engine-code]**: `integration/manager.go:1919-1946` — for soulvoice it uses the `endpoint` field = base URL **without** `/v1` (comment: "the SDK appends /v1/... paths automatically"), validates via `ValidateProviderConfig`, and returns the bare `baseURL` for the config.

### 1.4 App-side wiring for soulvoice

- **Provider type id** `'soulvoice'` appears in `MODULE_TYPES` **only under TTS** **[app-code]** (`src/constants/moduleConfiguration.ts:71-82`). The STT entry (`:64-70`) lists `openai`, `openaicompatible`, `openrouter`, `soulbitscloud`, `elevenlabs` — **soulvoice is NOT offered for the STT/VAD slots**, even though the engine supports it for both. (The STT dual-slot form renders `getAvailableProviders('stt')` → `MODULE_TYPES['stt'].providerOptions`; `src/screens/config/ModuleConfigEditScreen.tsx:782-801,839-850`.)
- **Field schema** **[app-code]** (`src/constants/providerFieldSchemas.ts:114-126`): `hasModelFetch: false`; fields = `name`, `endpoint` (required, placeholder `http://localhost:5000`), `api_key` (optional), `model`, `voice_config_file`, `format` (`wav`), `sample_rate` (`22050`), `stream`.
- **Defaults** **[app-code]** (`src/constants/moduleDefaults.ts:84-93`): `format:'wav'`, `sample_rate:22050`, `stream:0`.
- **TS type** **[app-code]** (`src/database/models.ts:176-187`): `id, name, endpoint, api_key, model, voice_config_file, format, sample_rate, stream, deleted_at`.
- **Repository** **[app-code]** (`src/services/engine/repositories/providers.ts:232-239`): `makeProviderApi<SoulvoiceProviderConfig>('soulvoice')` → get/getAll/getByName/create/update/delete/isInUse, backed by `GET/POST/PUT/DELETE /api/providers`.
- **Variant lock** **[app-code]** (`src/services/variant/providerAvailability.ts`): `full` offers soulvoice; `store` offers **only** `soulbitscloud` (`isProviderAvailable`/`getAvailableProviders`). Disambiguation is binding: `soulbitscloud ≠ soulvoice`.
- **Model fetch** **[app-code]**: the app's live model fetch (`src/services/cloud/soulbitsModelsCatalog.ts`) targets the **soulbitscloud** public catalog (`GET /v1/models` via `@harmony-ai-solutions/soulbits-api-client`). Soulvoice has `hasModelFetch:false` and no app-side live fetch. The engine **already exposes** `POST /api/providers/models` (`management/server.go:258`) but the app's `EngineApiClient` has no method for it yet (grep: no `validateProvider`/`/models` usage in `EngineApiClient.ts`).

### 1.5 What the speech engine actually exposes (route table)

From `harmonyspeech/endpoints/openai/api_server.py` **[speech-engine-code]** (FastAPI + uvicorn; all REST/JSON — **no WebSocket**):

| Method | Path | Response | Auth |
|---|---|---|---|
| GET | `/health` | dict of per-serving-object status; **200** all healthy / **500** any unhealthy | **no** |
| GET | `/version` | `{"version": <harmonyspeech.__version__>}` | **no** |
| POST | `/v1/audio/speech` | `TextToSpeechResponse {id, model, created, data(b64)}` | yes |
| GET | `/v1/audio/speech/models` | `ModelList` | yes |
| POST | `/v1/audio/transcriptions` | `SpeechToTextResponse {id, model, created, text, language, timestamps}` | yes |
| GET | `/v1/audio/transcriptions/models` | `ModelList` | yes |
| POST | `/v1/audio/vad` | `DetectVoiceActivityResponse {id, model, created, speech_activity, timestamps}` | yes |
| GET | `/v1/audio/vad/models` | `ModelList` | yes |
| POST | `/v1/embed/speaker` | `EmbedSpeakerResponse {id, model, created, data(b64)}` | yes |
| GET | `/v1/embed/models` | `ModelList` | yes |
| POST | `/v1/voice/convert` | `VoiceConversionResponse` | yes |
| GET | `/v1/voice/convert/models` | `ModelList` | yes |
| POST | `/v1/audio/convert` | `AudioConversionResponse` | yes |
| GET | `/v1/audio/convert/models` | `ModelList` | yes |
| GET | `/metrics` | Prometheus ASGI app (`router.mount`, line 84) | no |
| GET | `/docs`, `/redoc` | Swagger / ReDoc (FastAPI built-ins) | no |

There is **no generic `/v1/models`** and **no dedicated `/voices`** endpoint; voices are nested inside `ModelCard.languages[].voices[]`.

**Auth** **[speech-engine-code]** (`api_server.py:304-348`): the auth middleware is installed **only if** `HARMONYSPEECH_API_KEY` env or `--api-keys` is set. It applies **only to `/v1*`** paths (everything else — `/health`, `/version`, `/metrics`, `/docs` — bypasses). For `/v1`, it reads `Api-Key` and `Authorization` headers: if `Api-Key != token` it tries the Harmony-Auth rate-limit backend (`ApiKeyCacheManager`, `ENDPOINT_URL` env; `auth/apikeys.py`), else requires `Api-Key == token` **and** `Authorization == Bearer <token>`; failure → **401** `{"error":"Unauthorized"}`. `OPTIONS` bypasses. The server does **not** read `x-api-key` (the SDK sends it too; the provider's dual header is harmless).

**Version** **[speech-engine-code]** (`harmonyspeech/version.py:13`): `__version__ = "v0.1.1-rc1"` (also `commit_id.py` short/full commit).

**Model config source** **[speech-engine-code]**: `config.yml` `model_configs[]` — each has `name` (= the model id returned by the API), `model` (HF id), `model_type`, optional `language` + `voices`, `max_batch_size`, `device_config.device` (default `cpu`). TTS model **groups** produce `object:"toolchain"` cards (`serving_engine.py:255`): `harmonyspeech`, `openvoice_v1`, `openvoice_v2`, `chatterbox`, `chatterbox_turbo`, `chatterbox_multilingual` (`serving_text_to_speech.py:25-32`). VAD model types = `FasterWhisper`, `SileroVAD` (`serving_voice_activity_detection.py:26`); STT = `FasterWhisper`.

---

## 2. Endpoint validation

### 2.1 Cheapest reachability + info call

Two candidate probes, both **unauthenticated** (auth bypasses non-`/v1` paths):

1. **`GET /version`** — cheapest. Returns `{"version":"v0.1.1-rc1"}`. Confirms reachability **and** that the target is a Harmony/Soulvoice speech engine (not some other HTTP server). No model dependency, no engine work.
2. **`GET /health`** — richer. Returns per-capability status and 200/500. Runs `engine.check_health()` over every model executor (`harmonyspeech_engine.py:697-699`), so slightly heavier and may be slow on cold start.

The provider's current `ValidateConfig` uses `GET /v1/audio/speech/models` — a good *auth + model* check, but it requires auth when enabled and pulls the full model list. **Recommendation:** use `GET /version` as the primary reachability/identity probe, and `GET /v1/audio/speech/models` as the secondary auth+content probe (see §8).

### 2.2 Response shapes

- `GET /version` → `{"version": "<string>"}`.
- `GET /health` → `{"text_to_speech": "healthy"|"unhealthy: <err>", "speech_to_text": ..., "voice_conversion": ..., "voice_embedding": ..., "voice_activity_detection": ...}`; HTTP **200** if all healthy, **500** if any unhealthy (`api_server.py:87-133`).
- `GET /v1/audio/speech/models` → `{"object":"list","data":[{ "id", "object":"model", "created", "owned_by":"harmony-ai-solutions", "languages":[{ "language", "voices":[{ "voice", "styles" }] }], "root", "parent" }]}` (`protocol.py:25-43`).

### 2.3 Failure signals & how to distinguish

| Observation | Meaning |
|---|---|
| `GET /version` → 200 | **Up**, and the base URL is correct (engine confirmed). |
| `GET /health` → 200 | Up, all serving objects healthy. |
| `GET /health` → 500 | **Still reachable** — engine is up but ≥1 serving object is unhealthy. Do not treat 500 as "down". |
| 404 (`{"detail":"Not Found"}`) | Reachable but **wrong path** (wrong base path/prefix, or a non-speech server). |
| 401 (`{"error":"Unauthorized"}` or rate-limit error) | Reachable but **auth problem** (key missing/wrong). |
| Connection refused / DNS / timeout | **Unreachable.** |

The Go client returns `(result, response, errExecute)`; on ≥300 the SDK returns a non-nil `errExecute` (`*GenericOpenAPIError`, body preserved) with the `*http.Response` still populated — so a caller can read `response.StatusCode` to separate 401/404 from a net error (`response == nil` → transport failure).

### 2.4 Timeout guidance

The generated client uses **`http.DefaultClient`** with **no timeout** **[client-code]** (`client.go:62-64`) and the provider passes `context.Background()` (no deadline) on every call **[engine-code]**. A hanging host would hang the verify indefinitely. **Recommendation:** wrap verify calls in `context.WithTimeout` (e.g. 5 s) and/or set `Configuration.HTTPClient` to an `*http.Client{Timeout: ...}`. A healthy LAN engine answers `/version` in milliseconds; cold-start `/health` (model load) can take longer, so keep the model-list probe at ~5–10 s and the `/version` probe at ~3–5 s.

---

## 3. Model / voice listing

### 3.1 Does the speech engine expose voices/models/capabilities? — **Yes (per capability).**

Three capability-scoped model lists (all `GET`, `ModelList`, auth-gated under `/v1`):

- `GET /v1/audio/speech/models` — TTS models, with nested **voices** and **languages**.
- `GET /v1/audio/transcriptions/models` — STT models.
- `GET /v1/audio/vad/models` — VAD models.
- (also `/v1/embed/models`, `/v1/voice/convert/models`, `/v1/audio/convert/models`.)

**Shape** **[speech-engine-code]** (`protocol.py:20-43`):

```
ModelList   { "object": "list", "data": [ModelCard, ...] }
ModelCard   { "id": str, "object": "model"|"toolchain", "created": int,
              "owned_by": "harmony-ai-solutions",
              "languages": [ { "language": str,
                               "voices": [ { "voice": str, "styles": [str] } ] } ],
              "root": str|null, "parent": str|null }
```

Notes: model **groups** appear as `object:"toolchain"` with `id` = group name; per-language voices are populated from `config.yml`'s `language`/`voices` (KittenTTS voices with no language are mapped under a synthetic `"default"` language — `serving_engine.py:165-174`; ChatterboxMultilingual expands to its 23 languages — `:176-184`).

### 3.2 Mapping to the `ModelInfo` merge target

The engine's merge target is `common.ModelInfo` **[engine-code]** (`modules/common/client.go:19-23`):

```
ModelInfo { "id": str, "name": str, "description": str }
```

The engine's existing `POST /api/providers/models` returns `{"models": [ModelInfo], "error": "..."}` (`management/config.go:19-46`).

**Recommended mapping (to-build):** `ModelCard.id → ModelInfo.ID`; `ModelInfo.Name = card.id` (or a friendly label from `owned_by`/group); `ModelInfo.Description` = a short summary of `languages`/`voices` (e.g. `"EN: default, whispering, ...; ZH: default"`). Capability (`tts`/`stt`/`vad`) is implied by **which endpoint** the card came from, so it should be attached when the merge layer fans out across the three endpoints.

**Recommended richer shape** (aligns with plan §6.3 / R12 — live > catalog > user, with provenance):

```
{ "id": str, "label": str,
  "capabilities": ["tts"|"stt"|"vad"|...],
  "voices": [ { "language": str, "voice": str, "styles": [str] } ],
  "source": "live" | "catalog" }
```

### 3.3 Verdict

Live listing is fully available **today** at the speech engine. The gap is purely engine-client-side: `SoulvoiceProvider.ListModels` returns "not implemented" and the client has no voices-aware mapping. No new speech-engine endpoint is required for models/voices; a `capabilities` endpoint is not needed either (capability = which model-list endpoint is non-empty — see §7).

---

## 4. Parameter support

### 4.1 TTS params — `POST /v1/audio/speech`

Request body **[speech-engine-code]** (`protocol.py:138-182`): `model` (required), `input` (text), `mode`, `language`, `voice`, `input_audio` (base64 ref), `input_vad_mode`, `input_vad_data`, `input_embedding` (base64), `generation_options`, `output_options`, `pre_processing_filters`, `post_generation_filters`.

- `generation_options` (`protocol.py:51-89`): generic = `seed`, `style`, `speed`, `pitch`, `energy`; **Chatterbox-specific** = `exaggeration`, `cfg_weight`, `temperature`, `repetition_penalty`, `top_p`, `min_p`, `top_k`, `norm_loudness`.
- `output_options` (`protocol.py:92-95`): `format` (default `"wav"`), `sample_rate`, `stream`.

**Model-gated vs server-wide:**

- **Server-wide (all TTS):** `mode` must be `single_speaker_tts` or `voice_cloning` (else 400) — `serving_engine.py:69-75`. `output_options.stream=true` is rejected server-wide ("Stream output is not yet supported") — `serving_text_to_speech.py:60-64`.
- **Model-gated:** `language`/`voice` are validated **only if** the model declares `languages` (else ignored) — `serving_engine.py:104-149`. Chatterbox reference-audio rules (voice_cloning requires `input_audio`|`input_embedding`; single_speaker_tts forbids them) — `serving_engine.py:78-91`. The Chatterbox-specific `generation_options` sub-fields are per-variant (documented in the field descriptions).

### 4.2 VAD params — `POST /v1/audio/vad`

**[speech-engine-code]** (`protocol.py:259-288`): `model` (required), `input_audio` (base64), `get_timestamps`; **Silero dynamic params** = `threshold` (0.5), `min_speech_duration_ms` (250), `min_silence_duration_ms` (100), `speech_pad_ms` (30), `return_seconds` (false). Response: `speech_activity` (bool) + optional `timestamps`. Applied when the VAD model is SileroVAD.

### 4.3 STT params — `POST /v1/audio/transcriptions`

**[speech-engine-code]** (`protocol.py:227-244`): `model` (required), `input_audio` (base64), `get_language` (bool), `get_timestamps` (bool). Response: `text`, `language`, `timestamps`.

### 4.4 Which params are exposed by the current engine path

The provider only sets a subset (see §5). The **Go client models are stale** relative to the server: `DetectVoiceActivityRequest` **[client-code]** (`model_detect_voice_activity_request.go:21-28`) has only `model`, `input_audio`, `get_timestamps` — it is **missing** the Silero `threshold`/`min_speech_duration_ms`/`min_silence_duration_ms`/`speech_pad_ms`/`return_seconds` params that the server accepts. `SpeechTranscribeRequest` is complete (`get_language`/`get_timestamps` present).

---

## 5. Param name mapping (wire names + engine-client mapping + gaps)

### 5.1 Wire names (speech-engine JSON) ← engine provider fields

| Provider field | Wire field (speech engine) | Source struct |
|---|---|---|
| `voiceConfig.Model` | `model` | `SoulvoiceVoiceConfig` (voice file) |
| text argument | `input` | — |
| `voiceConfig.OperationMode` | `mode` | voice file |
| `voiceConfig.Language` | `language` | voice file |
| `voiceConfig.Voice` | `voice` | voice file |
| `voiceConfig.TargetEmbedding` | `input_embedding` | voice file |
| `voiceConfig.Seed` | `generation_options.seed` | voice file |
| `voiceConfig.Style` | `generation_options.style` | voice file |
| `voiceConfig.Speed` | `generation_options.speed` | voice file |
| `voiceConfig.Pitch` | `generation_options.pitch` | voice file |
| `voiceConfig.Energy` | `generation_options.energy` | voice file |
| `config.Format` | `output_options.format` | `SoulvoiceConfig` (account) |
| `config.SampleRate` | `output_options.sample_rate` | account |
| `config.Stream` | `output_options.stream` | account |
| `config.Model` | `model` (STT) | account |
| `config.Model` | `model` (VAD) | account |
| base64 audio | `input_audio` (STT/VAD/embed) | — |

(All via `soulvoiceclient` request builders **[client-code]** and `providers/soulvoice.go:199-217,253-259,288-294` **[engine-code]**.)

### 5.2 Gaps / quirks

1. **Two different `model` sources.** `RenderSpeech`/`EmbedSpeaker` take `model` from the **voice file** (`voiceConfig.Model`), while `TranscribeAudio`/`DetectVoiceActivity` take `model` from the **account config** (`config.Model`). The provider UI's `model` field therefore does not control TTS model selection (that comes from `voice_config_file`).
2. **Per-voice generation params are file-only.** `OperationMode`, `Language`, `Voice`, `Style`, `Speed`, `Pitch`, `Energy`, `Seed`, `TargetEmbedding` live in the `voice_config_file` JSON — they are **not** in the app's soulvoice provider schema (`providerFieldSchemas.ts:114-126`), so the UI cannot set them; the engine reads them from the file.
3. **Chatterbox-specific `generation_options` unmapped.** `exaggeration`, `cfg_weight`, `temperature`, `repetition_penalty`, `top_p`, `min_p`, `top_k`, `norm_loudness` are accepted by the server but never sent by the provider.
4. **VAD tuning params unmapped + absent from the Go client.** The Silero params in §4.2 cannot be sent (client model lacks the fields).
5. **`x-api-key` vs `Api-Key`.** The client's `XApiKey(...)` sets `x-api-key`; `ApiKey(...)` sets `Api-Key`. The **server only reads `Api-Key`** (`api_server.py:326`) — so `ApiKey(...)` (i.e. the `Api-Key` header) is the one that matters. The provider sets both, so it works, but a client that set only `XApiKey` would silently fail auth.
6. **`pre_processing_filters`/`post_generation_filters`** exist on the server and in the client `TextToSpeechRequest` (`PostGenerationFilters []VoiceConversionRequest`) but are never set by the provider.

---

## 6. Quirks

- **Streaming is unsupported (and actively rejected).** `output_options.stream=true` → the server returns an error (`serving_text_to_speech.py:60-64`); the `StreamingResponse` branches are commented out throughout `api_server.py` (lines 150-151, 169-170, etc.). **Consequence:** the provider's `Stream` config (app default `0` = off) must stay off — setting it to `1` makes every `RenderSpeech` call fail. There is no WebSocket transport.
- **Latency profile.** `config.yml` defaults every model to `device: cpu`. KittenTTS is ultra-lightweight (25–80 MB ONNX); Chatterbox is ~1–2 GB and "runs very slowly on CPU" (config comments / README). Cold start loads models, so the first `/health` or first synthesis can be slow. GPU is recommended for Chatterbox via `config.gpu.yml` / `docker-compose.nvidia.yml` (also an AMD/ROCm variant).
- **Concurrency.** Per-request processing (not token batching) and multi-model parallel execution (`README.md:117-122`). `max_batch_size` is per model (`1` for Chatterbox, `10` for most, `16` for Whisper/Silero). No explicit global API concurrency limit — uvicorn's default worker model applies.
- **LAN deployment.** Binds `0.0.0.0:12080` (`README.md:82`); docker-compose maps `12080:12080` (plus a UI on `8080`). **CORS** is configured via `args.allowed_origins` (`api_server.py:291-297`) — only relevant to **browser** clients; the React Native app and the Go sidecar are not browsers, so CORS does not apply to them. **HTTPS** is supported via uvicorn `--ssl-keyfile/--ssl-certfile` (`api_server.py:407-417`), but the provider/client use `http.DefaultClient` with **no custom CA / `InsecureSkipVerify`** **[client-code]** — a self-signed LAN certificate would be rejected. Recommend documenting plain HTTP + optional API key for LAN.
- **Health semantics.** `/health` calls **all five** serving objects; a single unhealthy object flips the whole response to **500** (`api_server.py:98-133`). 500 ≠ "engine down".
- **Auth scope.** `/health`, `/version`, `/metrics`, `/docs`, `/redoc` are **not** behind auth even when `HARMONYSPEECH_API_KEY` is set — so reachability/version probing works keyless.
- **`mode` is required for TTS.** Empty `mode` → 400. If the voice file omits `operation_mode`, `RenderSpeech` sends `mode=""` and fails. The voice file must set `operation_mode` (`single_speaker_tts`|`voice_cloning`).
- **Endpoint must be the base URL** (no `/v1`, no trailing slash): the SDK appends `/v1/...` (`integration/manager.go:1919-1925`).

---

## 7. Catalog verdict

**The speech engine is self-hosted and its model set is entirely `config.yml`-driven** — two installs of the same engine version can expose completely different models. Therefore:

- **Live is authoritative.** The per-capability model-list endpoints (§3) are the source of truth for ids/voices/languages. The catalog must never override live.
- **Static catalog role = reference, not ids.** Put in the engine-embedded catalog (R12):
  - the **known model groups/types** (`harmonyspeech`, `openvoice_v1`, `openvoice_v2`, `chatterbox`, `chatterbox_turbo`, `chatterbox_multilingual`, `kitten-tts-*`, `faster-whisper-*`, `silero-vad`) as *descriptive* entries — useful for param hints and friendly labels, but **not** as guaranteed ids;
  - the **param-name mapping** for soulvoice (the §5.1 table), which is static and UI-relevant;
  - **which params each model family supports** (generic vs Chatterbox-specific `generation_options`), so the UI can hide/downgrade unsupported params.
- **No version gating.** Capability availability is a function of the install's `config.yml`, not the engine version. **Capability detection = probe the three model endpoints**: non-empty `/v1/audio/speech/models` ⇒ TTS; non-empty `/v1/audio/vad/models` ⇒ VAD; non-empty `/v1/audio/transcriptions/models` ⇒ STT. `GET /version` is still useful for a human-readable identity/telemetry string, but should **not** be used as a capability gate.

---

## 8. Recommendations

### 8.1 Exact verify call

Add/keep a `POST /api/providers/validate-provider` path (`{module, provider:"soulvoice", config:{endpoint, api_key}}`; already exists at `management/server.go:257`) and make the soulvoice branch:

1. **Primary (reachability + identity, keyless):** `GET /version` (`ShowVersionVersionGet` — already generated in the client, `api_default.go:1459`). Success = engine reachable and confirmed. Wrap in a ~3–5 s `context.WithTimeout`.
2. **Secondary (only if `api_key` non-empty):** `GET /v1/audio/speech/models` with `ApiKey`/`XApiKey` headers (as today) to confirm the credential is accepted.

Verdict mapping: 200 → `{valid:true}`; **401** → `{valid:false, detail:"unauthorized"}`; **404** → `{valid:false, detail:"wrong path / not a speech engine"}`; transport error → `{valid:false, detail:"unreachable"}`; `/health` 500 → still `{valid:true}` (reachable, degraded).

Also **fix `ValidateConfig` to inspect `response.StatusCode`** (it currently only returns `errExecute`).

For the plan's generic `POST /api/providers/verify {type, api_key, base_url?}` (R10), soulvoice maps `base_url → endpoint` and should run the same `/version` (reachability) + optional model-list (auth) probes.

### 8.2 Exact models/voices call

- **Existing:** `POST /api/providers/models {module, provider, config}` → `{models:[ModelInfo], error}` (`management/config.go:75-82`). Today soulvoice returns `error:"...does not support model listing"` because `ListModels` is "not implemented".
- **To-build (engine):** implement `SoulvoiceProvider.ListModels(filter)` to fan out by `filter.ModelType`:
  - `tts` → `GET /v1/audio/speech/models`
  - `stt` → `GET /v1/audio/transcriptions/models`
  - `vad` → `GET /v1/audio/vad/models`
  and map `ModelList.data` → `[]common.ModelInfo` (id = `card.id`; name/label; description from `languages`/`voices`). Surface voices via the richer shape in §3.2 (extend `ModelInfo` with `capabilities` + `voices` + `source`, or add a parallel field) so the UI's voice/language pickers can be driven by live data.
- **Plan R10 shape** `{type, api_key, base_url?} → {models:[{id,label,capabilities,source}]}`: for soulvoice the request needs a **module/capability** (or should return the union across all three endpoints with per-model `capabilities`), because the engine has no single all-models endpoint.

### 8.3 Capability-source verdict

- **Live-first:** always prefer the model-list endpoints.
- **Static catalog:** model-group reference + soulvoice param-name mapping + per-family param support (never ids).
- **User override:** unchanged (warn, don't block).
- **No version probe gating** — detect capability by endpoint presence (§7).

### 8.4 Engine client notes (`harmony-speech-engine-client-go`)

1. **Client already has `/version` and `/health`** (`ShowVersionVersionGet`, `HealthHealthGet`) — use them for verify; no regeneration needed for those.
2. **Regenerate the client** against the current server OpenAPI to pick up the **Silero VAD params** (`threshold`, `min_speech_duration_ms`, `min_silence_duration_ms`, `speech_pad_ms`, `return_seconds`) on `DetectVoiceActivityRequest` — currently missing.
3. **Add a timeout.** The client defaults to `http.DefaultClient` (no timeout); set `Configuration.HTTPClient` (or per-call `context.WithTimeout`) so verify/probe calls can't hang.
4. **`ListModels` mapping** needs a voices-aware projection (the generated `ModelCard`/`LanguageOptions`/`VoiceOptions` types already exist).
5. **Auth header:** prefer `ApiKey(...)` (→ `Api-Key`, the header the server reads); keep `XApiKey` for compatibility but note it is ignored server-side.
6. **TLS:** no custom CA / `InsecureSkipVerify` support — self-signed HTTPS fails today; either document plain HTTP for LAN or add a configurable `http.Transport`/CA.
7. **`stream` config:** keep the app default `0`; a non-zero `Stream` produces a hard server error. Consider hiding/guarding the `stream` field in the UI or documenting it as unsupported.
8. **Provider-side fixes worth doing while here:** surface `config.Model` for STT/VAD and `voiceConfig.Model` for TTS distinctly in the UI (the current `model` field only drives STT/VAD); add the Chatterbox `generation_options` to the voice config if product wants them exposed; ensure the voice file sets `operation_mode` (else TTS 400s).
