---
phase: 01-environment-setup
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - e2e/appium/scripts/verify-setup.ts
  - e2e/appium/config/capabilities.ts
  - e2e/appium/tests/basic-connection.test.ts
  - e2e/.env.example
  - e2e/README.md
autonomous: false

requirements:
  - ENV-01
  - ENV-02
  - ENV-03
  - ENV-04

must_haves:
  truths:
    - "Appium 2.x server starts without errors"
    - "appium-mcp is registered as a Claude MCP tool"
    - "ANDROID_HOME and JAVA_HOME environment variables are set and accessible"
    - "adb devices lists at least one connected Android emulator"
    - "verify-setup.ts script exits 0 (all checks pass)"
  artifacts:
    - path: "e2e/appium/scripts/verify-setup.ts"
      provides: "Automated environment health check"
      exports: ["verifySetup"]
    - path: "e2e/appium/config/capabilities.ts"
      provides: "Android + iOS device capability configs"
      exports: ["androidCapabilities", "iosCapabilities"]
    - path: "e2e/appium/tests/basic-connection.test.ts"
      provides: "Smoke test confirming Appium MCP connectivity"
  key_links:
    - from: "verify-setup.ts"
      to: "ANDROID_HOME env var"
      via: "process.env.ANDROID_HOME"
      pattern: "process\\.env\\.ANDROID_HOME"
    - from: "verify-setup.ts"
      to: "adb devices"
      via: "execSync('adb devices')"
      pattern: "execSync.*adb devices"
---

<objective>
Install and configure Appium MCP for mobile E2E testing on the Harmony AI Chat React Native project. This phase establishes the local Android testing environment on Windows: Appium 2.x server, appium-mcp Claude integration, Android SDK environment variables, and a verification script that confirms end-to-end device connectivity.

Purpose: All subsequent test phases (2-5) depend on a working Appium environment. This phase gates everything else.
Output: Working Appium server + MCP integration + verified Android device connectivity + scaffolded e2e directory.
</objective>

<execution_context>
@C:/Users/sge20/.roo/get-shit-done/workflows/execute-plan.md
@C:/Users/sge20/.roo/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/1-CONTEXT.md
@.planning/1-RESEARCH.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Install Appium packages + scaffold e2e directory</name>
  <files>
    package.json,
    e2e/appium/scripts/verify-setup.ts,
    e2e/appium/config/capabilities.ts,
    e2e/appium/tests/basic-connection.test.ts,
    e2e/.env.example,
    e2e/README.md
  </files>
  <action>
**Step 1 – Install Appium 2.x globally:**
```bash
npm install -g appium
appium --version   # confirm >= 2.0.0
```

**Step 2 – Install appium-mcp as dev dependency:**
```bash
npm install --save-dev appium-mcp
```

**Step 3 – Add npm scripts to package.json** (merge into existing `"scripts"` block; do NOT remove existing scripts):
```json
{
  "appium:start": "appium --allow-cors -p 4723",
  "appium:verify": "npx ts-node e2e/appium/scripts/verify-setup.ts",
  "test:e2e": "jest --config jest.e2e.config.js",
  "test:e2e:android": "PLATFORM=android jest --config jest.e2e.config.js"
}
```

**Step 4 – Create e2e directory structure** (create all listed files):

`e2e/.env.example`:
```
# Android SDK path (Windows default shown)
ANDROID_HOME=C:\Users\YOUR_USERNAME\AppData\Local\Android\Sdk
# Java SDK path
JAVA_HOME=C:\Program Files\Java\jdk-17
# Appium server
APPIUM_HOST=127.0.0.1
APPIUM_PORT=4723
```

`e2e/appium/config/capabilities.ts`:
```typescript
// Device capabilities for Harmony AI Chat (ai.projectharmony.chat)
// Android: local emulator | iOS: cloud provider (Phase 4)

export const androidCapabilities = {
  platformName: 'Android',
  deviceName: 'Android Emulator',
  automationName: 'UiAutomator2',
  app: './android/app/build/outputs/apk/debug/app-debug.apk',
  appPackage: 'ai.projectharmony.chat',
  appActivity: '.MainActivity',
  noReset: true,
  newCommandTimeout: 300,
};

export const iosCapabilities = {
  // Phase 4: iOS via cloud provider (LambdaTest / TestMu AI)
  platformName: 'iOS',
  deviceName: 'iPhone 15',
  automationName: 'XCUITest',
  bundleId: 'ai.projectharmony.chat',
  noReset: true,
  newCommandTimeout: 300,
};

export const appiumServerConfig = {
  host: process.env.APPIUM_HOST || '127.0.0.1',
  port: Number(process.env.APPIUM_PORT) || 4723,
};
```

