# Phase 6-1: Docker Compose Stack

> **STATUS: ✅ COMPLETE** (post-plan updates: image swapped to `soulbits/harmony-link`,
> healthcheck regex fixed). See "Post-plan updates" at the bottom of this file.

## Objective

Define the top-level `docker-compose.yml` that orchestrates all E2E services: the Harmony Link Go backend, the Android emulator, and the Maestro test runner. This is the entry point that developers run locally with `docker compose up` and that CI runs in GitHub Actions.

## Context

This mirrors the existing pattern from the neighboring **Soulbits Cloud Backend** repo, where E2E tests run entirely in Docker containers with backend services spawned as Compose services. The same pattern applies cleanly to RN app testing on Android.

**Architecture**:

```
┌────────────────── Docker network: harmony-e2e ──────────────────────┐
│                                                                     │
│   harmony-link          android-emulator          maestro-runner    │
│   (Go backend)          (budtmo/docker-android)   (custom image)    │
│                                                                     │
│   HTTP :28080           ADB :5555                  drives emulator   │
│   WSS :28443            noVNC :6080 (debug)        via ADB           │
│   Self-signed TLS       KVM accel                                    │
│   /health endpoint      auto by image                                │
│   Auto-config via                                                     │
│   HL_* env vars                                                       │
│                                                                     │
│   ↳ app connects to     ← receives APK              runs flows       │
│     wss://harmony-link  ← via adb install           in .maestro/     │
│     :28443                                                             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

The Maestro runner depends on the other two services being healthy before it starts.

## Prerequisites

- Phase 5-2 complete (the Go backend has a Dockerfile or can be built into one).
- Confirm access to `budtmo/docker-android:emulator_14.0` on the team's Docker registries.
- Local Docker Desktop installed on at least one developer machine for validation.

## Implementation Steps

### 1. Create the `e2e/` directory structure

```
e2e/
├── docker-compose.yml         # Top-level orchestration
├── Dockerfile.maestro         # Test runner image
├── certs/                     # Self-signed CA + server cert (generated or committed)
│   ├── ca.pem
│   └── server.pem
├── .maestro/                  # Maestro YAML flows
│   ├── happy-path.yaml
│   ├── conflict-resolution.yaml
│   └── reconnect.yaml
└── README.md                  # How to run E2E locally
```

### 2. Write the `docker-compose.yml`

```yaml
# e2e/docker-compose.yml
version: "3.9"

# This stack orchestrates the full E2E environment for HarmonyAIChat:
#   1. harmony-link     — Go backend speaking the WSS sync protocol
#   2. android-emulator — Android 14 emulator with KVM acceleration
#   3. maestro-runner   — Test runner that installs the APK and executes flows
#
# Usage:
#   docker compose -f e2e/docker-compose.yml up -d harmony-link android-emulator
#   # Wait for emulator to boot, then:
#   docker compose -f e2e/docker-compose.yml up maestro-runner
#
# Or all-in-one (aborts when maestro-runner exits):
#   docker compose -f e2e/docker-compose.yml up --abort-on-container-exit

