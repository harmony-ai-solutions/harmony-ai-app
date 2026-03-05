# Requirements: Appium MCP Mobile Testing

**Date:** 2026-03-05
**Project:** Harmony AI Chat - Appium MCP Testing Integration

## iOS Testing Note

⚠️ **Important for Windows Users:** iOS testing with Appium requires Xcode (macOS-only). For this project:

- **Android E2E Tests:** Fully supported on Windows
- **iOS E2E Tests:** Use cloud services (BrowserStack, Sauce Labs) from Windows, OR use GitHub Actions with macOS runners

This requirement document covers both approaches.

## Functional Requirements

### FR-001: Appium MCP Server Configuration
- **Description:** Configure Appium MCP server for mobile testing
- **Requirements:**
  - Install appium-mcp package
  - Configure MCP client (Claude Desktop) with appium-mcp
  - Set ANDROID_HOME environment variable
  - Verify server connectivity

### FR-002: Android E2E Test Suite
- **Description:** Create end-to-end tests for Android platform
- **Requirements:**
  - Test app launch and splash screen
  - Test navigation between screens (Home, Chat, Settings)
  - Test chat message input and display
  - Test character selection
  - Test theme switching
  - Test connection/pairing flow
- **Target Coverage:** Critical user paths (minimum 80%)

### FR-003: iOS E2E Test Suite
- **Description:** Create end-to-end tests for iOS platform
- **Requirements:**
  - Same test cases as Android (FR-002)
  - iOS-specific capabilities configuration
  - Xcode simulator management
- **Target Coverage:** Critical user paths (minimum 80%)

### FR-004: AI-Assisted Test Generation
- **Description:** Enable Claude to generate tests via MCP
- **Requirements:**
  - MCP tools available for test generation
  - Natural language test specification
  - Automatic element locator generation
  - Test recovery on failure

### FR-005: Test Infrastructure
- **Description:** Establish test directory and structure
- **Requirements:**
  - Create `e2e/` directory
  - Create `e2e/android/` for Android tests
  - Create `e2e/ios/` for iOS tests
  - Create `e2e/fixtures/` for test data
  - Create `e2e/config/` for capabilities

### FR-006: CI/CD Integration
- **Description:** Prepare for automated test execution
- **Requirements:**
  - Appium server startup configuration
  - Test execution scripts
  - Test report generation
  - Integration with existing npm scripts

## Non-Functional Requirements

### NFR-001: Performance
- **Description:** Test execution should be reasonably fast
- **Requirements:**
  - Individual test execution < 30 seconds
  - Full suite execution < 10 minutes
  - Parallel execution support where applicable

### NFR-002: Reliability
- **Description:** Tests should be stable and reliable
- **Requirements:**
  - Flaky test rate < 5%
  - Proper wait strategies for element loading
  - Screenshot capture on failure

### NFR-003: Maintainability
- **Description:** Tests should be easy to maintain
- **Requirements:**
  - Page Object Model pattern
  - Clear test naming conventions
  - Shared fixtures and utilities

### NFR-004: Documentation
- **Description:** Clear documentation for test execution
- **Requirements:**
  - README in e2e directory
  - Test execution instructions
  - Troubleshooting guide

## Technical Requirements

### TR-001: Prerequisites
- Node.js >= 20
- Appium Server 2.x
- Android SDK API level 24+
- Xcode 15+ (for iOS)
- Java Development Kit 17+

### TR-002: Package Dependencies
```json
{
  "devDependencies": {
    "appium-mcp": "latest",
    "@appium/support": "^2.x",
    "webdriverio": "^8.x"
  }
}
```

### TR-003: Android Capabilities
```typescript
const androidCapabilities = {
  platformName: 'Android',
  deviceName: 'Android Emulator',
  automationName: 'UiAutomator2',
  appPackage: 'ai.projectharmony.chat',
  appActivity: '.MainActivity',
  noReset: true,
  autoGrantPermissions: true
};
```

### TR-004: iOS Capabilities
```typescript
const iosCapabilities = {
  platformName: 'iOS',
  deviceName: 'iPhone 15 Pro',
  automationName: 'XCUITest',
  bundleId: 'ai.projectharmony.chat',
  noReset: true,
  udid: 'auto'
};
```

## Test Cases

### TC-001: App Launch
- **Preconditions:** App not installed or cleared
- **Steps:**
  1. Launch app
  2. Wait for splash/loading
  3. Verify home screen appears
- **Expected:** App launches successfully, home screen visible

### TC-002: Navigation - Chat Screen
- **Preconditions:** App on home screen
- **Steps:**
  1. Tap on character/chat item
  2. Wait for navigation
  3. Verify chat screen loads
- **Expected:** Chat screen displays with input field

### TC-003: Send Message
- **Preconditions:** On chat screen
- **Steps:**
  1. Tap message input
  2. Enter test message
  3. Tap send button
  4. Verify message appears in chat
- **Expected:** Message sent and displayed in chat bubble

### TC-004: Theme Switching
- **Preconditions:** App on settings screen
- **Steps:**
  1. Navigate to theme settings
  2. Select different theme
  3. Verify UI updates
- **Expected:** Theme changes applied correctly

### TC-005: Connection Flow
- **Preconditions:** App fresh install
- **Steps:**
  1. Launch app
  2. Verify pairing modal appears
  3. Close modal
  4. Navigate to connection settings
  5. Enter connection details
  6. Verify connection established
- **Expected:** Connection flow completes successfully

## Out of Scope

The following are explicitly NOT in scope for this project:
- Performance benchmarking
- Load testing
- Security vulnerability testing
- Accessibility compliance testing
- Visual regression testing
- Test analytics/metrics platform

## Dependencies

| Requirement | Depends On | Priority |
|-------------|------------|----------|
| FR-001 | - | Critical |
| FR-002 | FR-001, FR-005 | High |
| FR-003 | FR-001, FR-005 | High |
| FR-004 | FR-001 | Medium |
| FR-005 | - | High |
| FR-006 | FR-002, FR-003 | Medium |
