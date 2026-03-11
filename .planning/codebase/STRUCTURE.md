# Codebase Structure

**Analysis Date:** 2026-03-05

## Directory Layout

```
harmony-ai-app/
├── App.tsx                    # Root component, app entry point
├── index.js                   # React Native entry
├── package.json               # Dependencies and scripts
├── jest.config.js             # Test configuration
├── src/
│   ├── components/            # Reusable UI components
│   ├── contexts/              # React Context providers
│   ├── database/              # SQLite database layer
│   ├── navigation/            # Navigation configuration
│   ├── screens/               # Screen components
│   ├── services/              # Business logic services
│   ├── theme/                 # Theme system
│   ├── types/                 # TypeScript type definitions
│   └── utils/                 # Utility functions
├── __tests__/                 # Test files
├── android/                   # Android native code
├── ios/                       # iOS native code
├── design/                    # Design documents
├── docs/                      # Documentation
└── memory-bank/               # Project memory/context
```

## Directory Purposes

**src/components:**
- Purpose: Reusable UI components
- Contains: Chat components, modals, themed components, settings components
- Key files: `chat/ChatBubble.tsx`, `chat/ChatInput.tsx`, `themed/ThemedButton.tsx`, `modals/InitialPairingModal.tsx`

**src/contexts:**
- Purpose: React Context providers for state management
- Contains: ThemeContext, DatabaseContext, SyncConnectionContext, EntitySessionContext
- Key files: `ThemeContext.tsx`, `DatabaseContext.tsx`, `SyncConnectionContext.tsx`, `EntitySessionContext.tsx`

**src/database:**
- Purpose: SQLite database layer with migrations and repositories
- Contains: Connection management, migrations, models, repositories, sync utilities
- Key files: `index.ts`, `connection.ts`, `migrations.ts`, `models.ts`, `repositories/`

**src/navigation:**
- Purpose: React Navigation configuration
- Contains: AppNavigator, BottomNavigator
- Key files: `AppNavigator.tsx`, `BottomNavigator.tsx`

**src/screens:**
- Purpose: Screen components (full-page views)
- Contains: Chat screens, settings screens, setup screens, development screens
- Key files: `ChatDetailScreen.tsx`, `ChatListScreen.tsx`, `CharactersScreen.tsx`, `settings/ThemeSettingsScreen.tsx`

**src/services:**
- Purpose: Business logic and external communication
- Contains: SyncService, EntitySessionService, AudioPlayer, AudioRecorder, WebSocket connections
- Key files: `SyncService.ts`, `EntitySessionService.ts`, `connection/ConnectionManager.ts`, `websocket/`

**src/theme:**
- Purpose: Theme system with multiple theme presets
- Contains: Theme types, theme definitions
- Key files: `types.ts`, `themes/index.ts`, `themes/classicHarmony.ts`, `themes/pureDark.ts`

**src/types:**
- Purpose: Additional TypeScript type definitions
- Contains: Type declarations for external libraries

**src/utils:**
- Purpose: Utility functions
- Contains: Logger utility

## Key File Locations

**Entry Points:**
- `App.tsx`: Root React component, initializes all providers
- `index.js`: React Native app registration

**Configuration:**
- `package.json`: Dependencies, scripts
- `jest.config.js`: Test configuration
- `babel.config.js`: Babel configuration
- `metro.config.js`: Metro bundler configuration

**Core Logic:**
- `src/database/index.ts`: Database layer exports
- `src/services/SyncService.ts`: Sync logic (802 lines)
- `src/screens/ChatDetailScreen.tsx`: Chat screen (820 lines)

**Testing:**
- `__tests__/`: Root test files
- `src/database/__tests__/`: Database tests

## Naming Conventions

**Files:**
- PascalCase for components: `ChatBubble.tsx`, `ThemeContext.tsx`
- camelCase for utilities: `connection.ts`, `base64.ts`
- kebab-case for config: `jest.config.js`

**Directories:**
- camelCase: `src/components`, `src/services`, `src/database`
- PascalCase for type definitions: `src/types`

**TypeScript:**
- Interfaces: PascalCase with descriptive names: `ConversationMessage`, `Entity`, `CharacterProfile`
- Types: PascalCase: `ThemeContextType`, `RootStackParamList`

## Where to Add New Code

**New Feature:**
- Primary code: `src/services/` (business logic) or `src/screens/` (UI)
- Tests: `__tests__/` or `src/database/__tests__/`

**New Component/Module:**
- Implementation: `src/components/` for UI, `src/services/` for logic
- Context: `src/contexts/` if global state needed

**New Database Table:**
- Model: `src/database/models.ts`
- Repository: `src/database/repositories/`
- Migration: `src/database/migrations/`

**New Theme:**
- Implementation: `src/theme/themes/`
- Export: `src/theme/themes/index.ts`

**Utilities:**
- Shared helpers: `src/utils/`

## Special Directories

**src/database/migrations:**
- Purpose: Database schema migrations
- Generated: No (manually created)
- Committed: Yes
- Pattern: Sequential numbering (000001, 000002, etc.)

**src/database/repositories:**
- Purpose: Data access layer
- Generated: No
- Committed: Yes
- Pattern: One file per entity type

**android/, ios/:**
- Purpose: Native platform code
- Generated: Partially (from React Native CLI)
- Committed: Yes
- Contains: MainActivity, MainApplication, build configs

**__tests__/:**
- Purpose: Test files
- Generated: No
- Committed: Yes

---

*Structure analysis: 2026-03-05*
