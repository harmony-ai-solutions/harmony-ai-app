# Phase 2-5 — Cloud Changeset Path (embedded ↔ conduct proxy ↔ cloud session engine)

> **Repos:** `harmony-link-private` (server side) + `harmony-ai-app` (orchestration)
> **Assessment basis:** §12.3 relationship 3; conduct-proxy path conventions (memory bank)
> **Depends on:** 2-3, 2-4
> **Note:** infra cleanup (broker/warm-pool/proxy retirement) is explicitly DEFERRED to the cloud-cleanup plan. This phase only changes what flows through the existing infra.

## Objective

Make cloud mode work with the embedded engine as the sync participant, so the app's TS sync stack can be deleted in 3-4 without breaking cloud users.

## Design

- Flow: app (cloud mode, new architecture) → `CloudSessionService` provisions the session task as today (202/200 poll unchanged) → embedded engine (2-4 client) dials `wss://conduct…/ws/sync` with PASETO subprotocol → cloud session engine (updated image) negotiates `changeset-v1` → epoch/batch exchange.
- Cloud session engine serves **both** protocols during the transition: old app installs (rows-v1 TS sync) and new installs (changeset-v1 via embedded engine). Negotiation keyed per-connection (2-3 design).
- Authority: cloud session engine remains authority while the task exists (2-2 rules); embedded engine buffers pending epoch while task is down (grace period / terminated) and flushes on next session — this **replaces** the app-side reconnect/resync choreography (`sync:connection_replaced`, abort-safety-net etc.) with engine-side logic.
- Estimate gate: first-changeset baseline transfer is the large payload — reuse the size-estimate UX: server sends estimate (baseline size), app confirms (existing `sync:estimate` dialog contract, now answered by the app on behalf of the engine via facade call).
- App orchestration changes (minimal in this phase): cloud mode startup = ensure sidecar → session provision → instruct engine (facade) to dial; connection status UI maps engine client events to existing states.

## Implementation steps

1. Cloud session engine image: includes 2-3/2-4 changes; dual-protocol verification (old app emulator build + new path in staging).
2. Conduct proxy: no changes expected (opaque WS relay) — verify binary frame passthrough + subprotocol negotiation end-to-end.
3. App: `CloudSessionService` + `SyncConnectionContext` cloud-mode orchestration behind the new-architecture flag; engine client events → existing connection-state labels.
4. Estimate confirm bridging (facade call from app UI dialog).
5. Staging E2E: full account baseline → deltas both directions → session teardown/grace → reconnect flush → old-app coexistence check.

## Files to create/modify

- Engine: covered by 2-3/2-4 (+ any cloud-mode flags)
- App: `src/services/CloudSessionService.ts` (orchestration branch), `src/contexts/SyncConnectionContext.tsx`, facade bridge `src/services/engine/`
- Cloud backend: image build only (engine version bump from 0-3 lineage)

## Verification gates

- Staging E2E checklist green (above); old-app regression on rows-v1 green
- Grace-period flush verified (kill task mid-grace, reconnect, no loss)
- No cloud infra diffs beyond image version

## Risks & rollback

- Proxy binary-frame/subprotocol edge cases → early canary test before building on it
- Coexistence complexity on the server (two protocols) — bounded by 2-3 interface isolation; removal tracked for cleanup plan

## Progress checklist

- [ ] Dual-protocol cloud engine verified in staging
- [ ] Proxy passthrough verified
- [ ] App cloud-mode orchestration behind flag
- [ ] Estimate bridging
- [ ] Staging E2E green incl. old-app coexistence
