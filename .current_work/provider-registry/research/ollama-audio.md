# Research R-AUDIO — Ollama audio API surface (TTS / STT / VAD)

**Date:** 2026-10-18 · **Scope gate:** Owner ruling A2 — audio capabilities in scope only if usable over Ollama's HTTP API. Chat/cognition/movement/vision/rag proceed regardless.
**Ollama version baseline at research time:** latest release **v0.40.6** (2026-10-16). Audio-input support shipped in **v0.20.0** (2026-04-03) with Gemma 4.

---

## 1. Summary verdict table

| Question | Verdict | Endpoint / evidence |
| --- | --- | --- |
| **4-8 engine client: implement TTS?** | **NO** | No `/v1/audio/speech` and no native speech endpoint exists in stock Ollama (server routes, OpenAPI spec, docs all lack it). TTS models (kokoro/bark-class, e.g. `mannix/supertonic`) run only on the **xOllama fork** with an external audio.cpp engine — not stock. Revisit if ollama/ollama#11021 / #1234 land. |
| **4-8 engine client: implement STT?** | **YES, with caveats** (call it "transcription, experimental") | `POST /v1/audio/transcriptions` — OpenAI-compatible path, **multipart/form-data**, exists since **v0.20.0**. It is a **prompt-shim over `/api/chat`**, not a dedicated Whisper pipeline: audio is wrapped in a fixed "transcribe exactly" system prompt and sent to an audio-capable multimodal LLM (gemma4). Response is `{"text": "..."}` only — no segments, timestamps, or durations. Only gemma4 checkpoints with the `audio` capability work (e2b/e4b/12b). |
| **4-8 engine client: implement VAD?** | **NO** | No voice-activity endpoint of any kind. Nothing in routes, spec, docs, or release notes. (CLI `ollama run` has local mic chunking, but that is client-side, not HTTP.) |
| **6-5 app pickers: ollama in TTS picker?** | **NO** | No TTS endpoint on stock Ollama; would produce a permanently-broken picker entry. |
| **6-5 app pickers: ollama in STT/transcription picker?** | **YES, flagged experimental** | Only if the product can accept: no timestamps/segments, LLM-transcription quality (not Whisper-grade), WAV-only input, gemma4-only models, server ≥ 0.20.0. Otherwise omit. Recommend offering with an "(experimental, no timestamps)" label gated on live capability detection (phase 5-2). |
| **6-5 app pickers: ollama in VAD picker?** | **NO** | No VAD capability exists server-side. |

**Bottom line:** Ollama's only HTTP audio surface is **audio *input*** (transcription via `/v1/audio/transcriptions`, plus `input_audio` parts in `/v1/chat/completions` and audio bytes in the native `images` field). There is **no audio *output*** (TTS) and **no VAD**. The transcription endpoint is real but undocumented in the official API reference — its wire shape below is derived from the ollama/ollama source at `main`, which is the only authoritative source.

---

## 2. Endpoints & wire shapes

### 2.1 `POST /v1/audio/transcriptions` — transcription (STT) ✅ since v0.20.0

Implemented by `middleware.TranscriptionMiddleware` (middleware/openai.go) translating to the standard `Server.ChatHandler`. **Not present in docs.ollama.com's API reference or `docs/openapi.yaml`** — verified 2026-10-18; the endpoint exists in code and is covered by `integration/audio_test.go`.

**Request — `multipart/form-data`** (25 MiB parsed-form limit server-side; `model` and `file` required or 400):

```
POST /v1/audio/transcriptions
Content-Type: multipart/form-data

--boundary
Content-Disposition: form-data; name="model"

gemma4:e4b
--boundary
Content-Disposition: form-data; name="file"; filename="prompt.wav"
Content-Type: audio/wav

<raw WAV bytes>
--boundary
Content-Disposition: form-data; name="language"     [optional]

en
--boundary
Content-Disposition: form-data; name="prompt"       [optional]

<context text appended to the system prompt>
--boundary
Content-Disposition: form-data; name="response_format"   [optional]

json
--boundary--
```

**Response (default / `response_format=json`):**

```json
{ "text": "Why is the sky blue?" }
```

- `response_format=text` → `Content-Type: text/plain`, body is the bare trimmed transcript.
- `response_format=verbose_json` → **not actually implemented**: the field is parsed but falls through to the same `{"text": ...}` JSON (no `segments`, `duration`, `language`). Do not rely on verbose fields.
- **No streaming.** The middleware internally streams from the chat handler but buffers everything and emits one response when `done` — clients get a single JSON body, never SSE partials.
- **No `keep_alive`, `temperature`, `options` control** — the middleware hardcodes the internal chat request (`temperature: 0`, fixed system prompt, default keep-alive).
- Internally the audio bytes are placed in the chat message's **`images`** array — audio reuses the image field end-to-end.

**How it actually transcribes (important):** the middleware builds a chat request with the fixed system prompt *"Transcribe the audio exactly as spoken. Output only the spoken words. Do not answer any question in the audio."* (+ language/prompt additions) and user text *"What exact words are spoken in this audio?"*. Transcription quality is therefore LLM-prompt-following quality, not dedicated-ASR quality.

