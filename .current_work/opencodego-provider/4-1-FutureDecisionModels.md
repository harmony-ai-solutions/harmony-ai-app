# Phase 4-1 — Typed-decision models (Jev) — seam spec (OUT OF SCOPE, DO NOT IMPLEMENT)

**Status: specification only.** This documents how a Jev-style model
(TypeSafe AI "System One", e.g. `jev-1.13`) integrates later, so today's
`opencodego` provider work stays compatible. Owner directive 2026-11-15: prepare the
handling, don't build it.

## What Jev is (opencode.ai/docs/console/models, 2026-11-15)

Not a chat LLM. Takes `{model, state, questions}` where questions are typed —
`noul` (yes/no), `choice` (multiple-choice), `score` (rubric) — and returns
**values + probabilities** code consumes directly. Billed per request. Same OpenCode
Console API key.

## The designed seam (already prepared by phases 1-2/1-3)

1. **Account reuse** — the existing `opencodego` provider account (key + base_url
   root) serves the decision capability; endpoint path resolves per-capability off
   the same root. No account/schema changes.
2. **Capability shell** — `OpenCodeGoProvider.requestOptions()` already owns
   auth + `x-opencode-session` + UA; the decision client calls it verbatim.
3. **New optional client interface** (the established module type-assertion pattern):
   ```go
   // providers/decision.go (future)
   type Question struct { … } // noul | choice | score typed shapes
   type DecisionClient interface {
       Evaluate(ctx context.Context, state string, questions map[string]Question) (
           map[string]DecisionAnswer, error) // value + probability + confidence
   }
   ```
   New file `providers/opencodego_decisions.go` implementing it on
   `*OpenCodeGoProvider` — no refactor, no registry change.
4. **Catalog tagging** — a `jev-1.13` Tier-1 entry carries `capabilities: ["decision"]`
   (chat entries are tagged `["chat"]` since phase 2-1). Module slots filter on tags;
   a new decision slot filters `decision`.
5. **Consumer candidates** (product decisions, NOT part of this plan): cognition
   micro-decisions ("should I reply?", urgency, mood-shift gating), outreach
   eligibility, movement-action selection. Each needs: engine module slot schema,
   management contract minor bump, app slot UI — a normal plan of its own.

## Non-goals when it lands

- No generic "any decision API" abstraction — one client for the OpenCode/TypeSafe
  shape; generalize only when a second decision provider exists.
- Verify ("Test key") for the decision capability: a minimal `noul` probe question.

## Checklist (when activated)

- [ ] `decision.Client` interface + opencodego implementation
- [ ] Catalog `jev-1.13` entry (`capabilities: ["decision"]`)
- [ ] Consumer module slot (own plan) + contract minor bump
- [ ] App slot UI + schema entries (own plan)
