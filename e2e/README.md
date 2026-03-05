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