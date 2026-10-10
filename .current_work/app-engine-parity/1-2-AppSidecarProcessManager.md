# Phase 1-2 — App: Sidecar Process Manager (Android)

> **Repo:** `harmony-ai-app` (branch `feat/app-engine-parity`)
> **Assessment basis:** §7.2 channel B, §12.3 relationship 1

## Objective

Native Android layer that owns the engine sidecar process: start/health/stop, port handshake, DB key provisioning, and a typed foreground service keeping it alive while the app session is active.

## Design

- New Kotlin module under `android/app/src/main/java/ai/soulbits/engine/`:
  - `EngineSidecarService` — foreground service (type `dataSync` on API 34+; `<uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC"/>`), persistent notification ("Soulbits engine running"), lifecycle tied to app usage window
  - `EngineProcessManager` — resolves `nativeLibraryDir` + ABI (`Build.SUPPORTED_ABIS` → `libengine.so`), `ProcessBuilder` exec with flags: `--data-dir <appFilesDir>/engine`, `--ws-port 0 --admin-port 0` (ephemeral ports reported via readiness line on stdout), env `ENGINE_DB_KEY` (from React Native Keychain via bridge param — never logged)
  - Readiness: read stdout line `ENGINE_READY {...}` → parse ports → callback to JS
  - Health: periodic process-alive check + WS-level ping from JS (existing heartbeat infra); on death: restart with backoff (max 3, then surface engine-error state)
  - Stop: `SIGTERM` via `Process.destroy()`, await exit ≤10s, else `destroyForcibly` + WAL integrity note
  - Single-instance lockfile honored (engine fails fast if double-started; manager surfaces)
- RN bridge: Turbo Native Module `EngineSidecar` with `start(): Promise<{wsPort, adminPort}>`, `stop(): Promise<void>`, `onExit(error?)` event. JSI/TS types in `src/types/`.
- Foreground-service policy: service runs while any entity session is open or a chat screen is focused; stops on app idle (respecting the assessment's honesty about battery — do NOT attempt 24/7; that is the cloud/lifecycle-worker's job).

## Implementation steps

1. Vendor engine artifacts from 1-1: `android/app/src/main/jniLibs/{arm64-v8a,x86_64}/libengine.so` via a gradle task pulling the pinned engine release artifact (avoid committing binaries — gradle download task keyed by engine version; document pin).
2. Implement `EngineProcessManager` + `EngineSidecarService` + manifest entries (`FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC`, `POST_NOTIFICATIONS` for the FGS notification on 33+).
3. Turbo Native Module bridge + TS types; unit tests for the port/readiness parsing (pure functions extracted).
4. Restart/backoff + error surfacing contract to JS (`engine:crashed`, `engine:ready`, `engine:stopped` events via emitter).
5. Device smoke: start/stop cycles, kill-app recovery, port collision rerun, key persistence.

## Files to create/modify

- `android/app/src/main/java/ai/soulbits/engine/EngineProcessManager.kt` (NEW)
- `android/app/src/main/java/ai/soulbits/engine/EngineSidecarService.kt` (NEW)
- `android/app/src/main/AndroidManifest.xml` (permissions + service registration)
- `android/app/build.gradle` (jniLibs task, engine artifact pin)
- `src/services/engine/EngineSidecarModule.ts` (NEW, RN wrapper), `src/types/engineSidecar.ts`
- Tests: `src/services/engine/__tests__/` (parsing/backoff pure logic)

## Verification gates

- `npx tsc --noEmit` 0; new unit suites green; existing suites unaffected
- On-device: engine starts, readiness parsed, WS connect to `127.0.0.1:<port>` succeeds (1-3 consumes), clean stop with checkpoint, crash-restart path
- App size delta recorded (expected +15–30 MB/ABI)

## Risks & rollback

- OEM task killers terminate the sidecar despite FGS → restart backoff + honest error state; documented known limitation (dontkillmyapp class)
- Key handling: DB key from Keychain bridched through process env — ensure it's not in logs or `ps` environ on old Androids (env visible only to same-uid; acceptable, note it)
- Rollback: feature-flag the whole module off (`ENGINE_SIDECAR_ENABLED`), app behaves as today

## Progress checklist

- [ ] Gradle artifact vendoring + pin
- [ ] Process manager + readiness parsing + tests
- [ ] Foreground service + manifest + notification
- [ ] Turbo module bridge + TS types + events
- [ ] Restart/backoff + error contract
- [ ] Device smoke checklist executed
