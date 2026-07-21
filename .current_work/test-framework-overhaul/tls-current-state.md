# TLS Current State — HarmonyAIChat

> **Purpose**: Document the app's current TLS/SSL handling for the E2E test infrastructure.
> This is a read-only audit; no source changes are made as part of this document.

## 1. WebSocket Implementation

The app uses `react-native-websocket-self-signed` (v0.4.0) for **all** secure WebSocket connections.
This library bypasses certificate validation entirely:

- **Android**: Uses a custom `SSLSocketFactory` that trusts all certificates
- **iOS**: Uses `SecTrustSetExceptions` to allow any server certificate
- **npm**: https://www.npmjs.com/package/react-native-websocket-self-signed

## 2. Connection Architecture

```
WebSocketConnectionFactory.createConnection(mode)
  ├── "unencrypted"  → UnencryptedWebSocketConnection   (ws://)
  ├── "secure"       → SecureWebSocketConnection         (wss://, standard WebSocket)
  ├── "insecure-ssl" → InsecureSSLWebSocketConnection    (wss://, self-signed)
  └── "cloud"        → CloudWebSocketConnection          (wss:// cloud endpoints)
```

The sync protocol flow:
1. Initial connection via **plain WS** (`ws://`) for the handshake
2. Handshake response includes `wss_port` and `server_cert`
3. Client constructs WSS URL and upgrades to **insecure-ssl** mode
4. `InsecureSSLWebSocketConnection` uses `react-native-websocket-self-signed` to connect

## 3. WSS URL Resolution

The WSS URL is constructed **dynamically** at runtime, not from a build-time env var:

1. **Initial WS URL** is stored in AsyncStorage (`harmony_ws_url`) — provided by the user
   during pairing/self-hosted setup
2. **After handshake** (`handleHandshakeAccept` in SyncService.ts):
   - Reads `currentWsUrl` from AsyncStorage (`harmony_server_url`)
   - Replaces scheme `ws://` → `wss://`
   - Optionally replaces port with `payload.wss_port` (dual-port mode)
   - Stores final WSS URL in AsyncStorage (`harmony_wss_url`)
3. **Connection upgrade**: `ConnectionManager.createConnection` is called with the WSS URL
   and mode `"insecure-ssl"`

Source: `src/services/SyncService.ts` lines 207-234
Source: `src/services/ConnectionStateManager.ts` lines 39-50 (STORAGE_KEYS)

## 4. Build-Time Configuration (react-native-config)

The app uses `react-native-config` (v1.6.1) but currently only for:
- `IS_BETA` (flavor detection)
- `GOOGLE_WEB_CLIENT_ID` (Google Sign-In)
- `APPLE_SERVICES_ID` (Apple Sign-In)

**There is no existing `HARMONY_LINK_WSS_URL` env var** in the app's `.env`, `.env.example`,
or any build-time configuration. The WSS URL is always determined at runtime via the
handshake protocol described above.

## 5. Env File Structure

The existing `.env` and `.env.example` files contain only:
```
IS_BETA=true
GOOGLE_WEB_CLIENT_ID=
APPLE_SERVICES_ID=
```

On Android, these values come from `buildConfigField` in `android/app/build.gradle`
(product flavors: dev/prod). On iOS, they come from the `.env` file via react-native-config.

## 6. Implications for E2E

### What works
- `react-native-websocket-self-signed` will accept the E2E stack's self-signed cert
  (bypasses validation entirely — no CA trust config needed)
- The handshake protocol should work over Docker's internal network

### What needs to change (deferred to Phase 4-1)
The E2E `.env.e2e` file defines `HARMONY_LINK_WSS_URL`, but the app does not currently
read this value. Phase 4-1 (WSS Mock Infrastructure) owns adding the factory/configuration
layer that:

1. Reads `Config.HARMONY_LINK_WSS_URL` from react-native-config at build time
2. Passes it through to `ConnectionManager.createConnection()` as the WSS URL
3. Bypasses the normal WS→WSS handshake upgrade path in E2E mode

### ✅ Update (July 2026): Phase 4-1 production override implemented

The factory half of Phase 4-1 (`createWebSocket.ts`) shipped in the original work.
The **production-side env var override** — explicitly listed as deferred above —
is now implemented in `src/services/ConnectionStateManager.ts:applyE2EOverride()`.

Mechanism:
1. `ENVFILE=e2e/.env.e2e ./gradlew assembleDevDebug` → react-native-config's
   `dotenv.gradle` reads the file and surfaces `HARMONY_LINK_WSS_URL` via
   `Config.HARMONY_LINK_WSS_URL` in JS.
2. On app boot, `ConnectionStateManager.initialize()` calls
   `applyE2EOverride()` first.
3. If the env var is set AND AsyncStorage is empty, `applyE2EOverride()`
   pre-seeds pairing state (WSS URL, security mode=insecure-ssl, paired=true,
   placeholder JWT).
4. `SyncConnectionContext.connect()` then reads the seeded WSS URL and
   establishes the WSS connection. The first successful handshake replaces
   the placeholder JWT via `saveConnectionCredentials()`.
5. If the env var is unset (production builds), `applyE2EOverride()` is a
   no-op — no behavior change.

Helper scripts: `e2e/build-apk.sh` (Linux/macOS/WSL) and `e2e/build-apk.ps1` (Windows).

### Android emulator → host networking
- The emulator reaches the host via `10.0.2.2` (Android emulator convention)
- Inside Docker: `10.0.2.2` should reach the Docker host, which exposes port 28443
- For the Docker Compose stack, the app connects to `wss://10.0.2.2:28443`

### iOS Simulator → host networking
- The simulator maps host localhost directly (127.0.0.1)
- Harmony Link runs as native binary on the macOS CI runner
- App connects to `wss://localhost:28443`

## 7. Security Considerations

**This is a known E2E simplification.** The tests bypass TLS validation entirely via
`react-native-websocket-self-signed`. Future hardening (Phase 8 backlog) should:

1. Generate a dedicated E2E CA cert
2. Push it into the Android emulator's user cert store (or bundle in debug APK)
3. Configure `network_security_config.xml` to trust the E2E CA
4. Remove or disable `react-native-websocket-self-signed` for E2E builds
