# Phase 3-5 — Engine+App: Desktop-Sync Configuration Surface (LAN)

> **Repos:** `harmony-link-private` (engine REST control) + `harmony-ai-app` (settings screen)
> **Created:** 2026-10-12 (owner-approved gap fix: the new engine↔engine sync had no user-facing configuration path)
> **Depends on:** 2-3, 2-4 (sync machinery — landed), 3-2 (EngineApiClient/adapter layer — landed), 3-4 (old SyncSettingsScreen deleted; layouts recoverable from git HEAD)
> **Foundation for:** 7-3 (relay transport picker + QR pairing extend this screen)

## Objective

Give users a real configuration path for the changeset-v1 desktop↔phone sync: management-REST control of the engine's sync client (live reconfigure, status, handover) and an app settings screen that replaces the deleted rows-v1 `SyncSettingsScreen` in its navigation slot. LAN-only in this task; the Soulbits Cloud relay arrives as a second transport in Phase 7.

## Design

### 1. Engine — sync-client runtime controller + REST routes

**Runtime wiring (the missing piece today):** `cmd/run.go`'s `startSyncClient` builds the client from boot config and returns only a stop function — nothing holds a live handle. Introduce a small controller (e.g. `syncclient.Manager`: mutex-guarded current `*Client` + current `SyncClientConfig` + the store/eventserver references it needs) owned by the run path (desktop `cmd/run.go` and `cmd/engine-sidecar` via the shared composition, following the 4-1 `enginehost` pattern so the facade can reuse it later). The management server receives a reference the same way it holds `eventServer` today (additive field + setter/attach pattern in `management/server.go`).

