# Phase 1: Environment Setup - Appium MCP Integration - Research

**Researched:** 2026-03-05
**Domain:** Mobile Testing Automation (Appium MCP)
**Confidence:** HIGH

## Summary

This research documents the installation, configuration, and verification steps for integrating Appium MCP (Model Context Protocol) into the Harmony AI Chat project for end-to-end mobile testing. Appium MCP enables AI agents like Claude to control Android and iOS devices for automated testing through natural language commands.

**Primary recommendation:** Install Appium MCP via npm using `npx -y appium-mcp@latest`, configure ANDROID_HOME and JAVA_HOME environment variables, and verify installation by testing basic device connectivity.

---

## User Constraints (from CONTEXT.md)

### Locked Decisions

| Decision | Details |
|----------|---------|
| **Appium Testing Routing** | Windows/Linux: Android emulator locally, iOS via MacinCloud |
| **React Native Build** | Windows/Linux: Android only locally, cloud for iOS; macOS: both locally |
| **Docker Strategy** | NOT NEEDED for local testing - Appium runs locally and connects directly to host emulators |

### Claude's Discretion

1. Cloud CI/CD provider choice (Codemagic vs Bitrise vs GitHub Actions + Fastlane)
2. Docker usage for cloud-only scenarios
3. Build script location

### Deferred Ideas (Out of Scope)

