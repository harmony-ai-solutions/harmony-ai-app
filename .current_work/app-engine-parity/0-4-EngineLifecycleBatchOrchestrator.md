# Phase 0-4 — Engine: Lifecycle Batch Orchestrator

> **Repo:** `harmony-link-private` (branch `feat/app-engine-parity`)
> **Assessment basis:** 2026-10-11 review ruling — on-device lifecycle authority, blind cloud scheduler (see 4-3 / 4-4)
> **Depends on:** 0-1, 0-2
> **Codebase mapping consulted:** `.planning/codebase/` (engine — harmony-link-private): ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md

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

- [x] Batch orchestrator + priority policy implemented
- [x] Per-entity isolation + rollback tests green
- [x] Degraded (non-LLM) path verified
- [x] Deadline/budget truncation tests green
- [x] Determinism test green
- [x] Docs updated
- [x] Real `CompactDue` + overnight maintenance entry point (`RunOvernightMaintenance`) landed (ruling A+, 2026-10-11)

## Implementation notes (2026-10-11)

Landed on top of the uncommitted 0-1/0-2 changes. Files: NEW `lifecycle/batch.go`
+ `lifecycle/batch_test.go`; `lifecycle/runner.go` (added `DueAt`); engine
`docs/Entity-Lifecycle.md` (batch model + host matrix), `CHANGELOG.md`. No schema
changes; no timer-loop behavior change.

Deviations / decisions:

- **Host handle shape.** Implemented as `lifecycle.BatchHost` with
  `NewBatchHost(db *sql.DB, newRunner func(entityID string) *EntityBeatRunner) *BatchHost`
  and `func (h *BatchHost) ProcessLifecycleBatch(ctx, opts) BatchResult`. The
  per-entity runner construction is the injectable `NewRunner` seam; the default
  due-entity enumeration reads the engine DB (`entities` ×
  `lifecycle_state.last_beat_at`, plus per-entity interaction recency), and a host
  may override it via `BatchHost.DueEntities` (also the test injection point). The
  doc's `EntityBeatRunnerHost` name was adapted to the existing service/handle
  reality as permitted.
- **`BatchOptions` gained two fields** beyond the sketched four:
  `Degraded bool` (the host-injected credential state the doc's step 2 explicitly
  asks to pass via options) and `PriorityPolicy` (the "pluggable policy" seam).
  `Priority` is a string enum (`PriorityMostOverdue`) resolved through a
  table (`batchPriorityRegistry`); the default policy is `orderMostOverdue`.
- **Budget semantics.** Implemented exactly as the doc's rule — start entity *i*
  while `beatsUsed < MaxBeats`, decrement by the sampled beats actually fired
  (K). Consequence: an entity may overrun the budget by its own K (a sampled
  catch-up cannot be split mid-plan), and `MaxBeats <= 0` is treated as
  *unlimited* (otherwise the literal `beatsUsed < MaxBeats` check would truncate
  everything on a zero budget). Both are documented in `BatchOptions`.
- **Deadline clock.** The deadline is enforced against an injectable scheduler
  clock (`BatchHost.clock`, default `time.Now`) so truncation is deterministic
  under test; `Now` supplies the *planning* instant. In-flight entities may
  overrun the deadline (doc-acknowledged).
- **Degradation classification.** A runner is degraded when the host declares
  `opts.Degraded` or when it lacks usable clients
  (`backendClient.AllowsCustomPrompting() && cognitionClient != nil`). The
  degraded plan zeroes the LLM portions (`BeatsToFire`/`DreamDue`/`OutreachDue`)
  but keeps the temporal plan, so `FireCatchUp` advances non-LLM state exactly
  and persists with no LLM call attempted. `BatchResult.Degraded` is `[]string`
  as sketched; a degraded entity is not also listed in `Completed`.
- **Construction failures are per-entity.** A nil runner (or nil config) is
  recorded in `EntityOutcome.Err` under `Completed` rather than aborting or being
  silently truncated; the batch always continues. `Truncated` is reserved for the
  doc's deadline/budget meaning.
