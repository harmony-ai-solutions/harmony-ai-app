# Phase 4-3 — Engine: Google Gemini Client Rework

**Repo:** harmony-link-private · **Depends on:** 3-3 · Serial engine chain
**Refs:** research/google.md (§2.2, §4 quirks, §6 error shapes, §8) · SYNTHESIS §5 item 3

## Objective

Wire thinkingConfig, map aspect_ratio, structured verify with the
API_KEY_INVALID-only rule, richer ModelInfo. Vision heuristic stays until
5-2 (audit: `supportedGenerationMethods` exposes no vision signal).

## Implementation steps

1. `ValidateConfig()` (google.go:107-110 — already `GET /v1beta/models?
   pageSize=1`, today flattens ALL errors): VerifyResult mapping — **only
   400 + `reason=API_KEY_INVALID` is invalid**; 401/402/403/429 valid-but;
   transport → unreachable. `reason` IS extractable via
   `genai.APIError.Details` (api_client.go:536) — nothing uses it today
2. `ListModels()`: pagination already implemented (google.go:309-315 —
   research confirms) — the work is ModelInfo mapping:
   `inputTokenLimit/outputTokenLimit/supportedGenerationMethods/thinking`
   into 3-3 ModelInfo
3. **Vision: KEEP `isVisionModel()` heuristic as interim fallback** until
   5-2's catalog lands (deleting it in 4-3 would leave vision unfiltered);
   5-2 swaps in catalog data
4. Sampling suppression (3.6+/4 silently ignore; 400s coming): via 3-3
   flags now → catalog at 5-2
5. `thinkingConfig`: **add `thinking_level`/`thinking_budget` fields to
   `GoogleProviderConfig`** (config/types.go:487-506 has none — also
   provider_google.go mapper + app schema in 6-5); select level (3.x) vs
   budget (2.5) via version-parse interim rule, refined by 5-2 catalog;
   400 if both — never emit both. SDK types exist
   (`ThinkingConfig{ThinkingBudget,ThinkingLevel}`)
6. `aspect_ratio` → `ImageConfig` (p.aspectRatio stored google.go:89, never
   sent; buildGenConfig sets neither ThinkingConfig nor ImageConfig today);
   extend `injectDimensions`-style handling to SD3/SDXL latent nodes per
   research G4 where applicable
7. Error taxonomy: **legacy gRPC-shaped bodies only** (engine uses
   `generateContent`); Interactions snake_case parsing DEFERRED (research
   §6 documents it only partially)
8. Auth: genai SDK already sends `x-goog-api-key` (google.go:56-59) —
   no change; verify only

## Test gates

- Engine gate green (ClientConfig.HTTPClient injectable — client.go:120)
- Tests: VerifyResult reason-mapping, ModelInfo mapping, thinking
  level-vs-budget selection, aspect_ratio → ImageConfig, legacy error
  shape handling

## Checklist

- [ ] VerifyResult with API_KEY_INVALID-only-invalid rule
- [ ] ModelInfo mapping (pagination already done)
- [ ] Vision heuristic kept as interim (5-2 swaps)
- [ ] Thinking config fields added (config + mapper + 6-5 schema note)
- [ ] aspect_ratio → ImageConfig
- [ ] Legacy error taxonomy; Interactions deferred
- [ ] Engine gate green
