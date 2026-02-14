# Sync Protocol

This diagram shows the complete bidirectional data synchronization protocol between the mobile app and Harmony Link.

## Sync Protocol Overview

The sync protocol is a **sequential master-slave protocol** with per-record confirmation, ensuring data consistency across devices.

```mermaid
graph TD
    Start[User initiates sync] --> Request[SYNC_REQUEST]
    Request --> Accept{Server accepts?}
    
    Accept -->|Yes| ServerSend[Phase 1: Server sends changes]
    Accept -->|No| Reject[SYNC_REJECT]
    
    ServerSend --> Buffer[Client buffers all records]
    Buffer --> ServerComplete[Server: SYNC_COMPLETE]
    
    ServerComplete --> Apply[Client: Apply buffered changes atomically]
    Apply --> ClientSend[Phase 2: Client sends changes]
    
    ClientSend --> ClientComplete[Client: SYNC_COMPLETE]
    ClientComplete --> ServerAck[Server: SYNC_COMPLETE]
    
    ServerAck --> Finalize[SYNC_FINALIZE]
    Finalize --> Update[Update last_sync_timestamp]
    Update --> Done[Sync complete]
    
    Reject --> Done
```

## Complete Sync Sequence

```mermaid
sequenceDiagram
    participant App
    participant SS as SyncService
    participant DB as SQLite DB
    participant HL as Harmony Link
    
    App->>SS: initiateSync()
    SS->>SS: Create sync session
    SS->>HL: SYNC_REQUEST
    Note over SS,HL: device_id, last_sync_timestamp
    
    alt Sync Accepted
        HL->>SS: SYNC_ACCEPT
        Note over SS: Phase = SERVER_SENDING
        
        SS->>HL: SYNC_START
        
        loop For each changed record on server
            HL->>SS: SYNC_DATA (record)
            SS->>SS: Buffer record (no DB write yet)
            SS->>HL: SYNC_DATA_CONFIRM
        end
        
        HL->>SS: SYNC_COMPLETE
        Note over SS: All server data received
        
        SS->>DB: BEGIN TRANSACTION
        SS->>DB: Apply all buffered records
        DB-->>SS: COMMIT
        Note over SS: Phase = CLIENT_SENDING
        
        loop For each changed record on client
            SS->>HL: SYNC_DATA (record)
            HL->>HL: Apply record
            HL->>SS: SYNC_DATA_CONFIRM
        end
        
        SS->>HL: SYNC_COMPLETE
        HL->>SS: SYNC_COMPLETE (SUCCESS)
        Note over SS: Phase = FINALIZING
        
        SS->>HL: SYNC_FINALIZE
        HL->>SS: SYNC_FINALIZE (SUCCESS)
        
        SS->>SS: Update last_sync_timestamp
        SS->>App: Event: sync:completed
        
    else Sync Rejected
        HL->>SS: SYNC_REJECT
        SS->>App: Event: sync:rejected
    end
```

## SYNC_REQUEST Payload

```json
{
  "event_id": "sync_1234567890_xyz",
  "event_type": "SYNC_REQUEST",
  "status": "NEW",
  "payload": {
    "device_id": "unique-device-id",
    "device_name": "User's Phone",
    "device_type": "harmony_app",
    "device_platform": "android",
    "current_utc_timestamp": 1738900000,
    "last_sync_timestamp": 1738800000
  }
}
```

## SYNC_DATA Payload Example

```json
{
  "event_id": "data_1234567890_abc",
  "event_type": "SYNC_DATA",
  "status": "NEW",
  "payload": {
    "sync_session_id": "session_xyz",
    "event_id": "data_1234567890_abc",
    "table": "character_profiles",
    "operation": "insert",
    "record": {
      "id": "char_123",
      "name": "Alice",
      "description": "Friendly AI",
      "created_at": 1738850000,
      "updated_at": 1738850000,
      "deleted_at": null
    }
  }
}
```

## Sync Table Order (Foreign Key Dependencies)

Records are synced in this order to respect foreign key constraints:

1. `character_profiles`
2. `character_image`
3. Provider configs (`provider_config_*`)
4. Module configs (`*_configs`)
5. `entities`
6. `entity_module_mappings`
7. `conversation_messages`

## Conflict Resolution: Last-Write-Wins

