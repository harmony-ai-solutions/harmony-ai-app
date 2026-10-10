# Implementation Plan — App-Engine Parity (Embedded Engine Consolidation)

> **Status:** DRAFT — pending detail review & go/no-go decision
> **Created:** 2026-10-10
> **Research basis:** [`docs/engine-parity-vs-cloud-assessment.md`](../../docs/engine-parity-vs-cloud-assessment.md) (§1–§12; especially §7 embedding channels, §10 design directives D1/D2, §11 local-engine variant, §12 consolidation)
> **Branch (this repo):** `feat/app-engine-parity`

## Plan Overview

Migrate the Harmony AI App from *"TS data-layer replica + hand-rolled 35-table sync protocol"* to *"embedded Harmony Link engine (one Go database) + management-API frontend + changeset-based engine↔engine sync."*

The app stops being a second implementation of the engine's data layer and becomes a thin client around the engine it already knows how to talk to (the same management API + event WS contract the Wails frontend uses). The TS SQLite replica, mirrored migrations, and the app-side sync stack are deleted — after serving one final time as the data-migration bridge.

### End state

| Relationship | Mechanism |
|---|---|
| App JS ↔ embedded engine | Management REST + event WS over `127.0.0.1` (Android: sidecar process; iOS: in-process module) |
| Embedded engine ↔ desktop engine | SQLite session-extension **changesets** over WS (new Go sync module, epoch-based authority) |
| Embedded engine ↔ cloud session engine | Same changeset protocol through the existing conduct proxy (dual-protocol transition window) |
| Cloud lifecycle-worker | Unchanged operationally; engine dependency bump + schema support window |

### Repos & branches

| Repo | Branch (to create) | Role in this plan |
|---|---|---|
| `harmony-ai-app` | `feat/app-engine-parity` (exists — this plan) | Sidecar/module integration, management-API frontend, TS stack deletion |
| `harmony-link-private` | `feat/app-engine-parity` | D1/D2 refactors, session-extension wrapper, changeset sync module, embedding facade, mobile read endpoints |
| `soulbits-cloud-backend` | `feat/app-engine-parity` | Engine dependency bump, lifecycle-worker compatibility gates, schema support window. **NO infra cleanup** |

**Coupled release order:** engine first → cloud backend (dependency bump) → app. Old-app↔new-engine compatibility is protected by the existing `sync_schema_version` gate (sticky `serverUpdateRequired`).

### Explicitly OUT OF SCOPE (deferred to a separate cloud-cleanup plan)

- Session-broker retirement, warm-pool removal, conduct-proxy retirement, per-user Fargate task elimination
- The §11 "thin lifecycle service" phone-authoritative snapshot write-back + leasing (depends on the above)
- Nitro Enclave hardening, per-user IAM scoping restore (existing backlog D-01 items)

---

## Phases

### Phase 0 — Engine Core Prerequisites [engine, cloud]
The two refactors everything else depends on (assessment §10.2 directives D1/D2). Improve the current hosts immediately; required for changeset reconciliation later.
- **0-1** Lazy temporal evaluation — refactor tick-applied state (emotion decay/dampening/crystallization, exhaustion/sleep progression, Dream TTL) into pure functions of `(state₀, elapsed)` evaluated on read
- **0-2** Catch-up seam — formalize `FireCatchUp(elapsed)`: sampled K beats + fixed-step replay for non-LLM state, building on the existing one-shot `FireBeat`/`FireDreamBeat`/`FireOutreachBeat`
- **0-3** Cloud backend engine dependency bump + lifecycle-worker compatibility verification (schema support window N/N−1)

### Phase 1 — Android Sidecar Pilot (dual-DB, zero data-layer changes) [engine, app]
Prove embedding with the *existing* app: point the current sync/session client at `ws://127.0.0.1`. This phase is simultaneously the migration bridge (old protocol moves all app data into the engine DB).
- **1-1** Engine: embeddable Android build target (static binary packaged as `libengine.so`, loopback bind, data-dir config, headless mode)
- **1-2** App: SidecarProcessManager (exec from `nativeLibraryDir`, port handshake, health watch, shutdown; typed foreground service)
- **1-3** App: "local engine" connection source (per-source watermark model, ConnectionSetup UI, CloudSessionService untouched)
- **1-4** Pilot verification: full old-protocol sync app↔localhost (= one-time data bridge, device-verified)

