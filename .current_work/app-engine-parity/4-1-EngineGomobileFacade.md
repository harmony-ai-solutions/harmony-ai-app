# Phase 4-1 — Engine: Gomobile Facade & XCFramework Build

> **Repo:** `harmony-link-private` (branch `feat/app-engine-parity`)
> **Assessment basis:** §7.2 channel A (in-process module; gomobile type constraints → JSON facade)

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

- [ ] Facade package + router + callback plumbing
- [ ] Loopback-reuse strategy verified in-process
- [ ] iOS + Android artifacts in CI
- [ ] Leak + round-trip tests green
- [ ] Contract doc
