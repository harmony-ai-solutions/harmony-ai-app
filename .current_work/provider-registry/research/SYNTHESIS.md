# Provider Research — Synthesis (13/13 complete)

Aggregates `.current_work/provider-registry/research/*.md` (each doc keeps the
per-provider depth; this file is the cross-provider decision layer for the
plan). Research date: 2026-10-18. Tags: `[engine-code]` facts cite engine
sources; everything external is cited in the per-provider docs.

---

## 1. Key-validation state machine (all providers)

The 401/403/429 taxonomy held across every provider researched. The verify
endpoint (`POST /api/providers/verify`) returns
`{state, detail?}` with `state ∈ valid | invalid | throttled | blocked |
scope_limited | unreachable` (+ provider payload where available).

| Provider | Verify call | invalid ⇔ | valid-but states & extras |
|---|---|---|---|
| openai | `GET /v1/models` | 401 | 403 region/admin/IP; 429 throttled |
| openrouter | `GET /api/v1/key` | 401 | 429; returns limits/usage/budgets → UI |
| google | `GET /v1beta/models?pageSize=1` | **only** 400 `reason=API_KEY_INVALID` | 401/402/403/429 all = valid-but (don't flatten!) |
| anthropic | `GET /v1/models?limit=1` | 401 | 403 scope; 429 (+`enforced_spend_limit_reached`) |
| xai | `GET /v1/models` | 401 | 403 ACL; 429 |
| mistral | `GET /v1/models` | 401 | 402 no-billing; 429 (`X-RateLimit-Remaining`) |
| elevenlabs | `GET /v1/user/subscription` | 401 | 402 payment; 403 IP-allowlist; 429; returns tier + character quota + reset → UI |
| comfyui | `GET /system_stats` | transport | 401 only if proxied w/ auth; returns version + VRAM → UI |
| ollama | `GET /api/version` | transport | keyless; version → UI |
| localai | `GET /.well-known/localai.json` → `/healthz` | 401 (if key enabled) | version → UI |
| openaicompatible | fingerprint tree step | 401 | `unreachable` on transport |
| soulvoice | `GET /version` (+ auth probe `/v1/audio/speech/models`) | 401 | version → UI |
| soulbitscloud | `POST /v1/chat/completions {}` → 400=valid | 401 | 429 throttled. **`GET /v1/models` is public — NOT a credential check** |

Hard rules for the implementer:
- Never collapse 402/403/429 into "invalid" (Google is the extreme case:
  almost every failure there means the key works).
- Error-body shapes vary: OpenAI nested, xAI flat `{code,error}`, ElevenLabs
  `detail{type,code,request_id}`, Google dual taxonomy (legacy gRPC vs
  Interactions snake_case). The verify layer parses per-provider shapes —
  the ElevenLabs vendored SDK and xAI client today discard them (fix list).

## 2. Discovery recipes (live model listing → `ModelInfo` merge)

`ModelInfo` (engine `modules/common`) grows: id, label, context, modalities,
capabilities, param support, source (`live|catalog`), provenance
(`detected|known|assumed`). Per provider:

| Provider | Recipe | Live richness |
|---|---|---|
| openai | `GET /v1/models` (bare, no pagination) + **catalog** | none — catalog carries everything |
| openrouter | `GET /models` (opt-in pagination) | max: `supported_parameters`, modalities, pricing, context |
| google | `GET /v1beta/models` (pageToken) + catalog | `supportedGenerationMethods`, token limits, thinking flag |
| anthropic | `GET /v1/models` (cursor pagination) + small overlay | rich `capabilities` (thinking, image/PDF, server tools, structured outputs) |
| xai | **merge `GET /v1/models` + `GET /v1/language-models` by id** | modalities + reasoning_effort values + context (split across the two) |
| mistral | `GET /v1/models` | 14-boolean capabilities dict + context + aliases + deprecation |
| elevenlabs | `GET /v1/models` (models) + `GET /v2/voices` (voices — **never catalogued**) | model caps, filters; voices per-account |
| comfyui | per-node `GET /object_info/{KSampler,CheckpointLoaderSimple,LoraLoader,…}` (never full `/object_info`) | instance-complete |
| ollama | `GET /api/tags` (+ `GET /api/show` for depth) | capabilities enum (9 values) + context + quantization + families |
| localai | `GET /v1/models/capabilities` (+ `/api/models/capabilities` for backend/pinned) | capabilities + modalities + context |
| openaicompatible | 10-step fingerprint → richest endpoint available → family signatures | varies by server (LM Studio rich, vLLM bare) |
| soulvoice | fan-out `GET /v1/audio/{speech,transcriptions,vad}/models` | per-capability model cards + languages/voices |
| soulbitscloud | `GET /v1/models` (needs shape upgrade to ModelInfo) | authoritative (we own it) |

## 3. Catalog (tier-2) scope

**Live-authoritative (no model rows in catalog):** openrouter, ollama,
localai, comfyui, soulvoice, soulbitscloud.
**Catalog-required:** openai (full — API reports nothing), google
(modalities/tools/params), anthropic (6 gap fields only: sampling-param
deprecation, stop_sequences, prefill, forced tool use, effort default, UI
hints), mistral (param gating incl. `reasoning_effort` enums, `n` gating,
temp max), xai (partial: fingerprint/version fields), elevenlabs (fallback
hints only).
**Always catalog:** the **param-name mapping table** (capability → wire field
per provider) and the **model-family signature tables** for the
OpenAI-compatible ecosystem. Load-bearing examples: `random_seed` (mistral)
vs `seed`; `max_tokens` vs `max_completion_tokens` (openai, and mistral has
neither in the OpenAI sense); `repeat_penalty` (ollama/localai native) vs
`repetition_penalty`; `num_predict` ↔ `max_tokens`; `think` ↔
`reasoning_effort`; `top_k` via `extra_params` on generic openaicompatible;
Mistral `additionalProperties:false` → 422 on any unknown param.

## 4. Sampling-param deprecation wave (urgent correctness issue)

Three providers now reject or ignore classic sampling params on current
flagship models: Anthropic 4.7+/Mythos (400 on non-default
temperature/top_p/top_k), Gemini 3.6+/4 (silently ignored, 400s coming),
xAI reasoning models (400 on frequency/presence/stop; logprobs ignored on
4.20+). The engine's zero-value handling makes this worse (sends `0` =
non-default). Param emission must become capability-gated — this is the
single most impactful correctness fix in the whole workstream.

