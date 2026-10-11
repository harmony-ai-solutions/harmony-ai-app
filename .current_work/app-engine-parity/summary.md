# Implementation Plan — App-Engine Parity (Embedded Engine Consolidation)

> **Status:** DRAFT — pending detail review & go/no-go decision
> **Created:** 2026-10-10
> **Research basis:** [`docs/engine-parity-vs-cloud-assessment.md`](../../docs/engine-parity-vs-cloud-assessment.md) (§1–§12; especially §7 embedding channels, §10 design directives D1/D2, §11 local-engine variant, §12 consolidation)
> **Branch (this repo):** `feat/app-engine-parity`

## Plan Overview

Migrate the Harmony AI App from *"TS data-layer replica + hand-rolled 35-table sync protocol"* to *"embedded Harmony Link engine (one Go database) + management-API frontend + changeset-based engine↔engine sync."*

**Lifecycle delivery model (ruled 2026-10-11):** lifecycle authority lives **on the device** — desktop/Android self-tick; iOS wakes best-effort (hourly blind keepalive push + overnight BGProcessingTask) and processes batches locally (`ProcessLifecycleBatch`); the cloud becomes **data-blind for lifecycle** (keepalive cron + device-initiated visible-push relay). The cloud never opens a user snapshot for lifecycle; new cloud-mode users get device-owned encrypted backup/restore instead of a cloud engine peer.

The app stops being a second implementation of the engine's data layer and becomes a thin client around the engine it already knows how to talk to (the same management API + event WS contract the Wails frontend uses). The TS SQLite replica, mirrored migrations, and the app-side sync stack are deleted outright. **No migration path** (pre-launch ruling 2026-10-11): fresh installs only — existing dev-device data is discarded; data access is the management-API relink (Phase 3) and engine↔engine changesets (Phase 2).

### End state

| Relationship | Mechanism |
|---|---|
| App JS ↔ embedded engine | Management REST + event WS over `127.0.0.1` (Android: sidecar process; iOS: in-process module) |
| Embedded engine ↔ desktop engine | SQLite session-extension **changesets** over WS (new Go sync module, epoch-based authority) |
| Embedded engine ↔ cloud | **No engine peer** — inference API (injected provider configs) + device-owned encrypted backup/restore (S3 snapshot plane); cloud session engines become unused by the app (running infra retired in the cleanup plan) |
| Cloud ↔ lifecycle | **Data-blind**: hourly iOS keepalive cron + device-initiated visible-push relay (4-4); lifecycle-worker deleted outright (4-4) |

### Repos & branches

| Repo | Branch (to create) | Role in this plan |
|---|---|---|
| `harmony-ai-app` | `feat/app-engine-parity` (exists — this plan) | Sidecar/module integration, management-API frontend, TS stack deletion |
| `harmony-link-private` | `feat/app-engine-parity` | D1/D2 refactors, session-extension wrapper, changeset sync module, embedding facade, mobile read endpoints |
| `soulbits-cloud-backend` | `feat/app-engine-parity` | Keepalive cron + push relay (4-4), lifecycle-worker deletion (4-4), tier policy extension. **NO infra cleanup** |

**Coupled build order:** engine → cloud backend → app, landed together on fresh installs (unlaunched product — no old versions in the wild). The existing `sync_schema_version` gate remains only as the guard for mismatched dev builds.

### Explicitly OUT OF SCOPE (deferred to a separate cloud-cleanup plan)

- Physical infra retirement (session-broker, warm-pool, conduct-proxy, per-user Fargate elimination) — stays deferred. NOTE: the app stops using the warm pool for lifecycle AND chat in this plan (functionally unused once 3-4/4-4 land); the cleanup plan only removes the hardware and the backend's remaining engine dependency (the relicense-to-SSPL option completes there)
- Engine-side rows-v1 sync server removal — dead code after 3-4 deletes the app's rows-v1 client; deferred to the same cleanup plan
- The §11 "thin lifecycle service" phone-authoritative snapshot write-back + leasing — **SUPERSEDED** by the 2026-10-11 on-device ruling (the device owns lifecycle; no cloud execution, no write-back needed)
- Nitro Enclave hardening, per-user IAM scoping restore (existing backlog D-01 items)

