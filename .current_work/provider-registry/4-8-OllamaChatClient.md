# Phase 4-8 — Engine: Ollama Native Chat Client (NEW — dormant provider activation)

**Repo:** harmony-link-private · **Depends on:** 3-3 · **Gated by:** R-AUDIO research (see summary.md pre-tasks) · Serial engine chain
**Refs:** research/ollama.md (§2 endpoints, §3 tags/show, §4.4 generation, §5 param table, §7 recipes) · plan §10.-0.5, §11

## Objective

Build the native `/api/chat` client. **Audio (tts/stt) and image/decision
capabilities are OUT of initial scope** — owner ruling 2026-10-18: the
R-AUDIO research task (Ollama TTS/STT wire protocol) must complete first;
tts/stt registration + 6-5 picker entries happen only if it confirms a
tractable protocol. Streaming: **`stream:false`** (backend.Client is
synchronous — SendUserMessage(string)(string,error); no NDJSON plumbing
exists; that's future work).

## Implementation steps

1. **Enabling symbols (net-new):** `ProviderOllama` chat constant (only
   `RagProviderOllama` exists), `OllamaConfig` chat struct, ProviderConfig/
   ModelName cases, module_controller branches, registry entry,
   `AllowsCustomPrompting()`. Scaffolding (table/model/repo/CRUD/sync) is
   REAL already (provider_config_ollama exists — rides 3-1's conversion)
2. New `providers/ollama.go` native chat client:
   - `POST /api/chat` with `stream:false`; options nesting; `think` for
     reasoning models — **native `think` is a top-level bool/string taken
     from `show.thinking.values`; NO GPT-OSS effort remap (that is a /v1
     compat translation, research §5.1 — out of scope on native)**;
     `format: json` structured output; `keep_alive`
   - `GET /api/version` — verify (version payload)
   - `GET /api/tags` — listing: `details{family,families,parameter_size,
     quantization_level}` + **`capabilities[]` as a SIBLING of details**
     (model-level in tags, top-level in show; research §3.1) +
     `context_length`/`embedding_length` → 3-3 ModelInfo (provenance
     `detected`)
   - `GET /api/show` — per-model depth on demand (capabilities dict,
     projector info)
   - Verify fallback chain (research §8.1): `/api/version` → `/api/tags`;
     **404 on /api/tags ⇒ not an Ollama server → route to
     openaicompatible, don't fail**; six-state VerifyResult (keyless:
     valid/unreachable dominate)
3. **Auth:** optional proxy key via account `api_key` (plan §3.1 — NOT
   `extra`); empty = keyless
4. **Native param mapping (research §5 table, via 3-3 helper):**
   `repeat_penalty` (not repetition_penalty), `num_predict` ↔ max_tokens,
   `top_k`/`min_p` first-class, `seed`, `stop`, `num_ctx`, `keep_alive`
   default
5. **Base URL normalization:** the account stores the bare host (app
   default `http://localhost:11434`); the native client appends `/api/*`
   itself while chromem's `NewEmbeddingFuncOllama` expects baseURL WITH
   `/api` — normalize per consumer (documented in the helper); embeddings
   keep flowing from the RAG config (engine already passes
   `ragConfig.ProviderOllama.BaseURL` — no engine hardcode today)
6. Registry scope: backend, cognition, movement, vision (+ rag embeddings
   via existing path). tts/stt/imagination: only post-R-AUDIO

## Test gates

- Engine gate green
- Tests: tags→ModelInfo (capabilities sibling + context), native param
  mapping table-driven, native think handling, verify chain incl. 404-
  reroute, base_url normalization both consumers

## Checklist

- [ ] Enabling symbols + registry (chat modules only)
- [ ] Native /api/chat client (stream:false, options nesting, native think)
- [ ] /api/version verify + /api/tags + /api/show listing → ModelInfo
- [ ] Param mapping via helper; base_url normalization
- [ ] Audio/image: deferred to R-AUDIO outcome (summary pre-task)
- [ ] Engine gate green
