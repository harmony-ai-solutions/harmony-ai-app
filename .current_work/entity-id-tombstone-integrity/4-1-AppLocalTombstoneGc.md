# 4-1 — App: Keep Local Tombstone GC + Align Allowlist

> **Rewritten in plan review 6** (rulings **D73/D72/D77**): this phase no longer removes the finalize purge.
> The existing purge is **correct local-GC semantics** — at finalize the session is complete (all local
> changes uploaded, all server changes applied), so tombstones older than the session start are spent
> propagation records. It was only hazardous pre-plan because raw-name ids could collide with engine-side
> tombstones (the incident); D2/D23 timestamped ids make that class impossible by construction, the engine
> side is repaired (1-2), and multi-device lag is covered by the purge floor (D76 / 4-5).

## Objective

Keep the local GC, align its table list to the 35 registered sync tables (D72), keep the orphaned-memory
sweep (D77), and ship the app placeholder migration 000046 (parity with 1-2's engine-local `sync_gc_state`).

## Context (from investigation 2026-09-05; re-scoped review 6)

- `cleanupSoftDeletedRecords()` (`src/services/SyncService.ts:1551-1612`), called from `handleSyncFinalize()`
  (~1527; verified single caller) — **kept**. Its 33-table list misses `emotion_state`/`lifecycle_state`
  (D72 aligns to 35).
- Its order already documents the entities-before-profiles RESTRICT reasoning (`:1554-1562`) — keep the
  comment, and adopt the engine's full child-first order (1-2 step 1) so both sides delete in the same
  dependency order.
- Its per-table try/catch log-and-continue (`:1598-1610`) already has the right failure semantics — keep.
- `cleanupOrphanedMemories` (`src/database/sync.ts:477-499`, call site `SyncService.ts:1533`) — **kept**
  (D77; mirrors engine 1-2 — sweeps memories whose referencing interactions are purged/gone).
  `cleanupOrphanEntityModuleMappings` (`sync.ts:431-465`) — keep as-is (a soft updater of live rows whose
  parent is tombstoned; not a delete).
- Incident re-framing: the local purge destroyed the ghost reservation for a **raw-name** id
  (`entityIdExists("Isabella")` → false → reuse). Post-2-2 a recreate mints `Isabella-<ts>` — collision
  impossible by construction. Engine-side, the repaired GC (1-2) clears its tombstones on its own finalize
  cadence; if the app's watermark ever lags the engine's purge floor, 4-5's rebuild handles it.

## Implementation Steps

1. **Keep** the finalize call + function. **Align the table list** to the engine's 35 (add `emotion_state`,
   `lifecycle_state`) and adopt the same dependency order as 1-2 step 1 (entity children → `entities` →
   `character_profiles` → `character_image` → provider configs → module configs).
2. **Placeholder migration `000046`** (comment-only no-op, binding description: *"Placeholder — engine
   counterpart 000046 adds engine-local `sync_gc_state` (tombstone-GC purge floor); the app needs no schema
   change."*) — same pattern as 3-2's 000045 (runner records the version; comments strip to zero
   statements).
3. **Drop all previously planned removal work**: no function deletion, no test inversions —
   `__tests__/integration/sync.personaCascade.integration.test.ts:251-279` (asserts one-cycle purge)
   **stays as-is** and becomes the regression lock for the kept GC.
4. **Kept from the old phase** (still worth doing):
   - Inbound-resurrect test over the pre-GC window: `applyBufferedSyncData` applying an update with
     `deleted_at: null` over a local tombstone → row live again (engine payload requirements owned by 1-1:
     always carry the `deleted_at` key; D29 `updated_at` bump).
   - Delete `applySyncRecord` (`sync.ts:370-422`) — test-only dead code (single test caller suite:
     `src/database/__tests__/repositories/syncApplyNewTables.test.ts:28` — delete/rewrite with it). Unchanged
     from the old phase; dead code is dead code.
5. **Note for executors**: a force-full re-pull may re-materialize tombstones the app already purged (the
   engine holds them until ITS GC runs) — harmless; they re-purge at the next finalize. Never any
   id-collision effect post-2-2.

## Files to Modify

- `src/services/SyncService.ts` (table list + order alignment only)
- `src/database/migrations/000046_sync_gc_state_placeholder.ts` (comment-only SQL template string —
  review 7 format fix, same as 3-2's 000045) + `src/database/migrations.ts` import + array entry

## Tests

- Purge eligibility: tombstones older than session start purged; newer retained (personaCascade suite stays
  green as the regression lock).
- Table-list parity: app GC list == `SYNC_TABLES` (`SyncService.ts:81-122` — review-7 location pin) ==
  engine `registeredSyncTables` (fixture; 6-1 tie-in).
- Inbound resurrect over local tombstone (`deleted_at: null`) → live row (targets `applyBufferedSyncData`,
  the REAL apply path).
- Placeholder 000046 records its version and executes nothing.

## Codebase Mapping Consulted

`harmony-ai-app/.planning/codebase/`, `.current_work/persona-card-alignment/3-1-RN-Findings.md`, plan
review 6 (D69–D78).

## Checklist

- [ ] Table list aligned to 35 + dependency order parity with engine (D72/D73)
- [ ] Orphan-memory sweep call retained (D77); `applySyncRecord` dead code deleted
- [ ] Placeholder 000046 shipped (D11 parity pattern)
- [ ] Inbound-resurrect + list-parity tests green; personaCascade suite stays green as the GC regression lock; phase doc updated
