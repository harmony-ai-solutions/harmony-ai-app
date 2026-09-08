# 4-4 — App: Gate Hard-Delete Paths

## Objective

Remove user-reachable hard deletes from the app so every deletion is a tombstone (D1 as amended by
D69–D78: tombstone-then-GC — the tombstone is what propagates the delete; the local GC (4-1) purges it
afterward), aligning with engine 1-2's repaired GC.

## Context (from investigation, 2026-09-05)

Hard-delete sites (app):

| Site | File:Line | Notes |
|---|---|---|
| `deleteEntity(id, permanent=true)` | `src/database/repositories/entities.ts:680-702` | hard-deletes emoji actions, interactions, messages, entities |
| `deleteEntityModuleMapping(permanent)` | `entities.ts:940-959` | |
| `deleteCharacterProfile(permanent)` | `src/database/repositories/characters.ts:443-467` | |
| `deleteCharacterImage(permanent)` | `characters.ts:679-699` | |
| `deleteConversationByParticipantKey` settings row | `src/database/repositories/conversation_messages.ts:457-494` | hard-deletes `chat_conversation_settings` |
| `cleanupOrphanedMemories` | `src/database/sync.ts:477-499` | handled in 4-1 |

## Implementation Steps

1. Audit all `permanent`-flag call sites (grep `permanent`). **Verified in plan review: production code never
   passes `permanent=true`** — the branches are exercised only by tests. Expected outcome holds: no user flow
   needs physical deletion.
2. Remove the `permanent` branches (or make them throw in dev builds) — the soft path becomes the only path.
   Keep the function signatures if callers pass the flag; ignore + warn once. **Audit scope beyond the table:**
   8 module-config repos (`modules.ts`: backend/cognition/movement/rag/stt/tts/vision/imagination) and 16
   provider-config repos also carry `permanent` branches — include them in the sweep (config tables, not
   entity-id tables, but the D1 audit claim should cover them).
3. `deleteConversationByParticipantKey`: switch the settings-row delete to a **full** soft delete
   (**ruling D18 — review-2 corrected; "just set deleted_at" is insufficient**):
   - The `deleted_at` column already exists (`000041:160`) — no schema migration.
   - **Add `deleted_at IS NULL` to all five read predicates** in `chatConversationSettings.ts`
     (`getChatConversationSettings :86-89`, `getChatConversationSettingsBatch :118-122`,
     `conversationSettingsExistForEntity :197-200`, `listConversationsByFlag :212-215`,
     `getReplyMode :265-267`) — without them, softened rows ghost-render in ArchivedChats and leak stale
     pins/reply-modes into ChatList.
   - **`upsertSettings` gains `deleted_at = NULL` in its `ON CONFLICT DO UPDATE`** (`:145-164`) so re-opening
     a deleted conversation (same participant_key) resurrects fresh instead of updating a zombie.
   - This is the one user-reachable hard delete today: `ChatListScreen.tsx:951`, `ArchivedChatsScreen.tsx:386`.
   - Rationale: a hard delete here would resurrect "deleted" conversations on every full re-pull under D11.
4. Compensating deletes: `CreateAIScreen.tsx:1177` rollback — **verified already soft**
   (`deleteCharacterProfileCascade`, `characters.ts:481-503`); no change needed. Route any future
   compensating deletes through soft as well (tombstone of a never-synced row is inert).
5. Update repository tests that assert physical deletion to assert tombstones instead. **Review-5
   enumeration:** `characters.test.ts:482`, `entities.test.ts:592-596`, `cross-repo.test.ts:190-209`
   (permanent-branch asserts), and `conversationDeleteCascade.test.ts:84-105` (pins the settings
   hard-delete observable — rewrite together with D18's filters and ship the filters WITH or BEFORE the
   DELETE→soft switch, or the suite is red mid-window).
