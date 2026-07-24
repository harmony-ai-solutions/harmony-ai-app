# Phase 6-3: Android Emulator Service

## Objective

Configure the `budtmo/docker-android` Android emulator service for use in the E2E Compose stack. This is the most operationally finicky service — emulator-in-Docker has well-documented gotchas around KVM acceleration, boot time, and WSL2 nested virtualization.

## Context

`budtmo/docker-android` is the de-facto image (15.6k stars, v3.5.2-p0 released June 2026). It supports Android 9 through 14 in the OSS version; 15+ requires the paid Pro tier. For RN 0.86 testing, Android 14 (API 34) is the recommended target — it's stable, recent enough to exercise modern RN features, and well-supported by `budtmo`.

The hard requirements:
- `/dev/kvm` must be available on the host
- Boot takes 1-5 minutes
- WSL2 on Windows 11 supports nested KVM but with reliability caveats

## Prerequisites

- Phase 6-1 drafted (the compose file references this service).
- Validated that the host (or CI runner) has `/dev/kvm`. On Linux: `ls -la /dev/kvm`. On macOS: this won't work. On Windows: see WSL2 section below.

## Implementation Steps

### 1. Pin the image version

```yaml
# In e2e/docker-compose.yml
android-emulator:
  image: budtmo/docker-android:emulator_14.0  # pin to a specific tag if reproducibility matters
```

