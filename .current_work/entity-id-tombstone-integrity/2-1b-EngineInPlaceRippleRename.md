# 2-1b — Engine: Remove Legacy Rename + Delete-Side Runtime Guards (D22 Owner)

> **Rewritten in plan review 3** (user-ruled 2026-09-06, ruling **D22**): the audit proved a runtime in-place
> PK rewrite is impossible in-transaction under FKs ON — no `ON UPDATE CASCADE` on any `entities(id)` FK
> (verified in DDL and live `sqlite_master`), and `PRAGMA foreign_keys` is a no-op inside a transaction
> (`database/migrations.go:190-194`; the codebase's own migration runner documents and works around it).
> Rather than ship FK-off machinery for a feature D2/D14 had already made pointless, **runtime id-rename is
> removed entirely**. This phase is now the removal plus the delete-side runtime guards previously bundled
> with rename (D16/D27/D24). Supersedes D8/D12 and D16's rename half.

## Objective

Ids are immutable for life: delete the broken create-copy-tombstone rename path end-to-end, and give
**delete** the runtime guard + teardown it was missing. Together with 2-1's derived-only creation (**D23**)
this closes ledger **N4 by removal** — no code path can target a ghost id with a rename, because no rename
exists. "Rename" from now on means an **alias edit** (`updateEntity`), everywhere.

## Binding Rulings

- **D22 — no runtime id-rename:** management `POST /api/entities/:id/rename`, controller `RenameEntity`
  (`entity_controller.go:478-527`), and the FE rename dialog (removed in 2-3) are deleted.
- **D27 — disconnect-release fix + guard predicate:** the non-phone WS disconnect branch
  (`handler_websocket.go:80-82`) gains `RemoveSession(h.handlerId)` — today it only calls
  `eventProcessor.Shutdown()` and `RemoveSession` has **zero production callers** (a real leak independent
  of the guard). The delete 409 blocks on `Active || (Suspended && within TTL)` sessions (phone sessions
  suspend — stay in `entitySessions`, resumable for a 5-min TTL, `session.go:639-667` — and still hold
  the id; `GetActiveSessions` includes them).
- **D24 — shared zombie teardown (helper owned here, used by 1-1 — review 6: the 5-1 restore caller is
   deleted with Phase 5):** stop runners + emotion engines +
   clear `sharedCognition` for the id. **`StopBeatRunner` (`lifecycle/service.go:223`) and
   `RemoveEmotionEngine` (`:85`) already exist with zero production callers — call them; do NOT add new
   APIs**. `sharedCognition`
   (`session.go:148`, populated at 229-238) is never cleaned today — include it.
   **Home (review 5 — the controller home is an import cycle):** the helper lives in `eventserver`, NOT
   `database/controllers` — `lifecycle` imports controllers (`lifecycle/runner.go:16`,
   `lifecycle/beat_memory_provider.go:8`), so controllers can never import `lifecycle`, and
   `sharedCognition` is private to `eventserver.EntitySessionManager`. Shape: a method on
   `HarmonyLinkEventServer` composing `lifecycleService.StopBeatRunner` + `RemoveEmotionEngine` + a new
   exported `RemoveSharedCognition(entityID)` on the session manager; management delete reaches it via
    the eventserver handle. Wire into:
    management delete (here), sync-apply delete (1-1).

## Implementation Steps

1. **Delete the rename path:** route + handlers (`management/routes_entities.go:487-514`, incl. the blanket
   500s at 507-509), `RenameEntity` in `database/controllers/entity_controller.go` (and any
   handler/service wrappers, e.g. `config/db/handler.go:281-286` rename plumbing). FE service/store/dialog removal
   is owned by 2-3. `openapi.yaml` never documented rename — nothing to remove there.
   **Engine test collateral to delete with it (review 4):** `routes_entities_test.go:53` (route
   registration), `:122-135` (`TestHandleRenameEntity_UserRejected`), and
   `entity_controller_test.go:766-807` (`TestRenameEntity_PreservesEntityType`).
2. **Delete 409 guard (D16/D27):** `409 "entity has active sessions"` on `DELETE /api/entities/:id` while
   the id has `Active` or `Suspended`-within-TTL sessions (predicate helper in `eventserver/session.go`;
   note `GetActiveSessions` at `session.go:339-356` includes suspended — filter by status, not presence).
   **Review-4 implementation note:** `GetActiveSessions` returns `[]SessionInfo{DeviceType, HandlerID}`
   (`session.go:350-353`) — no Status, no `SuspendedAt`, so it **cannot express the predicate**. Iterate
   `GetEntitySessions` (`session.go:244-248`, full `*EntitySession`) instead and reuse the TTL expression
   verbatim from `FindResumableSession` (`session.go:689`: `time.Since(s.SuspendedAt) <
   SessionSuspendTTL`). The 30s cleanup tick (`session.go:52`) means an expired-suspended entry can linger
   up to 30s — the TTL check is mandatory, not defensive.
3. **Disconnect release (D27):** one line in the non-phone branch of `handler_websocket.go:80-82`.
4. **Shared zombie teardown helper** (D24): `StopBeatRunner` + `RemoveEmotionEngine` + `sharedCognition`
   clear; call from management delete, and expose for 1-1's sync-apply delete.
5. **Vector note (D22):** no `Relocate` API — renames no longer exist, and 3-1's one-time re-embed is
   accepted (summary Risks).
6. **Delete-cascade completion — D26 + D17 engine side (review 7; the work 5-1's deletion orphaned —
   1-2 step 11 and summary D41 already point here):** `DeleteEntity` (`entities.go:160-222`) grows
   from 6 to **8 children** — add `chat_conversation_settings` (keyed `entity_id`, never
   `participant_key` — one entity spans many conversations) and `lifecycle_state` — and ALL stamps
   unify under **one captured UTC second-truncated `now`** ("9 stamps, one captured `now`": entity row
   + 8 children), replacing today's per-statement `CURRENT_TIMESTAMP` (`entities.go:162-206` stamps
   each table independently). Every cascade UPDATE gains `AND deleted_at IS NULL` (never re-stamp an
   already-tombstoned child); partner-side mirror `interactions` rows stay excluded. The persona-delete
   route's profile delete routes through the same captured `now` (D17). Share the captured-now helper
   seam with D25's sync-delete unification (1-1) — one helper, not two. Purpose (review 6): complete
   tombstoning is what lets the repaired GC (1-2) purge whole families — `chat_conversation_settings`
   rows that never tombstone can never be purged and ghost-render app-side (D18's filters only hide
   tombstoned rows).

