# Phase 5-2 — Engine: Capability Catalog (models.dev codegen) + Gated Emission

**Repo:** harmony-link-private · **Depends on:** 5-1 (merge hook), 3-3 (emission helper) · **Gated by:** R-MD research (see summary.md pre-tasks) · Serial engine chain
**Refs:** plan.md §6.3, §11 · SYNTHESIS §3, §4 · research/openaicompatible-ecosystem.md §4-§5

## Objective

The engine-embedded Tier-2 catalog generated from models.dev, and the
global capability-gated emission that closes the deprecation-wave bug
class.

## Implementation steps

1. **R-MD research addendum FIRST (pre-task):** pin the models.dev
   `api.json` schema + license in `research/` before codegen — real shape
   is nested `provider→model` with `id`, `name`, `limit.context`,
   `limit.output`, `cost.*`, `tool_call`, `structured_output`,
   `temperature` (bool), `modalities.{input,output}` (audit: no research
   doc documents this today; MIT claim must be re-corroborated in the
   addendum)
2. **Codegen** (`tools/gen-model-catalog/`, **Go** with a `//go:build
   tools` tag or excluded from `./...` — no JS toolchain in this repo):
   - Fetch the pinned snapshot (committed input for reproducibility);
     filter to our 13 provider types + open-weights families
   - Map onto the catalog schema (ModelInfo-compatible; ids →
     label/context/output_limit/modalities/reasoning/tools/structured/
     temperature-accepts/price) with MIT attribution header (source +
     license + snapshot date)
   - **Family-signature tables generated from models.dev's per-model
     flags** (`tool_call`/`reasoning`/`structured`/`temperature` +
     modalities — NOT from ids alone; audit: ids don't encode
     capabilities)
   - Deterministic output (sorted, stable) for clean diffs
3. **Catalog runtime** (`providers/catalog.go`, go:embed — precedent
   migrations.go:14-15; boot cache like config/presets.go:16-19):
   `GET /api/providers/capabilities` serves catalog + param-name mapping
   (signature tables stay ENGINE-INTERNAL — audit: app never consumes
   them). Registration-order note: static route before the param route
   (gin coexistence verified by existing tests)
4. **Wire-name mapping ownership (plan §11):** the CATALOG JSON is the
   single authoritative source; 3-3's in-code table becomes the loader and
   is retired per-provider as catalog coverage lands
5. **Merge into 5-1's hook:** live > catalog > user; provenance chips
   (detected/known/assumed/**overridden** — enum extended); openai bare
   lists get capability-augmented
6. **Global gated emission:** suppression for models whose catalog/live
   flags say unsupported; **precedence reconciliation (plan §11):**
   suppression applies to UNSET/default (zero-value) params only — a
   user-EXPLICITLY-set unsupported param is emitted with a warning (R12
   tier-3 warn-never-block; matches ecosystem research "user override
   wins the display, warned"). Catalog overrides 3-3's hardcoded flags;
   flags retire per provider as coverage lands
7. Tests: codegen golden-file + determinism; merge precedence; emission
   gating table-tests (anthropic 4.7+, gemini 3.6+/4, xai reasoning,
   openrouter live param_support beats catalog)

## Test gates

- Engine gate green
- Codegen determinism test (same input → same bytes)
- Merge-precedence + explicit-override-emitted-with-warning tests

## Checklist

- [ ] R-MD addendum written and approved snapshot pinned
- [ ] Codegen (Go, build-tagged) + attribution + determinism
- [ ] go:embed catalog + boot cache + /api/providers/capabilities
- [ ] Signatures generated from per-model flags; engine-internal
- [ ] Catalog-authoritative wire mapping; 3-3 loader
- [ ] Gated emission with unset-vs-explicit semantics
- [ ] Engine gate green