Controller semantics (must respect 2-2/2-4 epoch rules — verify against `changesetstore` + `eventserver.AttachChangesetStore` behavior; **halt if a transition cannot be made coherent** rather than improvising):
- **Apply config** = Stop old client → persist merged `syncclient` block → recreate via `syncclient.FromConfig` → Start. Never recreate while a store operation is mid-flight (serialize through the controller mutex; the store pins the pool conn while recording).
- **Enable client role** → engine yields write authority (the existing yield-on-connect/pending-epoch path from 2-4's `enterClientMode`).
- **Disable client role** → stop client, re-acquire authority per the store's `Acquire` semantics. **Buffered-write safety rule:** if a pending epoch holds unacknowledged local writes, disabling must not silently drop them — keep the pending epoch intact (it survives until handover/baseline per 2-2) and surface `pending_writes` in status so the UI can warn. Do not force-merge.
- **Persist where:** the engine's `config.json` in the data dir (the existing mapstructure config surface — same file the desktop Wails app reads/writes). Sidecar boot merges flags over file defaults; the PUT only ever writes the `syncclient` block (never clobber other keys — read-modify-write the whole file). Verify the sidecar's config load actually reads the data-dir `config.json`; if it is flags-only today, make it load-then-merge so a PUT survives restart (small, contained change in the sidecar/enginehost config path).

**Routes (`management/routes_sync_client.go`, registered in the loopback-authed `/api` group like all app-facing routes):**

1. `GET /api/sync/client/status` →
```json
{ "enabled": bool, "state": "idle|pairing|connecting|pending_approval|rejected|syncing|promoted|backoff|stopped",
  "last_error": "string|null", "local_authoritative": bool, "baseline_path": "string|null",
  "dataset_id": "string", "pending_writes": int,
  "config": { "enabled": bool, "peer_address": "host:port", "peer_wss_address": "string",
              "security_mode": "secure|insecure-ssl|unencrypted", "device_name": "string",
              "device_type": "string", "device_platform": "string" } }
```
(state/last_error/local_authoritative/baseline_path from `Client.State()/LastError()/LocalAuthoritative()/BaselinePath()`; `dataset_id` from `syncclient.DatasetID`; `pending_writes` from the store's pending-epoch state; when the client is stopped, state="stopped" with the persisted config still returned)
2. `PUT /api/sync/client` — body = any subset of the `config` object above (≥1 field). Validate: `security_mode` enum; peer addresses `host:port`. Applies live per controller semantics + persists. Response: the status object (post-apply).
3. `POST /api/sync/client/yield` → `Client.Handover(ctx)` (authority handover to the peer). Response: `{"status":"ok"}` + state.
4. `POST /api/sync/client/disconnect` → stop the client but **keep `enabled=true` persisted** (a disconnect-for-now, distinct from disabling). Response: status object.

Tests per management conventions (in-process server + real store, reusing 2-4's two-engine test harness patterns): status shape, PUT enable→state transitions, PUT partial-merge + persistence round-trip (file written, other config keys untouched), disconnect vs disable, yield happy path, validation errors, auth matrix.

### 2. App — DesktopSyncScreen + client methods

- **Recover layouts from HEAD** (deleted by 3-4, uncommitted — intact): `git show HEAD:src/screens/settings/SyncSettingsScreen.tsx` and `git show HEAD:src/screens/setup/ConnectionSetupScreen.tsx`. Recycle visual structure, section styling, copy tone; **delete** old-protocol logic (sync estimates, table selection, wipe/rebuild, broker/provisioning states — they have no successor).
- New `src/screens/settings/DesktopSyncScreen.tsx` (nav slot where SyncSettingsScreen lived):
  - **Config section:** enabled toggle, peer address (host:port), optional peer WSS address, security-mode picker (secure / insecure-ssl / unencrypted, with one-line safety copy), device name (default: model name).
  - **Status card** (poll `GET status` ~2–5s while visible): state badge for all 9 states, `last_error`, authority indicator ("This device leads" / "Desktop leads"), dataset id, `pending_writes` warning when > 0.
  - **Pairing hint:** on `pending_approval` → "Waiting for approval on <peer>…" (the desktop's Wails pending-devices view is where approval happens — existing flow, no desktop work needed here).
  - **Actions:** connect (PUT enabled=true), disconnect (POST disconnect), disable sync (PUT enabled=false + pending-writes warning), hand over authority (POST yield, confirm dialog).
- `EngineApiClient`: `getSyncClientStatus`, `updateSyncClientConfig(partial)`, `yieldSyncClient`, `disconnectSyncClient` (+ DTOs). Tests against the mock management server per 3-2 patterns; screen tests per repo conventions.

## Implementation steps

1. Engine: `syncclient.Manager` controller + run-path/enginehost wiring (desktop + sidecar both).
2. Engine: routes + persistence (config.json read-modify-write; sidecar load-merge fix if needed) + tests.
3. App: EngineApiClient methods + DesktopSyncScreen (recovered layouts) + navigation + tests.
4. Docs: engine CHANGELOG; openapi.yaml entries; one-line note in 2-4 doc implementation notes pointing at the controller.

## Verification gates

- Engine (canonical env): `go build ./...`, `go vet ./...`, `go test ./...` all exit 0.
- App: `npx.cmd tsc --noEmit` → 0 errors; `npm.cmd run test` green.
- Persistence round-trip proven by test (PUT → restart-shaped reload → config intact, unrelated keys untouched).

## Owner device gate (unchecked)

- LAN pairing smoke **through the UI**: desktop engine (authority) + phone sidecar → screen shows pending_approval → approve in desktop UI → state syncing → edit entity on phone → appears on desktop; handover button promotes phone. (Exact steps recorded in the task report.)

## Progress checklist

- [x] Engine syncclient.Manager + run-path wiring
- [x] Engine REST routes + config persistence + tests
- [x] Sidecar config load-merge (if needed)
- [x] App EngineApiClient methods + tests
- [x] DesktopSyncScreen + navigation + tests
- [x] openapi + CHANGELOG
- [ ] Owner device gate: LAN pairing smoke via UI

## Addendum 3-5b — Sync UI parity (added 2026-10-12, owner instruction)

Owner review of the landed screen raised two follow-ups, executed as one increment:

1. **App screen ↔ deleted-screen design language.** `DesktopSyncScreen` must reuse the design/component language of the deleted rows-v1 `SyncSettingsScreen` (and its setup sibling `ConnectionSetupScreen`) *as much as makes sense* — layout structure, connection-state visualization patterns, status-card styling, copy tone — while keeping the new 9-state/pending-writes/authority semantics. Old-protocol logic (estimates, table selection, wipe/rebuild) stays dead.
2. **Desktop (Wails frontend) sync visualization.** The same UI/UX spirit on the desktop side: connection status + sync progress for the engine's changeset-v1 **server** role — authority indicator, connected clients, epoch/recording state, last-seq progress, pending device approvals (existing `DeviceApprovalModal`). Consumes the management API; if client/epoch status isn't exposed yet, add a minimal read route (`GET /api/sync/server/status`, admin-key authed — desktop surface, not loopback) beside the 3-5 client routes. Built as the changeset-v1 surface, clearly separated from the rows-v1 Wails sync UI (which 6-4 deletes).

Also recorded here (owner-reported, fixed 2026-10-12): **beta-URL hardcoding sweep** — app `moduleDefaults`/`providerFieldSchemas`/refresh call now flavor-aware via `CLOUD_HOSTS.inference`; engine fallbacks (`providers/soulbitscloud.go`, both RAG sites) via `config.SoulbitsCloudBaseURL()` (env `SE_SOULBITSCLOUD_BASE_URL`); `createSoulbitsCloudProvider` seeds `BaseURL` explicitly (no longer inherits the migration's prod default; the migration's SQL default itself stays — immutable history). `cloud_mode.go` documents its beta env note.

### 3-5b checklist
- [x] DesktopSyncScreen design-language alignment vs deleted screens
- [x] Desktop Wails sync visualization (+ `GET /api/sync/server/status` if needed)
- [ ] Owner device gate (LAN pairing smoke now covers both surfaces)

**3-5b implementation notes:** the app screen recycled the deleted screens' hero orb / detail rows / security badge (static hero — no entrance animation, deliberate: this is a live-poll surface; all testIDs preserved). The engine gained `GET /api/sync/server/status` (admin-key authed, `/api/sync/server/status`) backed by `eventserver.SyncPeerRegistry` (fed by the per-connection changeset handler on EPOCH_STATE/CHANGESET_ACK, dropped on connection close); the desktop Wails frontend got a new **Sync** tab (`SyncStatusView`) consuming it — authority indicator, connected clients (name/type/connected-since/last-acked), epoch/recording state, pending-approvals entry (reuses the existing `DeviceApprovalModal` + watcher), and this desktop's own client role when configured. **Overlap note for 6-4:** the new view is the changeset-v1 surface; the rows-v1 `frontend/src/components/sync/DeviceManagementView.jsx` is currently imported-but-unrendered (orphaned) in `HarmonyLinkApp.jsx` and is the cleanup target for 6-4 (delete the import + component; there is no user-facing tab to remove).
