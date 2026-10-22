# Phase 4-4 — Engine: xAI Client Rework

**Repo:** harmony-link-private · **Depends on:** 3-3 · Serial engine chain
**Refs:** research/xai.md (§3 endpoints, §6 variants, §7 image lineup, §8) · SYNTHESIS §5 item 5

## Objective

Merge the two model endpoints, fix the image path (chat-model leak),
structured verify, flat-error parsing (net-new).

## Implementation steps

1. `ListModels()`: call BOTH `GET /v1/models` (SDK Models.List) and
   `GET /v1/language-models` (**raw HTTP — the SDK only hits /v1/models**;
   envelopes differ: `data[]` vs `models[]`), merge by id: context from
   the former; modalities, fingerprint/version (→ ModelInfo.meta),
   reasoning_effort values from the latter → 3-3 ModelInfo
2. `generateImageAPI()` (xai.go:437): **`model := p.model` sends the CHAT
   model to /v1/images/generations today.** Add a dedicated
   `image_model` overlay field (config + mapper + app schema in 6-5);
   default from the live image listing (research §7: grok-imagine-image-2.0
   replaced retired grok-2-image); never fall back to the chat model
3. `n: 0` bug (xai.go:216 `if p.n >= 0`): zero-value handling via the 3-3
   helper (emit only `n > 1`) — do not fix client-locally
4. `buildParams()`: reasoning-model restrictions (frequency/presence/stop
   → 400) via the 3-3 emission hook. **Per-model gating is NOT available
   until 5-2** (non-reasoning sibling slugs exist; a per-provider flag
   over-suppresses) — provider-level via 3-3 flags now, model-level at
   5-2; logprobs: no field exists in XAIProviderConfig — drop from scope
   (future note)
5. Error parsing (net-new — nothing parses bodies today; ValidateConfig
   returns raw SDK error): xAI body is flat `{code, error}` — parse into
   VerifyResult: 401 invalid; 403 ACL scope_limited; 429 throttled;
   transport unreachable
6. Retirement-by-redirect: engine-side only ensures ModelInfo.id reflects
   the live listing; staleness marking is app-side (6-3)

## Test gates

- Engine gate green
- Tests need a base-URL injection seam (xai.go:75,88 hardcodes
  xaiBaseURL): two-endpoint merge with different envelopes, image-model
  selection + default, n>1, VerifyResult flat-body mapping

## Checklist

- [ ] Dual-endpoint merged ListModels (raw HTTP for language-models)
- [ ] image_model overlay field; chat-model leak fixed; retired default replaced
- [ ] n:0 via helper
- [ ] Reasoning restrictions via 3-3 hook (model-level at 5-2)
- [ ] Flat-error VerifyResult parsing (net-new)
- [ ] Test seam; engine gate green
