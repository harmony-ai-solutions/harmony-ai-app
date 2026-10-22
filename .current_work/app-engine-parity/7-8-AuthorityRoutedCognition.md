# Phase 7-8 — Engine/App/Cloud: Authority-Routed Cognition (One Brain, Many Presences)

> **Repos:** `harmony-link-private` (engine) · `harmony-ai-app` (app) · `soulbits-cloud-backend` (relay)
> **Created:** 2026-10-12 (owner review follow-up: split-brain review of concurrent multi-device presences; owner-approved direction A+D+input-forwarding)
> **Depends on:** 7-5 (authority relay bridge wired) · 0-1/0-2 (lazy temporal + catch-up — the safety net that makes pausing narration safe) · **after 7-6** (contract 1.2.0; this phase bumps → 1.3.0 — renumber if it lands first)
> **Product framing:** the Soulbits engine is ONE cognition system; an entity is one person who may be playing Minecraft / driving a coding agent on the desktop while you chat with them from the phone. Goal: exactly one active cognition process per entity across the group; every other device is a presence terminal (input in, rendered output out).

## Verified current state (2026-10-12 review — anchor before editing)

1. **Background autonomy has no authority gate.** [EnsureBeatRunnerStarted](harmony-link-private/lifecycle/service.go:88) starts the per-entity beat ticker whenever an automatable entity gets a session — called from the init path (eventprocessor.go:279+333) and resume path (:850+895); gates are only `ShouldAutomateForEntity` + `autonomy_level`. `LifecycleService` is constructed unconditionally (eventserver/server.go:162-163). The app-driven planes are equally ungated: `lifecycle.batch`/`maintenance` (embed/router.go:70/76) and the iOS callers (IOSLifecycleWakeHandler.ts:250, IOSMaintenanceScheduler.ts:216). Zero authority references in `lifecycle/`.
2. **Reactive input is processed locally** wherever it arrives; client engines buffer writes into pending epochs ([buffer-and-forward](harmony-link-private/syncclient/manager.go:13-18)). Merge semantics: conversation rows append-only with engine-minted UUIDv7 (union, no collisions); emotion/lifecycle state `ClassSessionRuntime` REPLACE = LWW (policy.go:56-59). Concurrent reactive cognition is tolerated; concurrent **narration** (beat/dream/outreach message minting) duplicates user-visibly.
3. **The single-writer invariant is per-DB bookkeeping only.** No group-wide arbitration: the relay has zero authority awareness (0 hits in `cmd/sync-relay`). Two devices bridged as authority in one group = silent dataset split brain.
4. **The CDC seam exists.** `store.SetApplyObserver(rag.NewApplyReindexObserver(...))` (cmd/run.go:165-172; enginehost composes the same) fires on applied peer batches — the exact pattern a cognition trigger needs.
5. **Lazy temporal evaluation (0-1)** makes state divergence-by-evaluation impossible — only duplicated *narration* is at risk, which is what this phase eliminates.
6. **Headless delivery precedent.** Outreach writes the exact live message-row shape without a session (D-BEH-04 contract, runner_export_test.go:148-150) and the push plane notifies phones — the same shape a CDC-minted reply uses.

## Design

### 1. Background-plane authority gate

