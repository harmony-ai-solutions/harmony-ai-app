# Technology Stack

**Analysis Date:** 2026-03-05

## Languages

**Primary:**
- TypeScript 5.8.3 - All application code (`src/`)
- JavaScript - Configuration files and build scripts

**Secondary:**
- Kotlin - Android native code (`android/app/src/main/java/`)
- Swift - iOS native code (`ios/HarmonyAIChat/`)

## Runtime

**Environment:**
- React Native 0.83.1 - Mobile application runtime
- Node.js >=20 - Development and build tooling

**Package Manager:**
- npm - Package management
- Lockfile: `package-lock.json` present

## Frameworks

**Core:**
- React 19.2.0 - UI framework
- React Native 0.83.1 - Mobile framework

**Navigation:**
- @react-navigation/native 7.1.26 - Navigation container
- @react-navigation/native-stack 7.9.0 - Stack navigator
- @react-navigation/bottom-tabs 7.9.1 - Tab navigator

**UI Components:**
- react-native-paper 5.14.5 - Material Design components
- react-native-vector-icons 10.3.0 - Icon library
- react-native-linear-gradient 2.8.3 - Gradient backgrounds

**Testing:**
- Jest 29.6.3 - Test runner
- react-test-renderer 19.2.0 - React component testing

**Build/Dev:**
- Metro 0.83.1 - JavaScript bundler
- Babel 7.25.x - JavaScript transpiler
- TypeScript 5.8.3 - Type checking

## Key Dependencies

**Data & Storage:**
- react-native-sqlite-storage 6.0.1 - SQLite database
- @react-native-async-storage/async-storage 2.2.0 - Key-value storage

**Audio & Media:**
- react-native-audio-record 0.2.2 - Audio recording
- react-native-track-player 5.0.0-alpha0 - Audio playback
- music-metadata 11.12.1 - Audio file metadata parsing
- react-native-image-picker 7.0.0 - Image selection

**Device & System:**
- react-native-device-info 15.0.1 - Device information
- react-native-keychain 10.0.0 - Secure credential storage
- react-native-fs 20.0.0 - File system access
- react-native-safe-area-context 5.6.2 - Safe area handling
- react-native-screens 4.19.0 - Native screen containers
- @react-native-clipboard/clipboard 1.16.3 - Clipboard access
- @react-native-community/slider 5.1.1 - Slider component
- @react-native-documents/picker 12.0.0 - Document picker

**Networking:**
- react-native-websocket-self-signed 0.4.0 - WebSocket with self-signed certs

**Utilities:**
- uuid 13.0.0 - UUID generation
- eventemitter3 5.0.1 - Event emitter
- react-native-logs 5.5.0 - Logging framework
- react-native-get-random-values 2.0.0 - Crypto polyfill

## Configuration

**Environment:**
- No `.env` file detected - Configuration stored in-app via user settings
- Provider API keys stored in SQLite database via `provider_config_*` tables

**Build:**
- `babel.config.js` - Uses `@react-native/babel-preset`
- `metro.config.js` - Custom asset extensions (db, mp3, ttf, obj, png, jpg)
- `tsconfig.json` - Extends `@react-native/typescript-config`
- `jest.config.js` - React Native preset with custom transformIgnorePatterns
- `.eslintrc.js` - Extends `@react-native` config
- `.prettierrc.js` - Single quotes, trailing commas, avoid arrow parens

## Platform Requirements

**Development:**
- Node.js >= 20
- Android Studio (for Android builds)
- Xcode (for iOS builds)
- React Native CLI

**Production:**
- Android 6.0+ (API 23)
- iOS 13.0+

---

*Stack analysis: 2026-03-05*
