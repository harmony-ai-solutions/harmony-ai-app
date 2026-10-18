# Phase 4-7 — Engine: Mistral Chat Client (NEW — dormant provider activation)

**Repo:** harmony-link-private · **Depends on:** 3-3 · Serial engine chain
**Refs:** research/mistral.md (§2-§6, §8 engine verdict) · plan §10.-0.5, §11

## Objective

Mistral exists today only as a RAG-embedding path. Build the full chat
client so 6-5 can offer it in pickers.

## Implementation steps

1. **Enabling symbols (net-new — audit: none exist):**
   - `config.ProviderMistral` chat constant (config.go:29-42 has only
     `RagProviderMistral`); new `MistralConfig` chat struct (types.go:659
     is RAGMistralConfig only)
   - `ProviderConfig()`/`ModelName()` mistral cases on Backend/Cognition/
     Movement/Vision structs (types.go:787/854/913/950)
   - `module_controller.go` extract*/Load* + create/updateProviderConfig
     branches; `providers/registry.go` entry
   - Dispatch is registry-based for modules/lifecycle/management — only
     `AllowsCustomPrompting()` (build_runner.go:50) needs implementing
2. New `providers/mistral.go` chat client (OpenAI-shaped, NOT identical):
   - `POST /v1/chat/completions`; regional base via account `base_url`
     (plan §3.1: extra = "—", base_url only; `api.`/`api.eu.`/`us.`),
     models listed against the regional endpoint
   - `GET /v1/models`: 14-boolean capabilities dict, `max_context_length`,
     `aliases`, `deprecation`, `deprecation_replacement_model`,
     `default_model_temperature` → 3-3 ModelInfo (aliases/deprecation → meta)
   - `ValidateConfig()`: 401 invalid; **402 = valid key, no billing**
     (blocked); 429 throttled (X-RateLimit-Remaining); 403 scope_limited;
     5xx/transport unreachable
3. **Param rules (hard requirements):** `random_seed` (not `seed`); **no
   `max_completion_tokens`**; temperature max 1.5; `reasoning_effort`
   per-model enums; `additionalProperties:false` → unknown params 422 —
   the 3-3 helper OWNS the strict filter (client feeds it a permissive
   map; no duplicate client-local filter)
4. RAG embedding path: research verdict "no change required" — the key
   already flows from config; `NewEmbeddingFuncMistral(apiKey)` hardcodes
   baseURL+model (embed_compat.go:4,6), so when the account sets a
   regional base_url, construct via `NewEmbeddingFuncOpenAICompat`
   instead; model from the RAG overlay
5. One mistral account serves chat + embeddings (plan §3.1 type-generic
   account; RAG references provider_account_id post-3-1)

## Test gates

- Engine gate green
- Tests: ModelInfo mapping from the capabilities fixture; param emission
  (random_seed, no max_completion_tokens, 422-filter via helper); verify
  mapping (401/402/403/429/unreachable); registry + AllowsCustomPrompting
  wiring; regional base_url embedding construction

## Checklist

- [ ] Enabling symbols (constant, chat struct, 4 ProviderConfig cases, controller branches, registry)
- [ ] Chat client with listing + rich ModelInfo
- [ ] Verify incl. 402-no-billing
- [ ] Strict params via 3-3 helper (single owner)
- [ ] RAG regional base_url support (OpenAICompat constructor)
- [ ] Engine gate green
