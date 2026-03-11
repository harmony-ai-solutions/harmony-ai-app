# Harmony Link Integration - Overview

This document provides a comprehensive overview of how the Harmony AI App integrates with Harmony Link's Events API to enable real-time AI character interactions on mobile devices.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Core Components](#core-components)
- [Detailed Diagrams](#detailed-diagrams)
- [Implementation Status](#implementation-status)

## Architecture Overview

The Harmony AI App acts as a **mobile Events API client** for Harmony Link, implementing full bidirectional communication over WebSocket connections. The integration enables:

- **Device Pairing & Authentication**: JWT-based secure device registration
- **Data Synchronization**: Bidirectional sync of characters, configurations, and chat history
- **Real-time Chat**: Dual entity sessions for user-AI conversations
- **Voice Messages**: Audio recording, transcription, and playback
- **Multi-modal Communication**: Text, voice, and image messages

## Core Components

### 1. Connection Management Layer

#### **ConnectionStateManager**
- **Purpose**: Manages device pairing state and JWT token lifecycle
- **Responsibilities**:
  - Store/retrieve connection credentials (JWT, URLs, certificates)
  - Track token expiration and pairing status
  - Provide connection state to UI components
- **Key Functions**:
  - `initialize()`: Load saved credentials on app startup
  - `saveConnectionCredentials()`: Store JWT after successful handshake
  - `getIsConnected()`, `getIsPaired()`: State checks
  - `getSecurityMode()`: Get user's security preference (secure/insecure-ssl/unencrypted)

#### **ConnectionManager**
- **Purpose**: Orchestrates multiple WebSocket connections
- **Responsibilities**:
  - Create and manage sync + multiple entity connections
  - Route events to appropriate services
  - Handle connection lifecycle (connect, disconnect, reconnect)
- **Key Functions**:
  - `createConnection(id, type, url, mode)`: Establish WebSocket
  - `sendEvent(connectionId, event)`: Send event to specific connection
  - `isConnected(id)`: Check connection status
  - Event routing: `event:sync`, `event:entity`

#### **WebSocket Implementation**
Three security modes via factory pattern:
- **SecureWebSocketConnection**: TLS with certificate validation
- **InsecureSSLWebSocketConnection**: TLS without validation (self-signed certs)
- **UnencryptedWebSocketConnection**: Plain WebSocket (ws://)

**BaseWebSocketConnection** implements:
- Application-level heartbeat (CONNECTION_PING/PONG every 30s)
- Event parsing and routing
- Connection lifecycle management

### 2. Protocol Services

#### **SyncService**
- **Purpose**: Bidirectional data synchronization with Harmony Link
- **Protocol**: Sequential master-slave with per-record confirmation
- **Key Functions**:
  - `requestHandshake()`: Device registration
  - `initiateSync()`: Start sync session
  - `handleIncomingSyncData()`: Buffer incoming changes
  - `applyBufferedSyncData()`: Atomic transaction application
  - `sendLocalChangesSequentially()`: Send local changes with confirmation
- **Events Handled**:
  - HANDSHAKE_REQUEST/ACCEPT/REJECT
  - SYNC_REQUEST/ACCEPT/REJECT
  - SYNC_DATA/SYNC_DATA_CONFIRM
  - SYNC_COMPLETE/SYNC_FINALIZE

#### **EntitySessionService**
- **Purpose**: Manage real-time chat sessions with AI characters
- **Architecture**: Dual entity sessions (user entity + partner entity)
- **Key Functions**:
  - `startDualSession(partnerEntityId, impersonatedEntityId)`: Init chat
  - `sendTextMessage()`: Send text to AI
  - `newAudioMessage()`: Record and transcribe voice message
  - `sendImageMessage()`: Send image with optional caption
  - `sendUtterance()`: Low-level ENTITY_UTTERANCE event
- **Events Handled**:
  - INIT_ENTITY (session initialization)
  - ENTITY_UTTERANCE (incoming messages)
  - STT_OUTPUT_TEXT (transcription results)
  - TYPING_INDICATOR, RECORDING_INDICATOR

### 3. Media Services

#### **AudioRecorder**
- Records user voice messages
- WAV format, 16kHz, 16-bit, mono
- Permission management (Android)

#### **AudioPlayer**
- Plays AI voice responses
- Supports binary audio from Harmony Link
- Message-specific playback tracking
- State management (playing, paused, stopped)

### 4. State Management (React Contexts)

#### **SyncConnectionContext**
- Manages sync connection lifecycle
- Provides `isConnected`, `isPaired` state to UI
- Automatic reconnection with exponential backoff
- Handles connection errors and token expiration

#### **EntitySessionContext**
- Manages entity session lifecycle
- Provides `startSession()`, `stopSession()` to UI
- Tracks session state per character
- Automatic cleanup on app background

## Detailed Diagrams

The following detailed diagrams provide in-depth views of specific integration aspects:

1. **[Connection Architecture](./harmony-link-diagrams/01-connection-architecture.md)** - Service layer and WebSocket connection flow
2. **[Device Pairing Flow](./harmony-link-diagrams/02-device-pairing.md)** - Handshake and authentication sequence
3. **[Sync Protocol](./harmony-link-diagrams/03-sync-protocol.md)** - Bidirectional data synchronization
4. **[Entity Sessions](./harmony-link-diagrams/04-entity-sessions.md)** - Dual entity chat sessions
5. **[Message Flows](./harmony-link-diagrams/05-message-flows.md)** - Text, voice, and image message handling

## Implementation Status

### ✅ Fully Implemented

- **Connection Management**: All 3 security modes, heartbeat protocol
- **Device Pairing**: Handshake, JWT storage, certificate handling
- **Data Synchronization**: Full bidirectional sync with atomic transactions
- **Text Chat**: Send/receive text messages with optimistic UI
- **Voice Messages**: Recording, transcription, playback
- **Chat Indicators**: Typing and recording indicators
- **State Persistence**: Connection credentials, sync history
- **Error Handling**: Reconnection, timeout handling, user notifications

### 🚧 Partial / In Progress

- **Image Messages**: Send images with captions
- **On-Device AI**: React Native Executorch integration (planned)

### Event Types Implemented

The app implements the following Harmony Link Events API events:

**Connection Events:**
- CONNECTION_PING
- CONNECTION_PONG

**Handshake & Sync:**
- HANDSHAKE_REQUEST
- HANDSHAKE_ACCEPT
- HANDSHAKE_REJECT
- SYNC_REQUEST
- SYNC_ACCEPT
- SYNC_REJECT
- SYNC_DATA
- SYNC_DATA_CONFIRM
- SYNC_COMPLETE
- SYNC_FINALIZE

**Entity Sessions:**
- INIT_ENTITY
- ENTITY_SESSION_END
- ENTITY_UTTERANCE

**Speech-to-Text:**
- STT_INPUT_AUDIO
- STT_OUTPUT_TEXT

**Chat Indicators:**
- TYPING_INDICATOR
- RECORDING_INDICATOR

## Key Design Patterns

1. **Singleton Services**: ConnectionManager, SyncService, EntitySessionService
2. **Factory Pattern**: WebSocketConnectionFactory for security modes
3. **Observer Pattern**: EventEmitter for service communication
4. **Optimistic UI**: Immediate local updates, sync in background
5. **Atomic Transactions**: Buffered sync data applied in single transaction
6. **Dual Entity Sessions**: Separate connections for user and AI character
7. **Sequential Sync**: Per-record confirmation before next record

## File Structure

```
src/
├── services/
│   ├── ConnectionStateManager.ts       # JWT & pairing state
│   ├── SyncService.ts                  # Data synchronization
│   ├── EntitySessionService.ts         # Chat sessions
│   ├── AudioRecorder.ts                # Voice recording
│   ├── AudioPlayer.ts                  # Audio playback
│   ├── connection/
│   │   └── ConnectionManager.ts        # WebSocket orchestration
│   └── websocket/
│       ├── WebSocketConnection.ts      # Interface
│       ├── BaseWebSocketConnection.ts  # Base implementation
│       ├── SecureWebSocketConnection.ts
│       ├── InsecureSSLWebSocketConnection.ts
│       └── UnencryptedWebSocketConnection.ts
├── contexts/
│   ├── SyncConnectionContext.tsx       # Sync connection state
│   └── EntitySessionContext.tsx        # Entity session state
└── screens/
    ├── setup/
    │   └── ConnectionSetupScreen.tsx   # Device pairing
    ├── settings/
    │   └── SyncSettingsScreen.tsx      # Manual sync
    └── ChatDetailScreen.tsx            # Real-time chat
```

## References

- [Harmony Link Events API Documentation](https://github.com/harmony-ai-solutions/harmony-link/blob/main/docs/Events-API.md)
- [Connection Security Modes](./CONNECTION-SECURITY.md)

---

**Last Updated**: February 2026  
