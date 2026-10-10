# Phase 4-2 — App: iOS Module Integration (Turbo Native Module)

> **Repo:** `harmony-ai-app` (branch `app-engine-parity`)
> **Assessment basis:** §7.2 channel A, §8.5 (foreground-only engine semantics)

## Objective

Wire the `HarmonyEngine.xcframework` into the iOS app behind the same `local engine` connection source (1-3): Turbo Native Module wrapping the facade; engine lives and dies with the app process.

## Design

- `ios/` integration: Podfile/framework embedding; `EngineModule` (Swift/ObjC) exposing `start/stop/call/setCallback` to RN via Turbo Module spec mirroring the Android `EngineSidecar` module interface **exactly** (same TS types — the app's engine-service layer becomes platform-agnostic).
- `src/services/engine/`: unified `EngineHost` interface with two impls — `SidecarEngineHost` (Android) and `EmbeddedEngineHost` (iOS) — selected by platform; both yield `{wsPort, adminPort}` after readiness so everything downstream (1-3 connection mode, 3-2 API client) is shared.
- Lifecycle: start on first engine-dependent interaction (app foreground), stop on `AppState` background with a short grace (in-flight tx), restart on foreground; **no** background execution attempts (assessment §8 — documented product behavior: iOS local mode is a foreground tier; cloud/lifecycle-service covers continuity).
- Memory/battery telemetry hooks (dev builds): RSS before/after chat sessions.

## Implementation steps

1. XCFramework vendoring (gradle/pod pinning equivalent), build phases, fat-slice handling.
2. `EngineModule` + Turbo Module spec + JSI registration; TS `EngineHost` unification refactor of 1-2's module (interface extraction).
3. AppState-driven lifecycle + grace handling; crash-of-engine (fatal init error) surfacing.
4. Device verification matrix (physical iPhone, app backgrounding mid-chat, phone call interruption, low-power mode foreground behavior).

## Files to create/modify

- `ios/` project files, `ios/EngineModule/*` (NEW)
- `src/services/engine/EngineHost.ts` (interface) + hosts
- Tests: host-selection logic, lifecycle state machine (pure parts)

## Verification gates

- `npx tsc --noEmit` 0; iOS build green in CI; unit suites green
- Device matrix green; foreground/background lifecycle verified
- Behavior documented for release notes (iOS local mode scope)

## Risks & rollback

- App Store review (embedded runtime + loopback servers) — standard precedents exist; monitor first submission
- Memory pressure on older devices — telemetry informs a min-device-spec decision for enabling local mode on iOS

## Progress checklist

- [ ] XCFramework integrated
- [ ] Turbo module + EngineHost unification
- [ ] AppState lifecycle + grace
- [ ] Device matrix green
- [ ] Release-note behavior documented
