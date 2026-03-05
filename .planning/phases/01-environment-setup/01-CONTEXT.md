# Phase 1 Context: Dynamic Appium Testing & React Native Build Strategy

**Date:** 2026-03-05
**Purpose:** Document research findings for Phase 1 planning decisions
**Note:** This project uses bare React Native (CLI), NOT Expo

---

## Research Findings

### 1. Appium MCP in Docker - Viability Assessment

**Question:** Is running Appium MCP in Docker straightforward for interacting with host emulators and cloud providers?

**Finding: NOT straightforward for host emulators**

| Scenario | Docker Viability | Notes |
|----------|------------------|-------|
| **Docker with bundled emulator** | ✅ Works | Images like `butomo1989/docker-android-x86-7.1.1` or `dasxran/appium-emulator` run Appium + emulator in same container |
| **Docker connecting to host emulator** | ⚠️ Complex | Requires `--privileged`, ADB port forwarding (5554/5555), and `adb connect host.docker.internal` - known to have reliability issues |
| **Docker connecting to cloud providers** | ✅ Works | Appium in Docker can connect to BrowserStack/Sauce Labs the same as local installation |

**Key Issues with Host Emulator Connectivity:**
- Docker container cannot directly access host emulators without special network configuration
- `adb connect host.docker.internal` (Linux) or `host.docker.internal` (Windows/Mac) is the standard approach but is unreliable
- Port forwarding required: `-p 5554:5554 -p 5555:5555`
- `--privileged` flag needed for USB device access
- Multiple Stack Overflow and forum posts confirm this is a known pain point

**Recommendation:** For Phase 1, use the following strategy:
- **Windows/Linux hosts:** Run Appium MCP locally (not in Docker) for Android emulator access, use cloud for iOS
- **macOS hosts:** Run Appium MCP locally for iOS simulator, use cloud for Android
- **Cloud providers:** Either local or Docker Appium can connect to BrowserStack/Sauce Labs

---

### 2. Dynamic React Native (CLI) Build Strategy

**Question:** How to dynamically structure React Native builds/tests based on host OS for local vs cloud execution?

**Finding:** Bare React Native requires different approach than Expo. Local builds are platform-limited; cloud builds require CI/CD infrastructure.

| Approach | Description | Status |
|----------|-------------|--------|
| **React Native CLI + Fastlane** | Local builds with Fastlane for automation | ✅ Supported |
| **GitHub Actions + Fastlane** | CI/CD with matrix strategy for OS detection | ✅ Common pattern |
| **Codemagic** | Cloud CI/CD specialized for React Native | ✅ Supports bare RN |
| **Bitrise** | Cloud CI/CD for mobile apps | ✅ Supports bare RN |
| **AppCenter (Microsoft)** | Cloud build and test service | ⚠️ Being deprecated |

**OS Detection for Build Routing (React Native CLI):**

```javascript
// Example: Detect host OS and route accordingly
const os = require('os');
const platform = os.platform(); // 'win32', 'darwin', 'linux'

const buildConfig = {
  'win32': { local: 'android', cloud: 'all' },
  'linux': { local: 'android', cloud: 'all' },
  'darwin': { local: 'both', cloud: 'all' }
}[platform];
```

**React Native CLI Build Commands by OS:**
- **Windows (local):** `./android/gradlew assembleDebug` (Android only)
- **Linux (local):** `./android/gradlew assembleDebug` (Android only)
- **macOS (local):** `xcodebuild` for iOS + `./android/gradlew` for Android
- **Any OS (cloud):** Use Fastlane or CI/CD service

**Bare React Native Cloud Build Options:**
1. **GitHub Actions + Fastlane:** Most flexible, requires manual setup
2. **Codemagic:** Native support for React Native, easy setup
3. **Bitrise:** Strong mobile CI/CD, good React Native support

---

## Decisions for Phase 1

### Appium Testing Routing

| Host OS | Local Testing | Cloud Testing |
|---------|---------------|---------------|
| Windows | Android emulator | iOS (BrowserStack/Sauce Labs) |
| Linux | Android emulator | iOS (BrowserStack/Sauce Labs) |
| macOS | iOS simulator | Android (BrowserStack/Sauce Labs) |

**Implementation:**
- Use OS detection in test scripts to determine local vs cloud execution
- For Docker: Only use when connecting to cloud providers (not host emulators)
- Cloud providers: BrowserStack App Automate or Sauce Labs (both support Appium)

### React Native CLI Build Routing

| Host OS | Local Build | Cloud Build |
|---------|-------------|-------------|
| Windows | Android only (gradlew) | Codemagic/Bitrise for iOS |
| Linux | Android only (gradlew) | Codemagic/Bitrise for iOS |
| macOS | Android + iOS (xcodebuild + gradlew) | Codemagic/Bitrise for consistency |

**Implementation:**
- Use `os.platform()` detection in build scripts
- Windows/Linux: Local Android build + cloud iOS build
- macOS: Local builds for both platforms
- Cloud fallback: Codemagic or Bitrise for consistent cross-platform builds

---

## Claude's Discretion

The following can be decided during implementation:

1. **Cloud CI/CD provider:** Choose between Codemagic vs Bitrise vs GitHub Actions + Fastlane
2. **Docker usage:** Whether to containerize Appium MCP for cloud-only scenarios
3. **Build script location:** Whether to create a dedicated `scripts/build.ts` or use package.json scripts

---

## Deferred Ideas (Out of Scope for Phase 1)

- Custom remote macOS build infrastructure (Tart VMs)
- Self-hosted Selenium Grid for Appium
- Parallel local + cloud test execution
