# Architecture

**Analysis Date:** 2026-05-24

## Pattern Overview

**Overall:** React Native Mobile Application with Context-Based State Management

**Key Characteristics:**
- React Native 0.83.1 with TypeScript
- Context API for state management (ThemeContext, DatabaseContext, SyncConnectionContext, EntitySessionContext, EmojiContext)
- SQLite database with repository pattern for data access
- WebSocket-based synchronization with Harmony Link backend
- Component-based UI with react-native-paper for Material Design 3 components
- Interaction Session model for chat management (private/group/world scopes)

## Layers

**UI Layer:**
- Purpose: Render screens and components, handle user input
- Location: `src/screens/`, `src/components/`
- Contains: React Native screens, UI components, navigation, themed wrappers
- Depends on: Context providers, services
- Used by: Navigation system

**Context Layer:**
- Purpose: Provide application-wide state and share data between components
- Location: `src/contexts/`
- Contains: ThemeContext, DatabaseContext, SyncConnectionContext, EntitySessionContext, EmojiContext
- Depends on: Services, database
- Used by: UI components, screens

**Service Layer:**
- Purpose: Business logic, external communication, data operations
- Location: `src/services/`
- Contains: SyncService, EntitySessionService, ChatPreferencesService, ConnectionStateManager, EmojiService, EntityEmojiActionService, AudioPlayer, AudioRecorder
- Depends on: Database repositories, WebSocket connections
- Used by: Contexts, screens

**Data Layer:**
- Purpose: Database operations, data persistence, migrations
- Location: `src/database/`
- Contains: SQLite connection, migrations, repositories, models, transaction helpers, sync utilities
- Depends on: react-native-sqlite-storage
- Used by: Services, contexts

**WebSocket Layer:**
- Purpose: Real-time communication with Harmony Link backend
- Location: `src/services/websocket/`, `src/services/connection/`
- Contains: WebSocket connections (secure, insecure, unencrypted), ConnectionManager, WebSocketConnectionFactory
- Depends on: react-native-websocket-self-signed
- Used by: SyncService

**Config Layer:**
- Purpose: Module and provider configuration metadata
- Location: `src/constants/`
- Contains: Module type definitions, provider field schemas, default configurations, extended parameter metadata
- Used by: ModuleConfigEditScreen, EntityConfigEditScreen, EntityModuleSelector

**Emoji/Asset Layer:**
- Purpose: Emoji sprite rendering and data management
- Location: `src/assets/emoji/`, `src/services/EmojiService.ts`, `src/components/emoji/`, `src/types/emoji.ts`
- Contains: Sprite sheet PNGs (google-64.png, twitter-64.png), EmojiService singleton, emoji UI components, type definitions
- Depends on: @emoji-mart/data, emoji-datasource-twitter, emoji-regex

## Data Flow

**App Initialization:**
1. `App.tsx` mounts → ThemeProvider initializes theme from AsyncStorage
2. DatabaseProvider initializes SQLite via `src/database/connection.ts`
3. SyncConnectionProvider checks pairing status
4. EntitySessionProvider initializes entity session management
5. EmojiProvider initializes emoji preferences and EmojiService
6. Navigation renders based on pairing state (shows LandingScreen unless redirected)

**Chat Flow:**
1. User navigates to ChatDetailScreen via AppNavigator with interactionId and participant params
2. Screen loads messages from `conversation_messages` repository scoped to the interaction
3. User sends message → stored in local database with interaction_id
4. Emoji actions resolved via EntityEmojiActionService (substitutions + emotion effects)
5. Message sent via EntitySessionService to backend
6. Response received and displayed in chat bubble
7. Unread tracking via ChatPreferencesService (last-read timestamps per partner)

**Sync Flow:**
1. SyncService initiates WebSocket connection via ConnectionManager
2. Handshake performed with paired device
3. Bidirectional data sync via sync tables
4. Changes applied atomically to local database
5. Recon tracking identifies stale/corrupted records

**Entity & Character Management Flow:**
1. User creates entity via CreateAIScreen or EntityConfigEditScreen
2. Character profile linked to entity via CharacterProfileEditScreen
3. Module mappings assigned via EntityModuleSelector (backend, cognition, imagination, movement, etc.)
4. Provider configurations managed via ModuleConfigEditScreen with field schemas from `src/constants/`
5. Emoji actions seeded via EntityEmojiActionService.defaults()

