# Phase 5-1 — Engine: Verify + Models Endpoints (discovery recipes)

**Repo:** harmony-link-private · **Depends on:** 3-2 + ALL of Phase 4 (4-1…4-13 — every client carries VerifyResult + ModelInfo) · **Blocks:** 6-1..6-4 · Serial engine chain
**Refs:** plan.md §3.4 · SYNTHESIS §1 (state machine), §2 (recipes) · plan §11

## Objective

The management-API surface for R10: `POST /api/providers/verify` and
`POST /api/providers/models` executing the per-provider recipes behind one
contract, plus retiring the superseded routes.

## Implementation steps

1. **ModelInfo:** consumed as defined by 3-3 (canonical field set incl.
   `output_limit` and `meta` — reconcile any drift from 4-* here)
2. `POST /api/providers/verify` `{type, api_key, base_url?, extra?}` →
   `{state, detail?, payload?}` — delegates to each client's
   `ValidateConfig()` (VerifyResult, Phase-4 outputs); no DB writes;
   never blocks saves. Payload passthrough per SYNTHESIS §1: elevenlabs
   tier/quota/reset, openrouter budgets/usage, comfyui version/VRAM,
   ollama/soulvoice/localai version (+backends/VRAM best-effort),
   soulbitscloud ok
3. `POST /api/providers/models` `{type, api_key, base_url?, extra?,
   module?}` → `{models: [ModelInfo], voices?}`:
   - Executes the per-provider discovery recipe (SYNTHESIS §2): xAI
     dual-endpoint merge; soulvoice fan-out; comfyui per-node;
     openaicompatible fingerprint tree FIRST (4-13, incl. LocalAI
     branches)
   - **`module` param KEPT** (the old POST /api/models handler filters by
     module — preserve that behavior; replaces app-side tag filtering)
   - elevenlabs: account voices under `voices` (envelope pinned:
     `{models, voices?}` — 6-3's voice picker contract)
   - catalog-merge hook (live > catalog; 5-2 fills the data; until then
     provenance `assumed`, context omitted)
4. **Retire the superseded routes in-phase:** `POST /api/validate-provider`
   and `POST /api/models` (server.go:257-258) are removed — app consumers
   move with 6-1 in the same release; update any engine tests/gates
   pinning them
5. Auth/timeouts: same engine-local auth as other management routes;
   per-recipe budgets from research (comfyui 5s, ollama/localai 5s,
   soulvoice 3-5s, openaicompatible ~8s)
6. **Mockability note:** contract tests with mocked upstreams require the
   base-URL/HTTP injection seams added by 4-2/4-3/4-4 (their checklists
   carry them); google/anthropic/xai SDK-default endpoints are otherwise
   untestable

## Test gates

- Engine gate green
- Route contract tests per provider (mocked upstreams): verify states ×13
  (**soulbitscloud `blocked` excluded from pins — no gateway signal**),
  models shapes ×13, recipe merges (xAI merge, soulvoice fan-out,
  comfyui nodes, fingerprint tree), module filter, voices envelope

## Checklist

- [ ] verify route + state machine + payloads (stateless)
- [ ] models route + recipes + module param + voices envelope
- [ ] catalog-merge hook (5-2-ready)
- [ ] Old validate-provider/models routes retired + gates updated
- [ ] Contract tests ×13 providers
- [ ] Engine gate green
