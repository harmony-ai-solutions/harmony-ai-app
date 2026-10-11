# Phase 0-4 — Engine: Lifecycle Batch Orchestrator

> **Repo:** `harmony-link-private` (branch `feat/app-engine-parity`)
> **Assessment basis:** 2026-10-11 review ruling — on-device lifecycle authority, blind cloud scheduler (see 4-3 / 4-4)
> **Depends on:** 0-1, 0-2

## Objective

A host-callable **batch** entry point over the catch-up seam: given a wake window with a deadline and an execution budget, advance all due entities for this host in one orchestrated pass — per-entity transaction isolation, priority ordering, deadline-aware truncation, and graceful non-LLM degradation. This is the runtime that makes "the clock is the ticker" work on constrained hosts (iOS silent-push wake ≈ 30 s, BGProcessingTask overnight) while desktop/Android keep their timer loops unchanged.

## Context

0-2 delivers per-entity catch-up (`PlanCatchUp` + `FireCatchUp`). Mobile hosts don't wake per entity — they wake per **process** (one push, one background window) and must process every due entity inside that window, knowing the OS will kill them at an arbitrary deadline. Partial completion must be safe (some entities finish, some don't — never corrupted), ordering must be deliberate (the most "alive" entities first), and credential/network failure must degrade to pure lazy evaluation rather than a failed batch.

## Design

```go
// lifecycle/batch.go
type BatchOptions struct {
    Now       time.Time
    Deadline  time.Time    // hard stop for SCHEDULING new entities (in-flight may overrun slightly)
    MaxBeats  int          // total LLM-beat budget for the whole batch (tier policy, passed by host)
    Priority  BatchPriority // ordering policy (see below)
}

type BatchResult struct {
    Completed  []EntityOutcome // entity IDs + per-entity FireCatchUp results
    Truncated  []string        // entities due but not started (deadline/budget hit)
    Degraded   []string        // entities advanced non-LLM only (no valid credentials/backend)
}

type EntityOutcome struct {
    EntityID string
    Plan     CatchUpPlan // 0-2 plan as executed
    Err      error       // per-entity failure NEVER aborts the batch
}

func (r *EntityBeatRunnerHost) ProcessLifecycleBatch(ctx context.Context, opts BatchOptions) BatchResult
```

Rules:

- **Affected-entity selection is host-local**: the engine enumerates due entities from its own DB (`lifecycle_state.last_beat_at` + lazy due-checks from 0-1/0-2). No external input needed — the cloud keepalive (4-4) carries NO entity data, by design (privacy ruling).
- **Priority ordering** (default policy, table-driven + pluggable): most-overdue first, tie-broken by recency of interaction with the user, then autonomy level. Rationale: a 30 s window that fits 3 entities must pick the 3 the user would miss most.
- **Per-entity isolation**: each entity's catch-up runs in its own short transactions (READ → compute/LLM → WRITE phase separation — same discipline as the cognition compaction deadlock fix). One entity's failure/rollback never touches another's writes.
- **Deadline discipline**: before starting entity *i*, check `now < Deadline && beatsUsed < MaxBeats`. Expiration handlers on the host (iOS) stop the process; the engine checkpoints completed entities via their per-entity persists — resumption is implicit (next wake replans from anchors).
- **Non-LLM degradation**: if backend/cognition clients are unavailable or unauthenticated, the batch still advances all non-LLM state exactly (lazy emotion/exhaustion/sleep/dream-TTL from 0-1) and reports those entities as `Degraded`. State correctness never depends on credentials; narratives do.
- **Beat budget accounting**: `MaxBeats` is decremented by the *sampled* beats actually fired (K per entity), not by entity count. Hosts obtain the budget from the existing tier policy API (user-authenticated fetch; no lifecycle-specific enrollment) — enforcement is cooperative on-device, metering happens at the inference gateway.
- **Bounded spend across downtime**: batch LLM cost is a function of due-entity count and `MaxBeats` only — never of how long the host was offline. 0-2's gap policy caps short gaps at K ≤ MaxCatchUpBeats and collapses long gaps (≥ `LongGapThreshold`, default 48h) to a single re-entry beat per entity, so a device returning after two weeks costs the same as one returning overnight.
- **Exhaustion folding**: the batch uses whichever folding rule 0-2's open decision settles (per sampled beat K vs per missed scheduled beat N). Recommendation on record: fold non-LLM exhaustion per *scheduled* beat so the sleep/dream economy survives low-cadence hosts (see degradation analysis, 2026-10-11).
- **Dream/compact outreach gates**: dream-due and outreach-due entities route through the same `FireCatchUp` plan flags; memory compaction triggers are exposed as batch flags for the overnight window (consumed by 4-3's BGProcessingTask path), NOT run in the 30 s push window.
- **Determinism**: same `(states₀, now, seed, budget)` → same batch plan and order (seeded per batch).

## Implementation steps

1. `lifecycle/batch.go`: host handle (owns the per-entity runner construction), `BatchOptions`/`BatchResult`, selection + priority ordering, deadline/budget loop.
2. Per-entity error isolation + degraded-mode path (credential-missing detection is the host's injection state, passed in via options — engine stays pure).
3. Tests: mixed-fleet batch (3 due entities, budget 1 → 1 completed, 2 truncated, order correct); per-entity rollback isolation (entity 2 LLM fails → entities 1+3 unaffected); degradation (no backend → all entities `Degraded`, non-LLM state still exact); deadline truncation; determinism test.
4. Docs: extend `docs/Entity-Lifecycle.md` with the batch model + host matrix (desktop timer / Android sidecar timer / iOS push-window + overnight).

## Files to create/modify

- NEW `lifecycle/batch.go` + `lifecycle/batch_test.go`
- `lifecycle/runner.go` (expose due-check helper for selection; no behavior change to timer path)
- Engine `docs/Entity-Lifecycle.md`, CHANGELOG.md

## Verification gates

- `go build ./...`, `go vet ./...`, `go test ./...` green (incl. new batch suite)
- Equivalence: batch outcome for a single due entity == direct `FireCatchUp` outcome
- No timer-loop behavior change (desktop/Android paths untouched — assert via existing runner tests)

## Risks & rollback

- Revert = single engine commit; no schema changes (batch reads/writes only existing anchors/state)
- Budget under-count (sampled beats vs gateway-billed calls) → gateway metering is the enforcement backstop; telemetry reconciles both

## Progress checklist

- [ ] Batch orchestrator + priority policy implemented
- [ ] Per-entity isolation + rollback tests green
- [ ] Degraded (non-LLM) path verified
- [ ] Deadline/budget truncation tests green
- [ ] Determinism test green
- [ ] Docs updated
