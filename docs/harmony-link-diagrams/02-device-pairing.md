# Device Pairing Flow

This diagram shows the complete device pairing and handshake sequence between the mobile app and Harmony Link.

## Complete Pairing Sequence

```mermaid
sequenceDiagram
    participant User
    participant UI as ConnectionSetupScreen
    participant CM as ConnectionManager
    participant SS as SyncService
    participant CSM as ConnectionStateManager
    participant AS as AsyncStorage
    participant HL as Harmony Link

    User->>UI: Enter server URL
    UI->>UI: Validate URL format
    
    alt First Time Pairing
        Note over UI: User selects security mode
        User->>UI: Choose: secure/insecure-ssl/unencrypted
    else Returning (Token Expired)
        UI->>CSM: getSecurityMode()
        CSM->>AS: Read saved mode
        AS-->>UI: Return previous mode
    end
    
    UI->>AS: Save server URL
    UI->>CM: createConnection('sync', 'sync', url, mode)
    activate CM
    CM->>CM: Create WebSocket
    CM->>HL: WebSocket Connect
    HL-->>CM: Connected
    CM->>UI: Event: connected:sync
    deactivate CM
    
    UI->>SS: requestHandshake()
    activate SS
    SS->>HL: HANDSHAKE_REQUEST
    Note over SS,HL: Device info: ID, name, platform
    
    HL->>HL: Generate JWT token
    HL->>HL: Generate self-signed cert
    
    alt User Approves on Desktop
        HL->>SS: HANDSHAKE_ACCEPT
        Note over SS,HL: JWT, WSS URL, cert, expiry
        SS->>CSM: saveConnectionCredentials()
        CSM->>AS: Store JWT, WSS URL, cert, expiry
        CSM->>AS: Set paired=true
        SS->>UI: Event: handshake:accepted
        UI->>User: ✅ Pairing successful
        
    else User Rejects on Desktop
        HL->>SS: HANDSHAKE_REJECT
        SS->>UI: Event: handshake:rejected
        UI->>User: ❌ Pairing rejected
        UI->>CM: disconnectConnection('sync')
    end
    deactivate SS
```

## State Machine - Connection States

```mermaid
stateDiagram-v2
    [*] --> NotPaired
    
    NotPaired --> Connecting: User enters URL
    Connecting --> WaitingApproval: Handshake sent
    
    WaitingApproval --> Paired: Handshake accepted
    WaitingApproval --> NotPaired: Handshake rejected
    
    Paired --> Connected: Auto-connect on app start
    Paired --> TokenExpired: JWT expires
    
    Connected --> Disconnected: Connection lost
    Disconnected --> Connected: Reconnect successful
    
    TokenExpired --> Connecting: User repairs
    TokenExpired --> NotPaired: User unpairs
    
    Connected --> [*]: User unpairs
    Disconnected --> [*]: User unpairs
```

## Handshake Request Payload

```json
{
  "event_id": "sync_123456789_abc",
  "event_type": "HANDSHAKE_REQUEST",
  "status": "NEW",
  "payload": {
    "device_id": "unique-device-id",
    "device_name": "User's Phone",
    "device_type": "harmony_app",
    "device_platform": "android" // or "ios"
  }
}
```

## Handshake Accept Response

```json
{
  "event_id": "sync_123456789_abc",
  "event_type": "HANDSHAKE_ACCEPT",
  "status": "SUCCESS",
  "payload": {
    "jwt_token": "eyJhbGciOiJIUzI1...",
    "wss_port": 8081,
    "server_cert": "-----BEGIN CERTIFICATE-----\n...",
    "token_expires_at": 1738888888
  }
}
```

## Stored Credentials

After successful handshake, these values are stored in AsyncStorage:

| Key | Value | Purpose |
|-----|-------|---------|
| `harmony_jwt` | JWT token | Authentication for sync/entity connections |
| `harmony_ws_url` | `ws://server:8080/events` | Unencrypted connection URL |
| `harmony_wss_url` | `wss://server:8081/events` | Secure connection URL |
| `harmony_server_cert` | PEM certificate | Self-signed cert for validation |
| `harmony_token_expires_at` | Unix timestamp | Token expiry time |
| `harmony_paired` | `"true"` | Device paired flag |
| `harmony_security_mode` | `"secure"` etc. | User's security preference |

## Token Lifecycle

```mermaid
graph TD
    Start[App Start] --> Check{Token exists?}
    Check -->|No| NotPaired[NotPaired State]
    Check -->|Yes| Validate{Token valid?}
    
    Validate -->|Yes| AutoConnect[Auto-connect with JWT]
    Validate -->|No| Expired[TokenExpired State]
    
    Expired --> Prompt[Prompt user to repair]
    Prompt -->|Repair| Handshake[New handshake flow]
    Prompt -->|Unpair| Clear[Clear all credentials]
    
    Clear --> NotPaired
    Handshake --> AutoConnect
    
    AutoConnect --> Monitor{Monitor expiry}
    Monitor -->|Valid| AutoConnect
    Monitor -->|Expired| Expired
```

## Security Mode Selection Flow

First-time pairing allows user to choose security mode:

```mermaid
graph TD
    Start[Server URL entered] --> Check{First time?}
    
    Check -->|Yes| Prompt[Show security mode picker]
    Check -->|No| Restore[Load saved mode]
    
    Prompt --> Secure[Secure - Full validation]
    Prompt --> Insecure[Insecure SSL - Skip validation]
    Prompt --> Unenc[Unencrypted - No TLS]
    
    Secure --> Save[Save mode preference]
    Insecure --> Save
    Unenc --> Save
    Restore --> Save
    
    Save --> Connect[Connect with chosen mode]
```

**Security Mode Implications:**

- **Secure**: Validates server certificate against system trust store + provided cert
- **Insecure SSL**: Accepts any certificate (for self-signed in dev)
- **Unencrypted**: Uses ws:// on port 8080 (no encryption)

## Re-pairing After Token Expiry

When JWT token expires, user must repair:

```mermaid
sequenceDiagram
    participant App
    participant CSM as ConnectionStateManager
    participant UI
    participant HL as Harmony Link
    
    App->>CSM: initialize()
    CSM->>CSM: Check token expiry
    CSM->>CSM: Token expired!
    CSM->>UI: Event: requiresRepair=true
    
    UI->>UI: Show "Connection Expired" message
    User->>UI: Tap "Reconnect"
    
    Note over UI,HL: Use stored URL & security mode
    UI->>HL: New handshake with same device_id
    
    alt Approved Again
        HL-->>UI: New JWT + updated expiry
        UI->>CSM: Update credentials
        UI->>User: ✅ Reconnected
    else Rejected
        UI->>User: ❌ Device was removed
        UI->>CSM: clearAllCredentials()
    end
```

---

[← Previous: Connection Architecture](./01-connection-architecture.md) | [Back to Overview](../HARMONY-LINK-INTEGRATION.md) | [Next: Sync Protocol →](./03-sync-protocol.md)
