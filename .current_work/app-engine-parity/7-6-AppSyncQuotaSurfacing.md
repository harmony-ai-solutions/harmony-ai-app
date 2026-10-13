# Phase 7-6 — App + Engine: Sync Quota Surfacing (review follow-up)

> **Repos:** `harmony-link-private` (engine) + `harmony-ai-app` (app)
> **Created:** 2026-10-12 (owner review finding on Phase 7: the app only reacts to quota exhaustion; it never shows the limits)
> **Depends on:** 7-2/7-3 (engine relay transport + contract 1.1.0)
> **Type:** small cross-repo follow-up, contract bump **1.1.0 → 1.2.0**

## Objective

Make the app's cloud-sync status card show the tier limits proactively — device cap and buffer usage — instead of only the reactive `quota_exceeded` banner. A user should see "Devices: up to 3" and "Buffer: 12 MB / 64 MB" before hitting a wall, not "Your plan's cloud sync quota is full." after.

## Verified current state (2026-10-12 review — anchor before editing)

- The relay already delivers quotas to every engine on connect: the WS welcome envelope carries `QuotaInfo{sync_buffer_mb, sync_devices, backup_storage_mb}` (`soulbits-cloud-backend`: `cmd/sync-relay/envelope.go:62`, sent at `cmd/sync-relay/ws.go:262`). **No cloud changes are needed.**
- The engine parses them and then drops them: `relayWelcome.Quotas` (`relayQuotas`, only `sync_buffer_mb`+`sync_devices` declared — `syncclient/relay.go:89-105`) never flows into `RelayState` (`relay.go:143-154`) nor into the wire status via `relayStatusFromState` (`syncclient/manager.go:806-822`).
- The app's `RelayStatusDto` (`src/services/engine/EngineApiClient.ts:382-394`) **already has** `buffered_bytes`, `cap`, `overflow` — buffer usage is renderable today with zero engine changes. Missing: the `sync_devices` limit (and quota framing generally).
- The reactive `quota_exceeded` state/banner exists (`src/screens/settings/DesktopSyncScreen.tsx:838`, i18n `src/i18n/locales/en/desktopSync.json:117/128`) — keep it; this phase adds visibility, not a replacement.

## Design

### 1. Engine — retain + expose welcome quotas

