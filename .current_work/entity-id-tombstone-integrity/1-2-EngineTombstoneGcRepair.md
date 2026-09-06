# 1-2 — Engine: Tombstone GC Repair (FK-Safe Order, Unified Allowlist, Purge Floor)

> **Rewritten in plan review 6** (user-ruled 2026-09-06, rulings **D69/D71/D72/D76/D77/D78**): this phase no
> longer removes the tombstone purge — it **repairs** it. D1's never-purge invariant is superseded: tombstones
> are the delete-propagation protocol, garbage-collected after propagation. Phase 5 (restore) is deleted
> (D75), so no restore machinery hangs off tombstones anymore.

## Objective

Turn the permanently-broken finalize purge into a correct, FK-safe GC; unify its allowlist with the registered
sync tables; add the **purge floor** that makes the deliberately un-gated trigger (D69a) multi-device-safe
(D76). Kills the recurring error for real:

```
Failed to clean up soft-deleted records after sync: failed to cleanup soft-deleted records in
character_profiles: FOREIGN KEY constraint failed
```

## Context (investigation 2026-09-05; corrected in plan reviews; re-scoped in review 6)

- Single call site: `eventserver/synchronization.go:1854` inside `handleSyncFinalize` — **stays exactly
  where it is** (D69: trigger semantics unchanged — tombstones with `deleted_at < session.StartTime`,
  best-effort, never fails the sync).
- `database/repository/synchronization/maintenance.go:12-47` has **two real bugs** (both fixed here):
  1. **Fatal order**: purges `character_profiles` BEFORE `entities`, but soft-deleted entities still
     reference soft-deleted profiles via `entities.character_profile_id → character_profiles(id)`
     `ON DELETE RESTRICT` (`000001_initial_schema.up.sql:16-22`) → the first table's DELETE aborts →
     **no table is ever purged** (verified live: `Isabella` tombstone from 2026-09-04 persists).
  2. **Fatal abort**: the loop `return`s on the first per-table error (`maintenance.go:37-38`) — one stuck
     table kills every later table's purge too.
- **The un-gated trigger is a latent multi-device hazard, accepted by D69(a) and mitigated by D76** (below):
  any device's finalize purges tombstones other devices may not have seen; a lagging device's stale live row
  can resurrect via 1-1's plain-insert path once the tombstone is gone. The purge floor + rebuild closes this
  hole structurally. (Pre-review-6, the plan dodged this by never purging — D1 superseded.)
- `cleanupTables` (32) ≠ `registeredSyncTables` (35): `memories`, `emotion_state`, `lifecycle_state` were
  never in the purge list (D72 unifies — the app side purges `memories` today; the lists must not diverge).
- `DeleteOrphanedMemories` (`database/repository/memory/memory.go:169-184`, call site
  `synchronization.go:1862`) **stays** (D77) — it sweeps memories whose referencing interactions are gone
  (including interactions purged by this GC), and is the belt-and-braces for legacy divergent-stamp families
  that converge over multiple runs (D71 accepted window).
- Dead-code facts unchanged from earlier reviews: `DeleteEmotionState` (`emotion.go:90-97`) has zero
  production callers (test-only, `emotion_test.go:191`); `SoftDeleteEmojiActionsByEntity`
  (`emoji_action.go:76-80`) and `UpdateMemoryEndDate` (`memory.go:103-111`) likewise (D21-3 sweep, step 6).
- Engine ordering precedent: the app's purge already documents the entities-before-profiles RESTRICT
  reasoning (`SyncService.ts:1554-1562`) — mirror that reasoning here, extended child-first.

## Implementation Steps

1. **FK-safe table order (D71)** — replace the flat allowlist iteration with an explicitly ordered list:
   1. entity children: `entity_module_mappings`, `interactions`, `conversation_messages`, `memories`,
      `emotion_state`, `lifecycle_state`, `entity_emoji_actions`, `chat_conversation_settings`
   2. `entities` (its rows reference profiles RESTRICT — entities before profiles; note
      `conversation_messages.entity_id` is `ON DELETE CASCADE` in the current DDL while `interactions` is
      NO ACTION — children-first order satisfies both)
   3. `character_profiles`
   4. `character_image` (CASCADE child of profiles; its own tombstones purge order-independently)
   5. provider configs (parents)
   6. module configs (children of providers via `provider_config_id`)
2. **Per-table log-and-continue (D71)**: a table's DELETE failure logs a warn (table + error) and
   **continues**; return an aggregate error at the end. Finalize keeps treating cleanup as best-effort.
   Legacy families with divergent child stamps (pre-D17/D25) converge over successive runs — document in a
   code comment; do not special-case.
3. **Allowlist = the full 35 (D72)**: add `memories`, `emotion_state`, `lifecycle_state` (ephemeral per D53 —
   purge is trivially safe; single row per entity). Keep the allowlist as one named constant; 6-1 adds a
   fixture asserting it equals `registeredSyncTables` (the 32/33/35 drift is exactly how this bug class
   breeds).
