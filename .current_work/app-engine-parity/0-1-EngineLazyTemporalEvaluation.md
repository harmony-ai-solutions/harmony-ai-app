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
| Dream probability | `lifecycle/runner.go` `onTick` → `dreamProbabilityForDuration(time.Since(sleepStartTime))` | already lazy — pure of the `sleepStartTime` anchor; invocation-only (evaluated when a tick runs) — document |
| Beat in-flight guard | `lifecycle/runner.go` `inFlight` (skip-tick safety) | no change — concurrency guard, not temporal (no time coupling, nothing to decay) |
| Beat scheduler tick | `lifecycle/runner.go` `loop()` `time.NewTicker(BeatInterval)` | no change — invocation scheduling, not state; ticks are cache-refresh points (0-2/0-4 call the same evaluation entry points) |
| Host-scheduled sweeps (out of scope) | eventserver suspended-session expiry (`session.go` cleanup ticker), cloud-reload watcher, management WS keepalive, vision capture, integration health, sync handshake polling | out of scope — host-scheduling loops, not entity temporal state that goes stale |

**onTick re-audit (2026-10-11, step 4):** the tick body was re-read line by line. The only tick-coupled *state* was exhaustion decay + the sleep/wake transition (both refactored). Everything else the tick touches is either an anchor read (`sleepStartTime` for dream probability), a concurrency guard (`inFlight`), scheduling (`selectBeatType` randomness, the ticker), or an autonomy gate (`ShouldAutomateForEntity`) — none decays with time. No hidden tick-coupled state beyond the table was found.

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

- [x] Audit complete: all temporal state sites enumerated (add any missed to the table above) — onTick re-audit added 4 rows (dream probability, in-flight guard, scheduler tick, out-of-scope host sweeps); no hidden tick-coupled state found
- [x] Emotion pure decay function extracted + equivalence/restart tests green (was already lazy — pinned, not changed)
- [x] Exhaustion/sleep anchored-state refactor (incl. `onTick` re-audit for hidden tick-coupled state)
- [x] Dream TTL lazy expiry on read paths
- [x] Outreach cooldown verify + boundary tests
- [x] Docs updated

## Implementation notes (2026-10-11)

Deviations from the letter of the spec (all mechanical/no-behavior-change):

- **`DecayFunction` signature.** Implemented as `DecayFunction(intensities, baselines map[EkmanEmotion]float64, elapsed time.Duration, decayTau float64) map[EkmanEmotion]float64` (`emotion/lazy.go`). The doc sketched `DecayFunction(intensities, elapsed, cfg)`; the closed form decays *toward each emotion's own baseline*, so `baselines` is required to be equivalent, and `decayTau` (float) keeps it decoupled from the engine's field layout. Same arithmetic as the old inline loop → bit-for-bit equivalence.
- **Step 2 (emotion read/write persist).** No locking restructure was needed: `SetEmotion` already computes then persists the evaluated snapshot + `lastUpdate` in exactly one short tx (`persistLocked`); READ → compute → WRITE was already the shape. The only change on that path is routing the decay closed form through `DecayFunction`.
- **`SleepStateAt` signature.** Implemented as `SleepStateAt(sleeping bool, exhaustedAtNow float64, cfg *LifecycleConfig) bool` (composed with `ExhaustionAt`) rather than `SleepStateAt(now)`, so it stays consistent with the runner's materialized cache and remains a pure predicate. Hosts holding only an anchor call `ExhaustionAt(anchor, now, cfg)` first.
- **Persisted `Sleeping` flag retained.** The doc's target "persisted state stores the anchor (sleep start), not the derived flag" would drop the `Sleeping` column, but `lifecycle/state_test.go` pins `Sleeping` round-tripping and `sleepStartTime` is not cleared on wake, so the flag is genuinely needed. Kept as a persisted materialized value; anchors (`Exhaustion`+`LastBeatAt`, `SleepStartTime`, `LastOutreachAt`) are restored and the state is materialized on read. No schema change.
- **Legacy-tick fallback.** To keep the existing beat-runner behavior tests *unchanged* (doc gate), the runner keeps `exhaustion`/`sleeping` as materialized caches and `materializeExhaustionLocked` falls back to exactly one tick when there is no anchor instant yet (or `BeatInterval <= 0`, which the white-box unit tests exercise). Real host paths always carry an anchor, so the anchored continuous decay applies there.
- **Risk resolved — no `last_evaluated_at` column.** `lifecycle_state.last_beat_at` has identical semantics to an exhaustion "evaluated at" instant (persist materializes exhaustion *at* `LastBeatAt`), and `emotion_state.last_update` already anchors emotion decay. Both existing columns are reused; no additive migration is required.
