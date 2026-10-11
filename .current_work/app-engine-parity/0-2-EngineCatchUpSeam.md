# Phase 0-2 — Engine: Catch-Up Seam `FireCatchUp` (Design Directive D2)

> **Repo:** `harmony-link-private` (branch `feat/app-engine-parity`)
> **Assessment basis:** §10.2 D2, §9.4 pattern 3 (time-compressed catch-up), §7.1 (existing one-shot seam)
> **Depends on:** 0-1

## Objective

Formalize a host-callable catch-up entry point on the beat runner: given elapsed time since the last processed beat, advance entity state in one condensed pass — **sampled K beats, not N, with LLM spend never proportional to gap length** — so any wake (app foreground, BG-task window, keepalive wake, post-downtime desktop) converges the entity deterministically. Non-LLM state is always exact and free (0-1 arithmetic); long gaps collapse to a single re-entry beat (rules below).

## Context

`NewEntityBeatRunner` already exposes one-shot `FireBeat` / `FireDreamBeat` / `FireOutreachBeat` (the D-BEH-04 headless seam, originally built for the cloud lifecycle-worker — which this plan deletes outright in 4-4). What's missing is the *interval folding*: the idle-game fixed-step pattern (IdleKit `engine.advance(elapsed)` with clamp; assessment §9.1d) — LLM-touching beats are sampled (K representative beats over the missed window), non-LLM state advances via the 0-1 lazy functions exactly.

## Design

```go
// lifecycle/catchup.go
type GapKind int

const (
    ShortGap GapKind = iota // elapsed < config.LongGapThreshold (default 48h)
    LongGap                 // elapsed >= threshold → single re-entry beat
)

type CatchUpPlan struct {
    Elapsed     time.Duration
    GapKind     GapKind
    BeatsToFire int      // ShortGap: K = min(config.MaxCatchUpBeats, ceil(elapsed / BeatInterval)); LongGap: exactly 1 (re-entry)
    DreamDue    bool     // from DreamTTL lazy evaluation (0-1)
    CompactDue  bool     // memory compaction threshold check
    OutreachDue bool     // autonomy-gated + cooldown lazy check
}

func PlanCatchUp(cfg *LifecycleConfig, lastBeat time.Time, now time.Time) CatchUpPlan
func (r *EntityBeatRunner) FireCatchUp(ctx context.Context, plan CatchUpPlan) error
```

Rules:
- `K` capped (default 3, configurable) for short gaps — sampling, not replay: beats represent the window, monologue entries note the covered interval
- **Bounded-spend invariant (ruled 2026-10-11):** LLM calls per entity per wake are O(1) in elapsed time — a host down for two weeks costs the same as one down for two hours. Missed beats are never replayed, only sampled or acknowledged
- **Long-gap policy (ruled 2026-10-11):** `elapsed ≥ config.LongGapThreshold` (default 48h, configurable) collapses `BeatsToFire` to **exactly 1 re-entry beat** framed as a hiatus — the entity acknowledges the absence and does NOT simulate the window; emotion/exhaustion/sleep already reflect elapsed time via 0-1's free arithmetic. Expired dreams purge silently (lazy TTL); at most one dream check and one outreach remain, re-checked for eligibility at wake. Worst case after any outage: ≤3 LLM calls (re-entry + dream + outreach)
- Non-LLM state (emotion, exhaustion, sleep) must NOT be double-advanced: catch-up reads state via 0-1 lazy functions anchored at `lastBeat`, and beats apply deltas on top of the lazily-evaluated base
- Fixed-step ordering: advance lazy state → sampled beats → dream/compact/outreach checks (each still individually gated by `ShouldAutomate`)
- Monologue ring buffer: sampled/re-entry beat entries tagged `catch_up=true` — and the tag MUST surface in the **rendered prompt text** (LLM-visible time-compression framing), not merely in storage (2026-10-11 review correction); framing scales with gap kind — a missed afternoon reads differently from weeks of dormancy
- Determinism: same `(state₀, lastBeat, now, seed)` → same plan
- **Consumed by 0-4**: the batch orchestrator drives `FireCatchUp` per entity inside wake windows. Exhaustion folding (per sampled beat K vs per missed scheduled beat N) is the carried open decision (summary #7); recommendation on record: fold per *scheduled* beat so the sleep/dream economy survives low-cadence hosts

## Implementation steps

1. Add `lifecycle/catchup.go` with `PlanCatchUp` (pure, table-driven tests) + `FireCatchUp` orchestration reusing existing one-shot fire paths.
2. Wire deterministic seed handling (existing rand usage in runner → seeded per catch-up for reproducibility).
3. Integrate: desktop `EnsureBeatRunnerStarted` timer loop calls `FireCatchUp` when it wakes behind schedule (replaces naive next-tick). (The cloud lifecycle-worker is deliberately NOT wired — it is deleted outright in 4-4; cloud session tasks keep the old engine until Phase 6 retires the session plane.)
4. Tests: plan generation across boundary cases (elapsed < interval → 0 beats; short gap → K capped; long gap ≥ threshold → exactly 1 re-entry beat with hiatus framing; threshold boundary); double-advance regression (emotion after catch-up == lazy-evaluated + beat deltas exactly once); determinism test.
5. Docs: extend `docs/Entity-Lifecycle.md` catch-up section (consumers: desktop timer loop + 0-4 batch orchestrator).

## Files to create/modify

- NEW `lifecycle/catchup.go` + `lifecycle/catchup_test.go`
- `lifecycle/runner.go` (expose last-beat anchor; sampled/re-entry beat tagging)
- Engine `docs/Entity-Lifecycle.md`, CHANGELOG.md

## Verification gates

- `go build/vet/test ./...` green; new catch-up suites green
- Manual: stop desktop engine for 2h, restart, observe single condensed catch-up (log evidence)

## Risks & rollback

- Double-advance of temporal state is THE risk → regression test is mandatory before merging; lazy functions (0-1) make it structurally hard

## Progress checklist

- [ ] `PlanCatchUp` pure function + tests (incl. gap-kind classification)
- [ ] `FireCatchUp` orchestration + sampled/re-entry beat tagging
- [ ] Long-gap re-entry policy + threshold boundary tests green
- [ ] Timer-loop integration (desktop) behind-schedule path
- [ ] Double-advance regression test green
- [ ] Docs updated
