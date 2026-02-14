# Entity Sessions

This diagram shows how dual entity chat sessions are established and managed for real-time conversations with AI characters.

## Dual Entity Session Concept

Each chat requires **TWO separate entity sessions**:

```mermaid
graph LR
    subgraph "Chat Session"
        US[User Session<br/>entity-user]
        PS[Partner Session<br/>entity-alice]
    end
    
    US -.->|Impersonates| User[User Entity]
    PS -.->|Represents| Alice[Alice Character]
    
    User -->|Sends to| Alice
    Alice -->|Responds to| User
```

**Why Dual Sessions?**
- Separate event streams for user and AI character
- Independent connection management
- Allows user to send messages AND receive transcriptions on their own connection
- AI responses arrive on partner connection

## Session Initialization Sequence

```mermaid
sequenceDiagram
    participant UI as ChatDetailScreen
    participant ESS as EntitySessionService
    participant CM as ConnectionManager
    participant HL as Harmony Link
    
    UI->>ESS: startDualSession(partnerId='alice', userId='user')
    
    Note over ESS: Create User Session
    ESS->>CM: createConnection('entity-user', 'entity', url, mode)
    CM->>HL: WebSocket Connect (entity-user)
    HL-->>CM: Connected
    ESS->>HL: INIT_ENTITY (entity_id='user')
    Note over ESS: Status: 'connecting'
    
    Note over ESS: Create Partner Session
    ESS->>CM: createConnection('entity-alice', 'entity', url, mode)
    CM->>HL: WebSocket Connect (entity-alice)
    HL-->>CM: Connected
    ESS->>HL: INIT_ENTITY (entity_id='alice')
    Note over ESS: Status: 'connecting'
    
    HL->>ESS: INIT_ENTITY SUCCESS (user)
    Note over ESS: User session: 'active'
    
    HL->>ESS: INIT_ENTITY SUCCESS (alice)
    Note over ESS: Partner session: 'active'
    
    Note over ESS: Both sessions active!
    ESS->>UI: Event: session:started
    UI->>UI: Enable chat input
```

## INIT_ENTITY Request

```json
{
  "event_id": "evt_1234567890_abc",
  "event_type": "INIT_ENTITY",
  "status": "NEW",
  "payload": {
    "entity_id": "alice",
    "device_type": "harmony_app",
    "device_id": "unique-device-id",
    "device_platform": "android",
    "capabilities": ["chat", "voice", "images"],
    "tts_output_type": "binary"
  }
}
```

**Key Fields:**
- `tts_output_type: "binary"`: Request audio as base64 (not file path)
- `capabilities`: Informs server what features this device supports

## INIT_ENTITY Response

```json
{
  "event_id": "evt_1234567890_abc",
  "event_type": "INIT_ENTITY",
  "status": "SUCCESS",
  "payload": {
    "session_id": "session_xyz_789",
    "entity_id": "alice"
  }
}
```

The `session_id` is stored and used for subsequent operations.

## Dual Session State Machine

```mermaid
stateDiagram-v2
    [*] --> Initializing
    
    Initializing --> PartiallyActive: One session active
    PartiallyActive --> FullyActive: Both sessions active
    
    FullyActive --> Active: Ready for chat
    
    Active --> Closing: User exits chat
    Active --> Error: Connection lost
    Active --> Background: App backgrounded
    
    Background --> Closing: Cleanup sessions
    Error --> Closing: Cleanup sessions
    
    Closing --> [*]
```

## Connection Lifecycle

```mermaid
graph TD
    Start[User opens chat] --> Check{Sync connected?}
    
    Check -->|No| Error[Show error]
    Check -->|Yes| Init[Start dual session]
    
    Init --> Connect[Establish 2 WebSockets]
    Connect --> Send[Send INIT_ENTITY x2]
    Send --> Wait[Wait for SUCCESS]
    
    Wait --> Ready[Both active - Chat ready]
    
    Ready --> Chat[User chats]
    Chat --> Ready
    
    Ready --> Exit{User action}
    Exit -->|Back button| Close[Stop session]
    Exit -->|App background| Close
    
    Close --> Cleanup[Disconnect both connections]
    Cleanup --> Done[Session ended]
```

## Entity Session Context

The `EntitySessionContext` provides session management to UI:

```typescript
interface EntitySessionContext {
  // Start a chat session
  startSession: (partnerId: string, userId?: string) => Promise<void>;
  
  // Stop a chat session
  stopSession: (partnerId: string) => Promise<void>;
  
  // Get session info
  getSessionInfo: (partnerId: string) => SessionInfo | null;
  
  // Check if session is active
  isSessionActive: (partnerId: string) => boolean;
}
```

## Session Cleanup

Sessions are automatically cleaned up when:

1. **User exits chat**: `stopSession()` called explicitly
2. **App backgrounded**: AppState listener triggers `closeAllSessions()`
3. **Connection lost**: Detected via heartbeat timeout
4. **Error occurs**: Session marked as failed and cleaned up

```mermaid
sequenceDiagram
    participant App as AppState
    participant ESS as EntitySessionService
    participant AP as AudioPlayer
    participant CM as ConnectionManager
    
    App->>ESS: App goes to background
    ESS->>AP: stop()
    Note over ESS: Clean up pending transcriptions
    
    loop For each dual session
        ESS->>CM: sendEvent(ENTITY_SESSION_END)
        ESS->>CM: disconnectConnection(user)
        ESS->>CM: disconnectConnection(partner)
    end
    
    ESS->>ESS: Clear all sessions
```

## Pending Sessions Tracking

During initialization, sessions are tracked separately:

```typescript
// Before both sessions are active
pendingSessions: Map<entityId, EntitySession>

// After both sessions active
sessions: Map<partnerId, DualEntitySession>
```

This allows handling INIT_ENTITY responses for each entity independently.

## Error Handling

```mermaid
graph TD
    Error[Error Detected] --> Type{Error Type}
    
    Type -->|INIT_ENTITY ERROR| Failed[Mark session failed]
    Type -->|Connection Lost| Retry[Attempt reconnect]
    Type -->|Heartbeat Timeout| Disconnect[Trigger disconnection]
    
    Failed --> Cleanup[Clean up connections]
    Disconnect --> Cleanup
    
    Retry -->|Success| Resume[Resume session]
    Retry -->|Failed| Cleanup
    
    Cleanup --> Notify[Notify UI]
    Notify --> UI[Show error to user]
```

**Common Errors:**
- `INIT_ENTITY` fails (entity not found, permissions, etc.)
- WebSocket connection drops during session
- Heartbeat timeout (no PONG response)
- Sync connection lost (entity sessions require sync)

## Multiple Chat Sessions

While theoretically possible, the app currently limits to **one active chat at a time**:

```typescript
// Only one dual session active
if (sessions.has(otherPartnerId)) {
  await stopSession(otherPartnerId);
}
await startDualSession(newPartnerId);
```

This simplifies:
- Resource management
- Audio playback (only one audio stream)
- UI state management

---

[← Previous: Sync Protocol](./03-sync-protocol.md) | [Back to Overview](../HARMONY-LINK-INTEGRATION.md) | [Next: Message Flows →](./05-message-flows.md)
