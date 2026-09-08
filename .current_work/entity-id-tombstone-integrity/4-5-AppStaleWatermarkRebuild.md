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

- [x] Signal handled → wipe flag persisted + app restart (review 7); boot runs the D61 wipe; D58 label
      shows; no new wipe code
- [x] One-shot loop-safety (re-flag after rebuild logs + surfaces, never restart-loops)
- [x] Version-gate precedence verified (3-3 interplay)
- [x] Tests green; phase doc updated

## Implementation Notes (deviations)

**Restart mechanism chosen: `react-native-restart` (v0.0.29), installed as a runtime dependency.**
Setup evidence: the app is BARE React Native, not Expo — `package.json` scripts use the
`react-native` CLI (`react-native run-android` / `run-ios`), there is no `expo` dependency, and native
projects exist at `android/` (`android/settings.gradle`, `android/gradle.properties` with
`newArchEnabled=true`) + `ios/` (`HarmonyAIChat.xcodeproj`). v0.0.29 was verified before choosing:
it supports BOTH architectures (TurboModule spec `RNRestartSpec` + `codegenConfig` for New Arch —
this app has New Arch enabled; Android native module extends the codegen `NativeRNRestartSpec`),
Android performs a **true process termination + rebirth via ProcessPhoenix** (`RestartModule.java`
→ `ProcessPhoenix.triggerRebirth`), and the iOS podspec uses `install_modules_dependencies` so it
wires both architectures. This is the closest-to-PROCESS restart available for bare RN (the
Expo-managed `Updates.reloadAsync()` fallback is not applicable — no Expo). The native side requires
a rebuild (`gradlew` / `pod install`) after adding the dependency — not verifiable in this
environment (no device build); documented in `src/services/AppRestart.ts` and here.

**`react-native-restart` optional-peer wrinkle:** its `react-native-windows` peer is declared
`peerOptional`, but npm 7+ ERESOLVE still refuses resolution (it resolves `react-native-windows@*`
→ a version whose own peer is `react-native@0.84.1`, conflicting with this app's `0.86.0`). The
dependency was installed with `npm install --force` (NOT `--legacy-peer-deps`, which was tried first
and reclassified the peer tree — `peer:true` → `dev:true` — AND pruned RNTL's `test-renderer` peer,
breaking 37 test suites to RUN). `--force` produced a minimal 17-line lockfile addition and
reconciled the tree correctly (including restoring `test-renderer`). The lockfile diff vs. HEAD is
exactly the `react-native-restart` entry.

**Loop-guard state:** in-memory (no new persisted schema), owned by the wipe-flag module:
`runWipeRebuildIfPending` sets `rebuildCompletedInProcess = true` on a SUCCESSFUL boot wipe (after
the flag clears; a failed wipe leaves it false so a later signal still restarts), exposed via
`hasRebuildCompletedInProcess()`. `SyncService.handleRebuildRequired` consults it BEFORE setting the
flag/restarting: a re-signal in the SAME process lifetime logs + emits `sync:error` (the existing
diagnostic toast surface — no new UI wiring) and never restart-loops. A fresh process starts with the
marker false, so the legitimate first occurrence (post-restart re-flag) is treated correctly. This is
the only touch to the 3-2 module beyond set-only usage (additive exports only; the wipe machinery
itself is untouched).

**Signal handling placement:** `handleSyncReject` in `SyncService.ts` (both SYNC_REJECT and
SYNC_REQUEST-with-ERROR route here), before the 3-3 version-gate branch. The rebuild path is async
(fire-and-forget `void this.handleRebuildRequired(payload)`) and returns before the generic path —
no `sync:rejected` toast (the rebuild label is the only UX). It does NOT emit `sync:aborted` either
(a process restart tears everything down; no waiters need settling in production).

**Ordering / crash-safety:** flag persist (`await setWipeRebuildFlag()`) strictly precedes
`restartApp()`; both are independently caught/logged. If the persist fails, NO restart happens (a
restart without the flag cannot wipe; the next sync round retries). If the restart throws (e.g.
native module absent), the flag is already persisted → next natural launch wipes. Pinned by tests.

**3-3 precedence (verified explicitly):** while `serverUpdateRequired` is sticky, `initiateSync()`
short-circuits at its top → no SYNC_REQUEST → no rebuild signal can arrive in response. Belt-and-
braces: `handleRebuildRequired` also ignores an out-of-band signal while sticky. A signal after the
gate clears (engine updated + accepted handshake) fires the rebuild normally. Both pinned by tests.

**3-3 drift (adapted, per rules):** the `syncVersionGating.test.ts` case
"reason=rebuild_required flows through the generic path untouched (4-5 specializes it later)" was
rewritten to the new behavior (not the version gate, not the generic path; wipe flag persisted).

**Fresh installs:** exempt engine-side (empty `synced_tables` → no signal) — no app special-case,
noted only.

**Pre-existing condition found (not introduced):** `npx tsc --noEmit` reports ONE error in the
COMMITTED file `src/screens/__tests__/MarketplaceItemDetailScreen.test.tsx:181` (TS7006 implicit
`any` on `screen.root!.queryAll(n => ...)`). The file is unmodified in the working tree and the error
comes from node_modules type resolution — unrelated to 4-5 and to all uncommitted phases. All files
touched by 4-5 type-check clean.
