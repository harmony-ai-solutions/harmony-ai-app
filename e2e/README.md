# E2E Tests — HarmonyAIChat

## Architecture

```
┌───────────────────────── Docker network: harmony-e2e ──────────────────────────┐
│                                                                                │
│   harmony-link              android-emulator            maestro-runner          │
│   (Go backend)              (budtmo/docker-android)     (custom image)         │
│                                                                                │
│   ┌─────────────┐          ┌──────────────────┐        ┌─────────────────┐    │
│   │ HTTP :28080 │          │ ADB :5555         │        │ adb connect     │    │
│   │ WSS :28443  │          │ noVNC :6080       │        │ adb install     │    │
│   │ /health     │          │ Android 14        │        │ maestro test    │    │
│   └──────┬──────┘          └────────┬─────────┘        └────────┬────────┘    │
│          │                          │                          │              │
│          │              ┌───────────┘                          │              │
│          │              │  10.0.2.2:28443 (emulator→host)      │              │
│          │              │  ┌──────────────────┐                │              │
│          │              └──► App in emulator  │◄───────────────┘              │
│          │                 │ wss://10.0.2.2   │   ADB commands                 │
│          │                 │      :28443      │                                │
│          │                 └──────────────────┘                                │
│          │                                                                     │
│          └─────────────────────────────────────────────────────────────────────┘
│                               WSS (sync protocol)                              │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Prerequisites

- **Docker Desktop** with ≥4GB RAM allocated for the emulator
- **KVM acceleration** on the host:
  - Linux: `/dev/kvm` must exist (`ls -la /dev/kvm`)
  - Windows: WSL2 + Docker Desktop — `/dev/kvm` is exposed by default (validated July 2026)
  - macOS: not supported — use the iOS E2E workflow instead
- **Harmony Link image**: locally-built `soulbits/harmony-link:latest` (build from `harmony-link-private/Dockerfile.build`)
- **Debug APK** built with E2E gradle properties (see Quick Start)

## Quick Start (Linux or WSL2 with KVM)

```bash
# 1. Build the harmony-link image (one-time, rebuild after backend changes)
cd harmony-link-private && docker build -f Dockerfile.build -t soulbits/harmony-link:latest .

# 2. Build the debug APK with E2E gradle properties
./e2e/build-apk.sh
# (Windows PowerShell: .\e2e\build-apk.ps1)

# 3. Start the full stack (harmony-link + android-emulator + maestro-runner)
docker compose -f e2e/docker-compose.yml up --abort-on-container-exit

