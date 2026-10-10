# Architectural Assessment: App-Side Engine Feature Parity vs. Cloud-Hosted Soulbits Engine

> **Date:** 2026-10-10 (original assessment) · 2026-10-10 follow-ups added (§7–§10)
> **Question assessed:** Does it make sense — technologically, feature-parity-wise, and from a maintenance standpoint — to make the Harmony AI App function (almost) identically to the Soulbits engine (entity control, interaction model, memory, lifecycle behavior, full stack — UI excluded), instead of running a Soulbits engine per user inside the cloud?
> **Sources:** `harmony-ai-app`, `harmony-link-private` (the engine), `soulbits-cloud-backend` — memory banks, `.planning` context, and code-level verification (Oct 2026 state).
> **Follow-ups:** §7 — engine core as a shared module across desktop/cloud/mobile; §8 — iOS background-execution reality (verified against Apple docs); §9 — industry research (web-verified exemplar teardowns, wake-channel inventory, on-device compute numbers); §10 — consolidated tiered-hosting decision.

---

## 1. Executive Summary

**Verdict: No. Keep the engine authoritative. Pursuing app-side engine parity would be the most expensive possible way to deliver a strictly worse product.**

Three findings drive this:

1. **~65–75% of the engine's behavioral surface is portable in principle but represents a 25–40k LOC TypeScript re-implementation** (cognition pipeline, provider clients, memory consolidation, emotion engine) — while **the remaining 25–35% is architecturally impossible on a phone** (always-on autonomy/beats/outreach/emotion decay, multi-device authority, server-side inference economics). "Almost identical" is not achievable; the autonomy dimension degrades by construction, not by effort.

2. **The cloud route is already ~80% shipped.** `soulbits-cloud-backend` is 11 phases with 8 complete: per-user engine hosting (Fargate + warm pool + S3 snapshots), inference gateway (RabbitMQ → VastAI/cloud GPU workers), auth/subscriptions/coins/rate limiting, offline autonomy (`lifecycle-dispatcher` + `lifecycle-worker` running the engine's own `EntityBeatRunner` against the user's snapshot), and push. The app already speaks cloud mode end-to-end. Option B is not a plan to evaluate — it is the system you are already running.

3. **The maintenance math is decisive.** The codebase history shows that keeping merely the *data layer* aligned across app and engine (schema parity gates, tombstone protocol D1–D87, wire-format guards, 35-table allowlists) is already the dominant engineering cost — and that is with a single behavior implementation. A second, full behavioral implementation in TS would double the behavior-change cost per feature and add a *behavioral-equivalence* test burden that is inherently brittle (tokenizer drift, float math, LLM nondeterminism, timing).

**Recommended posture:** engine stays the single source of entity behavior (cloud for consumers, self-hosted desktop Harmony Link for power users); the app stays presentation + synced cache; offline capability is addressed by the already-planned on-device *inference* (Executorch) as a degraded chat mode — **not** by porting the orchestration/lifecycle stack. Where specific app-side behaviors are genuinely wanted (emoji→emotion effects — already native), port narrow, pure, well-bounded functions only.

---

## 2. What "feature parity with the engine" actually means

The question excludes UI. What remains is the engine's entity-control stack. Inventory with code anchors and scale:

| # | Subsystem | Engine location (Go) | Scale | What it does |
|---|-----------|----------------------|-------|--------------|
| 1 | **Entity & lifecycle data model** | `database/controllers`, `utils/delete_stamps.go` | part of 18.2k LOC `database/` | Derived-immutable IDs (`{slug}-{timestamp}`), tombstone delete→GC protocol, 8-child cascade under one `now`, purge floor / rebuild-required |
| 2 | **Interaction & presence model** | `eventserver` (7.5k LOC) | large part of package | Interactions (world/private/group), participant keys, `EntitySessionManager` w/ `SharedCognitionState`, phone-session suspend/resume (5-min TTL), `PARTICIPANT_SET_UPDATE`, per-channel presence, current-situation prompt context |
| 3 | **Cognition pipeline** | `modules/cognition/` | ~10.6k LOC (processor 58KB, prompt_builder 102KB, memory_consolidator 27KB, evaluate, state, macros, prefetch) | Thought Processor (response cycle orchestration), 3 prompt-builder modes (conversational 9-section / beat 7-section / compaction), emotion-effect evaluation, delayed action injection |
| 4 | **LLM backend abstraction** | `modules/backend/`, `providers/` (5.1k LOC) | 15 provider types | OpenAI family (+extended sampling), Google/xAI/Anthropic, CharacterAI, Kajiwoto, Kindroid, SoulbitsCloud; streaming; sampling presets; model filtering |
| 5 | **Memory system** | `modules/cognition/memory_consolidator.go`, `modules/rag/` | ~27KB + rag pkg | Hierarchical compaction cascade (messages → L1…L8), recency protection (10-min), token-aware history loading (tiktoken-go), interaction summarization, RAG vector memory (chromem-go), orphan sweeps |
| 6 | **Emotion engine** | `emotion/` | 731 LOC | Ekman8 with decay/dampening/crystallization, 7-bit bitfield encoding, Plutchik-dyad prose builder |
| 7 | **Autonomy / beat system** — *"the entity that controls the entities"* | `lifecycle/` (1.7k LOC core, plus cognition/rag integration) | runner.go 39KB + outreach + state + config | `EntityBeatRunner` goroutine loop per entity: beat intervals, exhaustion/sleep, inner-monologue ring buffer, autonomy levels, **Outreach/ReconEvaluator** (two-phase LLM flow: deliberation → decision; edit vs follow-up), DreamBeats w/ TTL, relationship profiles |
| 8 | **RAG/ActionGraph/movement/vision/imagination** | `modules/rag`, `modules/movement`, `modules/vision`, `modules/imagination` | within modules' 12.6k LOC | Vector action matching, animation selection, ActionGraph execution to game-engine plugins, VLM image labeling, image generation |
| 9 | **Sync protocol (server side)** | `eventserver/synchronization.go` | within eventserver | 35-table master-slave LWW sync, tombstone GC, schema-version gate, size-estimate confirmation, per-record error codes |
| 10 | **Infra** | `management/` (4.1k), `integration/` (2k), `logging/`, `push/`, Docker orchestration | ~8k LOC | Management REST API, WS event server, plugin ecosystem, log streaming, FCM |

**Engine totals: ~126k non-test Go LOC across 775 files, plus ~88k LOC of Go tests (407 files), plus a ~30k LOC management frontend.**

### What the app has today

The app (`harmony-ai-app`, ~125k LOC TS/TSX) is a **deep data-layer replica and a thin behavioral client**:

- ✅ **Mirrored:** full SQLite schema (55/55 tables, parity-gated), entity ID derivation + tombstone lifecycle (for sync correctness), interactions/participant keys, emoji actions + Ekman8 *deltas* (client-side resolution only — the *engine* applies effects to emotion state), provider/module config editing (schema-driven forms), character cards, sync client with clash resolution, cloud session lifecycle.
- ❌ **Absent (verified by grep — no prompt building, no LLM calls, no inference):** cognition/thought processing, all prompt builders, provider clients (any actual completions), memory compaction/consolidation, RAG/vector anything, emotion engine (decay/crystallization — app only *stores* synced `emotion_state`), beat runner/outreach/dreams, ActionGraph/movement, vision labeling, imagination.

