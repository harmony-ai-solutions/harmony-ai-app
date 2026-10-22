# Phase 4-1 — Engine: Gomobile Facade & XCFramework Build

> **Repo:** `harmony-link-private` (branch `feat/app-engine-parity`)
> **Assessment basis:** §7.2 channel A (in-process module; gomobile type constraints → JSON facade)
> **Depends on:** 1-1 (the facade hosts the same loopback servers the sidecar build packages — see design below)
> **Codebase mapping consulted:** `.planning/codebase/` (engine — harmony-link-private): ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md

## Objective

A stable, narrow embedding facade over the engine core, compiled to an iOS `.xcframework` (and reusable Android AAR for the in-process fallback), with a JSON-in/JSON-out + event-callback boundary.

## Design

- NEW `embed/facade.go` (+ `embed/` package) — gomobile-bindable surface (primitives, strings, []byte only):
  - `EngineInit(configJSON string) error` — config: data dir, db key, log level, loopback bind, cloud PASETO (optional), dataset identity
  - `EngineStart() (string, error)` / `EngineStop() error` — returns readiness JSON (ports)
  - `EngineCall(method string, payloadJSON string) (string, error)` — multiplexed RPC over the facade (thin internal router): management-API-equivalent reads, session ops, `FireCatchUp`, `PlanCatchUp`, dream/compact triggers, sync-client control (dial/yield/status)
  - `EngineSetEventCallback(cb EventHandler)` — events surfaced as JSON strings (`message:received`, `session:*`, `sync:*`, `engine:*` for the RN bridge to emit)
- Implementation strategy: the facade hosts the **same loopback servers** as the sidecar (1-1 packages) and `EngineCall` is an internal HTTP client to them — maximal reuse of the real transports; the RN layer then talks **directly to the loopback ports** for everything except lifecycle/control calls. This keeps ONE serving path (sidecar and in-process differ only in process placement).
- Build: `gomobile bind -target=ios,android` with CGO (sqlite fork) → artifacts `HarmonyEngine.xcframework` + `.aar`; CI artifacts pinned by engine version.
- Constraints honored: no goroutine leakage across `EngineStop`; signal-free (no SIGTERM on iOS — `EngineStop` performs the graceful path); memory ceiling awareness (document expected RSS).
- Exclude from the module: Wails, integration/Docker, desktop UI deps — build tags keep them out.

## Implementation steps

1. `embed/` package: init/start/stop lifecycle, callback plumbing, internal router for `EngineCall`.
2. gomobile build scripts + CI artifacts; size/RSS report per target.
3. Unit tests on the router (table-driven JSON contracts); integration: in-process start → loopback connect → management read → catch-up call → stop (no leaks — `runtime.NumGoroutine` before/after).
4. Contract doc: `docs/Embed-Facade.md` (method list, event list, versioning — facade version tied to engine version).

## Files to create/modify

- NEW `embed/` (+ tests), build scripts, CI artifact jobs
- Engine docs: `docs/Embed-Facade.md`, CHANGELOG.md

## Verification gates

- `go build/vet/test ./...` green
- gomobile artifacts build for ios + android; facade round-trip tests green; leak check green
- Artifact sizes recorded

## Risks & rollback

- gomobile + CGO fork build friction on iOS — fallback: sidecar-style is impossible on iOS; alternative is WASM (§7.2 channel C, weakest) — treat build breakage as a priority-0 blocker
- App Store review risk of embedded Go runtime: low (precedent), monitor

## Progress checklist

- [x] Facade package + router + callback plumbing
- [x] Loopback-reuse strategy verified in-process
- [x] iOS + Android artifacts in CI *(CI jobs added; first CI run pending — see notes)*
- [x] Leak + round-trip tests green
- [x] Contract doc

### Progress notes (task 4-1 implementation)

