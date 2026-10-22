# Phase 1-2 — App: Sidecar Process Manager (Android)

> **Repo:** `harmony-ai-app` (branch `feat/app-engine-parity`)
> **Assessment basis:** §7.2 channel B, §12.3 relationship 1
> **Codebase mapping consulted:** `.planning/codebase/` (app — harmony-ai-app): ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md

## Objective

Native Android layer that owns the engine sidecar process: start/health/stop, port handshake, DB key provisioning, and a typed foreground service keeping it alive while the app session is active.

## Design

- New Kotlin module under `android/app/src/main/java/ai/soulbits/chat/engine/` (the app's existing package root is `ai.soulbits.chat` — e.g. `ai/soulbits/chat/ChatBubbleService.kt`; engine code nests under it):
  - `EngineSidecarService` — foreground service (type `dataSync` on API 34+; `<uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC"/>`), persistent notification ("Soulbits engine running"), lifecycle tied to app usage window
  - `EngineProcessManager` — resolves `nativeLibraryDir` + ABI (`Build.SUPPORTED_ABIS` → `libengine.so`), `ProcessBuilder` exec with flags: `--data-dir <appFilesDir>/engine`, `--ws-port 0 --admin-port 0` (ephemeral ports reported via readiness line on stdout), env `ENGINE_DB_KEY` (from React Native Keychain via bridge param — never logged)
  - Readiness: read stdout line `ENGINE_READY {...}` → parse ports → callback to JS
  - Health: periodic process-alive check + WS-level ping from JS (existing heartbeat infra); on death: restart with backoff (max 3, then surface engine-error state)
  - Stop: `SIGTERM` via `Process.destroy()`, await exit ≤10s, else `destroyForcibly` + WAL integrity note
  - Single-instance lockfile honored (engine fails fast if double-started; manager surfaces)
- RN bridge: Turbo Native Module `EngineSidecar` with `start(): Promise<{wsPort, adminPort}>`, `stop(): Promise<void>`, `onExit(error?)` event. JSI/TS types in `src/types/`.
- Foreground-service policy: service runs while any entity session is open or a chat screen is focused; stops on app idle (battery honesty — no 24/7 keep-alive attempt; lifecycle state is lazy (0-1) and converges on the next start).

## Implementation steps

1. Vendor engine artifacts from 1-1: `android/app/src/main/jniLibs/{arm64-v8a,x86_64}/libengine.so` via a gradle task pulling the pinned engine release artifact (avoid committing binaries — gradle download task keyed by engine version; document pin).
2. Implement `EngineProcessManager` + `EngineSidecarService` + manifest entries (`FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC`, `POST_NOTIFICATIONS` for the FGS notification on 33+).
3. Turbo Native Module bridge + TS types; unit tests for the port/readiness parsing (pure functions extracted).
4. Restart/backoff + error surfacing contract to JS (`engine:crashed`, `engine:ready`, `engine:stopped` events via emitter).
5. Device smoke: start/stop cycles, kill-app recovery, port collision rerun, key persistence.

## Files to create/modify

- `android/app/src/main/java/ai/soulbits/chat/engine/EngineProcessManager.kt` (NEW)
- `android/app/src/main/java/ai/soulbits/chat/engine/EngineSidecarService.kt` (NEW)
- `android/app/src/main/AndroidManifest.xml` (permissions + service registration)
- `android/app/build.gradle` (jniLibs task, engine artifact pin)
- `src/services/engine/EngineSidecarModule.ts` (NEW, RN wrapper), `src/types/engineSidecar.ts`
- Tests: `src/services/engine/__tests__/` (parsing/backoff pure logic)

## Verification gates

- `npx tsc --noEmit` 0; new unit suites green; existing suites unaffected
- On-device: engine starts, readiness parsed, WS connect to `127.0.0.1:<port>` succeeds (smoke directly; the 3-2 management-API client consumes it later), clean stop with checkpoint, crash-restart path
- App size delta recorded (expected +15–30 MB/ABI)

## Risks & rollback

- OEM task killers terminate the sidecar despite FGS → restart backoff + honest error state; documented known limitation (dontkillmyapp class)
- Key handling: DB key from Keychain bridched through process env — ensure it's not in logs or `ps` environ on old Androids (env visible only to same-uid; acceptable, note it)
- Rollback: feature-flag the whole module off (`ENGINE_SIDECAR_ENABLED`), app behaves as today

## Progress checklist

- [x] Gradle artifact vendoring + pin
- [x] Process manager + readiness parsing + tests
- [x] Foreground service + manifest + notification
- [x] Turbo module bridge + TS types + events
- [x] Restart/backoff + error contract
- [ ] Device smoke checklist executed

### Progress notes (task 1-2 implementation)

- **Gradle artifact vendoring** — `:app:vendorEngineSidecar` (in `android/app/build.gradle`) fetches `libengine.so` per ABI into `src/main/jniLibs/{arm64-v8a,x86_64}/`, wired to run before `preBuild`. Pin via `-PENGINE_SIDECAR_VERSION` (default `0.1.0`); sources: `-PENGINE_SIDECAR_ARTIFACTS_DIR` (local CI drop from the engine's `build-android-sidecar` job → `build/android/<abi>/libengine.so`) or `-PENGINE_SIDECAR_BASE_URL` (download). Missing artifacts WARN and skip (armeabi-v7a/x86 have no engine → `isAvailable()` false). Binaries are gitignored. `packaging.jniLibs.useLegacyPackaging = true` = `extractNativeLibs=true`. **Owner gate:** the real artifact URL/CI drop is not wired here (no release URL is published yet).
- **Process manager** (`EngineProcessManager.kt`) — resolves `nativeLibraryDir/libengine.so` (API 24–28 `code_cache` extraction fallback), execs with `--data-dir/--bind/--ws-port/--wss-port/--admin-port/--log-level`, scans stdout line-by-line for `ENGINE_READY` (stdout is not pure JSON), pumps stderr, detects exits, restarts with exponential backoff (max 3), stops with SIGTERM→10s→SIGKILL. Periodic process-alive health watch (15s) + the wait-thread as the authoritative death detector.
- **⚠ Port conflict (doc↔reality), resolved:** the plan's Design said `--ws-port 0 --admin-port 0` (ephemeral). The landed engine's `validatePort` rejects ports <1024 and the readiness payload reports the *configured* ports (not the listener's), so `0` is not supported. Resolution: the manager allocates concrete free loopback ports up front and passes them explicitly; the readiness line confirms them. `ENGINE_READY` remains the handshake.
- **DB key** — forwarded via the `SE_DB_KEY` environment variable (the engine's real var; the plan's `ENGINE_DB_KEY` was a typo). Env (not `--db-key`) keeps the secret out of `ps` argv; same-uid-only environ visibility is the accepted, documented tradeoff. Never logged.
- **Foreground service** (`EngineSidecarService.kt`) — type `dataSync` on API 34+ (manifest `foregroundServiceType="dataSync"`), persistent "Soulbits engine running" notification, `FOREGROUND_SERVICE_DATA_SYNC` + `POST_NOTIFICATIONS` permissions. Lifecycle tied to the app usage window (started by JS; `START_NOT_STICKY`).
- **Bridge (deviation):** implemented as a legacy `ReactContextBaseJavaModule` + `EngineSidecarPackage` (registered in `MainApplication`), mirroring the existing `ChatBubble` module. The plan said "Turbo Native Module", but the repo has no `codegenConfig`/spec infrastructure and the sibling module is legacy; legacy modules are interop-supported under the new architecture, and the JS API surface is unchanged if a TurboModule spec is layered on later.
- **JS layer** — `src/types/engineSidecar.ts` (types) + `src/services/engine/EngineSidecarModule.ts` (wrapper). The TS side owns the wire→domain readiness parse (`parseReadyLine`/`scanStdoutForReady`), the canonical backoff schedule (`computeBackoffDelayMs`), and the status reducer (`nextEngineStatus`); the native side only detects the prefix and forwards the raw line + parsed fields. Events: `engine:ready|restarting|crashed|stopped|state|exit`. Feature flag `ENGINE_SIDECAR_ENABLED` (+ `setEngineSidecarEnabled`) for whole-module rollback.
- **Tests** — `src/services/engine/__tests__/EngineSidecarModule.test.ts` (25 tests): parsing (noise/partial lines/malformed), backoff schedule, status reducer, native-backed start/stop/state/availability with the native seam mocked, and event fan-out. Gates green: `tsc --noEmit` 0; `npm test` unit 153 suites/1422 tests + integration 13 suites/55 passed.
- **API surface for 3-2:** `isEngineSidecarAvailable()`, `startEngineSidecar(options) → EngineReadyPayload{wsPort,wssPort,adminPort,bind,pid,dataDir}`, `stopEngineSidecar()`, `getEngineSidecarState() → EngineStatus`, `onEngineSidecarEvent(listener)`, `onEngineExit(listener)`. The management-API client (3-2) dials `http://127.0.0.1:<adminPort>` from the readiness payload; 4-2 reuses this surface for iOS.
- **Owner device gates (not run here):** build variants + jniLibs placement + first-run smoke — exact steps in the final report.

