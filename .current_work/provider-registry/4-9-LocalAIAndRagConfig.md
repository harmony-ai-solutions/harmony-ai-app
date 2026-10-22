# Phase 4-9 — Engine: LocalAI (rides openaicompatible) + RAG Config Fix

**Repo:** harmony-link-private · **Depends on:** 3-3, 4-13 (fingerprint tree) · Serial engine chain
**Refs:** research/localai.md (§1-§3, §7 recipes, §8) · SYNTHESIS §5 item 7 · plan §10.-0.5, §11

## Objective

LocalAI's `/v1` is a superset — no dedicated chat client. Its capability
endpoints join the discovery recipe (branches live in 4-13's fingerprint
tree), and the RAG path's hardcoded endpoint dies.

## Implementation steps

1. **RAG fix (broken today):** `RAGLocalAIConfig` = EmbeddingModel only;
   chromem `NewEmbeddingFuncLocalAI` hardcodes
   `baseURLLocalAI="http://localhost:8080/v1"` + empty key (a thin wrapper
   over the public `NewEmbeddingFuncOpenAICompat`, embed_compat.go:75-87).
   Source base_url/api_key from the account row (3-1 conversion gives
   `rag_configs` the FK/overlay columns; provider_config_localai has no
   base_url today). **Explicit fallback:** unset account fields keep the
   old localhost default (commented) so existing RAG configs survive
2. **Discovery branches (in 4-13's tree, specified here):**
   - `GET /.well-known/localai.json` — free fingerprint + version (verify)
   - `GET /v1/models/capabilities` — capabilities + modalities + context
     (provenance `detected` — probe results are detected; align with 5-1)
   - `GET /api/models/capabilities` — backend, pinned, voice_cloning —
     **admin-gated when auth is on: soft-fail/skip, never error**
   - `/healthz`, `/system` (backends, VRAM) — same soft-fail; best-effort
     into the verify payload
   - `/v1/models` 404 fallback documented (research §7.2)
3. **Param superset via emission:** when the resolved server fingerprint =
   localai (4-13 persists it; 3-3 resolution carries it), `top_k`/`min_p`/
   `repeat_penalty` emit NATIVELY (not via extra_params) — extend the 3-3
   wire-mapping loader with the localai-fingerprinted branch (`min_p`
   included); generic openaicompatible keeps `extra_params` routing
4. `ValidateConfig()` for localai accounts: `/.well-known/localai.json` →
   `/healthz` → 401-only-if-key-enabled mapping; transport → unreachable
5. Registry: flat `providers/registry.go` entry + `config.ProviderLocalAI`
   chat constant (only `RagProviderLocalAI` exists today) + dispatch
   symbols as in 4-7; **module sets are app-side (6-5)** — engine
   registers the client; same set as openaicompatible

## Test gates

- Engine gate green
- Tests: fingerprint branch sequence (well-known → capabilities, admin-gated
  soft-fail), capabilities parsing → ModelInfo (detected), native param
  emission when fingerprinted, RAG base_url/key sourcing + localhost
  fallback

## Checklist

- [ ] RAG account-sourced (+ localhost fallback)
- [ ] LocalAI branches in 4-13's tree (soft-fail admin endpoints)
- [ ] Native superset emission via 3-3 loader branch (min_p included)
- [ ] Verify sequence + payload
- [ ] Registry constant + entry (module sets in 6-5)
- [ ] Engine gate green