- Custom remote macOS build infrastructure (Tart VMs)
- Self-hosted Selenium Grid for Appium
- Parallel local + cloud test execution

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| [appium-mcp](https://www.npmjs.com/package/appium-mcp) | latest (npm) | MCP server for Appium automation | Official MCP implementation for mobile testing |
| [appium](https://github.com/appium/appium) | 2.x | Core Appium server | Industry standard for mobile automation |
| [@appium/support](https://www.npmjs.com/package/@appium/support) | latest | Appium utilities | Required for MCP server functionality |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| [webdriverio](https://webdriver.io/) | 8.x | WebDriver client | Optional - for custom test scripts |
| [appium-inspector](https://github.com/appium/appium-inspector) | latest | UI element inspection | Debugging element selectors |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| appium-mcp | @appium/test-support (direct Appium) | MCP provides natural language interface; direct Appium requires more code |
| npm installation | Docker container | Docker complex for host emulator access; npm simpler for local testing |
| **LambdaTest / TestMu AI** | **MacinCloud** | **Dropped:** Test-Only CI solutions lack the ability to build as part of the testing CI. **MacinCloud** (baremetal) provides full control. |

---

## Architecture Patterns

### Recommended Project Structure

```
e2e/
├── appium/
│   ├── config/
│   │   └── capabilities.ts      # Device capabilities configuration
│   ├── tests/
│   │   ├── android/
│   │   │   └── *.test.ts        # Android-specific tests
│   │   └── ios/
│   │       └── *.test.ts        # iOS-specific tests
│   └── scripts/
│       ├── start-server.ts      # Appium server startup
│       └── verify-setup.ts      # Setup verification
├── .env.example                 # Environment template
└── README.md                    # Test documentation
```

### Pattern 1: Appium MCP Installation

**What:** Install Appium MCP as an npm package and configure as MCP server

**When to use:** Initial setup phase for mobile testing infrastructure

**Installation (npm):**
```bash
# Install globally via npx (recommended for MCP)
npx -y appium-mcp@latest

# Or install as project dependency
npm install --save-dev appium-mcp
```

**Configuration for Claude Code:**
```bash
claude mcp add appium-mcp -- npx -y appium-mcp@latest
```

**Source:** [GitHub - appium/appium-mcp](https://github.com/appium/appium-mcp)

### Pattern 2: Environment Variable Configuration

**What:** Set required environment variables for Android and iOS development

**When to use:** Before running any Appium tests

**Windows (PowerShell - persistent):**
```powershell
# System Properties → Environment Variables → User variables
# Add new:
ANDROID_HOME=C:\Users\[username]\AppData\Local\Android\Sdk
JAVA_HOME=C:\Program Files\Java\jdk-17

# Update PATH to include:
# %ANDROID_HOME%\platform-tools
# %ANDROID_HOME%\tools
# %ANDROID_HOME%\tools\bin
```

**Windows (PowerShell - session only):**
```powershell
$env:ANDROID_HOME = "C:\Users\$env:USERNAME\AppData\Local\Android\Sdk"
$env:JAVA_HOME = "C:\Program Files\Java\jdk-17"
```

**macOS/Linux (.bashrc or .zshrc):**
```bash
export ANDROID_HOME=/Users/username/Library/Android/sdk
export JAVA_HOME=/Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home
export PATH=$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/tools:$ANDROID_HOME/tools/bin
```

**Source:** [npm - appium-mcp](https://www.npmjs.com/package/appium-mcp)

### Pattern 3: Device Capabilities Configuration

**What:** Define device capabilities for test execution

**When to use:** When starting a test session

**Android Emulator Example:**
```typescript
const androidCapabilities = {
  platformName: 'Android',
  deviceName: 'Android Emulator',
  automationName: 'UiAutomator2',
  app: './android/app/build/outputs/apk/debug/app-debug.apk',
  appPackage: 'ai.projectharmony.chat',
  appActivity: '.MainActivity',
  noReset: true,
};
```

**iOS Simulator Example:**
```typescript
const iosCapabilities = {
  platformName: 'iOS',
  deviceName: 'iPhone 15',
  automationName: 'XCUITest',
  app: './ios/build/HarmonyAIChat.app',
  bundleId: 'ai.projectharmony.chat',
  noReset: true,
};
```

**Source:** [MCP Marketplace - Appium MCP](https://ubos.tech/mcp/mcp-appium-server/)

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Mobile automation protocol | Custom WebDriver implementation | Appium MCP | Appium is industry standard; MCP adds natural language interface |
| Element selection | Hardcoded XPath | Appium Inspector | Inspector provides accurate element selectors |
| Device management | Custom adb scripts | Appium's built-in device handling | Handles connection, lifecycle, and cleanup |

**Key insight:** Appium MCP abstracts complex device interaction details, allowing tests to be written in natural language while maintaining the reliability of the underlying WebDriver protocol.

---

## Common Pitfalls

### Pitfall 1: Environment Variables Not Accessible

**What goes wrong:** Appium MCP fails to find ANDROID_HOME or JAVA_HOME, resulting in "Device not found" errors

**Why it happens:** Environment variables set in `.bashrc`/`.zshrc` are not loaded in GUI applications or new terminal sessions without sourcing

**How to avoid:**
1. Set variables in System Properties (Windows) or launchd.conf (macOS)
2. Always source environment file before running: `source ~/.bash_profile`
3. Verify with `echo $ANDROID_HOME` before running tests

**Warning signs:**
- `ANDROID_HOME is not set` error
- `Device not found` despite emulator running
- `java: command not found` error

### Pitfall 2: Emulator Not Detected

**What goes wrong:** Appium cannot connect to Android emulator

**Why it happens:** Emulator not started, ADB not recognizing emulator, or port mismatch

**How to avoid:**
1. Start emulator before running tests: `emulator -avd <avd_name>`
2. Verify emulator is visible: `adb devices`
3. If not detected, restart ADB server: `adb kill-server && adb start-server`

**Warning signs:**
- Empty `adb devices` output
- `Could not find a connected Android device` error

### Pitfall 3: iOS Simulator Not Available

**What goes wrong:** Appium cannot find iOS simulator

**Why it happens:** Xcode simulators not created, wrong simulator name in capabilities

**How to avoid:**
1. List available simulators: `xcrun simctl list devices available`
2. Use exact device name from list in capabilities
3. Boot simulator before testing: `xcrun simctl boot "iPhone 15"`

**Warning signs:**
- `Could not find iOS simulator` error
- Invalid device name in capabilities

---

## Code Examples

### Verification Script: Check Environment Setup

```typescript
// e2e/appium/scripts/verify-setup.ts
import { execSync } from 'child_process';
import * as path from 'path';

interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
}

function checkEnvironmentVariable(name: string): CheckResult {
  const value = process.env[name];
  return {
    name,
    passed: !!value,
    message: value ? `${name}=${value}` : `${name} not set`,
  };
}

function checkCommand(command: string): CheckResult {
  try {
    execSync(command, { stdl: 'ignore' });
    return { name: command, passed: true, message: 'Command available' };
  } catch {
    return { name: command, passed: false, message: 'Command not found' };
  }
}

function checkAndroidDevices(): CheckResult {
  try {
    const output = execSync('adb devices', { encoding: 'utf-8' });
    const devices = output.split('\n').filter(line => line.includes('device'));
    return {
      name: 'Android Devices',
      passed: devices.length > 0,
      message: `Found ${devices.length} device(s)`,
    };
  } catch {
    return { name: 'Android Devices', passed: false, message: 'ADB not available' };
  }
}

export function verifySetup(): CheckResult[] {
  const checks: CheckResult[] = [
    checkEnvironmentVariable('ANDROID_HOME'),
    checkEnvironmentVariable('JAVA_HOME'),
    checkCommand('node --version'),
    checkCommand('npm --version'),
    checkCommand('appium --version'),
  ];

  // Platform-specific checks
  if (process.platform === 'win32' || process.platform === 'linux') {
    checks.push(checkAndroidDevices());
  } else if (process.platform === 'darwin') {
    checks.push(checkCommand('xcrun simctl list devices available'));
  }

  return checks;
}

// Run verification
const results = verifySetup();
console.log('\n=== Environment Setup Verification ===\n');
results.forEach(result => {
  const status = result.passed ? '✓' : '✗';
  console.log(`${status} ${result.name}: ${result.message}`);
});
const allPassed = results.every(r => r.passed);
console.log(`\n${allPassed ? 'Setup OK!' : 'Setup incomplete - fix errors above'}\n`);
process.exit(allPassed ? 0 : 1);
```

**Source:** Based on [Appium MCP GitHub](https://github.com/appium/appium-mcp) verification patterns

### Starting Appium Server

```bash
# Start Appium server on default port (4723)
appium

# Start on custom port
appium -p 4724

# Start with specific host
appium -a 127.0.0.1 -p 4723

# Start with logging
appium --log-level debug
```

### Running a Basic Test

```typescript
// e2e/appium/tests/basic-connection.test.ts
import { McpClient } from 'appium-mcp';

describe('Appium MCP Basic Connection', () => {
  let client: McpClient;

  beforeAll(async () => {
    client = new McpClient({
      host: '127.0.0.1',
      port: 4723,
    });
    await client.connect();
  });

  afterAll(async () => {
    await client.disconnect();
  });

  it('should connect to Android device', async () => {
    const devices = await client.getDevices();
    expect(devices).toBeDefined();
  });

  it('should start session with capabilities', async () => {
    const session = await client.createSession({
      platformName: 'Android',
      deviceName: 'Android Emulator',
      automationName: 'UiAutomator2',
      appPackage: 'ai.projectharmony.chat',
      appActivity: '.MainActivity',
    });
    expect(session).toBeDefined();
  });
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Direct Appium Java client | Appium MCP with natural language | 2024+ | AI agents can now control mobile tests via natural language |
| Selenium Grid for mobile | Appium as standalone server | 2013+ | Simplified mobile automation setup |
| Native UI automation (UIAutomator) | UiAutomator2/XCUITest drivers | 2016+ | Cross-platform compatibility |

**Deprecated/outdated:**
- Appium 1.x (use 2.x instead)
- Selendroid driver (replaced by UiAutomator2)
- JSONWP protocol (use W3C WebDriver protocol)

---

## Open Questions

1. **Which cloud provider to use?**
   - What we know: BrowserStack, Sauce Labs, LambdaTest, and Kobiton all support Appium
   - What's unclear: Pricing, real device availability, CI integration ease
   - **Updated recommendation:** Since we need to build as part of the testing CI, we will use **MacinCloud** for iOS. Cloud testing frameworks are retained as options for future large-scale e2e-testing with CI builds.

2. **How to handle iOS testing on Windows/Linux?**
   - What we know: Local iOS testing requires macOS
   - What's unclear: Cloud provider setup complexity vs cloud Mac rental
   - **Updated recommendation:** Consider cloud Mac rental (MacStadium, MacinCloud) for iOS builds + testing (see Cloud Mac Options below)

3. **Appium MCP server lifecycle management?**
   - What we know: Server needs to run before tests
   - What's unclear: Best practice for CI/CD integration
   - Recommendation: Use separate start-server script in package.json

---

## Cloud Mac for iOS Builds (MacinCloud)

### Why Cloud Mac?

Since this project uses React Native CLI (not Expo), iOS builds require macOS. Rather than using cloud device providers, renting a dedicated Mac gives you:
- Full Xcode for building iOS apps
- Ability to run Appium tests locally on the Mac
- Complete CI/CD pipeline control

### MacinCloud Pricing Plans

| Plan | Price | Features | Best For |
|------|-------|----------|----------|
| **Pay-as-You-Go** | $1/hour or $4/day | Prepaid 30 hours, managed account | Occasional builds/testing |
| **Managed Server (Monthly)** | ~$35-80/mo | User account access, pre-installed tools | CI/CD automation |
| **Dedicated Server (Monthly)** | ~$99-199/mo | Full root/admin access, dedicated Mac | Full control, custom setup |

**Recommended for this project:** Managed Server Monthly plan (~$35-80/month) with SSH add-on ($5/mo) - sufficient for CI/CD builds and Appium testing

### Setup Steps

1. **Sign up:** Create account at [MacinCloud](https://www.macincloud.com/)
2. **Select plan:** Choose Dedicated Server with Administrator access
3. **Add SSH add-on:** Purchase SSH add-on for remote CLI access ($5/month)
4. **Provision server:** Server ready in 5-15 minutes

### Enabling SSH/Remote Access

**For Dedicated Servers:**
1. Log into MacinCloud portal
2. Go to your server management page
3. Enable "Remote Login" (System Preferences → Sharing → Remote Login)
4. Note your server hostname (e.g., `macincloud-server-name.macincloud.com`)

**Connect via SSH:**
```bash
# SSH connection
ssh username@server-hostname.macincloud.com

# With SSH key (recommended for automation)
ssh -i ~/.ssh/macincloud_key username@server-hostname.macincloud.com
```

**Source:** [MacinCloud SSH Setup](https://support.macincloud.com/support/solutions/articles/8000079293-how-do-i-enable-ssh-remote-build-on-my-dedicated-server-)

### CI/CD Automation Setup

**Step 1: Generate SSH Key for Automation**
```bash
# On your local machine
ssh-keygen -t ed25519 -f ~/.ssh/macincloud_key -C "ci-automation"

# Copy public key to MacinCloud server
ssh-copy-id -i ~/.ssh/macincloud_key.pub username@server-hostname
```

**Step 2: Install Required Tools on MacinCloud**
```bash
# After SSH connection
# Install Node.js
brew install node

# Install Appium
npm install -g appium

# Install Xcode (pre-installed on MacinCloud images)
# Verify: xcode-select --install

# Install CocoaPods
sudo gem install cocoapods
```

**Step 3: Automated Build Script**
```bash
#!/bin/bash
# build-ios.sh - Run on MacinCloud server

set -e

# Navigate to project
cd /path/to/harmony-ai-app

# Install dependencies
npm install
cd ios && pod install && cd ..

# Build iOS
xcodebuild -workspace ios/HarmonyAIChat.xcworkspace \
  -scheme HarmonyAIChat \
  -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  build

# Run Appium tests (if configured)
appium &
sleep 5
npx playwright test e2e/appium/tests/
```

**Step 4: Remote Execution from Local Machine**
```bash
# Execute build script on MacinCloud
ssh -i ~/.ssh/macincloud_key username@server-hostname 'bash -s' < build-ios.sh
```

### Connection Options Summary

| Method | Use Case | Command |
|--------|----------|---------|
| **SSH** | CLI builds, CI/CD automation | `ssh user@host` |
| **VNC** | GUI access, visual debugging | `vnc://host` (via Finder) |
| **RDP** | Windows client access | Microsoft Remote Desktop |

**Source:** [MacinCloud Support - Connection & Access](https://support.macincloud.com/support/solutions/folders/8000080817)

---

## Cloud Mac Options (iOS Build Alternative)

### Comparison of Cloud Mac Rental Services

| Provider | Starting Price | Hardware | Key Features |
|----------|---------------|----------|--------------|
| **MacStadium (Orka)** | ~$79/mo | Intel + Apple Silicon | Kubernetes integration, CI/CD ready |
| **MacinCloud** | ~$20/mo | Intel only | Pay-as-you-go, dedicated Mac |
| **Scaleway Cloud Mac M1** | ~$30/mo | Apple Silicon (M1) | EU-based, fast provisioning |
| **Sim-Networks** | ~$40/mo | Apple Silicon | EU-based, development focused |
| **XCodeClub** | ~$25/mo | Intel | Xcode pre-installed |
| **Bitrise Cloud** | Per-build | Intel + Apple Silicon | Native iOS CI/CD, no Mac management |

### Recommendations by Use Case

| Scenario | Recommended Service | Reason |
|----------|---------------------|--------|
| **Full CI/CD pipeline** | Bitrise Cloud | Native iOS CI/CD, no Mac management needed |
| **Budget build-only** | MacinCloud or XCodeClub | Lowest cost for Xcode builds |
| **EU-based team** | Scaleway Cloud Mac M1 | Low latency from Europe |
| **Enterprise/Scale** | MacStadium Orka | Kubernetes integration, scalable |

### Key Findings

- **Bitrise Cloud** is the easiest option - it's a CI/CD platform with built-in Mac infrastructure
- **MacStadium Orka** brings Kubernetes-style orchestration to macOS VMs
- **Scaleway Cloud Mac M1** offers the best price/performance for Apple Silicon development
- Cloud Mac rental can be more cost-effective than BrowserStack for iOS-only teams

**Sources:** [MacStadium](https://macstadium.com/), [MacinCloud](https://www.macincloud.com/), [Scaleway Cloud Mac M1](https://www.scaleway.com/en/hello-m1/), [Macly iOS CI/CD Guide](https://macly.io/blog/ios-ci-cd-setup-guide)

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 29.6.3 (existing) + Appium MCP |
| Config file | jest.config.js (existing) |
| Quick run command | `npm test` (unit) + `npm run test:e2e` (Appium) |
| Full suite command | `npm test && npm run test:e2e` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ENV-01 | Appium MCP installed | manual | N/A - verify via `npx appium-mcp --version` | ❌ New |
| ENV-02 | ANDROID_HOME configured | manual | N/A - verify via `echo $ANDROID_HOME` | ❌ New |
| ENV-03 | Device connectivity verified | smoke | `node e2e/appium/scripts/verify-setup.ts` | ❌ New |
| ENV-04 | Basic test execution | e2e | `npm run test:e2e` | ❌ New |

### Sampling Rate
- **Per task commit:** Quick verification script
- **Per wave merge:** Full E2E suite
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `e2e/appium/scripts/verify-setup.ts` - covers ENV-03
- [ ] `e2e/appium/config/capabilities.ts` - device configuration
- [ ] `e2e/appium/tests/basic-connection.test.ts` - covers ENV-04
- [ ] Package.json scripts: `test:e2e`, `appium:start`

---

## Sources

### Primary (HIGH confidence)
- [GitHub - appium/appium-mcp](https://github.com/appium/appium-mcp) - Official MCP server implementation
- [npm - appium-mcp](https://www.npmjs.com/package/appium-mcp) - Package documentation
- [MCP Marketplace - Appium MCP](https://ubos.tech/mcp/mcp-appium-server/) - Setup guide

### Secondary (MEDIUM confidence)
- [Appium MCP Explained - GetPanto](https://www.getpanto.ai/blog/appium-mcp-for-mobile-app-qa-testing) - Usage guide
- [Comprehensive Guide to appium-mcp - Skywork](https://skywork.ai/skypage/en-A-Comprehensive-Guide-to-appium-mcp-AI-Powered-Mobile-Automation-for-Engineers/1971413234892533760) - Setup walkthrough

### Tertiary (LOW confidence)
- [Stack Overflow - Appium environment setup](https://stackoverflow.com/questions/17861998/how-to-setup-appium-environment-for-android-automation) - General reference

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Official npm package with clear documentation
- Architecture: HIGH - Standard Appium patterns apply
- Pitfalls: HIGH - Well-documented in official docs and community

**Research date:** 2026-03-05
**Valid until:** 2026-04-05 (30 days - stable technology)
