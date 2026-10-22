# ComfyUI — Provider Research

> Provider workstream: **Soulbits Provider Registry** (test button + live enumeration + engine capability catalog).
> Provider under study: **ComfyUI** (self-hosted, OpenAPI-style HTTP API).
> Research date: **October 2026**. External claims cite the official docs at `docs.comfy.org` plus the upstream repo's `openapi.yaml`.
>
> Legend: `[engine-code]` = fact read from `harmony-link-private` source (engine repo). Everything else cites a URL.

---

## 0. TL;DR for the workstream

- **This is not a hosted-API provider.** There is no key, no model row, no quota. Validation = *reachability + version/health*, enumeration = *live instance introspection*.
- **The engine's current `comfyui.go` is written against a wrapper, not native ComfyUI.** It POSTs `/prompt` and expects `{id, images[], filenames[]}` (base64 inlined) and validates via `GET /health`. That is the contract of the **`comfyui-api` wrapper** (SaladTechnologies / ai-dock), not stock ComfyUI. `[engine-code]`
- Native ComfyUI: `POST /prompt` returns `{prompt_id, number, node_errors}`; images are retrieved asynchronously via `GET /history/{prompt_id}` + `GET /view`. This mismatch is the single biggest gap to resolve before the registry work.
- **Capability source verdict: fully live.** Nothing about a ComfyUI instance can be pre-cataloged (checkpoints, LoRAs, samplers, schedulers, custom nodes, VRAM are all instance-specific). Only the *mapping of which node class exposes which list* is static knowledge.
- **Cheapest verify call:** `GET /system_stats` (returns `comfyui_version`, python, OS, devices + VRAM). Avoid `GET /object_info` on mobile — it is tens of MB.

---

## 1. API basics

### Base URL

- Stock ComfyUI serves `http://127.0.0.1:8188` out of the box; `--port` changes it (default `8188`).
  Source: https://docs.comfy.org/development/deploy/self-hosting , https://docs.comfy.org/development/comfyui-server/startup-flags
- Engine config stores a single `base_url` and trims the trailing slash. `[engine-code]` (`providers/comfyui.go`, `config/types.go` `ComfyUIConfig.BaseURL`).

### Auth

- **No authentication by default.** The official docs state plainly: *"The ComfyUI server has no authentication by default. Only bind to a non-loopback address on a network you trust, or put a reverse proxy with authentication in front of it."*
  Source: https://docs.comfy.org/development/deploy/self-hosting
