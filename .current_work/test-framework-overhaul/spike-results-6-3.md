# Spike Results 6-3 — Android Emulator KVM Validation

## Status: ✅ VALIDATED (July 2026)

Re-validated empirically on the development host after the original "DEFERRED"
status turned out to be based on assumption, not evidence.

## Environment

| Component | Value |
|-----------|-------|
| Host OS | Windows 11 |
| Docker backend | Docker Desktop (WSL2 backend) |
| WSL2 kernel | `6.6.87.2-microsoft-standard-WSL2` |
| WSL2 distros | Ubuntu-24.04 (default), docker-desktop |
| Nested KVM | **Working** — `/dev/kvm` exposed inside containers |
| budtmo image | `budtmo/docker-android:emulator_14.0` (pulled fresh) |

## What Worked

### 1. KVM acceleration

`docker run --rm --privileged --device /dev/kvm ubuntu:22.04 ls -la /dev/kvm`
returns a valid character device. No `.wslconfig` or `/etc/wsl.conf` changes
were needed — the host already had nested virtualization enabled.

### 2. Cold boot time

Measured on the dev host (Windows 11 + WSL2 + Docker Desktop):

| Attempt | Boot time | Notes |
|---------|-----------|-------|
| 1 (cold pull, default bridge) | ~40s | Status went `BOOTING` → `READY` |
| 2 (warm, user-defined network) | 52s | Includes 30s `start_period` overhead |

Well under the 5-minute target. Hardware acceleration is active — software
emulation would take 5-15 minutes.

### 3. Cross-container ADB connectivity

This was the trickiest piece. budtmo's startup script
(`/home/androidusr/docker-android/cli/src/app.py` line 102) does:

```python
local_ip = socket.gethostbyname(socket.gethostname())
# → socat tcp-listen:5555,bind={local_ip},fork tcp:127.0.0.1:5555
```

**Critical implication:** socat binds to whatever IP the container has **at
startup**. If you attach a network AFTER boot, the alias resolves to a
different IP and `adb connect` fails with "Connection refused".

**The fix:** Ensure the emulator is on the user-defined `harmony-e2e` network
from container creation (which is what `docker compose` does). Don't try to
attach networks after the fact.

Verified working:
```
adb connect android-emulator:5555
# connected to android-emulator:5555
adb devices
# android-emulator:5555    device
adb -s android-emulator:5555 shell getprop ro.build.version.release
# 14
adb -s android-emulator:5555 shell pm list packages | wc -l
# 223
```

### 4. noVNC web UI

`http://localhost:6080` returns HTTP 200. Useful for debugging Maestro
flows visually.

## Bugs Found and Fixed

### `docker-compose.yml` healthcheck was wrong

The old healthcheck grepped for `device_status=online` or `booted`, but the
actual status string written by `budtmo/docker-android:emulator_14.0` is
just `READY`. The healthcheck would never pass.

**Fixed:** `e2e/docker-compose.yml` now greps for `READY` (documented with
the empirical evidence).

## Gotchas Documented for CI

1. **`/dev/kvm` is required.** GitHub Actions `ubuntu-latest` runners expose
   it natively. Other CI hosts must verify with `ls -la /dev/kvm` before
   attempting to boot.

2. **`privileged: true` is required.** budtmo documents this as the simplest
   reliable path. Alternative: `--device /dev/kvm` without `privileged`, but
   some emulator features may not work.

3. **The `EMULATOR_DEVICE` env var has limited effect.** Set to
   `"Samsung Galaxy S10"` but the actual model reported was
   `sdk_gphone64_x86_64` (default Pixel-like profile). budtmo OSS version
   may not honor the profile override for all properties. Maestro selectors
   should target resource IDs, not device-specific UI.

4. **Image size:** `budtmo/docker-android:emulator_14.0` is ~2 GB. CI caches
   should persist it across runs to avoid re-pulling.

5. **Memory:** The emulator process consumed ~6 GB RSS during the test.
   Docker Desktop should be allocated at least 8 GB; GitHub Actions runners
   have 7 GB by default which may be tight.

## Recommended Path Forward

1. **Canonical approach:** Docker Compose stack as written in
   `e2e/docker-compose.yml` (now with corrected healthcheck + correct
   `soulbits/harmony-link:latest` image reference).

2. **CI:** Use `ubuntu-latest` GitHub Actions runner — has KVM, has enough
   RAM, has Docker.

3. **Local dev (Windows + WSL2):** Works as-is. No special config needed
   beyond having Docker Desktop installed with WSL2 backend.

4. **Local dev (macOS):** Untested. Likely requires Docker Desktop's VFS
   (no KVM on macOS) which is too slow for the emulator. Use the
   emulator-on-host fallback documented in `e2e/README.md`.

## Next Steps

Now that the emulator boots and is reachable:
- [ ] Build `e2e/app-debug.apk` via `cd android && ./gradlew assembleDevDebug`
- [ ] Build the `Dockerfile.maestro` image
- [ ] Run the full compose stack end-to-end
- [ ] Validate the 6 Maestro YAML flows against a real boot