4. **Purge floor (D76)** — new engine-local state + handshake check:
   - Persist `max_purged_deleted_at` (unix seconds) = max `deleted_at` over rows **actually deleted** by GC
     runs; advances only when ≥1 row was purged (a no-op run never advances it). Accounting must survive
     per-table partial failures (count only rows deleted, per-table). Home: a one-row
     `sync_gc_state` table — **migration 000046**
     (`sync_gc_state(id INTEGER PRIMARY KEY CHECK (id = 1), max_purged_deleted_at INTEGER NOT NULL DEFAULT 0)`
     + `.down` drop). The app ships a **placeholder 000046** (owned by 4-1; same pattern as 000045, D11).
   - **Rebuild signal at SYNC_REQUEST** (after device lookup): if `device.SyncedTables` is non-empty
     (established device — fresh installs are exempt) AND `device.LastSyncTimestamp < max_purged_deleted_at`,
     respond with a rebuild-required signal instead of a normal accept. Shape: a typed `SYNC_REJECT` with
     reason `rebuild_required` (the `SyncRejectPayload` precedent exists for the size-estimate reject) or a
     `rebuild_required: true` field on the accept — pick ONE with 3-3, which owns the handshake response
     family. Do NOT tear down the WS (the app must be able to act on it — cf. D57's lesson).
   - **Invariants:** the finalizing device can never trip the check (its watermark = `session.StartTime` >
     every purged stamp, by the `< cutoff` predicate); after a rebuild, the device's first full pull
     advances its watermark past the floor → no loop (the app still treats the signal as one-shot per
     occurrence — 4-5).
   - Clock-skew note (non-goal): `deleted_at` stamps are sender clocks while the watermark is engine session
     clock — skew only shifts purge timing, not detection correctness.
5. **Keep placement + best-effort semantics**: the GC stays the tail of `handleSyncFinalize` inside the
   finalize tx; the `DeleteOrphanedMemories` call site stays right after it (D77 — the review-6 ruling voids
   the old removal step).
6. **Dead-code sweep (D21-3, unchanged from prior reviews):** delete `DeleteEmotionState` (`emotion.go:90-97`
   — delete the `emotion_test.go:151-204` block that calls it), `SoftDeleteEmojiActionsByEntity`
   (`emoji_action.go:76-80`), `UpdateMemoryEndDate` (`memory.go:103-111`). Do NOT touch `DeleteEmojiAction`
   (`emoji_action.go:70` — live in the sync-apply delete branch, `synchronization.go:1528`).
7. **`DeleteMemory` stays a hard delete — documented exception (D67, unchanged):** single production caller
   is memory consolidation (`modules/cognition/memory_consolidator.go:426`); no tombstone → no outbound
   sync; app devices retain consolidated sources (recorded in 6-2; the D77 orphan sweep does NOT fix this —
   those rows stay referenced app-side).
8. **Storage note (D78)**: tombstones are bounded by GC now — `character_image` blobs are reclaimed when the
   family purges; no tombstone-time blob slimming (rejected: it would break nothing today but adds a
   delete-path mutation for a window that GC already bounds).
9. **FK contract**: keep all constraints — they guard management-API misuse; the GC's child-first order is
   what makes them satisfiable.
10. **Greeting semantics (D9 as amended — no code change here)**: `HasPriorConversation` →
    `FindPriorInteractions` (`interaction/interactions.go:279-317`) keeps filtering `deleted_at IS NULL`.
    Post-GC a purged family is simply gone; pre-GC tombstoned history is invisible either way. Do NOT make
    the guard tombstone-aware.
11. **Cascade note (unchanged; ownership pinned review 7: engine = 2-1b step 6, app = 4-4 step 6):**
    `DeleteEntity`'s cascade growth to 8 children + D17/D25 unified stamping remain in the plan as
    **delete-path hygiene** (complete tombstoning so the GC can purge whole families; no restore
    matcher consumes the stamps).

## Files to Modify

- `database/repository/synchronization/maintenance.go` (ordered allowlist, log-and-continue, floor accounting)
- `eventserver/synchronization.go` (floor persistence in finalize; SYNC_REQUEST rebuild check; call-site placement otherwise unchanged)
- `database/migrations/000046_sync_gc_state.up.sql` / `.down.sql` (+ app placeholder 000046, owned by 4-1)
- `database/repository/entities/emotion.go`, `emoji_action.go`, `database/repository/memory/memory.go`
  (dead-code deletions per D21-3)

## Tests

- Persona/entity family (tombstoned entity + profile + images + children) → **one finalize purges the whole
  family** — the recurring FK error is dead (regression lock, incl. a live-log manual check).
- Poison-table test (one DELETE fails via injected constraint) → later tables still purge; aggregate error
  logged; sync finalize still succeeds.
- Floor: run with zero eligible rows → floor unchanged; run purging rows → floor = max purged `deleted_at`;
  per-table partial failure accounts only actually-deleted rows.
- SYNC_REQUEST: established device with watermark < floor → rebuild signal; fresh device (empty
  `synced_tables`) → normal accept; the just-finalized device → never flagged.
- Allowlist == `registeredSyncTables` (fixture; 6-1 tie-in).
- `DeleteEmotionState` gone (update `emotion_test.go` accordingly).

## Codebase Mapping Consulted

`harmony-link-private/.planning/codebase/`, memory-bank `systemPatterns.toon` (soft-delete pattern — this
phase now re-aligns the code with tombstone-as-protocol + GC), plan reviews 2026-09-05 → review 6.

## Checklist

- [ ] FK-safe order + per-table log-and-continue (D71)
- [ ] Allowlist unified to 35 (D72) + parity fixture
- [ ] Purge floor persisted + SYNC_REQUEST rebuild check (D76; signal shape agreed with 3-3)
- [ ] Migration 000046 + app placeholder shipped (D11 parity pattern)
- [ ] `DeleteOrphanedMemories` call site KEPT (D77); dead-code sweep done (D21-3); `DeleteMemory` exception documented (D67)
- [ ] Recurring FK error gone in a fresh sync cycle (manual log check); tests green; phase doc updated
