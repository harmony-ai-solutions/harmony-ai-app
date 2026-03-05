# Roadmap: Appium MCP Mobile Testing

**Date:** 2026-03-05
**Project:** Harmony AI Chat - Appium MCP Testing Integration

## Phase Overview

| Phase | Name | Duration | Status |
|-------|------|----------|--------|
| 1 | Environment Setup | 1-2 days | Pending |
| 2 | Test Infrastructure | 2-3 days | Pending |
| 3 | Android E2E Tests | 3-5 days | Pending |
| 4 | iOS E2E Tests (Cloud) | 2-3 days | Pending |
| 5 | CI/CD Integration | 2-3 days | Pending |

## iOS Testing Note for Windows Users

⚠️ **Important:** iOS testing with Appium requires Xcode, which only runs on macOS. Since this project runs on Windows, we have two options:

1. **Cloud-based iOS testing** (recommended): Use BrowserStack, Sauce Labs, or similar cloud services - they provide WebDriver endpoints accessible from any OS
2. **GitHub Actions CI/CD**: Use macOS runners which include Xcode

For Phase 4, we'll configure cloud-based iOS testing to enable testing from Windows machines.

---

## Phase 1: Environment Setup

**Duration:** 1-2 days
**Goal:** Configure Appium MCP server and verify connectivity

### Tasks

- [ ] **T1.1** Install Appium Server 2.x globally
  ```bash
  npm install -g appium
  ```

- [ ] **T1.2** Install appium-mcp package
  ```bash
  npm install -D appium-mcp
  ```

- [ ] **T1.3** Configure Claude Desktop MCP
  - Add to Claude Desktop config:
  ```json
  {
    "appium-mcp": {
      "command": "npx",
      "args": ["appium-mcp@latest"],
      "env": {
        "ANDROID_HOME": "/path/to/android/sdk"
      }
    }
  }
  ```

- [ ] **T1.4** Verify Android SDK configuration
  - Check ANDROID_HOME is set
  - Verify platform-tools available
  - Test adb connectivity

- [ ] **T1.5** Start Appium server and verify
  ```bash
  appium --allow-cors
  ```

### Deliverables
- Appium Server running
- MCP server configured
- Android device/emulator connectivity verified

### Dependencies
- None (prerequisites)

---

## Phase 2: Test Infrastructure

**Duration:** 2-3 days
**Goal:** Create e2e test directory structure and base configuration

### Tasks

- [ ] **T2.1** Create e2e directory structure
  ```
  e2e/
  ├── android/
  │   ├── pages/
  │   ├── specs/
  │   └── utils/
  ├── ios/
  │   ├── pages/
  │   ├── specs/
  │   └── utils/
  ├── fixtures/
  ├── config/
  └── README.md
  ```

- [ ] **T2.2** Create capabilities configuration
  - `e2e/config/capabilities.ts` - Device capabilities
  - `e2e/config/env.ts` - Environment variables

- [ ] **T2.3** Create base page objects
  - `e2e/android/pages/BasePage.ts` - Common page object methods
  - `e2e/ios/pages/BasePage.ts` - iOS base page

- [ ] **T2.4** Create test utilities
  - `e2e/utils/driver.ts` - WebDriver setup
  - `e2e/utils/helpers.ts` - Common test helpers
  - `e2e/utils/logger.ts` - Test logging

- [ ] **T2.5** Create test fixtures
  - `e2e/fixtures/test-data.ts` - Test data
  - `e2e/fixtures/users.ts` - User credentials

- [ ] **T2.6** Add npm scripts to package.json
  ```json
  {
    "test:e2e": "wdio run wdio.conf.ts",
    "test:e2e:android": "wdio run wdio.android.conf.ts",
    "test:e2e:ios": "wdio run wdio.ios.conf.ts"
  }
  ```

### Deliverables
- Complete e2e directory structure
- Configuration files for Android and iOS
- Base page objects and utilities
- npm scripts for test execution

### Dependencies
- Phase 1 complete

---

## Phase 3: Android E2E Tests

**Duration:** 3-5 days
**Goal:** Implement Android end-to-end tests for critical user paths

### Tasks

- [ ] **T3.1** Create Home Screen tests
  - App launch verification
  - Character list display
  - Navigation to chat

- [ ] **T3.2** Create Chat Screen tests
  - Message input field
  - Send message flow
  - Message display verification
  - Typing indicator

- [ ] **T3.3** Create Settings tests
  - Theme switching
  - Profile settings
  - Connection settings

- [ ] **T3.4** Create Navigation tests
  - Tab navigation
  - Stack navigation
  - Back button behavior

- [ ] **T3.5** Create Pairing/Connection tests
  - Initial pairing modal
  - Connection setup flow
  - Connection status verification

- [ ] **T3.6** Implement wait strategies
  - Explicit waits for elements
  - Page load verification
  - Network condition handling

- [ ] **T3.7** Add screenshot on failure
  - Hook for test failures
  - Screenshot storage

### Deliverables
- Complete Android E2E test suite
- Minimum 20 test cases
- 80% critical path coverage

### Dependencies
- Phase 2 complete

---

## Phase 4: iOS E2E Tests

**Duration:** 2-3 days
**Goal:** Implement iOS end-to-end tests

### Tasks

- [ ] **T4.1** Configure iOS capabilities
  - Xcode simulator setup
  - Bundle ID configuration
  - UDID management

- [ ] **T4.2** Create iOS page objects
  - Adapt Android page objects for iOS
  - Handle iOS-specific elements

- [ ] **T4.3** Run Android tests on iOS
  - Execute existing tests on iOS
  - Fix platform-specific issues

- [ ] **T4.4** iOS-specific tests
  - Safe area handling
  - iOS navigation patterns
  - Keyboard handling

### Deliverables
- iOS E2E test suite
- Cross-platform test coverage

### Dependencies
- Phase 3 complete

---

## Phase 5: CI/CD Integration

**Duration:** 2-3 days
**Goal:** Prepare for automated test execution in CI/CD

### Tasks

- [ ] **T5.1** Create Appium startup script
  - Background Appium server
  - Health check endpoint

- [ ] **T5.2** Configure test execution
  - Parallel test execution
  - Test filtering
  - Retry logic

- [ ] **T5.3** Create test reports
  - Allure reports integration
  - HTML report generation

- [ ] **T5.4** GitHub Actions workflow
  - `.github/workflows/e2e-tests.yml`
  - Android emulator setup
  - iOS simulator management

- [ ] **T5.5** Documentation
  - Update e2e/README.md
  - Test execution guide
  - Troubleshooting section

### Deliverables
- CI/CD pipeline configuration
- Test execution documentation
- Automated test runs

### Dependencies
- Phase 4 complete

---

## Implementation Order Rationale

1. **Phase 1 first:** Must verify environment before creating tests
2. **Phase 2 second:** Infrastructure needed for test development
3. **Phase 3 before 4:** Android is primary platform, lessons learned apply to iOS
4. **Phase 5 last:** Tests must exist before automating

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Appium MCP setup complexity | Use official documentation, start simple |
| Device connectivity issues | Use emulator for initial development |
| Flaky tests | Implement proper waits, retry logic |
| Cross-platform differences | Abstract platform-specific code in page objects |

## Success Metrics

- [ ] All 5 phases completed
- [ ] 20+ E2E test cases
- [ ] 80% critical path coverage
- [ ] Tests run successfully on Android
- [ ] Tests run successfully on iOS
- [ ] CI/CD pipeline functional
- [ ] Documentation complete
