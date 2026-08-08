# Architecture

**Analysis Date:** 2026-08-07

## Pattern Overview

**Overall:** Layered feature-folder architecture — a React Native TypeScript mobile client with:
1. **React Context provider tree** for cross-cutting app state (theme, auth, database readiness, sync connection, entity sessions, biometrics, i18n, emoji, alerts).
2. **Singleton service classes built on `eventemitter3`** for long-lived business logic (sync engine, WebSocket connection manager, auth, cloud session, entity sessions, connection state).
3. **Repository pattern over encrypted SQLite** (`react-native-sqlite-storage`) with forward-only versioned migrations and a dedicated second DB connection for sync writes.
4. **Feature-sliced `src/` layout** (`screens/`, `components/`, `services/`, `contexts/`, `database/`, `navigation/`, `theme/`, `i18n/`).

**Key Characteristics:**
- React Native 0.86 bare workflow (NOT Expo) with native `ios/` and `android/` projects — see `package.json`.
- Navigation via React Navigation v7: native-stack root (`src/navigation/AppNavigator.tsx`) wrapping a 5-tab bottom navigator with a custom `GlassTabBar` (`src/components/navigation/GlassTabBar.tsx`).
- UI framework: `react-native-paper` v5 (MD3 themes) wrapped by a custom theme system (`src/contexts/ThemeContext.tsx`, `src/theme/`) with 9 built-in themes.
- Persistent atmospheric background layer (`src/components/background/DynamicBackground.tsx`) rendered behind a transparent navigation stack — screens use transparent backgrounds so the aurora layer shows through.
- State is NOT centralized (no Redux/Zustand); contexts + singleton services + EventEmitter events are the wiring mechanism.
- Local-first: all data is persisted in an on-device SQLite DB; the app syncs with a backend (self-hosted Harmony Link or cloud conduct-proxy) over WebSocket.
- TypeScript throughout (`tsconfig.json`); path alias `@test-utils/database` for tests only (`jest.config.js`).

## Layers

**Presentation (Screens):**
- Purpose: Full-screen route components; compose components + services + repositories.
- Location: `src/screens/` (30 screens) with subfolders `auth/`, `settings/`, `setup/`, `config/`, `development/`.
- Contains: Screen components (e.g. `src/screens/ChatDetailScreen.tsx`, `src/screens/ChatListScreen.tsx`, `src/screens/settings/SyncSettingsScreen.tsx`).
- Depends on: `src/contexts/` (hooks), `src/components/`, `src/database/repositories/`, `src/services/`.
- Used by: `src/navigation/AppNavigator.tsx` (stack routes), `src/navigation/MainTabNavigator.tsx` (tab routes).

**Presentation (Components):**
- Purpose: Reusable UI building blocks, feature-sliced into folders.
- Location: `src/components/` (66 `.tsx` files), subfolders: `themed/`, `chat/`, `emoji/`, `modals/`, `settings/`, `background/`, `characters/`, `cloud/`, `config/`, `database/`, `entities/`, `landing/`, `lock/`, `navigation/`, `sync/`, plus `src/components/ErrorBoundary.tsx`.
- Contains: `ThemedText`, `ThemedButton`, `ThemedCard`, `ChatBubble`, `EmojiPickerModal`, `GlassTabBar`, `LockScreen`, `SyncProgressVisualizer`.
- Depends on: `src/contexts/ThemeContext.tsx`, `src/utils/`, `react-native-paper`.
- Used by: screens and other components.

**Navigation:**
- Purpose: Declares the route graph and navigation theming.
- Location: `src/navigation/AppNavigator.tsx` (root native stack, `RootStackParamList` type), `src/navigation/MainTabNavigator.tsx` (5 tabs: Discover | Search | Chat | Characters | Settings).
- Contains: `RootStackParamList` and `MainTabParamList` route param types.
- Depends on: `@react-navigation/native`, `@react-navigation/native-stack`, `@react-navigation/bottom-tabs`, screens.
- Used by: `App.tsx` (`AppShell`).

