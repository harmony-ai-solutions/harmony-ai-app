# Research Report 5: Docker-based Maestro E2E for React Native

**Date:** July 20, 2026
**Researcher:** code-expert subagent (session `ses_07ef769d8ffeP6P6flCYnJm14`)
**Project context:** HarmonyAIChat team's existing pattern (from neighboring Soulbits Cloud Backend repo) is to run E2E tests entirely in Docker containers, spawning backend services as Compose services. Question: can the same pattern work for Maestro E2E of the RN app, including spawning a real Harmony Link Go backend?

---

## 1. Executive Summary

**Yes, the Docker-based approach works for Maestro E2E tests of the React Native Android app — with one major caveat: it solves Android only.**

The proven pattern: run a `budtmo/docker-android` container with KVM acceleration as a Docker Compose service, install the pre-built APK via ADB, and have the Maestro CLI drive the emulator. The Harmony Link Go backend becomes another Compose service. For iOS, **Docker cannot be used** — Apple's EULA and the iOS Simulator's architecture require macOS. The pragmatic recommendation is a split strategy: **Docker Compose for Android E2E + macOS GitHub Actions runner for iOS E2E**.

**The Docker approach does meaningfully solve the "spawn a real Harmony Link instance" problem** — having the Go backend as a Compose service is significantly cleaner than managing process lifecycle on the host. The Windows developer experience for local Android testing is workable via WSL2 + nested KVM but has reliability caveats.

## 2. Maestro in Docker Today (Mid-2026)

### 2.1 Official Maestro Docker Image — Does Not Exist

**mobile.dev does NOT ship an official Docker image.** Distributed as a single binary:
```bash
curl -Ls "https://get.maestro.mobile.dev" | bash
```

No official images on Docker Hub under `mobiledev`, `mobile-dev-inc`, or `maestro`. The "maestro" images on Docker Hub are unrelated projects (Farfetch scheduler, etc.).

**Verdict:** You install Maestro CLI in your test runner container with the curl command. Prerequisites: Linux amd64, OpenJDK 11+, ADB.

### 2.2 Typical Dockerfile

```dockerfile
FROM ubuntu:22.04
RUN apt-get update && apt-get install -y openjdk-17-jdk android-tools-adb curl && rm -rf /var/lib/apt/lists/*
RUN curl -Ls "https://get.maestro.mobile.dev" | bash
ENV PATH="$PATH:/root/.maestro/bin"
COPY .maestro /app/.maestro
WORKDIR /app
```

### 2.3 Communication Pattern

```
[Maestro Container] --adb connect emulator:5555--> [Emulator Container]
```

The emulator container exposes ADB on port 5555. Maestro's `adb connect` links them.

## 3. Android Emulator in Docker

### 3.1 The Two Main Image Options

#### Option A: `budtmo/docker-android` (Recommended)

| Metric | Value |
|---|---|
| Stars | **15.6k** |
| Latest release | **v3.5.2-p0** (June 24, 2026) |
| Android versions | 9.0 (API 28) through 14.0 (API 34) |
| Pro version | Adds Android 15/16, headless mode, root, proxy |
| Extras | noVNC web viewer, video recording, log sharing |

**De facto standard.** Proven blog post (Carlos Jiménez, Apr 2025) demonstrates it with Maestro and GitHub Actions.

#### Option B: `google/android-emulator-container-scripts`

Google's official. Less polished, more DIY.

### 3.2 KVM / Hardware Acceleration — The Critical Requirement

```bash
docker run -d \
  --device /dev/kvm \
  --privileged \
  -p 5555:5555 \
  -e EMULATOR_DEVICE="Samsung Galaxy S10" \
  -e WEB_VNC=true \
  budtmo/docker-android:emulator_14.0
```

**Where KVM is available:**
- **Linux hosts**: Yes, directly.
- **GitHub Actions `ubuntu-latest`**: Yes — nested KVM enabled.
- **macOS**: No. Docker on macOS uses HyperKit.
- **Windows (WSL2)**: Yes, but with caveats.

### 3.3 WSL2 Specifics — The Windows Developer Experience

**Short answer:** Works, but fragile and Windows 11 only.

Setup:
1. **Windows 11 required** — Windows 10 doesn't support `nestedVirtualization=true`.
2. Enable nested virtualization in `%USERPROFILE%\.wslconfig`:
   ```
   [wsl2]
   nestedVirtualization=true
   ```
3. Fix KVM permissions in `/etc/wsl.conf`:
   ```
   [boot]
   command = /bin/bash -c 'chown -v root:kvm /dev/kvm && chmod 660 /dev/kvm'
   ```
4. Add user to kvm group: `sudo usermod -aG kvm ${USER}`
5. Restart WSL: `wsl --shutdown`