## Files to Modify

- `management/routes_entities.go` (rename route deleted; delete 409)
- `database/controllers/entity_controller.go` (`RenameEntity` deleted)
- `eventserver/` (teardown helper — D24 home per review 5; `handler_websocket.go` disconnect release;
  `session.go` status predicate + `RemoveSharedCognition`),
  `lifecycle/service.go` (call existing stop/remove — no new APIs)
- `database/repository/entities/entities.go` (DeleteEntity → 8-child cascade + one captured `now` —
  D26/D17, step 6)

## Tests (extend the management suite; `routes_entities_test.go` currently 33, package 39)

- Rename endpoint gone → 404/405 (route registration test or HTTP probe); FE static trace sends no rename (2-3).
  **Rename test collateral deleted (step-1 list — review 4).**
- Delete with `Active` session → 409; with only expired-`Suspended` → proceeds.
- Non-phone WS disconnect → session removed from `entitySessions` (leak regression lock).
- Delete → runner/emotion-engine/cognition state stopped (teardown exercised via the shared helper).
- Delete → entity + all 8 children tombstoned with ONE identical second-truncated stamp (settings +
  `lifecycle_state` included — D26/D17); an already-tombstoned child keeps its original stamp.

## Checklist

- [x] Rename endpoint + controller path + FE wiring deleted (FE side in 2-3)
- [x] Delete 409 guard (Active || Suspended-within-TTL)
- [x] Non-phone disconnect releases the session (D27 leak fix)
- [x] Shared zombie teardown helper wired into delete / sync-delete (1-1)
- [x] Delete cascade grown to 8 children + one-captured-`now` stamping incl. persona-route profile
      delete (D26/D17 — step 6, review 7)
- [x] Tests green; phase doc updated with deviations

## Implementation Notes (deviations)

