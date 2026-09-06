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
- **D24 — shared zombie teardown (helper owned here, used by 1-1/5-1):** stop runners + emotion engines +
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
   management delete (here), sync-apply delete (1-1), restore (5-1).

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
   clear; call from management delete, and expose for 1-1's sync-apply delete and 5-1's restore.
5. **Vector note (D22):** no `Relocate` API — renames no longer exist, and 3-1's one-time re-embed is
   accepted (summary Risks).

## Files to Modify

- `management/routes_entities.go` (rename route deleted; delete 409)
- `database/controllers/entity_controller.go` (`RenameEntity` deleted)
- `eventserver/` (teardown helper — D24 home per review 5; `handler_websocket.go` disconnect release;
  `session.go` status predicate + `RemoveSharedCognition`),
  `lifecycle/service.go` (call existing stop/remove — no new APIs)

## Tests (extend the management suite; `routes_entities_test.go` currently 33, package 39)

- Rename endpoint gone → 404/405 (route registration test or HTTP probe); FE static trace sends no rename (2-3).
  **Rename test collateral deleted (step-1 list — review 4).**
- Delete with `Active` session → 409; with only expired-`Suspended` → proceeds.
- Non-phone WS disconnect → session removed from `entitySessions` (leak regression lock).
- Delete → runner/emotion-engine/cognition state stopped (teardown exercised via the shared helper).

## Checklist

- [ ] Rename endpoint + controller path + FE wiring deleted (FE side in 2-3)
- [ ] Delete 409 guard (Active || Suspended-within-TTL)
- [ ] Non-phone disconnect releases the session (D27 leak fix)
- [ ] Shared zombie teardown helper wired into delete / sync-delete (1-1) / restore (5-1)
- [ ] Tests green; phase doc updated with deviations
