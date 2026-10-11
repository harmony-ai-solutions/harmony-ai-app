# Phase 0-1 — Engine: Lazy Temporal Evaluation (Design Directive D1)

> **Repo:** `harmony-link-private` (branch `feat/app-engine-parity`)
> **Assessment basis:** §10.2 D1, §8.5, §9.4 pattern 2
> **Codebase mapping consulted:** `.planning/codebase/` (engine) — ARCHITECTURE.md, CONCERNS.md

## Objective

Anchor the engine's remaining tick-coupled temporal state into **pure functions of `(state₀, elapsed)`** evaluated on read, and pin the already-lazy paths with extracted pure functions + tests. No behavior change on desktop hosts; makes the state portable to any host (iOS reads, BG-task windows, any embedded wake) and strictly more robust (no missed ticks after process restarts). State advancement is pure arithmetic — the entity ages through any gap with zero API cost; how much it *narrates* over a gap is bounded separately by 0-2's long-gap re-entry policy.

## Context

**Audit correction (2026-10-11 review):** the emotion engine is *already* lazily evaluated — `emotion/emotion_engine.go` has no tick path. `applyDecayLocked()` computes elapsed-time exponential decay (`baseline + (i − baseline)·e^(−Δt/τ)`) from `lastUpdate` and runs on reads/writes (`SetEmotion`, `GetCurrentState`, `GetCurrentDominantEmotion`); dampening is event-driven inside `SetEmotion`; crystallization is timestamp-anchored (`crystallizeStart` vs `crystallizeMinHours`). The genuinely tick-coupled state is elsewhere: **exhaustion/sleep progression** decays per tick in `lifecycle/runner.go` (`onTick`: `exhaustion -= ExhaustionDecayPerTick`, wake check, dream gate), **Dream TTL** is a beat-path sweep (`CleanupExpiredDreams` runs when the next dream fires, not on read), and **outreach cooldown** is already a lazy timestamp compare. If a host cannot tick (iOS background, process downtime), the tick-coupled state silently goes stale. The assessment (§8.5/§9.4) established lazy evaluation as the standard solution (idle-game/pet-sim pattern; deterministic-sim doctrine: no wall-clock branching inside state transitions).

## Scope of temporal state (audit list — corrected to current code)

| State | Current application site | Target |
|---|---|---|
| Ekman8 decay | `emotion/emotion_engine.go` — **already lazy**: elapsed-time exponential decay on reads/writes (`applyDecayLocked`, anchored on `lastUpdate`) | extract the closed form into a pure `DecayFunction(intensities, elapsed, cfg)`; assert equivalence with `applyDecayLocked`; no behavior change |
| Dampening | `emotion/emotion_engine.go` — event-driven inside `SetEmotion` (delta-proportional, no time coupling) | no change — document (already lazy by construction) |
| Crystallization | `emotion/emotion_engine.go` — **already timestamp-anchored** (`crystallizeStart`, `time.Since ≥ crystallizeMinHours`, evaluated at read/event time) | verify + test only; keep events firing at evaluation time |
| Exhaustion (0.0–1.0) | `lifecycle/runner.go` `onTick` — **tick-applied** (`exhaustion -= ExhaustionDecayPerTick` per beat) | `ExhaustionAt(now)` pure function of `(sleepStartTime|lastBeatTime, config)`; runner reads it instead of accumulating |
| Sleep state / transitions | `lifecycle/runner.go` `onTick` (wake check + dream gate), persisted via `lifecycle/state.go` | transition check becomes `SleepStateAt(now)`; persisted state stores the *anchor* (sleep start), not the derived flag |
| Dream TTL | beat-path sweep: `CleanupExpiredDreams` runs when the *next* dream fires (`lifecycle/runner.go` → `database/repository/conversation/messages.go`) — not read-path expiry | `IsExpired(now)` on read (message visibility + purge); retention sweep uses it |
| Outreach cooldown | runner's outreach gate (`lifecycle/runner.go`, OUT-03 — `time.Since(lastOutreachTime)` compare on anchored, persisted timestamp) | already lazy — verify + test only |

## Implementation steps

1. Introduce `emotion/lazy.go` (or extend `emotion_engine.go`): pure `DecayFunction(intensities, elapsed, cfg) Ekman8` — no DB, no clock reads inside; clock injected as parameter. Route `applyDecayLocked()` through it (mechanical extraction; the closed form is unchanged).
2. Emotion read/write paths (`SetEmotion`, `GetCurrentState`, `GetCurrentDominantEmotion`, prompt-building consumers in `modules/cognition/prompt_builder.go`, beat context enrichment in `lifecycle/runner.go`) keep their existing evaluate-on-access semantics; persist the evaluated snapshot + `lastUpdate` in one short tx where they already persist (READ → compute → WRITE phase separation, same pattern as the cognition compaction deadlock fix).
3. Keep tick-driven *invocation* on hosts that have ticks (desktop timer loop; embedded hosts via the 0-4 batch) — they call the same evaluation entry points; ticks remain cache-refresh points, not correctness requirements.
4. Refactor `lifecycle` exhaustion/sleep to anchored-state reads (`runner.go` `onTick` + `state.go`). Update `restorePersistedState()` to restore anchors only. Re-audit `onTick` for any other tick-coupled state hiding behind the exhaustion/sleep block (same rigor as the emotion audit that produced this correction).
5. Dream TTL: add `IsExpired` gating in dream-message read paths; retention sweep uses it (replaces the sweep-only `CleanupExpiredDreams` trigger).
6. Tests: emotion — equivalence of the extracted pure function vs `applyDecayLocked` (same closed form; ±ε float tolerance) + restart-mid-decay test (persist anchors, reload, evaluate); exhaustion/sleep — golden tests vs old tick simulation (run N ticks of the per-tick model, assert anchored `ExhaustionAt(now)` equals ±ε); outreach cooldown boundary tests.
7. Update `docs/Entity-Lifecycle.md` (engine) with the lazy model (noting emotion was already read-time lazy; this phase anchors the beat-coupled remainder).

## Files to create/modify

- `emotion/emotion_engine.go`, NEW `emotion/lazy.go` (or equivalent)
- `lifecycle/runner.go`, `lifecycle/state.go`
- `modules/cognition/prompt_builder.go` (read path only)
- Engine `docs/Entity-Lifecycle.md`, CHANGELOG.md

## Verification gates

- `go build ./...`, `go vet ./...`, `go test ./...` green (incl. emotion + lifecycle suites)
- New equivalence tests green; existing beat-runner behavior tests unchanged

## Risks & rollback

- Behavior drift risk: bounded by equivalence tests; ε-tolerance only for float ordering
- Revert = single engine commit revert; no schema changes (state columns reused; `last_evaluated_at` may reuse `updated_at` if identical semantics hold — verify, else additive column via migration with default now)

## Progress checklist

- [ ] Audit complete: all temporal state sites enumerated (add any missed to the table above)
- [ ] Emotion pure decay function extracted + equivalence/restart tests green (was already lazy — pinned, not changed)
- [ ] Exhaustion/sleep anchored-state refactor (incl. `onTick` re-audit for hidden tick-coupled state)
- [ ] Dream TTL lazy expiry on read paths
- [ ] Outreach cooldown verify + boundary tests
- [ ] Docs updated
