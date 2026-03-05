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