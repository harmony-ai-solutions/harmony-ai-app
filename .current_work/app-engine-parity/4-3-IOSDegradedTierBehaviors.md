# Phase 4-3 — App: iOS Blind-Tick Lifecycle (Primary Channel)

> **Repo:** `harmony-ai-app` (+ engine facade calls)
> **Assessment basis:** 2026-10-11 review ruling — on-device lifecycle authority, blind cloud keepalive (4-4); §8.5, §9.4 patterns 2–4, §9.5 retained
> **Depends on:** 4-1, 4-2, 0-4 (engine batch API); consumes 4-4 (keepalive + relay)

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

- [ ] Silent-push handler + credential injection + batch run
- [ ] Expiration discipline verified
- [ ] BGProcessingTask deep sweep (compact/dream flags)
- [ ] Relay client + on-device eligibility
- [ ] Degraded-mode path verified
- [ ] Honest-limits copy shipped
- [ ] Observation week documented
- [ ] Presence follow-up ticket (widget/Live Activity) filed — out of plan
