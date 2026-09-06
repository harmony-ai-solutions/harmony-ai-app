# 1-2 — Engine: Tombstone Purge Removal / Repair

## Objective

End the permanent tombstone accumulation / purge contradiction. Implements decision **D1** (tombstones are
never erased) and kills the recurring error:

```
Failed to clean up soft-deleted records after sync: failed to cleanup soft-deleted records in
character_profiles: FOREIGN KEY constraint failed
```

## Context (investigation 2026-09-05; call-site facts corrected in plan review)

- `CleanupSoftDeletedRecords` has exactly **ONE** call site in the repo: `eventserver/synchronization.go:1854`,
  inside `handleSyncFinalize` (the plan review found no second site — other references are the definition in
  `maintenance.go:32` and a test in `lww_test.go:202`).
- `database/repository/synchronization/maintenance.go:12-47` physically `DELETE`s tombstones across a **32-table**
  allowlist in order **`character_profiles` → `character_image` → `entities` → …**, aborting the whole loop on
  the first error (`maintenance.go:37-38`). Note: this allowlist ≠ `registeredSyncTables` (35 tables) —
  `emotion_state`, `lifecycle_state`, `memories` were never in the purge list (informational).
- `entities.character_profile_id → character_profiles(id)` is `ON DELETE RESTRICT`
  (`database/migrations/000001_initial_schema.up.sql:16-22`); soft-deleted entities still reference soft-deleted
  profiles → `character_profiles` purge always fails → **no table is ever purged** and tombstones accumulate
  indefinitely (verified live: `Isabella` tombstone from 2026-09-04 persists).
- This hard purge is itself a violation of the never-erase invariant (D1): even "repaired", it would recycle
  PK reservations differently on each side, recreating the ghost asymmetry from the incident.
- `DeleteOrphanedMemories` (`database/repository/memory/memory.go:169-184`, hard `DELETE`) has a single
  production call site: `synchronization.go:1862` (also inside `handleSyncFinalize`).
- `DeleteEmotionState` (`database/repository/entities/emotion.go:90-97`, hard delete) has **zero production
  callers** — only the test `emotion_test.go:191` invokes it. `SoftDeleteEmotionState` is the sync-path variant
  (`synchronization.go:1493`, `1496`).

## Implementation Steps

1. **Remove the tombstone purge for all never-erase tables** (D1): entities, character_profiles,
   character_image, entity_module_mappings, interactions, conversation_messages, memories, emotion_state,
   lifecycle_state, entity_emoji_actions, chat_conversation_settings, provider/module config tables.
   **Review-2 ruling (S4): delete outright, don't no-op.** Concretely:
   - Delete the single `CleanupSoftDeletedRecords` call site in `eventserver/synchronization.go:1854`, the
     function in `maintenance.go` (whole file), **and** its test (`TestCleanupSoftDeletedRecords`,
     `lww_test.go:156-202`) — D1 makes the function dead by definition; git keeps history.
   - Remove the `DeleteOrphanedMemories` call site (`synchronization.go:1862`; fn kept for a future explicit
     purge feature — out of scope). Orphan cleanup is a hard delete in the sync lifecycle (see 4-1/4-4 for the
     app side).
   - Convert `DeleteEmotionState` to a soft delete for consistency (or delete the function — only the test
     calls it; `SoftDeleteEmotionState` already exists as the sync-path variant). **Review-4: delete it
     outright** (with the `emotion_test.go:151-204` block that calls it) — cleaner than a soft-delete
     conversion since `SoftDeleteEmotionState` already exists and D25 unifies its stamping anyway.
   - **Dead-code sweep additions (D21-3):** delete `SoftDeleteEmojiActionsByEntity`
     (`emoji_action.go:76-80`, zero production callers) and `UpdateMemoryEndDate` (`memory.go:103-111`,
      test-only callers). Do NOT touch `DeleteEmojiAction` (`emoji_action.go:70`) — it is live in the
      sync-apply delete branch (`synchronization.go:1528`).
   - **`DeleteMemory` stays a hard delete — documented exception (D67, review 5):** `memory.DeleteMemory`
     (`memory.go:156-163`, `DELETE FROM memories WHERE id = ?`) has exactly one production caller — memory
     consolidation (`modules/cognition/memory_consolidator.go:426`), which hard-deletes promoted source
     rows after merging their content into the promoted memory (compaction by design; `rag/sync.go:41` is
     the same-named VECTOR-STORE deletion, not a DB call). Do NOT convert. Accepted + documented
     consequence (6-2 records it): no tombstone is produced and outbound sync can only emit existing rows
     (`GetChangedMemories`, `sync_utils.go:225`), so app devices retain the consolidated source memories
     indefinitely — the known D1 exception.
