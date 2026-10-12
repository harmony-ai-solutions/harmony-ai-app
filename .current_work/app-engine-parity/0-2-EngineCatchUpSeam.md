# Phase 0-2 — Engine: Catch-Up Seam `FireCatchUp` (Design Directive D2)

> **Repo:** `harmony-link-private` (branch `feat/app-engine-parity`)
> **Assessment basis:** §10.2 D2, §9.4 pattern 3 (time-compressed catch-up), §7.1 (existing one-shot seam)
> **Depends on:** 0-1
> **Codebase mapping consulted:** `.planning/codebase/` (engine — harmony-link-private): ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md

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

- [x] `PlanCatchUp` pure function + tests (incl. gap-kind classification)
- [x] `FireCatchUp` orchestration + sampled/re-entry beat tagging
- [x] Long-gap re-entry policy + threshold boundary tests green
- [x] Timer-loop integration (desktop) behind-schedule path
- [x] Double-advance regression test green
- [x] Docs updated

## Implementation notes (2026-10-11)

Landed on top of 0-1 (uncommitted). Files: NEW `lifecycle/catchup.go` +
`lifecycle/catchup_test.go`; `lifecycle/runner.go` (loop/catch-up integration,
`selectBeatTypeRoll`, `fireBeat` internal path, `LastBeatAt`); `lifecycle/config.go`
(3 new fields); engine `docs/Entity-Lifecycle.md` + `CHANGELOG.md`.

Deviations / decisions (all noted for the 0-4 reviewer):

- **`CatchUpPlan` gained three fields** beyond the sketched struct: `MissedBeats`
  (N), `FoldBeats` (the exhaustion fold actually applied), and `Seed`
  (deterministic per plan). Kept `Elapsed`/`GapKind`/`BeatsToFire`/`DreamDue`/
  `CompactDue`/`OutreachDue` as sketched. 0-4 can read `FoldBeats`/`Seed` for
  budget + reproducibility; `BeatsToFire` is unchanged.
- **Beats = floor, not ceil.** The doc's struct comment says
  `ceil(elapsed/BeatInterval)`, but its own test criterion says `elapsed <
  interval → 0 beats`. Implemented `floor` (no beat is due below one interval);
  `missedBeats = floor(elapsed/BeatInterval)`.
- **Exhaustion folding (open decision #7) — resolved config-driven, default N.**
  New `LifecycleConfig.CatchUpExhaustionFolding`: `"scheduled"` (default; folds N
  = missed scheduled beats) or `"sampled"` (folds K). FireCatchUp applies the fold
  once, up front, and the sampled beats run with per-beat accumulation suppressed
  (their opts carry `catchUp != nil`), so the fold is exact-once regardless of LLM
  availability. **Long gaps fold 0** — the doc's long-gap rule says emotion/
  exhaustion/sleep already reflect elapsed time via 0-1 free arithmetic and the
  window is not simulated; a long gap therefore decays only. Consequence to review:
  for short gaps the scheduled fold saturates exhaustion for gaps ≳ 8h (N·0.10),
  which can push the entity into sleep on wake — intended ("sleep/dream economy
  survives"), but flagged.
- **≤3 LLM-call bound.** The doc's "≤3 (re-entry + dream + outreach)" is the
  long-gap case and is exact there (1 re-entry + ≤1 dream + ≤1 outreach). A short
  gap fires ≤ MaxCatchUpBeats sampled beats + those same two checks; still O(1) in
  elapsed. Outreach is excluded from the sampled set (`selectBeatTypeRoll(...,
  excludeOutreach=true)`) so it can never double-fire.
- **Framing vs storage.** The catch_up tag is embedded in the monologue entry text
  (`[catch_up=true] …`) so it is *both* persisted and rendered (Inner Thoughts
  section), and the time-compression note is prepended to the current beat's user
  prompt so it is LLM-visible in the exact prompt that generated the beat — not
  merely stored. Framing scales with gap kind (sampled pass vs dormancy).
- **`DreamDue`/`OutreachDue` are hints.** `PlanCatchUp` is pure and cannot see
  `sleepStartTime`/`last_outreach_at`, so the plan carries time/autonomy-derived
  eligibility and FireCatchUp re-checks the state-based gates (sleeping +
  probability; exact anchored cooldown) before firing. `CompactDue` is always
  false — compaction is a batch concern (0-4), not a catch-up beat.
- **`selectBeatType` now iterates candidates in sorted order** (was map order) so
  the seeded catch-up roll is reproducible; ordinary-beat distribution is
  unchanged (pinned by the existing `TestSelectBeatType_WeightedDistribution`).
- **Deviation from the files list:** docs say `runner.go` only, but 0-2 needed
  `lifecycle/config.go` too (the three new config knobs). No schema change, no
  cognition change — the framing rides existing prompt text.

Gates: `go build ./...`, `go vet ./...`, `go test ./...` all exit 0; `go test
-race ./lifecycle ./emotion` green. Manual 2h-stop-restart observation not run
(agent cannot run the desktop app) — flagged for device verification.