- `syncclient/relay.go`: extend `relayQuotas` with `BackupStorageMB int \`json:"backup_storage_mb"\``; add `QuotaSyncBufferMB`, `QuotaSyncDevices`, `QuotaBackupStorageMB int` to `RelayState`; populate from the welcome where the snapshot is built.
- `syncclient/manager.go`: extend the `RelayStatus` wire struct and `relayStatusFromState` with `sync_buffer_mb`, `sync_devices`, `backup_storage_mb` (snake_case). **Semantics: `0` = unlimited** (mirrors the relay's `bufferCapBytes()` rule) — document in the field comment.
- Values reflect the **last successful welcome** (snapshot may be stale when disconnected) — acceptable; the app renders them only when a relay snapshot exists.

### 2. Contract bump 1.1.0 → 1.2.0 (lockstep, per the 5-1 procedure)

1. Engine: bump the management API version + openapi (`docs/api/management/…`) + canonical fixtures (`docs/api/management/fixtures/management-contract.fixtures.json`) with the three new `relay` fields.
2. App: bump `ENGINE_CONTRACT_VERSION` (`src/services/engine/engineContract.ts`), copy the extended fixtures into `__fixtures__/managementContract.fixtures.ts`.
3. Verify: `node scripts/check-engine-contract.mjs --engine-repo <path> --engine-fixtures <path>` → versions match, endpoint/fixture counts consistent.

### 3. App UI — quota rows on the cloud status card

In `DesktopSyncScreen`'s relay/cloud status block (where `buffered_frames`/`overflow` observability already renders):

- **Devices row:** `Devices: up to {sync_devices}` — or `{members} / {sync_devices}` if a group member count is already available in the engine status (check first; do NOT add a new endpoint for it). `sync_devices = 0` → "unlimited".
- **Buffer row:** `{formatBytes(buffered_bytes)} / {formatBytes(cap)}` from the existing `RelayStatusDto` fields; `cap = 0` → "unlimited". An overflow state should visually escalate this row (tie into the existing warning styling).
- Render rules: rows hidden when `transport !== 'relay'` or `status.relay === null`; no spinner/state machinery — plain rows from the same status poll the screen already does.
- i18n: new keys in `desktopSync.json` for **every** locale file present (en at minimum — match how 7-3 handled it); no hardcoded strings.
- Backup quota (`backup_storage_mb`): optional stretch — feed 7-5's backup-target picker quota line if it's a one-line change; otherwise leave the field on the wire only and note it.

**Out of scope:** pre-pairing device-count prediction (would need a relay REST group-size endpoint; portal owns management UX). Do not add cloud endpoints.

## Implementation steps

1. Engine: `relayQuotas`/`RelayState`/`RelayStatus` fields + welcome population + `relayStatusFromState` mapping.
2. Engine tests: extend the existing fake-relay welcome/status suites to assert the three fields round-trip (and `0`-default when the welcome omits them).
3. Engine contract artifacts: version bump, openapi, canonical fixtures.
4. App: contract bump + `RelayStatusDto` extension + vendored fixtures; drift CLI green.
5. App UI: quota rows + i18n (all locales) + tests (renders with quotas; `cap=0`/`sync_devices=0` → "unlimited"; `relay === null` → hidden; overflow escalates buffer row).
6. Docs/changelogs: engine `CHANGELOG.md` (+ Management-API-Versioning doc if it lists versions); app `CHANGELOG.md`.

## Files to create/modify

- `harmony-link-private`: `syncclient/relay.go`, `syncclient/manager.go`, the status/welcome tests, `docs/api/management/*` (openapi + fixtures), `CHANGELOG.md`
- `harmony-ai-app`: `src/services/engine/engineContract.ts`, `src/services/engine/EngineApiClient.ts`, `__fixtures__/managementContract.fixtures.ts`, `src/screens/settings/DesktopSyncScreen.tsx`, `src/i18n/locales/*/desktopSync.json`, screen tests, `CHANGELOG.md`

## Verification gates

- Engine: `go build/vet/test ./...` green (remember `CGO_CFLAGS='-DSQLITE_ENABLE_SESSION -DSQLITE_ENABLE_PREUPDATE_HOOK'` per 2-1).
- App: `npx.cmd tsc --noEmit` → 0; `npm.cmd run test` green.
- `check-engine-contract.mjs` → versions match.

## Owner gates

- None new (display-only). Fold a visual check into the existing 7-3 staging device drill.

## Progress checklist

- [x] Engine: quotas retained in `RelayState` + exposed in `RelayStatus`
- [x] Engine tests green (welcome → status round-trip)
- [x] Contract 1.2.0 lockstep (engine openapi/fixtures + app version/fixtures + drift CLI)
- [x] App quota rows + i18n + tests
- [x] Docs/changelogs both repos

## Completion notes (2026-10-12)

- Engine: `relayQuotas` gained `backup_storage_mb`; `RelayState` gained `QuotaSyncBufferMB`/`QuotaSyncDevices`/`QuotaBackupStorageMB` (populated in `relayConn.RelayState()` from the last welcome); `RelayStatus` + `relayStatusFromState` expose `sync_buffer_mb`/`sync_devices`/`backup_storage_mb` (0 = unlimited). Two new fake-relay tests assert the round-trip and the 0-default when the welcome omits `quotas`.
- Contract bumped **1.1.0 → 1.2.0** in lockstep: engine openapi `info.version` + `RelayStatus` schema (3 fields), canonical fixtures `contractVersion` + the `syncClientStatus` relay block; app `ENGINE_CONTRACT_VERSION` + `FIXTURE_CONTRACT_VERSION` + vendored fixture. Drift CLI green (26 endpoints / 28 fixtures / versions match).
- App: relay block gained a **Devices** row (`up to {sync_devices}` / `unlimited`) and the buffer row now renders `formatBytes(buffered_bytes) / formatBytes(cap)` (`cap = 0` → `unlimited`), escalating to the warning style on overflow. New i18n keys in `en/desktopSync.json` (only locale present; others fall back to en). `formatBytes` extracted to `src/utils/formatBytes.ts` (shared with `BackupSettingsScreen`). 4 screen tests added/updated.
- **Backup-quota stretch: NOT landed (wire-only).** `backup_storage_mb` is exposed on the wire/DTO, but feeding it into 7-5's backup-target picker is not a one-line change: that picker's quota line reads `BackupOrchestrator.getCloudQuota()` (a relay `/v1/sync/status` REST read), not the sync-client status the engine exposes this field on — so the field stays wire-only per the doc's fallback.
