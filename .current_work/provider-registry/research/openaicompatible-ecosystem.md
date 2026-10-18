# Provider Research — Generic "OpenAI-compatible" Endpoints (auto-detect ecosystem)

> Workstream: Soulbits provider registry (R11 research preface).
> Scope: the **generic OpenAI-compatible local-server landscape** (everything *except* Ollama and LocalAI,
> which are covered by sibling research docs) **plus** the cross-server **model-family signature layer**.
> Research date: **2026-10-18**. All external claims cite the doc/GitHub URL used; facts read from our own
> engine source (`harmony-link-private`) are tagged **[engine-code]**.
> Author: research subagent (read-only; no code changed).

---

## 0. TL;DR for the workstream

- **The `/v1` chat surface is near-universal; capability metadata is not.** Only a few servers expose a
  *rich* model list (LM Studio `/api/v1/models`, llama.cpp `/v1/models` + `/props`, TabbyAPI `/props`,
  TGI `/info`). The rest return bare OpenAI `{id, object}`.
- **Fingerprinting is cheap and reliable for the big five** because each exposes at least one
  *uniquely-named* native endpoint:
  - LM Studio → `GET /api/v0/models` or `GET /api/v1/models` (fields `type`/`arch`/`quantization`/`state`).
  - llama.cpp `llama-server` → `GET /props` (fields `model_path`/`chat_template`/`modalities`/`build_info`)
    and `/v1/models` with `owned_by: "llamacpp"`.
  - vLLM → `GET /version` + `/metrics` containing `vllm:` metrics.
  - text-generation-webui → `GET /v1/internal/model/list`.
  - KoboldCpp → `GET /api/extra/version` → `{"result":"KoboldCpp", ...}`.
  - SGLang → `GET /get_model_info` / `GET /health_generate`.
- **Model-family signatures are the real workhorse.** For any server that returns only bare model IDs
  (Jan, vLLM default, TGI, bare llama-cpp-python, generic gateways) the *model ID is the only signal* —
  so the signature layer (regex → capability set) must carry the catalog, with `detected`/`known`/`assumed`
  provenance.