`e2e/appium/scripts/verify-setup.ts`:
```typescript
// Environment verification script for Appium MCP setup
// Run: npm run appium:verify
import { execSync } from 'child_process';

interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
}

function checkEnv(name: string): CheckResult {
  const value = process.env[name];
  return {
    name,
    passed: !!value,
    message: value ? `${name}=${value}` : `${name} not set`,
  };
}

function checkCommand(label: string, command: string): CheckResult {
  try {
    const out = execSync(command, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return { name: label, passed: true, message: out.split('\n')[0] };
  } catch {
    return { name: label, passed: false, message: `Command not found: ${command}` };
  }
}

function checkAndroidDevices(): CheckResult {
  try {
    const out = execSync('adb devices', { encoding: 'utf-8' });
    const devices = out
      .split('\n')
      .filter(l => l.includes('\t') && l.includes('device'));
    return {
      name: 'Android Devices',
      passed: devices.length > 0,
      message: devices.length > 0 ? `Found: ${devices[0].trim()}` : 'No devices listed (start an emulator)',
    };
  } catch {
    return { name: 'Android Devices', passed: false, message: 'adb not in PATH or not installed' };
  }
}

const checks: CheckResult[] = [
  checkEnv('ANDROID_HOME'),
  checkEnv('JAVA_HOME'),
  checkCommand('Node.js version', 'node --version'),
  checkCommand('npm version', 'npm --version'),
  checkCommand('Appium version', 'appium --version'),
];

// Android: Windows and Linux
if (process.platform === 'win32' || process.platform === 'linux') {
  checks.push(checkAndroidDevices());
}

// iOS: macOS only
if (process.platform === 'darwin') {
  checks.push(checkCommand('iOS simulators', 'xcrun simctl list devices available | head -5'));
}

console.log('\n=== Appium MCP Environment Verification ===\n');
checks.forEach(r => {
  const icon = r.passed ? '✓' : '✗';
  console.log(`${icon} ${r.name}: ${r.message}`);
});
const allPassed = checks.every(r => r.passed);
console.log(`\n${allPassed ? '✅ Environment ready!' : '❌ Fix errors above before running tests.'}\n`);
process.exit(allPassed ? 0 : 1);
```

`e2e/appium/tests/basic-connection.test.ts`:
```typescript
// Smoke test: verify Appium MCP server is reachable
// Requires: appium server running (npm run appium:start)
import http from 'http';

function pingAppium(host: string, port: number): Promise<boolean> {
  return new Promise(resolve => {
    const req = http.get(`http://${host}:${port}/status`, res => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(3000, () => { req.destroy(); resolve(false); });
  });
}

describe('Appium MCP Connectivity', () => {
  const host = process.env.APPIUM_HOST || '127.0.0.1';
  const port = Number(process.env.APPIUM_PORT) || 4723;

  it('Appium server should be reachable on port 4723', async () => {
    const reachable = await pingAppium(host, port);
    expect(reachable).toBe(true);
  }, 10_000);
});
```

`e2e/README.md`:
```markdown
# E2E Tests – Appium MCP

## Prerequisites
- Android Studio with an AVD (Android Virtual Device) configured
- `ANDROID_HOME` and `JAVA_HOME` set as system environment variables (see `.env.example`)
- Appium 2.x installed globally: `npm install -g appium`

## Quick Start

```bash
# 1. Verify environment
npm run appium:verify

# 2. Start Appium server (leave running in separate terminal)
npm run appium:start

# 3. Run E2E tests
npm run test:e2e
```

## Platform Strategy
| Host OS | Local Testing | Cloud Testing |
|---------|--------------|---------------|
| Windows | Android emulator | iOS via LambdaTest/TestMu AI (Phase 4) |
| macOS | iOS simulator | Android emulator |