**State Management (Contexts):**
- Purpose: Provide cross-cutting state via React Context + `useX()` hooks.
- Location: `src/contexts/` — `AuthContext.tsx`, `BiometricLockContext.tsx`, `DatabaseContext.tsx`, `EmojiContext.tsx`, `EntitySessionContext.tsx`, `I18nContext.tsx`, `SyncConnectionContext.tsx`, `ThemeContext.tsx`, `AppAlertContext.tsx`; pure helpers `connectionStatusHelper.ts`, `syncEstimateHelper.ts`, `syncSettlementHelper.ts`.
- Contains: Provider components + typed hooks; thin adapters over the singleton services.
- Depends on: `src/services/` singletons, `src/database/`.
- Used by: every screen/component needing app state.
- Note: The provider nesting order is defined once in `App.tsx` (`ThemeProvider` → `I18nProvider` → `DatabaseProvider` → `AuthProvider` → `AppAlertProvider` → `SyncConnectionProvider` → `EntitySessionProvider` → `EmojiProvider` → `BiometricLockProvider` → `AppShell`).

**Business Logic (Services):**
- Purpose: Long-lived singleton services owning protocol state machines, connections, and persistence orchestration. All are `EventEmitter` subclasses with `getInstance()`.
- Location: `src/services/` — `SyncService.ts` (1746 lines, sync engine), `EntitySessionService.ts` (1449 lines, chat sessions), `ConnectionStateManager.ts` (persisted sync watermarks), `AudioPlayer.ts`, `AudioRecorder.ts`, `BiometricLockService.ts`, `CharacterCardImportService.ts`, `ChatPreferencesService.ts`, `EmojiService.ts`, `EntityEmojiActionService.ts`, `SyncService.ts`; subfolders `auth/`, `cloud/`, `connection/`, `websocket/`.
- Contains: `src/services/auth/AuthService.ts` (PASETO lifecycle), `src/services/cloud/CloudSessionService.ts`, `src/services/cloud/soulbitsClient.ts` (Soulbits API client factory), `src/services/connection/ConnectionManager.ts`, `src/services/websocket/*` (connection implementations).
- Depends on: `src/database/`, `src/config/cloud.ts`, `src/utils/logger.ts`, `eventemitter3`.
- Used by: contexts (which re-expose events to components) and directly by screens.

**Data Access (Database):**
- Purpose: SQLite connection management, schema migrations, repository functions.
- Location: `src/database/` — `connection.ts`, `index.ts` (barrel), `migrations.ts`, `models.ts` (613 lines of TypeScript interfaces matching Go structs), `sync.ts` (chunked serialization helpers), `transaction.ts`, `types.ts`, `reactNativeDatabase.ts` (adapter), `base64.ts`; `migrations/` (34 numbered SQL files), `repositories/` (per-table modules: `entities.ts`, `characters.ts`, `modules.ts`, `conversation_messages.ts`, `interactions.ts`, `memories.ts`, `emoji_actions.ts`, `emotion_state.ts`, `sync.ts`; `providers/` has 16 per-provider config repositories).
- Contains: `initializeDatabase`, `getDatabase`, `getSyncDatabase` (secondary connection for sync writes), `clearDatabaseData`, `wipeDatabaseCompletely`.
- Depends on: `react-native-sqlite-storage`, `react-native-fs`, `react-native-keychain`.
- Used by: services, contexts, screens (via repository imports).

**Configuration & Constants:**
- Purpose: Environment/host resolution and static metadata.
- Location: `src/config/cloud.ts` (hosts, OAuth IDs, WS paths, endpoints), `src/constants/` (`soulbitsModels.ts`, `moduleConfiguration.ts`, `moduleDefaults.ts`, `providerFieldSchemas.ts`, `extendedParamMetadata.ts`).
- Depends on: `react-native-config` (env injection from native build), `src/types/react-native-config.d.ts`.

**Theme:**
- Purpose: Custom theme definitions and typing.
- Location: `src/theme/types.ts`, `src/theme/themes/` (9 themes incl. `classicHarmony.ts`, `pureDark.ts`, `soulBitsLight.ts`).
- Used by: `src/contexts/ThemeContext.tsx` → `PaperProvider` in `App.tsx`.

**i18n:**
- Purpose: Localization via i18next.
- Location: `src/i18n/locales/en/*.json` (24 namespaced files), `src/contexts/I18nContext.tsx`.
- Used by: all screens/components via `useTranslation(namespace)`.