- There is **no built-in username/password or API-key gate for the local server.** The long-standing feature request (#987) remains open and the maintainers steer users to network isolation (Tailscale/WireGuard/SSH) or a reverse proxy with HTTP Basic auth.
  Source: https://github.com/Comfy-Org/ComfyUI/issues/987
- A **PR to add native auth + a `/health` route exists but is still open** as of early 2026 — do **not** assume it is present in a stable install.
  Source: https://github.com/Comfy-Org/ComfyUI/pull/11263
- **Practical auth options for a self-hosted box:**
  1. **Reverse proxy with HTTP Basic auth** (nginx/Caddy). Community-standard answer; the proxy must also forward WebSocket upgrade headers.
     Source: https://github.com/Comfy-Org/ComfyUI/issues/987 (nginx example), https://docs.comfy.org/development/deploy/self-hosting
  2. **Third-party login node** (e.g. `ComfyUI-Login`), which adds a `token` query arg for REST/WS calls. Not first-party.
     Source: https://github.com/Comfy-Org/ComfyUI/issues/987
  3. **ComfyUI Account API Key** — this authenticates *paid Partner Nodes* inside a workflow via `extra_data.api_key_comfy_org`; it is **not** a gate on the local server.
     Source: https://docs.comfy.org/development/comfyui-server/api-key-integration , https://support.comfy.org/articles/8203869590-how-to-generate-a-comfy-api-key
  4. **Comfy API v2 via `comfy-api-proxy`** supports an *optional static bearer token*; the proxy binds to loopback by default and you "configure a bearer token or put an authenticating reverse proxy in front of it" when exposing it.
     Source: https://docs.comfy.org/development/comfyui-server/api-proxy
- **Implication for our client:** an optional credential field is still useful, but it must support **Bearer (proxy/v2) and HTTP Basic (reverse proxy)** — the engine currently only sends `Authorization: Bearer`. `[engine-code]`

### Listen settings for LAN access from a phone

| Flag | Default | Purpose |
|---|---|---|
| `--listen [IP]` | `127.0.0.1` | Bind address. Bare `--listen` → `0.0.0.0,::` (all IPv4+IPv6). Comma-separated list supported. |
| `--port` | `8188` | Listen port. |
| `--tls-keyfile PATH` | — | Enables HTTPS (requires `--tls-certfile`). |
| `--tls-certfile PATH` | — | Enables HTTPS (requires `--tls-keyfile`). |
| `--enable-cors-header [ORIGIN]` | disabled | Enable CORS; optional origin or `*`. |
| `--max-upload-size` | `100` (MB) | Max upload size. |
| `--enable-compress-response-body` | disabled | Gzip HTTP responses (useful for the huge `/object_info`). |

Source: https://docs.comfy.org/development/comfyui-server/startup-flags

- For phone access on the same Wi-Fi: run `python main.py --listen 0.0.0.0`, open the host firewall, and point the app at the **host's LAN IP** (`http://192.168.x.y:8188`), never `localhost`.
- **ComfyUI Desktop is not a server:** its server process is killed when the app window closes, and its dynamic port allocation has caused "no available network ports between x and y" failures. Prefer a headless `main.py` install for a phone-facing endpoint.
  Source: https://forum.comfy.org/t/recommended-approach-to-enable-local-network-access-doesnt-work/1747

---

## 2. Endpoint validation (the "Test" button)

### Cheapest reachability + info call: `GET /system_stats`

Returns ComfyUI version, Python, OS, RAM, and per-device VRAM in one round-trip.

```json
{
  "system": {
    "os": "<string>",
    "python_version": "<string>",
    "embedded_python": true,
    "comfyui_version": "<string>",
    "pytorch_version": "<string>",
    "argv": ["<string>"],
    "ram_total": 123,
    "ram_free": 123,
    "comfyui_frontend_version": "<string>",
    "workflow_templates_version": "<string>",
    "cloud_version": "<string>"
  },
  "devices": [
    { "name": "<string>", "type": "<string>", "vram_total": 123, "vram_free": 123 }
  ]
}
```

Sources: https://docs.comfy.org/api-reference/cloud/system/get-system-statistics ; schema in https://github.com/Comfy-Org/ComfyUI/blob/master/openapi.yaml (`SystemStatsResponse`; `deploy_environment`, `ram_total`, `ram_free` etc.).

Why it's the right verify call:
- It is a **GET**, cheap, and always present in stock ComfyUI (listed in the canonical route table).
  Source: https://docs.comfy.org/development/comfyui-server/comms_routes
- `devices[].vram_total/vram_free` gives us VRAM for the capability catalog.
- `system.comfyui_version` proves it is *actually* ComfyUI, not just any HTTP server on the port.

### Secondary / fallback probes (in order)

1. `GET /features` → server feature flags (`max_upload_size`, `supports_preview_metadata`). Very cheap; also proves ComfyUI. Source: routes table + `openapi.yaml` `/api/features`.
2. `GET /queue` (or `GET /prompt`) → queue state; `GET /prompt` returns `exec_info.queue_remaining`. Cheap liveness. Source: `openapi.yaml` (`PromptInfo`), routes table.
3. `GET /object_info/{node_class}` (e.g. `CheckpointLoaderSimple`) → proves the node registry is up and returns a 404 for unknown classes. Cheap single-node lookup. Source: https://docs.comfy.org/development/comfyui-server/comms_routes

### Failure signals

| Symptom | Meaning |
|---|---|
| `dial tcp ...: connection refused` | Server not running, wrong port, or firewall blocking (very common for LAN). |
| TLS handshake error / `x509` | `https://` used against a plain HTTP server (or vice-versa). |
| `401 Unauthorized` | Reverse proxy Basic-auth in front; need credentials. |
| `200` but **HTML** body (or `/` returns the Comfy web page) | You reached *a* web server — possibly not ComfyUI, or a proxy default page. Parse the JSON, don't trust the status. |
| `404` on `/health` | **Expected on native ComfyUI** — `/health` is a *wrapper* probe, not a stock route (see §5). |
| `404` on `/system_stats` but `/` is HTML | Possibly the `comfyui-api` wrapper (different surface) or a non-Comfy server. |

### Timeout guidance

- **Verify call (LAN/LIVE):** connect timeout **2–3 s**, total **5 s**. `/system_stats` is tiny; anything slower is a network problem.
- **Generation:** GPU-bound; the **first** request of a session may include model load (tens of seconds to minutes). A **5-minute** overall client timeout is appropriate — the engine already sets `http.Client{Timeout: 5 * time.Minute}`. `[engine-code]`
- **Enumeration:** `/object_info` (full) can take **tens of seconds to minutes** on heavily-loaded installs and is tens of MB — give it its own generous timeout, or avoid it entirely (§3).

---

## 3. Model + node listing (the "model picker" equivalent)

ComfyUI has **no single "list my models" endpoint** — capability lives in two places: **`/object_info`** (node schemas, which embed the COMBO option lists) and **`/models`** (folder → file lists).

### 3.1 `/object_info` — node schemas (big)

- `GET /object_info` returns **every registered node class** with inputs/outputs/defaults/metadata. `GET /object_info/{node_class}` returns one class (404 if the node isn't installed).
  Sources: https://docs.comfy.org/development/comfyui-server/comms_routes ; https://www.runflow.io/blog/comfyui-api-endpoints (2026 reference)
- **Size warning:** "Response size: Tens of MB on a fully-loaded server with many custom nodes. Cache it. Don't call it on every request." A single node's COMBO option list has been measured at ~199k characters.
  Sources: https://www.runflow.io/blog/comfyui-api-endpoints ; https://glama.ai/mcp/servers/pytraveler/local-comfyui-mcp/tools/describe_node
- Performance is dominated by nodes that re-enumerate files on every call; there is an open caching request and an RFC ("object_info v2") proposing lazy-loading of COMBO options.
  Sources: https://github.com/Comfy-Org/ComfyUI/issues/6372 ; https://github.com/Comfy-Org/rfcs/pull/1

**Filtering strategy (recommended):** do **not** fetch full `/object_info` on mobile. Fetch only the handful of node classes whose COMBO inputs are the lists we need, via `GET /object_info/{node_class}`:

| What we want | Node class | Field path into the schema |
|---|---|---|
| Checkpoints | `CheckpointLoaderSimple` | `input.required.ckpt_name[0]` (array of filenames) |
| LoRAs | `LoraLoader` | `input.required.lora_name[0]` |
| VAEs | `VAELoader` | `input.required.vae_name[0]` |
| Upscale models | `UpscaleModelLoader` | `input.required.model_name[0]` |
| ControlNet models | `ControlNetLoader` | `input.required.control_net_name[0]` |
| Diffusion models (UNet-only) | `UNETLoader` | `input.required.unet_name[0]` |
| CLIP / text encoders | `CLIPLoader` | `input.required.clip_name[0]` |
| Samplers | `KSampler` | `input.required.sampler_name[0]` (array) |
| Schedulers | `KSampler` | `input.required.scheduler[0]` (array) |

Sources: field-name convention is documented for KSampler at https://docs.comfy.org/built-in-nodes/sampling/ksampler ; the COMBO-lists-are-file-lists pattern is confirmed by the historical maintainer answer *"to get the list of models you can do a GET to …/object_info/CheckpointLoaderSimple"* (https://github.com/comfyanonymous/ComfyUI/pull/1390) and the cloud example reading `objectInfo["KSampler"].input.required` (https://docs.comfy.org/development/cloud/api-reference).

A representative `/object_info/KSampler` fragment:

```json
{
  "KSampler": {
    "input": {
      "required": {
        "model": ["MODEL"],
        "seed": ["INT", { "default": 0, "min": 0, "max": 18446744073709551615 }],
        "steps": ["INT", { "default": 20, "min": 1, "max": 10000 }],
        "cfg": ["FLOAT", { "default": 8.0, "min": 0.0, "max": 100.0 }],
        "sampler_name": [["euler", "euler_ancestral", "heun", "..."]],
        "scheduler": [["normal", "karras", "exponential", "..."]],
        "denoise": ["FLOAT", { "default": 1.0, "min": 0.0, "max": 1.0 }],
        "positive": ["CONDITIONING"], "negative": ["CONDITIONING"], "latent_image": ["LATENT"]
      }
    },
    "output": ["LATENT"], "output_is_list": [false],
    "name": "KSampler", "display_name": "KSampler", "category": "sampling"
  }
}
```

Source: https://www.runflow.io/blog/comfyui-api-endpoints

**Important:** `sampler_name`/`scheduler` are drawn from `comfy.samplers.KSampler.SAMPLERS` / `.SCHEDULERS`, so the arrays are the authoritative, instance-specific lists.
Source: https://docs.comfy.org/built-in-nodes/sampling/ksampler

### 3.2 `/models` — folder → files (legacy) and `/experiment/models`

- `GET /models` → list of **model folder types** (keys of `folder_paths.folder_names_and_paths`); `GET /models/{folder}` → files in a folder (`checkpoints`, `loras`, `vae`, `controlnet`, `upscale_models`, `embeddings`, `clip_vision`, …); `404` if the folder type doesn't exist.
  Sources: https://docs.comfy.org/development/comfyui-server/comms_routes ; https://deepwiki.com/hiddenswitch/ComfyUI/13.1-rest-api-endpoints ; https://glama.ai/mcp/servers/IO-AtelierTech/comfyui-mcp/tools/list_models
- Newer builds add an experimental replacement: `GET /experiment/models` (folders) and `GET /experiment/models/{folder}` (files, with `name`/`pathIndex`). Vocabulary is request-scoped (anonymous vs authenticated can differ).
  Source: `openapi.yaml` (`/api/experiment/models`, `ModelFolder`, `ModelFile`)
- Note: `/models/{folder}` and the COMBO lists from `/object_info` should agree, but **COMBO lists are what the workflow actually accepts**, so prefer them for validation.
- `GET /embeddings` → list of embedding names. Source: https://docs.comfy.org/development/comfyui-server/comms_routes

### 3.3 Prompt templates / workflows

There is **no single first-party "list my saved workflows" JSON on the raw server**, but three sources exist:

1. `GET /workflow_templates` → map of custom-node module → template workflow names. Source: https://docs.comfy.org/development/comfyui-server/comms_routes
2. `GET /userdata?dir=workflows` (and `GET /userdata/{file}`) → user-saved files; the frontend stores workflows under `workflows/`. Source: routes table + https://github.com/Comfy-Org/ComfyUI_frontend/blob/8854fbde/src/scripts/api.ts (`getUserData`)
3. Core templates are **frontend-static** (`/templates/index.json`, `/templates/{id}.json`), served by the web root, not the API. Source: same `api.ts` (`getCoreWorkflowTemplates`); also https://docs.comfy.org/interface/features/template
4. `GET /default_workflow` → the workflow the frontend loads when none is open. Source: `openapi.yaml` (`/api/default_workflow`)

**Caveat:** template/userdata workflows are in **UI format**, not the **API format** `/prompt` requires. The engine's workflow profiles need API-format JSON (exported via "Save (API Format)"). Conversion of UI→API format is non-trivial and out of scope for the raw API. `[engine-code]` config comment: *"Export from ComfyUI using 'Save (API Format)' in the web UI."*

---

## 4. Generation parameters

### The request carries only the graph

`POST /prompt` body (native):

```json
{ "prompt": { "<node_id>": { "class_type": "...", "inputs": { ... } } },
  "client_id": "...", "prompt_id": "...", "number": 0, "front": false, "extra_data": { ... } }
```

Native response: `{ "prompt_id": "<uuid>", "number": <n>, "node_errors": { ... } }`.
Sources: https://docs.comfy.org/development/comfyui-server/comms_routes ; `openapi.yaml` (`PromptRequest`/`PromptResponse`)

**Every generation parameter is defined inside the workflow's node graph, not in the request.** The request is validated against `/object_info` and enqueued. There is no `steps=`, `cfg=`, `width=` on the request.

### The parameter surface (KSampler + latent nodes)

| Parameter | Node | Type | Default | Range | Notes |
|---|---|---|---|---|---|
| `seed` | KSampler | INT | `0` | `0 .. 18446744073709551615` | Same seed + settings = identical image. `control_after_generate` is UI-only. |
| `steps` | KSampler | INT | `20` | `1 .. 10000` | More steps ≠ always better; converging samplers settle. |
| `cfg` | KSampler | FLOAT | `8.0` | `0.0 .. 100.0` | Architecture-specific sweet spot (SD1.5/SDXL 5–9; distilled ≈1). |
| `sampler_name` | KSampler | COMBO | — | live list | Affects speed/style/quality. |
| `scheduler` | KSampler | COMBO | — | live list | Pairs with sampler; flow-matching models want Euler-family + `normal`/`beta`. |
| `denoise` | KSampler | FLOAT | `1.0` | `0.0 .. 1.0` | img2img dial; 0.4–0.6 = "keep composition, change style". |
| `width`,`height`,`batch_size` | `EmptyLatentImage` | INT | `512,512,1` | multiples of 8 | Resolution is a *latent-node* concern. |
| `ckpt_name` | `CheckpointLoaderSimple` | COMBO | — | live list | Which checkpoint loads. |
| `lora_name`,`strength_model`,`strength_clip` | `LoraLoader` | COMBO/FLOAT | — | live list | LoRA application. |

Sources: https://docs.comfy.org/built-in-nodes/sampling/ksampler ; https://docs.comfy.org/built-in-nodes/KSampler ; https://comfy.icu/node/KSampler ; sampler/scheduler semantics from https://deepwiki.com/comfyanonymous/ComfyUI/4.1-sampling-algorithms-and-schedulers and https://lecture.nakayasu.com/en/docs/comfyui/parameters/

`KSamplerAdvanced` adds `add_noise`, `noise_seed`, `start_at_step`, `end_at_step`, `return_with_leftover_noise`. Source: https://docs.comfy.org/built-in-nodes/KSamplerAdvanced

### How much is workflow-defined vs request-defined

- **100% workflow-defined.** To change steps/cfg/sampler/scheduler/denoise from our app we must locate the KSampler node and rewrite its `inputs`. To change resolution we rewrite the latent node. This is exactly what the engine's `setNodeInput` / `injectDimensions` do today, but only for a fixed subset. `[engine-code]`

---

## 5. Param name mapping (our engine client today) + gaps

### What `providers/comfyui.go` exposes `[engine-code]`

**Public API**
- `GenerateImages(profileName, positivePrompt, negativePrompt) ([]string, error)`
- `GenerateImagesWithSeed(profileName, positivePrompt, negativePrompt, seed int64) (int64, []string, error)`
- Returns images as `data:image/png;base64,…` data URLs.

**Config** (`config/types.go`)
- `ComfyUIConfig{ BaseURL, ApiKey, WorkflowProfiles map[string]ImaginationWorkflowProfile }`
- `ImaginationWorkflowProfile{ Name, Description, WorkflowJSON, PromptNodeID, PromptFieldName, NegativeNodeID, NegativeFieldName, NegativePrompt, SeedNodeID, SeedFieldName, Width, Height, Trigger, BasePrompt, SystemPromptHint }`

**Workflow build at generation time**
1. Parse `WorkflowJSON` (unwraps a JSON-string-in-JSON if present).
2. If `PromptNodeID`+`PromptFieldName`: `setNodeInput(workflow, id, field, positive)`.
3. Merge negative: `profile.NegativePrompt + ", " + callerNegative`; inject if `NegativeNodeID`+`NegativeFieldName`.
4. Seed: if `SeedNodeID`+`SeedFieldName`, random `rand.Int63()` when seed==0, else the provided seed.
5. Dimensions: `injectDimensions` walks the graph for the **first node whose `class_type == "EmptyLatentImage"`** and sets `inputs.width`/`inputs.height` (only if >0).
6. `injectSaveImageIfMissing`: if no node has an `filename_prefix` input, append node `"hl_save_image"` (`SaveImage`) wired to the best unreferenced image-producing node.
7. POST `{baseURL}/prompt` with `{"prompt": workflow}`, `Authorization: Bearer` if api_key set.
8. Parse response as `{ id, images[], filenames[] }`; wrap each base64 string as a PNG data URL.

### Gaps

| # | Gap | Detail |
|---|---|---|
| G1 | **Targets the `comfyui-api` wrapper, not native ComfyUI** | Native `POST /prompt` returns `{prompt_id, number, node_errors}` and **no images**; the engine expects inlined `images[]`. It only works against Salad/ai-dock `comfyui-api`. See §6. |
| G2 | **Validation hits `/health`** | `ValidateConfig` GETs `/health`; native ComfyUI has **no `/health`** route → 404. Should use `/system_stats`. |
| G3 | **Weak "connected" check** | `ConnectToBackend` GETs `/` and sets `connected=true` on any response (even a 401/HTML). No JSON validation. |
| G4 | **No resolution beyond `EmptyLatentImage`** | SD3/Flux latent nodes (`EmptySD3LatentImage`), SDXL buckets, and img2img paths are missed. |
| G5 | **No steps / cfg / sampler / scheduler / denoise exposure** | Only prompt/negative/seed/size are injectable. No generic `(node_id, field, value)` override. |
| G6 | **No enumeration at all** | No `ListModels`/`ListCapabilities`; no `/object_info`, `/models`, `/embeddings`. |
| G7 | **No native output retrieval** | No `/history/{prompt_id}` polling, no `/view` download. |
| G8 | **Auth is Bearer-only** | Reverse-proxy Basic auth unsupported; no URL-embedded credentials handling. |
| G9 | **No node-existence pre-validation** | A profile referencing a missing node silently logs a warning and submits a broken graph. `object_info/{class}` could pre-validate. |
| G10 | **`workflow_profiles` is a raw JSON string in the app UI** | App-side field schema is `type: 'text', placeholder: 'JSON string'` with `hasModelFetch: false`. `[app-code]` No structured profile editor, no picker. |

---

## 6. Quirks

### 6.1 Async execution + queue/event semantics

- `POST /prompt` **returns immediately** after enqueue; it does **not** block for the result (native). You must observe completion.
- **WebSocket `/ws`** is the real-time channel. JSON message types: `status`, `execution_start`, `execution_cached`, `executing`, `progress`, `executed`. Completion is signalled by an `executing` message whose `data.node` is `null` for your `prompt_id`. **Binary frames are latent preview images** (skip or decode them).
  Sources: https://docs.comfy.org/development/comfyui-server/comms_routes ; https://docs.comfy.org/development/comfyui-server/api-examples
- **`/history` polling** is the simpler alternative: poll `GET /history/{prompt_id}` until `outputs` is populated; the record includes `status.status_str` (`success`/`error`), `completed`, and `messages`.
  Source: https://www.mintlify.com/Comfy-Org/ComfyUI/api/history ; https://docs.comfy.org/development/comfyui-server/api-examples
- `GET /queue` / `GET /prompt` → queue state; `POST /interrupt` cancels the running prompt; `POST /free` unloads models.
  Source: https://docs.comfy.org/development/comfyui-server/comms_routes

### 6.2 Output retrieval: `/view`

- `GET /view?filename=<f>&subfolder=<s>&type=<output|temp|input>` returns the raw bytes.
  Source: https://docs.comfy.org/development/comfyui-server/api-examples ; https://www.mintlify.com/Comfy-Org/ComfyUI/api/history
- History output shape: `outputs[node_id].images[] = {filename, subfolder, type}`.
  Source: https://www.mintlify.com/Comfy-Org/ComfyUI/api/history
- **The wrapper (Salad `comfyui-api`) inlines base64 under `images[]`** and overrides `filename_prefix` for uniqueness; optional `X-Return-Outputs-As-Base64` / `return_outputs_as_base64`. `/health` and `/ready` probes exist there.
  Source: https://github.com/SaladTechnologies/comfyui-api

### 6.3 Port conflicts

- Default `8188`; conflicts happen when multiple Comfy instances (or Comfy Desktop's dynamic port picker) compete. Comfy Desktop has produced *"no available network ports between x and y"* errors.
  Source: https://forum.comfy.org/t/recommended-approach-to-enable-local-network-access-doesnt-work/1747

### 6.4 HTTPS / reverse-proxy setups breaking `/ws`

- The proxy must forward `Upgrade`/`Connection: upgrade` and raise the **WebSocket idle timeout** (nginx default 60 s → 600 s+ for long workflows).
- Raise `client_max_body_size` for `/upload/*` (default 1 MB is too small).
- Enable gzip for `/object_info` (tens of MB); cache `/view` aggressively.
- A path-prefix proxy (`/comfyui/`) requires correct `proxy_pass` rewriting or absolute paths break.
  Sources: https://www.runflow.io/blog/comfyui-api-endpoints ; https://github.com/Comfy-Org/ComfyUI/issues/987

### 6.5 Mobile-relevant latency notes

- First generation may include model load (tens of seconds–minutes) → keep a long overall timeout; surface progress via `/ws` or queue position (`/prompt` `queue_remaining`).
- **Never** call full `/object_info` on a phone over Wi-Fi — tens of MB and slow. Use per-node lookups (§3.1).
- `/ws` over flaky mobile networks drops; **poll `/history/{prompt_id}` at 1–2 s as the resilient path**, with `/ws` as an optimization.
- If the app runs on a device (not the Comfy host), `localhost` is wrong — must be the host LAN IP.
- `--enable-cors-header` is irrelevant to React Native `fetch` (no browser origin), but is needed if a web UI or a browser-based tool hits the instance.

---

## 7. Catalog seed table — *capabilities of the API* (not model rows)

ComfyUI is the extreme "live-only" provider. There are **no instance-independent model rows**; only the *knowledge of which node class exposes which list* is static.

| Capability | Auto-detectable? | Source endpoint / field | Notes |
|---|---|---|---|
| ComfyUI version | ✅ live | `GET /system_stats` → `system.comfyui_version` | Also `pytorch_version`, `comfyui_frontend_version`. |
| Python / OS / RAM | ✅ live | `GET /system_stats` → `system.*` | |
| GPU devices + VRAM | ✅ live | `GET /system_stats` → `devices[].vram_total/vram_free` | For "can this box run X?" hints. |
| Samplers list | ✅ live | `GET /object_info/KSampler` → `input.required.sampler_name[0]` | Instance/version-specific. |
| Schedulers list | ✅ live | `GET /object_info/KSampler` → `input.required.scheduler[0]` | |
| Checkpoints | ✅ live | `GET /object_info/CheckpointLoaderSimple` → `ckpt_name[0]` (or `/models/checkpoints`) | |
| LoRAs | ✅ live | `GET /object_info/LoraLoader` → `lora_name[0]` (or `/models/loras`) | |
| VAEs | ✅ live | `GET /object_info/VAELoader` → `vae_name[0]` (or `/models/vae`) | |
| Upscale models | ✅ live | `GET /object_info/UpscaleModelLoader` → `model_name[0]` | |
| ControlNet models | ✅ live | `GET /object_info/ControlNetLoader` → `control_net_name[0]` | |
| Diffusion/UNet models | ✅ live | `GET /object_info/UNETLoader` → `unet_name[0]` | |
| Text encoders / CLIP | ✅ live | `GET /object_info/CLIPLoader` → `clip_name[0]` | |
| Embeddings | ✅ live | `GET /embeddings` | |
| Custom node classes installed | ✅ live | `GET /object_info` (keys) or per-class 404 probe | Drives workflow compatibility. |
| Model folders available | ✅ live | `GET /models` | |
| Workflow templates | ✅ live | `GET /workflow_templates`, `GET /userdata?dir=workflows` | UI format; needs conversion. |
| Server feature flags | ✅ live | `GET /features` | `max_upload_size`, etc. |
| Queue/load state | ✅ live | `GET /queue`, `GET /prompt` | |
| **Static knowledge (not a row)** | n/a | — | (a) which node class holds which list; (b) sampler↔model-family / cfg guidance. These are app constants, not per-instance catalog entries. |

**Verdict:** **fully live**. Do not seed any ComfyUI model rows. Seed only the *probe recipe* (endpoint → node class → field) as a static constant table.

### Recommended detection recipe

```
1. GET  {base}/system_stats                     -> verify + version + devices/VRAM   (cache 60s)
2. GET  {base}/object_info/KSampler             -> samplers[] + schedulers[]         (cache 5–15m)
3. GET  {base}/object_info/CheckpointLoaderSimple -> checkpoints[]
4. GET  {base}/object_info/LoraLoader           -> loras[]
5. GET  {base}/object_info/VAELoader            -> vaes[]
6. GET  {base}/object_info/UpscaleModelLoader   -> upscale_models[]
7. GET  {base}/embeddings                        -> embeddings[]
8. GET  {base}/models                            -> folder types (optional)
```

All calls are GETs, small (except a full `/object_info`, which we deliberately avoid), and independently cacheable. Run steps 2–8 lazily/parallel and cache; run step 1 on every Test-button press.

---

## 8. Recommendations

### 8.1 Exact verify call (the "Test" button)

```
GET {base_url}/system_stats
Headers: optional (Authorization: Bearer <key>) or (Authorization: Basic <b64>)
Timeouts: connect 2–3s, total 5s
```

- **Success:** HTTP 200 **and** `Content-Type: application/json` **and** body parses with `system.comfyui_version`.
  Report to the UI: `ComfyUI <version>` + device names + `vram_total`/`vram_free`.
- **Fallback chain** (if `/system_stats` 404s, e.g. a wrapper): `/features` → `/prompt` → `/object_info/CheckpointLoaderSimple`.
- **Distinct error messages** per failure class: connection refused (not running / firewall), TLS mismatch, 401 (proxy auth), non-JSON/HTML (wrong host or proxy page), 404 (not ComfyUI).
- **Fix the engine's `ValidateConfig`** to use `/system_stats` instead of `/health` (G2), and make `ConnectToBackend` validate JSON rather than trusting any response (G3). `[engine-code]`

### 8.2 Exact enumerate calls (with object_info filtering strategy)

- **Do not fetch full `/object_info`.** Fetch only the node classes we consume:
  - `GET /object_info/KSampler` → `input.required.sampler_name[0]`, `input.required.scheduler[0]`
  - `GET /object_info/CheckpointLoaderSimple` → `input.required.ckpt_name[0]`
  - `GET /object_info/LoraLoader` → `input.required.lora_name[0]`
  - `GET /object_info/VAELoader` → `input.required.vae_name[0]`
  - `GET /object_info/UpscaleModelLoader` → `input.required.model_name[0]`
  - `GET /object_info/ControlNetLoader` → `input.required.control_net_name[0]`
  - `GET /embeddings`
- **Optionally** `GET /models` then `GET /models/{folder}` for folder-driven pickers; but prefer COMBO lists because they match what the workflow validator accepts.
- **Cache:** capability lists 5–15 min TTL; version/VRAM 60 s TTL; invalidate on config edit.
- **Robustness:** a 404 from `/object_info/{class}` means the node/custom-node isn't installed → surface "this workflow needs node X" rather than failing at generation (G9).

### 8.3 Capability-source verdict

**Fully live.** No static catalog rows for ComfyUI. The catalog/registry should store, for this provider, only:
- the static *probe recipe* (endpoint → node class → field, from §7),
- optional static *guidance* (sampler↔model-family, cfg ranges),
- nothing instance-specific.

### 8.4 Engine client notes

1. **Resolve the wrapper-vs-native mismatch (G1) — highest priority.** Support both response shapes:
   - Wrapper: `POST /prompt` → `{id, images[], filenames[]}` (base64) — current path.
   - Native: `POST /prompt` → `{prompt_id, number, node_errors}`; then poll `GET /history/{prompt_id}` and download each `outputs[*].images[]` via `GET /view?filename&subfolder&type`. Prefer `/ws` completion signal with `/history` polling as fallback.
   Detect which by probing `/system_stats` (native) vs `/health` (wrapper), or by the presence of `prompt_id` vs `id` in the response.
2. **Fix validation** to `/system_stats` (§8.1) and validate JSON (G2/G3).
3. **Add a capability/enumeration method** (e.g. `ListCapabilities()`) implementing §8.2, returning samplers, schedulers, checkpoints, loras, vaes, upscale models, embeddings, version, devices/VRAM.
4. **Generalize parameter injection (G5).** Replace the fixed prompt/negative/seed/size model with a generic `(node_id, field_name, value)` override list, plus convenience helpers for KSampler (`steps`, `cfg`, `sampler_name`, `scheduler`, `denoise`) and latent nodes. Keep `injectDimensions` but extend it to `EmptySD3LatentImage` / SDXL latent nodes (G4).
5. **Node-existence pre-validation (G9).** Before submit, `GET /object_info/{class_type}` for each node the profile references; fail fast with a clear message.
6. **Auth (G8).** Support `Authorization: Basic` in addition to `Bearer`, plus an "auth mode" config field. Note stock ComfyUI needs no auth; the field exists for reverse-proxy deployments.
7. **Timeouts.** Keep 5-min generation timeout; add a short 5-s timeout specifically for verify/enumeration calls. Surface first-load latency (model load) in the UI.
8. **App-side schema.** Today `comfyui` has `hasModelFetch: false` and a raw `workflow_profiles` JSON text field. `[app-code]` The registry work should replace this with a structured profile editor (node/field dropdowns via `ParseWorkflow`) and wire the Test button + pickers to the engine's new enumeration calls.

---

## Sources

All external claims above are drawn from the following. (Doc site: https://docs.comfy.org)

- Server routes (HTTP + WebSocket): https://docs.comfy.org/development/comfyui-server/comms_routes
- Startup flags (`--listen`, `--port`, TLS, CORS, compression): https://docs.comfy.org/development/comfyui-server/startup-flags
- Self-hosting overview + "no auth by default": https://docs.comfy.org/development/deploy/self-hosting
- System statistics response shape: https://docs.comfy.org/api-reference/cloud/system/get-system-statistics
- API examples (queue prompt, `/history`, `/view`, `/ws`): https://docs.comfy.org/development/comfyui-server/api-examples
- History endpoint + output shape: https://www.mintlify.com/Comfy-Org/ComfyUI/api/history
- KSampler reference: https://docs.comfy.org/built-in-nodes/sampling/ksampler , https://docs.comfy.org/built-in-nodes/KSampler , https://docs.comfy.org/built-in-nodes/KSamplerAdvanced
- Cloud API reference (object_info usage): https://docs.comfy.org/development/cloud/api-reference
- Account API key integration (Partner Nodes): https://docs.comfy.org/development/comfyui-server/api-key-integration
- Comfy API key FAQ: https://support.comfy.org/articles/8203869590-how-to-generate-a-comfy-api-key
- API proxy for self-hosted (v2 + optional bearer): https://docs.comfy.org/development/comfyui-server/api-proxy
- Running workflows (API surface comparison): https://docs.comfy.org/development/run-workflows/overview
- Model library (folder names): https://docs.comfy.org/interface/model-library
- Workflow templates: https://docs.comfy.org/interface/features/template , https://docs.comfy.org/custom-nodes/workflow_templates
- Upstream OpenAPI 3.1 spec: https://github.com/Comfy-Org/ComfyUI/blob/master/openapi.yaml
- OpenAPI spec PR: https://github.com/Comfy-Org/ComfyUI/pull/13397
- Auth + health PR (open): https://github.com/Comfy-Org/ComfyUI/pull/11263
- Auth feature request #987 (proxy/basic-auth guidance): https://github.com/Comfy-Org/ComfyUI/issues/987
- object_info caching request: https://github.com/Comfy-Org/ComfyUI/issues/6372
- object_info v2 RFC (lazy COMBO loading): https://github.com/Comfy-Org/rfcs/pull/1
- Maintainer note (checkpoint list via `/object_info/CheckpointLoaderSimple`): https://github.com/comfyanonymous/ComfyUI/pull/1390
- cli_args reference: https://github.com/comfyanonymous/ComfyUI/blob/f3a36e74/comfy/cli_args.py
- Frontend API client (`getWorkflowTemplates`, `getCoreWorkflowTemplates`, `getUserData`): https://github.com/Comfy-Org/ComfyUI_frontend/blob/8854fbde/src/scripts/api.ts
- `comfyui-api` wrapper (Salad) — response `{id, images[], filenames[]}`, `/health`, base64: https://github.com/SaladTechnologies/comfyui-api
- `comfyui-api-wrapper` (ai-dock) — `/health`, `/result`, base64: https://github.com/ai-dock/comfyui-api-wrapper
- DeepWiki: REST endpoints (`/models`): https://deepwiki.com/hiddenswitch/ComfyUI/13.1-rest-api-endpoints
- DeepWiki: samplers & schedulers: https://deepwiki.com/comfyanonymous/ComfyUI/4.1-sampling-algorithms-and-schedulers
- 2026 endpoint reference (sizes, proxy notes): https://www.runflow.io/blog/comfyui-api-endpoints
- Comfy Desktop LAN limitation: https://forum.comfy.org/t/recommended-approach-to-enable-local-network-access-doesnt-work/1747
- object_info practical notes (single-node preferred): https://frostysdxl.github.io/comfyui-starchart/reference/object-info/
- COMBO list size warning: https://glama.ai/mcp/servers/pytraveler/local-comfyui-mcp/tools/describe_node

### Engine/app code references (`[engine-code]` / `[app-code]`)

- Engine client: `harmony-link-private/providers/comfyui.go`
- Engine config: `harmony-link-private/config/types.go` (`ComfyUIConfig`, `ImaginationWorkflowProfile`)
- Engine management routes: `harmony-link-private/management/routes_imagination.go`
- Engine DB model: `harmony-link-private/database/models/provider_comfyui.go`
- App provider schema: `harmony-ai-app/src/constants/providerFieldSchemas.ts` (`comfyui`, `hasModelFetch: false`)
- App defaults: `harmony-ai-app/src/constants/moduleDefaults.ts` (`comfyui`)
- App DB model: `harmony-ai-app/src/database/models.ts` (`ComfyUIProviderConfig`)
- App model-catalog precedent: `harmony-ai-app/src/services/cloud/soulbitsModelsCatalog.ts`
