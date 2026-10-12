# Phase 4-3 — App: iOS Blind-Tick Lifecycle (Primary Channel)

> **Repo:** `harmony-ai-app` (+ engine facade calls)
> **Assessment basis:** 2026-10-11 review ruling — on-device lifecycle authority, blind cloud keepalive (4-4); §8.5, §9.4 patterns 2–4, §9.5 retained
> **Depends on:** 4-1, 4-2, 0-4 (engine batch API); consumes 4-4 (keepalive + relay)
> **Codebase mapping consulted:** `.planning/codebase/` — app + engine repos (ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md)

## Objective

Make iOS a first-class lifecycle host within Apple's rules: the embedded engine owns all lifecycle state and processing on-device; the only cloud inputs are a best-effort hourly keepalive push (4-4) and the device-initiated visible-push relay. The app is honest about the limits: cadence is best-effort, correctness is guaranteed (lazy state converges on every wake).

## Model (per 2026-10-11 ruling)

| Wake source | Window | Work |
|---|---|---|
| Silent keepalive push (4-4 cron, 1/h best-effort) | ~30 s | Credential refresh+inject → `ProcessLifecycleBatch` (priority order, deadline truncation) → relay requests for outreach results → stop |
| BGProcessingTask (overnight, system-decided) | minutes | Deep sweep: batch for remaining backlog + memory compaction + dream triggers (0-4 batch flags) → relay requests → flush epoch toward peers if reachable → stop |
| App open / foreground | unbounded | Full engine start (4-2); timer loop runs while foregrounded — identical to desktop |
| Visible push tapped | app open path | Same as app open |

Desktop and Android sidecars are unchanged: they self-tick (timer loop). iOS is the only keepalive consumer.

Long absences (device off for days or weeks): the first wake runs 0-2's long-gap policy — a single re-entry beat acknowledging the hiatus, at most one dream and one outreach; never a backlog replay. The user returns to an entity that noticed the absence, not two weeks of monologue.

## Implementation steps

1. **Silent-push handler** (AppDelegate / push registration): on `content-available` wake — start engine via facade (4-1), refresh auth + inject inference credentials (existing `soulbitsTokenSync`/`injectSoulbitsToken` patterns), fetch tier beat budget (4-4 policy API), run `ProcessLifecycleBatch(Deadline = now + ~25 s)`, request visible pushes for any outreach the batch delivered, stop cleanly. Telemetry: honored/missed counters (expect misses; log only).
2. **Expiration discipline**: batch deadline < OS deadline; completion handler always called; no work after expiration — in-flight entity persists checkpoint via its own tx (0-4 resumption model).
3. **BGProcessingTask deep sweep**: register `com.soulbits.engine.maintenance` (`UIBackgroundModes: processing`, `BGTaskSchedulerPermittedIdentifiers`); run batch with compact/dream flags + longer deadline; honest expiration handler (checkpoint + stop). Expectation-setting: system-decadent timing (nights, possibly days apart) — this is the *bonus* window, not the correctness path.
4. **Outreach visible-push relay client**: engine evaluates D-PUSH-04 eligibility on-device (it owns last-user-message + prior-outreach data); app calls `POST /v1/lifecycle/notify` (4-4) with an opaque payload. Optional stretch: Notification Service Extension decrypting the payload so banner text never transits plaintext.
5. **Credential-failure degradation**: refresh/injection failure → batch still runs in non-LLM mode (0-4 `Degraded`) — state advances, no narratives, no relay spam.
6. **Honest product copy**: iOS settings/info entry explaining best-effort cadence ("your companion lives on your device; iOS decides when it may wake") + telemetry-informed wording after the observation week.
7. **Verification week (device, real conditions)**: sample honored-keepalive rate across ≥7 days; document observed cadence; adjust copy.

## Files to create/modify

- `ios/` push registration + `AppDelegate` wake handling; BGTask registration
- `src/services/engine/IOSLifecycleWakeHandler.ts` (silent-push path), `src/services/engine/IOSMaintenanceScheduler.ts` (overnight path)
- `src/services/lifecycle/PushRelayClient.ts` (relay requests)
- `Info.plist` background modes; CHANGELOG.md

## Verification gates