### Phase 2 — Changeset Sync Module [engine, app]
Replace the sync mechanism for engine peers, using SQLite's session extension.
- **2-1** go-sqlite3 fork: enable session extension (build flags) + thin CGO wrapper package
- **2-2** Changeset store & epoch manager (baselines, retention, snapshot re-pull policy, per-table-class conflict policy)
- **2-3** Peer changeset protocol (engine↔engine over WS; `sync_schema_version` bump; desktop ↔ embedded)
- **2-4** Go sync **client** role (dial-out, TLS security modes, PASETO injection — engines have only ever served)
- **2-5** Cloud changeset path (embedded engine ↔ conduct proxy ↔ cloud session engine; dual-protocol transition window for old apps)

### Phase 3 — App Becomes Management-API Frontend [engine, app]
- **3-1** Engine: mobile-optimized read endpoints (audit Wails-frontend usage vs. app TS repository queries; add chat-list previews, paginated reads)
- **3-2** App: management-API client + repository adapter swap (per screen group, feature-flagged)
- **3-3** App: client-only data audit & relocation (remaining client-only tables → engine tables or AsyncStorage)
- **3-4** Migration bridge execution + TS replica/sync stack deletion (the big deletion: repositories, mirrored migrations, SyncService, name-clash, tombstone/GC app-side, wipe/rebuild, estimate-confirm)

### Phase 4 — iOS In-Process Module [engine, app]
- **4-1** Engine: gomobile facade (JSON boundary, event callbacks, XCFramework build; CGO SQLite confirmed working)
- **4-2** App: Turbo Native Module wrapper + engine lifecycle (start/stop with app process; foreground-only semantics)
- **4-3** iOS degraded-tier behaviors (BGProcessingTask overnight windows → `FireCatchUp`/dream/compact via facade; lazy state reads; optional widget/Live-Activity presence)

### Phase 5 — Hardening, Gates Retooling, Rollout [all]
- **5-1** Retire/retool parity gates (schema-parity tests, `dump-schema` client-only registries — the parity tax ends)
- **5-2** Docs & memory banks (all repos: TESTING.md, HARMONY-LINK-INTEGRATION.md, entity-interaction-model.md, changelogs)
- **5-3** Rollout & version matrix (release channels, old-app↔new-engine gates, rollback plan)

---

## Implementation Status

Track the completion of each phase as implementation progresses:

- [ ] **Phase 0: Engine Core Prerequisites**
  - [ ] 0-1 Lazy Temporal Evaluation ([0-1-EngineLazyTemporalEvaluation.md](0-1-EngineLazyTemporalEvaluation.md))
  - [ ] 0-2 Catch-Up Seam ([0-2-EngineCatchUpSeam.md](0-2-EngineCatchUpSeam.md))
  - [ ] 0-3 Cloud Backend Engine Bump ([0-3-CloudBackendEngineBump.md](0-3-CloudBackendEngineBump.md))
- [ ] **Phase 1: Android Sidecar Pilot**
  - [ ] 1-1 Engine Android Sidecar Build ([1-1-EngineAndroidSidecarBuild.md](1-1-EngineAndroidSidecarBuild.md))
  - [ ] 1-2 App Sidecar Process Manager ([1-2-AppSidecarProcessManager.md](1-2-AppSidecarProcessManager.md))
  - [ ] 1-3 App Local Connection Mode ([1-3-AppLocalConnectionMode.md](1-3-AppLocalConnectionMode.md))
  - [ ] 1-4 Pilot Verification / Old-Protocol Bridge ([1-4-PilotVerificationOldProtocolBridge.md](1-4-PilotVerificationOldProtocolBridge.md))