```mermaid
graph TD
    Receive[Receive SYNC_DATA] --> Check{Record exists?}
    
    Check -->|No| Insert[INSERT new record]
    Check -->|Yes| Compare{Compare timestamps}
    
    Compare -->|Incoming newer| Update[UPDATE record]
    Compare -->|Local newer| Skip[Skip update]
    Compare -->|Same time| Update
    
    Insert --> Confirm[Send SYNC_DATA_CONFIRM]
    Update --> Confirm
    Skip --> Confirm
```

**Timestamp Comparison:**
- Incoming `updated_at` >= Local `updated_at` → Apply change
- Local `updated_at` > Incoming `updated_at` → Keep local

## Atomic Transaction Pattern

All incoming server data is buffered and applied in a single transaction:

```typescript
// Pseudo-code
const buffer = [];

// Phase 1: Buffer all incoming data
onSyncData(data) {
  buffer.push(data);
  sendConfirmation(data.event_id);
}

// After SYNC_COMPLETE from server
onServerComplete() {
  db.transaction(() => {
    for (const item of buffer) {
      if (item.operation === 'delete') {
        db.execute('UPDATE table SET deleted_at=? WHERE id=?');
      } else {
        const exists = db.select('SELECT id FROM table WHERE id=?');
        if (!exists) {
          db.execute('INSERT INTO table ...');
        } else {
          // Last-write-wins
          if (incoming.updated_at >= local.updated_at) {
            db.execute('UPDATE table SET ...');
          }
        }
      }
    }
  });
  
  buffer = [];
}
```

**Benefits:**
- All-or-nothing: Either all changes apply or none
- No partial sync state in database
- Automatic rollback on error
- Consistent data view

## Soft Delete Handling

Deleted records use `deleted_at` timestamp (soft delete):

```json
{
  "table": "character_profiles",
  "operation": "delete",
  "record": {
    "id": "char_123",
    "deleted_at": 1738860000,
    "updated_at": 1738860000
  }
}
```

The receiving side updates: `UPDATE table SET deleted_at=?, updated_at=? WHERE id=?`

## Sync Phases State Machine

```mermaid
stateDiagram-v2
    [*] --> IDLE
    
    IDLE --> SERVER_SENDING: SYNC_ACCEPT received
    
    SERVER_SENDING --> CLIENT_SENDING: SYNC_COMPLETE from server
    
    Note right of CLIENT_SENDING: Apply buffered data<br/>then send local changes
    
    CLIENT_SENDING --> FINALIZING: SYNC_COMPLETE from client
    
    FINALIZING --> IDLE: SYNC_FINALIZE complete
    
    SERVER_SENDING --> IDLE: Error
    CLIENT_SENDING --> IDLE: Error
    FINALIZING --> IDLE: Error
```

## Error Handling

```mermaid
graph TD
    Error[Sync Error Detected] --> Type{Error Type}
    
    Type -->|Connection Lost| Buffer[Keep buffer]
    Type -->|Transaction Failed| Clear[Clear buffer]
    Type -->|Timeout| Clear
    
    Buffer --> Reconnect[Wait for reconnection]
    Reconnect --> Retry[Retry sync]
    
    Clear --> Reset[Reset sync phase to IDLE]
    Reset --> Notify[Notify user]
    Notify --> Manual[User can retry manually]
```

**Error Scenarios:**
1. **Connection Lost During Sync**: Buffer preserved, auto-retry on reconnect
2. **Transaction Failure**: Buffer cleared, phase reset to IDLE
3. **Confirmation Timeout**: Buffer cleared after 30 seconds
4. **Foreign Key Violation**: Transaction rolls back, error reported

## Manual Sync Trigger

User can manually trigger sync from SyncSettingsScreen:

```typescript
// In UI
await SyncService.initiateSync();

// Service emits progress events
SyncService.on('sync:progress', (session) => {
  console.log(`Sent: ${session.recordsSent}, Received: ${session.recordsReceived}`);
});

SyncService.on('sync:completed', (session) => {
  console.log('Sync finished!');
});
```

## Automatic Sync Triggers

Sync is automatically initiated when:

1. **After message sent**: `EntitySessionService` triggers sync after storing message
2. **On reconnection**: After connection restored
3. **Manual**: User taps sync button

## Performance Considerations

- **Sequential with Confirmation**: Ensures reliability but slower than batch
- **Buffered Application**: Reduces database writes, faster than per-record
- **Payload Size Logging**: Helps identify large records affecting performance
- **Connection-specific**: Sync uses dedicated `sync` connection

---

[← Previous: Device Pairing](./02-device-pairing.md) | [Back to Overview](../HARMONY-LINK-INTEGRATION.md) | [Next: Entity Sessions →](./04-entity-sessions.md)
