# Phase 4-1 — Engine: OpenAI Client Rework

**Repo:** harmony-link-private · **Depends on:** 3-3 (ModelInfo/VerifyResult types, emission helper) · Serial engine chain
**Refs:** research/openai.md ("What needs attention"/"client already does right" notes, §7 seed table, "Failure signals") · SYNTHESIS §5 item 4

## Objective

Fix the OpenAI client per research: dynamic model lists, param correctness,
and the structured verify outcome (5-1 consumes).

## Implementation steps

1. `modules/common/openai.go`: **delete the hard-coded
   `OpenAITextInputModels`/`OpenAITextOutputModels` lists** (stop at GPT-5;
   hide GPT-5.6/GPT-6). Replace with dynamic `ListModels()` (already
   `GET /v1/models`) emitting the 3-3 `ModelInfo`. **`filterModels`
   (openai.go:292-307) is the only consumer — delete it too**; interim
   module filtering moves to the 5-1 route (module param) + app picker tags
2. Deprecated defaults: `whisper-1` → `gpt-transcribe`/`gpt-4o-transcribe`,
   `gpt-image-1` → `gpt-image-2.5-sunburst`/`flare` (ids from research §7);
   catalog-overridable once 5-2 lands, not hard-coded twice
3. `n: 0` bug: `if p.n >= 0` (openai.go:186) sends invalid `n: 0` — zero-value
   handling moves into the 3-3 helper (emit only `n > 1`)
4. Param mapping: `max_tokens` vs `max_completion_tokens`, `reasoning_effort`
   enums, `stop` on reasoning models — all routed through the 3-3 emission
   helper
5. Error handling: the SDK ALREADY preserves `error.code/message/type` +
   StatusCode (openai-go apierror) and the client wraps with `%w` — no
   un-flattening needed; the work is the typed VerifyResult mapping
   (401 invalid; 403/429 valid-but states)
6. `ValidateConfig()` (GET /v1/models — research-verified correct) returns
   3-3's `VerifyResult` (interface change is owned/defined by 3-3)

## Test gates

- Engine gate green
- httptest (SDK `OPENAI_BASE_URL` seam — soulbitscloud_test.go pattern):
  dynamic list mapping, n>1 emission, deprecated-default replacement,
  VerifyResult mapping for mocked 401/403/429 bodies

## Checklist

- [ ] Hard-coded lists + filterModels deleted; dynamic ListModels → ModelInfo
- [ ] whisper-1/gpt-image-1 defaults replaced (research §7 ids)
- [ ] n:0 + zero-values via 3-3 helper
- [ ] Param mapping via helper
- [ ] VerifyResult mapping (401/403/429)
- [ ] Engine gate green