Check the [budtmo releases page](https://github.com/budtmo/docker-android/releases) for the latest stable tag. Pin to a specific version (e.g., `emulator_14.0-v3.5.2`) rather than `latest` for reproducible CI.

### 2. Configure KVM access

The compose file already mounts `/dev/kvm`:

```yaml
privileged: true
devices:
  - /dev/kvm:/dev/kvm
```

`privileged: true` is required because the emulator needs broad device access. Some teams prefer `--device /dev/kvm` without `privileged`, but `budtmo` documents that `privileged` is the simplest reliable path.

### 3. Choose the device profile

```yaml
environment:
  EMULATOR_DEVICE: "Samsung Galaxy S10"
```

`budtmo` ships several pre-defined profiles (Samsung Galaxy S6/S7/S8/S9/S10, Nexus 4/5/7, Pixel C). Pick one that matches the team's most common test device, or use `Pixel` for a stock-Android feel.

For HarmonyAIChat specifically: if the team has any device-specific bug reports, choose that profile to maximize the chance of catching regressions.

### 4. Configure health check

`budtmo` writes a status file (`/home/androidusr/device_status`) when the emulator finishes booting. The compose file's healthcheck reads it:

```yaml
healthcheck:
  test: ["CMD", "bash", "-c", "[ -f /home/androidusr/device_status ] && grep -q 'device_status=online' /home/androidusr/device_status"]
  interval: 10s
  timeout: 5s
  retries: 30  # up to 5 minutes
  start_period: 30s
```

> **Verify the exact file path and content** by inspecting a running budtmo container:
> ```bash
> docker run -d --name emu-test --privileged --device /dev/kvm \
>   -e EMULATOR_DEVICE="Samsung Galaxy S10" \
>   budtmo/docker-android:emulator_14.0
> docker exec emu-test ls -la /home/androidusr/
> docker exec emu-test cat /home/androidusr/device_status 2>/dev/null
> ```

### 5. Disable unneeded features

```yaml
environment:
  EMULATOR_DEVICE: "Samsung Galaxy S10"
  WEB_VNC: "true"        # Enable for local debugging; disable in CI to save resources
  APPIUM: "false"        # Not using Appium — disable to speed up boot
  AUTO_RECORD: "false"   # Video recording can be enabled per-flow in Maestro
```

For CI, consider setting `WEB_VNC: "false"` to avoid the noVNC server overhead.

### 6. Persist emulator warm state (optimization)

The first boot of an emulator is slow because it builds the dalvik cache. Subsequent boots are faster if the cache persists. Use a named volume:

```yaml
volumes:
  - emulator-data:/home/androidusr
```

This persists `/home/androidusr` across container restarts. Note: in CI, this only helps if the runner is reused (e.g., self-hosted runner). GitHub-hosted runners are fresh each time, so no benefit there.

### 7. Plan the WSL2 path (Windows developers)

For Windows developers, the recommended approach is **emulator-on-host + Maestro-in-Docker**, not emulator-in-WSL2. Reasoning:

- Android Studio's emulator uses Windows-native Hyper-V acceleration (fast, reliable).
- Emulator-in-WSL2 requires nested virtualization (Windows 11 + `.wslconfig` tweak + KVM perms) and is widely reported to be slow or hang.

Setup steps for Windows developers (document in `e2e/README.md`):

```powershell
# 1. Boot the emulator from Android Studio on Windows (any AVD)
# 2. Find the emulator's ADB port — usually 5554 or 5556, exposed via TCP at 5555
adb -a -P 5037 nodaemon server  # if ADB server isn't running
adb devices                     # confirm emulator visible

# 3. Start only the harmony-link service in Docker
docker compose -f e2e/docker-compose.yml up -d harmony-link

# 4. Run Maestro against the host emulator
docker compose -f e2e/docker-compose.yml run --rm \
  -e ADB_TARGET=host.docker.internal:5555 \
  maestro-runner
```

The `maestro-runner` service needs to support an env-var-driven ADB target:

```yaml
# In docker-compose.yml, maestro-runner command:
command: >
  sh -c "
    ADB_TARGET=$${ADB_TARGET:-android-emulator:5555} &&
    adb connect $$ADB_TARGET &&
    adb wait-for-device &&
    adb install -r /app/app.apk &&
    maestro test /app/.maestro
  "
```

### 8. Document the alternative: cloud emulator service

For teams who don't want to manage emulator-in-Docker at all, alternatives exist (Phase 6-6 covers the iOS version; similar services exist for Android):

- **BrowserStack App Automate**: real Android devices, Appium-based (no Maestro CLI support)
- **Firebase Test Lab**: Android only, supports Espresso/UI Automator, not Maestro
- **Maestro Cloud**: Android + iOS, native Maestro support, ~$125/mo

If self-hosted Docker proves too painful, the team can pivot to Maestro Cloud for Android too (keeping the iOS cloud strategy consistent).

## Files to Modify

- `e2e/docker-compose.yml` — pin image version, refine healthcheck, add ADB_TARGET env var
- `e2e/README.md` — document WSL2/host-emulator alternative

## Validation

- [ ] `docker compose -f e2e/docker-compose.yml up android-emulator` succeeds
- [ ] Healthcheck passes (emulator fully booted) within 5 minutes on a Linux host
- [ ] `adb` inside the maestro-runner container can connect to `android-emulator:5555`
- [ ] `adb install` of a trivial test APK succeeds
- [ ] WSL2 host (if applicable) can run the emulator-on-host + Maestro-in-Docker pattern

## Open Questions to Resolve During Implementation

- **What's the exact path of `device_status` in v3.5.2?** Verify by running the image and inspecting.
- **Does `budtmo/docker-android:emulator_14.0` support Android 14's new edge-to-edge behavior?** RN 0.86 has edge-to-edge on by default — the emulator should reflect this.
- **How much RAM does the emulator need?** budtmo recommends 4GB minimum. Make sure the Docker Desktop (or CI runner) has enough memory allocated.

## Spike Item (Critical — autonomous validation at start of Phase 6)

Before committing to the Docker approach, validate it on the actual host(s) the team will use. **This is done autonomously by the implementing agent at the start of Phase 6 execution** — see the "Validation Task" section above for the full procedure.

## Estimated Effort

Half a day to configure. Plus the validation task below.

## Validation Task (autonomous — execute at start of Phase 6)

The implementing agent does this autonomously at the start of Phase 6 execution, **before** committing to the full Docker Compose stack. The overseeing human developer is available to assist with environment issues (BIOS settings, Docker Desktop config, WSL2 setup) but doesn't drive the validation.

**Goal**: confirm the Android emulator boots reliably inside Docker on the actual host(s) the team will use, and measure boot time. This determines whether the Docker approach is viable or whether the fallback (emulator-on-host + Maestro-in-Docker via `adb connect`) is needed.

**Steps the agent executes**:

1. **On a Linux machine or `ubuntu-latest` GitHub Actions runner** (primary CI target):
   ```bash
   docker run --rm --privileged --device /dev/kvm \
     -e EMULATOR_DEVICE="Samsung Galaxy S10" \
     -p 6080:6080 \
     budtmo/docker-android:emulator_14.0
   ```
   - Wait up to 5 minutes for boot
   - Open `http://localhost:6080` in a browser (or curl the status file via `docker exec`)
   - Document boot time

2. **On a Windows 11 dev machine with WSL2** (developer experience target):
   - Configure `.wslconfig` with `nestedVirtualization=true`
   - Configure `/etc/wsl.conf` with the KVM permission boot command
   - Restart WSL
   - Run the same `docker run` command from inside WSL2
   - Document boot time and any reliability issues

3. **If WSL2 nested KVM is unreliable** (the most likely outcome based on community reports):
   - Validate the fallback path: emulator-on-Windows-host (via Android Studio) + Docker Maestro container connecting via `adb connect host.docker.internal:5555`
   - Document the working setup as the canonical Windows approach in `e2e/README.md`

4. **Spike artifact**: write a short summary in `.current_work/test-framework-overhaul/spike-results-6-3.md` documenting:
   - Which path worked on Linux CI
   - Which path worked on Windows dev (or didn't)
   - Measured boot times
   - Recommended canonical approach per platform

**Success criteria**: at least one of the two paths (Linux CI, Windows dev) produces a bootable emulator within 5 minutes. If both fail, escalate to the human developer before proceeding with Phase 6 — the entire E2E strategy depends on this.

**When to ask the human for help**:
- BIOS virtualization settings (VT-x/AMD-V not enabled)
- Docker Desktop resource allocation (needs ≥4GB RAM for emulator)
- WSL2 kernel version issues (`wsl --update`)
- Corporate firewall blocking `budtmo/docker-android` image pull