**Emoji Resolution Flow:**
1. User types emoji in ChatDetailScreen
2. EntityEmojiActionService.resolveMessageActions() splits text via EmojiService.splitTextOnEmojis()
3. Each emoji looked up in per-entity action map (cached in-memory)
4. Substitution text replaces emoji, emotion effects aggregated with clamping
5. Effects sent alongside utterance to backend

## Key Abstractions

**Repository Pattern:**
- Purpose: Encapsulate database operations for each entity type
- Examples: `src/database/repositories/characters.ts`, `src/database/repositories/entities.ts`, `src/database/repositories/conversation_messages.ts`, `src/database/repositories/interactions.ts`, `src/database/repositories/emoji_actions.ts`, `src/database/repositories/modules.ts`, `src/database/repositories/providers.ts`, `src/database/repositories/memories.ts`, `src/database/repositories/sync.ts`
- Pattern: Each repository provides CRUD operations for a specific model
- Repository-level business logic includes derivation functions (e.g., `deriveScopeFromParticipants()` in interactions)

**Context Providers:**
- Purpose: React Context for dependency injection and state sharing
- Examples: `src/contexts/ThemeContext.tsx`, `src/contexts/DatabaseContext.tsx`, `src/contexts/EmojiContext.tsx`
- Pattern: Custom hooks (useTheme, useAppTheme, useDatabase, useSyncConnection, useEntitySession, useEmoji) for accessing context
- Provider hierarchy: SafeAreaProvider → ThemeProvider → DatabaseProvider → SyncConnectionProvider → EntitySessionProvider → EmojiProvider

**Service Singletons:**
- Purpose: Manage application-wide business logic
- Examples: SyncService (singleton), ConnectionManager (singleton), EmojiService (singleton), EntityEmojiActionService (singleton)
- Pattern: EventEmitter-based for async operations, in-memory caching for performance

**Transaction Helpers:**
- Location: `src/database/transaction.ts`
- `withTransaction<T>(db, fn)` - Wraps operations in atomic transactions with auto-rollback
- `execInTransaction(db, sql, params)` - Simple single-statement transaction wrapper

**Config Schema System:**
- Location: `src/constants/`
- Module types defined with provider options and field definitions
- Provider field schemas define form rendering metadata
- Extended param metadata for LLM sampling parameters (top_k, min_p, etc.)

## Interaction Session Model

**Purpose:** Replace simple entity-pair chat with session-based interactions supporting private, group, and world scopes.

**Scope Derivation:**
- 0 or 1 participants → `world`
- 2 participants → `private`
- 3+ participants → `group`

**Participant Key:**
- private: sorted pair of entity IDs joined by `+`
- group: all sorted participant IDs joined by `+`
- world: empty string

**Key files:** `src/database/repositories/interactions.ts`, `src/database/models.ts` (Interaction interface)

## Entry Points

**App Entry:**
- Location: `App.tsx`
- Triggers: React Native app launch
- Responsibilities: Initialize all providers (Theme, Database, SyncConnection, EntitySession, Emoji), show loading screen, handle first-launch pairing modal

**Navigation Entry:**
- Location: `src/navigation/AppNavigator.tsx`
- Triggers: App ready state
- Responsibilities: Native stack navigation, route definitions (18 screens), screen composition
- Initial route: Landing (not ChatList as in earlier versions)

**Database Entry:**
- Location: `src/database/index.ts`
- Triggers: DatabaseProvider initialization
- Responsibilities: Export all database functionality, migrations, repositories, transaction helpers

## Error Handling

**Strategy:** Try-catch with logging, user-facing error states

**Patterns:**
- Service methods throw errors with descriptive messages
- Screens catch errors and display Alert/Toast messages
- Database operations wrapped in transactions with rollback via `withTransaction()`
- WebSocket errors trigger reconnection attempts
- Emoji service initialization errors logged and surfaced to user

## Cross-Cutting Concerns

**Logging:** Custom logger via `src/utils/logger.ts` using react-native-logs with per-module prefixes (e.g., `[EmojiService]`, `[EntityEmojiActionService]`)

**Validation:** Not centralized - validation logic embedded in services and repositories

**Authentication:** Device pairing via WebSocket, stored in AsyncStorage

**Theme:** Centralized in ThemeContext with support for 9 themes (classicHarmony, forestNight, midnightRose, oceanBreeze, pureDark, sunsetGlow, soulBitsDark, soulBitsLight). Themed component wrappers in `src/components/themed/` (ThemedView, ThemedText, ThemedButton, ThemedCard, ThemedAppbar, ThemedGradient, SectionHeader)

---

*Architecture analysis: 2026-05-24*
