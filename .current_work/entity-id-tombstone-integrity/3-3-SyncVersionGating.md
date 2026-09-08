# 3-3 — Sync Schema Version Gating

## Objective

Prevent a migrated DB from syncing with an un-migrated peer (engine↔app either direction), which would
duplicate entities (old-id row + new-id row on either side). Implements **D6**.

## Context (verified in plan review)

- Sync handshake: app sends `HANDSHAKE_REQUEST` (device info; engine logs "Processing handshake request from
  device: …" at `synchronization.go:313`), then `SYNC_REQUEST`/`SYNC_START` (`handleSyncRequest`,
  `synchronization.go:397-549`).
- Engine `HANDSHAKE_ACCEPT` is built in `emitHandshakeAccept` (`synchronization.go:2260-2281`; payload
  `HandshakeResponsePayload` at 95-101 = `{message, jwt_token, wss_port, token_expires_at, server_cert}` —
  **no version field today**). App side: `requestHandshake` (`SyncService.ts:367-385`) sends device info only;
  `handleHandshakeAccept` (`SyncService.ts:425-467`) reads token/port/cert only.
- **`SYNC_REJECT` already exists** (`SyncRejectPayload`, `synchronization.go:128-133`: `reason`,
  `clock_drift_seconds`, `max_allowed_drift`, `message`; emitted at 417-429 and 512-522) — extend with a
  version field rather than inventing a message type.
- App connection states today: `'connected' | 'connecting' | 'preparing' | 'offline' | 'reconnecting' |
  'disconnected' | 'notPaired'` (`src/contexts/connectionStatusHelper.ts:10-17` — review-2 path correction;
  it lives under `contexts/`, not `utils/`) — `serverUpdateRequired` is genuinely net-new UI (extend
  `ConnectionStatusBadge`'s testID/a11y pattern, `ConnectionStatusBadge.tsx:27-41`; note the badge consumes
  raw booleans from `useSyncConnection` — it needs a new derived prop, not just a union member).
- Mixed versions would silently LWW-merge old-id and new-id rows into duplicates.

## D11 sequencing (binding — replaces the former D7 split)

- **Single engine deploy**: migration 000045 (3-1) + verbatim apply (1-1) + gate at minimum **2**; rejects
  version-1 clients (old apps) with `unsupported_schema_version`.
- **App release** (lands after the engine): performs the one-time wipe + rebuild (3-2), then advertises
  version **2**. Before its rebuild completes it is effectively v1 — the engine gate covers that window.
- An updated app (v2, post-wipe) meeting an **un-migrated engine** aborts with `serverUpdateRequired`.
  Note (D11): the wipe has already happened at that point — nothing is lost that isn't on the engine
  except the accepted offline window; update the engine and the app re-pulls. Ordering guidance:
  **engine first, app second.**
- Version 1 = pre-plan (implicitly, via absent field).

## Implementation Steps

1. **Define `SYNC_SCHEMA_VERSION`** — single integer, bumped by the id-pattern migration; value `2`
   (implicitly `1` = pre-plan). Both repos define the constant in their sync layer (engine: sync component
   constants; app: `SyncService`/protocol constants). Per D11 the engine ships at minimum 2 in the single
   deploy; the app ships at 2 (advertised once its rebuild completed).
2. **Engine-side gate** (authoritative):
   - Include `sync_schema_version` in `HANDSHAKE_ACCEPT` (`emitHandshakeAccept`, `synchronization.go:2260-2281`).
   - Reject `SYNC_REQUEST` from a client advertising a lower version with the existing `SYNC_REJECT` type
      carrying `reason: "unsupported_schema_version"`, `min_supported: <N>`, and a human-readable message
      (extend `SyncRejectPayload` at 128-133). Log at warn.
   - **Review-5 (cloud-mode hole):** cloud mode auto-registers + approves devices at `SYNC_REQUEST`
      WITHOUT a prior handshake (`synchronization.go:449-455`) — the gate MUST key on the version field
      carried in `SyncRequestPayload` itself (step 4), not on handshake state, or cloud peers bypass it.
      Test both paths (handshake and handshake-less cloud).