services:
  # ──────────────────────────────────────────────────────────────────
  # Harmony Link Go backend
  # Uses the PUBLISHED production image as-is (no separate build).
  # See Phase 6-2 for full rationale — the image runs headless via
  # CMD ["disable-gui"] and ships with /health + self-signed cert gen.
  # Env var pattern mirrors soulbits-cloud-backend's runHarmonyLinkContainer().
  # ──────────────────────────────────────────────────────────────────
  harmony-link:
    image: harmonyai/harmony-link:latest   # public Docker Hub; or soulbits/harmony-link:latest for ECR
    container_name: harmony-link
    hostname: harmony-link
    ports:
      - "28080:28080"   # HTTP/WS — healthcheck uses plain HTTP here
      - "28443:28443"   # WSS/TLS — app sync traffic
      # - "28081:28081" # Admin API (uncomment if E2E exercises it)
    environment:
      # Cloud mode enables HL_* env var overrides
      CLOUD_MODE: "true"
      HL_GENERAL_PORT: "28080"
      HL_WSS_PORT: "28443"
      HL_ADMIN_PORT: "28081"
      HL_DATA_DIR: "/data"
      HL_DATABASE_FILENAME: "data.sqlite"
      HL_DATABASE_ENCRYPTION: "false"
      HL_INFERENCE_TOKEN: "e2e-test-token"
    volumes:
      - harmony-link-data:/data
    healthcheck:
      # Plain HTTP on port 28080 — matches soulbits-cloud-backend pattern
      test: ["CMD", "curl", "-f", "http://localhost:28080/health"]
      interval: 5s
      timeout: 3s
      retries: 12                    # Up to 60s startup grace
      start_period: 10s
    networks:
      - harmony-e2e

  # ──────────────────────────────────────────────────────────────────
  # Android emulator
  # (Phase 6-3 details the configuration)
  # ──────────────────────────────────────────────────────────────────
  android-emulator:
    image: budtmo/docker-android:emulator_14.0
    container_name: android-emulator
    privileged: true
    devices:
      - /dev/kvm:/dev/kvm
    environment:
      EMULATOR_DEVICE: "Samsung Galaxy S10"
      WEB_VNC: "true"
      APPIUM: "false"
      AUTO_RECORD: "false"
    ports:
      - "6080:6080"                  # noVNC (debug only — don't expose in CI)
      - "5555:5555"                  # ADB
    volumes:
      - emulator-data:/home/androidusr
      - ./certs:/certs:ro
    healthcheck:
      # budtmo writes "device_status=online" to a known file when fully booted
      test: ["CMD", "bash", "-c", "grep -q 'device_status=online' /home/androidusr/device_status 2>/dev/null || grep -q 'booted' /home/androidusr/device_status 2>/dev/null"]
      interval: 10s
      timeout: 5s
      retries: 30                    # Up to 5 minutes
      start_period: 30s
    networks:
      - harmony-e2e

  # ──────────────────────────────────────────────────────────────────
  # Maestro test runner
  # (Phase 6-5 details the flows; image build is in Dockerfile.maestro)
  # ──────────────────────────────────────────────────────────────────
  maestro-runner:
    build:
      context: .
      dockerfile: e2e/Dockerfile.maestro
    container_name: maestro-runner
    depends_on:
      harmony-link:
        condition: service_healthy
      android-emulator:
        condition: service_healthy
    environment:
      - HARMONY_LINK_URL=wss://harmony-link:28443
      - HARMONY_LINK_HEALTH_URL=http://harmony-link:28080/health
    volumes:
      # The APK is expected to be at e2e/app-debug.apk (built separately, see Phase 7-3)
      - ./app-debug.apk:/app/app.apk:ro
      - ./.maestro:/app/.maestro:ro
      - ./certs:/certs:ro
      - ./reports:/app/reports             # Maestro test reports
    command: >
      sh -c "
        adb connect android-emulator:5555 &&
        adb wait-for-device &&
        adb install -r /app/app.apk &&
        maestro test /app/.maestro --format junit --output /app/reports
      "
    networks:
      - harmony-e2e

networks:
  harmony-e2e:
    driver: bridge

volumes:
  emulator-data:
```

### 3. Write the `Dockerfile.maestro`

```dockerfile
# e2e/Dockerfile.maestro
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Prerequisites: JDK 17 (for Android SDK tools), ADB, curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-17-jdk \
    android-tools-adb \
    curl \
    ca-certificates \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Install Maestro CLI
RUN curl -fsSL "https://get.maestro.mobile.dev" | bash
ENV PATH="$PATH:/root/.maestro/bin"

WORKDIR /app

# Default command (overridden by docker-compose)
CMD ["maestro", "test", "/app/.maestro"]
```

### 4. Validate locally

On a Linux machine (or WSL2 with KVM working — see Phase 6-3):

```bash
# 1. Pull the published Harmony Link image (no build step!)
docker pull harmonyai/harmony-link:latest

# 2. Build a debug APK of the RN app
cd android && ./gradlew assembleDevDebug
cp app/build/outputs/apk/dev/debug/app-dev-debug.apk e2e/app-debug.apk

# 3. Start the stack
docker compose -f e2e/docker-compose.yml up

# Expected: emulator boots, APK installs, Maestro runs flows, reports written to e2e/reports/
```

### 5. Write the `e2e/README.md`

```markdown
# E2E Tests

## Running locally (Linux or WSL2 with KVM)

1. Pull the published Harmony Link image: `docker pull harmonyai/harmony-link:latest`
   (No build step — see Phase 6-2 for why we reuse the production image.)
2. Build the debug APK: `cd android && ./gradlew assembleDevDebug`
3. Copy APK: `cp app/build/outputs/apk/dev/debug/app-dev-debug.apk e2e/app-debug.apk`
4. Start the stack: `docker compose -f e2e/docker-compose.yml up`
5. Reports: `e2e/reports/`

## Debugging

- View the emulator visually: open http://localhost:6080 in a browser (noVNC)
- Tail Harmony Link logs: `docker compose logs harmony-link -f`
- Tail emulator logs: `docker compose logs android-emulator -f`
- Re-run only Maestro (without restarting emulator): `docker compose up maestro-runner --force-recreate`
- Verify Harmony Link is healthy: `curl -f http://localhost:28080/health`