1. **Captured-now helper placement (step 6 / D25 seam):** `DeleteStampNow() time.Time`
   lives in `database/repository/entities/delete_stamps.go` — the `entities` repository
   package. That is the import-safe common denominator for both consumers named in the doc:
   `entities.go` is in the package, and `eventserver/synchronization.go` already imports
   `database/repository/entities` (no import cycle either direction). 1-1's per-table
   delete-op unification (D25) can import the same package from the interaction/memory/
   conversation repos without cycles (those repos import only `database/models` today, and
   `entities` imports only `database/models`). Not placed in `database/models` because that
   is the data-shape package (no logic precedent), and not a new top-level util package
   because the doc explicitly allowed "a repo-level or shared util".
   `DeleteEntity` returns the captured stamp (`(time.Time, error)`) so the persona route can
   thread the SAME now into the profile delete (D17) — this keeps "one helper, not two".

2. **Signature changes required by the D17 shared-now threading:**
   - `entities.DeleteEntity` / `controllers.DeleteEntity` now return `(time.Time, error)`.
     All callers adapted (hldb facade discards the stamp; sync-apply `synchronization.go:1409`
     adapted with a comment that 1-1 wires the shared teardown + D25 stamps through it — the
     doc's "do not modify synchronization.go's delete branches yourself" was respected: this
     is a compile-required mechanical adaptation only, no semantic change to the branch).
   - `characters` repo gained `DeleteCharacterProfileAt(tx, id, now)`; the internal
     `deleteCharacterProfile` takes `now`; the standalone public wrappers pass
     `time.Now().UTC().Truncate(time.Second)` inline (they are standalone profile deletes,
     NOT part of the shared entity-family cascade — the D17 shared-now requirement is
     satisfied by the persona route receiving the stamp from `DeleteEntity`). The characters
     repo deliberately does NOT import `entities` for the helper (avoids a peer-repo
     dependency); the shared-now threading is value-based.
   - `controllers.DeleteCharacterProfileAt` added as a thin wrapper for the route.

3. **409-guard predicate home (step 2):** `HasBlockingSessions(entityID)` is a method on
   `EntitySessionManager` (eventserver/session.go), implemented over `GetEntitySessions`
   with the TTL expression verbatim from `FindResumableSession`
   (`time.Since(s.SuspendedAt) < SessionSuspendTTL`) per the review-4 note. The management
   handler checks it nil-safely (handlers wired without a session manager — the existing
   unit-test pattern `handleDeleteEntity(c, nil)` — skip the guard).

4. **Teardown helper (step 4 / D24):** `RemoveEntityRuntimeState(entityID)` is a method on
   `HarmonyLinkEventServer` (eventserver/server.go) composing the EXISTING
   `lifecycleService.StopBeatRunner` + `RemoveEmotionEngine` and the new exported
   `EntitySessionManager.RemoveSharedCognition`. No new lifecycle APIs. The 409 guard means
   management delete only reaches teardown when no blocking session exists; 1-1's sync-apply
   call site is unchanged (seam only — the doc's "do not modify synchronization.go's delete
   branches yourself" honored).

5. **Test placement:** the doc's "extend the management suite" header is honored where the
   eventserver handle is reachable, but two test groups necessarily live in the eventserver
   package (private-field access): the disconnect-release leak lock (step 3) and the
   teardown-helper test (step 4). The 409/one-now/persona-shared-now tests are management
   HTTP tests; `setupManagementEventServer` builds a real `HarmonyLinkEventServer` via
   `eventserver.Init` (the only exported constructor) with a temp DataDir — RSA keygen adds
   ~0.5–1.3s per guard test, acceptable. The 8-child/one-now + already-tombstoned-child
   behavior is additionally locked at the repo level
   (`TestDeleteEntity_ReturnsCapturedNowAndStampsFamily`).

6. **Test collateral deleted:** `routes_entities_test.go` rename route registration +
   `TestHandleRenameEntity_UserRejected`, `entity_controller_test.go`
   `TestRenameEntity_PreservesEntityType` — replaced by `TestRenameEndpointGone` (404 lock).

7. **`DuplicateEntity` untouched** as instructed — the duplicate derivation path
   (`ResolveEntityID` + `ResolveAliasCopy`) is unchanged.

8. **No contradictions found** — all doc file:line claims matched codebase reality (minor
   line drift only, e.g. `session.go:689` TTL expression is at 688-689; `GetActiveSessions`
   at 339-356; `StopBeatRunner` at 223; `RemoveEmotionEngine` at 85).
