# 4-3 — App: Fix Stuck "Connecting…" / Splash Dead-End

## Objective

Make terminal entity-session failures recoverable in the UI instead of an infinite amber "Connecting…" dot and
a never-revealing splash. (Hotfix-grade; independent of the ID-schema phases.)

## Context (from investigation, 2026-09-05)

- `failInteractionSession` (`EntitySessionService.ts:1816-1836`) removes the session; `EntitySessionContext`
  initialization timer logs "Initialization timeout: session … no longer exists" and **does not retry**
  (`EntitySessionContext.tsx:217-220`); `isSessionActive` false forever.
- `ChatDetailScreen.tsx:2196-2200`: `connectionState = isConnected ? (isSessionActive ? 'connected' : 'connecting') : 'offline'`
  → permanent `connecting` (amber pulsing dot, `chatDetail.json:95`).
- Splash: `isReadyToShow` requires `hasRealContent || isKnownEmpty`; `hasFirstMes` only set from INIT_ENTITY
  SUCCESS payload (`has_first_mes`) → stays `null` → splash persists (`ChatDetailScreen.tsx:134-137, 2253-2261`).
- Recovery loop today: `handleInitEntityResponse` ERROR branch (`EntitySessionService.ts:1756-1807`),
  `recoverInitEntity` re-sync + resend (max 2), then give-up; context retry scheduler
  (`scheduleRetry`, `isRetryableError` — `EntitySessionContext.tsx:250-357`).

## Implementation Steps

1. **Terminal failure state (D36 — review 3)**: `EntitySessionContext` gains a per-session `failed`
   status (distinct from absent) with the last error; set by `failInteractionSession` instead of
   deleting silently. **Two deletion sites exist (review 3)** — the service's `failInteractionSession`
   (`EntitySessionService.ts:1823`) AND the context's `handleSessionError`
   (`EntitySessionContext.tsx:118-125`), which deletes the entry after the service emits `session:error`;
   the context must **keep flagged entries**. **A THIRD site (review 5, D65): the own-entity WS
   disconnect handler deletes the session with no marker and no `session:error`
   (`EntitySessionService.ts:442-448`; ChatDetail does not listen to `session:stopped`, so it sticks at
   amber `connecting`) — per D65 it must STOP deleting and retain the entry so the retry/timer machinery
   below sees it. `closeAllSessions` (app-background `:262`; sync-loss `EntitySessionContext.tsx:66-72`)
   also wipes entries — evaluate the same retention during implementation (flagged, not ruled).** One source of truth: a `failed` marker on
   `InteractionSession`; Retry replaces the entry. Verified safe to retain: `isSessionActive`
   (`:396-404`) returns false for a retained failed session, so no ChatDetail gate misfires, and only
   ChatDetail consumes context session state in production.
2. **ChatDetail error surface**: when session `failed`:
   - `connectionState` gains `'error'` → red dot + label (i18n `chatDetail.json`).
   - Show an inline banner/card: "Couldn't connect to {name}. [Retry] [Back]" — **reuse the existing
     `disabledBanner` visual (`ChatDetailScreen.tsx:2724-2730`) and the existing `session:error`
     listener (`:887-915`) rather than new machinery**; Retry re-invokes `startInteractionSession`.
     Back pops navigation.
   - **Splash reveals on error** (`isReadyToShow` includes `sessionFailed`) — no more indefinite overlay.
   - **Union-member touchpoints (review 3, exhaustive):** the ternary at `:2196-2200`, the dot render
     `:2265-2303` — the final `else` at `:2290` currently swallows unknown states into the grey
     offline dot with `statusOffline` a11y — and the a11y labels at `:2270/:2286/:2294` (new
     `statusError` key). Prefer extracting the mapping into a pure helper shared by ternary/dot/pulse
     (`:2205`) so the 4-state mapping is unit-testable in one place.
3. **Retry-scheduler fix**: when the init timer fires and the session is gone/failed, schedule one context
   retry (existing 3-attempt budget) instead of silently stopping; exhaust → `failed` state (above).
   **Review-4 wiring fix (activates the terminal path D36 targets):** retry-exhaustion currently emits
   `session:error` with the retry-map **key** — the participant key, `EntitySessionContext.tsx:272-273`
   ("use a generic key") — but ChatDetail's listener matches on **interactionId**
   (`ChatDetailScreen.tsx:890`), so the terminal error never surfaces and no `failed` marker gets set.
   Exhaustion must mark the interactionId-keyed session entry `failed` (and/or emit with the real
   interactionId). **Bounded retention (review 4):** clear the flagged entry on navigation-back or on
   the next `handleSessionStarted` for the same participant set — failed entries otherwise accumulate
   one per failed chat (in-memory only, but unbounded).
4. **`entity_not_defined` special-casing (D35 — review 3)**: classify via the structured `error_code`
   field added to the INIT_ENTITY ERROR payload in 1-3 (`entity_not_defined`, `entity_disabled`) —
   **NOT the current string-equality match** (`errorMessage === INIT_ENTITY_INGESTION_ERROR`,
   `EntitySessionService.ts:34/1777` — brittle against any engine copy change). If ingestion-related
   and recovery exhausted, hint in the banner: "The AI couldn't be found on Harmony Link — it may need
   to sync. [Sync now]" triggering `syncAndWait({critical:true})` then Retry.

## Files to Modify

- `src/services/EntitySessionService.ts` (failed status propagation)
- `src/contexts/EntitySessionContext.tsx` (status, retry scheduling, timer fix)
- `src/screens/ChatDetailScreen.tsx` (connectionState — the union `'connected' | 'connecting' | 'offline'`
  at 2196-2200 gains a net-new `'error'` member; banner; splash reveal — note the content path also requires
  `initialScrollTarget === 'bottom'`)
- `src/i18n/locales/en/chatDetail.json` (**en is the only locale** — verified; no other locale files exist)

## Tests

- INIT_ENTITY error → exhausted retries → session `failed`; ChatDetail renders error banner; splash revealed.
- **Exhaustion path surfaces in ChatDetail (interactionId-keyed emission — review-4 fix) and sets the
  `failed` marker; backing out clears the flagged entry.**
- Retry button → new session attempt → success path restores 'connected' + greeting flows.
- Unit: `connectionState` mapping; integration: session lifecycle transitions.

## Codebase Mapping Consulted

`harmony-ai-app/.planning/codebase/`, incident logcat traces (03:09 and 11:14 windows).

## Checklist

- [ ] `failed` session status + propagation
- [ ] Error banner + retry/back actions
- [ ] Splash reveals on error; connection dot 'error'
- [ ] Timer/retry scheduler fix
- [ ] i18n (en only); tests green; phase doc updated