## Windows developers

WSL2 + nested KVM is fragile (see Phase 6-3). Alternative: run the Android emulator
on the Windows host directly (via Android Studio), then start only harmony-link
and maestro-runner in Docker:

    docker compose -f e2e/docker-compose.yml up harmony-link
    # On host: adb connect host.docker.internal:5555 (with emulator already running)
    docker compose -f e2e/docker-compose.yml run --rm \
      -e HARMONY_LINK_URL=wss://harmony-link:28443 \
      maestro-runner sh -c "adb connect host.docker.internal:5555 && maestro test /app/.maestro"
```

## Files to Create

- `e2e/docker-compose.yml`
- `e2e/Dockerfile.maestro`
- `e2e/README.md`

## Validation

- [ ] `docker compose -f e2e/docker-compose.yml config` validates the file (no syntax errors)
- [ ] `harmony-link` service starts and reports healthy within 60s
- [ ] `android-emulator` service boots and reports healthy within 5 min
- [ ] `maestro-runner` waits for both healthy before starting (via `depends_on: condition: service_healthy`)
- [ ] APK is installed successfully (`adb install` exits 0)
- [ ] At least one trivial Maestro flow runs to completion (Phase 6-5 will add real flows)
- [ ] Reports are written to `e2e/reports/` with JUnit XML format

## Open Questions to Resolve During Implementation

- **Does `budtmo/docker-android:emulator_14.0` ship with the `device_status` file used in the healthcheck?** Verify the exact filename and content. The budtmo README is the source of truth.
- **Docker Hub vs. ECR for the harmony-link image?** The compose file uses `harmonyai/harmony-link:latest` (public Docker Hub, no auth). If rate limits or pull latency become an issue, switch to `soulbits/harmony-link:latest` (ECR, requires AWS auth) or mirror to GHCR. See Phase 6-2 for the full image sourcing discussion.
- **KVM availability**: The compose file requires `/dev/kvm` on the host. Document that this won't work on macOS or non-KVM Windows hosts.

## Estimated Effort

Half a day to write the compose file. The bulk of validation is waiting for the emulator to boot reliably.

---

## Post-plan updates (July 2026)

The compose file shipped in the initial implementation but accumulated several
fixes during the post-plan Docker validation work. The current state of
`e2e/docker-compose.yml` reflects all of these.

### Image name: `soulbits/harmony-link` (not `harmonyai/harmony-link`)

Original compose file used `harmonyai/harmony-link:latest` (Docker Hub, Dec 2025).
Updated to `soulbits/harmony-link:latest` — the locally-built image from
`harmony-link-private/Dockerfile.build` that the developer maintains. Added
`pull_policy: never` so compose doesn't try to fetch from Docker Hub.

To rebuild locally:
```
cd harmony-link-private
docker build -f Dockerfile.build -t soulbits/harmony-link:latest .
```

### Healthcheck bug fix: grep `READY`

Original healthcheck:
```yaml
test: ["CMD", "bash", "-c", "[ -f /home/androidusr/device_status ] && (grep -q 'device_status=online' /home/androidusr/device_status 2>/dev/null || grep -q 'booted' /home/androidusr/device_status 2>/dev/null)"]
```

Empirically validated against `budtmo/docker-android:emulator_14.0`:
the actual status string is just `READY` (no `device_status=` prefix).
Fixed healthcheck:
```yaml
test: ["CMD", "bash", "-c", "[ -f /home/androidusr/device_status ] && grep -q 'READY' /home/androidusr/device_status"]
```

Without this fix, the healthcheck never passes and `maestro-runner` (which
`depends_on: android-emulator: condition: service_healthy`) never starts.

### Documented cloud-mode auto-approval

Added a comment block above the `harmony-link` service explaining that
`CLOUD_MODE=true` enables auto-approval of new devices during handshake
(see `harmony-link-private/eventserver/synchronization.go:260`). This is
what makes unattended E2E pairing possible.

### Cross-container ADB gotcha (documented in `spike-results-6-3.md`)

`budtmo/docker-android` uses `socat` to forward ports 5554/5555 from the
container's hostname-resolved IP. This binds to whatever IP the container
has **at startup**. If you attach a network AFTER boot (e.g., via
`docker network connect`), ADB won't be reachable on the new network.

**The fix**: ensure the emulator container is on the `harmony-e2e` network
from creation (which is what `docker compose` does). Don't try to attach
networks after the fact when debugging.

### Still not validated end-to-end

The full `docker compose up` smoke run is **deferred to a later session**.
All prerequisites are in place (images pulled, KVM validated, APK buildable).
See `summary.md` → "Post-Plan Work" → "E2E stack run" for the handoff note.
