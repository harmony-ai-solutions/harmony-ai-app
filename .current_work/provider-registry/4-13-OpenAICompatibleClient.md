# Phase 4-13 — Engine: OpenAI-Compatible Generic Client Rework (NEW — audit-born)

**Repo:** harmony-link-private · **Depends on:** 3-3 · **Blocks:** 4-9 (tree branches), 5-1 · Serial engine chain
**Refs:** research/openaicompatible-ecosystem.md (§4 signatures, §5 caps, §6 fingerprint tree, §8) · plan §6.3, §11

## Objective

The generic `openaicompatible` client rework was unowned (audit: no 4-*
doc delivers its fingerprint tree / structured verify / rich ModelInfo,
yet 5-1's recipe depends on it). This doc owns it: the server
fingerprint tree, structured verify, and ModelInfo assembly for the whole
OpenAI-compatible ecosystem (LM Studio, vLLM, LiteLLM, text-generation-
webui, llama.cpp server, …), with LocalAI branches specified by 4-9.

## Implementation steps

1. **Fingerprint tree (research §6 Step A — net-new;
   openaicompatible.go:88-96 today is only `GET /v1/models`):**
   probe sequence by cost: server fingerprints first (`/api/v0/models`
   LM Studio max-context; `/version` vLLM; `/.well-known/localai.json`
   LocalAI — 4-9's branches hang here; `/healthz`), then `/v1/models`
   response-shape sampling, then model-id family signatures (5-2's
   generated tables; interim: research §4.1-4.3 patterns). **Persist the
   resolved fingerprint** on the resolved server state so chat-time
   emission can branch (native localai params per 4-9)
2. `ListModels()`: richest endpoint available per fingerprint → 3-3
   ModelInfo (LM Studio rich; vLLM bare → signature augmentation,
   provenance `assumed`; probed data `detected`)
3. `ValidateConfig()` → VerifyResult: fingerprint step + `/v1/models`
   (401 invalid when key-enabled; transport unreachable; 404-on-models →
   server-not-openai-compatible detail)
4. Emission: through the 3-3 helper (`extra_params` routing for unknown
   params; `top_k` via extra_params generically — native names ONLY for
   localai-fingerprinted servers per 4-9); zero-value rules apply
   (openaicompatible.go:170-176 has the same `>= 0` class)
5. Existing generic surface preserved: bearer/basic auth per §3.1 hint,
   else fingerprinted; `SetExtraFields` passthrough retained

## Test gates

- Engine gate green (base URL injectable already)
- Tests: probe sequence fixtures per ecosystem doc (LM Studio / vLLM /
  LiteLLM / bare), ModelInfo provenance (detected vs assumed), verify
  states, extra_params emission + localai native branch

## Checklist

- [ ] Fingerprint tree implemented + persisted server state
- [ ] 4-9 LocalAI branches integrated (well-known/capabilities/admin-gated)
- [ ] Richest-endpoint ModelInfo with provenance
- [ ] VerifyResult + 404 routing detail
- [ ] Emission via 3-3 helper (extra_params; localai native names)
- [ ] Engine gate green