**Facade + router + callbacks.** NEW `embed/` package — gomobile-bindable
surface `EngineInit(configJSON string) error`, `EngineStart() (string, error)`,
`EngineStop() error`, `EngineCall(method, payloadJSON string) (string, error)`,
`EngineSetEventCallback(cb EventHandler)`, `EngineVersion() string`, plus
`EventHandler interface{ OnEvent(eventJSON string) }`. Only primitives/strings/
`error` + the single-method callback cross the boundary; all structured data is
JSON. `EngineCall` is a thin router: `engine.status`/`engine.version`,
`management.request` (generic proxy to the loopback management server with the
loopback token injected), `lifecycle.planCatchUp`/`fireCatchUp`/`batch`/
`maintenance`, and `sync.status`/`dial`/`yield`. `fireCatchUp` is a single-entity
pass over the batch orchestrator (the documented equivalence). Event callbacks
are delivered as JSON envelopes (`kind` ∈ `message:received` / `session:event` /
`sync:event` / `engine:event` + facade `engine:started|ready|stopped`) on a
dedicated dispatcher goroutine.

**Loopback reuse = ONE serving path.** Extracted the sidecar's composition into
a NEW importable `enginehost` package (`Host.Start/Stop`, `HeadlessConfig`,
`Ready`, sync dial/yield accessors) and refactored `cmd/engine-sidecar` to a
thin main (flags/env/file precedence + lock + readiness line + signals) that
delegates to it. The facade composes through the same package, so sidecar and
facade serve identically (DB + migrations + seeding, event server, management
API, changeset store, sync client; loopback bind; per-process loopback token).
The in-process round-trip test starts the real servers and connects over
loopback (`/public/appname`, `management.request`, batch, maintenance).

**Engine seams added.** `lifecycle.BuildRunnerForEntity` (+ exported
`lifecycle.InitBackendClient`) — construct a one-shot `EntityBeatRunner` without
starting the timer loop (the batch host's `NewRunner` factory); `eventserver`
session-manager event tap (`SetEventTap`, fed from
`HarmonyLinkConnectionEventProcessor.SendEvent`); nil-listener guards in
`management.OpenComms` and `eventserver.OpenComms` so a port collision degrades
to "not serving" instead of panicking (relevant for an in-process host). All
LOW-risk per GitNexus impact analysis.

**Build scripts + CI.** `build_facade_ios.sh` (`gomobile bind -target=ios` →
`HarmonyEngine.xcframework`), `build_facade_android.sh` (`-target=android` →
`HarmonyEngine.aar`), `make facade-ios|facade-android|facade-test`, and CI jobs
`build-facade-ios` (macos-latest) / `build-facade-android` (ubuntu-latest, pinned
NDK `27.1.12297006`) that record artifact sizes. **The artifact builds were NOT
run here** — iOS requires macOS + Xcode, and Go 1.26's gomobile additionally
requires `golang.org/x/mobile` in the module graph (`go get -tool
golang.org/x/mobile/cmd/gobind` + re-vendor, which bumps the `x/*` family). The
scripts apply that step themselves; the dependency bump is left as an owner
decision (deliberately not committed here). Owner gate, exact commands:
```bash
# iOS (macOS + Xcode):
CGO_CFLAGS='-DSQLITE_ENABLE_SESSION -DSQLITE_ENABLE_PREUPDATE_HOOK' ./build_facade_ios.sh
# Android (NDK 27.1.12297006):
ANDROID_NDK_HOME=$ANDROID_HOME/ndk/27.1.12297006 ./build_facade_android.sh
```

**Tests.** NEW `embed/facade_test.go`: config/event-contract unit tests + an
in-process integration test (start → loopback connect → management read →
batch/maintenance/planCatchUp → stop) with a `runtime.NumGoroutine` leak check,
a lifecycle-event callback test, and an init→start→stop→start→stop restart test.
Gates: `go build ./...`, `go vet ./...`, `go test ./...` all exit 0 with
`CGO_CFLAGS='-DSQLITE_ENABLE_SESSION -DSQLITE_ENABLE_PREUPDATE_HOOK'`. CGO SQLite
confirmed working via the facade compiling/linking with CGO on the dev host.

**Deviation.** Docker/Wails are not build-tag-excluded: the facade imports
`management` (→ `integration` → the Docker SDK), which **compiles for
darwin/arm64** (verified) and is never initialised at runtime (`SidecarMode`),
matching the landed sidecar precedent. Build-tag exclusion of the Docker SDK is
a size optimisation, not a build blocker — flagged for the owner.

**Docs.** NEW `docs/Embed-Facade.md` (method table, event contract, lifecycle
semantics, build/owner-gate commands, versioning, 4-2/4-3 consumer notes);
`docs/README.md` index; `CHANGELOG.md`.
