# 4-1 — App: Stop Hard-Purging Never-Erase Tables

## Objective

Restore the D1 invariant app-side: tombstones persist locally forever. Removes the purge that destroyed the
local ghost reservation and defeated the ghost-aware id guard in the incident.

## Context (from investigation, 2026-09-05)

- `cleanupSoftDeletedRecords()` (`src/services/SyncService.ts:1551-1612`), called from `handleSyncFinalize()`
  (~line 1527; verified single caller), physically `DELETE`s tombstoned rows across **33 tables** (1562-1594)
  whenever `deleted_at < currentSession.startTime`. Note the list **excludes `emotion_state` and
  `lifecycle_state`** despite both being soft-deletable sync tables. Documented in
  `.current_work/persona-card-alignment/3-1-RN-Findings.md:96`.
- Consequence in the incident: local tombstones for `Isabella`/`Isabella 2` were purged at 11:12:44 →
  `entityIdExists("Isabella")` → false → raw-name reuse → engine PK collision (N1).
- Ghost guard to protect: `entityIdExists` (`src/database/repositories/entities.ts:375`) +
  `resolveNextEntityIdCopy` (`entities.ts:405`).

## Implementation Steps

1. **Remove the purge invocation** from `handleSyncFinalize` (delete the call; keep or remove the function —
   prefer removing `cleanupSoftDeletedRecords` entirely to prevent accidental reuse; tombstone retention is now
   the design). *(Review-4 confirmation: the function's 33-table list has already drifted from
   `SYNC_TABLES`' 35 — removal-entirely is the right call; no shared constant exists to keep in sync.)*
2. **Verify inbound resurrect support (verified in plan review — mostly a no-op + two hard requirements)**:
   `applyBufferedSyncData`'s existence lookup (`SyncService.ts:1028`) has **no deleted filter** and the UPDATE
   column set is dynamic (`Object.keys(record)` minus PK, 1073-1079) — so an inbound update over a local
   tombstone is NOT dropped and `deleted_at: null` **does** resurrect. The two real requirements are
   engine-side: (a) sync-out payloads must always carry the `deleted_at` **key** (JSON `null`, never omitted —
   an omitted key leaves the local tombstone untouched), and (b) the engine restore/resurrect must bump
   `updated_at` ≥ the local tombstone's `updated_at`, or the LWW gate (`SyncService.ts:1069`) silently drops
   the resurrect. Both are specced in 1-1/5-1; add the app-side test regardless: inbound update with
   `deleted_at: null` over a local tombstone → row live again.
3. **Tombstone-aware reads stay as-is** (repositories already filter `deleted_at IS NULL` — **review-3
    correction: the exception is `chat_conversation_settings`, none of whose five read predicates filter
    today; D18/4-4 fixes them — cross-reference so the 4-1↔4-4 window doesn't ghost-render stale
    pins/reply-modes**).
4. **Storage sanity**: tombstones now accumulate locally (small rows). Confirm no query does unfiltered
   `SELECT *` growth pathology on hot tables (`conversation_messages` tombstones are the biggest volume —
   verify chat list queries filter `deleted_at IS NULL` and messages are paginated).
5. **Orphan cleanup parity (corrected in plan review)**: `cleanupOrphanedMemories` (`src/database/sync.ts:477-499`)
   is a hard `DELETE FROM memories` called from `handleSyncFinalize` (`SyncService.ts:1533`) — remove that call
   (mirror of engine 1-2). `cleanupOrphanEntityModuleMappings` (`sync.ts:431-465`) is **NOT a hard delete** —
   it soft-updates live mapping rows whose parent entity is tombstoned (predicate: `e.deleted_at IS NOT NULL
   AND emm.deleted_at IS NULL`, 438-440; `UPDATE … SET deleted_at` at 456-457), i.e. it operates exactly on
   non-tombstone rows → **keep it** as-is.

## Files to Modify

- `src/services/SyncService.ts` (remove finalize purge; update-path `deleted_at` handling)
- `src/database/sync.ts` (orphan purge call sites)

## Tests

- Sync finalize with tombstones → rows still present, no DELETE issued.
- **Rewrite (review 3):** `__tests__/integration/sync.personaCascade.integration.test.ts:251-279`
  *asserts* the purge today (`getEntity → null`, `COUNT(*) = 0`, "purges persona-cascade tombstones in
  ONE cycle") — it MUST be inverted into a D1 retention assertion (rows present, `deleted_at` set) as
  part of this phase, or the suite fails. Also rewrite `entities.test.ts:877-939`, which pins the
  space-joined backstop (`'Max' → 'Max 2'`) that 2-2 replaces with `nextFreeDerivedId`.
- Inbound update resurrect (`deleted_at: null`) over local tombstone → live row — target
  `applyBufferedSyncData` (the REAL apply path), NOT `applySyncRecord` (`sync.ts:370-422`) which is
  test-only dead code (single test caller) — delete it in this phase's cleanup. **Review-5:** deleting
  `applySyncRecord` breaks its only caller suite —
  `src/database/__tests__/repositories/syncApplyNewTables.test.ts:28` — delete/rewrite that suite with
  the function.
- Ghost guard integration: tombstoned `Isabella-…` blocks raw id reuse; recreate derives suffixed id.

## Codebase Mapping Consulted

`harmony-ai-app/.planning/codebase/`, `.current_work/persona-card-alignment/3-1-RN-Findings.md`.

## Checklist

- [ ] Finalize purge removed (single call site; function removed to prevent reuse)
- [ ] Inbound resurrect test added (mechanism verified working; engine payload requirements tracked in 1-1/5-1)
- [ ] Orphan purges aligned with D1 (memories call site removed; mapping fixer kept — it is soft)
- [ ] Tests green; phase doc updated