- `npx tsc --noEmit` 0 errors; unit + integration suites green; iOS CI green
- Device: ≥1 observed silent-push batch run + clean expiration; ≥1 overnight maintenance run; relay push received end-to-end (staging)
- No App Store guideline conflicts (processing task does real maintenance; no audio/location tricks)

## Risks & rollback

- Silent pushes rarely honored on some devices → accepted: state converges on app-open/overnight; product copy reflects it; keepalive itself is droppable server-side (4-4) without app changes
- 30 s window fits fewer entities than expected → 0-4 priority ordering + truncation; telemetry drives budget tuning
- Relay downtime → outreach persists on-device (queued); next foreground surfaces it; retry relay then

## Progress checklist

- [x] Silent-push handler + credential injection + batch run
- [x] Expiration discipline verified *(code-side; the live drill is an owner gate)*
- [x] BGProcessingTask deep sweep (compact/dream flags)
- [x] Relay client + on-device eligibility
- [x] Degraded-mode path verified
- [x] Honest-limits copy shipped
- [ ] Observation week documented — **owner device gate** (≥7 days of real conditions; see below)
- [ ] Presence follow-up ticket (widget/Live Activity) filed — out of plan

### Owner gates (unchecked, exact steps)

- [ ] **Silent-push wake drill** (physical iPhone, dev/beta build, vendored XCFramework):
  keep the app backgrounded; trigger a keepalive (`KEEPALIVE_ENABLED=true`, or a manual
  APNs `content-available:1` push with `data.kind=keepalive`); confirm `engine:wake`
  → a `lifecycle.batch` run → a clean `finishWake` (no `expiration` force-stop) in the
  device console (`[EngineWake]` / `[IOSLifecycleWake]`).
- [ ] **Overnight sweep observation**: leave the device charging + on Wi-Fi overnight;
  confirm a `com.soulbits.engine.maintenance` grant → `lifecycle.maintenance` then
  `lifecycle.batch` → clean completion; verify the backup ride-along ran when enabled.
- [ ] **Outreach visible-push (staging)**: force an outreach-due entity; confirm
  `POST /v1/lifecycle/notify` returns `{delivered:1}` and the banner is received.
- [ ] **Low-power / Background App Refresh off behavior**: confirm the app still
  converges on the next app-open (honest-limits copy matches observed cadence).
- [ ] **Observation week** (step 7): sample the honored-keepalive rate across ≥7 days,
  document the observed cadence, and adjust the copy if needed.

### Implementation notes (task 4-3, 2026-10-12)

