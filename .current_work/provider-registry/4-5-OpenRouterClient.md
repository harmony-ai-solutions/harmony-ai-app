# Phase 4-5 — Engine: OpenRouter Client Rework

**Repo:** harmony-link-private · **Depends on:** 3-3 · Serial engine chain
**Refs:** research/openrouter.md (§2 key probe, §3 models schema + modality caveat, §4 params, §6 variants, §8) · SYNTHESIS §5 item 2

## Objective

Real key validation, the richest live capability surface, param gating by
live `supported_parameters`.

## Implementation steps

1. **`ValidateConfig()` fix (openrouter.go:110-121 — today calls
   unauthenticated `/models`, a no-op for auth):** switch to
   `GET /api/v1/key`: 200 = valid; 401 = invalid (live-probed bodies:
   "No cookie auth credentials found", "User not found."); 429 throttled;
   transport unreachable. **Payload needs raw HTTP** — SDK `APIKeyCurrent`
   (api_keys.go:54-72) lacks `free_model_daily_requests`/budgets/
   `effective_budget`/`is_management_key` (the SDK's `GetCurrentAPIKey`
   exists; extend or bypass for the payload)
2. `ListModels()`: consume the full `/models` schema — **include
   `?output_modalities=all`** (bare list returns text-output models only;
   this provider also serves image/TTS/STT). Map `supported_parameters`
   (26-value union), `architecture` modalities, `context_length`,
   `top_provider`, `reasoning` into 3-3 ModelInfo (pricing → meta).
   SDK Model omits several fields — raw-parse where needed. Pagination is
   opt-in (500/1000) — single fetch with `all` filter suffices
3. Capability gating: drop params absent from the model's
   `supported_parameters` (research: absent = omitted, not injected) via
   the 3-3 helper consuming live param_support. **Cache the /models result
   per session** (research §8 recommends caching; sync fetch per emission
   is too slow)
4. **Variant handling (research §6 — audit correction):** `:free` and
   `:batch` ARE separate `/models` entries → keep as models;
   `:nitro`/`:floor`/`:exacto` are ROUTING variants not listed in /models
   → drop; deprecated `:thinking`/`:extended`/`:online` → never emitted
5. Errors: `{code, message}` envelopes only — **`error_type` is NOT
   obtainable** (SDK + live bodies lack it); drop the full-table claim,
   parse what exists. **No streaming path exists in this provider** (audit)
   — mid-stream error handling dropped from scope
6. Refactor note: param assembly today is
   `applyPresetAndExtraParamsToRequest` (openrouter.go:131-186) + inline
   duplication across 5 methods (SendUserMessage:188,
   SendComplexPromptSync:270, AnalyzeImage:382, AnalyzeImages:473,
   GenerateImages:633) — consolidate into one param-assembly path routed
   through the 3-3 helper

## Test gates

- Engine gate green
- Tests: /key verify with live-probed 401 bodies + payload parsing,
  modality-filtered listing → ModelInfo, variant rule, param dropping by
  live support (with cache), consolidated param assembly

## Checklist

- [ ] Verify via /api/v1/key (raw HTTP payload)
- [ ] Full /models incl. output_modalities=all → ModelInfo (param_support)
- [ ] Live param gating + session cache
- [ ] Variant rule corrected (keep :free/:batch; drop routing variants)
- [ ] Error parsing scoped to real bodies; streaming dropped
- [ ] Param assembly consolidated; engine gate green
