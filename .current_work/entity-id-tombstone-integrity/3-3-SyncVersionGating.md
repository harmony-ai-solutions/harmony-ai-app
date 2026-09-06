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
      `serverUpdateRequired` is a **sticky** state that (a) suppresses reconnect scheduling and on-connect
      `initiateSync`, and (b) starts a **slow background re-probe** (~10 min, constant) that re-handshakes
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
- **D57: while sticky, auto-reconnect and on-connect sync are suppressed and no handshake loop occurs;
  the slow re-probe recovers automatically after a (simulated) engine update.**

## Checklist

- [ ] Constants defined both repos (engine min 2 at the single deploy; app 2 post-rebuild)
- [ ] Engine reject path + payload (extends existing `SYNC_REJECT`)
- [ ] App gate + user-facing state (net-new union member + badge state)
- [ ] Optional-field backward semantics covered by tests
- [ ] Both suites green; phase doc updated