**TS orchestration (new, unit-tested).**
- `src/services/engine/IOSLifecycleWakeHandler.ts` — the bounded silent-push pass:
  ensure engine started (reuse `EngineService` connection) → refresh/inject the
  SoulbitsCloud credential (`updateAllSoulbitsCloudApiKeys`) → fetch the tier budget
  (`fetchAutonomyBeatsPerDay`, 4-4) → `lifecycle.batch` with a deadline of
  `now + 25 s` (strictly inside iOS's ~30 s) and a per-wake budget slice
  (`ceil(daily / 24)`, fallback 2) → relay a visible push per `plan.outreachDue`
  entity → clean stop → honored/missed telemetry. A credential-injection failure (or
  a signed-out device) sets `degraded:true` (non-LLM). Never throws.
- `src/services/engine/IOSMaintenanceScheduler.ts` — the overnight sweep:
  `lifecycle.maintenance` (0-4 deep compaction) then `lifecycle.batch` (backlog +
  dream), same deadline discipline (default 20 min), outreach relay, and the **2-6
  backup ride-along** (`backupOrchestrator.backUpNow()` when enabled), then stop.
- `src/services/engine/engineLifecycleCall.ts` — shared facade DTOs + parsers +
  RFC3339 helper (the 4-1 method table is the source of truth).
- `src/services/lifecycle/PushRelayClient.ts` — `POST /v1/lifecycle/notify`
  (PASETO bearer; `{target_device_id?, payload?, alert?}`; `{delivered}`; error
  taxonomy: unauthorized / payload_too_large (UTF-8 byte count) / 429 / network).
- `src/services/engine/IOSLifecycleTelemetry.ts` — honored/missed counters per kind
  + a bounded recent ring + an optional sink (observational only).
- `src/services/engine/IOSLifecycleBridge.ts` — registered from `index.js`: routes
  `engine:wake` (keepalive/relay → wake pass; maintenance → sweep), completes the OS
  task via `finishWake`, drains a queued wake/token on a cold launch, and registers
  the APNs token (`NotificationService` + `DeviceAuthService.registerDevice({pushToken})`).
- `EngineEmbeddedModule.ts` gained the 4-3 surface: `engine:wake` / `push:token`
  fan-out, `finishEngineWake`, `consumePendingEngineWake`, `consumePendingPushToken`.
- `DeviceAuthService.registerDevice({ pushToken? })` now attaches the token.
- Honest-limits copy: `src/i18n/locales/en/lifecycle.json` (new namespace) +
  `src/screens/settings/IOSLifecycleInfoScreen.tsx` (Settings → Background presence,
  iOS only), showing the session's honored/missed counters.

**iOS native (reviewed, not compiled here — no Swift/clang on this host).**
- `ios/HarmonyAIChat/AppDelegate.swift` — a `EngineWakeCoordinator` singleton:
  registers the BGTask handler (`com.soulbits.engine.maintenance`), submits the
  overnight `BGProcessingTaskRequest` (external power + network) at launch and on
  background, registers for remote notifications, handles `content-available` wakes
  (background assertion + a 25 s hard timeout strictly inside the OS window),
  forwards wakes/tokens to JS via `NotificationCenter` + a `UserDefaults` queue for a
  cold launch, and ALWAYS calls the completion handler / `setTaskCompleted` (the
  expiration handler force-stops the engine via `EmbedEngineStop` — no work after
  expiration).
- `ios/EngineModule/HarmonyEngineModule.m` — observes the coordinator's notifications,
  forwards `engine:wake` / `push:token` to JS, and exposes `finishWake`,
  `consumePendingWake`, `consumePendingPushToken`.
- `Info.plist` already declares `UIBackgroundModes` (processing/remote-notification) +
  `BGTaskSchedulerPermittedIdentifiers` from 4-2 — **no change needed**.

**Gates run.** `npx tsc --noEmit` = 0; `npm test` green (120 suites / 949 tests, up
from 113/903). New suites: `PushRelayClient`, `engineLifecycleCall`,
`IOSLifecycleTelemetry`, `IOSLifecycleWakeHandler`, `IOSMaintenanceScheduler`,
`IOSLifecycleBridge`, `IOSLifecycleInfoScreen`, plus additions to
`EngineEmbeddedModule` and `deviceAuth`. `npx react-native config` exits 0 (iOS
project still parses; no pbxproj change was needed — the coordinator lives in the
already-listed `AppDelegate.swift`).

**Deviations.**
- **Native is trigger + OS discipline only.** The batch/maintenance/relay logic runs
  in JS (the doc names the TS modules); the native coordinator never duplicates it.
  If JS is unavailable at a wake, the native side completes the OS task with no work
  (best-effort — correctness converges on the next wake). The `dbKey`/PASETO live in
  app-owned storage the JS layer owns, so a native-only batch is deliberately not
  attempted.
- **`contextWindowSize`/`modelName` are not passed** to `lifecycle.batch`: the app has
  no per-entity model/context-window source, so `plan.compactDue` is observability-only
  when the window is unset. Compaction runs via `lifecycle.maintenance` (the 0-4
  overnight entry point), which enumerates its own targets.
- **Per-wake budget slice.** The tier budget is daily; the wake handler passes
  `ceil(daily / 24)` (nominal hourly) so hourly wakes stay within the cooperative
  ceiling, while the overnight sweep passes the full daily budget. (The deadline is
  the practical bound in the 25 s window either way.)
- **Relay default is data-only when the banner text can't be composed** (the wake
  handler's default composer reads the entity's newest chat-list message; a read
  failure falls back to an opaque `{kind:'outreach'}` payload for a future NSE). The
  plain-text alert path is used when the read succeeds.
- **`IOSLifecycleInfoScreen` shows per-session counters**, not a persisted
  observation-week histogram (that is the step-7 owner task).