## Data Flow

**App Boot:**

1. `index.js` imports `react-native-get-random-values` first (uuid polyfill), registers `App` via `AppRegistry`.
2. `App.tsx` renders the provider tree: `ErrorBoundary` → `SafeAreaProvider` → `ThemeProvider` → `I18nProvider` → `DatabaseProvider` → `AuthProvider` → `AppAlertProvider` → `SyncConnectionProvider` → `EntitySessionProvider` → `EmojiProvider` → `BiometricLockProvider` → `AppShell`.
3. `DatabaseProvider` (`src/contexts/DatabaseContext.tsx`) calls `initializeDatabase()` (`src/database/connection.ts`) — opens `harmony.db`, applies PRAGMAs (foreign_keys=ON, WAL, synchronous=NORMAL), runs 34 migrations (`src/database/migrations.ts`).
4. `AppShell` blocks on `DatabaseLoadingScreen` until `isReady`, then renders `AppNavigator` behind `DynamicBackground`; shows `InitialPairingModal` on first launch and overlays `LockScreen` when biometric lock is active.
5. `AppNavigator` starts at `MainTabs` (initial tab `Chat`).

**Sync Flow (local ↔ backend):**

1. `SyncService` (`src/services/SyncService.ts`, singleton) drives the sync protocol over a WebSocket managed by `ConnectionManager` (`src/services/connection/ConnectionManager.ts`).
2. `ConnectionManager.createConnection()` builds a `WebSocketConnection` via `WebSocketConnectionFactory` (`src/services/websocket/WebSocketConnectionFactory.ts`) — mode selection: `unencrypted` | `secure` | `insecure-ssl` | `cloud` (map to `UnencryptedWebSocketConnection`, `SecureWebSocketConnection`, `InsecureSSLWebSocketConnection`, `CloudWebSocketConnection`).
3. Incoming server records are buffered (`incomingDataBuffer`) and applied atomically on `SYNC_COMPLETE` using the **secondary** sync connection `getSyncDatabase()` (`src/database/connection.ts`) so UI reads on the main connection are never blocked.
4. Sync writes happen in `src/database/sync.ts` with chunked base64 handling for `character_image.image_data` and `conversation_messages.image_data/audio_data` (1 MB chunks, 2 MB threshold).
5. The sync pipeline can pause for user decisions: name-clash resolution (`src/services/syncNameClash.ts` → `'sync:nameclash'` event) and size-estimate confirmation (`'sync:estimate'` / `'sync:estimate:confirm'`).
6. `ConnectionStateManager` (`src/services/ConnectionStateManager.ts`) persists per-source `last_sync_timestamp` watermarks to AsyncStorage.
7. UI subscribes via `SyncConnectionContext` (`src/contexts/SyncConnectionContext.tsx`), surfaced to screens as `useSyncConnection()` (e.g. `canUseChat`, `connectionStatus` in `src/screens/ChatListScreen.tsx`).

**Chat / Entity Session Flow:**

1. `EntitySessionService` (`src/services/EntitySessionService.ts`, singleton) opens one WebSocket per participant (`entity-{entityId}`) through `ConnectionManager`; dual-participant chats create two concurrent connections (URLs uniquified by `makeUrlUnique`).
2. `INIT_ENTITY` handshake establishes `EntitySession`s; an `InteractionSession` is created locally via `createInteraction` (`src/database/repositories/interactions.ts`) and persisted on first message.
3. Messages are stored through `src/database/repositories/conversation_messages.ts`; audio playback/recording via `src/services/AudioPlayer.ts` / `AudioRecorder.ts`; transcriptions time out and are reconciled (`pendingTranscriptions`).
4. `ChatDetailScreen` reads messages from the repository; `ChatListScreen` derives the conversation list from `interactions` + `conversation_messages` repositories.

**Cloud Auth & Session Flow:**