**Known issues:**
- Boot hangs or extreme slowness
- ADB connectivity problems (NAT'd networking)
- Resource contention with Hyper-V emulator
- Composability issues with `socat` + `adb` forwarding

**Recommended alternative for Windows local dev:** Run Android emulator **on the Windows host directly**, then have Maestro container connect via `adb connect host.docker.internal:5555`.

| Approach | Reliability | Speed | Setup |
|---|---|---|---|
| Emulator in Docker via WSL2 + nested KVM | Medium | Slow | High |
| Emulator on Windows host + Docker Maestro | High | Fast (native Hyper-V) | Medium |
| Emulator in Docker on Linux CI | High | Fast | Low |

### 3.4 Alternative: Emulator on Host + Maestro in Docker via ADB over Network

```
[Windows Host]
  ├── Android Emulator (Hyper-V accelerated)
  │     └── ADB server on port 5037
  └── Docker
        └── Maestro Container
              └── adb connect host.docker.internal:5555
```

**Documented and recommended** by Microsoft's own WSL team.

### 3.5 Cloud Alternatives

| Service | Android | iOS | Cost | Notes |
|---|---|---|---|---|
| Maestro Cloud | ✓ | ✓ | $125/mo | Official |
| TestingBot | ✓ | ✓ | ~$50/mo | Drop-in CLI replacement |
| BrowserStack App Automate | ✓ | ✓ | ~$150/mo | Appium only |
| Firebase Test Lab | ✓ | ✗ | Pay-per-use | Android-only |

## 4. iOS Reality Check

### 4.1 The Hard Truth

**iOS Simulator absolutely cannot run inside Docker on non-Apple hardware.** Two insurmountable barriers:

1. **Apple EULA**: iOS Simulator licensed only for Apple hardware.
2. **Technical**: iOS Simulator depends on Darwin kernel, Metal/OpenGL, SpringBoard, CoreSimulator.

**Docker does not help with iOS. Period.**

### 4.2 Options for iOS E2E Coverage

| Option | Pros | Cons | Cost |
|---|---|---|---|
| macOS GitHub Actions runner | Native Simulator | Cost ($0.08/min), queue times | ~$8-30/mo per dev |
| Self-hosted macOS runner | Full control, fast | Need Mac hardware | Hardware + maintenance |
| Maestro Cloud | Handles everything | Vendor lock-in | $125/mo |
| TestingBot | Cheaper, real devices | Another service | ~$50/mo |
| Skip iOS E2E, use RNTL | Free | Doesn't test device | $0 |
| Maestro on local Mac | Free | Only on dev machines | $0 |

## 5. Proposed `docker-compose.yml` Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Docker Network: harmony-e2e             │
│                                                          │
│  ┌──────────────────┐    ┌──────────────────────────┐   │
│  │  harmony-link     │    │  android-emulator        │   │
│  │  (Go backend)     │    │  (budtmo/docker-android) │   │
│  │                   │    │                          │   │
│  │  WSS :9443        │    │  ADB :5555              │   │
│  │  Self-signed TLS  │    │  noVNC :6080            │   │
│  └────────┬─────────┘    └──────────┬───────────────┘   │
│           │                         │                    │
│  ┌────────┴─────────────────────────┴───────────────┐   │
│  │              maestro-runner                      │   │
│  │  (ubuntu:22.04 + Maestro CLI + ADB)              │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

(Full docker-compose.yml sketch in original report — see implementation plan Phase 6-1.)

### Network topology
- Harmony Link reachable at `wss://harmony-link:9443` from within Docker network.
- App configured via `react-native-launch-arguments` or build-time env var injection.

### Self-signed TLS handling
1. Go backend generates CA + server cert on startup.
2. CA copied into emulator as system trusted CA, OR
3. App's `network_security_config.xml` debug-overrides trust user CAs.

## 6. APK Build Strategy

### Recommended: Build in CI, Mount into Docker Compose

```
[Build Job]                    [Test Job]
gradlew assembleDebug   →      docker compose up
  └── app-debug.apk            └── Mounts APK as volume
```

Why? Separation of concerns (build vs test failures), Gradle cache preservation, parallelism, artifact reusability.

## 7. CI Strategy (GitHub Actions)

```yaml
jobs:
  build-android:
    runs-on: ubuntu-latest
    steps:
      - run: cd android && ./gradlew assembleDebug
      - uses: actions/upload-artifact@v4
        with: { name: app-debug-apk, path: android/app/build/outputs/apk/debug/app-debug.apk }

  e2e-android:
    needs: build-android
    runs-on: ubuntu-latest  # KVM-enabled
    steps:
      - uses: actions/download-artifact@v4
        with: { name: app-debug-apk, path: . }
      - run: docker compose -f e2e/docker-compose.yml up -d harmony-link android-emulator
      - run: ./scripts/wait-for-emulator.sh
      - run: docker compose -f e2e/docker-compose.yml up maestro-runner
```

**Key points:**
- Ubuntu runners have KVM
- macOS runners for iOS
- APK passed as artifact
- Timeout on Maestro step
- `if: always()` for log collection

## 8. Comparison: 4 Options

| Criteria | Self-hosted Docker (Linux CI) | Self-hosted Docker (WSL2 local) | Maestro Cloud | TestingBot |
|---|---|---|---|---|
| Android support | ✅ Excellent | ⚠️ Fragile | ✅ Excellent | ✅ Excellent |
| iOS support | ❌ Not possible | ❌ Not possible | ✅ | ✅ |
| Harmony Link integration | ✅ Compose service | ✅ Compose service | ⚠️ Need tunnel | ✅ Secure tunnel |
| Local reproducibility | ✅ On Linux | ⚠️ Different from CI | ❌ Cloud-only | ❌ Cloud-only |
| Cost (CI) | $0.008/min | $0 | $125/mo | ~$50/mo |
| Maintenance burden | Medium | High | Low | Low |

## 9. Final Recommendation

### Phase 1 (Weeks 1-2) — Android E2E with Docker Compose

Directly mirrors the Soulbits Cloud Backend pattern. Harmony Link Go backend as Compose service. Reproducible local Android E2E on Windows (via emulator-on-host + Docker Maestro, or WSL2 + nested KVM). Same Compose stack in CI on `ubuntu-latest`.

### Phase 2 (Weeks 3-4) — iOS via cloud service OR macOS runner

TestingBot (~$50/mo) or macOS GitHub Actions runner.

### Phase 3 (Optional) — macOS runner for nightly regression

For fuller iOS coverage.

### What Docker Does and Doesn't Solve

| Previously (plain Maestro) | Now (Docker Compose) | Delta |
|---|---|---|
| Android E2E: setup per dev, fragile CI | Android E2E: reproducible via Compose | ✅ Big improvement |
| Harmony Link: run as host process | Harmony Link: managed Compose service | ✅ Meaningful improvement |
| iOS E2E: requires macOS | iOS E2E: still requires macOS | ❌ Unchanged |
| Windows dev experience: works with some setup | Same or slightly better | ⚠️ Marginal improvement |

## 10. Open Risks / Things to Validate with a Spike

### Spike 1 (Critical): WSL2 + KVM + budtmo/docker-android
Validate Windows 11 + WSL2 can reliably boot Android emulator with KVM. Success: boots in <120 seconds. Backup: emulator on host + `adb connect host.docker.internal:5555`.

### Spike 2 (Critical): Self-Signed TLS with React Native WebSocket
Validate app can connect to self-signed WSS server from Android. Build minimal Go WSS server, debug APK with `network_security_config.xml`. Backup: cleartext WS inside Docker network.

### Spike 3 (High): Docker Compose for Go Backend + Maestro
Validate multi-service stack works end-to-end with simple test APK. Success: `docker compose up --abort-on-container-exit` produces passing test.

### Spike 4 (Medium): TestingBot / Maestro Cloud for iOS
Validate iOS build can be tested via cloud service.

## 11. Sources

| URL | Summary |
|---|---|
| github.com/mobile-dev-inc/Maestro | 15.6k stars, active, no official Docker image |
| github.com/budtmo/docker-android | Android emulator in Docker — 15.6k stars, v3.5.2-p0 (Jun 2026) |
| github.com/budtmo/docker-android/releases | 112 releases, latest Jun 24, 2026 |
| medium.com/@carlosjimz87/...maestro | Proves `budtmo/docker-android` + Maestro + GitHub Actions pattern (Apr 2025) |
| brightcoding.dev/2026/04/24/...docker-android | Comprehensive guide including WSL2 setup (Apr 2026) |
| github.com/google/android-emulator-container-scripts | Google's official container scripts |
| forums.docker.com/t/...kvm-nested-virtualization | Confirms KVM nested virt problems |
| github.com/microsoft/WSL/discussions/6625 | Microsoft WSL team — Android emulator via WSL2 guidance |
| typescript.tv/hands-on/...android-emulator | Recommends host emulator + ADB connect |
| github.com/retyui/Using-GitHub-Actions-to-run-your-Maestro-Flows | Maestro on GitHub Actions examples |
| medium.com/@retyui/...maestro-flows-on-ci | Confirms macOS required for iOS |
| addjam.com/blog/2026-02-18/...maestro | Feb 2026 RN team experience with Maestro |
| maestro.dev/pricing | Maestro Cloud — free CLI, $125/mo Cloud |
| testingbot.com/features/automation/maestro | Drop-in replacement, ~$50/mo |
| reddit.com/r/expo/...maestro-pricing | Confirms TestingBot as cheaper alternative |
| github.com/marketplace/actions/maestro-test-action | Supports macOS and Linux hosts only |
| github.com/facebook/react-native/issues/18920 | WebSocket self-signed TLS on Android (OkHttp) |
| github.com/facebook/react-native/issues/30341 | WebSocket certificates, `rejectUnauthorized: false` not supported |
| stackoverflow.com/.../self-signed | Android network_security_config.xml |
| developer.android.com/privacy-and-security/security-config | Network security configuration |
| farfetch.github.io/maestro/docs/docker_images | NOT mobile testing, Kubernetes scheduler |
| docs.maestro.dev/maestro-cloud/...platform-guides | macOS runners for iOS |
| github.com/lingvano/react-native-eas-maestro | Reference repo — Expo EAS + Maestro Cloud |
| github.com/iamolegga/react-native-launch-arguments | Library for passing launch args |