---

## Phases

### Phase 0 — Engine Core Prerequisites [engine]
The core refactors everything else depends on (assessment §10.2 directives D1/D2 + the 2026-10-11 batch ruling). Improve the desktop host immediately; required for changeset reconciliation and the mobile batch runtime later. (0-3 — cloud engine bump & compatibility window — is removed: unlaunched, no old versions to support; the cloud's first and only plan changes are in 4-4.)
- **0-1** Lazy temporal evaluation — refactor tick-applied state (emotion decay/dampening/crystallization, exhaustion/sleep progression, Dream TTL) into pure functions of `(state₀, elapsed)` evaluated on read
- **0-2** Catch-up seam — formalize `FireCatchUp(elapsed)`: sampled K beats for short gaps, collapsing to a single hiatus-framed re-entry beat for gaps ≥48h; non-LLM state advances exactly via 0-1; LLM spend is O(1) in elapsed time — built on the existing one-shot `FireBeat`/`FireDreamBeat`/`FireOutreachBeat`
- **0-4** Lifecycle batch orchestrator — `ProcessLifecycleBatch`: per-entity tx isolation, priority ordering, deadline/budget truncation, non-LLM degradation (the mobile lifecycle runtime)

### Phase 1 — Android Embedding Foundations [engine, app]
Embed the engine on Android: sidecar build + app-side process management. (The original dual-DB pilot — pointing the existing rows-v1 client at the sidecar as a data bridge — is dropped with the pre-launch ruling: the app never speaks rows-v1 to a local engine. Its data access is the management-API relink in Phase 3; engine↔engine sync is Phase 2; the app's local-engine connection state is absorbed into the 3-2 engine-service layer, which 4-2's unified `EngineHost` reuses for iOS.)
- **1-1** Engine: embeddable Android build target (static binary packaged as `libengine.so`, loopback bind, data-dir config, headless mode)
- **1-2** App: SidecarProcessManager (exec from `nativeLibraryDir`, port handshake, health watch, shutdown; typed foreground service)

### Phase 2 — Changeset Sync Module [engine, app]
Replace the sync mechanism for engine peers, using SQLite's session extension.
- **2-1** go-sqlite3 fork: enable session extension (build flags) + thin CGO wrapper package
- **2-2** Changeset store & epoch manager (baselines, retention, snapshot re-pull policy, per-table-class conflict policy)
- **2-3** Peer changeset protocol (engine↔engine over WS; `sync_schema_version` bump; desktop ↔ embedded)
- **2-4** Go sync **client** role (dial-out, TLS security modes, PASETO injection — engines have only ever served)
- **2-5** Cloud data path — cloud mode = on-device engine + injected inference configs + device-owned encrypted backup/restore (no cloud engine peer, no dual-protocol work)

### Phase 3 — App Becomes Management-API Frontend [engine, app]
- **3-1** Engine: mobile-optimized read endpoints (audit Wails-frontend usage vs. app TS repository queries; add chat-list previews, paginated reads — extend the management API wherever the app genuinely needs more than today's contract offers)
- **3-2** App: management-API client + repository adapter swap (per screen group, feature-flagged)
- **3-3** App: client-only data audit (schema verdicts only — engine tables or AsyncStorage; fresh installs start empty, no data carry)
- **3-4** TS replica/sync stack deletion (once the 3-2 relink is complete: repositories, mirrored migrations, SyncService, name-clash, tombstone/GC app-side, wipe/rebuild, estimate-confirm, CloudSessionService — no import bridge)

### Phase 4 — iOS In-Process Module [engine, app, cloud]
- **4-1** Engine: gomobile facade (JSON boundary, event callbacks, XCFramework build; CGO SQLite confirmed working)
- **4-2** App: Turbo Native Module wrapper + engine lifecycle (start/stop with app process; foreground-only semantics)
- **4-3** iOS blind-tick lifecycle (primary channel): silent-push wake → `ProcessLifecycleBatch`; BGProcessingTask overnight deep sweep; on-device outreach eligibility + relay client; honest-limits copy
- **4-4** Cloud keepalive cron + visible-push relay + lifecycle-worker deletion (data-blind; independently shippable; keepalive droppable by product call)

### Phase 5 — Hardening, Gates Retooling, Rollout [all]
- **5-1** Retire/retool parity gates (schema-parity tests, `dump-schema` client-only registries — the parity tax ends)
- **5-2** Docs & memory banks (all repos: TESTING.md, HARMONY-LINK-INTEGRATION.md, entity-interaction-model.md, changelogs)
- **5-3** Release sequencing & rollback (engine → backend → app on fresh installs; cloud-cleanup handoff — no version matrix, no staged rollout: unlaunched)

---

## Implementation Status

Track the completion of each phase as implementation progresses:

- [ ] **Phase 0: Engine Core Prerequisites**
  - [ ] 0-1 Lazy Temporal Evaluation ([0-1-EngineLazyTemporalEvaluation.md](0-1-EngineLazyTemporalEvaluation.md))
  - [ ] 0-2 Catch-Up Seam ([0-2-EngineCatchUpSeam.md](0-2-EngineCatchUpSeam.md))
  - [ ] 0-4 Lifecycle Batch Orchestrator ([0-4-EngineLifecycleBatchOrchestrator.md](0-4-EngineLifecycleBatchOrchestrator.md))
- [ ] **Phase 1: Android Embedding Foundations**
  - [ ] 1-1 Engine Android Sidecar Build ([1-1-EngineAndroidSidecarBuild.md](1-1-EngineAndroidSidecarBuild.md))
  - [ ] 1-2 App Sidecar Process Manager ([1-2-AppSidecarProcessManager.md](1-2-AppSidecarProcessManager.md))
- [ ] **Phase 2: Changeset Sync Module**
  - [ ] 2-1 SQLite Session Extension Wrapper ([2-1-SqliteSessionExtensionWrapper.md](2-1-SqliteSessionExtensionWrapper.md))
  - [ ] 2-2 Changeset Store & Epochs ([2-2-ChangesetStoreAndEpochs.md](2-2-ChangesetStoreAndEpochs.md))
  - [ ] 2-3 Peer Changeset Protocol ([2-3-PeerChangesetProtocol.md](2-3-PeerChangesetProtocol.md))
  - [ ] 2-4 Go Sync Client Role ([2-4-GoSyncClientRole.md](2-4-GoSyncClientRole.md))
  - [ ] 2-5 Cloud Data Path & Backup ([2-5-CloudChangesetPath.md](2-5-CloudChangesetPath.md))
- [ ] **Phase 3: App Becomes Management-API Frontend**
  - [ ] 3-1 Engine Mobile Read Endpoints ([3-1-EngineMobileReadEndpoints.md](3-1-EngineMobileReadEndpoints.md))
  - [ ] 3-2 App Management-API Repositories ([3-2-AppManagementApiRepositories.md](3-2-AppManagementApiRepositories.md))
  - [ ] 3-3 Client-Only Data Audit ([3-3-AppClientOnlyDataAudit.md](3-3-AppClientOnlyDataAudit.md))
  - [ ] 3-4 TS Stack Deletion ([3-4-MigrationBridgeAndDeletion.md](3-4-MigrationBridgeAndDeletion.md))
- [ ] **Phase 4: iOS In-Process Module**
  - [ ] 4-1 Engine Gomobile Facade ([4-1-EngineGomobileFacade.md](4-1-EngineGomobileFacade.md))
  - [ ] 4-2 App iOS Module Integration ([4-2-AppIOSModuleIntegration.md](4-2-AppIOSModuleIntegration.md))
  - [ ] 4-3 iOS Blind-Tick Lifecycle ([4-3-IOSDegradedTierBehaviors.md](4-3-IOSDegradedTierBehaviors.md))
  - [ ] 4-4 Cloud Keepalive & Push Relay ([4-4-CloudBlindTickScheduler.md](4-4-CloudBlindTickScheduler.md))
- [ ] **Phase 5: Hardening, Gates Retooling, Rollout**
  - [ ] 5-1 Parity Gates Retooling ([5-1-ParityGatesRetooling.md](5-1-ParityGatesRetooling.md))
  - [ ] 5-2 Docs & Memory Banks ([5-2-DocsAndMemoryBanks.md](5-2-DocsAndMemoryBanks.md))
  - [ ] 5-3 Release Sequencing & Rollback ([5-3-RolloutAndVersionMatrix.md](5-3-RolloutAndVersionMatrix.md))

---

## Verification gates (repo conventions)

- **Engine:** `go build ./...` · `go vet ./...` · `go test ./...` all green per phase
- **App:** `npx tsc --noEmit` 0 errors · full jest unit + integration green per phase
- **Cloud backend:** `go test ./...` (note: some packages App-Control-blocked on Windows — pre-existing) · local E2E where applicable
- **Device:** phases 1-2, 3-4, 4-2/4-3 require on-device smoke (owner-run, per workspace rules — no building by agents)

## Open decisions for tomorrow's review

**Ruled 2026-10-11:** on-device lifecycle authority (desktop/Android self-tick, iOS blind-tick wake + batch, data-blind cloud); warm pool functionally unused by the app (physical retirement stays in the cloud-cleanup plan); lifecycle-worker deleted outright in 4-4; §11 thin lifecycle service superseded.

**Ruled 2026-10-11 (pre-launch simplification):** the product is unlaunched — no old app or backend versions exist in the wild. Fresh installs only; existing dev-device data is discarded. All old-version machinery is removed: compatibility windows, schema support windows, version matrices, staged rollouts, soak/telemetry thresholds, sunset gates, kill-switch staging, and the rows-v1 pilot/data-migration bridge (phases 0-3, 1-3, 1-4 deleted; 3-4 is pure deletion). The lifecycle-worker is deleted outright (4-4) instead of frozen/sunset.

**Ruled 2026-10-11 (offline handling — resource-preserving catch-up):** the engine never replays offline time. Non-LLM state (emotion, exhaustion, sleep, dream TTL) advances exactly and for free through any gap; LLM narrative is hard-bounded: short gaps fire ≤ MaxCatchUpBeats sampled beats, gaps ≥ 48h (configurable `LongGapThreshold`) collapse to a single hiatus-framed re-entry beat — ≤3 LLM calls total per entity after any outage (re-entry + dream + outreach), on any wake (keepalive, BGTask, or app open). The entity returns from a two-week outage acknowledging the absence, not simulating it.

1. **Epoch model:** strict single-writer epochs — SIMPLIFIED by the ruling (there is no cloud lifecycle writer; epochs only arbitrate desktop ↔ phone). Strict single-writer remains recommended.
2. **Changeset retention window:** how long deltas are retained before baseline snapshot re-pull replaces them (replaces purge-floor semantics; propose 7–30 days).
3. **Conflict policy table:** confirm per-table-class resolutions (append-only → keep both; configs → LWW REPLACE; deletes → native changeset DELETE replay).
4. ~~Cloud changeset path~~ **RESOLVED 2026-10-11: obsolete** — no cloud engine peer; 2-5 reworked to cloud-account mode with the engine on-device + device-owned backup/restore.
5. **iOS module timing:** Phase 4 is independently schedulable after Phase 3; confirm whether it ships with the first release or follows.
6. **gomobile vs. sidecar-only first:** if iOS slips, does Android-only embedding carry release 1?
7. **Exhaustion folding (new, from the degradation review):** during catch-up, does exhaustion accumulate per *sampled* beat (K) or per *missed scheduled* beat (N)? Recommendation: N — otherwise the sleep/dream economy collapses on low-cadence hosts (cloud track today, iOS under throttling).
8. **Keepalive value (new):** the hourly iOS keepalive is independently droppable (correctness never depends on it) — product call whether background presence is worth the push budget.
