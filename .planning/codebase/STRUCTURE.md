# Codebase Structure

**Analysis Date:** 2026-05-24

## Directory Layout

```
harmony-ai-app/
├── App.tsx                    # Root component, app entry point
├── index.js                   # React Native entry
├── package.json               # Dependencies and scripts (React Native 0.83.1)
├── jest.config.js             # Test configuration
├── src/
│   ├── assets/                # Static assets (emoji sprite sheets)
│   ├── components/            # Reusable UI components (12 subdirectories)
│   ├── constants/             # Module/provider config schemas and defaults
│   ├── contexts/              # React Context providers (5 contexts)
│   ├── database/              # SQLite database layer (28 migrations, 10 repositories)
│   ├── navigation/            # Navigation configuration (native stack)
│   ├── screens/               # Screen components (14 screens, 4 subdirectories)
│   ├── services/              # Business logic services (8 services, 2 subdirectories)
│   ├── theme/                 # Theme system (9 themes)
│   ├── types/                 # TypeScript type definitions
│   └── utils/                 # Utility functions (5 files)
├── __tests__/                 # Root test files
├── android/                   # Android native code
├── ios/                       # iOS native code
├── design/                    # Design documents
├── docs/                      # Documentation
└── memory-bank/               # Project memory/context
```

## Directory Purposes

**src/assets:**
- Purpose: Static asset files bundled with the app
- Contains: Emoji sprite sheets
- Key files: `emoji/sheets/google-64.png`, `emoji/sheets/twitter-64.png`

**src/components:**
- Purpose: Reusable UI components organized by domain
- Contains:
  - `characters/`: `CharacterProfileCard.tsx`, `ProfileImagePicker.tsx`
  - `chat/`: `ChatBubble.tsx`, `ChatInput.tsx`, `EmojiActionInput.tsx`, `NewMessagesDivider.tsx`, `TypingIndicator.tsx`
  - `common/`: Empty (reserved for shared components)
  - `config/`: `AdvancedSamplingParams.tsx`, `FormField.tsx`
  - `database/`: `DatabaseLoadingScreen.tsx`
  - `emoji/`: 11 files including `EmojiPickerInline.tsx`, `EmojiPickerModal.tsx`, `EmojiGrid.tsx`, `EmojiSearchBar.tsx`, `EmojiAutocomplete.tsx`, `index.ts`
  - `entities/`: `EntityCard.tsx`, `EntityModuleSelector.tsx`, `EntityModuleSelectorWithActions.tsx`
  - `landing/`: `LandingCard.tsx`
  - `modals/`: `InitialPairingModal.tsx`, `CertificateDetailsModal.tsx`, `CertificateVerificationModal.tsx`, `ImageViewerModal.tsx`, `ImpersonationSelectorModal.tsx`, `InfoModal.tsx`
  - `navigation/`: `SettingsMenu.tsx`
  - `settings/`: `ConnectionStatusBadge.tsx`, `EmojiActionCard.tsx`, `EmojiActionEditModal.tsx`, `EmojiStyleCard.tsx`, `ThemeCard.tsx`
  - `themed/`: `ThemedAppbar.tsx`, `ThemedButton.tsx`, `ThemedCard.tsx`, `ThemedGradient.tsx`, `ThemedText.tsx`, `ThemedView.tsx`, `SectionHeader.tsx`

**src/constants:**
- Purpose: Configuration schemas and metadata for module/provider config system
- Contains: Module type definitions, provider field schemas, default values, extended parameter metadata
- Key files:
  - `moduleConfiguration.ts`: ModuleTypeConfig definitions (backend, cognition, movement, rag, stt, tts, vision, imagination)
  - `providerFieldSchemas.ts`: Field definition types and schemas
  - `moduleDefaults.ts`: Default configuration values
  - `extendedParamMetadata.ts`: LLM sampling parameter metadata

**src/contexts:**
- Purpose: React Context providers for state management
- Contains: 5 context providers
- Key files:
  - `ThemeContext.tsx`: Theme selection, custom theme editing
  - `DatabaseContext.tsx`: SQLite initialization, DB ready state
  - `SyncConnectionContext.tsx`: Pairing/connection state
  - `EntitySessionContext.tsx`: Entity session management
  - `EmojiContext.tsx`: Emoji style preferences, recent emojis, skin tone