- Inject a live authority predicate (reads `store.Authority()` at call time — NOT the static attach-time flag; authority changes at runtime via yield/handover) into `LifecycleService`, set from `AttachChangesetStore` (eventserver/server.go:109). Nil predicate (no store / standalone device) ⇒ always authoritative ⇒ zero behavior change for single-device users.
- `EnsureBeatRunnerStarted`: when `!authority()` skip ticker registration (log + counter). **Emotion engines stay** — pure lazy reads are harmless and needed for local rendering.
- **Runtime transitions:** on client yield (Manager enable / `enterClientMode`) stop all running beat runners; on authority re-acquire (disable / `EPOCH_HANDOVER` promotion) restart runners for entities with live sessions. Wire through the Manager's start/stop paths; use the runner's existing graceful Stop (don't kill mid-beat).
- Gate `lifecycle.batch` / `lifecycle.maintenance` / `lifecycle.fireCatchUp` (embed/router.go): when not authoritative return a **well-formed result** with `skipped_reason:"not_authoritative"` and zero beats — not an error, so the iOS wake handlers and `parseBatchResult` stay green.

### 2. CDC cognition trigger (authority reacts to synced input)

- New apply-observer alongside the RAG one: when an applied peer batch INSERTs `conversation_messages` rows into interactions containing an automatable, non-muted AI entity (skip rows the entity itself sent; skip user entities), enqueue one reactive cognition event for that entity.
- **Idempotent by construction** — fires once per applied batch; the changeset apply path is exactly-once per (epoch, seq) (re-delivered batches are skipped by the seq cursor). At-least-once relay delivery cannot double-fire.
- **Coalescing:** per-entity debounce window (config, default ~3s) so a message burst triggers one reply; flush on window close.
- **Execution:** the authority may hold no live session (the session is on the phone). Build a one-shot runner via `BuildRunnerForEntity` (build_runner.go:63 — deliberately does NOT start the timer loop) and fire the reactive reply; the reply row uses the exact live row shape (outreach precedent); `presence_type` rides the interaction row so the prompt knows the channel.
- **Think central, deliver local:** the authority mints the reply row; the phone renders on changeset apply; push notification via the existing outreach/push plane (4-4). TTS + reply-mode pacing stay on the presence device (rendering, not cognition).
- Ordering is free: user message + interaction rows commit in one transactional batch ⇒ applied atomically ⇒ the trigger always sees a consistent snapshot.
- **Decision (default):** reactive replies fire regardless of `autonomy_level` (user-initiated conversation ≠ self-initiated action); background beats stay autonomy-gated as today.

### 3. Relay authority registry + lease (metadata-only, data-blindness intact)

- **Role flag in the hello:** the authority bridge (authority_relay.go) sends `role:"authority"` (plaintext metadata, same class as the welcome quota fields — never inside sealed frames); clients send `role:"client"`.
- **Single-authority assertion:** the relay's group registry tracks the authority member per (account, dataset); a second authority claimant is rejected (WS close `authority_conflict`) and surfaced in status/portal. Extend the existing no-decode grep-gate note: role/lease frames are metadata, never content.
- **Lease:** the authority renews a TTL lease (heartbeat, default 60s, config). Registry is in-memory — on relay restart the first authority re-registration wins; a stale authority reconnecting after losing its slot gets `authority_conflict`, demotes itself to client, and may request handover.
- **Local expiry enforcement (the anti-split-brain core):** the authority engine tracks its lease deadline on a monotonic clock minus a skew margin; when renewal fails it **pauses narration** (stop beat tickers + suppress CDC triggers) until renewal resumes. Input is never dropped — it stays in the DB; inputs arriving during a pause answer late (documented degradation).
- **Failover:** lease expiry ⇒ group marked authority-less; v1 = the app surfaces "authority lost — promote this device?" (one tap = the existing [Handover](harmony-link-private/syncclient/client.go:653) / manager Yield path). New authority converges via the 2-2 rejoin rule (baseline + fresh epoch) — unchanged. Auto-election is explicitly out of scope.
- Welcome + `/v1/sync/status` expose `authority_device` (or null) so every member knows where cognition runs.

### 4. Status + contract surfacing

- Engine sync status gains `cognition_authority` (`"local" | <device-id> | null`) and `narration_paused` (lease expired). Contract bump **1.2.0 → 1.3.0** in lockstep (engine canonical fixtures + app manifest/fixtures + drift CLI).
- App: DesktopSyncScreen status card shows where cognition runs; iOS wake/maintenance results surface the skip reason (honest-limits screen); chat screens need no change (3-4's optimistic pending rows already reconcile on apply). i18n all locales. Portal: optional "cognition authority" badge on the device list.

## Failure-mode envelope (the sustainability contract)

| Failure | Behavior | Covered by |
|---|---|---|
| Client offline/flaky | Input queues (pending epoch / relay offline buffer); replies render on reconnect | existing (async by design) |
| Authority offline gracefully | Handover promotes a client | existing `EPOCH_HANDOVER` + §4 UX |
| Authority crashes/partitions (still running) | Lease expires locally ⇒ narration pauses; no dual narration window beyond TTL + in-flight beat | §3 lease |
| Failover | Successor via handover or rejoin rule; partition-window duplicates bounded by lease TTL, merged append-only | §3 + 2-2 |
| All devices off | Nobody narrates; state ages lazily; next wake = bounded re-entry (0-2) + push | 0-1/0-2 |

Accepted residual: the one-person guarantee is statistical — during a lease-TTL failover window two devices can briefly both narrate; worst case is a duplicate beat, never corruption.

## Implementation steps

1. Engine §1: authority predicate + runner gate + stop-on-yield/restart-on-acquire transitions + batch/maintenance/fireCatchUp skip results (+ tests: yield stops tickers, acquire restarts, standalone unaffected).
2. Engine §2: CDC observer + one-shot reactive runner + debounce (+ two-store integration test: client write → authority applies → reply row minted; re-delivered batch does not double-fire).
3. Engine §3 client half: lease renewal + pause/resume in the authority bridge run loop + role flag in the relay hello.
4. Cloud §3 server half: group registry, `authority_conflict` rejection, lease timer, welcome/status fields (+ unit tests; extend tests/e2e/sync_relay.go with a second-authority rejection scenario).
5. Contract 1.3.0 lockstep (engine + app fixtures/manifest, drift CLI green).
6. App §4: status card + iOS skip surfacing + i18n (+ tests).
7. Docs: engine Cognition-System.md (presence + CDC section), Entity-Lifecycle.md (authority gate), Changeset-Sync.md (role flag), app entity-interaction-model.md (one-brain/many-presences note), relay threat model (metadata-only addition); CHANGELOGs.

## Files to create/modify

- Engine: `lifecycle/service.go`, `lifecycle/build_runner.go`, NEW `lifecycle/cdc_trigger.go`, `eventserver/{server.go,eventprocessor.go}`, `syncclient/{manager.go,client.go,authority_relay.go}`, NEW `syncclient/lease.go`, `cmd/run.go` + `enginehost/enginehost.go` (observer registration), `embed/router.go`, config (debounce/lease knobs)
- Cloud: `cmd/sync-relay/{ws.go,syncapi.go}`, NEW group-registry file, `tests/e2e/sync_relay.go`, threat-model doc
- App: `src/services/engine/EngineApiClient.ts` (status types), `src/screens/settings/DesktopSyncScreen.tsx`, `src/services/engine/{IOSLifecycleWakeHandler.ts,IOSMaintenanceScheduler.ts}` (skip surfacing), i18n locales, contract fixtures

## Verification gates

- Engine `go build/vet/test ./...` green incl. the new yield/acquire transition suite and the two-store CDC test.
- Cloud `go build/vet/test ./...` green; compose e2e: second-authority rejection + lease-expiry pause observable in status.
- App `tsc --noEmit` 0 + jest green; contract drift CLI green at 1.3.0.

## Owner device gates (staging, owner-run)

- Authority laptop sleep ⇒ lease expiry ⇒ promote phone from the app ⇒ chat continues; no duplicate beats after heal.
- Partition drill: cut the authority's network while a game session runs ⇒ narration pauses (status shows it), phone input buffers, replies arrive after reconnect — no duplicate dreams/outreach in the merged history.
- Two-device interactive scenario: phone chat while the authority hosts two plugin sessions — one reply stream, both surfaces converge.

## Progress checklist

- [x] §1 authority gate + transitions landed, tests green
- [x] §2 CDC trigger landed, two-store test green
- [x] §3 lease + registry + conflict rejection (engine + relay), e2e green
- [x] §4 contract 1.3.0 lockstep + app UX + i18n
- [x] Docs + changelogs updated
- [ ] Owner device gates passed — owner-run staging drills (see below), NOT verified in-environment

### Owner device gates (restated — owner-run staging drills, unchecked)

1. **Authority laptop sleep ⇒ lease expiry ⇒ promote phone from the app ⇒ chat
   continues; no duplicate beats after heal.**
2. **Partition drill:** cut the authority's network while a game session runs ⇒
   narration pauses (status shows it), phone input buffers, replies arrive after
   reconnect — no duplicate dreams/outreach in the merged history.
3. **Two-device interactive scenario:** phone chat while the authority hosts two
   plugin sessions — one reply stream, both surfaces converge.