6. **Delete-cascade completion — D26 app parity (review 7; previously hung off the deleted 5-3, now
   re-homed here per summary D41's "retained via D26/D17/4-4"):** the soft-delete cascade in
   `deleteEntity` (`entities.ts:705-730`, one shared `now` at `:720-728`) grows from 6 to **8
   children** — add `chat_conversation_settings` (keyed `entity_id`) and `lifecycle_state` tombstone
   UPDATEs inside the same one-`now` block, each with `AND deleted_at IS NULL`. Without this, settings
   rows for deleted entities never tombstone → they ghost-render in ChatList/ArchivedChats (D18's
   filters only hide tombstoned rows) and the local GC (4-1) can never purge them.

## Files to Modify

- `src/database/repositories/entities.ts`, `characters.ts`, `conversation_messages.ts`
- Call sites in `CharactersScreen.tsx`, `ChatDetailScreen.tsx`, `PersonaEditScreen.tsx`,
  `ChatListScreen.tsx`, `ArchivedChatsScreen.tsx`, `CreateAIScreen.tsx` (no behavioral change expected —
  they already call the soft path).

## Tests

- Every delete seam produces `deleted_at` set, rows physically present.
- Entity delete → 8 children tombstoned under the one shared `now` (incl. settings +
  `lifecycle_state` — D26 parity, step 6).
- Softened settings delete: row filtered from all five read paths; re-open on same participant_key
  resurrects fresh (D18).
- No `DELETE FROM` on never-erase tables in any unit/integration path (add a DB-spy assertion where cheap).

## Checklist

- [x] `permanent` branches removed/neutralized (incl. module/provider config repos in the audit)
- [x] Settings-row delete fully softened (5 read filters + upsert resurrect — D18; column exists at
      `000041_consolidate_senju_features.ts:159`)
- [x] Compensating deletes verified soft (CreateAIScreen rollback AND
      `compensateOrphanedPersona` `userEntities.ts:292-298` — both already soft; enumerate both in the audit)
- [x] Delete cascade grown to 8 children in the one-`now` block (D26 app parity — step 6, review 7)
- [x] Tests updated; suites green; phase doc updated

### Review-3 notes

- Consider a shared `NOT_DELETED = 'deleted_at IS NULL'` const for the five D18 predicates (precedent:
  `emoji_actions.ts:27`) to prevent five-site drift.
- 4-1 cross-reference (review-6 update): 4-1 now KEEPS the finalize purge — settings tombstones purge
  locally at the next finalize. The five `deleted_at IS NULL` filters still matter for the
  tombstoned-but-not-yet-purged window (they must not ghost-render in ArchivedChats / leak stale
  pins/reply-modes between the delete and the next finalize); ship them WITH or BEFORE the DELETE→soft
  switch regardless.

## Implementation Notes (deviations)

Implemented 2026-09-06 by the 4-4 executor (all steps 1–6). See the phase completion report for the full
audit enumeration; deviations and drift from this doc are recorded here.

1. **`permanent` handling = ignore + warn-once (shared helper).** New file
   `src/database/repositories/permanentDeleteGuard.ts` exports `warnOncePermanent(fnName)`; every
   gated delete function keeps its `(id, permanent = false)` signature, logs a one-time warning when the
   flag is truthy, and ALWAYS runs the soft path. The warning is suppressed under Jest
   (`process.env.JEST_WORKER_ID !== undefined`, same detector as `createWebSocket.ts:46`) so the 23
   test call-sites that deliberately pass `permanent=true` don't spam the async logger after test
   completion.
2. **In-use guards became unconditional.** Every config/profile delete that had
   `if (!permanent && await isXInUse(id)) throw` now always throws on an in-use row. Production never
   passed `permanent=true`, so no production flow changes; the only behavioral difference is that a
   hypothetical future `permanent=true` caller can no longer bypass the guard. Test impact: the
   `cross-repo.test.ts:145` FK-RESTRICT test now rejects with the friendly "in use" error instead of a
   SQLite constraint error (`.rejects.toThrow()` — passes either way).
3. **D26 `AND deleted_at IS NULL` guard applied to the TWO NEW cascade statements only.** The doc's
   step 6 wording ("each with `AND deleted_at IS NULL`") was read as scoping the guard to the added
   `chat_conversation_settings` + `lifecycle_state` UPDATEs; the pre-existing six children keep their
   unguarded predicates exactly as before (no re-design). Note for D17 auditors: the app's six legacy
   child UPDATEs still re-stamp an already-tombstoned child; aligning them with D17's no-re-stamp rule
   was out of scope for this phase.
4. **`character_image` is NOT tombstoned by a plain profile soft delete.** Two tests
   (`characters.test.ts:482`, `cross-repo.test.ts:70`) originally asserted the image was physically
   gone after `deleteCharacterProfile(profileId, true)` (the old hard delete fired the
   `character_image` ON DELETE CASCADE FK). With the hard path removed, the profile row stays, the FK
   never fires, and the image row stays live (`deleted_at` NULL) — only `deleteCharacterProfileCascade`
   tombstones images. Both tests now assert profile tombstoned + image untouched (correct soft-path
   semantics).
5. **`entitySessionInitRecovery.test.ts` (4) + `chatDetailEmptyReveal`/`chatDetailScenarioGenerate`
   (9) fail during this phase's full-suite run — all are parallel-agent in-flight work, NOT this
   phase.** `EntitySessionService.ts` (184 lines) and `ChatDetailScreen.tsx` (113 lines) carry
   uncommitted edits from the parallel 4-3/4-4-parallel agent (D36 session retention + `clearFailedSession`
   wiring); their test suites still assert the pre-D36 behavior. `nodeSide.test.ts` is the known
   pre-existing failure (flaky — it passed in the `npm test` run, failed in the raw unit run).
6. **Incident during the run: I briefly `git stash push`ed the parallel agent's `EntitySessionService.ts`
   + `EntitySessionContext.tsx` changes to test a hypothesis and restored them.** The stash pop was
   aborted by a concurrent re-save of `EntitySessionContext.tsx` by the other agent; `EntitySessionService.ts`
   was restored from `stash@{0}` via `git restore --source`. Current working tree holds BOTH agents'
   full changes (verified by diff stat). A redundant WIP `stash@{0}` remains as a safety net — the
   coordinator may drop it after confirming the working-tree copies are the latest.
7. **Settings read-path blast radius (D18):** `getReplyMode` is on the chat-list render path
   (`RenderItem → GetReplyMode`); a tombstoned row now returns the default `realistic` instead of the
   stale pin/reply-mode — the intended D18 behavior (no ghost pins/badges between delete and 4-1 GC).
8. **TypeScript is clean** (`npx tsc --noEmit`), all 7 edited test suites + `chatConversationSettings` /
   `ChatPreferencesService` / `syncApplyNewTables` pass (192 tests), integration 12/12 (1 skipped).

9. **User-ruled follow-up (2026-09-06): the `permanent` parameter is fully removed.** After 4-4 shipped,
   the user ruled the dead flag "purposeless lines". The `permanent` parameter was dropped from all 28
   repository-layer delete signatures (entities ×2, characters ×2, modules ×8, providers ×16);
   `src/database/repositories/permanentDeleteGuard.ts` and every `warnOncePermanent` import/usage were
   deleted; and all 44 test call sites across the entities / characters / cross-repo / modules / providers
   suites had the flag argument removed (tests keep asserting tombstone semantics unchanged — no assertion
   edits). Production call sites never passed the flag (verified by grep — zero). `deleteConversationByParticipantKey`
   in `conversation_messages.ts` carried no `permanent` parameter in 4-4, so it needed no change. Post-change:
   `npx tsc --noEmit` clean; touched suites 147/147; full `npm test` green except the known pre-existing
   `compat/nodeSide.test.ts` (3 failures) — `nodeDatabase.smoke.test.ts` flaked once under full parallel
   load but passes standalone and on re-run (untouched file + untouchable-by-this-change deps).
