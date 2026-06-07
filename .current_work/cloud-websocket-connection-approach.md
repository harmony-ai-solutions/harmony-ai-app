## What this document is
A technical reference for the future "cloud auth" implementation task in the Harmony AI app. It describes what the new CloudWebSocketConnection class needs to do, how it differs from the existing three WebSocket modes, and what changes are required.

## Cloud Connection Flow
The cloud connection flow is fundamentally different from the local pairing flow:

**Local flow (existing):** `ws://` unencrypted → HANDSHAKE_REQUEST → user approval → receive JWT + cert → `wss://` with cert
**Cloud flow (new):** `POST /v1/session/connect` (PASETO auth at session broker) → get proxy endpoint → `wss://conduct.soulbits.app/ws/sync` with `Authorization: Bearer <paseto>` → immediate authenticated connection

No pairing, no HANDSHAKE_REQUEST, no cert exchange, no device approval. Auth happens upstream at the session broker.

## Current WebSocket Modes (existing, unchanged)

| Mode | Auth | Custom Headers | Library |
|------|------|---------------|---------|
| unencrypted | None | ❌ | React Native WebSocket |
| secure | Sec-WebSocket-Protocol hack | ❌ | React Native WebSocket |
| insecure-ssl | Authorization: Bearer {jwt} | ✅ | react-native-websocket-self-signed (OkHttp3/URLSessionWebSocketTask) |

## Cloud Mode Requirements

1. **New `CloudWebSocketConnection` class** that sends `Authorization: Bearer <paseto>` as a proper HTTP header on the WebSocket upgrade request
2. **Uses the existing `react-native-websocket-self-signed` native module** — it already supports custom headers via OkHttp3 on Android and URLSessionWebSocketTask on iOS
3. **Certificate validation MUST BE ENABLED** — the cloud endpoint (`conduct.soulbits.app`) uses an ACM wildcard cert for `*.soulbits.app`, which is trusted by the system certificate store. Unlike `insecure-ssl` mode, we do NOT disable cert validation.
4. **Skips pairing entirely** — no HANDSHAKE_REQUEST, no device approval, no cert exchange. The PASETO token from the user's login is the only credential.
5. **Connects to fixed cloud endpoints** — `wss://conduct.soulbits.app/ws/sync` and `wss://conduct.soulbits.app/ws/worker` (not user-entered IP/port)
6. **PASETO token comes from the existing auth flow** — the app already receives a PASETO v4 token from `POST /v1/auth/login`. This same token is passed as the Bearer credential on the WebSocket.
7. **API key auth is also supported** — game plugins, automation tools, and management agents can connect using an API key (`sb_cloud_` prefix) instead of a PASETO token. The `Authorization: Bearer <api_key>` header works identically on the backend. The app itself will always use PASETO, but third-party integrations may use API keys through the same proxy endpoint.

## Key Differences from Existing Modes

| Aspect | Local Modes | Cloud Mode |
|--------|-------------|------------|
| URL source | User enters IP:port | Fixed `conduct.soulbits.app` endpoint |
| Auth | JWT from pairing handshake | PASETO from login (or API key for plugins) |
| Headers | Sec-WebSocket-Protocol hack or none | Proper Authorization: Bearer header |
| Cert handling | Self-signed or pin | System-trusted ACM cert (validate normally) |
| Pairing | Required (HANDSHAKE_REQUEST) | Skipped (CLOUD_MODE=true on server) |
| Security mode | Choose unencrypted/secure/insecure-ssl | Always secure (TLS at ALB) |

## Implementation Notes

- The `react-native-websocket-self-signed` native module needs a configuration option to ENABLE certificate validation (currently it disables it). For cloud mode, the ACM cert is system-trusted — validation should pass normally.
- If modifying the native module is complex, an alternative is to create a new lightweight native module specifically for cloud WebSocket that wraps OkHttp3/URLSessionWebSocketTask with custom headers and standard TLS validation.
- The `ConnectionManager` already uses `?connection_id=` query parameters for unique connections. Cloud mode should use `?connection_id=sync` and `?connection_id=entity-{entityId}` consistent with existing patterns.
- The PASETO token should be stored in AsyncStorage (alongside the existing `harmony_jwt` key) and refreshed per the token's expiry.
- Error handling: 401 from the conduct proxy means the PASETO expired — the app should refresh the token via the auth service and retry.
- The `/admin/*` HTTP endpoints on Harmony Link are also reachable via the conduct proxy with the same PASETO Bearer auth.

## Backend Validation (for reference)

The conduct proxy (`cmd/conduct-proxy` in soulbits-cloud-backend) validates auth on every HTTP and WebSocket upgrade request:
1. Extracts `Authorization: Bearer <token>` header
2. Detects token format: `v4.local.` prefix = PASETO, `sb_cloud_` prefix = API key
3. Validates via `pkg/auth.Middleware` (same middleware as all other services — PASETO validation or API key hash lookup)
4. Extracts `user_id` from the resulting AuthContext (both paths produce the same AuthContext)
5. Looks up `session:endpoint:{user_id}` in Valkey to find the target Fargate task
6. If token invalid → 401 Unauthorized (before WebSocket upgrade)
7. If no active session → 404 Not Found (before WebSocket upgrade)
8. If valid → proxies connection to the target task