## 5. Consolidated pre-workstream engine-fix list

| # | File | Bug |
|---|---|---|
| 1 | `providers/anthropic.go` | sampling zero-value → 400 risk on Claude 4.7+ |
| 2 | `providers/openrouter.go` | `ValidateConfig` no-op (unauthenticated `/models`) |
| 3 | `providers/google.go` | stale `isVisionModel` heuristic; `thinkingConfig` unwired; sampling suppression needed on 3.6+/4; `aspect_ratio` never mapped to `imageConfig` |
| 4 | `modules/common/openai.go` | hard-coded model lists stop at GPT-5 → GPT-5.6/GPT-6 invisible in pickers; deprecated `whisper-1`/`gpt-image-1` defaults; `n:0` edge |
| 5 | `providers/xai.go` | `generateImageAPI` defaults to retired `grok-2-image`; same `n:0` bug; thin `ListModels` |
| 6 | `providers/elevenlabs.go` (+SDK) | vendored SDK discards 402/403/429 taxonomy; legacy `/v1/voices` (canonical: `/v2/voices`) |
| 7 | RAG localai | `RAGLocalAIConfig` lacks `base_url`/`api_key`; chromem hardcodes `localhost:8080` + empty key |
| 8 | `providers/soulvoice.go` | `http.DefaultClient` — no timeout (indefinite hang risk) |
| 9 | `providers/soulbitscloud.go` | `ValidateConfig` probes public endpoint (never checks the PASETO); `tools`/`tool_choice` never sent |
| 10 | `providers/comfyui.go` | speaks Salad wrapper contract, not stock ComfyUI (plan §10.-1) |
| 11 | phantom types | mistral/ollama/localai: full CRUD scaffolding, no chat clients, no picker entries (plan §10.-0.5) |

## 6. Seeding defaults (soulbitscloud — resolves plan §10.1)

Gateway lineup (20 active rows; tiers/modalities/contexts in
`research/soulbitscloud.md` §3). Proposed per-module defaults (from the
gateway doc §8; owner approves):

| Module | Default model | Notes |
|---|---|---|
| backend | **`qwen-35-9b`** (aligned engine+app default, A10; runtime selection by gateway metadata) | chat |
| cognition | per gateway tier table (engine seeds `qwen-35-9b`) | reasoning-capable |
| movement | per gateway tier table (engine seeds `qwen-35-9b`) | chat |
| rag | embedding model from lineup (`harrier-oss-v1-0-6b`) | dims documented |
| tts | gateway speech model — `kitten-tts-mini` (HSE-backed workload; NOT the soulvoice provider, which is local-only) | voice default from lineup; `claire`/`bella` casing quirk; kitten-tts `language` requirement |
| stt (transcription) | gateway STT model (`faster-whisper-tiny`) | **VAD slot seeded: `silero-vad`** (free tier; engine seeds it today — A8 correction) |
| vision | vision-capable model from lineup | |
| imagination | **none — leave unset** | no production image model in the lineup (§3/§8.3); app fallback empty; skip-when-no-model semantics |

Exact model ids live in the soulbitscloud doc (§8.3) — they are
gateway-config values, so the seeding code should read them from the
gateway's model metadata (model_type/min_tier filtering) rather than
hardcoding; the fallback is the app's existing `SOULBITS_FALLBACK_MODELS`
constants (NOT this table). `starfallen-24b` is missing its `INSERT` in
gateway migrations (flag to cloud backend).

## 7. Owner-actionable items surfaced by research

1. **Rotate any legacy `sk-` OpenAI keys before 2026-10-22** (deactivation).
2. Gateway data hygiene: `harrier-oss-v1-0-6b` vs `-06b` naming
   inconsistency; voice `claire`/`bella`/`Bella` casing;
   `starfallen-24b` missing `INSERT`; `blocked` state has no gateway signal
   yet (worth adding at launch).
3. Legal-adjacent: standalone competitor SDK repos
   (`CharacterAI-Golang`, `KindroidAI-Golang`,
   `kajiwoto-clientsdk-golang`) exist in the org — outside the shipped
   product, but archive them during Phase 0 cleanup if desired.