**src/database:**
- Purpose: SQLite database layer with migrations and repositories
- Contains: Connection management, 28 migrations, 10 repositories, models, sync utilities, transaction helpers, test files
- Key files:
  - `index.ts`: Layer exports
  - `connection.ts`: Database initialization and connection management
  - `migrations.ts`: Migration runner (applies all 28 migrations)
  - `models.ts`: All TypeScript interfaces matching Go structs (519 lines)
  - `sync.ts`: Sync/replication utilities
  - `transaction.ts`: `withTransaction()` and `execInTransaction()` helpers
  - `base64.ts`: Base64 encoding utilities for images
  - `repositories/`: `characters.ts`, `entities.ts`, `conversation_messages.ts`, `interactions.ts`, `emotion_state.ts`, `emoji_actions.ts`, `memories.ts`, `modules.ts`, `providers.ts`, `sync.ts`
  - `migrations/`: 000001 through 000028, covering initial schema, character cards, chat images, provider configs, emotion state, memories, emoji actions, interactions, presence type
  - `__tests__/`: Test files for characters, entities, memories, modules, providers

**src/navigation:**
- Purpose: React Navigation configuration
- Contains: Single native stack navigator with 18 screens
- Key files: `AppNavigator.tsx`

**src/screens:**
- Purpose: Screen components (full-page views)
- Contains: 14 screen files, 4 subdirectories
- Key files:
  - `LandingScreen.tsx`: Main landing page with navigation cards
  - `ChatListScreen.tsx`: Chat list with Interaction-based grouping (now using JOIN queries)
  - `ChatDetailScreen.tsx`: Chat interface with emoji support, message editing (1542 lines)
  - `CharactersScreen.tsx`: Character profile browsing
  - `CharacterProfileEditScreen.tsx`: Character profile editing with image picker
  - `CreateAIScreen.tsx`: AI entity creation wizard
  - `EntityConfigScreen.tsx`: Entity management list
  - `EntityConfigEditScreen.tsx`: Entity configuration editing
  - `AIConfigScreen.tsx`: AI configuration
  - `SettingsScreen.tsx`: Main settings with menu navigation
  - `settings/`: `ThemeSettingsScreen.tsx`, `ThemeEditorScreen.tsx`, `EmojiActionEditorScreen.tsx`, `ProfileSettingsScreen.tsx`, `SyncSettingsScreen.tsx`
  - `config/`: `ModuleConfigEditScreen.tsx`
  - `setup/`: `ConnectionSetupScreen.tsx`
  - `development/`: `DatabaseTestScreen.tsx`, `DatabaseTableViewerScreen.tsx` (DEV only)

**src/services:**
- Purpose: Business logic and external communication
- Contains: 8 service files, 2 subdirectories
- Key files:
  - `SyncService.ts`: Sync logic (884 lines) - handles data sync with Harmony Link
  - `EntitySessionService.ts`: Entity session management (1143 lines)
  - `ChatPreferencesService.ts`: Per-chat entity preferences, last-read timestamps, reply modes
  - `EmojiService.ts`: Emoji data singleton (363 lines) - loads emoji-mart and emoji-datasource data, builds sprite maps
  - `EntityEmojiActionService.ts`: Per-entity emoji action mappings (317 lines) - CRUD, cache, message resolution
  - `ConnectionStateManager.ts`: Connection state tracking (314 lines)
  - `AudioPlayer.ts`: Audio playback (200 lines)
  - `AudioRecorder.ts`: Audio recording
  - `connection/`: `ConnectionManager.ts` (345 lines)
  - `websocket/`: `BaseWebSocketConnection.ts`, `SecureWebSocketConnection.ts`, `InsecureSSLWebSocketConnection.ts`, `UnencryptedWebSocketConnection.ts`, `WebSocketConnection.ts`, `WebSocketConnectionFactory.ts`

**src/theme:**
- Purpose: Theme system with multiple theme presets
- Contains: Theme type definitions, 9 themes
- Key files:
  - `types.ts`: Theme type interfaces
  - `themes/index.ts`: Theme registry
  - `themes/`: `classicHarmony.ts`, `forestNight.ts`, `midnightRose.ts`, `oceanBreeze.ts`, `pureDark.ts`, `sunsetGlow.ts`, `soulBitsDark.ts`, `soulBitsLight.ts`

**src/types:**
- Purpose: Additional TypeScript type definitions
- Contains: Emoji type definitions
- Key files: `emoji.ts` (111 lines) - EmojiSet, EmojiEntry, EmotionEffect, ResolvedMessageActions, Ekman8Emotion

**src/utils:**
- Purpose: Utility functions
- Contains: 5 files
- Key files:
  - `logger.ts`: Custom logging via react-native-logs
  - `emojiSprite.ts`: Emoji sprite rendering utilities (sheet dimensions, position calculation)
  - `configHelpers.ts`: Configuration helper functions
  - `permissions.ts`: Permission handling utilities
  - `version.ts`: App version retrieval

## Key File Locations

