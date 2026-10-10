# Phase 4-3 — App: iOS Degraded-Tier Behaviors

> **Repo:** `harmony-ai-app` (+ engine facade calls)
> **Assessment basis:** §8.5 (refined iOS tier), §9.4 patterns 2–4, §9.5 (BGProcessingTask, widget/LA presence)

## Objective

Make the iOS foreground-only tier feel alive within Apple's rules: lazy state reads (already via 3-2), opportunistic catch-up windows, overnight maintenance, and lock-screen presence.

## Scope (each item independently shippable; ordered)

1. **BGProcessingTask — overnight "dreams":** register a processing task (`com.soulbits.engine.maintenance`, `BGTaskSchedulerPermittedIdentifiers`, processing background mode). When iOS grants the window (idle + charging): cold-start the engine via facade, run `PlanCatchUp` + dream/compact triggers, flush pending epoch toward cloud if reachable, stop. Requires `UIBackgroundModes: processing` + honest expiration handling. Expectation-setting: system-decadent timing (nights, days apart) — the cloud lifecycle-worker remains the real continuity layer; this is a bonus tier.
2. **Silent-push nudge (opportunistic):** existing push-service sends a low-rate (≤2–3/h, gated by server policy) `content-available` nudge on outreach/emotion-worthy events → 30 s window: engine start → catch-up → fetch → stop. Non-delivery tolerant by design.
3. **Lazy state in UI (mostly done by 3-2):** verify all emotion/lifecycle reads hit the lazy endpoints so opening the app shows correctly-decayed state instantly.
4. **Presence (stretch, separate UI project):** WidgetKit timeline + Live Activity driven by pre-computed payloads (server-side drafted in the lifecycle path) — explicitly OUT of this plan's critical path; note as follow-up.

## Implementation steps

1. BGTask registration/scheduling/handlers; expiration-handler discipline (checkpoint + stop).
2. Silent-push handler wired to engine nudge sequence; metric counters (honored/missed — expect misses; log only).
3. Verification runs (device, real conditions): overnight window probability sampling across a week; document observed cadence (informs product copy honestly).

## Files to create/modify

- `ios/` background task registration, `AppDelegate`/`SwiftAppDelegate` hooks
- `src/services/engine/IOSMaintenanceScheduler.ts`
- Info.plist background modes
- CHANGELOG.md

## Verification gates

- `npx tsc --noEmit` 0; unit green; iOS CI green
- Device: at least one observed overnight maintenance run + clean expiration behavior; silent-push nudge honored when delivered
- No App Store guideline conflicts (processing task does real maintenance; no audio/location tricks — assessment D4)

## Risks & rollback

- BG tasks rarely firing on some devices — acceptable (bonus tier); telemetry informs copy
- Silent-push abuse perception — server-side rate policy + user setting

## Progress checklist

- [ ] BGProcessingTask maintenance path
- [ ] Silent-push nudge path
- [ ] Lazy-state read verification
- [ ] Device observation week documented
- [ ] Presence follow-up ticket filed (out of plan)
