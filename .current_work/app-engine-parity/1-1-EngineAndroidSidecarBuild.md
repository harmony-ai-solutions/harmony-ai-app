# Phase 1-1 — Engine: Embeddable Android Sidecar Build

> **Repo:** `harmony-link-private` (branch `feat/app-engine-parity`)
> **Assessment basis:** §7.2 channel B (sidecar), §12.4 (localhost servers)
> **Codebase mapping consulted:** `.planning/codebase/` (engine — harmony-link-private): ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md

## Objective

Produce a **single static Android executable** of the engine that runs as a sidecar process: management server + event server bound to `127.0.0.1`, SQLite DB in the app's private storage, configurable data dir / ports / logging, no Wails, no Docker integration, no desktop UI assumptions.

## Design

- Build target: `cmd/engine-sidecar` (thin main) OR reuse `cmd/harmony-link` with a `--sidecar` profile flag — decide by how much of `cmd/root.go` init is profile-dependent; prefer a dedicated thin main that composes the same packages (eventserver, management, database, modules) minus Wails/integration.
- Packaging: cross-compiled `android/arm64` + `android/x86_64` (emulator) static binaries (CGO with NDK for `go-sqlite3`), named `libengine.so` and shipped in the app's `jniLibs` so they land in `nativeLibraryDir` (the W^X-compliant exec path on API 29+; Termux-proven pattern).
- Flags/config: `--data-dir`, `--bind 127.0.0.1`, `--ws-port`, `--admin-port`, `--log-level`, `--db-key` handling via env/file (SQLCipher-class key from app keychain — see 1-2). No `--cloud-mode` flag — cloud-account mode (2-5) needs no engine-side mode: it is on-device engine + injected provider configs, and the old cloud-mode machinery is deleted in 6-4.
- Lifecycle contract with the host app (documented, enforced in 1-2):
  - Startup: bind ports → run migrations → write readiness file/line to stdout (`ENGINE_READY {"ws":..., "admin":...}` JSON line) → serve
  - Shutdown: SIGTERM → graceful stop (in-flight tx commit, WS close, WAL checkpoint) → exit 0 within 10s
  - Single instance lock: lockfile in data dir (second start fails fast)
- Headless constraints: no `integration` (Docker) init, no tray/window, seed defaults (user entity) same as desktop boot path.

## Implementation steps

1. Create `cmd/engine-sidecar/main.go` (or profile flag): compose logger, config load, database open+migrations, module registry, eventserver, management server. (Pattern inspiration only from `cmd/cloud_mode.go`'s headless config composition — the file itself is retired in 6-4; do not build a dependency on it.)
2. Add `Makefile`/goreleaser target: `make sidecar-android` → CGO_ENABLED=1 with NDK toolchain (`CC=$NDK/toolchains/llvm.../aarch64-linux-android24-clang`) producing `libengine.so` per ABI; smoke-test the binary under the emulator (adb shell run).
3. Verify loopback-only binding + readiness line + SIGTERM checkpoint behavior (manual + scripted test in engine CI as a linux build variant).
4. Document the sidecar contract in `docs/` (engine): flags, env, readiness protocol, shutdown budget, lockfile.
5. CI: build the sidecar artifacts on engine release pipeline (artifacts for 1-2 to vendor into the app).

## Files to create/modify

- NEW `cmd/engine-sidecar/main.go` (+ build script / Makefile target)
- `config/` sidecar profile (if needed for defaults)
- Engine docs: NEW `docs/Sidecar-Deployment.md`, CHANGELOG.md

## Verification gates

- `go build/vet/test ./...` green
- Sidecar binary runs on an Android emulator: `ENGINE_READY` line, management API + event WS answer on loopback
- SIGTERM → clean exit ≤10s with WAL checkpoint (verify `-wal`/`-shm` gone or checkpointed)

## Risks & rollback

- NDK/CGO build friction (fork uses SQLite3MultipleCiphers) — mitigation: pin NDK version in CI; the fork already builds for desktop CGO
- exec-from-nativeLibraryDir edge cases on some OEMs — fallback: extract to `applicationInfo.dataDir/code_cache` on API < 29 only if any supported minSdk needs it (minSdk 24 → check per-API exec policy; primary path nativeLibraryDir works 29+; document the 24–28 fallback)

## Progress checklist

- [x] Sidecar main composes engine headlessly
- [x] Loopback bind + readiness protocol
- [x] SIGTERM graceful shutdown + checkpoint
- [x] Android build target (arm64 + x86_64) in CI with artifacts
- [ ] Emulator smoke test green
- [x] Contract documented

### Progress notes (task 1-1 implementation)

- **Sidecar main** — `cmd/engine-sidecar/main.go` (thin main; no Wails, no Docker integration init via `general.sidecarmode`). Composes `config/db` init+migrations+seed, `eventserver`, `management`, module registry, and the run-path push notifier. `hasGUI=true` is passed to both servers so the sidecar owns the lifecycle (servers install no signal handlers).
- **Loopback + readiness** — new `general.bindaddress` (default empty = all interfaces; sidecar defaults `127.0.0.1`) applied via `utils.ListenAddress` in both servers. Readiness is one `ENGINE_READY {json}` line on stdout; logs go to stderr.
- **SIGTERM + checkpoint** — sidecar handles SIGTERM/SIGINT, stops both servers, waits (bounded) on the new `eventserver.WaitForShutdown` for async WS/session teardown, then `database.CheckpointWAL`. Verified by `build_sidecar_smoke_test.sh` on a Linux (WSL) host: exit 0 in ~5s, no non-empty `-wal`/`-shm`.
- **Android target** — both ABIs cross-compiled successfully on the Windows host with NDK 27.1.12297006 (`arm64` → AArch64 PIE, `x86_64`→`amd64` x86-64 PIE; interpreter `/system/bin/linker64`). Scripts `build_sidecar_android.sh` / `.ps1`, `make sidecar-android`, and the `build-android-sidecar` CI job (NDK pinned `27.1.12297006` / `r27`) added. **First CI run pending** (cannot execute GitHub Actions locally).
- **Emulator smoke test** — **NOT run**: no Android emulator/device on this machine. Device/owner gate; exact commands in `docs/Sidecar-Deployment.md` ("Verifying a build").

