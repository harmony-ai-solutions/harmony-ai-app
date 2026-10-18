# Phase 4-10 — Engine: ComfyUI Native Re-target + Autodetect

**Repo:** harmony-link-private · **Depends on:** 3-3 · Serial engine chain
**Refs:** research/comfyui.md (§3 enumeration, §4 generation, §6 native flow, §7 nodes, §8.2/§8.4 detection + fallbacks) · plan §10.-1, §11

## Objective

The client today speaks only the Salad `comfyui-api` wrapper dialect
(sync POST → `{id,images[]}`; validates via `/health`; bearer-only; no
history/view/object_info). Re-target to native ComfyUI with wrapper
auto-detection; existing wrapper users unaffected.

## Implementation steps

1. **Detection:** `GET /system_stats` (native always; comfyui_version,
   devices VRAM) vs wrapper markers — per research §8.4 tree. **Mode is
   NOT persisted on verify (5-1 verify is stateless, no account id in the
   body — audit).** Instead: persist at FIRST GENERATION (module owns the
   DB handle; account `extra.comfyui_mode` via the account update path),
   **plus the response-shape fallback always active** (discriminate
   `prompt_id` vs `id` in the /prompt response — research §8.4.1) so a
   never-verified account still works; default probe order native→wrapper
2. **Native generation path:** `POST /prompt` (workflow node graph) → poll
   `GET /history/{prompt_id}` until complete (backoff) → fetch outputs via
   `GET /view`. Imagination invokes GenerateImages synchronously inside a
   per-event goroutine (eventprocessor.go:1589) — internal poll-until-
   complete is safe
3. **Default workflow graph — EXPLICIT DELIVERABLE (audit: none exists;
   WorkflowJSON is mandatory today, and research §3.3 rules out UI-format
   conversion):** author and bundle a default API-format workflow
   (checkpoint + KSampler + EmptyLatentImage + VAE decode + SaveImage) as
   the fallback when the user supplied none — without it, stock installs
   remain broken, defeating the objective. Overlay-supplied graphs still
   win
4. **Workflow params:** inject steps/cfg/sampler/scheduler/denoise into
   KSampler; resolution into EmptyLatentImage **and** SD3/SDXL latent
   nodes (research G4); prompt/negative/seed as today
5. **Enumeration:** per-node `GET /object_info/{CheckpointLoaderSimple,
   LoraLoader,KSampler,VAELoader,UpscaleModelLoader,ControlNetLoader}` —
   NEVER full `/object_info` (tens of MB); map checkpoints/LoRAs/samplers/
   schedulers/VAE/upscalers/controlnets → 3-3 ModelInfo (detected) +
   `/embeddings`
6. **Auth:** optional — basic AND bearer via account `extra.auth`
   (plan §3.1 updated to carry `auth` + `comfyui_mode` in extra;
   ComfyUIConfig gains the Extra fields via 3-3 resolution — config/
   types.go:481-484 has only BaseURL/ApiKey/WorkflowProfiles)
7. **Timeouts:** verify connect 2-3s / total 5s; generation 5 min;
   history-poll backoff (research §2)

## Test gates

- Engine gate green (baseURL test-injectable)
- Tests: detection tree fixtures (native vs wrapper), native prompt→
  history→view flow + response-shape fallback, param injection incl. SD3/
  SDXL latents, per-node enumeration mapping, default-graph fallback, both
  auth styles

## Checklist

- [ ] Detection probe + response-shape fallback + generation-time mode persistence
- [ ] Native async generation; wrapper path kept
- [ ] Default API-format workflow graph bundled (explicit deliverable)
- [ ] Param injection (steps/cfg/sampler/scheduler/denoise; G4 latent nodes)
- [ ] Per-node enumeration (full node set) → ModelInfo
- [ ] basic+bearer auth; ComfyUIConfig extra fields
- [ ] Timeouts; engine gate green