So "parity" means re-implementing items 2–8 in TypeScript **and** re-architecting item 9 (the app would have to become an authority, see §4.3).

---

## 3. Option A — App becomes the engine (TS re-implementation)

### 3.1 Portability matrix

| Subsystem | Portable to RN/TS? | Effort | Parity risk | Notes |
|-----------|--------------------|--------|-------------|-------|
| Cognition prompt builders | 🟡 Yes | High | **Very high** | Pure text assembly, but "identical behavior" requires byte-equivalent section construction. `tiktoken` JS ports exist but must match `tiktoken-go` counts exactly or token-aware history loading diverges. |
| Provider clients (15) | 🟡 Yes | High | Medium | HTTP + streaming is portable; CharacterAI/Kajiwoto/Kindroid carry undocumented quirks. The app already maintains the *config schemas* — but never the *clients*. |
| Memory consolidation | 🟡 Mostly | High | **Very high** | The engine needed a phase-separated READ→LLM→WRITE design to avoid deadlocking its single SQLite connection; RN SQLite has *different* single-connection semantics (the app's own memory bank documents `withTransaction` insert-id hazards). The cascade is LLM-in-the-loop — every divergence silently changes what entities remember. |
| Emotion engine | 🟢 Easy | Low | Medium | ~700 LOC of pure math. Float-order drift is user-invisible. The one cheap, defensible port. |
| Beat runner / autonomy | 🔴 **No** | — | — | See §3.2. Requires an always-on process. |
| Outreach (proactive messages) | 🔴 **No** | — | — | By definition fires when the app is *not open* → needs server-side trigger + push regardless. |
| RAG / vector store | 🟡 Yes | Medium | Medium | `chromem-go` → JS vector store port; embedding providers already HTTP-based. Feasible; new failure surface. |
| ActionGraph / movement / plugins | ⚪ N/A | — | — | Targets game engines over WS; meaningless on mobile. Correctly out of scope. |
| Interaction/session model | 🟡 Partially | Medium | High | Session suspend/resume, shared cognition state, multi-session routing are server concepts; the app already has the client half. |
| Sync authority | 🔴 **Redesign** | Very high | — | See §4.3. |

### 3.2 The hard blocker: lifecycle behavior needs an always-on process

The product's differentiators — *"entity that controls the entities,"* lifecycle, memory, autonomy — are **temporal** systems:

- Beat intervals fire on minutes-scale timers, continuously.
- Emotion **decay** is time-based math applied to live state.
- Exhaustion/sleep cycles span hours; DreamTTL governs message lifespans.
- Outreach cooldowns (`OutreachIntervalMin`) assume the process that owns the entity is alive even when the user is not looking.

On Android this means a foreground service (persistent notification, battery drain, OEM task-killer battles — the exact class of fragility the floating-chat work already fights) and it is **effectively impossible on iOS** (no long-running background timers; BGTaskScheduler is opportunistic and seconds-bounded). This is not an engineering-effort problem; it is an OS policy problem. *(Refined in §8–§9: iOS supports a genuine degraded tier — foreground compute, lazy temporal state, overnight maintenance, push-driven outreach, widget/Live-Activity presence — but no continuous loop; Apple DTS's on-record answer to "run code every 15 minutes" is "You can't.")*

Notably, **even the cloud route needed dedicated machinery for this**: the `lifecycle-dispatcher`/`lifecycle-worker` exist precisely because entity autonomy must continue when the user's session task is scaled to zero. The requirement "entities live while you're away" *inherently* pins behavior to a server. Moving the engine into the app does not remove that requirement — it breaks it.

### 3.3 Secondary blockers

- **Inference economics & monetization.** Engine-in-app means every LLM/TTS/STT/embedding call originates on-device → users need their own API keys (power-user niche = the existing self-hosted desktop story), and the entire Soulbits commercial model (tiers, coins, rate limits, `model_tier_access`, VastAI arbitrage) has nothing to meter. The `soulbitscloud` provider's server-side model filtering exists *because* inference is centralized.
- **Privacy paradox.** The cloud value prop is per-user encrypted, isolated entity DBs + managed inference with zero user config. Engine-in-app with user keys is a different product — it already exists and is called self-hosted Harmony Link.
- **Battery/thermal.** Compaction cascades + embeddings + beat loops on a phone = the app is permanently warm. The floating-chat overlay work shows how expensive even *timers* are on this platform.

### 3.4 Effort estimate for the portable 65–75%

Items 2–8 re-implemented + hardened + tested to the repo's own quality bar (146 unit suites for the *client* today; the engine carries 88k LOC of tests):

- Cognition + providers + streaming: ~12–18k LOC TS
- Memory/compaction/RAG: ~8–12k LOC TS
- Emotion + interaction/session server-half: ~3–5k LOC TS
- Sync authority redesign + N-way conflict handling: ~5–8k LOC TS (research-grade risk)
- Behavioral-equivalence test harness across two runtimes: ongoing tax, forever

Realistic total: **25–40k LOC TS + a multi-quarter program (9–18+ months at current team velocity)** — to deliver a system that still cannot do the autonomy third, still needs a server for outreach/push, and now exists twice.

---

## 4. Option B — Cloud-hosted engine (current route)

### 4.1 Status: largely built

- **Session hosting (Phase 07 ✓):** per-user Fargate task running the actual Harmony Link container; init-container pulls the user's SQLite snapshot from S3 (`s3://soulbits-sessions/{user_id}/`); sidecar uploads on SIGTERM after WAL checkpoint; 5-min grace + distributed SETNX shutdown; warm pool with hysteresis; 5-condition readiness contract with cert pinning.
- **Offline autonomy:** `lifecycle-dispatcher` (ZSET claim → audit rows → RabbitMQ) + `lifecycle-worker` (CGO binary) consume the **engine's own** `NewEntityBeatRunner` / `PersistOutreachMessage` against the snapshot SQLite — beats, outreach, dreams, compaction, reconcile run *while the user is offline*, then converge via snapshot + sync. `push-service` delivers via FCM.
- **Inference gateway (Phase 08 ✓):** 6 OpenAI-compatible endpoints, PASETO/API-key auth, tier-driven rate limits, RabbitMQ → Go workers on VastAI (idle GPU) with cloud-GPU overflow, DLQ handling, worker fleet monitoring.
- **Commercial layer:** 3 tiers, coins, Google Play Billing / LemonSqueezy / CoinGate, atomic photo quotas.
- **App-side:** cloud mode is the mature path — `CloudSessionService` (202-provisioning poll loop), conduct-proxy WS with PASETO subprotocol, `soulbitscloud` provider with token injection + auto-refresh propagation, live model catalog, default-config auto-seeding.

Open items are known and bounded: Phase 8.1 in progress, per-user DB encryption (D-01 gap — target design exists: Secrets Manager per-user keys), per-user IAM scoping restore, baremetal placement (v2 cost reduction path).

### 4.2 Cost profile

Per-user Fargate task + snapshot storage is the price of 24/7-capable entity isolation — and it is *the* enabler of the product's core differentiators. The architecture already attacks cost three ways (warm pool recycling, VastAI-first inference, baremetal v2). A dual-implementation strategy would not reduce this cost; it would add a second R&D line while the Fargate bill stays (because autonomy/outreach still need the server).

### 4.3 The sync-protocol asymmetry (why "app as engine" breaks the current design)

The current protocol is deliberately **engine-authoritative master-slave**: LWW upsert-by-PK, unconditional delete propagation, purge floor forcing app rebuilds, schema-version gating, size-estimate confirm. The app's entire D1–D87 tombstone discipline works because exactly one authority mints state.

If the app were also an engine, you get **multi-master** state: app-engine ↔ cloud-engine ↔ (other devices) with LWW timestamps across clocks that were never designed to arbitrate concurrent *behavioral* writes (emotion updates from a local beat loop racing the cloud lifecycle-worker's beats on the same entity). The purge-floor/rebuild mechanism — currently a correctness *feature* — becomes a live grenade. This alone is a research-grade redesign, and it only exists because of the decision to duplicate the engine.

---

## 5. Maintenance perspective

### 5.1 The evidence already in the repos

Keeping just the **data layer** synchronized across app + engine is demonstrably the dominant maintenance cost:

- Schema parity is gated by tests (`55/55 + 3 Go-only allowlisted`, `syncGcTablesParity.test.ts` pinning a hard-coded 35-table list).
- The tombstone/delete protocol required an 87-decision register (D1–D87) executed across three repos in lockstep, with placeholder migrations reserved for *numbering parity*.
- Wire-format truth needs dedicated regression guards ("PascalCase read silently yields 0/0/0").
- Even the **Go→Go** reuse of the beat runner by the cloud worker required a documented OUT-OF-REPO mirror obligation (`ShouldAutomate` gate) — same language, same module, still a divergence hazard.

That is the cost of keeping *data* aligned with **one** behavior implementation. Option A adds:

- **Double implementation of every behavior change** — emotion decay tuning, prompt-section tweaks, compaction thresholds, beat scheduling: authored twice (Go + TS), reviewed twice, released in lockstep.
- **Behavioral-equivalence testing across runtimes** — brittle against tokenizer version drift, floating-point order, LLM nondeterminism, and timer jitter. Data parity is checkable with schema diffs; *behavior* parity has no cheap oracle.
- **Feature velocity halving** on the differentiating surface — every roadmap item that touches "what entities are" now has a 2× implementation tax, permanently.

### 5.2 Comparative summary

| Dimension | Option A (parity in app) | Option B (cloud engine, current) |
|-----------|--------------------------|----------------------------------|
| Autonomy/lifecycle 24/7 | ❌ impossible (OS policy) | ✅ built (Fargate + lifecycle-worker) |
| Outreach while app closed | ❌ needs server anyway | ✅ push-service + outreach beats |
| Multi-device consistency | ❌ multi-master redesign | ✅ single authority + proven sync |
| Inference economics | ❌ user API keys; no metering | ✅ tiers/coins/gateway (built) |
| Behavior implemented once | ❌ twice (Go + TS) | ✅ once |
| Offline chat | 🟡 full local (but unmetered) | 🟡 degraded — solved by planned Executorch local inference |
| Privacy story | 🟡 = self-hosted desktop today | ✅ per-user isolated encrypted DB (D-01 gap targeted) |
| New code needed | ~25–40k LOC TS + sync redesign | finish Phase 8.1 + D-01 encryption + IAM scoping |
| Time to "almost identical" | 9–18+ months, autonomy still missing | ~0 (operating) |

---

## 6. Recommendation

1. **Keep the engine as the single behavioral authority.** Cloud-hosted per user (Soulbits consumer product) + self-hosted desktop Harmony Link (power users) is a coherent two-deployment, one-implementation strategy. The app remains presentation + replicated cache — which it already does extremely well.

2. **Treat on-device inference (Executorch, already on the P2 roadmap) as the offline answer — not orchestration parity.** Local model for basic chat continuation when offline is a bounded, high-value feature; lifecycle/memory/emotion continue converging via sync when reconnected. This gives ~80% of the perceived benefit of "app-side engine" at ~5% of the cost and none of the divergence.

3. **If app-side behavior is ever wanted, port only narrow pure functions** — the emotion engine (731 LOC) is the one defensible candidate (e.g., instant local emotion echo for emoji actions while offline). Keep ports behind equivalence tests against engine outputs, and treat them as caches/degradations, never as authorities.

4. **Close the known cloud gaps that actually threaten the parity story you already sell:** per-user DB encryption (D-01) and per-user IAM scoping restore — these are the items with real privacy/architecture weight still open.

5. **Revisit triggers (documented so this assessment ages well):** if Fargate per-user economics break at scale *and* baremetal v2 doesn't fix it, the alternative is cheaper placement of the same engine — not a second engine in the app.

---

## 7. Follow-up A — Engine Core as a Shared Module (Desktop / Cloud / Mobile)

*Question: could the engine core be modularized so desktop app, desktop engine, and phone app all consume it as one module? Assessed for technical possibility, not complexity.*

### 7.1 The seam already exists — and is proven in production

The engine's core/transport split is real, not aspirational:

- The cloud `lifecycle-worker` imports `hl_database`, `emotion`, `lifecycle`, `modules/cognition`, `modules/common`, `push` **directly as Go packages** — no eventserver, no Wails, no transports. The engine core already runs headlessly against an injected DB handle (the `D-BEH-04` explicit-injection seam in `NewEntityBeatRunner`: caller-owned `*sql.DB`, no auto-start coupling, one-shot `FireBeat`/`FireDreamBeat`/`FireOutreachBeat` entry points).
- Crucially, the beat runner was **designed for detached firing**: it does not own a timer when constructed via `NewEntityBeatRunner` — the caller decides when beats happen. That is exactly the shape a host-chosen scheduling model (foreground loop, BG-task window, server timer) requires.

### 7.2 Integration channels per platform

| Channel | Mechanism | Android | iOS | Notes |
|---|---|---|---|---|
| **A. In-process library** | `gomobile bind` → `.aar` / `.xcframework`, wrapped in an RN Turbo Native Module | ✅ | ✅ | Go runtime + goroutines + CGO SQLite all run on both platforms. Boundary must be a narrow **JSON facade** (`EngineInit(config, dbPath)`, `EngineHandleEvent(json)`, events out via native emitter) — gomobile's type surface can't export the full API. ~15–30 MB per ABI. Dies with the app process. |
| **B. Local sidecar process** | Engine binary shipped as `libengine.so` in `jniLibs`, exec'd from `nativeLibraryDir` (W^X-compliant on API 29+, Termux-proven), kept alive by a foreground service | ✅ best fidelity | ❌ **impossible** (no child processes) | The elegant one: **the app is already an engine WS client** — it connects to `ws://127.0.0.1` and nothing else changes; sync, `INIT_ENTITY`, sessions all speak the already-parity-maintained protocol. The module boundary becomes the protocol itself. |
| **C. WASM (`wasip2`)** | Go 1.24+ target; embed a WASM runtime (RN: WasmEdge/wasm3 — immature) or run in a web desktop client | 🟡 weak | 🟡 weak | Blockers: no listening sockets, CGO SQLite must swap to `modernc.org/sqlite` (pure Go) with a VFS shim, FS-dependent tiktoken/chromem data needs abstraction. Keep alive only if a browser-based desktop client (Tauri) becomes real. |

### 7.3 Consumer matrix

| Consumer | Best channel | Fidelity |
|---|---|---|
| Desktop engine (Harmony Link) | Already is the module | Full — the reference host |
| Desktop app (Wails UI / future client) | Go API in-process today; Tauri/Electron later via sidecar or WASM | Full |
| Android app | **Sidecar (B)** > in-process (A) | Near-full incl. background via foreground service (accepting battery/notification cost, Android 14 FGS typing, Android 15 `dataSync` 6 h/24 h cap, OEM killer caveats — see §9.2) |
| iOS app | In-process (A) only | **Degraded tier** — foreground compute + the mechanisms of §8 |

### 7.4 What modularization cannot fix

1. **OS process policy.** Modularization changes *where* the engine runs, not *what the OS allows*. iOS gets a foreground-only engine with opportunistic windows (§8); 24/7 autonomy there remains cloud-only. Android gets real continuity only at the cost of a persistent foreground service.
2. **The sync layer has no peer mode in Go.** Engines are always masters; the slave half lives in the app's TS code. A phone running a local engine while the cloud runs one for the same user = two masters = the multi-master problem from §4.3, relocated. Clean resolution: the app already models **one authority per source** (`selfhosted`/`cloud` watermarks + switch warnings) — a local engine slots in as a third source (*"local" is just self-hosted at `127.0.0.1`*). True concurrent engine↔engine replication is the only genuinely new protocol work modularization would require.
3. **Binary constraint (minor):** `mattn/go-sqlite3` (jgiannuzzi fork, SQLCipher-class encryption) = CGO. Fine for channels A/B; only channel C (WASM) needs a driver swap.

### 7.5 Verdict

Technically possible — and this is the **correct version** of the "app-side parity" idea: instead of a 25–40k LOC TS re-implementation with permanent behavioral divergence (§3), one Go core with tiered hosting — desktop = full host (today), cloud = full host (today), Android = near-full local host via sidecar, iOS = degraded tier per §8. The headless-worker seam proves consumability; what's missing is a stable facade (build targets + JSON boundary + config/DB injection), the Android sidecar packaging story, and a decision on sync authority. Bounded engineering, not research risk.

---

## 8. Follow-up B — iOS Background-Execution Reality (verified)

*Question: how do iOS apps do notifications and background wake-ups? Isn't there a system to schedule a timer that wakes the app?*

### 8.1 The toolbox

| Mechanism | What it does | Budget | Who controls timing |
|---|---|---|---|
| Local notifications | Display a scheduled notification | ≤64 pending; **display-only, zero code runs at fire time** | App schedules, OS fires |
| **Silent/background push** (`content-available: 1`) | Wake app in background to process | **~30 s**; Apple guidance **"don't send more than two to three per hour"**; coalesced (new discards undelivered old); daily device-wide energy budget; **not delivered if user force-quit the app**; Low Power Mode suppresses | Server initiates, OS decides |
| `BGAppRefreshTask` | Short content refresh | ~30 s; max **1 pending**; timing learned from usage patterns; DTS: *"common scenarios where it won't grant you any background execution time at all"* | **System** — opportunistic |
| `BGProcessingTask` | Long maintenance (ML, DB) | **Minutes**; runs **only when device is idle**, typically charging/overnight; killed when user touches device | **System** — opportunistic |
| `BGContinuedProcessingTask` (iOS 26) | Continue foreground-started work | Minutes+; **must start in the foreground from a user action**; Live Activity progress UI; no-progress tasks killed first | User initiates |
| HealthKit background delivery | Wake app on health-data change | Handler seconds; **≤ once per frequency period** (many types hourly); 3-strike disable | **System** |
| Notification Service Extension | Modify/decrypt an incoming push before display | ≤30 s; **network allowed** | Server initiates |
| Notification actions / quick-reply | Process the user's reply to a notification | Short; system launches the app in background for the handler | **User** initiates |

### 8.2 The health-app illusion

Health apps look like background compute, but the direction is inverted: **the OS (and Apple Watch) owns the sensor pipeline and the HealthKit store**; apps register `HKObserverQuery` + a background-delivery entitlement and are woken as throttled *guests*. The app is never the always-on actor. The equivalent correct architecture for Soulbits: the always-on actor is the cloud engine (the "daemon"), the phone is the woken guest — which is the current architecture.

### 8.3 What Apple rules out

There is **no primitive for "run my code every N minutes on an app-owned timer."** Apple DTS (Developer Technical Support), on record: there is *"no general-purpose mechanism"* for running code continuously, at a specific time, or *"periodically at a guaranteed interval"* — the short answer to "how do I run code every 15 minutes?" is **"You can't."** Every wake channel is system-opportunistic or server-initiated-and-throttled; misuse of category-gated continuous modes (audio, VoIP, location) has a documented enforcement history (§9.6).

### 8.4 The 30-second hypothesis — evaluated

> *"If the 30-second budget is the constraint, we will reduce the runtime of the beat loops to be faster than thirty seconds."*

**The per-beat runtime already fits — that was never the problem.** A beat = prompt build + one LLM call + SQLite persist:

- Cloud LLM call: 2–20 s → fits.
- On-device (2023+ flagships): a ~150-token beat at measured mobile LLM rates (17–61 tok/s for 1–2B class, §9.3) = **~2.5–10 s** → fits comfortably; marginal on older hardware once cold-start overhead is counted.

**The binding constraint is wake-up frequency, which is 5–30× short of a 5–15 min heartbeat:**

- Silent push: guidance ceiling 2–3/hour; production reports **~30–50 % effective delivery**; coalesced; zero after force-quit; zero in Low Power Mode.
- `BGAppRefreshTask`: a hint that may never fire; when it does settle in, reported cadence is ~20–30 min, with drops below ~20 % battery, thermal throttling, and system-wide off in Low Power Mode.

So: 30 s ≈ *sufficient per beat*; wake cadence ≈ *insufficient by an order of magnitude*. Reducing beat runtime below 30 s is necessary but not sufficient — no legitimate iOS mechanism will hand you the window at beat cadence.

### 8.5 Engine subsystem → iOS mechanism mapping

| Engine behavior | iOS verdict | Mechanism |
|---|---|---|
| **Outreach** (entity messages you proactively) | ✅ **Fully works — already built** | *Visible* pushes are **not** throttled like silent ones. Cloud lifecycle-worker computes outreach → FCM/APNs delivers. NSE can decrypt/modify in-flight (≤30 s, network allowed). |
| **Dreams / memory compaction / consolidation** | ✅ Genuinely good fit | `BGProcessingTask` — minutes of runtime, idle+charging, designed for DB/ML maintenance. *"Your companion dreams while your phone charges overnight."* Caveat: system decides when; can be days apart. |
| **Emotion decay** | ✅ Works with a restructure | Decay is pure math over `(state, elapsed)` — evaluate **lazily on read** (render/prompt-build/sync) instead of on ticks. No wake-ups needed. |
| **Sync-on-wake / catch-up** | ✅ | `BGAppRefreshTask` + the 2–3 silent pushes/hour → pull engine state when allowed; plus full catch-up on every foreground entry. |
| **Scheduled "utterances"** | 🟡 Partially | ≤64 pre-scheduled local notifications — content must be **pre-computed** (foreground or server); no code runs at fire time. |
| **Beat loop / inner monologue** (minute-scale continuous) | ❌ | 2–3 throttled, coalesced wakeups/hour with 30 s budgets ≠ beat cadence. Irreducibly server-side (or Android-sidecar-side). |
| **Guaranteed/precise timing of anything** | ❌ | Explicit platform design; battery philosophy. |

**Refined iOS tier (supersedes "foreground-only"):** foreground engine (full) + overnight `BGProcessingTask` maintenance + lazy temporal math + server-driven outreach + widget/Live-Activity presence (§9.5). What it can never be is the *continuous inner life* — the unobserved beat loop between app opens has no host on iOS.

---

## 9. Follow-up C — Industry Research: How Other Apps Solve This

*Web-verified research (Apple/Google primary sources, Apple DTS statements, engineering blogs, app-review precedent). Claims labelled VERIFIED / REPORTED / INFERRED as in the research log.*

### 9.1 Exemplar teardowns — nobody runs the loop on-device

- **AI companion apps (Replika, Character.AI, Kindroid, Nomi, Paradot, Chai, Talkie…): all server-authoritative + push.** Character.AI's engineering blog confirms a purely cloud inference stack (>20k queries/s, server-side KV cache). Replika/Kindroid/Nomi proactive messaging is server-scheduled (field tests: Nomi ~11 unprompted messages in 12 days, with quiet-hours and cadence dials — all server policies). **No public teardown, patent, or job post documents any on-device autonomous lifecycle loop in this category.** The absence of evidence across every vendor is itself the strongest evidence.
- **Virtual pet / tamagotchi apps (Pou, Finch, Talking Angela): time-skip catch-up simulation on launch.** Store `t_last`; recompute pet state from elapsed time on load ("if you neglect him… he will be dirty, sick, and sad *until you return*"). No background loop; a few scheduled local notifications in between.
- **Idle/incremental games: elapsed-time math with fixed-step replay.** `offline_earnings = rate × min(elapsed, cap) × modifier`; non-linear mechanics replay missed time **in fixed steps with a clamp** ("a single giant dt would distort them" — IdleKit offline-progress plugin). This is the *time-compressed catch-up* primitive, documented and shipping at scale.
- **Habit apps (Duolingo): server-authored, behavior-triggered notifications.** Routine notifs fire around the user's *observed* habit window, max 2/day, chosen by a server-side bandit over ~200M reminders — not device timers.
- **Alarm/sleep apps (Alarmy, Sleep Cycle): category-gated background audio, at the OS's mercy.** Alarmy's own release notes: OS restrictions are *"making it difficult for Alarmy to operate reliably in the background… risk of forced shutdown by the OS increases,"* advising users to remove it from background when idle. Even the category that legitimately needs background time lives on sufferance.

### 9.2 Wake-channel inventory (condensed; iOS unless noted)

| Channel | Budget | Initiation | Key limits | Can host a beat? |
|---|---|---|---|---|
| Silent push | ~30 s | Server | 2–3/h guidance; ~30–50 % effective; coalesced; LPM/force-quit = zero | Opportunistic only |
| Visible push + NSE | ≤30 s (network allowed) | Server | Not throttled like silent; still no wake after force-quit | Short compute (decrypt/enrich) |
| Notification action / quick-reply | Short | **User** | System launches app in background for the handler | User-initiated beat |
| `BGAppRefreshTask` | ~30 s | System | 1 pending; may never fire; ~20–30 min when settled; <20 % battery drops; LPM = off | Fallback maintenance |
| `BGProcessingTask` | Minutes | System | Idle + charging; ~10 pending; killed on device use | **Overnight dreams/compaction** |
| `BGContinuedProcessingTask` (iOS 26) | Minutes+ | **User** (foreground-start) | Progress UI; no-progress killed first | Not autonomous |
| WidgetKit timeline | Render only | System | **40–70 refreshes/day (~15–60 min)** — closest thing to a legitimate periodic channel; pre-renders future entries | No code on tick; **presence** |
| Live Activities (push) | Display only | Server | Priority-5 updates unmetered; 8 h life; 4 KB | **Presence illusion** |
| watchOS refresh/complication | Short | System | ~4/h with active complication | Small maintenance |
| HealthKit delivery | Handler seconds | System | ≤1/h many types; 3-strike disable | Category-gated |
| PushKit/VoIP | — | Server | **Closed loophole**: must report a CallKit call in the same runloop or app is killed; repeat → blacklisted | **No** |
| Background audio | Indefinite | App | **Rejection precedent** (silent-audio keep-alive) | Abuse — no |
| Location (SLC/regions) | ~10 s | System | Category-gated; ~20 regions; BAR-off disables; 2.5.4 misuse rejections | No |
| **Android:** WorkManager | — | System | Min 15 min periodic; Doze defers | Periodic fallback |
| **Android:** FGS (`dataSync`/`specialUse`) | Hours | App | Android 14 typed FGS; **Android 15 `dataSync` cap 6 h/24 h**; OEM killers (dontkillmyapp) | **Near-continuous, opt-in** |
| **Android:** exact alarms | — | App | **Denied by default since Android 14** | Alarm-class apps only |
| **Android:** FCM high-priority | — | Server | Wakes app in Doze; **downgraded if it doesn't produce a notification** | Sync nudges |

### 9.3 On-device compute numbers

| Runtime / device | Model | Throughput |
|---|---|---|
| llama.cpp CPU, iPhone 15 Pro (peer-reviewed bench, arXiv 2505.06461) | Llama-3.2-1B | ~17 tok/s |
| MLX, iPhone 17 Pro (2026 shootout) | Qwen 3.5 2B | ~61 tok/s |
| LiteRT-LM, iPhone 17 Pro | Gemma 4 E2B | ~55 tok/s |
| ExecuTorch SpinQuant, OnePlus 12 | Llama-3.2-1B | ~50 tok/s (TTFT 0.3 s) |
| Android flagships (S22/S24/OP12) | Llama-3 8B | ~8–11 tok/s |
| **Apple Foundation Models (iOS 26)** | **3B, OS-provided** | **Free, offline, Neural Engine — no model download, no API cost** (requires Apple Intelligence hardware) |

**Beat-fit math:** a 150-token beat ≈ **2.5–10 s** on 2023+ flagships. Comfortable inside 30 s — the problem is being handed the 30 s at beat cadence (§8.4).

### 9.4 Named architectural patterns (with engine mapping)

1. **Server-authoritative + push delivery** — the heartbeat, deliberation, decay, dreams live server-side; phone renders. *(= current Harmony Link cloud architecture. Every companion app.)*
2. **Lazy / deferred state evaluation ("stateless time function")** — store `(state₀, t₀)`; compute `f(state₀, elapsed)` on read; never tick. *(→ engine's emotion decay, exhaustion/sleep, DreamBeat TTL.)*
3. **Time-compressed catch-up simulation** — replay missed intervals as one condensed pass: fixed-step accumulator, clamp/cap, reduced-rate factor; for LLM loops, **sample K representative beats, not N**. *(→ beat catch-up on any wake; note the engine's one-shot `FireBeat` seam is already this primitive.)*
4. **Pre-computed future states** — draft plausible outputs ahead of time; bake into ≤64 local notifications, WidgetKit timeline entries, server-queued outreach. *(→ presence illusion + proactive messages without wakes.)*
5. **Hybrid tiering** — foreground full engine; background opportunistic maintenance; server continuity; Android optional sidecar. *(→ §10 consolidated model.)*
6. **Continuous background simulation without entitlements** — no known legitimate case on iOS; historical attempts (silent-audio keep-alive, pre-iOS-13 VoIP-push abuse, location misuse) ended in rejection or Apple closing the channel. **Cautionary: do not design against a loophole.**

### 9.5 Notable opportunities surfaced

- **Apple Foundation Models framework (iOS 26):** a free, offline, OS-managed 3B model with guided generation — arguably the ideal target for on-device beats on iOS (no download, no inference cost, no key management).
- **WidgetKit timelines (40–70 refreshes/day):** the *closest legitimate thing to a periodic channel* — and it renders future entries without running code: a pre-computed emotion curve / companion status on the home screen.
- **Live Activities priority-5 push updates (unmetered):** lock-screen "the entity is awake / thinking / left you a note" presence, server-driven, no app wake needed.
- **NSE with network:** ≤30 s of compute *inside* the push path — enough to decrypt, personalize, or enrich an outreach message before display.

### 9.6 Research verdict

- **(a)** No legitimate iOS mechanism exists for continuous minute-scale autonomous loops — Apple DTS, categorically.
- **(b)** Best achievable degraded mode: the tier design of §8.5/§10.
- **(c)** The 30 s per-wake budget rarely binds; **wake frequency binds, 5–30× short** of beat cadence.
- **(d)** Design directive that falls out of every exemplar: make time-based state a **pure function of `(state₀, elapsed)`** so any wake — foreground open, silent push, BG task, widget tick — can fold missed time in one condensed pass, and reserve LLM calls for *sampled* beats rather than assumed-guaranteed intervals.

---

## 10. Consolidated Decision — Tiered Hosting, One Engine Implementation

### 10.1 The target architecture

| Tier | Host | Fidelity | Notes |
|---|---|---|---|
| **Cloud** (Soulbits consumer) | Per-user engine container + lifecycle-worker | **Full, 24/7** | Already ~80 % shipped (§4.1); the backbone |
| **Desktop self-host** (power users) | Harmony Link | **Full** | Already shipping |
| **Android local mode** (opt-in) | Engine sidecar (channel B) or in-process (A) | **Near-full** | Foreground-service continuity at battery/UX cost; FGS type + 6 h/24 h `dataSync` cap + OEM caveats |
| **iOS local mode** (opt-in) | In-process engine module (channel A) | **Degraded tier** | Foreground full; lazy temporal state; sampled catch-up beats on any wake; `BGProcessingTask` overnight dreams; push outreach; widget/LA presence |

One Go core, one behavior implementation, hosts chosen per platform and per user preference. The TS-parity path (§3) is retired in favor of this if local fidelity is ever pursued.

### 10.2 Engine-core design directives (valid regardless of modularization)

These make the engine portable to *any* host and more robust where it runs today:

- **D1 — Lazy temporal evaluation:** refactor tick-applied state (emotion decay/dampening/crystallization, exhaustion/sleep progression, Dream TTL) into pure functions of `(state₀, elapsed)` evaluated on read. Strictly more robust than ticks (no missed ticks after restarts); free portability to iOS.
- **D2 — Catch-up seam:** formalize a `FireCatchUp(elapsed)` entry (sampled K beats, fixed-step replay for non-LLM state) building on the existing one-shot `FireBeat`/`FireDreamBeat`/`FireOutreachBeat` contract. Hosts call it on every wake; the cloud lifecycle-worker can use it identically after downtime.
- **D3 — Pre-computable outreach:** keep outreach payloads server-drafted (already the case) and extend the same pre-computation to widget/Live-Activity presence payloads.
- **D4 — Never design against a loophole:** no silent-audio, VoIP-push, or location-trick wake strategies; the enforcement history (§9.6) is unambiguous.

### 10.3 Final recommendation (unchanged in substance, refined in shape)

1. The engine stays the single behavioral authority; the cloud route remains the product backbone.
2. Offline/local is addressed by **tiered hosting of the one Go core** (§7/§10.1), not by a TS re-implementation; on iOS it is a degraded-but-honest tier, not parity.
3. Adopt D1/D2 in the engine core now — they improve the current cloud/desktop hosts and are prerequisites for any mobile hosting later.
4. On-device inference remains a foreground/opportunistic capability (Executorch on Android; evaluate Apple Foundation Models on iOS 26), never the loop driver.

---

## 11. Follow-up D — "Local Engine + Thin Lifecycle Service" Variant

*Derived from the §10 discussion: what if everything except autonomy runs on-device, and the cloud keeps only the lifecycle service? Assessed as a fourth architecture option.*

### 11.1 The insight it is built on

The cloud `lifecycle-dispatcher`/`lifecycle-worker` were designed to run autonomy **against the S3 snapshot with no live engine container** — that is literally their job when Fargate session tasks scale to zero. Therefore per-user session hosting is *not* a dependency of autonomy. The session-tier can be retired while autonomy survives:

| Retired (per-user compute at rest disappears) | Kept (bounded, shared services) |
|---|---|
| Per-user Fargate engine tasks | Auth (PASETO/OAuth) |
| Session broker (provisioning, readiness contract, warm pool) | **Lifecycle-dispatcher + worker** (autonomy on snapshots) |
| Conduct proxy (WS routing) | **Push-service** (outreach delivery) |
| Task sidecars/init containers | **Inference gateway** (only for users who don't BYO keys) |
| | S3 snapshot storage, subscriptions/coins |

The phone hosts the engine (Android: sidecar; **iOS: in-process module — no sidecar exists on iOS**), making the local engine the interaction/cognition/inference authority while the app is alive; the lifecycle service owns continuity while it is not. This maps exactly onto the iOS constraint profile: the only thing iOS cannot do (continuous loops) is the only thing in the cloud.

### 11.2 Database posture on device

The embedded engine uses **its own Go database code** against a local SQLite file — schema-identical to the app's TS replica by the existing parity gates (they were built for sync, they serve embedding too). Two configurations:

- **Dual-DB, localhost sync (recommended first step):** app replica ↔ local engine over the *existing* sync protocol pointed at `127.0.0.1`. Zero new protocol; the app's data layer is untouched; cost is redundant on-device storage.
- **Engine-DB only (later consolidation):** app queries the engine's DB through the facade; the TS replica + slave-sync code is deleted. Cleaner end-state, large app refactor.

### 11.3 The new engineering it requires (the §7.4.2 gap, made concrete)

1. **Phone-authoritative snapshot sync with write-back.** Phone uploads deltas → worker runs beats on the snapshot → outreach messages, emotion/lifecycle state, beat artifacts must flow *back* into the phone's authority. Today's protocol is engine(master)→app(slave); this variant needs master↔worker replication with the phone as master. Includes a lease/lock so the worker cannot be mid-run while the app is open and writing (write-write race), and an upload-cadence policy (outreach quality depends on snapshot freshness — upload on session end / periodic BG windows / app close).
2. **Multi-device rendezvous.** Two devices each hosting local engines for one user → the snapshot becomes the meeting point → needs primary-device semantics or per-entity leases (the app's existing per-source authority switching is the seam, but concurrent local engines must not both claim authority).
3. **Retired tier consequences.** No cloud engine means no cloud-hosted web-client chat; desktop users fall back to self-hosted Harmony Link (full engine) — which doubles as the zero-cloud privacy tier.

### 11.4 The honest privacy boundary

With cloud lifecycle, the strongest true claims are:

- ✅ Per-user encrypted DB at rest (D-01 target design); TLS in transit.
- ✅ Outreach *content* end-to-end encrypted: NSE decrypts on-device with a key that never leaves the phone.
- ✅ Inference invisible to the operator when users BYO API keys (provider system already supports this); gateway-visible only when using Soulbits inference.
- ❌ **"We never see your data" is not literally true:** the lifecycle-worker must decrypt the entity DB to run beats; the operator could observe plaintext in worker memory. Hardened posture (per-user keys fetched per-run, audited, minimal retention) = "encrypted at rest + bounded processing," not zero-knowledge.
- 🔐 Ceiling option: run the lifecycle-worker in **AWS Nitro Enclaves** with the phone sealing the DB key to an *attested enclave* — not even the operator can decrypt. Genuinely "never see it," heavy engineering, worth knowing as the maximum posture.
- Fully zero-cloud tier: lifecycle on the user's own desktop Harmony Link (or none — accept degraded: lazy state + catch-up on open, no outreach-while-closed).

### 11.5 Assessment

Technically coherent and the most infra-efficient of the four architectures (no per-user compute at rest, autonomy preserved, iOS constraints turned into the design rather than fought). The cost is concentrated in exactly one place: **the phone-authoritative sync/write-back protocol with leasing** — bounded, testable engineering, but it is new protocol surface on the most correctness-sensitive layer (the one that took D1–D87 to harden in its current master/slave shape). Sequence it only after D1/D2 (§10.2) land, since lazy temporal state and catch-up seams are prerequisites for a snapshot-driven worker to reconcile cleanly with a phone authority.

---

## 12. Follow-up E — Embedded-Engine Consolidation: One Database, Management-API Client, Changeset Sync

*Derived from §11: if the engine embeds in the app, the app's TS SQLite replica and the hand-rolled sync protocol may be structurally unnecessary. Assessed and confirmed — with one technical correction (session extension, not WAL replay) that strengthens the idea.*

### 12.1 The structural diagnosis

The app's two chronic pain points share one root cause: **the engine was remote, so the app had to be a second database implementation.**
- The TS SQLite workarounds (`withTransaction` insert-id hazards, run-to-completion semantics, two-phase TEXT loading) exist because RN SQLite reimplements what the engine's Go repositories already do.
- The sync pain (35-table watermark protocol, tombstones, name-clash resolution, purge floors, wipe/rebuild — the D1–D87 register) exists because a TS replica must mirror Go behavior instead of being the Go code.

An embedded engine (Android sidecar / iOS in-process module, §7) deletes the root cause: **one database implementation (Go), one set of migrations (run at engine boot), one schema** — the schema-parity test gates become meaningless because there is nothing left to keep in parity.

### 12.2 Sync by changesets, not transaction-log replay

*"Replay the transaction log" is not literally possible — SQLite's WAL is physical (page-level frames tied to one DB state, non-portable). The correct primitive is SQLite's **session extension** — purpose-built for exactly this scenario ("Alice and Bob diverge, exchange changes, merge"), in the amalgamation since 3.13.0 (2016):*

- **Logical row-level changesets** per table, applied to the peer DB inside a savepoint (atomic, rollback-safe).
- **Native DELETE capture** — deletes travel *in* the changeset. The entire tombstone protocol, GC allowlists, purge floors, and `rebuild_required` semantics existed because timestamp-diffing cannot see deletes; changesets eliminate that problem class rather than mitigating it.
- **Per-change conflict callbacks** (`SQLITE_CHANGESET_OMIT / REPLACE / ABORT`) — a per-table-class policy (append-only messages: keep both; config rows: LWW via REPLACE) instead of a protocol.
- **Rebase API** for multi-writer three-way merges — flagged *experimental* by SQLite; treat as a later option, not day one.
- **Retroactive diffing** (`session_diff` between two DB states) — useful for bootstrapping and repair.
- Mainstream precedent: Node.js ships session bindings in core `node:sqlite`.

**Integration cost (bounded):** requires `-DSQLITE_ENABLE_SESSION -DSQLITE_ENABLE_PREUPDATE_HOOK` plus a thin CGO wrapper in the `go-sqlite3` fork (mattn-style drivers do not expose the session C API). The fork is already maintained in-house. Requirements: declared PKs on synced tables (already true — the protocol is PK-based); NULL-in-PK rows ignored (not applicable).

**"Buy" alternative:** `cr-sqlite` (MIT, ~3.8k stars) — CRDT tables (`crsql_as_crr`) + `crsql_changes` virtual table, multi-writer merge without coordination. Trade-offs: ~2.5× insert overhead on synced tables, interfaces still moving, project in maintenance transition. The session extension remains the conservative choice given in-house fork ownership and control of both endpoints.

### 12.3 The three data relationships in the consolidated architecture

| Relationship | Mechanism | Status |
|---|---|---|
| App JS ↔ embedded engine | **Not sync anymore** — management REST + event WS over `127.0.0.1`. iOS permits in-process localhost servers, so the engine's real servers run inside the app; the app's existing `ConnectionManager`/`EntitySessionService`/WS client code works unchanged, repointed from cloud URL to localhost | Existing code, new address |
| Embedded engine ↔ desktop engine | **Changeset exchange** — one new Go module (session wrapper + baseline/epoch management + conflict policy) | New, replaces the entire app-side sync stack |
| Embedded engine ↔ cloud lifecycle (§11) | Same changeset machinery — snapshot = baseline + changesets; solves the §11.3 write-back requirement | New, shared with the above |

### 12.4 The app becomes a second frontend — with the Wails UI as proof

The management API already drives a complete UI (the Wails frontend). The app adopts the same contract and progressively replaces its TS repositories with management-API reads; its unique value remains mobile UI, audio, push, messengers. Additions needed: a handful of mobile-optimized read endpoints (chat-list JOIN previews). Stays app-local: UI preferences (AsyncStorage — already the case).

### 12.5 Coupled releases

Engine ships inside the app bundle → migrations run at engine boot → management API and its consumer version together; the compatibility matrix collapses to "app release N contains engine N." Caveats: +15–30 MB per ABI; engine hotfixes inherit App Store review latency; **remote** desktop-engine connections retain the version gate (old app ↔ new desktop engine remains a real combination); the cloud lifecycle-worker tracks a schema support window (N/N−1).

### 12.6 What dies, what survives, what's born

- **Dies:** TS repositories for synced tables; mirrored migrations + numbering parity; `SyncService`; name-clash resolution; tombstone/GC parity; watermark logic; estimate-confirm; wipe/rebuild; schema-parity gates — i.e., the entire cross-repo parity tax documented in §5.
- **Survives:** WS/event client code (reused for localhost); UI; client-only prefs.
- **New:** Go changeset sync module; engine embedding facade (§7); mobile read endpoints.

### 12.7 Remaining design decisions (reduced, not zero)

1. **Single-writer epochs vs. multi-writer rebase** — recommend epoch-based authority first (matches the existing "one authority per source" model); rebase only if true concurrent multi-writer demand emerges.
2. **Changeset retention / baseline policy** — offline-too-long ⇒ snapshot re-pull (replaces purge-floor semantics with something simpler).
3. **Per-table-class conflict policy** — a short config, not a protocol.
4. **Schema version gate for remote engines** — stays.

### 12.8 De-risked migration path

1. Android sidecar pilot, dual-DB, localhost sync (§11.2 config A) — proves embedding without data-layer changes.
2. Go changeset module — proves sync between two engines (desktop ↔ embedded).
3. App switches reads to the management API (can be per-screen).
4. **One-time data migration: the old sync protocol becomes the bridge** — run it once from the app's TS database into the embedded engine's database, then delete it alongside the rest of the legacy stack.





---

## Appendix A — Verified facts used in this assessment (original assessment, §1–§6)

- App contains no inference/prompt logic: grep over `src` for completions/system-prompt construction matches only character-card parsing/tests; no `executorch|torch|llama|onnx` in `package.json`.
- Engine scale: 775 non-test Go files / 125,842 LOC (+407 test files / 87,878 LOC); subsystem sizes: database 18.2k, eventserver 7.5k, modules 12.6k (cognition ≈10.6k incl. prompt_builder 102KB, processor 58KB, memory_consolidator 27KB), providers 5.1k, management 4.1k, lifecycle 1.7k, emotion 731 LOC.
- Engine autonomy core: `lifecycle/runner.go` (39KB) — per-entity goroutine beat loop, exhaustion/sleep, inner monologue, outreach cooldowns; explicitly designed for reuse by the cloud lifecycle-worker (`NewEntityBeatRunner` OUT-OF-REPO contract note).
- Cloud backend: 326 non-test Go files / 82,981 LOC; 11 phases, 8 complete, Phase 8.1 in progress; `lifecycle-worker` job.go 42KB + lookahead 23KB run beats/outreach/dreams/compact/reconcile on snapshot SQLite.
- App scale: 540 TS/TSX files / 124,582 LOC; services inventory confirms client-only scope (WS connections, sync, sessions, audio, auth, stubs).
- Sync protocol: engine-authoritative; purge floor forces app wipe/rebuild; schema version gate v2 — all documented in both memory banks and `docs/schema-parity.md`.

## Appendix B — Verified facts and sources added with the follow-ups (§7–§10)

**Code-level verification (this session):**
- `soulbits-cloud-backend/cmd/lifecycle-worker/job.go` imports engine packages directly as libraries: `hl_database`, `emotion`, `lifecycle`, `modules/cognition`, `modules/common`, `push` — the headless-consumer existence proof for §7.1.
- `harmony-link-private/go.mod`: `mattn/go-sqlite3` (via `jgiannuzzi/go-sqlite3` fork for SQLite3MultipleCiphers encryption) → CGO; `wails/v2 v2.13`; `pkoukk/tiktoken-go`; forked `chromem-go` (§7.4.3).
- `lifecycle/runner.go`: `NewEntityBeatRunner(db, entityID, …)` takes an explicit caller-owned `*sql.DB`, does NOT start the timer loop; one-shot `FireBeat`/`FireDreamBeat`/`FireOutreachBeat` are the documented host-driven entry points (D-BEH-04; the catch-up seam of D2).

**Key primary sources for §8–§9 (full list in the research session log):**
- Apple DTS on background execution limits — developer.apple.com/forums/thread/685525 ("no general-purpose mechanism… 'You can't'").
- Apple, "Pushing background updates to your app" — 30 s handler, "don't try to send more than two to three per hour," coalescing, force-quit behavior.
- Apple, `BGTaskScheduler` / `BGAppRefreshTask` / `BGProcessingTask` / `BGContinuedProcessingTask` (iOS 26) documentation + WWDC25 session 227.
- Apple, WidgetKit "Keeping a widget up-to-date" — 40–70 refreshes/day; ActivityKit push budgets (priority-5 unmetered, 8 h, 4 KB).
- Apple, PushKit/VoIP — CallKit-report requirement and termination policy (the closed-loophole precedent).
- HealthKit `enableBackgroundDelivery(for:frequency:)` — per-period throttling, 3-strike disable.
- App Store Review Guideline 2.5.4 + documented rejection precedents (audio/location misuse).
- Android: WorkManager 15-min minimum; Android 14 FGS types + exact-alarm denial; Android 15 `dataSync` 6 h/24 h cap; Doze/FCM priority semantics; dontkillmyapp.com vendor evidence.
- On-device LLM benchmarks: arXiv 2505.06461 (llama.cpp on iPhone 15 Pro); 2026 iOS runtime shootouts (MLX/LiteRT-LM ~55–61 tok/s @ 2B); ExecuTorch SpinQuant (~50 tok/s @ 1B, OnePlus 12); Apple Newsroom — Foundation Models framework (3B, free, on-device, iOS 26).
- Exemplar evidence: Character.AI inference blog (server-authoritative stack); Replika/Kindroid/Nomi proactive-messaging policies (vendor material + 2026 field tests); idle-game offline-progress mechanics (IdleKit fixed-step replay); Alarmy release notes on background-restriction fragility.

*Claims in §9 are labelled VERIFIED (primary source) / REPORTED (forum/blog/field test) / INFERRED (synthesis) following the research session's convention.*