# 4. Check reports after run
ls e2e/reports/
```

## How to Run

| Command | What it does |
|---------|-------------|
| `docker compose -f e2e/docker-compose.yml up --abort-on-container-exit` | Start everything; exits when Maestro finishes |
| `docker compose -f e2e/docker-compose.yml up -d harmony-link android-emulator` | Start backend + emulator in background |
| `docker compose -f e2e/docker-compose.yml up maestro-runner` | Re-run the full test suite (uses the service's built-in `command:` — stack must already be running) |
| `docker compose -f e2e/docker-compose.yml run --rm maestro-runner maestro test /app/.maestro --include-tags smoke` | Run only smoke-tagged flows (uses `run` to override the service command) |
| `docker compose -f e2e/docker-compose.yml run --rm maestro-runner maestro studio` | Open Maestro Studio for interactive flow authoring (uses `run` to override the service command) |

> **`up` vs `run`:** Use `docker compose up maestro-runner` for the standard re-run — it attaches to the existing deployment and honours `depends_on` conditions (waits for harmony-link and android-emulator to be healthy). Use `docker compose run --rm` only when you need to **override** the service's default command (e.g. different Maestro flags, interactive studio).

## CI Schedule

| Trigger | Scope | Workflow | Duration |
|---------|-------|----------|----------|
| Pull request (touches `e2e/**`) | Full E2E suite (Android + iOS) | `e2e-android.yml`, `e2e-ios.yml` | ~20 min (Android), ~20 min (iOS) |
| Pull request (touches `ios/**` or `e2e-ios.yml`) | iOS E2E only | `e2e-ios.yml` | ~20 min |
| Nightly 03:00 UTC | Full E2E suite (Android) | `e2e-android.yml` | ~20 min |
| Nightly 04:00 UTC | Full E2E suite (iOS) | `e2e-ios.yml` | ~20 min |
| Manual dispatch | Full E2E suite for selected platform | `e2e-android.yml` or `e2e-ios.yml` | ~20 min |
| Release tag `v*` | (none by default — nightly results are trusted) | — | — |

### Run E2E on demand

1. Go to Actions tab → **E2E (Android, Docker)** or **E2E (iOS, macOS runner)**.
2. Click **Run workflow** → choose branch → click **Run workflow**.
3. Wait ~20 minutes.
4. Download the `e2e-android-reports` or `e2e-ios-reports` artifact for JUnit XML.

### Cost

| Workflow | Runner | Cost estimate |
|----------|--------|---------------|
| Android E2E | `ubuntu-latest` (KVM-enabled) | Included in GitHub Actions Linux minutes (free tier: ~2000 min/mo) |
| iOS E2E | `macos-15` | ~$0.08/min (~$25-35/mo for nightly + occasional manual runs) |

See `.github/workflows/` for the GitHub Actions workflow definitions.

## File Structure

```
e2e/
├── docker-compose.yml              # Top-level orchestration
├── Dockerfile.maestro              # Maestro runner image
├── app-debug.apk                   # Built separately (gitignored)
├── .env.e2e                        # Android E2E build config
├── .env.e2e.ios                    # iOS Simulator E2E build config
├── .maestro/
│   ├── config.yaml                 # Maestro-wide configuration
│   ├── 01-smoke-boot.yaml          # Smoke test: boot + connect
│   ├── 02-happy-path-pull.yaml     # Happy path: server → client sync
│   ├── 03-conflict-resolution.yaml # Conflict: server wins by timestamp
│   ├── 04-network-reconnect.yaml   # Resilience: drop → reconnect
│   └── _shared/
│       └── navigate-to-sync-settings.yaml
├── reports/                        # JUnit XML output (gitignored)
├── certs/                          # Self-signed CA + server cert (generated)
└── README.md                       # This file
```

## Debugging Tips

### View the emulator screen via noVNC

Open http://localhost:6080 in a browser while the stack is running.

### Tail logs

```bash
docker compose -f e2e/docker-compose.yml logs harmony-link -f
docker compose -f e2e/docker-compose.yml logs android-emulator -f
docker compose -f e2e/docker-compose.yml logs maestro-runner -f
```

### Re-run only the test runner (without restarting emulator)

```bash
docker compose -f e2e/docker-compose.yml up maestro-runner --force-recreate
```

### Check Harmony Link health

```bash
curl -f http://localhost:28080/health
```

### Check emulator ADB connectivity

```bash
docker exec android-emulator adb devices
```

### Use Maestro Studio for interactive flow authoring

```bash
docker compose -f e2e/docker-compose.yml run --rm maestro-runner maestro studio
```

This opens an interactive UI at http://localhost:8090 for recording flows against the running emulator.

## Windows Developers (Emulator-on-Host Fallback)

WSL2 + nested KVM is widely reported to be slow and unreliable for Android emulation.
The recommended approach for Windows is to run the Android emulator directly on the Windows host
(via Android Studio), while Docker containers handle harmony-link and maestro-runner.

### Setup

```powershell
# 1. Boot the emulator from Android Studio on Windows (any AVD)
# 2. Ensure ADB is accessible on the host
adb -a -P 5037 nodaemon server
adb devices   # confirm emulator is visible

# 3. Start only harmony-link in Docker
docker compose -f e2e/docker-compose.yml up -d harmony-link

# 4. Run Maestro against the host emulator (overrides ADB_TARGET)
docker compose -f e2e/docker-compose.yml run --rm ^
  -e ADB_TARGET=host.docker.internal:5555 ^
  maestro-runner
```

The `ADB_TARGET` env var tells the maestro-runner container to connect to the Windows
host's emulator via Docker's `host.docker.internal` DNS name.

### Why not emulator-in-WSL2?

- Requires `nestedVirtualization=true` in `.wslconfig`
- Requires manual KVM permission setup in `/etc/wsl.conf`
- Boot times are typically 3-5× slower than native
- Commonly reported to hang or crash

If you do want to try WSL2 + nested KVM:
1. Create `%UserProfile%\.wslconfig` with:
   ```ini
   [wsl2]
   nestedVirtualization=true
   ```
2. Inside WSL2, run: `sudo chmod 666 /dev/kvm`
3. Verify: `docker run --rm --privileged --device /dev/kvm budtmo/docker-android:emulator_14.0`

## iOS E2E (macOS only — currently deferred)

iOS Simulator cannot run in Docker (Apple EULA + technical reasons).
iOS E2E runs on macOS GitHub Actions runners.

> **Status (July 2026):** The `.github/workflows/e2e-ios.yml` workflow exists
> but is **not triggered**. iOS E2E is excluded until the Android stack is
> validated end-to-end. See `docs/future-work.md` item #21.

```bash
# Build the iOS Simulator .app with E2E gradle properties
cd ios && xcodebuild \
  -HARMONY_LINK_WSS_URL=wss://localhost:28443 \
  -HARMONY_LINK_WS_URL=ws://localhost:28080 \
  # (See .github/workflows/e2e-ios.yml for the full build invocation)
```

The same `e2e/.maestro/*.yaml` Maestro flows are reused for iOS.
Prefer `text:` selectors over `id:` for cross-platform compatibility.
Use Maestro's `platform:` filter for platform-specific steps.

See `.current_work/test-framework-overhaul/6-6-IOSMacOSRunner.md` for full details.

## Harmony Link Service

We use the **locally-built image** `soulbits/harmony-link:latest` (built from
`harmony-link-private/Dockerfile.build`). The compose file sets `pull_policy: never`
so Docker doesn't try to fetch it from a registry.

No separate Dockerfile.e2e is needed — the same image runs headless via `CMD ["disable-gui"]`
and accepts configuration via `CLOUD_MODE=true` + `HL_*` environment variables.

This mirrors the pattern from `soulbits-cloud-backend`'s `runHarmonyLinkContainer()` function.
See `.current_work/test-framework-overhaul/6-2-HarmonyLinkService.md` for the full rationale.

### Why no Dockerfile.e2e?

- The production image already runs headless by default
- A separate Dockerfile would diverge from the tested production image and require ongoing sync work
- Self-signed cert generation is built into Go code (`auth/cert_manager.go`) — no shell script needed
- The `/health` endpoint already exists (`eventserver/request.go:42-50`) — returns 200 after DB migrations

## Self-Signed TLS

The E2E stack uses the app's existing `react-native-websocket-self-signed` library to bypass
certificate validation (Phase 6 simplification). The app connects to `wss://10.0.2.2:28443`
(Android) or `wss://localhost:28443` (iOS) where Harmony Link serves a self-signed cert
auto-generated at startup.

> **This is a known simplification.** The E2E test does not exercise the real TLS trust path.
> Phase 8 backlog includes hardening to push the E2E CA into the Android user cert store and
> configure `network_security_config.xml` for hostname-verified trust.

See `.current_work/test-framework-overhaul/6-4-SelfSignedTLSBootstrap.md` and
`.current_work/test-framework-overhaul/tls-current-state.md` for details.

## Maestro Flow Tuning

All Maestro flows use placeholder UI selectors (e.g., `text: "Connected"`). These **must** be
tuned against the real app UI before the flows can pass in CI. The recommended workflow:

1. Start the stack: `docker compose -f e2e/docker-compose.yml up -d harmony-link android-emulator`
2. Open Maestro Studio: `docker compose run --rm maestro-runner maestro studio`
3. Interactively record flows against the running emulator
4. Export and replace the placeholder YAML files

See `.current_work/test-framework-overhaul/6-5-MaestroFlows.md` for flow design details.

## Related Documentation

All Phase 6 planning documents are in `.current_work/test-framework-overhaul/`:

| Document | Topic |
|----------|-------|
| `6-1-DockerComposeStack.md` | Docker Compose architecture and design decisions |
| `6-2-HarmonyLinkService.md` | Harmony Link image reuse, cloud-mode config, healthcheck, cert generation |
| `6-3-AndroidEmulatorService.md` | Emulator configuration, KVM, device selection, WSL2 fallback |
| `6-4-SelfSignedTLSBootstrap.md` | TLS trust handling, WSS URL, cert injection |
| `6-5-MaestroFlows.md` | Maestro YAML flow design, coordination, orchestration |
| `6-6-IOSMacOSRunner.md` | iOS Simulator E2E strategy, macOS runner workflow, cost model |
| `tls-current-state.md` | Current TLS handling in the app (read-only audit) |
| `spike-results-6-3.md` | KVM/emulator validation spike results (deferred) |
