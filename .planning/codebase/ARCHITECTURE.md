# Architecture

**Analysis Date:** 2026-03-05

## Pattern Overview

**Overall:** React Native Mobile Application with Context-Based State Management

**Key Characteristics:**
- React Native 0.83.1 with TypeScript
- Context API for state management (ThemeContext, DatabaseContext, SyncConnectionContext, EntitySessionContext)
- SQLite database with repository pattern for data access
- WebSocket-based synchronization with Harmony Link backend
- Component-based UI with react-native-paper for Material Design 3 components

## Layers

**UI Layer:**
- Purpose: Render screens and components, handle user input
- Location: `src/screens/`, `src/components/`
- Contains: React Native screens, UI components, navigation
- Depends on: Context providers, services
- Used by: Navigation system

**Context Layer:**
- Purpose: Provide application-wide state and share data between components
- Location: `src/contexts/`
- Contains: ThemeContext, DatabaseContext, SyncConnectionContext, EntitySessionContext
- Depends on: Services, database
- Used by: UI components, screens

**Service Layer:**
- Purpose: Business logic, external communication, data operations
- Location: `src/services/`
- Contains: SyncService, EntitySessionService, ChatPreferencesService, ConnectionStateManager, Audio services
- Depends on: Database repositories, WebSocket connections
- Used by: Contexts, screens

**Data Layer:**
- Purpose: Database operations, data persistence, migrations
- Location: `src/database/`
- Contains: SQLite connection, migrations, repositories, models
- Depends on: react-native-sqlite-storage
- Used by: Services, contexts

**WebSocket Layer:**
- Purpose: Real-time communication with Harmony Link backend
- Location: `src/services/websocket/`, `src/services/connection/`
- Contains: WebSocket connections (secure, insecure, unencrypted), ConnectionManager
- Depends on: react-native-websocket-self-signed
- Used by: SyncService

## Data Flow

**App Initialization:**

1. `App.tsx` mounts → ThemeProvider initializes theme from AsyncStorage
2. DatabaseProvider initializes SQLite via `src/database/connection.ts`
3. SyncConnectionProvider checks pairing status
4. EntitySessionProvider initializes entity session management
5. Navigation renders based on pairing state

**Chat Flow:**

1. User navigates to ChatDetailScreen via AppNavigator
2. Screen loads messages from `conversation_messages` repository
3. User sends message → stored in local database
4. Message sent via EntitySessionService to backend
5. Response received and displayed in chat bubble

**Sync Flow:**

1. SyncService initiates WebSocket connection via ConnectionManager
2. Handshake performed with paired device
3. Bidirectional data sync via sync tables
4. Changes applied atomically to local database

## Key Abstractions

**Repository Pattern:**
- Purpose: Encapsulate database operations for each entity type
- Examples: `src/database/repositories/characters.ts`, `src/database/repositories/entities.ts`, `src/database/repositories/conversation_messages.ts`
- Pattern: Each repository provides CRUD operations for a specific model

**Context Providers:**
- Purpose: React Context for dependency injection and state sharing
- Examples: `src/contexts/ThemeContext.tsx`, `src/contexts/DatabaseContext.tsx`
- Pattern: Custom hooks (useTheme, useDatabase) for accessing context

**Service Singletons:**
- Purpose: Manage application-wide business logic
- Examples: SyncService (singleton), ConnectionManager (singleton)
- Pattern: EventEmitter-based for async operations

## Entry Points

**App Entry:**
- Location: `App.tsx`
- Triggers: React Native app launch
- Responsibilities: Initialize all providers, show loading screen, handle first-launch pairing modal

**Navigation Entry:**
- Location: `src/navigation/AppNavigator.tsx`
- Triggers: App ready state
- Responsibilities: Stack navigation, route definitions, screen composition

**Database Entry:**
- Location: `src/database/index.ts`
- Triggers: DatabaseProvider initialization
- Responsibilities: Export all database functionality, migrations, repositories

## Error Handling

**Strategy:** Try-catch with logging, user-facing error states

**Patterns:**
- Service methods throw errors with descriptive messages
- Screens catch errors and display Alert/Toast messages
- Database operations wrapped in transactions with rollback
- WebSocket errors trigger reconnection attempts

## Cross-Cutting Concerns

**Logging:** Custom logger via `src/utils/logger.ts` using react-native-logs

**Validation:** Not centralized - validation logic embedded in services and repositories

**Authentication:** Device pairing via WebSocket, stored in AsyncStorage

**Theme:** Centralized in ThemeContext with support for multiple themes (classicHarmony, forestNight, midnightRose, oceanBreeze, pureDark, sunsetGlow)

---

*Architecture analysis: 2026-03-05*
