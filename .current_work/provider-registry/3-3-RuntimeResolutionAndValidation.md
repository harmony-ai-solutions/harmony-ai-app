# Phase 3-3 — Engine: Runtime Resolution + Split Validation + Shared Types

**Repo:** harmony-link-private · **Depends on:** 3-2 (serial engine chain) · **Blocks:** 4-*, 5-*
**Refs:** plan.md §3.5, §11 audit decisions · SYNTHESIS §3, §4

## Objective

The runtime path: each module resolves account + overlay into the struct
`p.FromConfig(...)` consumes (integration contract unchanged), split
validation, the shared emission helper — **and the shared types the Phase-4
wave consumes: the extended `modules/common.ModelInfo` and the structured
`VerifyResult`** (audit: no 4-* doc may emit a type that only 5-1 defines).

## Implementation steps

1. **Shared types in `modules/common` (owned HERE):**
   - `ModelInfo` final shape: `{id, label?, context?, output_limit?,
     modalities?, capabilities?, param_support?, source: live|catalog,
     provenance: detected|known|assumed|overridden, meta?}` — `meta` carries
     provider-specific extras (openrouter pricing/top_provider, xai
     fingerprint/version, mistral aliases/deprecation, soulbitscloud
     min_tier/model_type). Today it is only `{ID,Name,Description}`
     (client.go:19-23) — extend in place, migrate the 13 current emitters
   - `VerifyResult`: `{state ∈ valid|invalid|throttled|blocked|scope_limited|
     unreachable, detail?, payload?}` + the `ValidateConfig() (VerifyResult…)`
     interface migration for `providers.Provider` (registry.go:15 — currently
     `error`) and `rag.ValidationClient`; update call sites
     (integration/validation.go:34,50; management/config.go:35)
2. **Resolution (per module):** audit facts — every non-RAG module has
   `providerConfig()` (backend.go:114, cognition.go:208, movement.go:153,
   tts.go:133, vision.go:148, imagination.go:103; stt.go:232/238 dual);
   these delegate to `config.XConfig.ProviderConfig()` value returns, so
   the **merge happens at DB→config load** (fill account fields +
   overlay-applied capability fields before ProviderConfig() runs).
   **RAG has NO providerConfig()** — explicit RAG resolution path instead
   (RAGConfig sub-configs ← account + overlay)
3. **Emission helper (`modules/common`):**
   - zero-value = unset (`> 0` semantics per param; google already uses
     `!= 0` — normalize all providers through the helper)
   - capability-gated emission hook: per-provider suppression flags NOW
     (anthropic 4.7+, gemini 3.6+/4, xai reasoning — research-verified);
     5-2's catalog plugs in as DATA later and the flags retire per provider
     as catalog coverage lands
   - **wire-name mapping as a LOADER (interface):** in-code table is the
     interim implementation; 5-2's catalog becomes the authoritative source
     at runtime (single source = catalog, per plan §6.3/§11). Table incl.:
     `seed`→`random_seed` (mistral); `max_tokens`↔`max_completion_tokens`;
     `top_k` via `extra_params` (generic openaicompatible; NATIVE for
     localai-fingerprinted servers per 4-9); `min_p`; `repeat_penalty`;
     `num_predict`↔`max_tokens`; `think`↔`reasoning_effort` (native
     surfaces only)
   - strict-passthrough filter for mistral (`additionalProperties:false`)
4. **`integration/validation.go`:** `ValidateProviderConfig` splits into
   account validation (CONSUMES 3-2's validator — no duplication) +
   capability validation (overlay JSON against 3-1's field-split × module);
   warn-not-block
5. **manager.go:1936 is NOT a stored-config site — it is a live
   connectivity probe** (`discoverInstanceEndpoints`, synthetic dummy
   config, openaicompatible.go:88-96 / comfyui.go:79-100 do network
   ValidateConfig calls): KEEP it as a live probe; static schema
   validation is the new split above; when 5-1's verify layer lands, the
   probe repoints to it
6. **FromConfig call sites (complete list — audit):** manager/build_runner/
   service paths + `routes_character_profiles.go:519`
   (`initTemporaryVisionClient` — loads stored VisionConfig) +
   `routes_imagination.go:103`
7. **Tests:** resolution merge per module + stt dual; RAG path; emission
   table-driven (zero-value, gating hook, wire mapping incl. mistral
   filter — the exact research bug cases: anthropic temp=0 omitted,
   mistral unknown param filtered, openai max_tokens mapping);
   `vision_test.go`/`imagination_test.go` are NET-NEW (don't exist today)

## Test gates

- Engine gate green
- Table-driven emission tests include the research bug cases verbatim
- VerifyResult interface migration compiles across all 13 providers + rag

## Checklist

- [ ] ModelInfo + VerifyResult types defined here; interface migrated
- [ ] DB→config load merge for 7 modules + stt dual; explicit RAG path
- [ ] Emission helper (zero-value, gating hook, wire-mapping loader, mistral filter)
- [ ] Validation split consuming 3-2's account validator + 3-1's field-split
- [ ] manager.go live probe kept; repoint note for 5-1
- [ ] All FromConfig call sites updated (incl. character_profiles/imagination)
- [ ] Tests incl. net-new vision/imagination suites
- [ ] Engine gate green
