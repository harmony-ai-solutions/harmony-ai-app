# Project: Harmony AI Chat - Appium MCP Testing Integration

**Date:** 2026-03-05
**Type:** Mobile Testing Automation Integration

## Overview

This project aims to implement Appium MCP (Model Context Protocol) for end-to-end mobile testing of the Harmony AI Chat application. Appium MCP enables AI assistants like Claude to interact directly with mobile devices and simulators for automated testing.

## Project Context

**Parent Project:** Harmony AI Chat
- React Native 0.83.1 mobile application
- Android-first (with iOS support)
- AI character chat application with WebSocket connectivity

**Current Testing State:**
- Unit tests: Jest 29.6.3 (existing)
- Integration tests: Database tests in `src/database/__tests__/`
- E2E tests: None currently implemented

## Research Summary

### Appium MCP Ecosystem

**Primary Source:** [appium/appium-mcp](https://github.com/appium/appium-mcp) - Official Appium MCP server

**Key Capabilities:**
- AI-powered mobile automation via Model Context Protocol
- Natural language interactions with mobile devices
- Intelligent visual element detection and recovery
- Support for Android (UiAutomator2) and iOS (XCUITest)
- W3C WebDriver Actions API for touch gestures

**Installation:**
```bash
claude mcp add appium-mcp -- npx -y appium-mcp@latest
```

**Configuration Requirements:**
- Node.js >= 20
- Android SDK with ANDROID_HOME set
- Appium Server 2.x
- For iOS: Xcode with Command Line Tools

### Alternative Implementations

| Implementation | Stars | Purpose | Notes |
|----------------|-------|---------|-------|
| [appium/appium-mcp](https://github.com/appium/appium-mcp) | Official | Main MCP server | Recommended |
| [Rahulec08/appium-mcp](https://github.com/Rahulec08/appium-mcp) | Community | Enhanced features | Additional visual element detection |
| [mobile-next/mobile-mcp](https://github.com/mobile-next/mobile-mcp) | Alternative | Mobile automation & scraping | Broader scope |

## Goals

1. **Setup Appium MCP** - Configure MCP server for mobile testing
2. **Create E2E Test Structure** - Establish `e2e/` directory with test files
3. **Implement Basic Tests** - Cover critical user flows (app launch, navigation, chat)
4. **Integrate with Claude** - Enable AI-assisted test generation
5. **CI/CD Integration** - Prepare for automated test execution

## Technical Requirements

### Prerequisites
- Appium Server 2.x running
- Android emulator or device connected
- ANDROID_HOME environment variable configured
- Node.js >= 20

### Test Capabilities
```typescript
const capabilities: AppiumCapabilities = {
  platformName: 'Android',
  deviceName: 'YOUR_DEVICE_NAME',
  automationName: 'UiAutomator2',
  app: './path/to/app.apk', // or appPackage for installed app
  appPackage: 'ai.projectharmony.chat',
  appActivity: '.MainActivity',
  noReset: true
};
```

## Scope

**In Scope:**
- Android E2E testing (primary)
- iOS E2E testing (secondary)
- AI-assisted test generation via MCP
- Test automation for critical user paths

**Out of Scope:**
- Performance testing
- Security testing
- Accessibility testing (initial phase)

## Success Criteria

- [ ] Appium MCP server configured and running
- [ ] E2E test directory created
- [ ] Basic app launch test passes
- [ ] Navigation flow tests implemented
- [ ] Chat functionality tests implemented
- [ ] Claude can generate tests via MCP
