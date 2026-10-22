# Phase 4-2 — App: iOS Module Integration (Turbo Native Module)

> **Repo:** `harmony-ai-app` (branch `feat/app-engine-parity`)
> **Assessment basis:** §7.2 channel A, §8.5 (foreground-only engine semantics)
> **Codebase mapping consulted:** `.planning/codebase/` (app — harmony-ai-app): ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md

## Objective

Wire the `HarmonyEngine.xcframework` into the iOS app as the platform's `EngineHost` (unified with 1-2's Android sidecar host): Turbo Native Module wrapping the facade; engine lives and dies with the app process.

## Design

- `ios/` integration: Podfile/framework embedding; `EngineModule` (Swift/ObjC) exposing `start/stop/call/setCallback` to RN via Turbo Module spec mirroring the Android `EngineSidecar` module interface **exactly** (same TS types — the app's engine-service layer becomes platform-agnostic).
- `src/services/engine/`: unified `EngineHost` interface with two impls — `SidecarEngineHost` (Android) and `EmbeddedEngineHost` (iOS) — selected by platform; both yield `{wsPort, adminPort}` after readiness so everything downstream (3-2 API client) is shared.
- Lifecycle: start on first engine-dependent interaction (app foreground), stop on `AppState` background with a short grace (in-flight tx), restart on foreground; **no** background execution attempts in this phase (assessment §8 — documented product behavior: the iOS engine is a foreground tier; background continuity is the 4-3 blind-tick wake model).
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

- [x] XCFramework integrated *(project wiring + vendoring path landed; the artifact build itself is an owner gate — see notes)*
- [x] Turbo module + EngineHost unification *(legacy module per the 1-2 precedent; no codegen infra — see notes)*
- [x] AppState lifecycle + grace
- [ ] Device matrix green — **owner gate**
- [x] Release-note behavior documented *(CHANGELOG + iOS-local-mode scope)*

### Owner gates (unchecked, exact steps)

- [ ] **Build `HarmonyEngine.xcframework`** (macOS + Xcode) and vendor it — see "Owner gates" in the implementation notes below.
- [ ] **iOS device matrix** (physical iPhone): app backgrounding mid-chat, phone-call interruption, low-power mode foreground behavior.
- [ ] **App Store entitlement review** (iCloud container + keychain access group + `aps-environment`; embedded Go runtime + loopback servers).

### Implementation notes (task 4-2, 2026-10-12)

**Scope & shape.** Wired the 4-1 gomobile facade (`HarmonyEngine.xcframework`)
into the iOS app behind a native module, unified it with the Android sidecar
behind one `EngineHost` interface, added the AppState foreground-tier lifecycle,
DB key custody, and the 2-6 iOS-native pieces (HarmonyBackup: ubiquity container
+ W2 keychain; the app-side iCloud target flow).

**TS engine layer (new).** `src/services/engine/`:
- `EngineHost.ts` — the platform-agnostic interface + `selectEngineHost()`
  (sidecar on Android, embedded on iOS) + a test override seam.
- `SidecarEngineHost.ts` / `EmbeddedEngineHost.ts` — the two placements. Both
  yield the same `EngineReadyPayload`, so 3-2's client + the repository seam are
  shared unchanged.
- `EngineEmbeddedModule.ts` — the JS wrapper over `NativeModules.HarmonyEngine`
  (iOS), mirroring `EngineSidecarModule`'s surface EXACTLY (same types, same
  `engine:*` event names) plus `callEngineEmbedded` (the `EngineCall` RPC).
- `EngineLifecycle.ts` — a **pure reducer** (`reduceEngineLifecycle`) + an
  injectable controller (`createEngineLifecycle`) + the app-wide
  `attachEngineLifecycle()` singleton, wired at boot from
  `DatabaseContext.initializeDb()`. Foreground → start (reuse a live connection,
  else `connectEngine()`); background → arm a grace window (default 3000 ms)
  then stop; returning to foreground cancels the stop. The background stop is
  gated on the host's `foregroundTier` (iOS only) — Android keeps its
  foreground-service sidecar.
- `EngineDbKey.ts` — app-owned DB key custody: a 256-bit key in the Keychain
  (`AccessibleAfterFirstUnlockThisDeviceOnly`, device-local), resolved by
  `EmbeddedEngineHost.start()` when the caller passes none. Android's landed
  sidecar path is intentionally unchanged (it accepts `dbKey` already); adopting
  the custodian there is a one-line follow-up.
- `EngineMemoryTelemetry.ts` — the dev-build RSS hook (Design): samples the
  process resident set via the native `rssBytes` (mach `task_info`) and reports
  the delta across a chat session; observational only, never on a critical path.
- `EngineSidecarModule.ts` gained `parseReadyPayload`/`mapReadyJson` (the facade
  returns the bare readiness JSON, no `ENGINE_READY ` stdout prefix) reused by
  the embedded module; `parseReadyLine` now delegates to them (existing tests
  unchanged).
- `EngineService.ts` now routes `start/stop/getState/onEvent` through
  `selectEngineHost()`; its public API is unchanged.

