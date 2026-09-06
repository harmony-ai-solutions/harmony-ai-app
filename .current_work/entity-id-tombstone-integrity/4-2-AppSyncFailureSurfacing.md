# 4-2 — App: Surface Sync Insert Failures + Conflict Recovery

## Objective

Stop swallowing entity-push failures before entering a doomed chat session, and surface conflicts cleanly
(simplified per D13: typed errors + critical mode + alert; **no auto-recovery machinery** — genuine
conflicts are near-impossible after Phases 1–2, and a retry re-derives a fresh id).

## Context (from investigation, 2026-09-05)

- `sendSyncDataWithConfirmation` (`SyncService.ts:~1263-1409`) rejects on `SYNC_DATA_CONFIRM status=ERROR`;
  `sendLocalChangesSequentially` catches → `emit('sync:error')`; `syncAndWait` resolves **best-effort** on
  error (`SyncService.ts:603-647`); `openCharacterChat` proceeds anyway
  (`CharacterChatService.ts:138-141`, "Auto-sync before chat failed (non-critical)").
- Result: INIT_ENTITY into `entity_not_defined`, permanent "Connecting…" (see 4-3).

## Implementation Steps

> **Rewritten per ruling D13 (review-2):** the auto-recovery machinery (re-derive + local id-ripple
> rewrite + re-push) is **dropped**. Phases 1–2 make genuine conflicts near-impossible (derived ids +
> 1-1's ghost-aware apply resurrect instead of erroring); a user retry re-derives a fresh id at a new
> second. This phase's job: stop swallowing failures and stop entering doomed sessions.

1. **Typed sync errors**: classify confirm-error payloads (conflict/unique-violation vs. transient) using
   the structured `error_code` field added engine-side in 1-3 (today the confirm path is string-only —
   `SyncService.ts:1408-1411` rejects with `new Error(payload.error_message || 'Sync failed')`). Introduce
   `SyncConflictError` (entity table + offending id); fall back to plain `Error` when no code rides the
   payload (old engine).
2. **`syncAndWait` semantics (corrected + D34 — review 3)**: add `critical: true` mode used by chat-open
   and persona-save that **rejects** (instead of resolving) on `sync:error` for the pre-chat entity push.
   Keep the old best-effort mode for background syncs. **Corrected caller map (review 3):** the plan's
   `EntitySessionService.ts:1744`/`2085` are `initiateSync()` calls, not `syncAndWait`; the real
   `syncAndWait` callers are `CharacterChatService.ts:139`, `recoverInitEntity` (`:1859`),
   `PersonaEditScreen.tsx:814`, and `ChatDetailScreen.tsx:2008` (scenario restart — previously
   unlisted). **D34 — gate the shared wait:** all callers share one wait-promise
   (`SyncService.ts:606-608`), so a critical caller attaching to a background-initiated best-effort
   sync must still get a rejection — when any critical waiter exists, the *shared* wait rejects on
   error. This composition (on-connect background sync + user taps a chat) is the common case and
   precisely the incident's timing. **Also handle the send-failure path:** a rejecting `initiateSync`
   throw is currently swallowed (`SyncService.ts:652-654`) — critical mode must reject there too, and
   must not leak into `recoverInitEntity`'s background recovery (keep that call best-effort).
   **D55 (review 4 — closes the incident's wizard variant):** the `createdNewEntity`-only guard
   (`CharacterChatService.ts:138`) leaves wizard-created entities unprotected — `CreateAIScreen.tsx:1225`
   is fire-and-forget `initiateSync` + `goBack()` (`:1233`), so an entity created via the wizard and
   opened later from the Characters list has **zero** critical wait between local save and INIT_ENTITY.
   Ruling (user): **sync must be fully executed before INIT_ENTITY, always** — `openCharacterChat` runs
   a `critical` syncAndWait whenever the entity has unsynced local changes, predicate
   **`entity.updated_at > last successful full-sync watermark`** (per-source `getLastSyncTimestamp`;
   both inputs exist, no new persisted state; the wait resolves only on a COMPLETE sync round incl.
   finalize — `syncAndWait`'s existing completion semantics). Clean entities (pulled, or already
   synced) skip the wait — zero added latency. The same predicate covers duplicates
   (`duplicateAIPartner` → open) and any future creation path.
    *(Review-4 pattern note: no app-wide error taxonomy exists — model `SyncConflictError` on the
    `MarketplaceError` precedent, `src/services/marketplace/MarketplaceService.ts:245-266`: typed Error
    with `{ table, entityId, code }`, plain-`Error` fallback when the payload lacks `error_code`.)*
    **Review-5 pin (D55 completion — re-verify after resolve):** the watermark stores the session's
    START time (`SyncService.ts:1513` ← `:536`), so the dirty predicate over-triggers safely — but the
    WAIT can resolve on the wrong round: `runSyncAndWait` attaches to any in-flight session
    (`:649-654`) and `initiateSync` no-ops under the `:491-497` guard, so a round whose upload capture
    (`:1473`) already ran completes "successfully" WITHOUT the just-created entity — the incident's
    timing, narrower. In critical mode: after the wait resolves, re-evaluate the predicate; if still
    dirty, run ONE more fresh round (bounded ≤2 — post-resolve `currentSession` is null, so round 2 is
    guaranteed fresh); still dirty after the bound → the failure-alert path below.
3. **User-facing failure**: on final failure show an actionable alert (i18n): "Couldn't set up the AI
   (sync conflict). Please try again." — with the session **not** started (prevents the stuck UX at the
   source). A retry re-runs the creation flow → fresh derived id → succeeds.

## Files to Modify

- `src/services/SyncService.ts` (typed errors, `critical` mode incl. initiateSync-throw path)
- `src/services/CharacterChatService.ts`, `src/screens/CreateAIScreen.tsx` (critical mode wiring, failure UX)

## Tests

- Conflict on push → `SyncConflictError` surfaced → alert shown, no navigation, no session created.
- Retry after conflict → fresh derived id → success path proceeds to chat.
- Non-critical background syncs unchanged (best-effort resolve).
- Critical mode also rejects when `initiateSync` itself throws.
- **D55: wizard-created entity opened later — dirty-watermark predicate triggers the critical wait and
  the engine has ingested the entity before INIT_ENTITY; clean entity (pulled / already synced) skips the
  wait (no latency regression).**
- **Review-5: in-flight-round race — entity created after an in-flight round's upload capture; the
  critical wait resolves, the predicate is re-checked, and one bounded second round pushes the entity
  before INIT_ENTITY (D55 completion).**

## Checklist

- [ ] Typed sync errors (structured `error_code`; string-only fallback)
- [ ] `critical` syncAndWait mode (opt-in; initiateSync-throw covered) + failure alert
- [ ] **D55: critical-wait-on-dirty-watermark at chat open (wizard/duplicate paths covered; full-round
      completion before INIT_ENTITY)**
- [ ] No auto id-rewrite/ripple machinery (dropped per D13)
- [ ] Tests green; phase doc updated