## Test Structure
```
e2e/
├── appium/
│   ├── config/capabilities.ts    # Device capabilities
│   ├── scripts/verify-setup.ts   # Environment health check
│   └── tests/
│       ├── basic-connection.test.ts  # Smoke tests
│       └── android/              # Phase 3: Android E2E tests
├── .env.example                  # Environment variable template
└── README.md
```
```
  </action>
  <verify>
    <automated>node -e "const p=require('./package.json'); console.log(p.scripts['appium:start'] ? 'SCRIPTS OK' : 'MISSING SCRIPTS')" && node -e "require('fs').accessSync('e2e/appium/scripts/verify-setup.ts') || process.exit(1); console.log('FILES OK')"</automated>
  </verify>
  <done>
    - `appium` is installed globally (`appium --version` returns 2.x)
    - `appium-mcp` appears in `package.json` devDependencies
    - `package.json` scripts include `appium:start`, `appium:verify`, `test:e2e`
    - All e2e scaffold files exist at correct paths
  </done>
</task>

<task type="checkpoint:human-action">
  <name>Task 2: Configure Windows environment variables + Claude MCP</name>
  <what-built>
    Appium and appium-mcp are installed. All scaffold files exist. Now the Android SDK environment variables need to be set at the Windows system level so they are visible to GUI tools (Android Studio, Claude Desktop) and new terminal sessions. This cannot be done via CLI reliably on Windows without admin elevation.
  </what-built>
  <how-to-verify>
**Step A – Set system environment variables (Windows):**
1. Press `Win + R` → type `SystemPropertiesAdvanced` → press Enter
2. Click **Environment Variables…** → under **User variables**, click **New** for each:
   - Name: `ANDROID_HOME`  Value: `C:\Users\YOUR_USERNAME\AppData\Local\Android\Sdk`
     *(check exact path in Android Studio → Settings → Appearance & Behavior → System Settings → Android SDK → Android SDK Location)*
   - Name: `JAVA_HOME`  Value: path to JDK 17 (e.g., `C:\Program Files\Java\jdk-17` or check with `where java` in cmd)
3. Edit the `Path` user variable and add (if not already present):
   - `%ANDROID_HOME%\platform-tools`
   - `%ANDROID_HOME%\tools`
   - `%ANDROID_HOME%\tools\bin`
4. Click **OK** three times. **Restart any open terminals** (env vars only load in new shells).

**Step B – Configure Claude MCP (Claude Desktop / Claude Code):**
Run in a NEW terminal (after restarting):
```powershell
claude mcp add appium-mcp -- npx -y appium-mcp@latest
```
If `claude` CLI is not available, manually add to Claude Desktop config (`%APPDATA%\Claude\claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "appium-mcp": {
      "command": "npx",
      "args": ["-y", "appium-mcp@latest"],
      "env": {
        "ANDROID_HOME": "C:\\Users\\YOUR_USERNAME\\AppData\\Local\\Android\\Sdk",
        "JAVA_HOME": "C:\\Program Files\\Java\\jdk-17"
      }
    }
  }
}
```

**Step C – Verify in a new terminal:**
```powershell
echo $env:ANDROID_HOME   # should print the SDK path
echo $env:JAVA_HOME      # should print the JDK path
adb --version            # should print adb version
```
  </how-to-verify>
  <resume-signal>Type "env-set" once ANDROID_HOME, JAVA_HOME, and PATH are confirmed in a new terminal, or describe any issues.</resume-signal>
</task>

<task type="checkpoint:human-verify">
  <name>Task 3: Verify Appium server + Android device connectivity</name>
  <what-built>
    Environment variables are configured. Appium and appium-mcp are installed. The verify-setup.ts script checks all prerequisites. This final checkpoint confirms the full stack works end-to-end before Phase 2 begins.
  </what-built>
  <how-to-verify>
**Step 1 – Start an Android Emulator:**
Open Android Studio → Virtual Device Manager → Start any AVD (or start from CLI):
```powershell
# List available AVDs
emulator -list-avds
# Start one (replace 'Pixel_7_API_34' with your AVD name)
emulator -avd Pixel_7_API_34
```
Wait until the emulator boots fully (home screen visible).

**Step 2 – Confirm device is visible:**
```powershell
adb devices
# Expected output includes a line like:
# emulator-5554   device
```
If empty: run `adb kill-server && adb start-server`, then retry.

**Step 3 – Run environment verification:**
```powershell
npm run appium:verify
# Expected: All checks show ✓ and "Environment ready!"
```

**Step 4 – Start Appium server (separate terminal):**
```powershell
npm run appium:start
# Expected: Appium HTTP server listening on http://127.0.0.1:4723
```

**Step 5 – Run connectivity smoke test:**
```powershell
# In another terminal (Appium must be running):
npx ts-node -e "
const http = require('http');
http.get('http://127.0.0.1:4723/status', r => {
  let d=''; r.on('data',c=>d+=c);
  r.on('end',()=>{ console.log('Appium status:', r.statusCode); console.log(d); });
}).on('error', e => console.error('FAILED:', e.message));
"
# Expected: statusCode 200 and JSON with {"value":{"ready":true,...}}
```
  </how-to-verify>
  <resume-signal>Type "verified" if all 5 steps succeeded, or describe which step failed and the error message.</resume-signal>
</task>

</tasks>

<verification>
Phase 1 is complete when:
- [ ] `appium --version` returns 2.x in a fresh terminal
- [ ] `npm run appium:verify` exits 0 with all green checkmarks
- [ ] `adb devices` shows at least one device/emulator
- [ ] Appium server starts with `npm run appium:start` on port 4723
- [ ] GET `http://127.0.0.1:4723/status` returns `{"value":{"ready":true}}`
- [ ] `appium-mcp` is registered in Claude MCP settings
</verification>

<success_criteria>
- Appium 2.x server starts successfully on Windows
- Android emulator detected by `adb devices`
- `verify-setup.ts` reports all checks green
- `appium-mcp` MCP tool registered and accessible to Claude
- e2e scaffold directory created at correct paths
- Phase 2 (Test Infrastructure) can begin immediately after this phase
</success_criteria>

<output>
After completion, create `.planning/phases/01-environment-setup/01-environment-setup-01-SUMMARY.md` with:
- What was installed and configured
- Actual paths used for ANDROID_HOME and JAVA_HOME on this machine
- Any deviations from the plan
- Verification command outputs
- Issues encountered and resolutions
</output>
