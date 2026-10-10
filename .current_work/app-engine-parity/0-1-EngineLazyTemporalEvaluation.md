# Phase 0-1 — Engine: Lazy Temporal Evaluation (Design Directive D1)

> **Repo:** `harmony-link-private` (branch `feat/app-engine-parity`)
> **Assessment basis:** §10.2 D1, §8.5, §9.4 pattern 2
> **Codebase mapping consulted:** `.planning/codebase/` (engine) — ARCHITECTURE.md, CONCERNS.md

## Objective

Refactor all tick-applied temporal state in the engine core into **pure functions of `(state₀, elapsed)`** evaluated on read. No behavior change on desktop/cloud hosts; makes the state portable to any host (iOS reads, BG-task windows, lifecycle-worker snapshot reconciliation) and strictly more robust (no missed ticks after process restarts).

## Context

Today the emotion engine applies decay/dampening/crystallization when the beat runner ticks; exhaustion/sleep progression advances on beats; DreamBeats expire via TTL checks on ticks. If a host cannot tick (iOS background, worker downtime), state silently goes stale. The assessment (§8.5/§9.4) established lazy evaluation as the standard solution (idle-game/pet-sim pattern; deterministic-sim doctrine: no wall-clock branching inside state transitions).

## Scope of temporal state (audit list)

| State | Current application site | Target |
|---|---|---|
| Ekman8 decay | `emotion/emotion_engine.go` (tick-applied decay) | `Evaluate(now)` computes decayed intensities from `(last_evaluated_at, stored intensities)`; persist on evaluation boundaries only |
| Dampening | `emotion/emotion_engine.go` | fold into `Evaluate(now)` |
| Crystallization | `emotion/emotion_engine.go` | threshold check against lazily-evaluated values; crystallization events still fire at evaluation time |
| Exhaustion (0.0–1.0) | `lifecycle/runner.go` (beat-driven) | `ExhaustionAt(now)` pure function of `(sleepStartTime|lastBeatTime, config)`; runner reads it instead of accumulating |
| Sleep state / transitions | `lifecycle/runner.go`, persisted via `lifecycle/state.go` | transition check becomes `SleepStateAt(now)`; persisted state stores the *anchor* (sleep start), not the derived flag |
| Dream TTL | DreamBeat expiry checks | `IsExpired(now)` on read (message visibility + purge) |
| Outreach cooldown | `lastOutreachTime` check in `lifecycle/outreach.go` | already effectively lazy (timestamp compare) — verify + test only |

## Implementation steps

1. Introduce `emotion/lazy.go` (or extend `emotion_engine.go`): pure `DecayFunction(intensities, elapsed, cfg) Ekman8` — no DB, no clock reads inside; clock injected as parameter.
2. Change `EmotionEngine` read paths (`GetState`, prompt-building consumers in `modules/cognition/prompt_builder.go`, beat context enrichment in `lifecycle/runner.go`) to run through the lazy evaluation and persist the evaluated snapshot + `last_evaluated_at` in one short tx (READ → compute → WRITE phase separation, same pattern as the cognition compaction deadlock fix).
3. Keep tick-driven *invocation* on hosts that have ticks (desktop, cloud session tasks, worker jobs) — they call the same `Evaluate(now)`; ticks become cache-refresh points, not correctness requirements.
4. Refactor `lifecycle` exhaustion/sleep to anchored-state reads (`runner.go`, `state.go`). Update `restorePersistedState()` to restore anchors only.
5. Dream TTL: add `IsExpired` gating in dream-message read paths; retention sweep uses it.
6. Tests: golden tests for decay math vs. old tick simulation (run N ticks of the old model, assert lazy `Evaluate` at the end equals ±ε); restart-mid-decay test (persist anchors, reload, evaluate).
7. Update `docs/Entity-Lifecycle.md` (engine) with the lazy model.

## Files to create/modify

- `emotion/emotion_engine.go`, NEW `emotion/lazy.go` (or equivalent)
- `lifecycle/runner.go`, `lifecycle/state.go`
- `modules/cognition/prompt_builder.go` (read path only)
- Engine `docs/Entity-Lifecycle.md`, CHANGELOG.md

## Verification gates

- `go build ./...`, `go vet ./...`, `go test ./...` green (incl. emotion + lifecycle suites)
- New equivalence tests green; existing beat-runner behavior tests unchanged
- Lifecycle-worker (cloud) still green after dependency bump (0-3)

## Risks & rollback

- Behavior drift risk: bounded by equivalence tests; ε-tolerance only for float ordering
- Revert = single engine commit revert; no schema changes (state columns reused; `last_evaluated_at` may reuse `updated_at` if identical semantics hold — verify, else additive column via migration with default now)

## Progress checklist

- [ ] Audit complete: all temporal state sites enumerated (add any missed to the table above)
- [ ] Pure decay functions implemented + unit-golden-tested
- [ ] Read paths routed through lazy evaluation (emotion, prompt builder, beat context)
- [ ] Exhaustion/sleep anchored-state refactor
- [ ] Dream TTL lazy expiry
- [ ] Equivalence + restart tests green
- [ ] Docs updated
