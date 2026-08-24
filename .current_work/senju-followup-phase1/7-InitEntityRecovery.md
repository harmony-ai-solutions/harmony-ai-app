# Phase 7 — Track E: INIT_ENTITY Recovery

> The skipped test `src/services/__tests__/entitySessionInitRecovery.test.ts.skip` is the **complete executable spec** — read it FIRST and treat it as source of truth. This doc summarizes; the test asserts everything below including retry-cap and non-ingestion pass-through.
> Problem being fixed: CreateAIScreen syncs new entities fire-and-forget; opening chat before engine ingestion → engine rejects INIT_ENTITY with `entity_not_defined` → current code tears the session down instantly and context-level retries re-send WITHOUT syncing → fails identically forever ("Session initialization failed" on fresh partners).

## Implementation (in `src/services/EntitySessionService.ts`)

Insertion points (verified locations):
- `handleInitEntityResponse` — private method at ~line 1469; the ERROR branch currently tears down. Event routing for `event_type === 'INIT_ENTITY'` at ~line 1372–1374.
- `InteractionSession` interface (~line 31 region) — add `initRetryCount: number` (init 0) alongside existing session fields.
- `handleEntityConnectionError` — transport-error path (find via `session:error` emission).

Spec:
1. **ERROR branch, ingestion-class errors only** (error code `entity_not_defined`): do NOT tear down the session; increment `session.initRetryCount`.
2. **Recovery (fire-and-forget, non-blocking):** best-effort **blocking re-sync** (`SyncService.syncAndWait()`) → create a fresh entity connection for that entity → re-send `INIT_ENTITY`. Any throw inside recovery → log + fall through to teardown.
3. **Retry cap:** `MAX_INIT_ENTITY_RETRIES = 2` (named const). At/after cap → `session:error` + normal teardown.
4. **Non-ingestion errors** (anything not `entity_not_defined`): keep today's behavior (immediate `session:error` + teardown).
5. **Transport-error-storm guard:** `handleEntityConnectionError` must DEFER to the event-path recovery when the incoming error carries an app-level event with `error.event.event_type === 'INIT_ENTITY'`; genuine transport errors stay fatal.
6. Re-enable the spec: `git mv src/services/__tests__/entitySessionInitRecovery.test.ts.skip src/services/__tests__/entitySessionInitRecovery.test.ts` — the suite must pass unmodified (if the spec and reality legitimately conflict, STOP and surface the conflict; do not weaken assertions).

## Notes

- Dedup guards already present must compose: `InteractionSession.started` flag (duplicate `session:started` fix) and the register-before-send fix — recovery must not double-emit `session:started` (the test asserts exactly-one-per-start semantics).
- Purge interplay: recovery re-sync must respect `isPurging()` suppression (if mid-purge, fail fast → teardown path handles).
- Keep logging consistent with the existing `[EntitySession]`-style prefixes; each retry logs attempt count.

## Verification

- [ ] Re-enabled suite green: `npx jest --selectProjects unit --testPathPatterns entitySessionInitRecovery`
- [ ] Full unit + integration green (session suites: dedup, connection-id, monkey, stop, listener idempotency)
- [ ] `gitnexus_impact({target: "handleInitEntityResponse"})` before editing — expect callers in the event-routing path only; report blast radius before proceeding
- [ ] `gitnexus_detect_changes()`; commit: `feat: INIT_ENTITY ingestion-error recovery with bounded retries (Track E)`
- [ ] Manual smoke (user, on-device): create partner → immediately open chat → session recovers after brief connecting state instead of "Session initialization failed"