1. `AuthService` (`src/services/auth/AuthService.ts`, singleton) manages the cloud **PASETO + refresh-token** pair in Keychain (service `com.harmonyai.cloud.auth`), emits `auth:changed` / `auth:expired`. It is deliberately the only token owner — the Soulbits API client is built in PASETO-only mode (no refresh) to avoid in-memory/client refresh desync.
2. `src/services/auth/authFetch.ts` provides typed fetch wrappers; OAuth via `src/services/auth/googleSignIn.ts` (Google) and `src/services/auth/appleSignIn.ts` (Apple), with `src/services/auth/tokenStorage.ts` for Keychain persistence.
3. `CloudSessionService` (`src/services/cloud/CloudSessionService.ts`) brokers cloud session connect/disconnect via `buildSoulbitsClient()` (`src/services/cloud/soulbitsClient.ts`) against the session-broker host (`CLOUD_HOSTS.session`), then the conduct-proxy WebSocket (`WS_PATHS.sync`) carries the sync protocol.
4. All hosts/OAuth IDs resolved in `src/config/cloud.ts` from `react-native-config` values injected by `scripts/oauth-secrets.cjs` (build flavor dev/prod).

**State Management:**
- No Redux/Zustand/MobX. State lives in: React Context (UI-facing state per provider), EventEmitter singletons (protocol/service state), SQLite (persistence), AsyncStorage (watermarks, flags, JWT for self-hosted HL path), Keychain (cloud tokens, DB encryption key).
- `react-native-logs` (`src/utils/logger.ts`, `createLogger('[Tag]')`) is the logging convention used by every layer.

## Key Abstractions

**Database adapter interface:**
- Purpose: Abstract SQLite so the same code runs on-device (react-native-sqlite-storage) and in Node tests (better-sqlite3).
- Examples: interface in `src/database/types.ts`, device impl `src/database/reactNativeDatabase.ts`, node/test impl `src/database/__test_utils__/nodeDatabase.ts`.
- Pattern: Repository functions receive/use the `Database` interface from `getDatabase()` / `getSyncDatabase()`.

**WebSocketConnection hierarchy:**
- Purpose: Uniform connection contract with mode-specific TLS/cloud behaviors.
- Examples: interface `src/services/websocket/WebSocketConnection.ts`; impls `UnencryptedWebSocketConnection.ts`, `SecureWebSocketConnection.ts`, `InsecureSSLWebSocketConnection.ts`, `CloudWebSocketConnection.ts`; created via `WebSocketConnectionFactory.ts`.
- Pattern: Abstract Factory keyed on `ConnectionMode` (`'unencrypted' | 'secure' | 'insecure-ssl' | 'cloud'`).

**Singleton EventEmitter services:**
- Purpose: Long-lived, app-wide service instances with typed event contracts.
- Examples: `SyncService`, `EntitySessionService`, `AuthService`, `CloudSessionService`, `ConnectionManager`, `ConnectionStateManager` — all `class X extends EventEmitter<XEvents>` with `private constructor()` + `static getInstance()`.
- Pattern: Consumers subscribe to typed event interfaces; contexts bridge events to React state.

**Per-table repositories:**
- Purpose: All SQL lives in repository modules; screens/services never write raw SQL in production code.
- Examples: `src/database/repositories/entities.ts`, `characters.ts`, `interactions.ts`, `conversation_messages.ts`, `modules.ts`, `memories.ts`, `emoji_actions.ts`, `emotion_state.ts`, `sync.ts`.
- Pattern: Plain exported async functions (`getAllEntities()`, `createInteraction(...)`), selected from barrel `src/database/index.ts`.

**Per-provider config repositories:**
- Purpose: Isolated config persistence for each backend provider.
- Examples: 16 files in `src/database/repositories/providers/` (e.g. `OpenAIProviderConfigRepository.ts`, `SoulbitsCloudProviderConfigRepository.ts`, `AnthropicProviderConfigRepository.ts`) plus `shared.ts`.
- Pattern: One repository file per provider, re-exported from `src/database/index.ts`.

**Versioned migrations:**
- Purpose: Forward-only schema evolution with a schema dump for parity checks.
- Examples: `src/database/migrations/000001_initial_schema.ts` … `000034_add_unique_name_constraint_vision_imagination.ts`, orchestrated by `src/database/migrations.ts`; dump tool `scripts/dump-schema.ts` + comparison `scripts/compare-schemas.py` against `schema/rn-schema.json`.

