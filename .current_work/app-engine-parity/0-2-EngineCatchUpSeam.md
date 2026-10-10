# Phase 0-2 — Engine: Catch-Up Seam `FireCatchUp` (Design Directive D2)

> **Repo:** `harmony-link-private` (branch `feat/app-engine-parity`)
> **Assessment basis:** §10.2 D2, §9.4 pattern 3 (time-compressed catch-up), §7.1 (existing one-shot seam)
> **Depends on:** 0-1

## Objective

Formalize a host-callable catch-up entry point on the beat runner: given elapsed time since the last processed beat, advance entity state in one condensed pass — **sampled K beats, not N** — so any wake (app foreground, BG-task window, worker job, post-downtime desktop) converges the entity deterministically.

## Context

`NewEntityBeatRunner` already exposes one-shot `FireBeat` / `FireDreamBeat` / `FireOutreachBeat` (the D-BEH-04 headless seam consumed by the cloud lifecycle-worker). What's missing is the *interval folding*: the idle-game fixed-step pattern (IdleKit `engine.advance(elapsed)` with clamp; assessment §9.1d) — LLM-touching beats are sampled (K representative beats over the missed window), non-LLM state advances via the 0-1 lazy functions exactly.

## Design

```go
// lifecycle/catchup.go
type CatchUpPlan struct {
    Elapsed     time.Duration
    BeatsToFire int      // K = min(config.MaxCatchUpBeats, ceil(elapsed / BeatInterval))
    DreamDue    bool     // from DreamTTL lazy evaluation (0-1)
    CompactDue  bool     // memory compaction threshold check
    OutreachDue bool     // autonomy-gated + cooldown lazy check
}

func PlanCatchUp(cfg *LifecycleConfig, lastBeat time.Time, now time.Time) CatchUpPlan
func (r *EntityBeatRunner) FireCatchUp(ctx context.Context, plan CatchUpPlan) error
```

Rules:
- `K` capped (default 3, configurable) — sampling, not replay: beats represent the window, monologue entries note the covered interval
- Non-LLM state (emotion, exhaustion, sleep) must NOT be double-advanced: catch-up reads state via 0-1 lazy functions anchored at `lastBeat`, and beats apply deltas on top of the lazily-evaluated base
- Fixed-step ordering: advance lazy state → sampled beats → dream/compact/outreach checks (each still individually gated by `ShouldAutomate`)
- Monologue ring buffer: sampled beat entries tagged `catch_up=true` so prompt building can represent compressed time honestly
- Determinism: same `(state₀, lastBeat, now, seed)` → same plan

## Implementation steps

1. Add `lifecycle/catchup.go` with `PlanCatchUp` (pure, table-driven tests) + `FireCatchUp` orchestration reusing existing one-shot fire paths.
2. Wire deterministic seed handling (existing rand usage in runner → seeded per catch-up for reproducibility).
3. Integrate: desktop/cloud `EnsureBeatRunnerStarted` timer loop calls `FireCatchUp` when it wakes behind schedule (replaces naive next-tick); lifecycle-worker `job.go` "beat"/"dream" cases route through `PlanCatchUp` for missed windows (its `lookahead.go` already schedules ahead — reconcile to avoid double-firing; the worker keeps its gate mirror).
4. Tests: plan generation across boundary cases (elapsed < interval → 0 beats; huge elapsed → cap); double-advance regression (emotion after catch-up == lazy-evaluated + beat deltas exactly once); determinism test.
5. Docs: extend `docs/Entity-Lifecycle.md` catch-up section; note the OUT-OF-REPO obligation for the worker unchanged.

## Files to create/modify

- NEW `lifecycle/catchup.go` + `lifecycle/catchup_test.go`
- `lifecycle/runner.go` (expose last-beat anchor; sampled-beat tagging)
- Cloud `soulbits-cloud-backend/cmd/lifecycle-worker/job.go`, `lookahead.go` (consumer — coordinate with 0-3)
- Engine `docs/Entity-Lifecycle.md`, CHANGELOG.md

## Verification gates

- `go build/vet/test ./...` green; new catch-up suites green
- Lifecycle-worker local job tests green post-wiring
- Manual: stop desktop engine for 2h, restart, observe single condensed catch-up (log evidence)

## Risks & rollback

- Double-advance of temporal state is THE risk → regression test is mandatory before merging; lazy functions (0-1) make it structurally hard
- Worker double-fire: guarded by existing distributed scheduling; verify `lookahead` marks jobs consumed

## Progress checklist

- [ ] `PlanCatchUp` pure function + tests
- [ ] `FireCatchUp` orchestration + sampled-beat tagging
- [ ] Timer-loop integration (desktop/cloud) behind-schedule path
- [ ] Lifecycle-worker routing reconciled with lookahead
- [ ] Double-advance regression test green
- [ ] Docs updated
