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