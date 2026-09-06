# 4-5 — App: Stale-Watermark Rebuild (Purge-Floor Reaction)

> **Created in plan review 6** (ruling **D76**; engine counterpart in 1-2 step 4). The engine GC is
> deliberately un-gated (D69a — this-device session trigger only), so a device whose watermark lags behind
> an engine purge holds stale live rows the engine can no longer correct (the tombstones are gone; a later
> edit would re-push them as fresh inserts — silent resurrect via 1-1's plain-insert path). The engine flags
> such devices at SYNC_REQUEST; this phase is the app's reaction.

## Objective

When the engine signals `rebuild_required`, the app performs the existing one-time wipe + full re-pull —
reusing 3-2's persisted wipe flag and D61's boot-window machinery. **No new wipe code.**

## Implementation Steps

1. **Handle the signal** (shape agreed with 1-2/3-3 — typed `SYNC_REJECT` reason `rebuild_required` or a
   `rebuild_required: true` accept field): abort the in-flight sync attempt (send nothing), then
   **set the 3-2 one-time wipe flag and RESTART THE APP PROCESS** (review 7, user-ruled — e.g.
   `react-native-restart`; new dependency). On the next boot, D61's boot-window machinery runs the
   wipe naturally: flag check inside `DatabaseContext.initializeDb` → wipe + D19 prefs sweep →
   clear flag → init DB → the on-connect `initiateSync` performs the full pull — the
   "**Rebuilding from Soulbits Engine…**" label (D58/D61) rides the loading screen for the duration.
   The wipe + first pull are exactly the D11 flow. **Why restart (review 7):** a mid-session re-init
   would wipe under mounted, querying screens with the lazy `syncDb` handle open and SyncService
   in-memory state live — the exact race class D61 was ruled to kill; the process restart tears all
   of it down by construction (open WS, DB handles, in-memory sync state, active entity sessions).
   **Crash-safety:** persist the flag BEFORE invoking the restart — if the restart call itself
   fails, the next natural app launch still performs the wipe. No reconnect-suppression machinery
   is needed on the trigger side (the process dies before any reconnect could fire); 1-2's
   "engine never tears down the WS" pin stands.
2. **One-shot semantics:** treat the signal as once-per-occurrence — after the wipe, the first full pull
   advances the watermark past the floor, so the engine will not re-flag. **Loop guard (review 7 restart
   shape):** the flag is cleared by the boot wipe, so a re-flag after a completed rebuild can only mean the
   rebuild genuinely failed to advance the watermark — if the signal arrives again post-rebuild, do NOT
   restart again; log + surface a diagnostic error instead (defensive; the D76 invariant makes this
   unreachable). The engine never tears down the WS on this signal (1-2 pins it) — moot under restart,
   kept as the engine-side pin.
3. **Fresh installs are exempt engine-side** (empty `synced_tables` → no signal) — no app-side special
   case.
4. **Accepted loss (same class as D11):** local-only rows created since the device's last successful sync.
   A flagged device is by definition behind the engine; the loss window is its offline delta only. Log the
   trigger for diagnostics; the rebuild label is the only UX.
5. **Ordering vs. 3-3's version gate:** a device can be both stale-watermarked and version-gated — the
   version gate wins first (`serverUpdateRequired`); the rebuild fires after the engine is updated and the
   handshake is accepted. Verify this precedence explicitly.

## Files to Modify

- `src/services/SyncService.ts` / `src/contexts/SyncConnectionContext.tsx` (signal handling where
  SYNC_REQUEST responses are consumed; flag set + restart invocation)
- 3-2's wipe-flag module (set-only usage; the wipe machinery itself is untouched)
- `package.json` (+ the restart dependency, e.g. `react-native-restart`)

## Tests

- Mocked response carrying the signal → session aborted (no SYNC_DATA sent), wipe flag persisted, restart
  invoked (mock the restart module); next boot runs the D61 wipe and clears the flag; D58 label shows for
  the duration.
- Flag persisted BEFORE the restart call (a crash between the two → the next natural launch still wipes).
- Signal during an established session: orderly abort only — the WS is closed by the process restart, not
  torn down by the engine.
- Post-rebuild first sync pulls normally; no repeat signal (watermark ≥ floor); a re-flag after a completed
  rebuild logs + surfaces instead of restarting (loop guard).
- Precedence: stale engine + stale watermark → `serverUpdateRequired` first (3-3 interplay).

## Checklist

- [ ] Signal handled → wipe flag persisted + app restart (review 7); boot runs the D61 wipe; D58 label
      shows; no new wipe code
- [ ] One-shot loop-safety (re-flag after rebuild logs + surfaces, never restart-loops)
- [ ] Version-gate precedence verified (3-3 interplay)
- [ ] Tests green; phase doc updated