**iOS native (new).** `ios/EngineModule/HarmonyEngineModule.{h,m}` — a legacy
`RCTEventEmitter` bridge (the repo's established pattern; see the 1-2 deviation
note — there is no `codegenConfig`, and legacy modules are interop-supported
under the new architecture) wrapping the gomobile C surface
(`EmbedEngineInit/Start/Stop/Call/SetEventCallback`) and the generated
`EmbedEventHandler` protocol (selector `onEvent:` — gomobile lower-cases the
first rune). It builds the `EngineInit` JSON (app-private
`Library/Application Support/engine`, `NSURLIsExcludedFromBackupKey`), returns
`{rawLine, wsPort, wssPort, adminPort, bind, pid, dataDir, token}`, tracks a
status string for `getState`, and maps facade lifecycle envelopes to
`engine:ready|state|stopped|error` (plus a generic `engine:event` channel).

**iOS native (2-6 half).** `ios/HarmonyBackup/HarmonyBackupModule.swift` (+ the
`RCT_EXTERN_MODULE` bridge `.m`) — ubiquity container
(`iCloud.ai.soulbits.chat`), `NSFileCoordinator` inbox↔container moves,
`NSMetadataQuery` upload progress + listing, account status, and the **W2 wrap**:
a `kSecAttrSynchronizable` iCloud-Keychain 256-bit unlock key
(`kSecAttrAccessibleAfterFirstUnlock`, app access group) that AEAD-wraps the DEK
with real ChaCha20-Poly1305 bytes. Note: the engine's manifest W2 entry stays
**informational** by design (`modules/backup/crypto.go` — the key material lives
in the Keychain, not the manifest); the real wrap is the Keychain item, and on
restore the module unwraps it and supplies the DEK to the engine as
caller-supplied unlock material. App-side TS: `backupNativeIos.ts` +
`icloudTarget.ts` (inbox dir, deps) + `BackupOrchestrator` now drives the iCloud
target (inbox staging, app-side probe, upload/restore sync, W2 store/read).

**Project wiring.** `project.pbxproj` adds the module sources, the entitlements
file (`CODE_SIGN_ENTITLEMENTS`), `FRAMEWORK_SEARCH_PATHS = $(SRCROOT)/Frameworks`,
and the `HarmonyEngine.xcframework` reference (STATIC framework → linked, not
embedded). `ios/Frameworks/README.md` documents the owner drop;
`/ios/Frameworks/*.xcframework` is gitignored (the jniLibs analogue). The
entitlements file declares the iCloud container + keychain access group +
`aps-environment`; `Info.plist` declares `UIBackgroundModes`
(processing/remote-notification) + `BGTaskSchedulerPermittedIdentifiers` for the
4-3 ride-along (handler lands with 4-3).

**Gates run.** `npx tsc --noEmit` = 0; `npm test` green (113 suites / 903 tests,
up from 104/823); `npx react-native config` exits 0 and parses the project (the
iOS project wiring is structurally valid). New suites: `EngineHost`,
`EngineEmbeddedModule`, `EngineLifecycle`, `EngineDbKey`, `EngineMemoryTelemetry`,
`icloudTarget`, plus a rewritten `EngineService` suite (host-injected).

**Owner gates (not runnable here).**
1. Build + vendor the XCFramework (macOS + Xcode):
   ```bash
   # In harmony-link-private (engine repo, branch feat/app-engine-parity):
   CGO_CFLAGS='-DSQLITE_ENABLE_SESSION -DSQLITE_ENABLE_PREUPDATE_HOOK' \
     ./build_facade_ios.sh
   cp -R build/ios/HarmonyEngine.xcframework \
     ../harmony-ai-app/ios/Frameworks/HarmonyEngine.xcframework
   # Then: cd ../harmony-ai-app/ios && pod install && open HarmonyAIChat.xcworkspace
   ```
2. iOS device matrix (physical iPhone): launch → engine starts (foreground) →
   chat; background mid-chat → engine stops after the grace window → foreground →
   engine restarts and the conversation resumes; phone-call interruption;
   low-power-mode foreground behavior; RSS before/after a chat session (dev).
3. App Store entitlement review + first submission (iCloud container, keychain
   access group, `aps-environment`; embedded runtime + loopback servers).

**Deviations.**
- Legacy RN module (not a TurboModule spec) — the 1-2 precedent: no
  `codegenConfig` in the repo; the JS surface is identical if a spec is layered
  on later.
- DB key custody is wired for the iOS embedded host only; Android's landed
  sidecar path is left byte-identical (the custodian + `dbKey` option are ready
  for it).
- The XCFramework is linked as a STATIC framework (gomobile `-buildmode=c-archive`
  → no embed phase needed).
- Swift/ObjC cannot be compiled on this host (no `swiftc`/`clang`/`pod`); the
  sources were reviewed against the gomobile generator in the pinned
  `golang.org/x/mobile` module cache for exact symbol names. `pod install` /
  `podspec lint` are macOS owner gates.