2. **Preserve the FK contract**: with the purge gone, the RESTRICT FK no longer fires in sync finalize; keep
   the constraint itself (it still guards management-API misuse).
3. **Storage note**: tombstones now grow forever by design (D1). Rows are small; images are the only heavy
   payload — verify `character_image` tombstones don't retain blob columns unnecessarily (if they do, null out
   the blob on soft delete in a follow-up migration — flag, don't block).
4. **Greeting semantics (revised per D9 — no guard change)**: `deliverDefaultGreetingIfDefined`
   (`eventprocessor.go:392-465`) guards via `HasPriorConversation` → `FindPriorInteractions`
   (`interaction/interactions.go:279-317`), which filters `deleted_at IS NULL` at every branch, as do
   `CountMessagesByInteraction` and `GetGreetingByInteraction`. **The guard stays live-only by decision D9**:
   tombstoned history is never user-visible, so a live-only guard is correct; resurrect ≡ restore (1-1/5-1)
   brings children back live, which is what suppresses duplicate greetings. Do NOT make the guard
   tombstone-aware (it would silently empty "clear chat"-style restarts). Restore-completeness is tested in 5-1.
5. **Cascade gap note (for 5-1) — amended by D26 (review 3), count fixed review 4**: `DeleteEntity`'s cascade
    (`entities.go:160-222`) tombstones 6 child tables today — mappings, emoji actions, memories,
    emotion_state, interactions, conversation_messages (by `entity_id`, **not** `sender_entity_id`).
    **D26 adds `chat_conversation_settings` and `lifecycle_state` to the cascade** (neither is tombstoned
    today; settings-staleness is the real user-visible bug D18 exists for, and the emotion/lifecycle
    asymmetry was indefensible). D17 becomes "**9 stamps, one captured `now`**" (entity row + **8**
    children — review-4 arithmetic fix; pre-D26 is entity + 6). Restore (5-1) mirrors the full 8-child set
    (emotion/lifecycle best-effort per **D53** — they are ephemeral, exempt from D1's never-erase, and their
    unconditional `INSERT OR REPLACE` apply (`emotion.go:16`, `lifecycle_state.go:104`) may legitimately
    overwrite their tombstones; documented alongside D21-4); the only remaining exclusion is partner-side
    mirror rows (the `user`-owned interaction).
   **Review-2 note (D17, owned by 5-1):** the cascade's UPDATEs each stamp their own `CURRENT_TIMESTAMP`
   today — 5-1 unifies them to one captured `now` (the equality matcher depends on it), and **D25
   (review 3) extends the unified stamping to all sync delete ops + `DeleteEmojiAction`'s missing
   `deleted_at IS NULL` guard**. **Runtime teardown (D24/D27, owned by 2-1b):** delete must stop
   runners/emotion-engines and 409 on active sessions — today it does neither.

## Files to Modify

- `eventserver/synchronization.go` (remove the two finalize call sites: purge at 1854, orphan-memories at 1862)
- `database/repository/synchronization/maintenance.go` (deleted outright, with its test)
- `database/repository/entities/emotion.go` (soft-delete conversion or removal; test-only caller)
- `database/repository/entities/emoji_action.go`, `database/repository/memory/memory.go` (dead-code
  deletions per D21-3)

## Tests

- Sync finalize with tombstones present → no error logged, tombstone rows unchanged.
- Soft-deleting an entity + profile pair → sync finalize succeeds (no FK abort).
- `DeleteEmotionState` tombstones or is gone (update `emotion_test.go:191` accordingly).

## Codebase Mapping Consulted

`harmony-link-private/.planning/codebase/`, memory-bank `systemPatterns.toon` ("All repository delete functions
now use UPDATE … SET deleted_at" — this phase realigns code with that documented pattern), plan review 2026-09-05.

## Checklist

- [ ] Purge call site removed / neutralized (single site, `synchronization.go:1854`)
- [ ] `DeleteOrphanedMemories` call site removed (single site, `synchronization.go:1862`)
- [ ] `DeleteEmotionState` soft-delete conversion or removal
- [ ] Greeting guard verified UNCHANGED (live-only, per D9) — no code change here
- [ ] Recurring FK error no longer appears in a fresh sync cycle (manual log check)
- [ ] Tests green; phase doc updated