- **Server-reported capability metadata, when present, beats signatures** (LM Studio's
  `capabilities.vision`/`trained_for_tool_use`, llama.cpp's `modalities.vision`). Signatures fill the gap.
- **One optional generation probe is justified** — but only as a *last resort* for the one capability that
  cannot be inferred any other way (tool-calling), and it must be a tiny, low-`max_tokens`, timeout-bounded
  call. Everything else is answerable from metadata + signatures without generating tokens.

---

## 1. Server landscape

### 1.1 Inventory (default port / base path / auth / fingerprint endpoints)

Ports are the *documented defaults*; every server lets the operator override them, so **port is a hint, not
proof**. Base path is the OpenAI-compatible prefix (append `/v1/chat/completions`, `/v1/models`).

| Server (software) | Default port | OpenAI base path | Auth | Unique/native fingerprint endpoints |
|---|---|---|---|---|
| **LM Studio** | `1234` | `http://host:1234/v1` (+ native `/api/v0`, `/api/v1`) | Optional Bearer token (`LM_API_TOKEN`); historically any string accepted | `GET /api/v0/models` (legacy), `GET /api/v1/models` (0.4.0+), `GET /api/v0/models/{id}`, `GET /api/v1/models` — rich `type`/`arch`/`quantization`/`state`/`capabilities` |
| **vLLM** (`vllm serve`) | `8000` | `http://host:8000/v1` | `--api-key` / `VLLM_API_KEY` (Bearer) — **only** guards `/v1`,`/v2`,`/inference` | `GET /version`, `GET /health`, `GET /metrics` (`vllm:` metric prefix), `GET /load`, FastAPI `/docs` |
| **llama.cpp `llama-server`** | **`9931`** (Oct 2026 README; historically `8080`) | `http://host:9931/v1` (+ native `/completion`, `/props`, …) | `--api-key` (Bearer **or** `x-api-key`) | `GET /props`, `GET /health` → `{"status":"ok"}`, `GET /slots`, `GET /v1/models` with `owned_by:"llamacpp"` + `meta`/`architecture`; router mode `/models/load` |
| **text-generation-webui** (oobabooga) | `5000` (`--api-port`) | `http://host:5000/v1` | `--api-key` (Bearer) | `GET /v1/internal/model/list`, `POST /v1/internal/model/load`, `GET /v1/internal/logits`, `/v1/internal/stop-generation`, `/docs` |
| **TabbyAPI** (ExLlamaV2/V3) | `5000` | `http://host:5000/v1` | **Required** (api/admin keys in `api_tokens.yml`; `disable_auth` to bypass) | `GET /v1/model/load_config?model_name=…`, `POST /v1/model/load`, `POST /v1/model/unload`, `POST /v1/apply-template`, `GET /props` (llama.cpp-shaped), `/ui` chat client |
| **Jan** (llama.cpp core) | `1337` | `http://127.0.0.1:1337/v1` | Optional Bearer (`Authorization: Bearer …`) | `GET /v1/models` (minimal), `POST /v1/messages` (Anthropic), log line `JAN API listening at …` |
| **SGLang** (`sglang.launch_server`) | `8000` | `http://host:8000/v1` | `--api-key` | `GET /get_model_info`, `GET /get_server_info`, `GET /health_generate`, `GET /health` |
| **KoboldCpp** | `5001` | `http://host:5001/v1` | Optional (`--password`/`--apikey`; often keyless) | `GET /api/extra/version` → `{"result":"KoboldCpp",…}`, `GET /api/v1/model`, `GET /api/v1/info/version`, `GET /api/v1/config/max_context_length` |
| **llama-cpp-python server** (`abetlen`) | `8000` | `http://host:8000/v1` | Optional `--api-key` | FastAPI `/docs`; **no** `/props`, **no** `/health` (absence is the tell vs `llama-server`) |
| **llamafile** (Mozilla) | `8080` | `http://host:8080/v1` | Optional | single-file llama.cpp server; `/v1/models`, `/completion` |
| **TGI** (HuggingFace `text-generation-inference`) | Docker maps `8080→80`; launcher default `3000` | `http://host:8080/v1` | `--api-key` | `GET /info`, `GET /health`, `GET /metrics`, `/docs` |

Sources: LM Studio REST [`/rest/endpoints`](https://lmstudio.ai/docs/developer/rest/endpoints),
[`/rest/list`](https://lmstudio.ai/docs/developer/rest/list), [`/openai-compat`](https://lmstudio.ai/docs/developer/openai-compat);
vLLM [`Online Serving`](https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server.html) and
[`Online Serving overview`](https://docs.vllm.ai/en/stable/serving/online_serving);
llama.cpp [`tools/server/README.md`](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md);
text-generation-webui wiki
[`12-OpenAI-API`](https://github.com/oobabooga/textgen/wiki/12-%E2%80%90-OpenAI-API);
TabbyAPI wiki [`03.-Usage`](https://github.com/theroyallab/tabbyAPI/wiki/03.-Usage);
Jan [`API Reference`](https://www.jan.ai/docs/desktop/api-preference) and
[`Local API Server`](https://www.jan.ai/docs/desktop/api-server);
SGLang [`Native APIs`](https://lmsysorg.mintlify.app/docs/basic_usage/native_api) and
[issue #7068](https://github.com/sgl-project/sglang/issues/7068);
KoboldCpp [wiki](https://github.com/LostRuins/koboldcpp/wiki) and
[KoboldCpp API docs](https://lite.koboldai.net/koboldcpp_api);
llama-cpp-python [`server` docs](https://llama-cpp-python.readthedocs.io/en/latest/server);
llamafile [Tabby docs](https://tabby.tabbyml.com/docs/references/models-http-api/llamafile);
TGI [API docs](https://huggingface.github.io/text-generation-inference) and
[glukhov.org TGI guide](https://www.glukhov.org/llm-hosting/tgi).

### 1.2 Notes that matter for auto-detect

- **llama.cpp's default port moved.** The current README lists `--port` default **9931**; older builds and
  most blog posts say `8080`. Treat `8080`/`9931` as a hint only.
  ([llama.cpp server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md))
- **`/props` is answered by *two* different servers** — `llama-server` and **TabbyAPI** (which deliberately
  emulates the llama.cpp discovery endpoints). Distinguish by: `llama-server` also answers `/slots` and
  `/health` keylessly; TabbyAPI requires an API key on most endpoints and exposes `/v1/model/load*`.
  ([TabbyAPI wiki 03.-Usage](https://github.com/theroyallab/tabbyAPI/wiki/03.-Usage))
- **Anthropic `/v1/messages` is now common** (LM Studio 0.4.1+, llama.cpp, Jan). Its presence is a *weak*
  positive signal but never a discriminator on its own.
- **vLLM's `--api-key` is a partial lock**: `/invocations` (same inference capability) stays open. Don't
  treat a 200 on `/v1/models` without a key as proof auth is disabled.
  ([vLLM security note](https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server.html))
- **Auth header is `Authorization: Bearer <key>` everywhere**; llama.cpp also accepts `x-api-key`
  ([llama.cpp README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)).

### 1.3 Fingerprint decision tree (cheapest → most specific)

All probes are **GET, no body, ~1 s timeout, tolerate 404/401/403**, and should be sent to the *root* of the
user-supplied base URL (strip a trailing `/v1` before probing native paths). Run in this order and **stop at
the first confident match**:

```
0. Normalise: base = user_url with any trailing "/v1" removed.
1. GET {base}/v1/models                       (Bearer: user key or a dummy)
      → 200 proves "OpenAI-compatible chat surface". Record data[].id list.
      → if any item has owned_by == "llamacpp"  ⇒ LLAMA.CPP family (server or derivative). goto 4.
2. GET {base}/api/extra/version
      → JSON result == "KoboldCpp"              ⇒ KOBOLDCpp. done.
3. GET {base}/api/v0/models   (then /api/v1/models)
      → JSON with data[].type ∈ {llm,vlm,embeddings} + quantization/state
                                                ⇒ LM STUDIO. done.
4. GET {base}/props
      → JSON with default_generation_settings/model_path/build_info
          and GET {base}/slots == 200           ⇒ llama.cpp llama-server. done.
      → same /props but /slots 404 AND /v1/model/load_config responds
                                                ⇒ TABBYAPI. done.
5. GET {base}/version        → non-empty version string
   GET {base}/metrics        → contains "vllm:" ⇒ VLLM. done.
6. GET {base}/get_model_info (or /health_generate) == 200
                                                ⇒ SGLANG. done.
7. GET {base}/v1/internal/model/list
      → JSON {model_names:[…]}                  ⇒ TEXT-GENERATION-WEBUI. done.
8. GET {base}/info           → JSON with model_id/model_dtype/max_total_tokens
                                                ⇒ TGI. done.
9. GET {base}/docs           → FastAPI HTML AND no /props
                                                ⇒ generic FastAPI (llama-cpp-python or custom).
10. else                                      ⇒ UNKNOWN OpenAI-compatible; rely on signatures only.
```

Design rules baked into the tree:

- **Never probe a path that mutates state.** `/v1/model/load`, `/models/load`, `/props` (POST), `/api/extra/abort`
  are off-limits. (TabbyAPI's `/v1/model/load_config` is a safe *GET*.)
- **`/props` before `/version`**: llama.cpp and TabbyAPI are more common on LANs than vLLM, and `/props`
  is a single cheap GET that also yields the richest metadata (context, template, vision flag).
- **The `owned_by:"llamacpp"` field in `/v1/models` is the cheapest llama.cpp tell** — it can be read from the
  probe you already have to make in step 1, so prefer it before any native call.
- **Distinguish "auth required" from "not this server".** A `401` on a native path is *not* a miss; it means
  the server exists but wants a key. Re-probe with the user's key before concluding.
- **Cache the verdict** keyed by `base_url` (server software does not change between probes) and re-verify
  only on connection failure.

---

## 2. Metadata per server (beyond bare `/v1/models`)

### 2.1 LM Studio — richest native metadata

`GET /api/v0/models` (legacy) returns, per model:
`id`, `object`, **`type`** (`llm` | `vlm` | `embeddings`), **`publisher`**, **`arch`** (e.g. `qwen2_vl`,
`llama`), **`compatibility_type`** (`gguf` | `mlx`), **`quantization`** (`Q4_K_M`, `4bit`), **`state`**
(`loaded` | `not-loaded`), **`max_context_length`**.
([LM Studio `/rest/endpoints`](https://lmstudio.ai/docs/developer/rest/endpoints))

`GET /api/v1/models` (0.4.0+, preferred) is even richer:
`type` (`llm`|`embedding`|`decision`), `publisher`, `key`, `display_name`, `architecture`,
`quantization{name, bits_per_weight}`, `size_bytes`, `params_string`, `loaded_instances[]{ id,
config{context_length, eval_batch_size, parallel, flash_attention, num_experts, offload_kv_cache_to_gpu} }`,
`max_context_length`, `format` (`gguf`|`mlx`), **`capabilities{ vision: bool, trained_for_tool_use: bool,
reasoning{ allowed_options[], default } }`**, `variants[]`, `selected_variant`.
([LM Studio `/rest/list`](https://lmstudio.ai/docs/developer/rest/list))

**Implications:** `type == "vlm"`/`capabilities.vision` → vision; `trained_for_tool_use` → tools;
`reasoning.allowed_options` → thinking/reasoning; `max_context_length` → context window;
`type == "embedding"` → embeddings; `format` → GGUF vs MLX (quantized, not full precision). This is the
single best live-discovery surface of any local server — **use it as the primary source when detected.**

### 2.2 vLLM — standard shape + version

`GET /v1/models` returns the standard OpenAI object list; vLLM augments with `max_model_len` and
`permission[]`/`root`/`parent` in many builds. `GET /version` returns the server version string. There is
**no per-model capability dict** — capabilities come from `--served-model-name`, the model architecture, and
server flags (`--max-model-len`, `--enable-auto-tool-choice`, `--tool-call-parser`).
([vLLM Online Serving](https://docs.vllm.ai/en/stable/serving/online_serving); [`serve` CLI](https://docs.vllm.ai/en/stable/cli/serve))

**Implication:** for vLLM the *model id is often a full HF path* (e.g. `Qwen/Qwen3-8B`) — feed it straight to
the signature layer. Tool calling depends on the server having been started with the right parser, which is
**not discoverable over HTTP** → conservative default ("assume tools only if the family supports them").
([vLLM tool-calling docs](https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server.html))

### 2.3 llama.cpp `llama-server` — richest *native* metadata

`GET /v1/models` per entry: `id` (model path, or `--alias`), `object`, **`architecture{ input_modalities[],
output_modalities[] }`** (always includes `text`; adds `image`/`audio` when multimodal; `decisions` marks a
native decision model), `created`, **`owned_by: "llamacpp"`**, **`meta{ vocab_type, n_vocab, n_ctx_train,
n_embd, n_params, size }`**.
([llama.cpp server README — `/v1/models`](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md))

`GET /props` returns: `default_generation_settings` (full sampler defaults incl. `n_ctx`),
**`total_slots`**, **`model_path`**, **`chat_template`**, **`chat_template_caps`**, **`modalities{vision}`**,
`media_marker`, **`build_info`**, `is_sleeping`.
([llama.cpp server README — `/props`](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md))

**Implications:** `architecture.input_modalities` contains `image` ⇒ vision (authoritative, from GGUF
metadata/projector). `meta.n_ctx_train` ⇒ trained context. `total_slots` ⇒ concurrency ceiling.
`chat_template_caps` hints at tool-calling template support. `--reasoning-format`/`--reasoning` flags mean
thinking models surface `message.reasoning_content`.

### 2.4 TabbyAPI — llama.cpp-compatible discovery

`GET /v1/models` entries carry a **`meta`** block with `n_ctx_train`, `n_vocab`, `n_embd` read from the
model's `config.json`; the *loaded* model additionally reports `n_ctx` and weight `size` in bytes.
`GET /props` returns `model_path`, `default_generation_settings.n_ctx`, `total_slots`, `chat_template`,
`modalities.vision`. `POST /apply-template` (and `/v1/apply-template`) renders a prompt without generating.
([TabbyAPI wiki 03.-Usage](https://github.com/theroyallab/tabbyAPI/wiki/03.-Usage))

**Implication:** `modalities.vision` is authoritative for vision; `n_ctx`/`n_ctx_train` give the context
window. TabbyAPI is ExLlama (EXL2/EXL3 quantized, safetensors) — not GGUF.

### 2.5 text-generation-webui

`GET /v1/models` "Lists models. Currently loaded model first"; `GET /v1/models/{id}` returns model info.
The template/context detail lives behind `GET /v1/internal/model/list` (directory listing) and the loaded
model's `instruction_template` detection (auto-detected from model metadata unless overridden).
([textgen wiki 12-OpenAI-API](https://github.com/oobabooga/textgen/wiki/12-%E2%80%90-OpenAI-API))

**Implication:** metadata is thin over the OAI surface — lean on the signature layer; the
`/v1/internal/*` namespace is what proves identity.

### 2.6 SGLang

`GET /get_model_info` returns the model/tokenizer paths and architecture info; `GET /get_server_info`
returns CLI args, token limits and memory-pool sizes; `/health` and `/health_generate` are health probes.
([SGLang Native APIs](https://lmsysorg.mintlify.app/docs/basic_usage/native_api))

### 2.7 TGI (HuggingFace)

`GET /info` returns a rich dict: `model_id`, `model_dtype`, `model_device_type`, `model_pipeline_tag`,
`max_concurrent_requests`, `max_best_of`, `max_stop_sequences`, `max_input_length`, `max_total_tokens`,
`waiting_served_ratio`, etc. ([TGI API docs](https://huggingface.github.io/text-generation-inference))

### 2.8 KoboldCpp

`GET /api/v1/model` → model name; `GET /api/extra/version` → `{result:"KoboldCpp", version}`;
`GET /api/v1/config/max_context_length` and `/api/extra/true_max_context_length` → context.
([KoboldCpp wiki](https://github.com/LostRuins/koboldcpp/wiki), [API docs](https://lite.koboldai.net/koboldcpp_api))

### 2.9 Jan

`GET /v1/models` returns only `{ id, object: "model" }` — **no capability metadata at all**. Jan runs a
llama.cpp router under the hood (`llama-server --models-preset … --models-max … --no-webui`), but that
richness is not re-exported on the Jan HTTP surface.
([Jan API Reference](https://www.jan.ai/docs/desktop/api-preference),
[Jan llama.cpp engine](https://www.jan.ai/docs/desktop/local-engine/llama-cpp))

---

## 3. Param support per server (compatibility matrix)

Legend: **✅** honoured · **🟡** accepted but ignored / partial · **⛔** rejected (400) or unknown · **~** via
extra/aliased name.

| Param | LM Studio | vLLM | llama.cpp | TGWU | TabbyAPI | Jan | SGLang | KoboldCpp | TGI |
|---|---|---|---|---|---|---|---|---|---|
| `temperature` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `top_p` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **`top_k`** | ✅ | ✅ (extra_body) | ✅ (native `top_k`) | ✅ (docs use it) | ✅ | ✅ | ✅ | ✅ | ✅ (`top_k`) |
| `min_p` | ✅ (native) | ✅ (extra) | ✅ (native) | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 |
| **`repetition_penalty`** | ✅ | ✅ | ~ native `repeat_penalty` | ✅ | ✅ | ✅ | ✅ | ~ `rep_pen` | ✅ |
| `frequency_penalty` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `presence_penalty` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `seed` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `stop` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `logprobs`/`top_logprobs` | ✅ | ✅ | ✅ (`n_probs`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `max_tokens`/`max_completion_tokens` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **`response_format: json_schema`** | ✅ (grammar/Outlines) | ✅ (+`structured_outputs`) | ✅ (`json_schema`) | 🟡 (grammar) | ✅ (+regex/EBNF) | ✅ | ✅ (FSM) | ✅ | ✅ (`grammar`/json) |
| **`tools` / tool calling** | ✅ (native+default) | ✅ (needs `--enable-auto-tool-choice`+parser) | ✅ (jinja template) | ✅ | ✅ | ✅ | ✅ | 🟡 | 🟡 |
| `stream` (SSE) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `n` (>1) | 🟡 | 🟡 | ✅ (`n_cmpl`) | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 |
| `logit_bias` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 | ✅ | 🟡 |
| `chat_template_kwargs` | 🟡 | ✅ | ✅ | 🟡 | 🟡 | 🟡 | ✅ | 🟡 | 🟡 |

Sources per row (representative): vLLM extra params
([Online Serving](https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server.html));
llama.cpp `top_k`/`min_p`/`repeat_penalty`/`json_schema`/`n_cmpl`
([server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md));
LM Studio `top_k` & structured output via grammar/Outlines
([Structured Output](https://lmstudio.ai/docs/developer/openai-compat/structured-output),
[Tool Use](https://lmstudio.ai/docs/developer/openai-compat/tools));
TGWU `top_k` in every doc example and tool calling
([textgen wiki](https://github.com/oobabooga/textgen/wiki/12-%E2%80%90-OpenAI-API));
TabbyAPI JSON schema + regex + EBNF and OAI tool calling
([tabbyAPI README](https://github.com/theroyallab/tabbyAPI),
[wiki 03.-Usage](https://github.com/theroyallab/tabbyAPI/wiki/03.-Usage));
Jan tool calling ([Jan API Reference](https://www.jan.ai/docs/desktop/api-preference));
KoboldCpp structured output via OAI endpoints
([discussion #1689](https://github.com/LostRuins/koboldcpp/discussions/1689));
TGI `top_k`/grammar/`json_output` ([TGI API docs](https://huggingface.github.io/text-generation-inference)).

### 3.1 Matrix takeaways for the engine

- **`top_k` is the "everyone supports it, OpenAI doesn't" parameter.** Our engine's OpenAI-compatible
  provider config **has no `TopK` field** (unlike the OpenRouter config, which does) — **[engine-code]**
  `config.OpenAICompatibleProviderConfig` carries `temperature`, `top_p`, `frequency_penalty`,
  `presence_penalty`, `n`, `stop`, `seed`, `response_format`, `extra_params` only. So on generic endpoints
  **`top_k` must travel through `extra_params`** (which `buildParams()` already merges via
  `params.SetExtraFields`). **[engine-code]**
- **`repetition_penalty` vs `frequency_penalty`/`presence_penalty` are different knobs**, and llama.cpp/
  KoboldCpp prefer the former under a *different wire name* (`repeat_penalty`/`rep_pen`). The per-provider
  param-name mapping in the R12 catalog must map capability → wire field per server family.
- **`response_format: json_schema` is broadly honoured** (all but TGWU are ✅ or grammar-based), so
  structured output is a safe default *capability* but its *wire shape* varies: llama.cpp accepts
  `{"type":"json_schema","schema":{…}}` (and also a flat `{"type":"json_object","schema":{…}}`),
  LM Studio/OpenAI accept `{"type":"json_schema","json_schema":{"name","schema","strict"}}`.
  **[engine-code]** our provider passes `response_format` through as raw JSON, so the caller controls the shape.
- **Tool calling is the least discoverable capability.** It depends on (a) the model family, (b) the server
  build/flags (vLLM needs a parser; llama.cpp needs a jinja template), and (c) for weak models, LM Studio's
  "default" fallback. This is the one place a probe may be worth it (§6).

---

## 4. Model-family signatures (the cross-server layer)

Because several servers (Jan, vLLM default, TGI, bare llama-cpp-python, generic gateways) return only a
model ID, the signature layer must be able to derive capabilities from the ID string alone. Match
**case-insensitively**, on the raw `id`, and also on a normalised form with `_`→`-`, `/`→`-`, and quant
suffixes stripped.

### 4.1 Capability signatures

| Signature (regex, case-insensitive) | Family | Vision | Tools | Thinking | Notes | Conf. |
|---|---|---|---|---|---|---|
| `qwen3(\.5)?-?vl` / `qwen3-vl` / `qwen2\.5-vl` / `qwen2-vl` | Qwen VL | ✅ | ✅ | ✅ (thinking variants) | Qwen3-VL is vision+tools+thinking; Qwen2.5-VL vision+tools | high |
| `qwen3\.5` (text) / `qwen3-(?!vl)` | Qwen3 / 3.5 | ~ (3.5 4B/9B are multimodal) | ✅ | ✅ (`enable_thinking`) | Qwen3 ships thinking-on by default; `/no_think` soft switch | high |
| `qwq` | QwQ | ⛔ | ⛔ | ✅ | reasoning-only preview line | high |
| `qwen2\.5` / `qwen2-(?!vl)` | Qwen2/2.5 | ~ (`-vl` only) | ✅ | ⛔ | strong tool templates | med |
| `deepseek-r1` (not `-distill`) | DeepSeek R1 | ⛔ | ✅ (R1-0528) | ✅ | base R1 lacked tools; R1-0528 added FC+JSON | high |
| `deepseek-r1-distill` | R1 distills | ⛔ | 🟡 | ✅ | reasoning inherited from teacher | med |
| `deepseek-v3(\.\d)?` / `deepseek-v3` | DeepSeek V3.x | ⛔ | ✅ | ~ (V3.1/3.2 hybrid) | V3.2 adds "thinking with tools" | high |
| `llama-?4` / `llama4` | Llama 4 | ✅ | ✅ | ⛔ | Scout 16E / Maverick 128E, native multimodal MoE | high |
| `llama-?3\.2` (`-vision`) | Llama 3.2 | ~ (`-vision`) | ✅ | ⛔ | 3.2 11B/90B vision; 1B/3B text | med |
| `llama-?3\.[123]` / `llama-?3\.3` | Llama 3.1/3.3 | ⛔ | ✅ | ⛔ | 3.3-70B ~98% tool-call accuracy | high |
| `gemma-?3` | Gemma 3 | ✅ | 🟡 | ⛔ | multimodal; tool use weak without fine-tune | med |
| `gemma-?4` / `functiongemma` | Gemma 4 | ✅ | ✅ | ⛔ | E2B/E4B edge, native function calling | med |
| `phi-4(-mini)?` | Phi-4 | ⛔ (mini: ⛔) | 🟡 (mini: ✅) | ✅ (reasoning) | Phi-4-mini supports FC; phi-4-reasoning-vision exists | med |
| `mistral-small` | Mistral Small | ✅ (3.2/4) | ✅ | ⛔ | Small 3.2 improved FC; Small 4 is MoE 119B/6B-active w/ vision | med |
| `mixtral` | Mixtral | ⛔ | ✅ | ⛔ | MoE; constrained output | med |
| `command-r` | Command R | ⛔ | ✅ | ⛔ | RAG/tool-use tuned | high |
| `glm-4(\.\d)?` | GLM-4/4.5 | ~ (4.5V) | ✅ | ✅ | agent/tool oriented | med |
| `granite` | IBM Granite | ~ | ✅ | ⛔ | enterprise tool use | med |
| `nemotron` | NVIDIA Nemotron | ~ | ✅ | ✅ | | low |
| `smollm` | SmolLM | ⛔ | 🟡 | ⛔ | tiny | low |

Sources: Qwen3 thinking + tools + `/think`/`/no_think`
([Qwen3 HF card](https://huggingface.co/Qwen/Qwen3-8B), [Qwen3 blog](https://qwenlm.github.io/blog/qwen3));
Qwen3-VL / Qwen2.5-VL ([Qwen3-VL repo](https://github.com/qwenlm/qwen3-vl));
DeepSeek R1-0528 tools/JSON and V3.2 thinking-with-tools
([Fireworks DeepSeek guide](https://fireworks.ai/blog/deepseek-models),
[Vercel V3 vs R1](https://vercel.com/i/deepseek-r1-vs-v3),
[DeepSeek-V3.2 HF](https://huggingface.co/deepseek-ai/DeepSeek-V3.2));
Llama 4 multimodal MoE + tools ([Meta blog](https://ai.meta.com/blog/llama-4-multimodal-intelligence),
[Llama 4 Scout/OpenRouter](https://openrouter.ai/meta-llama/llama-4-scout));
Llama 3.3 tool calling ([Function-calling test](https://www.youtube.com/watch?v=NLpksran1gk));
Gemma 3 vision / Gemma 4 function calling
([Ollama function-call models](https://ollama.com/search?q=function+call),
[SLM 2026 guide](https://localaimaster.com/blog/small-language-models-guide-2026));
Phi-4-mini function calling ([Phi-4-mini HF card](https://huggingface.co/microsoft/Phi-4-mini-instruct));
Mistral Small 3.2/4 tool use + vision
([Mistral function calling docs](https://docs.mistral.ai/studio/conversations/function-calling),
[local tool-calling comparison](https://machinelearningmastery.com/comparing-local-tool-calling-gemma-4-vs-llama-3-vs-mistral));
GLM-4.5 agent/tool ([Llama vs Mistral vs Phi 2026](https://www.premai.io/blog/llama-vs-mistral-vs-phi-complete-open-source-llm-comparison-for-enterprise-2026)).

### 4.2 MoE / size / architecture signatures

| Pattern | Meaning | Implication |
|---|---|---|
| `-A3B`, `-A22B`, `-A4B` (Qwen3-VL-235B-**A22B**, Qwen3-30B-**A3B**) | **active** params per token in an MoE | MoE; not a dense model of that size; VRAM = total params, speed ≈ active |
| `-128E`, `-16E` (Llama-4-…-**128E**) | number of **experts** | MoE, confirms Llama-4 MoE |
| `MoE`, `mixture-of-experts`, `moe` | explicit MoE | same |
| `-Instruct`, `-it`, `-chat` | instruction-tuned | safe for chat/tools |
| `-Base`, `-base`, `-pretrain` | base model | ⛔ chat formatting unreliable |
| `-Coder`, `coder` | code-tuned | code, often weaker tool templates |
| `-VL`, `-vision`, `-vl` | vision-language | vision ✅ |

### 4.3 Quantization / format suffixes (GGUF vs safetensors vs MLX)

| Pattern | Format | Notes |
|---|---|---|
| `Q2_K`,`Q3_K_S/M/L`,`Q4_0`,`Q4_K_S/M`,`Q5_K_S/M`,`Q6_K`,`Q8_0` | **GGUF** (K-quants/legacy) | `Q4_K_M` = best general default; `Q5_K_M` higher quality ([kaitchup](https://kaitchup.substack.com/p/choosing-a-gguf-model-k-quants-i), [HF GGUF docs](https://huggingface.co/docs/hub/en/gguf)) |
| `IQ1_*`…`IQ4_*` (`IQ4_XS`, `IQ2_M`, `IQ3_S`) | **GGUF** (i-quants) | importance-matrix; `IQ4_XS` ≈ 4.25 bpw, more sensitive to imatrix quality ([HF GGUF docs](https://huggingface.co/docs/hub/en/gguf), [SO answer](https://stackoverflow.com/questions/78356777/what-does-i-in-the-section-iq-and-m-mean-in-this-name-meta-llama-3-8b-i)) |
| `f16`, `bf16`, `F16`, `FP16` | GGUF or safetensors | near-lossless |
| `-AWQ`, `-GPTQ`, `-FP8`, `-4bit`, `-8bit`, `-Int4` | **safetensors** (GPU) | vLLM/TGI style; not GGUF |
| `exl2`, `exl3`, `EXL3`, `4.0bpw` | **ExLlama** | TabbyAPI; safetensors |
| `@q4_k_m`, `@q8_0` (LM Studio variant suffix) | GGUF/MLX variant tag | strip before family match ([LM Studio `/rest/list`](https://lmstudio.ai/docs/developer/rest/list)) |
| `.gguf` in the id / `-GGUF` | GGUF | definitive format tell |
| full HF path `Org/Model-…` | safetensors (vLLM/TGI) | usually means a GPU server |

**Normalisation rule:** before signature matching, strip a trailing quant/format suffix and any `@variant`,
then lowercase and collapse separators. Keep the *original* id for display.

### 4.4 Confidence model

- **high** — family token is distinctive *and* capability is a stable property of that family
  (e.g. `deepseek-r1` → thinking; `qwen3-vl` → vision).
- **medium** — family token distinctive but the specific variant flips a capability
  (e.g. `qwen2.5` vs `qwen2.5-vl`; `gemma-3` tools).
- **low** — only size/quant/format hints, or a family with heterogeneous capabilities.
- **unknown** — no signature matched → fall back to conservative defaults (§5).

---

## 5. Merge strategy

Precedence (highest wins), matching the R12 rule "live discovery > static catalog > user override", with the
signature layer slotted between live and catalog:

```
1. LIVE server metadata   (LM Studio capabilities{}, llama.cpp modalities/architecture,
                           TabbyAPI /props, TGI /info, vLLM max_model_len)      → provenance: detected
2. FAMILY SIGNATURE        (regex over the model id)                             → provenance: known | assumed
3. STATIC CATALOG          (engine go:embed JSON, curated rows)                  → provenance: known
4. CONSERVATIVE DEFAULTS   (chat, text-only, no tools, no thinking, ctx 4096)    → provenance: assumed
   — user capability_json override always wins the display but is WARNED, never blocked
```

### 5.1 Provenance labels

- **`detected`** — the server told us (live metadata).
- **`known`** — a signature/catalog row with a definite family match.
- **`assumed`** — conservative default, or a signature with only partial information.
- Each capability field carries its own provenance so the UI can show a per-chip source
  (e.g. vision=`detected`, tools=`assumed`).

### 5.2 Conflict handling

| Conflict | Rule |
|---|---|
| Server says **vision:false**, signature says vision:true | **Trust the server** for the *served* model — the operator may have loaded a text-only build or disabled the projector. Label `detected` and, if the family disagrees, add an inline note "server reports no vision". |
| Server says **vision:true**, signature says text | Trust the server (a VL fine-tune may carry an unfamiliar name). |
| Server has **no metadata**, signature says vision | Trust signature, label `known`/`assumed`. |
| Server says **tools:true**, family not tool-trained | Trust the server (LM Studio "default" fallback still emits tool calls, just lower quality). Label `detected` + quality caveat. |
| Server says **no tools**, family is tool-trained | Trust the server *for tool parsing* but surface a hint that the model itself can do tools; recommend the operator enable the server's tool mode (vLLM parser, llama.cpp `--jinja`). |
| **context window**: server `max_context_length`/`n_ctx` vs family training ctx | Use the **server's** value (it is what will actually be enforced) but keep the family's trained ctx as a tooltip ("trained for 131k, served at 32k"). |
| **quant/format**: server `format`/`quantization` vs id suffix | Server wins (it read the actual file). |

### 5.3 Why server metadata wins when present

Server metadata is **ground truth about the running instance** (which quant is loaded, whether the projector
is attached, the actual context), whereas signatures are priors about a model *family*. The only exception is
when server metadata is *absent* (Jan, bare vLLM, TGI default) — then signatures are all we have.

---

## 6. Practical probe recipe (what the engine should run)

Triggered when a user enters/edits an OpenAI-compatible `base_url` (+ optional key). All steps are
**side-effect-free**, **bounded**, and **independently timeout-guarded**. Suggested total budget ≈ 8 s.

```
Step A — Identify server (native probes, §1.3)
  base = strip trailing "/v1"
  A1 GET {base}/v1/models        timeout 3s   (Bearer key or dummy)
       → record ids + owned_by; if owned_by=="llamacpp" set family=llama.cpp
  A2 native probes in tree order  timeout 1.5s each, stop on first match
  → verdict: {server_software, confidence}

Step B — List models (prefer the rich endpoint if the server has one)
  B1 LM Studio   : GET {base}/api/v1/models  → full metadata (§2.1)   [if server==lmstudio]
  B2 llama.cpp   : GET {base}/props + /v1/models → modalities/meta    [if server==llamacpp]
  B3 TabbyAPI    : GET {base}/props + /v1/models → meta               [if server==tabbyapi]
  B4 TGI         : GET {base}/info                                    [if server==tgi]
  B5 else        : GET {base}/v1/models (already have it from A1)
  → model list [{id, live_capabilities?}]

Step C — Per-model capability inference (NO network)
  for each model id:
    caps = merge( live_metadata(B) , signature(id) , catalog(id) , defaults )   §5
    attach per-field provenance

Step D — Optional generation probe (LAST RESORT, opt-in)
  Run ONLY when: (a) server has no metadata AND (b) family signature is medium/low confidence AND
                 (c) the user's module actually needs the ambiguous capability (tools or json_schema).
  Probe: POST {base}/v1/chat/completions
     { model: <id>, messages:[{role:"user",content:"hi"}],
       max_tokens: 1, temperature: 0, stream: false }
  - timeout 5–8s, ignore response body beyond "did it 200".
  - A 200 proves the model is loadable/chat-capable; it does NOT prove tools/vision.
  - For tools specifically, a probe with a tiny single-tool schema + `tool_choice:"auto"` and
    max_tokens small can confirm `finish_reason=="tool_calls"` — but ONLY if the user opted in,
    because cold-model load can take 10–60s (§7).
```

### 6.1 Cost / latency guidance

- **Avoid generation probes by default.** On a cold model, the *first* request pays the model-load cost
  (multi-GB read from disk → tens of seconds). A probe that the user did not ask for can look like a hang.
- If a probe is used, mark the model as "cold" and warn; do the probe **asynchronously** after the config is
  saved, not blocking the UI.
- **Native probes are cheap** (no model load) and should always run.

### 6.2 Failure handling

| Symptom | Interpretation | Action |
|---|---|---|
| Connection refused / DNS fail | server down or wrong host | surface "unreachable", keep manual config |
| `401`/`403` on `/v1/models` | key required or wrong | retry with key; if still 401 → "invalid key" |
| `401` on native path but `200` on `/v1/models` | native endpoints locked | degrade to signatures-only |
| `404` on a native path | not this server | continue tree |
| `200` on `/v1/models` but empty `data` | server up, no model loaded | prompt user to load a model |
| Timeout | host reachable but slow/loading | retry once, then mark "slow" |
| HTML at a JSON path | reverse proxy / wrong base path | hint "did you include the right path?" |

---

## 7. Quirks

### 7.1 Streaming

- All servers stream via SSE (`stream:true`) in OpenAI chunk format. **Exceptions/caveats:** llamafile
  historically could not stream (fixed in later builds) ([HN](https://news.ycombinator.com/item?id=38822998));
  llama.cpp sends SSE **comment pings** (`--sse-ping-interval`, default 30 s) during long prefill, and
  `return_progress:true` adds `prompt_progress` chunks (TabbyAPI mirrors this)
  ([llama.cpp README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md),
  [TabbyAPI wiki](https://github.com/theroyallab/tabbyAPI/wiki/03.-Usage)).
- **Reasoning/thinking models** differ in where the thought goes: llama.cpp `--reasoning-format deepseek`
  puts it in `message.reasoning_content`; Qwen3 uses `enable_thinking` via `chat_template_kwargs`; DeepSeek
  V3.2 puts it in a dedicated field. Clients must not assume `content` holds the reasoning.

### 7.2 Keep-alive / first-token latency for cold models

- **Cold-start is the dominant latency.** llama.cpp/LM Studio/Jan/KoboldCpp load one GGUF on demand; the first
  token can take 10–60 s. LM Studio has an **Idle TTL / auto-evict** that unloads after inactivity
  ([LM Studio TTL docs](https://lmstudio.ai/docs/developer/core/ttl-and-auto-evict)) — so a model that
  answered 5 minutes ago may be cold again. Set generous first-token timeouts and never treat a slow first
  call as a failure.
- llama.cpp has `--sleep-idle-seconds` (sleep on idle) and reports `is_sleeping` in `/props`; waking takes a
  request ([llama.cpp README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)).
- TabbyAPI `/v1/model/load` returns only after load; inline loading unloads/loads on model switch and can
  take long or return `503` on failure ([TabbyAPI wiki](https://github.com/theroyallab/tabbyAPI/wiki/03.-Usage)).

### 7.3 CORS for phone access

- **llama.cpp** defaults `--cors-origins *` (and echoes the Origin when credentials are allowed) — but
  `--tools`/`--mcp-*`/`--agent` force `--cors-origins localhost`
  ([llama.cpp README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)).
- **Jan** requires the operator to **enable the CORS toggle** in settings for browser access; otherwise a
  phone/browser client gets a CORS error ([Jan Local API Server](https://www.jan.ai/docs/desktop/api-server)).
- **TabbyAPI** has an `allowed_origins` network setting; the chat client can be pointed at another instance
  only if that server's `allowed_origins` permits it ([TabbyAPI wiki](https://github.com/theroyallab/tabbyAPI/wiki/03.-Usage)).
- **Implication:** our RN app talks to the sidecar over localhost, so CORS is usually irrelevant for the
  *engine*; but if the app ever hits a LAN server directly from a webview/browser, CORS must be configured on
  the server. Prefer routing through the sidecar.

### 7.4 HTTPS / self-signed on LAN

- Servers that support TLS: **llama.cpp** (`--ssl-key-file`/`--ssl-cert-file`), **vLLM**
  (`--ssl-keyfile`/`--ssl-certfile`), **TGWU** (`--ssl-keyfile/--ssl-certfile`), **TGI** (via proxy).
- Self-signed certs on a LAN IP cause cert-validation failures. The engine must allow a
  **"allow insecure TLS"** per-account toggle, or require the user to import the CA. Prefer plain `http://`
  on trusted LANs and document the risk.

### 7.5 Concurrent request limits

- **llama.cpp**: `--parallel N` slots (default `-1` = auto); requests queue per slot; `/slots?fail_on_no_slot=1`
  → 503 when busy ([llama.cpp README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)).
- **LM Studio**: `loaded_instances[].config.parallel` per model (default often 4); continuous batching
  ([LM Studio `/rest/list`](https://lmstudio.ai/docs/developer/rest/list)).
- **TabbyAPI**: continuous batching via paged attention (Ampere+); single-GPU, best for 1–2 concurrent users
  ([TabbyAPI README](https://github.com/theroyallab/tabbyAPI)).
- **vLLM / SGLang / TGI**: high concurrency by design (`--max-concurrent-requests`, continuous batching).
- **KoboldCpp / TGWU**: effectively single-user (one model, one queue) unless explicitly configured.
- **Implication:** the engine must serialize requests per local-server account (or cap concurrency at 1–2 for
  single-slot servers) and surface a clear "server busy" state instead of a timeout.

---

## 8. Recommendations — the auto-detect design verdict

### 8.1 Reliably detectable (do it)

| Signal | Method | Confidence |
|---|---|---|
| **Server software** (LM Studio / llama.cpp / vLLM / TGWU / TabbyAPI / Jan / SGLang / KoboldCpp / TGI) | native endpoint probes (§1.3) | high for all with a unique endpoint; low for Jan/bare FastAPI |
| **Model list** | `/v1/models` (+ rich variants) | high |
| **Vision** | LM Studio `capabilities.vision`, llama.cpp `modalities.vision`/`architecture.input_modalities`, TabbyAPI `/props`, else family signature | high when server-reported, med via signature |
| **Context window** | LM Studio `max_context_length`, llama.cpp `n_ctx_train`, TabbyAPI `n_ctx`, TGI `max_total_tokens` | high when reported |
| **Embedding model** | LM Studio `type=="embeddings"`, id signature (`embed`, `bge`, `nomic`, `e5`, `gte`) | high |
| **Quantization / format** | LM Studio `quantization`/`format`, id suffix | high |
| **Chat capability** | `/v1/chat/completions` exists | high |

### 8.2 Stays heuristic (label it, don't hide it)

- **Tool/function calling** — depends on server flags (vLLM parser, llama.cpp jinja) + model family; only
  LM Studio and TGI/LM Studio-style metadata report it. Everything else is signature-derived → label
  `known`/`assumed`.
- **Thinking/reasoning** — only LM Studio reports it; elsewhere infer from family (`qwen3`, `deepseek-r1`,
  `qwq`, `glm-4.5`, reasoning variants).
- **Structured output (`json_schema`)** — the *capability* is near-universal; the exact *wire shape* is not
  discoverable → assume support, pass through the caller's `response_format`.
- **Context window** when the server reports nothing (Jan, bare vLLM, TGI) → family catalog value, marked
  `known`.
- **MoE active-param/speed** → signature only.

### 8.3 Surface to users as editable overrides

Expose a per-model capability chip with provenance and an override toggle:

- vision (on/off), tools (on/off), structured output (on/off), thinking (on/off),
  context window (number), embedding (on/off), quant/format (display only).
- Show the source chip: **detected / known / assumed / overridden**.
- **Warn, never block** on override (R12): if the user enables tools on a model whose family says "no tools",
  show "may not be supported" but allow it.
- Show a **"server reports: …"** line when server metadata disagrees with the signature, so the operator
  understands why (e.g. loaded quant lacks the vision projector).

### 8.4 Concrete engine-facing recommendations

1. **Add a per-server-family param-name map to the R12 catalog** (`capability → wire field`):
   `top_k`→`top_k` (all), `repetition_penalty`→`repetition_penalty` (vLLM/TGWU/TabbyAPI/TGI) vs
   `repeat_penalty` (llama.cpp `/completion`) vs `rep_pen` (KoboldCpp), `max_tokens` vs
   `max_completion_tokens`, `json_schema` shape variants.
2. **Use `extra_params` for `top_k`/`min_p`/`repetition_penalty`** on the OpenAI-compatible provider, since
   **[engine-code]** its config struct has no typed fields for them (unlike OpenRouter).
3. **Keep `ValidateConfig` as `GET /v1/models`** (already the engine's verify call) but **add the native
   fingerprint probes** as a separate, non-blocking discovery call feeding the capability registry.
4. **Never block config save on discovery**; store `capability_json` with whatever was detected and let the
   UI fill the rest.
5. **Prefer rich endpoints per server**: `/api/v1/models` (LM Studio) > `/props`+`/v1/models` (llama.cpp,
   TabbyAPI) > `/info` (TGI) > `/v1/models` (everything else).
6. **Do not run a generation probe by default.** Offer it as an explicit "test capabilities" button; run it
   async; treat cold-start latency (10–60 s) as normal.
7. **Serialize requests per local account** and surface "server busy" rather than timing out.

---

## 9. Sources

**LM Studio**
- REST API v0 endpoints — https://lmstudio.ai/docs/developer/rest/endpoints
- List your models (v1) — https://lmstudio.ai/docs/developer/rest/list
- OpenAI-compatible endpoints — https://lmstudio.ai/docs/developer/openai-compat
- Structured Output — https://lmstudio.ai/docs/developer/openai-compat/structured-output
- Tool Use — https://lmstudio.ai/docs/developer/openai-compat/tools
- Idle TTL & auto-evict — https://lmstudio.ai/docs/developer/core/ttl-and-auto-evict

**vLLM**
- OpenAI-Compatible Server — https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server.html
- Online Serving (native endpoints) — https://docs.vllm.ai/en/stable/serving/online_serving
- `serve` CLI (`--served-model-name`, `--api-key`) — https://docs.vllm.ai/en/stable/cli/serve

**llama.cpp / llama-server**
- Server README — https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
- Multimodal — https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md
- Function calling — https://github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md

**text-generation-webui**
- OpenAI API wiki — https://github.com/oobabooga/textgen/wiki/12-%E2%80%90-OpenAI-API

**TabbyAPI**
- Repo — https://github.com/theroyallab/tabbyAPI
- Usage wiki — https://github.com/theroyallab/tabbyAPI/wiki/03.-Usage

**Jan**
- API Reference — https://www.jan.ai/docs/desktop/api-preference
- Local API Server — https://www.jan.ai/docs/desktop/api-server
- llama.cpp engine — https://www.jan.ai/docs/desktop/local-engine/llama-cpp

**SGLang**
- Native APIs — https://lmsysorg.mintlify.app/docs/basic_usage/native_api
- OAI server refactor issue #7068 — https://github.com/sgl-project/sglang/issues/7068

**KoboldCpp**
- Wiki — https://github.com/LostRuins/koboldcpp/wiki
- API docs — https://lite.koboldai.net/koboldcpp_api
- Structured-output discussion #1689 — https://github.com/LostRuins/koboldcpp/discussions/1689

**llama-cpp-python (abetlen)**
- OpenAI-compatible server — https://llama-cpp-python.readthedocs.io/en/latest/server
- Repo — https://github.com/abetlen/llama-cpp-python

**llamafile**
- Tabby docs — https://tabby.tabbyml.com/docs/references/models-http-api/llamafile
- LiteLLM — https://docs.litellm.ai/docs/providers/llamafile

**TGI**
- API reference — https://huggingface.github.io/text-generation-inference
- Repo — https://github.com/huggingface/text-generation-inference
- Setup guide — https://www.glukhov.org/llm-hosting/tgi

**Model families**
- Qwen3 HF card — https://huggingface.co/Qwen/Qwen3-8B · Qwen3 blog — https://qwenlm.github.io/blog/qwen3
- Qwen3-VL — https://github.com/qwenlm/qwen3-vl · Qwen function calling — https://qwen.readthedocs.io/en/latest/framework/function_call.html
- DeepSeek V3.2 HF — https://huggingface.co/deepseek-ai/DeepSeek-V3.2 · Fireworks guide — https://fireworks.ai/blog/deepseek-models · Vercel V3 vs R1 — https://vercel.com/i/deepseek-r1-vs-v3
- Llama 4 — https://ai.meta.com/blog/llama-4-multimodal-intelligence · https://openrouter.ai/meta-llama/llama-4-scout
- Phi-4-mini — https://huggingface.co/microsoft/Phi-4-mini-instruct
- Mistral function calling — https://docs.mistral.ai/studio/conversations/function-calling
- Gemma 4 / function calling — https://ollama.com/search?q=function+call · https://localaimaster.com/blog/small-language-models-guide-2026
- GLM-4.5 / SLM 2026 — https://www.premai.io/blog/llama-vs-mistral-vs-phi-complete-open-source-llm-comparison-for-enterprise-2026

**Quantization / GGUF**
- HF GGUF docs — https://huggingface.co/docs/hub/en/gguf
- Choosing GGUF quants — https://kaitchup.substack.com/p/choosing-a-gguf-model-k-quants-i
- IQ/K/M naming — https://stackoverflow.com/questions/78356777/what-does-i-in-the-section-iq-and-m-mean-in-this-name-meta-llama-3-8b-i

**Engine source (facts tagged [engine-code])**
- `harmony-link-private/providers/openaicompatible.go`
- `harmony-link-private/config/types.go` (`OpenAICompatibleProviderConfig`)
- `harmony-link-private/modules/common/client.go` (`ModelInfo`)