**Errors** — OpenAI-style JSON: `{"error": {"message": "...", "type": "...", "code": ...}}` (via `openai.NewError`); older servers (< v0.20.0) return gin's plain 404 for the path.

### 2.2 Audio input in chat — two additional paths ✅ since v0.20.0

**a) `POST /v1/chat/completions` with `input_audio` content part (OpenAI-compatible, cleanest):**

```json
{
  "model": "gemma4:e4b",
  "messages": [{
    "role": "user",
    "content": [
      { "type": "text", "text": "What is asked in this audio?" },
      { "type": "input_audio", "input_audio": { "data": "<base64 WAV>", "format": "wav" } }
    ]
  }],
  "temperature": 0
}
```

Ordinary chat-completion response; full request control (`stream`, `temperature`, `max_tokens`, …) unlike the transcriptions shim.

**b) Native `POST /api/chat` — audio goes in the `images` field** (same field as images):

```json
{
  "model": "gemma4:e4b",
  "messages": [{ "role": "user", "content": "…", "images": ["<base64 WAV>"] }],
  "stream": false
}
```

⚠️ A message field named `audios`/`audio` is **not defined**; on ≤ 0.32.9 it was **silently dropped** (issue #17730 — model answers blind with HTTP 200). PR #17764 makes newer servers return 400. Never send `audios`.

### 2.3 TTS — nothing ❌

- No `/v1/audio/speech`, no `/api/*` speech/synthesize route in stock `server/routes.go`; not in the OpenAPI spec; not in docs.
- Official stance (pdevine, ollama/ollama#11021, Jun 2025): TTS/STT "looking at it, no concrete timelines" — STT since shipped; TTS has not.
- Community TTS/whisper model pages on ollama.com (e.g. `mannix/supertonic:3`, `mannix/whisper:large-v3-turbo`) state explicitly: *"Runs on xOllama, not on stock ollama. Stock ollama pulls this model but cannot show or run it."* Those pages document the **xOllama fork** (port 22434, opencoti engines) — do not confuse with stock; out of scope.
- Third-party gateways (Bifrost) still list Ollama STT/TTS as unsupported — stale w.r.t. transcriptions, but correct for TTS.

### 2.4 VAD — nothing ❌

No voice-activity detection endpoint, streaming-ASR websocket, or realtime API in stock Ollama (realtime ask = ollama/ollama#7514 → merged into umbrella #1168, open). Expected "no" confirmed.

---

## 3. Models

Audio capability on stock Ollama = models whose GGUF carries an audio encoder, detected via `audio.block_count` metadata and surfaced as capability `"audio"`:

| Model | Tags with audio | Notes |
| --- | --- | --- |
| **gemma4** | `e2b`, `e4b`, `12b` | USM conformer audio encoder (e2b/e4b); 12b embeds raw waveform. GGUF support since v0.20.0; MLX safetensors imports since v0.33.3 (2026-09-02). `26b`/`31b` have **no** audio config and reject audio input. |
| **embeddinggemma-2** | 270m–740m | Multimodal *embedding* model with audio — not usable for transcription. |

- `ollama.com/search?c=audio` shows exactly these two (of 256 models) — no kokoro/bark/whisper in the official library.
- **Whisper GGUFs do not run on stock Ollama** (encoder-decoder media models need fork engines).
- CLI-only extras shipped with v0.20.0: `ollama transcribe MODEL` and mic input in `ollama run` — client-side features, not HTTP API.

---

## 4. Quirks & auth

- **Auth:** local server needs none — `Authorization` headers are accepted and ignored (`OLLAMA_API_KEY` is only for ollama.com cloud). Audio endpoints are effectively **local-only**: the transcriptions route is not wired into the cloud-passthrough middleware, so it requires a locally pulled gemma4.
- **Multipart, not JSON:** the only multipart endpoint in Ollama's API — everything else is NDJSON/JSON. Go client must use `mime/multipart`.
- **WAV is the only evidenced container:** audio preprocessing is "WAV decode, mel spectrogram, FFT (pure Go)"; all tests use 16 kHz mono WAV; `input_audio.format` only shown as `"wav"`. mp3/flac/m4a acceptance is **unverified** (see Unknowns).
- **Long clips:** v0.33.3+ splits clips > 30 s into ≤ 30 s chunks cut at pauses (MLX gemma4 path; GGUF path behavior unverified).
- **25 MiB** multipart limit server-side.
- **Capability filtering:** `/api/tags` (and `/v1/models`) response summaries have **no capabilities field** (per OpenAPI spec `ModelSummary`). To find audio models, call **`/api/show`** per model and check `capabilities[]` contains `"audio"` (also visible: `model_info` keys like `gemma4.audio.block_count`).
- **`keep_alive`:** not settable on `/v1/audio/transcriptions`; use `/api/chat` (images field) or `/v1/chat/completions` (`input_audio`) when keep-alive control matters.
- **`audios` field trap:** silently dropped ≤ 0.32.9, 400 afterwards — always use `images`/`input_audio`.
- **Bifrost/3rd-party docs** claiming Ollama has no STT are stale; the repo source and v0.20.0 release are authoritative.

---

## 5. Go client (4-8) implementation notes

Per capability:

- **STT:** implement `Transcribe(ctx, model, wavBytes, lang?, prompt?)` → `POST {base}/v1/audio/transcriptions`, multipart with `model`, `file` (raw WAV bytes, filename `prompt.wav`, `Content-Type: audio/wav`), optional `language`, `prompt`, `response_format=json`. Decode `{"text": string}`. No streaming API. Treat as experimental capability flag.
- **Prefer `input_audio` chat for anything richer:** audio-Q&A, keep_alive, sampling control → `/v1/chat/completions` with `input_audio` parts (already in scope of the existing chat client work).
- **TTS / VAD:** do not implement; do not add capabilities.
- **Old-server detection + clean errors:** on startup or first audio use, `GET /api/version` and semver-gate `>= 0.20.0`. If gated off or the endpoint 404s, surface a typed error like *"Ollama server predates audio support (transcription requires v0.20.0+)"* rather than a raw 404. Map `{"error":{"message"}}` bodies to the provider error type.
- **Model validation:** before offering transcription, resolve audio-capable models via `/api/show` capability checks (N+1 calls over `/api/tags` results — cache). Sending a non-audio model to the transcriptions endpoint yields a confusing chat-level failure, so validate client-side first.
- **Emit WAV 16 kHz mono** from the engine's recorder/resampler for best compatibility.

---

## 6. Unknowns (explicit)

1. **Non-WAV containers** (mp3/flac/m4a/webm) — only WAV is evidenced anywhere in code/tests; whether the Go WAV decoder is the sole intake or other decoders exist is **unknown**. Engine should convert to WAV client-side regardless.
2. **`verbose_json`** — parsed but collapses to `{"text": ...}` at `main`; could gain fields in any release. Client must not depend on segment/timestamp fields.
3. **Error shape for non-audio models** on `/v1/audio/transcriptions` — not covered by tests (they skip such models); expected to be a chat-render or 4xx error. Needs a live probe in phase 5 verification.
4. **`/api/tags` capabilities in released builds** — the spec's `ModelSummary` lacks them, but the live response may include extras; unverified against a live v0.40.x server.
5. **GGUF-path >30 s chunking** — confirmed for the MLX engine path (v0.33.3 notes); GGUF path chunking behavior unverified.
6. **Cloud (ollama.com) transcription** — gemma4 has cloud tags, but the audio route is not cloud-passthrough-wired per the architecture docs; whether `https://ollama.com/v1/audio/transcriptions` works is **unknown, presumed no**.
7. **Exact minimum patch** where `/v1/audio/transcriptions` first appeared in a *stable* release — RC lineage says v0.20.0 (2026-04-03); treat `>= 0.20.0` as the gate and verify with a probe.

---

## 7. Sources (all accessed 2026-10-18)

- Official docs index (no audio page exists): https://docs.ollama.com/llms.txt
- OpenAI compatibility page (no `/v1/audio/*` listed): https://docs.ollama.com/api/openai-compatibility
- API introduction / base URLs & auth: https://docs.ollama.com/api/introduction
- OpenAPI spec (no audio paths): https://github.com/ollama/ollama/blob/main/docs/openapi.yaml
- Transcription middleware (exact wire behavior): https://github.com/ollama/ollama/blob/main/middleware/openai.go
- Transcription request/response types + chat conversion: https://github.com/ollama/ollama/blob/main/openai/openai.go
- Integration tests (multipart shape, WAV clip, capability gating): https://github.com/ollama/ollama/blob/main/integration/audio_test.go
- Gemma 4 + audio PR (v0.20.0 lineage): commit `96b202d`, PR #15214 — https://github.com/ollama/ollama/commit/96b202d34b82d1755887bf4204e1f2e053720d4f ; compare v0.19.0…v0.20.0-rc0: https://github.com/ollama/ollama/compare/v0.19.0...v0.20.0-rc0
- `audios` silently dropped (0.32.9) + `images`-field ruling: https://github.com/ollama/ollama/issues/17730 (fix PR #17764)
- Docs-gap issue: https://github.com/ollama/ollama/issues/15427
- TTS not planned/dupe-closed: https://github.com/ollama/ollama/issues/11021 , https://github.com/ollama/ollama/issues/1234 ; realtime: #7514 → #1168
- v0.33.3 MLX gemma4 audio + 30 s chunking (release-notes mirror): https://prismix.dev/news/063e7b21df0d
- Audio-capable model listing: https://ollama.com/search?c=audio ; gemma4: https://ollama.com/library/gemma4
- xOllama-only evidence (not stock): https://ollama.com/mannix/whisper:large-v3-turbo , https://ollama.com/mannix/supertonic
- Route/middleware table corroboration: https://factory.com/open-source-wikis/ollama?page=features%2Fopenai-anthropic-compat.md
- Third-party "no STT/TTS" claim (stale, contradicted by source): https://docs.getbifrost.ai/providers/supported-providers/ollama
