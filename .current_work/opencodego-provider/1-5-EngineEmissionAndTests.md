# Phase 1-5 — Engine emission tables & provider tests

**Repo:** `harmony-link-private` · **Objective:** correct wire emission for the fixed
OpenAI dialect + full provider test coverage.

## Emission

- `providers/helpers.go` `emissionProviderType()` — route `opencodego` through the
  **openai** wire table (fixed dialect; precedent: how `localai` pins its table).
- `providers/token_limit.go` `SupportsMaxCompletionTokens` — add the opencodego case
  matching openai behavior (newer models accept `max_completion_tokens`; the catalog
  `param_support` from 2-1 can refine per model later).
- Zero-value=unset rule and `resolveTokenLimit` reuse come free via `common.Emit`.

## Tests (`providers/opencodego_test.go`)

Mirror `openaicompatible_test.go` structure; httptest stub server:

1. **Headers (the core guarantee)** — every `/chat/completions` AND `/models` request
   carries: `Authorization: Bearer <key>`, `x-opencode-session` (module-derived value
   and the `soulbits-verify` fallback), `User-Agent` starting `SoulbitsEngine/`.
2. **Session stability** — same entity+module → identical header across instances.
3. **Emission** — temperature/top_p/stop/seed/max-tokens flow; exactly one token param
   emitted; `extra_params` ride the body.
4. **Verify matrix** — 200 valid (payload carries model count), 401 invalid, 403
   scope_limited, 429 throttled, transport unreachable.
5. **ListModels** — maps the models payload; empty list + `error` degrades gracefully.
6. **FromConfig/FromJSON** round-trip incl. account-half merge
   (`ApplyAccountToProviderModel` sets ID/Name/APIKey/BaseURL via reflection).

## Conventions

- Run `npx gitnexus impact` (upstream) on `emissionProviderType`,
  `SupportsMaxCompletionTokens`, and any shared helper BEFORE editing
  (AGENTS.md rule); report blast radius. Run `go test ./...` +
  `gitnexus detect_changes` before committing.

## Checklist

- [ ] Emission routing (openai table)
- [ ] Token-limit case
- [ ] Header test suite (chat + models + fallback)
- [ ] Session stability test
- [ ] Verify matrix test
- [ ] Full `go test ./...` green
