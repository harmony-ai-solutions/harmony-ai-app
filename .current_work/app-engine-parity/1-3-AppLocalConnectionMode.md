# Phase 1-3 — App: "Local Engine" Connection Source

> **Repo:** `harmony-ai-app` (branch `feat/app-engine-parity`)
> **Assessment basis:** §12.3 relationship 1; app memory-bank per-source model (`selfhosted`/`cloud` watermarks, switch warnings)

## Objective

Add a third connection source — **local engine** — so the *existing, unmodified* sync/session client stack runs against the sidecar at `ws://127.0.0.1:<port>`. Zero data-layer changes in this phase; this is the pilot AND the migration bridge.

## Design

- `ConnectionMode` gains `local` alongside `selfhosted`/`cloud`:
  - Watermark key `last_sync_timestamp:local` (extend `SyncSource` type — `ConnectionStateManager.ts`)
  - `isSyncTransportSettled`: `local` → always settled (loopback, no TLS needed — document threat model: loopback only, same-UID process)
  - Connection factory: `WebSocketConnectionFactory` gains a `local` branch consuming ports from `EngineSidecarModule.start()`; entity WS + sync WS both point at loopback
- Startup orchestration (`SyncConnectionContext`/`ConnectionManager`): on `local` mode → ensure sidecar running → wait `engine:ready` → connect (existing handshake path unchanged)
- UI: `ConnectionSetupScreen` gains a "This device (local engine)" mode card (visible only when `ENGINE_SIDECAR_ENABLED`); `SyncSettingsScreen` shows local source like the others; connection status labels updated (`connectionStatus` helper)
- Pairing/cert flows: skipped for local (engine sidecar trusts loopback — add `--allow-loopback-no-auth` style flag decision in 1-1 if the handshake requires device approval; simplest: sidecar auto-approves like cloud mode. Align with existing `CLOUD_MODE` auto-approve pattern)
- `CloudSessionService` untouched (cloud mode unchanged)

## Implementation steps

1. Extend `SyncSource`/watermarks (`ConnectionStateManager.ts`) + `isSyncTransportSettled` + `getCurrentSource` mapping.
2. `WebSocketConnectionFactory` local branch + port resolution from sidecar module; reconnection logic unchanged (sidecar restart → ports may change → reconnect flow re-resolves).
3. Mode card UI + i18n keys + switch-warning parity with existing sources.
4. Tests: settlement helper cases, watermark per-source, factory selection (mock sidecar ports), reconnect-after-engine-restart scenario.
5. Device pilot prep: log checklist for 1-4.

## Files to create/modify

- `src/services/ConnectionStateManager.ts` (source enum, watermark keys)
- `src/services/WebSocketConnectionFactory.ts`, `src/services/createWebSocket.ts` (local branch)
- `src/contexts/syncSettlementHelper.ts` (settled for local)
- `src/contexts/SyncConnectionContext.tsx` (startup orchestration for local)
- `src/screens/ConnectionSetupScreen.tsx`, `src/screens/SyncSettingsScreen.tsx` (UI)
- i18n `connection.json`
- Tests: settlement/factory/watermark suites extended

## Verification gates

- `npx tsc --noEmit` 0; jest unit + integration green (mock-server suites must also cover a `local` source scenario)
- Cloud and self-hosted modes regression-green (no behavior change)
- App connects to sidecar, handshake accepted, sync session starts (1-4 verifies data)

## Risks & rollback

- Handshake auth: sidecar must auto-approve loopback devices (mirror `CLOUD_MODE=true` pairing bypass) — verify in 1-1 contract; otherwise stuck in pairing UI
- Sidecar port churn on restart: re-resolve on every connect attempt (no cached ports)
- Rollback: mode card hidden by flag; no other modes touched

## Progress checklist

- [ ] `local` source in state manager + watermarks + settlement
- [ ] Factory + startup orchestration + port re-resolution
- [ ] Sidecar auto-approve confirmed (1-1 contract)
- [ ] UI mode card + labels + i18n
- [ ] Tests extended + green
- [ ] Regression: cloud/self-hosted untouched
