# Phase 4-2 — Engine: Anthropic Client Rework

**Repo:** harmony-link-private · **Depends on:** 3-3 · Serial engine chain
**Refs:** research/anthropic.md (§2.3 failure signals, §3.3 capabilities, §3.5 catalog gaps, §4.2 thinking, §7 seed) · SYNTHESIS §5 item 1

## Objective

Fix the sampling zero-value 400-risk on Claude 4.7+, paginate model
listing, consume live `capabilities` metadata, structured verify.

## Implementation steps

1. **Zero-value bug (anthropic.go:201-209: `temperature >= 0`, `topP >= 0`,
   `topK > 0`):** route through the 3-3 helper. **Suppression source:
   research flags via 3-3 NOW → 5-2 catalog later — NOT live capabilities**
   (research §3.5/§8.3: `/v1/models` does NOT report sampling-param
   acceptance; SDK `ModelCapabilities` has no sampling field)
2. `ListModels()`: paginate via `Page.HasMore`/`LastID` (SDK supports
   AfterID/Limit); parse `max_input_tokens`, `max_tokens` and the
   `capabilities` object into 3-3 ModelInfo. SDK gaps (v1.46.0
   model.go:172-205): `server_tools` absent (only CodeExecution) and
   `thinking` typed only Adaptive/Enabled — use `RawJSON()`/ExtraFields
   parsing for the full research §3.3 set (thinking types incl. disabled/
   between_tools, effort, image/PDF input, structured outputs)
3. `ValidateConfig()`: add `?limit=1`; VerifyResult mapping — 401 invalid;
   403 scope_limited; 429 throttled; **400 with missing
   `anthropic-workspace-id` → valid/scope_limited + detail**; 5xx/transport
   → unreachable; spend-limit via `*anthropic.Error.RawJSON()`
   `details.error_code == "enforced_spend_limit_reached"` → blocked
4. Replace `isAnthropicVisionModel` string matching with
   `capabilities.image_input` from the model list
5. `-latest` alias logic: NONE exists in the engine (only OpenAI lists
   contain `-latest` strings) — guardrail note only, nothing to remove;
   picker data comes from ListModels
6. Thinking config: wire `thinking` per `capabilities.thinking.types` —
   adaptive (always-on, current lineup) vs enabled+budget (≥1024,
   < max_tokens; 400 on 4.7+/5.x when misused); overlay fields per plan §3.2

## Test gates

- Engine gate green
- Tests need a **base-URL/HTTP injection seam** (config has no BaseURL —
  add a test-construction seam using `option.WithBaseURL`): pagination
  loop, capabilities→ModelInfo via RawJSON fixtures, suppression for 4.7-
  family fixtures, VerifyResult mapping incl. workspace-400 + spend-limit

## Checklist

- [ ] Zero-value + suppression via 3-3 flags (not live caps)
- [ ] ListModels pagination + rich ModelInfo (RawJSON for SDK gaps)
- [ ] VerifyResult incl. 400-workspace + spend-limit + unreachable
- [ ] Vision via capabilities
- [ ] Thinking per capabilities.thinking.types
- [ ] Test seam added; engine gate green