**Entry Points:**
- `App.tsx`: Root React component, initializes all 5 providers
- `index.js`: React Native app registration

**Configuration:**
- `package.json`: Dependencies and scripts
- `jest.config.js`: Test configuration
- `babel.config.js`: Babel configuration
- `metro.config.js`: Metro bundler configuration
- `tsconfig.json`: TypeScript configuration

**Core Logic:**
- `src/database/index.ts`: Database layer exports
- `src/services/SyncService.ts`: Sync logic (884 lines)
- `src/services/EntitySessionService.ts`: Entity session management (1143 lines)
- `src/screens/ChatDetailScreen.tsx`: Chat screen (1542 lines)
- `src/database/repositories/providers.ts`: Provider repository (2279 lines - largest file)
- `src/database/repositories/modules.ts`: Module repository (1324 lines)

**Testing:**
- `__tests__/`: Root test files
- `src/database/__tests__/`: Database tests (characters, entities, memories, modules, providers)
- `run-db-tests.js`: Database test runner script
- `jest.setup.js`: Jest global setup

## Naming Conventions

**Files:**
- PascalCase for components: `ChatBubble.tsx`, `ThemeContext.tsx`, `EmojiPickerInline.tsx`
- camelCase for utilities: `connection.ts`, `base64.ts`, `emojiSprite.ts`
- kebab-case for config: `jest.config.js`
- snake_case for migrations: `000001_initial_schema.ts`

**Directories:**
- camelCase: `src/components`, `src/services`, `src/database`, `src/screens`
- PascalCase for type definitions: `src/types`
- Domain-based: `src/components/emoji/`, `src/components/themed/`, `src/screens/settings/`

**TypeScript:**
- Interfaces: PascalCase with descriptive names: `ConversationMessage`, `EmojiAction`, `Interaction`, `EmotionEffect`
- Types: PascalCase: `ThemeContextType`, `RootStackParamList`, `EmojiSet`, `Ekman8Emotion`
- Enums: PascalCase const objects: `EKMAN8_EMOTIONS`

## Where to Add New Code

**New Feature:**
- Primary code: `src/services/` (business logic) or `src/screens/` (UI)
- State management: `src/contexts/` if global state needed
- Tests: `src/database/__tests__/` or `__tests__/`

**New Component/Module:**
- UI Component: `src/components/<domain>/` (create new domain dir if needed)
- Themed wrapper: `src/components/themed/`
- Business logic: `src/services/`
- Config metadata: `src/constants/` if schema-related

**New Database Table:**
- Model: `src/database/models.ts` (match Go structs exactly)
- Repository: `src/database/repositories/<name>.ts`
- Migration: `src/database/migrations/` (sequential numbering)
- Migration registration: update `src/database/migrations.ts`

**New Screen:**
- Screen component: `src/screens/<Name>Screen.tsx` or `src/screens/<domain>/<Name>Screen.tsx`
- Route registration: `src/navigation/AppNavigator.tsx` (add to RootStackParamList + Stack.Navigator)

**New Theme:**
- Implementation: `src/theme/themes/<name>.ts`
- Export: `src/theme/themes/index.ts`

**Emoji Feature:**
- Business logic: `src/services/EmojiService.ts` or `src/services/EntityEmojiActionService.ts`
- Types: `src/types/emoji.ts`
- Components: `src/components/emoji/`
- Sprites: `src/assets/emoji/sheets/`

**Utilities:**
- Shared helpers: `src/utils/`

## Special Directories

**src/database/migrations:**
- Purpose: Database schema migrations (28 total, up to 000028)
- Generated: No (manually created)
- Committed: Yes
- Pattern: Sequential numbering (000001, 000002, etc.)
- Latest: `000028_add_presence_type.ts`

**src/database/repositories:**
- Purpose: Data access layer (10 repositories)
- Generated: No
- Committed: Yes
- Pattern: One file per entity type
- Latest additions: `interactions.ts`, `emoji_actions.ts`, `memories.ts`, `modules.ts`, `providers.ts`

**android/, ios/:**
- Purpose: Native platform code
- Generated: Partially (from React Native CLI)
- Committed: Yes
- Contains: MainActivity, MainApplication, build configs

**__tests__/ and src/database/__tests__/:**
- Purpose: Test files
- Generated: No
- Committed: Yes
- Types: Database integration tests (5 test files), test utilities, runner

**src/assets/emoji/:**
- Purpose: Bundled emoji sprite sheets
- Generated: Yes (downloaded from emoji-datasource)
- Committed: Yes (required for offline rendering)
- Contains: `sheets/google-64.png` (13.2MB), `sheets/twitter-64.png` (10.8MB)

---

*Structure analysis: 2026-05-24*