3. **App-side gate** (protects an updated app from an old engine):
   - On `HANDSHAKE_ACCEPT` (`SyncService.ts:425-467`), compare engine's advertised version; if engine < app's,
     abort sync with a user-facing state `serverUpdateRequired` ("Harmony Link update required — please update
     Harmony Link before syncing").
   - **Reject-reason mapping (review 7 — belt-and-braces; the accept-compare above is the operative
     v1→v2 path and is verified to cover cloud mode too, since the app handshakes there as well):**
     the existing `SYNC_REJECT` handler (`handleSyncReject`, `SyncService.ts:721-741`) special-cases
     `reason === 'unsupported_schema_version'` → enters the same sticky `serverUpdateRequired` state
     (suppression + slow re-probe) instead of the generic rejection notification. Forward-compat: a
     future v3 engine rejecting an already-shipped v2 app degrades to the actionable state, not a
     generic error.
   - **Review-3 plumbing note:** `connectionStatus` is *derived* by `computeConnectionStatus(...)`
      (`connectionStatusHelper.ts:39-120`, mode-branched cloud/selfhosted) — a new union member requires a
      **new input parameter** wired through `SyncConnectionContext.tsx:1024-1027`, inserted **before the
      mode branch** (the gate applies to both modes), not just a union extension at `:10-17`.
      `SyncSettingsScreen.tsx:309-310` maps `connectionStatus.textKey` 1:1 to `syncSettings.json` keys —
      add the key or `t()` falls back to the raw key. `notPaired` is the closest precedent
      (`SyncSettingsScreen:602-607` warning card; badge testID `connection-status-dot-not-paired`).
      **D57 (review 4) — the gate must NOT create a reconnect loop:** `SyncConnectionContext.tsx:310-312`
      auto-schedules reconnect on any disconnect and `:295` re-fires sync on connect, so a WS-teardown
      implementation would cycle connect → handshake → abort → reconnect forever. Instead,
      `serverUpdateRequired` is a **sticky** state that (a) suppresses reconnect scheduling and —
      **review 7 generalization: ONE choke point** — short-circuits `initiateSync()` at its top while
      sticky, covering ALL sync triggers (on-connect, token refresh `soulbitsTokenSync.ts:85`, session
      start `EntitySessionService.ts:1744`, screen and manual pulls; manual pulls land on
      SyncSettingsScreen's `serverUpdateRequired` status card rather than a generic error), and (b)
      starts a **slow background re-probe** (~10 min, constant) that re-handshakes
      — the app auto-recovers once the engine is updated (D11's "data re-pulls once the engine is
      updated"). The sticky state clears on an accepted version-≥-2 handshake.
   - `ConnectionStatusBadge` consumes raw booleans — needs the new derived prop (review-2 note stands).
4. **Version plumbing**: add the field to the handshake/sync event payloads on both sides (optional field —
   absence = version 1) so the gate degrades safely mid-rollout.
5. **Docs**: record the current version + bump policy (bump on any change that alters sync semantics of
   existing rows) in the sync docs + memory banks (6-2).

## Files to Modify

- Engine: `eventserver/synchronization.go` (handshake accept payload, SYNC_REQUEST gate, reject emitter),
  protocol/constants file.
- App: `src/services/SyncService.ts` (send version, evaluate accept, reject handling),
  `src/contexts/SyncConnectionContext.tsx` + `src/screens/settings/SyncSettingsScreen.tsx` (state UI),
  `src/components/settings/ConnectionStatusBadge.tsx` if needed.

## Tests

- Engine: SYNC_REQUEST with lower client version → SYNC_REJECT with reason; equal version → proceeds.
- Cloud-mode SYNC_REQUEST (no prior handshake, `:449-455`) is gated identically (review-5).
- App: handshake accept with lower engine version → sync aborted, `serverUpdateRequired` surfaced; equal → ok.
- Absent field treated as version 1 (both sides).
- D11 order simulation: engine-first rollout — old app rejected cleanly, wiped app rebuilds then advertises 2;
  app-before-engine mistake → `serverUpdateRequired`, recoverable by updating the engine (re-pull).
- **D57: while sticky, auto-reconnect is suppressed and `initiateSync` short-circuits for EVERY trigger
  (on-connect, token refresh, session start, manual) — no handshake loop and no error-notification spam;
  the slow re-probe recovers automatically after a (simulated) engine update.**
- **Review 7: `SYNC_REJECT` with `reason: unsupported_schema_version` → sticky `serverUpdateRequired`
  (not the generic rejection notification).**

## Checklist

- [x] Constants defined — **engine done** (`SyncSchemaVersion = 2`, `SyncSchemaVersionMinClient = 2`, `SyncRejectReasonUnsupportedSchemaVersion = "unsupported_schema_version"` in `eventserver/synchronization.go`); app done: `SYNC_SCHEMA_VERSION = 2` + `SERVER_UPDATE_REPROBE_INTERVAL_MS` exported from `src/services/SyncService.ts`
- [x] Engine reject path + payload (extends existing `SYNC_REJECT`; `SyncRejectPayload.MinSupported` → `min_supported`)
- [x] App gate + user-facing state — union member + plumbing DONE (app task): `ConnectionStatusLabel` gains `'serverUpdateRequired'`, context exposes `serverUpdateRequired: boolean`; badge/settings-card/i18n rendering DONE (UI task — see "3-3 APP UI task" notes below)
- [x] Reject-reason mapping + `initiateSync` choke-point short-circuit (review 7) — DONE (app task)
- [x] Optional-field backward semantics covered by tests (absent field = v1 → rejected; explicit v1 → rejected; v2 → proceeds; cloud-mode SYNC_REQUEST gated identically)
- [x] Engine suite green (`go build ./...`, `go vet ./...`, `go test ./... -count=1 -timeout 90s`); app suite green (141/142 — sole failure is the known `nodeDatabase.smoke` under-load flake, passes in isolation)

## Implementation Notes (deviations)

### App-side task (3-3 APP half — implemented)

**Territory:** `src/services/SyncService.ts`, `src/contexts/SyncConnectionContext.tsx`,
`src/contexts/connectionStatusHelper.ts`, tests. No edits to badge / settings-screen markup /
i18n JSON / EntitySessionService internals (the choke point covers its trigger via
`initiateSync`).

**Exact names the UI task consumes:**
- Union member / `ConnectionStatusInfo.textKey`: **`'serverUpdateRequired'`**
  (`ConnectionStatusLabel` in `src/contexts/connectionStatusHelper.ts`).
- `computeConnectionStatus` gained a 6th input parameter `serverUpdateRequired: boolean`,
  checked BEFORE the mode branch (applies to both cloud and selfhosted). Returns
  `{ textKey: 'serverUpdateRequired', color: '#f44336', variant: 'error', mode }`.
- Context: `useSyncConnection()` now exposes **`serverUpdateRequired: boolean`**
  (sticky-gate mirror; also present on the readOnly floating-chat provider).
- i18n: `syncSettings.json` (SyncSettingsScreen `getConnectionStatusText` → `t(connectionStatus.textKey)`)
  AND `settings.json` (SettingsScreen connection card, same 1:1 mapping) both need a
  **`serverUpdateRequired`** key ("Harmony Link update required — please update Harmony Link
  before syncing" copy) — until added, `t()` falls back to the raw key. Card markup/badge
  derived prop = UI task.
- `ConnectionStatusBadge` consumes raw booleans only — needs a new derived prop
  (e.g. `serverUpdateRequired` from `useSyncConnection`) in the UI task. Do not derive it
  from `isConnected`/`isPaired`/`isReconnecting` alone — the gate can be active while the WS
  is up.

**Sticky semantics implemented (D57/D83):**
- Sticky state owned by `SyncService` (single source of truth):
  - `getServerUpdateRequired()` public getter.
  - Entered by: (1) `handleHandshakeAccept` when engine `sync_schema_version` (absent ⇒ 1)
    < `SYNC_SCHEMA_VERSION`; (2) `handleSyncReject` with `reason === 'unsupported_schema_version'`
    (this path does NOT emit `sync:rejected` → no generic rejection toast; `rebuild_required`
    deliberately stays on the generic path for 4-5).
  - Cleared ONLY by an accepted handshake advertising version ≥ 2, which then re-kicks
    `initiateSync()` (D11 data re-pull).
  - Emits `'sync:server-update-required' (boolean)` and `'sync:server-update-probe-reconnect'` (connection down).
- **One choke point:** `initiateSync()` short-circuits at its TOP while sticky — covers all
  triggers (verified via gitnexus impact: 10 direct callers = on-connect
  `SyncConnectionContext.handleSyncConnected`, token refresh `soulbitsTokenSync.refreshAllAndSync`,
  session start `EntitySessionService.handleInitEntityResponse`/`handleIncomingUtterance`,
  manual `SyncSettingsScreen.handleSyncNow`/`handleForceFullSync`, `forceFullSync()`,
  `runSyncAndWait`, persona-delete `userEntities.firePersonaDeleteSync`).
- Context: `scheduleReconnect()` is a no-op while sticky (covers disconnected/error/heartbeat/
  init-failure paths in one place); the on-connect handler re-handshakes instead of syncing;
  a `serverUpdateRequired=false` event cancels pending reconnect timers.
- **Slow re-probe:** `SERVER_UPDATE_REPROBE_INTERVAL_MS = 10 * 60 * 1000` (named constant).
  Fires while sticky: connection up → `requestHandshake()` (engine's accept re-evaluates the
  gate); connection down → one-shot `sync:server-update-probe-reconnect` (context dials ONCE,
  no reconnect loop). Re-arms itself on the same cadence until the gate clears.

**Deviations / drift noted (app task):**
1. **Version advertisement (task item 5):** implemented the simple ALWAYS-SEND reading —
   the app sends `sync_schema_version: 2` in both HANDSHAKE_REQUEST and SYNC_REQUEST payloads
   unconditionally (the pre-rebuild v1-shaped window is covered engine-side by the absent-field
   rule per the doc). No app-side "advertise only post-rebuild" gating exists — the sync layer
   cannot know the wipe/rebuild state, and 3-2 owns that flag.
2. **Doc line refs drifted (as warned):** `handleHandshakeAccept` is at `SyncService.ts:633-699`
   (doc said ~425-467), `handleSyncReject` at ~830-870 (doc said ~721-741), the `initiateSync`
   choke point at the top of `initiateSync` (~719), session-start trigger is
   `EntitySessionService.ts:1866` not :1744. All behavior implemented per the doc's intent,
   not the stale line numbers.
3. **`requestHandshakeWithWait` callers** (pairing flow, `connectWithRefresh`) resolve the
   pending handshake BEFORE the version evaluation runs (the evaluation sits after
   `emit('handshake:accepted')` in `handleHandshakeAccept`). A v1 engine therefore still
   completes the handshake bookkeeping; only the SYNC attempt is gated — intended.
4. **`scheduleReconnect` suppression lives inside the function** (one guard) rather than at the
   individual call sites the doc cited (~:310-312 / heartbeat / error paths) — strictly stronger
   (covers init-failure and connectWithRefresh-failure paths too) with zero extra call sites.
5. **`runServerUpdateProbe` re-arms itself** while still sticky (periodic ~10-min cadence until
   recovery) — the doc's "starts a slow re-probe" read as periodic for true D11 auto-recovery;
   a one-shot probe would leave the app stuck if the engine update takes > 10 min.
6. **Read-only provider** (floating-chat second root) also mirrors the sticky gate
   (`SyncService.getServerUpdateRequired()` + event subscription) so both React roots show the
   same status.
7. **No real contradiction found** with the phase doc or D6/D11/D57/D83. The plan asserted the
   app handshakes in cloud mode (review-7 verification); the app side is covered by the
   accept-compare + reject-mapping exactly as written — no redesign attempted.

### 3-3 APP UI task (rendering the sticky gate — implemented)

**Territory:** `src/components/settings/ConnectionStatusBadge.tsx`,
`src/screens/settings/SyncSettingsScreen.tsx`, `src/screens/LandingScreen.tsx` (badge call site),
`src/i18n/locales/en/syncSettings.json`, `src/i18n/locales/en/settings.json`, plus new tests
`src/components/settings/__tests__/ConnectionStatusBadge.test.tsx` and
`src/screens/__tests__/SyncSettingsScreen.serverUpdateRequired.test.tsx`. No service/context files touched.

**What was implemented:**
- **Badge:** `ConnectionStatusBadge` gained a REQUIRED `serverUpdateRequired: boolean` prop;
  when true it renders the error-style dot (`theme.colors.status.error`, fallback `#f44336`),
  testID `connection-status-dot-server-update-required`, a11y label "Harmony Link update required".
  The gate takes precedence over connected/reconnecting/disconnected/notPaired — mirroring
  `computeConnectionStatus` (checked before the mode branch). The prop is deliberately NOT derived
  from `isConnected`/`isPaired`/`isReconnecting` inside the badge (the gate can be active while the
  WS is up); making it required keeps every call site compile-honest.
  **Usage audit:** the ONLY instantiation in the app is `LandingScreen.tsx` (header right slot);
  there is no badge usage in main settings / floating chat / readOnly roots. `LandingScreen` now
  sources `useSyncConnection().serverUpdateRequired` and passes it.
- **SyncSettingsScreen:** (a) status label: `serverUpdateRequired` textKey now resolves via the new
  i18n key (hero status + status-detail row); (b) warning card `server-update-required-card`
  (testID) rendered while sticky — same visual treatment as the `notPaired` warning card
  (`warningCard` style + `warningRow` + `alert-circle-outline` icon), copy explains the fix and that
  the device "will reconnect and resume syncing automatically once the update is installed"
  (the ~10-min re-probe); (c) BOTH manual sync buttons (Sync Now `sync-now-button`, Force Full
  Re-Sync `force-resync-button`) are visually disabled while sticky
  (`disabled={isSyncing || !isConnected || serverUpdateRequired}`) — the `notPaired` precedent
  disables via `!isConnected`; the choke point no-ops `initiateSync` anyway, so the buttons no
  longer pretend otherwise. Hero subtext also gained a sticky branch (see deviations).
- **i18n (en only):** `syncSettings.json` → `serverUpdateRequired` ("Harmony Link update required"),
  `serverUpdateRequiredWarning` (card copy), `heroSubtextServerUpdateRequired`; `settings.json` →
  `serverUpdateRequired` (SettingsScreen connection card maps `textKey` 1:1). No existing keys
  altered.

**Deviations / drift noted (UI task):**
1. **Card key structure:** used flat `serverUpdateRequiredWarning` (the file's warning-card
   convention — closest precedent `notPairedWarning`) instead of the suggested
   `serverUpdateRequiredCard.*` nested structure; the task deferred to "the file's card-key
   conventions" and every existing warning card in this file uses a single flat key.
2. **Extra key `heroSubtextServerUpdateRequired` + sticky subtext branch** (beyond the task's
   literal scope): while sticky the old subtext chain would render "Your data is in sync with
   Harmony Link" under the "Harmony Link update required" label — the gate can be active while
   connected, so that subtext chain is contradictory in this state. Followed the existing
   `heroSubtext*` naming convention.
3. **Line refs drifted as warned:** the `notPaired` card precedent sits at ~:613-622 in the current
   tree (doc said ~:602-607); the badge consumed `isConnected/isPaired/isReconnecting` at :16-41.
   Behavior matched per intent.
4. **Test harness (RNTL v14):** `render` is async in this repo's `@testing-library/react-native`
   version — tests `await render(...)` and assert ThemedButton disabled state via the repo-standard
   mock (`accessibilityState.disabled`), since RN's TouchableOpacity does not forward `disabled`
   to the host element. Screen tests resolve `t` against the REAL
   `en/syncSettings.json` so the 1:1 textKey→human-copy mapping is proven end-to-end (a missing
   key would render the raw key and fail).
5. **Verification evidence:** `tsc --noEmit` clean; badge suite 3/3, screen suite 3/3; full
   `npm.cmd test` → 1265 passed / 4 failed, the failures being ONLY the two documented pre-existing
   DB flakes (`compat/nodeSide.test.ts` ×3, `nodeDatabase.smoke.test.ts` ×1) which pass in
   isolation (28 DB suites / 367 tests green without load). Prior-phase suites
   (`syncVersionGating`, `connectionStatusHelper`) remain green. State-machine tests were written
   first and watched to fail for the right reasons (missing testID / card) before implementing
   (TDD).
6. **No real contradiction found** with the phase doc or the state machine's exposed API; the
   binding names (`'serverUpdateRequired'` textKey, `useSyncConnection().serverUpdateRequired`,
   error-variant color) matched the implementation exactly.

### Engine-side task notes (parallel — kept verbatim)

- **Gate placement:** the version gate sits INSIDE the sync-request transaction, after the unified approval gate and BEFORE the D76 purge-floor rebuild check (2a vs 2b). Rationale: schema compatibility is the most fundamental gate — a v1 client never reaches the DB-heavy rebuild logic, and D11's "migrated server never accepts un-migrated sync" is enforced most strictly. Emitted after the tx via the same flag pattern 1-2 established for the rebuild signal (`unsupportedVersion` + typed `SYNC_REJECT`), so the reject reason is never masked by the generic `device_unauthorized` tx-error path.
- **Existing-suite adaptation (required, semantically correct):** every existing test payload that drives `handleSyncRequest` and expects the normal sync flow now advertises `SyncSchemaVersion: SyncSchemaVersion` (v2) — 18 sites across `synchronization_test.go`, `synchronization_registration_test.go`, `sync_observability_test.go`, and the GC trio's `syncRequest` helper. This is mandatory: with the gate live, an absent field IS a v1 client and IS rejected (the D11 test asserts exactly that). Post-D11, any device that can receive a normal accept or the rebuild signal is a v2 app, so the test devices are now represented correctly. The rebuild-signal trio still fires `rebuild_required` (its devices advertise v2; the gate passes and the rebuild check runs unchanged) and my gate tests never trip the rebuild check (fresh devices, no purge floor).
- **`HandshakeResponsePayload.SyncSchemaVersion` uses `json:"sync_schema_version,omitempty"`:** the same struct backs the message-only `emitHandshakeReject`; without omitempty a handshake REJECT would advertise a spurious `0`, which the app's accept-compare could misread. On `HANDSHAKE_ACCEPT` the field is always set to 2, so the app sees it exactly as the wire contract pins.
- **`SyncRequestPayload.SyncSchemaVersion` uses `json:"sync_schema_version,omitempty"`** — absent/0 = version 1 on both sides (backward semantics; the gate normalizes `< 1` to 1 for the log/message and rejects).
- **`SyncRejectPayload.MinSupported`** → `json:"min_supported,omitempty"`; set only on `unsupported_schema_version`.
- **Reject message** is the "update required" phrasing the wire contract calls for; the app task owns surfacing its own copy (its `serverUpdateRequired` state string per the phase doc).
- **No production code outside `eventserver/synchronization.go` was touched**; `handleSyncFinalize`, the GC, and the apply path are untouched. No files under `database/` were modified (phase 3-1 parallel work untouched — I only read).