- **Due-check helper.** Added pure `IsEntityDue(cfg, lastBeat, now)` +
  `(*EntityBeatRunner).DueAt(now)` (doc step: "expose due-check helper for
  selection"). Shared by the DB enumeration and the runner; no timer-path change.
- **Compaction — RESOLVED (ruling A+, owner 2026-10-11; supersedes the earlier
  halt-flag — see the follow-up implementation note below).** `CatchUpPlan.CompactDue`
  is now a **real** flag. When `BatchOptions.ContextWindowSize > 0` the batch
  estimates the entity's conversation-history + memory tokens
  (`lifecycle.EstimateConversationAndMemoryTokens` — a DB read + `common.TokenCounter`
  count reusing the public `cognition.PrefetchPromptData` seam; no prompt build, no
  LLM) and applies `cognition.MemoryConsolidator.ShouldCompact` (80%, strictly
  greater), surfacing the result on the executed `EntityOutcome.Plan`. The sweep
  itself is a *separate* engine entry point — `BatchHost.RunOvernightMaintenance`
  (sibling to `ProcessLifecycleBatch`) — which 4-3's `BGProcessingTask` calls once
  per overnight window after consuming the flag. Compaction never runs in the 30 s
  push window.

Device gates flagged: the iOS 30 s push window and overnight `BGProcessingTask`
integration are host-side (4-1/4-3) and cannot be exercised here; the deadline
and degradation paths are covered by deterministic unit tests with injected
clocks/clients.

## Follow-up: overnight memory-compaction maintenance API (2026-10-11, ruling A+)

Owner ruling (2026-10-11): architecture **A+** — one engine entry point for
overnight deep maintenance, a sibling to the batch orchestrator; the batch
computes a *real* `CompactDue`; 4-3's iOS `BGProcessingTask` consumes the flag and
calls the entry point. Compaction never runs in the 30 s push window. This
resolves the halt-flag that stood in the implementation notes above.

Engine changes (`harmony-link-private`, on top of the uncommitted 0-1/0-2/0-4
tree):

- NEW `lifecycle/estimate.go` — `EstimateConversationAndMemoryTokens(ctx, db, entityID, modelName, tc) int`:
  the conversation-history + memory token estimate the consolidator's
  `ShouldCompact` threshold is defined over. Reuses the public
  `cognition.PrefetchPromptData` seam (the DB → `PromptContext` pre-fetch the beat
  runner already uses) for the interaction-scoped history and reads persisted
  memories from the DB; counts with `common.TokenCounter`. No prompt build, no
  LLM, no cognition refactor.
- NEW `lifecycle/maintenance.go` — `BatchHost.RunOvernightMaintenance(ctx, MaintenanceOptions) MaintenanceResult`:
  per target, builds a `cognition.MemoryConsolidator` via the injectable
  `BatchHost.NewConsolidator` factory and runs `RunCompactionLoop` with the
  estimator as tokenFn. Per-entity isolation, graceful degradation (no usable
  client → `Degraded`, never failed), deadline/ctx truncation. Auxiliary seams:
  `BatchHost.MaintenanceTargets` (default = live automatable AI entities, autonomy
  ≥ 1), and exported `InitCognitionClient` (extracted
  `initCognitionClientForLifecycle` pattern) + `NewEntityConsolidator` /
  `NewCognitionConsolidator`.
- `lifecycle/batch.go` — `BatchOptions` gained `ModelName` + `ContextWindowSize`;
  `ProcessLifecycleBatch` sets `plan.CompactDue` from the estimator +
  `ShouldCompact` (80%, strictly greater) for non-degraded entities when the
  window is configured.
- Tests: `lifecycle/estimate_test.go` (known fixture, empty→0, growth) +
  `lifecycle/maintenance_test.go` (Level-1 memory from a closed-interaction
  fixture, per-entity isolation, degraded no-client + host-declared, ctx
  cancellation, deadline truncation, real `CompactDue` at the 80% boundary).
- Docs: engine `docs/Entity-Lifecycle.md` (real `CompactDue` + new overnight
  section + host matrix row), `CHANGELOG.md`.

Gates: `go build ./...`, `go vet ./...`, `go test ./...` all exit 0.

Consumer contracts for the follow-ups (see final report of the follow-up task):
4-1 exposes the entry point over gomobile; 4-3 drives the overnight host
(flag consumption + invocation + deadline semantics).

Device gates flagged (unchanged): the overnight `BGProcessingTask` window is
host-side (4-1/4-3) and cannot be exercised here; deadline/degradation/cancellation
paths are covered by deterministic unit tests with injected clocks/clients.

