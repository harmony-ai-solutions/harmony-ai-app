# Harmony AI App — Architecture Report

**Version:** 0.0.1
**Date:** 2026-07-30
**Framework:** React Native 0.86.0
**Language:** TypeScript (strict mode)
**Target:** Android 7.0+ (API 24), iOS (community)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Layer-by-Layer Breakdown](#3-layer-by-layer-breakdown)
4. [Dependency Injection & Context Hierarchy](#4-dependency-injection--context-hierarchy)
5. [Navigation Architecture](#5-navigation-architecture)
6. [Connection Architecture](#6-connection-architecture)
7. [Database Architecture](#7-database-architecture)
8. [Sync Architecture](#8-sync-architecture)
9. [Entity Session & Chat Architecture](#9-entity-session--chat-architecture)
10. [Authentication Architecture](#10-authentication-architecture)
11. [Cloud Session Architecture](#11-cloud-session-architecture)
12. [Provider & Module Configuration Architecture](#12-provider--module-configuration-architecture)
13. [Emoji Action System Architecture](#13-emoji-action-system-architecture)
14. [Atmospheric Background Architecture](#14-atmospheric-background-architecture)
15. [Testing Architecture](#15-testing-architecture)
16. [Build & CI Architecture](#16-build--ci-architecture)
17. [Third-Party Dependencies](#17-third-party-dependencies)
18. [Key Architectural Decisions](#18-key-architectural-decisions)
19. [Architecture Decision Records](#19-architecture-decision-records)
20. [Known Technical Debt & Future Work](#20-known-technical-debt--future-work)

---

## 1. Executive Summary

The Harmony AI App is a React Native mobile application that serves as the mobile frontend for the Harmony Link AI character ecosystem. It implements a **three-tier architecture** (Presentation → Business Logic → Data) with event-driven WebSocket communication, SQLite local persistence with full schema parity to Harmony Link, and two connection modes (self-hosted and cloud).

**Key architectural characteristics:**
- **Event-driven WebSocket communication**: Real-time bidirectional chat, sync, and state updates via typed EventEmitter3 events
- **Multi-connection WebSocket pool**: Up to N+1 concurrent connections (1 sync + N per-entity sessions) managed by [`ConnectionManager`](../src/services/connection/ConnectionManager.ts)
- **Schema-mirrored SQLite database**: 32 forward-only migrations maintaining 100% compatibility with Harmony Link's PostgreSQL schema
- **Provider-agnostic module configuration**: 15 AI provider types managed through a schema-driven config system
- **Glassmorphism rendering pipeline**: Persistent atmospheric background layer with translucent UI components
- **Dual-backend model**: Self-hosted (Harmony Link via JWT handshake) or Cloud (Soulbits via PASETO)

---

## 2. High-Level Architecture

### 2.1 Three-Tier Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                    PRESENTATION LAYER                            │
│  ┌──────────┐  ┌───────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ Screens  │  │ Navigation│  │ Components   │  │ Modals    │ │
│  │ (28)     │  │ (Stack+Tab)│ │ (50+)        │  │ (7)       │ │
│  └──────────┘  └───────────┘  └──────────────┘  └───────────┘ │
├─────────────────────────────────────────────────────────────────┤
│                    BUSINESS LOGIC LAYER                          │
│  ┌──────────┐  ┌───────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ Contexts │  │ Services  │  │ WebSocket    │  │ Cloud     │ │
│  │ (10)     │  │ (12)      │  │ Connections  │  │ Session   │ │
│  └──────────┘  └───────────┘  └──────────────┘  └───────────┘ │
├─────────────────────────────────────────────────────────────────┤
│                    DATA LAYER                                    │
│  ┌──────────┐  ┌───────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ SQLite   │  │ Repos     │  │ Migrations   │  │ Keychain  │ │
│  │ (SQLCipher)│ │ (11)      │  │ (32)         │  │ AsyncStor │ │
│  └──────────┘  └───────────┘  └──────────────┘  └───────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow Diagram

```
User Action → Screen → Context → Service → WebSocket/HTTP → Harmony Link / Soulbits Cloud
                                ↓
                           Repository → SQLite
                                ↓
                           Context (state update) → Screen (re-render)
```

### 2.3 Key Architectural Patterns

| Pattern | Usage |
|---------|-------|
| **Context API + Hooks** | Global state management (theme, auth, database, sync, emoji, i18n) |
| **Service Layer** | Centralized API interaction (SyncService, EntitySessionService, AuthService, CloudSessionService) |
| **Repository Pattern** | Database abstraction (11 repositories, one per entity type) |
| **Factory Pattern** | WebSocket connection creation by security mode |
| **Observer/EventEmitter** | Real-time event routing via EventEmitter3 |
| **Singleton** | AudioPlayer, ConnectionManager (single instance per app lifecycle) |
| **State Machine** | Cloud session provisioning (idle → requesting → provisioning → ready → failed) |
| **Optimistic Updates** | UI updates before sync confirmation, conflict resolution |
| **Forward-Only Migrations** | Database schema evolution, never rollback |
| **Schema-Driven Forms** | Provider configuration forms generated from schema definitions |

---

## 3. Layer-by-Layer Breakdown

### 3.1 Presentation Layer

#### 3.1.1 Screens (`src/screens/`)
28 screen components organized by domain:

```
screens/
├── auth/           (3)  — LoginScreen, RegisterScreen, VerifyPrompt
├── config/         (1)  — ModuleConfigEditScreen
├── development/    (1)  — DatabaseTableViewerScreen (DEV-only)
├── settings/       (7)  — ThemeSettings, ThemeEditor, SyncSettings, etc.
├── setup/          (1)  — ConnectionSetupScreen
├── ChatListScreen.tsx
├── ChatDetailScreen.tsx
├── CharactersScreen.tsx
├── CharacterProfileEditScreen.tsx
├── CreateAIScreen.tsx
├── DiscoverScreen.tsx
├── EntityConfigScreen.tsx
├── EntityConfigEditScreen.tsx
├── LandingScreen.tsx
├── SettingsScreen.tsx
├── AIConfigScreen.tsx
```

#### 3.1.2 Components (`src/components/`)
50+ components organized by domain:

```
components/
├── background/     (9)  — DynamicBackground, Aurora, Geodesic, GradientFlow, NeuralPulse, StardustParticles
├── characters/     (2)  — CharacterProfileCard, ProfileImagePicker
├── chat/           (3)  — ChatBubble, NewMessagesDivider, TypingIndicator
├── cloud/          (3)  — CloudProvisioningCard, StatusPulseDot, __tests__
├── config/         (2)  — AdvancedSamplingParams, FormField
├── database/       (1)  — DatabaseLoadingScreen
├── emoji/          (11) — Full emoji picker ecosystem
├── entities/       (2)  — EntityCard, EntityModuleSelector
├── landing/        (1)  — LandingCard
├── lock/           (2)  — LockScreen, PinSetupModal
├── modals/         (7)  — AppAlert, Certificate, ImageViewer, Impersonation, Info, InitialPairing
├── navigation/     (2)  — GlassTabBar, HeaderMenuButton
├── settings/       (3)  — ConnectionStatusBadge, EmojiStyleCard, ThemeCard
├── sync/           (1)  — SyncProgressVisualizer
└── themed/         (9)  — ThemedView, ThemedText, ThemedButton, ThemedCard, ThemedGradient, etc.
```

#### 3.1.3 Navigation (`src/navigation/`)

| File | Purpose |
|------|---------|
| [`AppNavigator.tsx`](../src/navigation/AppNavigator.tsx) | Root Native Stack with typed params (`RootStackParamList`), transparent theme |
| [`MainTabNavigator.tsx`](../src/navigation/MainTabNavigator.tsx) | 4-tab bottom navigator with GlassTabBar (Settings is a root-stack screen opened from the header hamburger menu) |

### 3.2 Business Logic Layer

#### 3.2.1 Contexts (`src/contexts/`)
10 React Context providers forming the dependency injection backbone:

| Context | File | State Managed | Consumers |
|---------|------|---------------|-----------|
| **ThemeContext** | [`ThemeContext.tsx`](../src/contexts/ThemeContext.tsx) | Active theme, theme mode, available themes, sync status | All themed components |
| **DatabaseContext** | [`DatabaseContext.tsx`](../src/contexts/DatabaseContext.tsx) | Database initialization, loading state, error recovery | All data-accessing components |
| **AuthContext** | [`AuthContext.tsx`](../src/contexts/AuthContext.tsx) | Cloud auth status, user profile, token lifecycle | Cloud-connected screens |
| **SyncConnectionContext** | [`SyncConnectionContext.tsx`](../src/contexts/SyncConnectionContext.tsx) | Sync WS connection, pairing status, connection mode | EntitySessionContext, settings screens |
| **EntitySessionContext** | [`EntitySessionContext.tsx`](../src/contexts/EntitySessionContext.tsx) | Active entity sessions, interaction sessions | ChatDetailScreen, ChatListScreen |
| **EmojiContext** | [`EmojiContext.tsx`](../src/contexts/EmojiContext.tsx) | Emoji set selection, skin tone, style preferences | All emoji components |
| **BiometricLockContext** | [`BiometricLockContext.tsx`](../src/contexts/BiometricLockContext.tsx) | Lock state, PIN/biometric auth | AppShell (lock overlay) |
| **I18nContext** | [`I18nContext.tsx`](../src/contexts/I18nContext.tsx) | i18next instance, locale, namespace loading | All screens |
| **AppAlertContext** | [`AppAlertContext.tsx`](../src/contexts/AppAlertContext.tsx) | Global alert/modal queue | AppAlertModal |
| **ErrorBoundary** | [`ErrorBoundary.tsx`](../src/components/ErrorBoundary.tsx) | React error boundary (not a context, but cross-cutting) | App root |

#### 3.2.2 Services (`src/services/`)

| Service | File | Responsibility |
|---------|------|---------------|
| **SyncService** | [`SyncService.ts`](../src/services/SyncService.ts) | Bidirectional data sync protocol (handshake → SYNC_REQUEST → DATA → COMPLETE → FINALIZE) |
| **EntitySessionService** | [`EntitySessionService.ts`](../src/services/EntitySessionService.ts) | Real-time chat sessions, dual entity session management, InteractionSession lifecycle |
| **ConnectionManager** | [`connection/ConnectionManager.ts`](../src/services/connection/ConnectionManager.ts) | Multi-connection WebSocket pool, event routing |
| **ConnectionStateManager** | [`ConnectionStateManager.ts`](../src/services/ConnectionStateManager.ts) | Pairing state, JWT lifecycle, credential persistence |
| **AuthService** | [`auth/AuthService.ts`](../src/services/auth/AuthService.ts) | Cloud auth (login/register/refresh/logout), 401-retry, PASETO management |
| **CloudSessionService** | [`cloud/CloudSessionService.ts`](../src/services/cloud/CloudSessionService.ts) | Cloud session broker (connect/disconnect/poll), state machine |
| **AudioRecorder** | [`AudioRecorder.ts`](../src/services/AudioRecorder.ts) | Tap-based audio recording with permission handling |
| **AudioPlayer** | [`AudioPlayer.ts`](../src/services/AudioPlayer.ts) | Singleton audio playback via react-native-track-player |
| **EmojiService** | [`EmojiService.ts`](../src/services/EmojiService.ts) | Emoji data loading, search, skin tone variants, sprite caching |
| **EntityEmojiActionService** | [`EntityEmojiActionService.ts`](../src/services/EntityEmojiActionService.ts) | Per-entity emoji action CRUD + message resolution |
| **BiometricLockService** | [`BiometricLockService.ts`](../src/services/BiometricLockService.ts) | PIN/biometric authentication |
| **ChatPreferencesService** | [`ChatPreferencesService.ts`](../src/services/ChatPreferencesService.ts) | Per-chat preferences (reply mode, new message tracking) |

#### 3.2.3 WebSocket Transport (`src/services/websocket/`)

| Class | File | Security Mode |
|-------|------|--------------|
| **BaseWebSocketConnection** | [`BaseWebSocketConnection.ts`](../src/services/websocket/BaseWebSocketConnection.ts) | Abstract base: heartbeat, parsing, lifecycle |
| **SecureWebSocketConnection** | [`SecureWebSocketConnection.ts`](../src/services/websocket/SecureWebSocketConnection.ts) | TLS with certificate validation |
| **InsecureSSLWebSocketConnection** | [`InsecureSSLWebSocketConnection.ts`](../src/services/websocket/InsecureSSLWebSocketConnection.ts) | TLS without validation (self-signed certs) |
| **UnencryptedWebSocketConnection** | [`UnencryptedWebSocketConnection.ts`](../src/services/websocket/UnencryptedWebSocketConnection.ts) | Plain ws:// |
| **CloudWebSocketConnection** | [`CloudWebSocketConnection.ts`](../src/services/websocket/CloudWebSocketConnection.ts) | Cloud mode: PASETO via `Sec-WebSocket-Protocol: Bearer.<paseto>` |
| **WebSocketConnectionFactory** | [`WebSocketConnectionFactory.ts`](../src/services/websocket/WebSocketConnectionFactory.ts) | Factory: mode → connection type |

### 3.3 Data Layer

#### 3.3.1 Database Core (`src/database/`)

| File | Purpose |
|------|---------|
| [`connection.ts`](../src/database/connection.ts) | SQLite connection init, SQLCipher encryption, key management |
| [`migrations.ts`](../src/database/migrations.ts) | Migration runner with DROP COLUMN safety guard |
| [`transaction.ts`](../src/database/transaction.ts) | `withTransaction()` helper + transaction patterns |
| [`types.ts`](../src/database/types.ts) | Database type definitions |
| [`models.ts`](../src/database/models.ts) | Core data model interfaces |
| [`sync.ts`](../src/database/sync.ts) | Sync-related database queries |
| [`base64.ts`](../src/database/base64.ts) | Base64 encoding/decoding utilities |

#### 3.3.2 Repository Layer (`src/database/repositories/`)

11 repositories, one per entity type:

| Repository | File | Tables |
|------------|------|--------|
| **Entity Repository** | [`entities.ts`](../src/database/repositories/entities.ts) | `entities` |
| **Character Repository** | [`characters.ts`](../src/database/repositories/characters.ts) | `characters`, base64 images |
| **Module Repository** | [`modules.ts`](../src/database/repositories/modules.ts) | 8 module config tables |
| **Conversation Messages** | [`conversation_messages.ts`](../src/database/repositories/conversation_messages.ts) | `conversation_messages`, JOIN-based queries |
| **Interaction Repository** | [`interactions.ts`](../src/database/repositories/interactions.ts) | `interactions`, participant key derivation |
| **Emoji Actions** | [`emoji_actions.ts`](../src/database/repositories/emoji_actions.ts) | `emoji_actions`, soft delete |
| **Emotion State** | [`emotion_state.ts`](../src/database/repositories/emotion_state.ts) | `emotion_state` |
| **Memories** | [`memories.ts`](../src/database/repositories/memories.ts) | `memories` |
| **Sync** | [`sync.ts`](../src/database/repositories/sync.ts) | `sync_devices`, `sync_history` |
| **Provider Configs** | [`providers/`](../src/database/repositories/providers/) | 15 provider config tables (one file per provider + shared.ts) |

#### 3.3.3 Migrations (`src/database/migrations/`)

32 forward-only migrations, numbered sequentially:

| Range | Migrations | Domain |
|-------|-----------|--------|
| 001–004 | Foundation | Initial schema, character fields, cognition config |
| 005–006 | Sync Tables | Sync devices/history, primary key fix |
| 007–010 | Chat | Chat messages, images, rename, behavior config |
| 011–018 | Modules & Features | Vision, imagination, emotion state, lifecycle, memories, alias, recon tracking |
| 019–023 | Advanced | Recon tracking, LLM params, sampling presets, emoji actions |
| 024–028 | Interactions | Interactions table, session_id drop, summary, memory, presence |
| 029–032 | Expansion | RAG reindex, provider expansion (xAI/Google/Anthropic), UUID PKs, SoulbitsCloud |

**Safety guard**: Migration runner has `assertMigrationSqlSupported` that blocks `ALTER TABLE ... DROP COLUMN` and `RENAME COLUMN` (unsupported on older Android SQLite, would break schema parity).

---

## 4. Dependency Injection & Context Hierarchy

### 4.1 Provider Nesting Order (from [`App.tsx`](../App.tsx))

```
ErrorBoundary
└─ SafeAreaProvider
   └─ ThemeProvider           ← Theme available to all children
      └─ I18nProvider         ← i18n available to all children
         └─ DatabaseProvider  ← DB available to all children
            └─ AuthProvider   ← Auth state (needs DB for token storage)
               └─ SyncConnectionProvider  ← Sync WS (needs Auth for cloud mode)
                  └─ EntitySessionProvider ← Entity sessions (needs SyncConnection)
                     └─ EmojiProvider     ← Emoji style (needs nothing above)
                        └─ AppAlertProvider ← Global alerts
                           └─ BiometricLockProvider ← Lock overlay
                              └─ AppShell  ← Main UI
```

### 4.2 Dependency Rationale

- **ThemeProvider** is outermost (after ErrorBoundary + SafeArea): All UI needs theme colors
- **DatabaseProvider** comes before Auth/Sync: Credential storage requires database
- **AuthProvider** comes before SyncConnectionProvider: Cloud mode WS needs PASETO from AuthService
- **SyncConnectionProvider** comes before EntitySessionProvider: Entity WS connections need the sync connection lifecycle
- **EmojiProvider** is independent: Only needs React context, no database or service dependencies
- **BiometricLockProvider** is outermost UI layer: Lock screen overlays everything

---

## 5. Navigation Architecture

### 5.1 Navigation Tree

```
NavigationContainer (transparent theme, fade animations)
└── RootStack (Native Stack)
    ├── MainTabs (Bottom Tab Navigator, GlassTabBar)
    │   ├── Discover (DiscoverScreen)
    │   ├── Chat [CENTER, initial] (ChatListScreen)
    │   ├── Characters (CharactersScreen)
    │   └── Settings (SettingsScreen)
    ├── ChatDetail (pushed over tabs, hides tab bar)
    ├── CharacterProfileEdit
    ├── CreateAI
    ├── EntityConfig / EntityConfigEdit
    ├── ModuleConfigEdit
    ├── Login / Register (auth flow)
    ├── ConnectionSetup (pairing/cloud setup)
    ├── SyncSettings / BackgroundSettings
    ├── ThemeSettings / ThemeEditor
    ├── BiometricLockSettings / ProfileSettings
    ├── ComingSoon
    └── DatabaseTableViewer (DEV-only, __DEV__ guard)
```

### 5.2 Navigation Patterns

- **Native Stack**: All routes use `createNativeStackNavigator` for native-feel transitions
- **Transparent content style**: `contentStyle: { backgroundColor: 'transparent' }` lets atmospheric background bleed through all screens
- **Fade transitions**: `animation: 'fade'` for smooth cross-screen transitions
- **Typed params**: Full TypeScript typing on `RootStackParamList` ensures compile-time route safety
- **Bottom tabs hide on push**: Detail screens automatically hide the tab bar via native stack behavior
- **Modal routes**: Auth screens (Login, Register) are full-screen pushes, not modals — consistent navigation feel

---

## 6. Connection Architecture

### 6.1 Connection Modes

The app supports two backend connection modes:

| Mode | Transport | Auth | URL | Use Case |
|------|-----------|------|-----|----------|
| **Self-hosted** | `ws://` or `wss://` | JWT (Harmony Link handshake) | User-configured IP:port | Privacy-focused, user-owned backend |
| **Cloud** | `wss://` (TLS) | PASETO (`Sec-WebSocket-Protocol: Bearer.<paseto>`) | `connect.soulbits.app` via conduct proxy | Convenience, no self-hosting needed |

### 6.2 Multi-Connection WebSocket Pool

[`ConnectionManager`](../src/services/connection/ConnectionManager.ts) maintains up to **N+1 concurrent WebSocket connections**:

- **1 sync connection** at `/ws/sync`: Handles data synchronization, device pairing
- **N entity connections** at `/ws/worker`: One per active chat session (entity ID scoped)

Each connection has an independent lifecycle:
- Connect/disconnect independently
- Heartbeat (CONNECTION_PING/PONG every 30s) per connection
- Event routing via `event:sync` and `event:entity:{entityId}` namespacing
- Auto-reconnect with exponential backoff [1s, 2s, 4s, 8s, 16s, 30s]

### 6.3 Security Modes (Self-Hosted)

Three security levels for self-hosted connections:

1. **Secure** (`wss://` with certificate validation): Full TLS, production use
2. **Insecure SSL** (`wss://` without validation): Self-signed certificates, development use
3. **Unencrypted** (`ws://`): Plain WebSocket, local network only

### 6.4 Device Pairing Flow (Self-Hosted)

```
1. User enters Harmony Link IP:port in ConnectionSetupScreen
2. App opens ws:// connection → sends HANDSHAKE_REQUEST
3. Harmony Link shows pairing request → user approves on HL side
4. HANDSHAKE_ACCEPT received → JWT stored → upgrade to wss://
5. Security mode selected → SYNC_REQUEST → data sync begins
```

### 6.5 Cloud Connection Flow

```
1. User authenticates via AuthService (login/register)
2. AuthContext triggers cloudSessionService.connect()
3. CloudSessionService state machine: idle → requesting → provisioning → ready
4. On ready: open sync WS at /ws/sync with PASETO in Sec-WebSocket-Protocol
5. On chat open: open entity WS at /ws/worker
6. On background: cloudSessionService.disconnect() → broker grace period
7. On foreground: re-connect via cloudSessionService
```

**See also:** [`docs/CLOUD-CONNECTION.md`](../docs/CLOUD-CONNECTION.md) for full cloud connection details.

---

## 7. Database Architecture

### 7.1 Database Engine

- **React Native**: `react-native-sqlite-storage` (Android/iOS)
- **Testing (Node)**: `better-sqlite3` (synchronous, in-memory for unit tests)
- **Encryption**: SQLCipher via React Native Keychain for key management

### 7.2 Schema Design Principles

1. **100% Harmony Link compatibility**: Schema mirrors Harmony Link's PostgreSQL schema — bidirectional sync requires identical structure
2. **Forward-only migrations**: Changes applied in order, never rolled back
3. **TEXT for binary data**: Audio and image data stored as base64-encoded TEXT columns (not BLOB) for simpler cross-platform handling
4. **UUID primary keys**: Config tables use UUID v7 primary keys (migration 031) for sync compatibility
5. **Soft deletes**: `deleted_at` timestamp column pattern (emoji_actions, memories)

### 7.3 Table Inventory

| Table Group | Tables | Purpose |
|-------------|--------|---------|
| **Core** | `entities`, `characters` | AI entities and character profiles |
| **Config** | 15 provider config tables + 8 module config tables | Provider and module configuration |
| **Chat** | `conversation_messages`, `interactions` | Chat messages and interaction sessions |
| **AI State** | `emotion_state`, `memories` | Entity emotional state and memory |
| **Emoji** | `emoji_actions` | Per-entity emoji → action mappings |
| **Sync** | `sync_devices`, `sync_history` | Device pairing and sync tracking |

### 7.4 Repository Transaction Patterns

**CRITICAL PATTERN**: `withTransaction()` helper **cannot** be used for INSERT operations that return `insertId`.

```typescript
// ❌ WRONG — Promise resolves after transaction commits, insertId lost
const id = await withTransaction(db, (tx) => {
  tx.executeSql('INSERT INTO ...', [], (_, result) => {
    // result.insertId available here but Promise already resolved
  });
});

// ✅ CORRECT — Direct transaction callback with Promise wrapper
const id = await new Promise<number>((resolve, reject) => {
  db.transaction((tx) => {
    tx.executeSql('INSERT INTO ...', [], (_, result) => {
      resolve(result.insertId);
    });
  });
});
```

**Safe `withTransaction()` uses**: UPDATE/DELETE with `rowsAffected` checks, SELECT queries.
**Unsafe `withTransaction()` uses**: INSERT returning `insertId`, multiple sequential statements.

### 7.5 JOIN Query Pattern

Chat list previews use a single JOIN query instead of N+1:

```sql
SELECT cm.*, i.entity_id, i.participant_ids, i.interaction_scope
FROM conversation_messages cm
JOIN interactions i ON cm.interaction_id = i.id
WHERE ...
ORDER BY cm.created_at DESC
```

Two-phase TEXT column loading: Large audio/image TEXT columns are loaded in a second pass to avoid memory pressure on the initial query.

---

## 8. Sync Architecture

### 8.1 Sync Protocol

The sync protocol follows a **sequential master-slave** pattern:

```
┌──────────┐                    ┌──────────────┐
│  Mobile   │                    │ Harmony Link │
│  App      │                    │  (Master)    │
└─────┬─────┘                    └──────┬───────┘
      │                                 │
      │──── SYNC_REQUEST ──────────────→│
      │                                 │
      │←─── SYNC_ACCEPT ───────────────│
      │                                 │
      │←─── SYNC_DATA (batch 1) ───────│  Server sends changes
      │──── SYNC_DATA_CONFIRM ─────────→│  Per-record confirmation
      │                                 │
      │←─── SYNC_DATA (batch N) ───────│
      │──── SYNC_DATA_CONFIRM ─────────→│
      │                                 │
      │──── SYNC_DATA (local changes) ─→│  App sends local changes
      │←─── SYNC_DATA_CONFIRM ─────────│
      │                                 │
      │←─── SYNC_COMPLETE ─────────────│
      │──── SYNC_FINALIZE ─────────────→│
      │                                 │
```

### 8.2 Sync Events (EventEmitter3)

| Event | Direction | Payload |
|-------|-----------|---------|
| `sync:started` | Internal | `{ sessionId }` |
| `sync:completed` | Internal | `{ sessionId, stats }` |
| `sync:error` | Internal | `{ sessionId, error }` |
| `sync:rejected` | Internal | `{ sessionId, reason }` |
| `sync:progress` | Internal | `{ sessionId, current, total }` |

### 8.3 Sync Data Flow

```
SyncService.initiateSync()
  → sendEvent(SYNC_REQUEST)
  → wait for SYNC_ACCEPT (or SYNC_REJECT → emit sync:rejected)
  → buffer incoming SYNC_DATA events
  → applyBufferedSyncData() — atomic transaction
  → sendLocalChangesSequentially() — one-by-one with confirmation
  → requestFinalize()
  → emit sync:completed
```

### 8.4 Sync Consumers

| Consumer | Event Listened | Action |
|----------|---------------|--------|
| **SyncSettingsScreen** | `sync:completed`, `sync:error`, `sync:rejected` | Update UI, show toast |
| **SyncConnectionContext** | `sync:completed`, `sync:error`, `sync:rejected` | Update sync state, toast feedback |
| **EntitySessionContext** | `sync:completed` | Close all sessions (data refreshed) |
| **ChatDetailScreen** | `sync:completed` | Reload messages from updated DB |

### 8.5 Conflict Resolution

- **Strategy**: Last-write-wins (timestamp-based)
- **Granularity**: Per-record (not per-field)
- **Detection**: `updated_at` timestamp comparison
- **User visibility**: No conflict UI — silent resolution

---

## 9. Entity Session & Chat Architecture

### 9.1 InteractionSession Model

The [`InteractionSession`](../src/services/EntitySessionService.ts) replaces the earlier DualEntitySession pattern:

```
InteractionSession {
  interactionId: string        // Primary key — scoped to an interaction
  interaction: Interaction     // Full interaction record
  participantIds: string[]     // All participants (2 for private, N for group)
  ownEntityId: string          // The user's entity ID
  connections: Map<string, ConnectionInfo>  // Per-participant connection state
  pendingTranscriptions: Map<string, ...>   // In-flight STT transcriptions
}
```

**Key design decisions:**
- **Interaction-scoped**: Sessions are scoped to interaction IDs, not entity-pair IDs — supports N participants
- **Participant key derivation**: `private` (sorted pair "entityA+entityB"), `group` (sorted join of all IDs), `world` (empty string)
- **Scope derivation**: 0-1 participants → world, 2 → private, 3+ → group

### 9.2 Chat Session Lifecycle

```
1. User taps conversation → ChatDetailScreen mounts
2. EntitySessionService.startDualSession(partnerEntityId, impersonatedEntityId)
3. Start entity WS for user entity at /ws/worker
4. Start entity WS for partner entity at /ws/worker
5. INIT_ENTITY sent to both connections
6. Sessions ready → typing indicators, messages flow bidirectionally
7. User navigates away → ChatDetailScreen unmount
8. stopDualSession() → close both WS connections
```

### 9.3 Session Resume Flow

```
1. App reconnects after disconnect
2. INIT_ENTITY response includes resumed: true flag (from Harmony Link)
3. EntitySessionService checks resumed flag
4. If true: reconciles pending state without re-creating connection
5. Dangling events (queued during disconnect) refired by Harmony Link
```

### 9.4 Real-Time Event Flow

```
Partner types → EntitySessionService receives MESSAGE event
  → Saves to conversation_messages table via repository
  → Emits 'message:received' on the InteractionSession
  → ChatDetailScreen listener receives → appends to message list
  → Scroll to bottom (if user is at bottom)
  → TrackPlayer loads audio if audio message

User sends message (via message action sheet re-send)
  → EntitySessionService.sendMessage(interactionId, text, ...)
  → EmojiService.resolveMessageActions(text) → AdditionalEffects payload
  → Saves to conversation_messages table (optimistic)
  → Sends SEND_MESSAGE event via entity WS
  → Updates UI immediately (optimistic update)
  → Message confirmed when server echoes back
```

---

## 10. Authentication Architecture

### 10.1 Auth Service (`src/services/auth/`)

| Component | File | Responsibility |
|-----------|------|---------------|
| **AuthService** | [`AuthService.ts`](../src/services/auth/AuthService.ts) | Singleton: login/register/refresh/logout, `fetch()` with 401-refresh-retry, PASETO lifecycle |
| **tokenStorage** | [`tokenStorage.ts`](../src/services/auth/tokenStorage.ts) | Keychain `com.harmonyai.cloud.auth` — PASETO storage |
| **authFetch** | [`authFetch.ts`](../src/services/auth/authFetch.ts) | Thin wrapper: `authFetch → AuthService → tokenStorage` (now orphaned by Soulbits client adoption) |
| **googleSignIn** | [`googleSignIn.ts`](../src/services/auth/googleSignIn.ts) | Google Sign-In with typed error discriminator, non-GMS fallback |
| **appleSignIn** | [`appleSignIn.ts`](../src/services/auth/appleSignIn.ts) | Apple Sign-In (iOS only) |

### 10.2 Credential Architecture

**Credential Separation**:

| Backend | Credential | Storage | Format |
|---------|-----------|---------|--------|
| **Self-hosted** | `harmony_jwt` | AsyncStorage | Harmony Link JWT |
| **Cloud** | `com.harmonyai.cloud.auth` | React Native Keychain | Soulbits Cloud PASETO (v4.local encrypted) |

**Token lifecycle**:
- AuthService stores PASETO + `expires_at` (from backend, NOT decoded from PASETO)
- `AuthService.fetch()` wraps all HTTP calls with 401-refresh-retry: on 401 → `refresh()` → retry once → fail → `invalidate()` → AuthContext login
- CloudSessionService schedules proactive refresh: `getTokenExpiresAt() - 10min` timer, reschedules on each refresh
- Token-expiry pre-check before every cloud-mode WS dial
- `AuthContext.logout()` → `cloudSessionService.disconnect()` FIRST (to use current token for broker grace disconnect) → `AuthService.logout()`

### 10.3 Soulbits API Client

The [`@harmony-ai-solutions/soulbits-api-client`](https://github.com/harmony-ai-solutions/soulbits-api-client-js) is consumed as a **GitHub git dependency** (not npm published):

```json
"@harmony-ai-solutions/soulbits-api-client": "git+ssh://git@github.com/harmony-ai-solutions/soulbits-api-client-js.git#518c9e8..."
```

**Architecture**:
- Client built via `prepare` script (`npm run build` → tsup) during `npm install`
- Factory `buildSoulbitsClient({paseto})` creates PASETO-only client (no `refreshToken`)
- Client injects `Authorization: Bearer` but NEVER auto-refreshes on 401
- App keeps its own poll loop using `session.connect()` primitive (NOT `connectPoll`)
- This preserves the custom state machine (`requesting→provisioning→ready/failed`), UI feedback, and cancellation contract

---

## 11. Cloud Session Architecture

### 11.1 CloudSessionService State Machine

```
                    connect()
  ┌──────┐         ┌───────────┐    POST /connect (202)
  │ idle │────────→│ requesting│────────────────────────┐
  └──────┘         └─────┬─────┘                        │
       ↑                 │ poll timeout                  ↓
       │                 │ (retry_after_ms)        ┌──────────────┐
       │    ┌────────────┘                         │ provisioning │
       │    │            ┌─────────────────────────│  (poll loop) │
       │    │            │  POST /connect (200)     └──────┬───────┘
       │    │            ↓                                 │
       │    │     ┌──────────┐    POST /connect (503)      │ max polls (95)
       │    │     │  ready   │←────────────────────────────┘
       │    │     └────┬─────┘
       │    │          │
       │    │ disconnect() (POST /disconnect)
       │    └──────────┘
       │
       └──── failed (terminal, needs fresh connect())
```

### 11.2 Polling Parameters

| Parameter | Value | Notes |
|-----------|-------|-------|
| Max polls | 95 | ~190s total at 500ms floor |
| Retry-after floor | 500ms | Broker-suggested interval, floored |
| Poll timeout | 10s | Per-poll HTTP timeout |
| Consecutive WS failures before re-provision | 5 | Triggers fresh `connect()` |

### 11.3 CloudSessionStatus Model

```
type CloudSessionStatus = 'idle' | 'requesting' | 'provisioning' | 'ready' | 'failed'
```

**No `active` state at service level**: WS connectivity is tracked separately by `useSyncConnection().isConnected`. This decouples session provisioning from transport health.

### 11.4 UI Gating

```
canUseChat = cloud → status === 'ready'
             self-hosted → isPaired

connectionStatus = mode-aware label:
  cloud + ready + connected    → "Connected"
  cloud + ready + !connected   → "Reconnecting..."
  cloud + provisioning         → "Preparing session..."
  cloud + failed               → "Connection failed"
  self-hosted + paired         → "Paired"
  self-hosted + !paired        → "Not paired"
```

---

## 12. Provider & Module Configuration Architecture

### 12.1 Provider System Overview

The app mirrors Harmony Link's provider configuration system via sync (not management API). 15 provider types are supported:

| Provider | ID | Category |
|----------|-----|----------|
| OpenAI | `openai` | LLM (ChatGPT family) |
| OpenAI Compatible | `openaicompatible` | LLM (OpenAI-compatible APIs) |
| OpenRouter | `openrouter` | LLM (multi-model router) |
| Google | `google` | LLM (Gemini) |
| xAI | `xai` | LLM (Grok) |
| Anthropic | `anthropic` | LLM (Claude) |
| LocalAI | `localai` | LLM (local models) |
| Mistral | `mistral` | LLM (Mistral models) |
| Ollama | `ollama` | LLM (local Ollama) |
| ElevenLabs | `elevenlabs` | TTS |
| HarmonySpeech | `harmonyspeech` | TTS/STT/VAD |
| CharacterAI | `characterai` | Chat backend |
| Kajiwoto | `kajiwoto` | Chat backend |
| Kindroid | `kindroid` | Chat backend |
| ComfyUI | `comfyui` | Image generation |
| RAG | `rag_*` | Retrieval-Augmented Generation |
| TTS OpenAI | `tts_openai` | TTS (OpenAI voices) |
| STT OpenAI | `stt_openai` | Speech-to-Text (OpenAI Whisper) |
| VAD OpenAI | `vad_openai` | Voice Activity Detection |
| Soulbits Cloud | `soulbitscloud` | Cloud-hosted backend |

### 12.2 Schema-Driven Configuration

Provider forms are **schema-driven** via [`providerFieldSchemas.ts`](../src/screens/config/ModuleConfigEditScreen.tsx):

```typescript
// One schema per provider (NOT per module)
PROVIDER_SCHEMAS = {
  openai: { fields: [...], moduleSpecificTooltips: {...} },
  google: { fields: [...], ... },
  // ... 15 schemas total
}
```

**No module-specific schemas**: Module-specific fields are merged into the main provider schema with tooltips. The dead module-specific key pattern was removed.

### 12.3 Module Types

8 module types, each configurable with a subset of providers:

| Module | Purpose | Provider Slots |
|--------|---------|---------------|
| `backend` | Core LLM backend | 1 (provider) |
| `cognition` | Reasoning layer | 1 (provider) |
| `movement` | Entity actions/initiative | 1 (provider) [Google/xAI/Anthropic supported] |
| `vision` | Image understanding | 1 (provider) |
| `imagination` | Image generation | 1 (provider) |
| `rag` | Retrieval-Augmented Generation | 1 (provider) |
| `stt` | Speech-to-Text | 2 (transcription + vad) |
| `tts` | Text-to-Speech | 1 (provider) |

### 12.4 UUID Migration (Config Tables)

Migration 031 migrated all config tables from INTEGER to UUID v7 primary keys:
- **7-tier cascade**: models → repos → sync → clients → frontend schemas
- `generateId()` utility uses UUID v7 (time-ordered) via [`uuid.ts`](../src/utils/uuid.ts)
- All `parseInt()` sites in UI fixed to handle string IDs
- Sync `dispatch()` sites verified — no `Number()` coercion

### 12.5 Sampling Presets

Advanced LLM sampling control synced from Harmony Link:
- `sampling_preset_name`: YAML preset name (user types name that exists on HL server)
- `extra_params`: JSON TEXT column with key-value pairs (typical_p, tfs, dry_*, xtc_*)
- Precedence: explicit config > extraParams > preset values > library defaults
- `AdvancedSamplingParams` component for OpenAI-family providers
- Migration 021 added columns to module config tables

---

## 13. Emoji Action System Architecture

### 13.1 Data Flow

```
Message SEND
    │
    ▼
EmojiService.resolveMessageActions(text, entityId)
    │
    ├─ Scan text for emoji characters (regex)
    ├─ Query emoji_actions table for entity
    ├─ Filter by cooldown (skip expired, mark triggered)
    └─ Return: ResolvedMessageActions { actions, additionalEffects }
    │
    ▼
AdditionalEffects { emotionEffects: EmotionEffect[] }
    │
    ▼
EntitySessionService.sendMessage(..., additionalEffects)
    │
    ▼
SEND_MESSAGE event via WebSocket → Harmony Link
    │
    ▼
Harmony Link applies EmotionEffect deltas to entity's EmotionalState
```

### 13.2 Ekman8 Emotion Model

```typescript
type Ekman8Emotion = 'joy' | 'sadness' | 'trust' | 'disgust' 
                   | 'fear' | 'anger' | 'surprise' | 'anticipation';

interface EmotionEffect {
  emotion: Ekman8Emotion;
  delta: number;  // -5.0 to +5.0, signed intensity
}
```

### 13.3 Emoji Actions Table Schema

```sql
CREATE TABLE emoji_actions (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  action_type TEXT NOT NULL,
  emotion_effects TEXT,          -- JSON array of EmotionEffect
  style TEXT,
  bubble_color TEXT,
  cooldown_seconds INTEGER,
  deleted_at TEXT,               -- Soft delete
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

---

## 14. Atmospheric Background Architecture

### 14.1 Rendering Pipeline

```
App.tsx
├── backgroundLayer (zIndex: 0, absoluteFill)
│   └── DynamicBackground
│       └── [ActiveBackgroundVariant]
│           ├── DynamicAtmosphericBackground (Aurora)
│           │   ├── 5 Animated LinearGradient blobs (Lissajous paths)
│           │   └── StardustParticles (40 deterministic particles)
│           ├── GeodesicBackground
│           ├── GradientFlowBackground
│           └── NeuralPulseBackground
│
└── foregroundLayer (zIndex: 1, flex: 1)
    └── AppNavigator (transparent)
        └── Screens (transparent background, glassmorphism components)
```

### 14.2 Animation Strategy

- **All native driver animations**: `useNativeDriver: true` on all Animated values
- **Prime-number cycle durations**: Prevents visible synchronization/looping of the 5 blob animation cycles
- **Deterministic PRNG for particles**: `mulberry32(seed=42)` ensures particles are consistent across renders without storing state
- **60fps target**: Achieved through native driver offloading and minimal JS thread work

### 14.3 Background Selector

Users can choose from 4 background styles in [`BackgroundSettingsScreen`](../src/screens/settings/BackgroundSettingsScreen.tsx):

| Style | ID | Visual |
|-------|-----|--------|
| Aurora | `aurora` | 7 large drifting gradient orbs (nebula/aurora) |
| Geodesic | `geodesic` | Drifting geometric shapes with glowing halos |
| Gradient Flow | `gradientFlow` | Multi-layered flowing gradient ribbons |
| Neural Pulse | `neuralPulse` | Living synaptic network with traveling action potentials |

---

## 15. Testing Architecture

### 15.1 Test Structure

```
__tests__/
├── App.test.tsx                                    # App smoke test
├── cloudSessionService.test.ts                     # Cloud session unit tests (14 tests)
├── integration/                                    # Integration test suite
│   ├── sync.clock.test.ts
│   ├── sync.concurrent.test.ts
│   ├── sync.conflict.test.ts
│   ├── sync.failures.test.ts
│   ├── sync.network.test.ts
│   ├── syncService.integration.test.ts
│   ├── wss.smoke.integration.test.ts
│   └── helpers/                                    # Test utilities
│       ├── fixtures.ts
│       ├── HarmonyLinkMockServer.ts
│       ├── resetSyncService.ts
│       └── runFullSync.ts
├── src/
│   ├── database/__tests__/                         # DB unit tests
│   │   ├── migrations.rollforward.test.ts
│   │   ├── migrations.snapshot.test.ts
│   │   ├── nodeDatabase.smoke.test.ts
│   │   └── repositories/                           # Repository tests (84+ total)
│   │       ├── characters.test.ts
│   │       ├── cross-repo.test.ts
│   │       ├── entities.test.ts
│   │       ├── memories.test.ts
│   │       ├── modules.test.ts
│   │       └── providers.test.ts
│   └── services/__tests__/
│       └── BiometricLockService.test.ts
└── e2e/                                            # Maestro E2E tests
    └── docker-compose.yml
```

### 15.2 Test Configuration

```javascript
// jest.config.js — Two-project setup
{
  projects: [
    { displayName: 'unit', testMatch: ['**/__tests__/**/*.test.ts?(x)'] },
    { displayName: 'integration', testMatch: ['**/__tests__/integration/**/*.test.ts'] }
  ]
}
```

### 15.3 Test Runners

| Command | Description |
|---------|-------------|
| `npm test` | Run unit + integration (sequential) |
| `npm run test:unit` | Unit tests only (`--maxWorkers=16`) |
| `npm run test:integration` | Integration tests only |
| `npm run test:raw` | All tests (no project separation) |

### 15.4 Database Test Architecture

**Dual database backend for testing:**

| Environment | Database | Library |
|-------------|----------|---------|
| **React Native** | SQLite (SQLCipher) | `react-native-sqlite-storage` |
| **Node.js tests** | SQLite (in-memory) | `better-sqlite3` |

**NodeDatabase wrapper**: Provides identical API to react-native-sqlite-storage on Node via better-sqlite3. Migration SQL assertions (`DROP COLUMN`, `RENAME COLUMN`) verified against both backends.

### 15.5 Known Issue: better-sqlite3 Cross-Worker Contamination

Unit DB suites intermittently fail "Received function did not throw" when 2+ DB test files share a Jest worker due to native-addon GC/timing contamination. **Workaround**: `--maxWorkers=16` ensures 1 file per worker, eliminating sharing. See [`docs/TESTING.md`](../docs/TESTING.md) for full analysis.

### 15.6 E2E Testing (Maestro + Docker)

```
docker compose -f e2e/docker-compose.yml up
├── harmony-link        (Harmony Link backend)
├── android-emulator    (Android emulator with app APK)
└── maestro-runner      (Maestro test runner)
```

---

## 16. Build & CI Architecture

### 16.1 Build System

| Component | Technology |
|-----------|-----------|
| **Bundler** | Metro (React Native default) |
| **Android Build** | Gradle 8.13, Android SDK API 24–33, JDK 17 |
| **iOS Build** | Xcode, CocoaPods |
| **TypeScript** | tsc (type checking only, Metro handles transpilation) |

### 16.2 Build Flavors

**Android** (`android/app/build.gradle`):
```
productFlavors {
  dev {
    applicationIdSuffix ".dev"
    buildConfigField "boolean", "IS_BETA", "true"
  }
  prod {
    buildConfigField "boolean", "IS_BETA", "false"
  }
}
```

**iOS**: CI-driven via build matrix in `.github/workflows/build-release.yml` — regenerates `.env` per entry + `PRODUCT_BUNDLE_IDENTIFIER` override; single scheme, no pbxproj surgery.

### 16.3 Environment Configuration

[`react-native-config`](https://github.com/lugg/react-native-config) v1.6.1 wired into [`src/config/cloud.ts`](../src/config/cloud.ts):

- `IS_BETA` centralized coercion: `=== true || === 'true'` (Android boolean, iOS string)
- Cloud hosts: `CLOUD_HOSTS.auth`, `CLOUD_HOSTS.session`, `CLOUD_HOSTS.api`
- WebSocket paths: `WS_PATHS.sync`, `WS_PATHS.worker`
- OAuth configs: Google Web Client ID, Apple Services ID

---

## 17. Third-Party Dependencies

### 17.1 Core Framework

| Package | Version | Purpose |
|---------|---------|---------|
| `react` | ^19.2.7 | UI framework |
| `react-native` | ^0.86.0 | Mobile platform bridge |
| `typescript` | ^5.8.3 | Type safety |

### 17.2 Navigation & UI

| Package | Version | Purpose |
|---------|---------|---------|
| `@react-navigation/native` | ^7.1.26 | Navigation container |
| `@react-navigation/native-stack` | ^7.9.0 | Native stack navigator |
| `@react-navigation/bottom-tabs` | ^7.9.1 | Bottom tab navigator |
| `react-native-paper` | ^5.14.5 | Material Design 3 component library |
| `react-native-safe-area-context` | ^5.6.2 | Safe area insets |
| `react-native-screens` | ^4.19.0 | Native screen containers |
| `react-native-linear-gradient` | ^2.8.3 | Gradient rendering |
| `react-native-vector-icons` | ^10.3.0 | Icon library |

### 17.3 Data & Storage

| Package | Version | Purpose |
|---------|---------|---------|
| `react-native-sqlite-storage` | ^6.0.1 | SQLite database |
| `@react-native-async-storage/async-storage` | ^2.2.0 | Key-value storage |
| `react-native-keychain` | ^10.0.0 | Secure credential storage |
| `react-native-fs` | ^2.20.0 | File system access |

### 17.4 Communication

| Package | Version | Purpose |
|---------|---------|---------|
| `eventemitter3` | ^5.0.1 | Typed event emitter |
| `uuid` | ^13.0.0 | UUID generation (v7) |

### 17.5 AI & Backend

| Package | Version | Purpose |
|---------|---------|---------|
| `@harmony-ai-solutions/soulbits-api-client` | git#518c9e8 | Soulbits Cloud API client |

### 17.6 Media & Audio

| Package | Version | Purpose |
|---------|---------|---------|
| `react-native-audio-record` | ^0.2.2 | Audio recording |
| `react-native-track-player` | ^5.0.0-alpha0 | Audio playback |
| `react-native-image-picker` | ^7.0.0 | Image selection |
| `music-metadata` | ^11.12.1 | Audio metadata parsing |

### 17.7 Emoji

| Package | Version | Purpose |
|---------|---------|---------|
| `emoji-datasource` | ^16.0.0 | Emoji data (native) |
| `emoji-datasource-twitter` | ^16.0.0 | Twemoji sprite data |
| `emoji-datasource-google` | ^16.0.0 | Noto emoji sprite data |
| `emoji-regex` | ^10.6.0 | Emoji detection regex |
| `@emoji-mart/data` | ^1.2.1 | Emoji metadata |

### 17.8 Auth & Security

| Package | Version | Purpose |
|---------|---------|---------|
| `@react-native-google-signin/google-signin` | ^16.1.2 | Google Sign-In |
| `@invertase/react-native-apple-authentication` | ^2.5.1 | Apple Sign-In |
| `react-native-biometrics` | ^3.0.1 | Biometric authentication |

### 17.9 Dev Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `jest` | ^30.4.2 | Test runner |
| `better-sqlite3` | ^12.11.1 | Node.js SQLite for tests |
| `@testing-library/react-native` | ^14.0.1 | Component testing |
| `eslint` | ^8.19.0 | Linting |
| `prettier` | 2.8.8 | Formatting |

---

## 18. Key Architectural Decisions

### 18.1 React Native CLI (Not Expo)

**Decision**: Use React Native CLI, not Expo.
**Rationale**: Full native module control required for Executorch (on-device AI), messenger integration (WhatsApp/Telegram), and custom native modules. Expo's managed workflow doesn't support these.

### 18.2 EventEmitter3 Over Node.js EventEmitter

**Decision**: Use `eventemitter3` (~2KB) instead of Node.js `EventEmitter`.
**Rationale**: Node.js EventEmitter is unreliable in React Native's JavaScriptCore/Hermes environment. EventEmitter3 provides type-safe, reliable event handling with full TypeScript generics for compile-time event validation.

### 18.3 React Context Over Redux/Zustand

**Decision**: Use React Context API + Hooks for state management, with Redux/Zustand deferred.
**Rationale**: Current complexity doesn't justify external state management. 10 contexts with clear boundaries suffice. Will migrate to Redux/Zustand when cross-cutting state complexity (e.g., offline queue, multi-window) demands it.

### 18.4 Base64 TEXT Storage for Binary Data

**Decision**: Store audio and image data as base64-encoded TEXT columns, not BLOB/Uint8Array.
**Rationale**: Simpler cross-platform handling, easier WebSocket transmission (JSON-compatible), and works reliably with both `react-native-sqlite-storage` and `better-sqlite3` test backend. Trade-off: ~33% storage overhead from base64 encoding.

### 18.5 Forward-Only Migrations

**Decision**: Apply migrations forward only, never rollback.
**Rationale**: Mobile app database schema must stay in sync with Harmony Link's PostgreSQL. Rolling back on mobile while server moves forward would break sync. Forward-only with schema parity guarantees compatibility.

### 18.6 UUID v7 for Config Table PKs

**Decision**: Migrate config table primary keys from INTEGER to UUID v7.
**Rationale**: UUIDs enable conflict-free bidirectional sync without central ID coordination. UUID v7 (time-ordered) provides better index locality than UUID v4.

### 18.7 Schema-Driven Provider Forms

**Decision**: Generate provider configuration forms from schema definitions, not per-module code.
**Rationale**: 15 provider types × 8 module types = 120 potential combinations. Schema-driven approach eliminates combinatorial explosion. One schema per provider, module-specific fields merged via tooltips.

### 18.8 Cloud Mode: No Device Handshake

**Decision**: Skip the HANDSHAKE_REQUEST → HANDSHAKE_ACCEPT pairing flow in cloud mode.
**Rationale**: Cloud PASETO serves as both authentication and session identity. The conduct proxy handles TLS termination. Device registration happens server-side via `findOrCreateDevice` in the sync request handler — the mobile app never sends a handshake in cloud mode.

---

## 19. Architecture Decision Records

### ADR-001: Multi-Connection WebSocket Pool
**Context**: Chat requires simultaneous sync + entity sessions.
**Decision**: ConnectionManager manages up to N+1 connections with independent lifecycles.
**Consequences**: More complex reconnection logic, but clean separation of sync and chat concerns.

### ADR-002: InteractionSession Over DualEntitySession
**Context**: Original DualEntitySession pattern assumed exactly 2 participants.
**Decision**: Refactored to InteractionSession scoped to interaction IDs, supporting N participants.
**Consequences**: Participant key derivation needed; JOIN-based chat list queries required; navigation params changed.

### ADR-003: Optimistic UI with Last-Write-Wins Conflict Resolution
**Context**: Chat messages need to feel instant; conflicts are rare in single-user scenarios.
**Decision**: Save messages locally first, sync in background, resolve conflicts by timestamp.
**Consequences**: Possible message ordering issues on slow networks; no conflict UI for user.

### ADR-004: Singletons for AudioPlayer and ConnectionManager
**Context**: react-native-track-player is inherently a singleton; duplicate connections cause state corruption.
**Decision**: AudioPlayer exported as singleton instance; ConnectionManager created once.
**Consequences**: `getDurationFromBase64` must be called on the class statically, not the instance; ConnectionManager testing requires reset between tests.

### ADR-005: Cloud Credential Separation
**Context**: Cloud uses PASETO; self-hosted uses JWT. Different storage security requirements.
**Decision**: Cloud PASETO in Keychain (`com.harmonyai.cloud.auth`); self-hosted JWT in AsyncStorage.
**Consequences**: Two separate storage subsystems; clear separation prevents credential mixing.

### ADR-006: Soulbits Client as Git Dependency
**Context**: Soulbits API client needed but not npm-published.
**Decision**: Consume as GitHub git dependency with pinned commit SHA.
**Consequences**: `prepare` script required on client repo; manual SHA bump on client updates; no npm publish overhead.

### ADR-007: Coupled Backend-Frontend Releases
**Context**: Cloud session protocol changes break backward compatibility (409→202, 200→202, failed→503).
**Decision**: Backend and app deploy together; no API versioning.
**Consequences**: Beta project patches breaking changes through; no gradual rollout; both sides must be deployed simultaneously.

---

## 20. Known Technical Debt & Future Work

### 20.1 Technical Debt

| Item | Severity | Description |
|------|----------|-------------|
| **authFetch.ts orphaned** | Low | Still in codebase but no longer consumed (replaced by Soulbits client) |
| **Image message UI incomplete** | Medium | Backend/repository support exists but full UI for sending/receiving images not complete |
| **Hardcoded glass values in older components** | Low | Some legacy components may use hardcoded opacity instead of `theme.colors.glass` |
| **Raw View cards in some screens** | Low | Not all screens use `ThemedCard`; some still use raw `<View>` with inline styles |
| **Stale GitNexus index** | Low | 101 commits behind; `detect_changes` mapped symbols incorrectly |
| **progress.toon merge conflict** | Low | Unresolved `<<<<<<< HEAD` conflict marker in memory-bank/progress.toon |
| **Light theme polish** | Medium | `soulBitsLight` theme needs thorough component-level testing |
| **Chat bubble gradient pending** | Low | Proposal E from UI Visual Enhancement Proposal not yet implemented |

### 20.2 Future Architecture Work

| Feature | Priority | Description |
|---------|----------|-------------|
| **On-Device AI (Executorch)** | P2 | React Native Executorch integration for offline chat with up to 7B quantized models |
| **Vision Module Integration** | Current | Complete Harmony Link vision module integration for image understanding |
| **Imagination Module Integration** | Current | Complete Harmony Link imagination module for autonomous entity actions |
| **Emoji Action Backend Pipeline** | Current | Complete send-pipeline integration of emoji action AdditionalEffects payload |
| **Image Messages UI** | P2 | Full UI for image sending/receiving in chat |
| **Redux/Zustand Migration** | P3 | Migrate from Context to Redux/Zustand when cross-cutting state complexity demands it |
| **Messenger Integration** | P3 | WhatsApp/Telegram integration (premium feature) |
| **Offline Queue Enhancement** | P3 | Robust offline operation queue with conflict resolution UI |
| **E2E Test Expansion** | P3 | Expand Maestro E2E test coverage beyond smoke tests |
| **Performance Profiling** | P4 | Comprehensive React Native performance profiling and optimization |
| **Security Audit** | P4 | Third-party security audit before Play Store submission |

---

## Appendix A: File Count Summary

| Layer | Directory | Files |
|-------|-----------|-------|
| **Screens** | `src/screens/` | 28 |
| **Components** | `src/components/` | 50+ |
| **Contexts** | `src/contexts/` | 10 |
| **Services** | `src/services/` | 12 services + 8 WebSocket classes |
| **Repositories** | `src/database/repositories/` | 11 repositories + 15 provider sub-repos |
| **Migrations** | `src/database/migrations/` | 32 |
| **Themes** | `src/theme/themes/` | 8 |
| **i18n Namespaces** | `src/i18n/locales/en/` | 24 |
| **Tests** | `__tests__/` + `src/**/__tests__/` | 15+ test files, 84+ repository tests |

## Appendix B: Key File Reference

| File | Purpose |
|------|---------|
| [`App.tsx`](../App.tsx) | Root component — provider hierarchy, background layering, lock screen |
| [`src/navigation/AppNavigator.tsx`](../src/navigation/AppNavigator.tsx) | Root stack with all route definitions |
| [`src/services/SyncService.ts`](../src/services/SyncService.ts) | Sync protocol implementation |
| [`src/services/EntitySessionService.ts`](../src/services/EntitySessionService.ts) | Chat session management |
| [`src/services/connection/ConnectionManager.ts`](../src/services/connection/ConnectionManager.ts) | Multi-connection WebSocket pool |
| [`src/services/cloud/CloudSessionService.ts`](../src/services/cloud/CloudSessionService.ts) | Cloud session state machine |
| [`src/services/auth/AuthService.ts`](../src/services/auth/AuthService.ts) | Auth singleton with 401-refresh-retry |
| [`src/database/connection.ts`](../src/database/connection.ts) | SQLite connection + SQLCipher encryption |
| [`src/database/migrations.ts`](../src/database/migrations.ts) | Migration runner with safety guard |
| [`src/contexts/ThemeContext.tsx`](../src/contexts/ThemeContext.tsx) | Theme state + Paper MD3 mapping |
| [`src/theme/types.ts`](../src/theme/types.ts) | Theme type definitions |
| [`docs/HARMONY-LINK-INTEGRATION.md`](../docs/HARMONY-LINK-INTEGRATION.md) | Harmony Link integration overview |
| [`docs/CLOUD-CONNECTION.md`](../docs/CLOUD-CONNECTION.md) | Cloud connection guide |

---

*Report generated from memory bank, source code analysis, and documentation on 2026-07-30.*