- [ ] **Phase 2: Changeset Sync Module**
  - [ ] 2-1 SQLite Session Extension Wrapper ([2-1-SqliteSessionExtensionWrapper.md](2-1-SqliteSessionExtensionWrapper.md))
  - [ ] 2-2 Changeset Store & Epochs ([2-2-ChangesetStoreAndEpochs.md](2-2-ChangesetStoreAndEpochs.md))
  - [ ] 2-3 Peer Changeset Protocol ([2-3-PeerChangesetProtocol.md](2-3-PeerChangesetProtocol.md))
  - [ ] 2-4 Go Sync Client Role ([2-4-GoSyncClientRole.md](2-4-GoSyncClientRole.md))
  - [ ] 2-5 Cloud Changeset Path ([2-5-CloudChangesetPath.md](2-5-CloudChangesetPath.md))
- [ ] **Phase 3: App Becomes Management-API Frontend**
  - [ ] 3-1 Engine Mobile Read Endpoints ([3-1-EngineMobileReadEndpoints.md](3-1-EngineMobileReadEndpoints.md))
  - [ ] 3-2 App Management-API Repositories ([3-2-AppManagementApiRepositories.md](3-2-AppManagementApiRepositories.md))
  - [ ] 3-3 Client-Only Data Audit ([3-3-AppClientOnlyDataAudit.md](3-3-AppClientOnlyDataAudit.md))
  - [ ] 3-4 Migration Bridge & Deletion ([3-4-MigrationBridgeAndDeletion.md](3-4-MigrationBridgeAndDeletion.md))
- [ ] **Phase 4: iOS In-Process Module**
  - [ ] 4-1 Engine Gomobile Facade ([4-1-EngineGomobileFacade.md](4-1-EngineGomobileFacade.md))
  - [ ] 4-2 App iOS Module Integration ([4-2-AppIOSModuleIntegration.md](4-2-AppIOSModuleIntegration.md))
  - [ ] 4-3 iOS Degraded-Tier Behaviors ([4-3-IOSDegradedTierBehaviors.md](4-3-IOSDegradedTierBehaviors.md))
- [ ] **Phase 5: Hardening, Gates Retooling, Rollout**
  - [ ] 5-1 Parity Gates Retooling ([5-1-ParityGatesRetooling.md](5-1-ParityGatesRetooling.md))
  - [ ] 5-2 Docs & Memory Banks ([5-2-DocsAndMemoryBanks.md](5-2-DocsAndMemoryBanks.md))
  - [ ] 5-3 Rollout & Version Matrix ([5-3-RolloutAndVersionMatrix.md](5-3-RolloutAndVersionMatrix.md))

---

## Verification gates (repo conventions)

- **Engine:** `go build ./...` · `go vet ./...` · `go test ./...` all green per phase
- **App:** `npx tsc --noEmit` 0 errors · full jest unit + integration green per phase
- **Cloud backend:** `go test ./...` (note: some packages App-Control-blocked on Windows — pre-existing) · local E2E where applicable
- **Device:** phases 1-4, 3-4, 4-2/4-3 require on-device smoke (owner-run, per workspace rules — no building by agents)

## Open decisions for tomorrow's review

1. **Epoch model:** strict single-writer epochs (recommended, matches per-source authority) vs. changeset rebase for concurrent multi-writer (SQLite marks rebase experimental — recommend deferring).
2. **Changeset retention window:** how long deltas are retained before baseline snapshot re-pull replaces them (replaces purge-floor semantics; propose 7–30 days).
3. **Conflict policy table:** confirm per-table-class resolutions (append-only → keep both; configs → LWW REPLACE; deletes → native changeset DELETE replay).
4. **Cloud changeset path in this plan vs. deferred:** recommended IN (phase 2-5) because deleting the app TS sync stack requires the cloud path to work without it; the deferred cloud-cleanup plan only removes infra, not protocols.
5. **iOS module timing:** Phase 4 is independently schedulable after Phase 3; confirm whether it ships with the first release or follows.
6. **gomobile vs. sidecar-only first:** if iOS slips, does Android-only embedding carry release 1?