## Entry Points

**index.js:**
- Location: `index.js`
- Triggers: Native app launch (`AppRegistry.registerComponent`).
- Responsibilities: Install `crypto.getRandomValues` polyfill first, register root component.

**App.tsx:**
- Location: `App.tsx`
- Triggers: Registered by `index.js`.
- Responsibilities: Compose provider tree; `AppShell` gates rendering on DB readiness, shows pairing modal / lock screen overlays, renders background + navigator inside `PaperProvider`.

**AppNavigator:**
- Location: `src/navigation/AppNavigator.tsx`
- Triggers: Mounted by `AppShell`.
- Responsibilities: Define root stack (`RootStackParamList`), transparent nav theme, register `MainTabs` + ~25 pushed routes (ChatDetail, settings subpages, auth, setup, dev-only `DatabaseTableViewer` behind `__DEV__`).

**MainTabNavigator:**
- Location: `src/navigation/MainTabNavigator.tsx`
- Triggers: `MainTabs` stack route.
- Responsibilities: 5-tab layout (Discover, Search, Chat, Characters, Settings) with custom `GlassTabBar` and center-anchored Chat default.

**Native entry points:**
- Android: `android/app/src/main/java/ai/soulbits/chat/MainActivity.kt` + `MainApplication.kt` (package `ai.soulbits.chat`).
- iOS: `ios/HarmonyAIChat/AppDelegate.swift` (standard RN bootstrap), `ios/HarmonyAIChat/Info.plist`, Google/Apple OAuth plists (`GoogleService-Info.plist`, `GoogleService-Info-Dev.plist`).

## Error Handling

**Strategy:** Layered — render-level guard via ErrorBoundary; service-level typed errors; per-call try/catch with structured logging.

**Patterns:**
- `src/components/ErrorBoundary.tsx` wraps the whole app (catches render errors in the provider/screen tree).
- Typed error classes with actionable metadata: `AuthError` (carries `status` number for screen branching) and `AuthExpiredError` in `src/services/auth/AuthService.ts`.
- Database failures: `openDatabase` deletes a corrupt DB file and retries (`src/database/connection.ts`); `clearDatabaseData`/`wipeDatabaseCompletely` are test/recovery paths.
- Connection errors propagate through `ConnectionManager` events (`connection:error`, `cert:verification_failed`) surfaced by `SyncConnectionContext`.
- Fallback values over crashes: e.g. `normalizeTimestampForSync` returns current time on parse failure (`src/database/sync.ts`).
- Logging everywhere via `createLogger('[Tag]')` (`src/utils/logger.ts`).

## Cross-Cutting Concerns

**Logging:** `react-native-logs` through `createLogger('[Tag]')` in `src/utils/logger.ts`; every module creates its own tagged logger (`[Database]`, `[SyncService]`, `[EntitySessionService]`, ...).

**Validation:** Lightweight — mostly manual parameter checks (e.g. `ConnectionManager.createConnection` requires `entityId` for entity connections); config schemas driven by constants (`src/constants/providerFieldSchemas.ts`, `src/constants/soulbitsModels.ts`). No zod/joi.

**Authentication:** Two independent credential paths — cloud PASETO in Keychain (`src/services/auth/AuthService.ts`, tokenStorage) and self-hosted HL `harmony_jwt` in AsyncStorage (referenced in AuthService docs, kept separate by design).

**Theming:** `ThemeContext` → `PaperProvider` (react-native-paper MD3) + custom `Theme` objects (`src/theme/`); `useAppTheme()` returns `theme` with semantic color groups (e.g. `theme.colors.background.base`).

**Localization:** i18next via `I18nContext`; `useTranslation('namespace')` throughout; 24 `en` namespaces in `src/i18n/locales/en/`.

**Security:** DB at rest in app documents dir with encryption-key machinery (SQLCipher not currently linked — `getOrCreateEncryptionKey` is a passthrough, see `src/database/connection.ts`); TLS variants for self-hosted links (`InsecureSSLWebSocketConnection` with cert verification); biometric lock overlay (`src/components/lock/LockScreen.tsx`, `src/services/BiometricLockService.ts`).

---

*Architecture analysis: 2026-08-07*
