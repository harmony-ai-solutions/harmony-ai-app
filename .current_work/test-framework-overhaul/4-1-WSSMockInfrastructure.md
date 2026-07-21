# Phase 4-1: WSS Mock Infrastructure

> **STATUS: ✅ COMPLETE** (test factory shipped in initial pass; production
> env-var override shipped in post-plan work — see "Production Override"
> section at the bottom of this file).

## Objective

Establish the test infrastructure for swapping the WebSocket transport in `SyncService` tests. The existing `__tests__/services/SyncService.test.ts` uses an inline `MockConnectionManager` that simulates the server via `setTimeout`. This phase replaces that hand-rolled simulation with the mature `jest-websocket-mock` library and introduces a factory pattern for swapping WSS implementations between production and test.

## Context

The existing test mocks `ConnectionManager` entirely. The new integration tests (Phase 4-2) will keep `ConnectionManager` real and only mock the underlying WebSocket boundary — letting the real `SyncService` + real `ConnectionStateManager` + real DB code execute together.

`jest-websocket-mock` provides:
- A mock WSS server (`new WS(url)`)
- Async matchers (`await expect(server).toReceiveMessage(...)`)
- JSON protocol mode (`{jsonProtocol: true}`)
- Client connection tracking (`await server.connected`)

**Known issue**: `jest-websocket-mock` uses real `setTimeout` internally and conflicts with Jest fake timers. Sync has timeout/retry logic that may need fake timers — see Phase 4-3 for the resolution strategy.

## Prerequisites

- Phase 2 complete (Database interface, NodeDatabase adapter, refactored repositories).
- Phase 3 complete (migration tests work — needed for setting up realistic DB state in sync tests).
- Read `src/services/connection/ConnectionManager.ts` to confirm where the WebSocket is created.
- Read `src/services/ConnectionStateManager.ts` for the state-machine dependencies.

## Implementation Steps

### 1. Install `jest-websocket-mock`

```bash
npm install --save-dev jest-websocket-mock@^2.5.0
```

Verify it loads cleanly under Jest 30:

```bash
node -e "require('jest-websocket-mock'); console.log('ok');"
```

### 2. Introduce a WebSocket factory

`react-native-websocket-self-signed` is the production WebSocket implementation. In tests we want the standard browser `WebSocket` (which `jest-websocket-mock` intercepts). Create a factory:

```typescript
// src/services/connection/createWebSocket.ts

import {Platform} from 'react-native';

export type WebSocketCtor = typeof WebSocket;

/**
 * Returns the appropriate WebSocket constructor for the current environment.
 *
 * - Production (RN): react-native-websocket-self-signed (supports self-signed certs)
 * - Test (Node + jest-websocket-mock): standard WebSocket (intercepted by the mock server)
 *
 * Tests override this via jest.mock('@/services/connection/createWebSocket').
 */
export function getWebSocketCtor(): WebSocketCtor {
  if (process.env.JEST_WORKER_ID !== undefined) {
    // Running under Jest — use the standard WebSocket (intercepted by jest-websocket-mock).
    // jsdom (the Jest test environment) provides a global WebSocket.
    return WebSocket;
  }
  // Production — lazy require to keep the native module out of the test bundle.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const SelfSignedWebSocket = require('react-native-websocket-self-signed').default;
  return SelfSignedWebSocket;
}
```

Update `ConnectionManager.ts` to use this factory:

```diff
- import SelfSignedWebSocket from 'react-native-websocket-self-signed';
+ import {getWebSocketCtor} from './createWebSocket';

  // Inside ConnectionManager where it currently does `new SelfSignedWebSocket(url)`:
- const ws = new SelfSignedWebSocket(url);
+ const WebSocketCtor = getWebSocketCtor();
+ const ws = new WebSocketCtor(url);
```

> **Note**: Confirm the exact current usage by reading `ConnectionManager.ts` first. The import path and instantiation pattern may differ.

### 3. Add the JSDOM test environment to Jest

`jest-websocket-mock` needs a global `WebSocket`. By default Jest's `react-native` preset uses Node environment, not JSDOM. Add `testEnvironment: 'jsdom'` to specific test files via docblock:

```typescript
/**
 * @jest-environment jsdom
 */
import WS from 'jest-websocket-mock';
// ... rest of the test
```

Or configure it per-path in `jest.config.js`:

```javascript
module.exports = {
  // ... existing config
  projects: [
    {
      displayName: 'unit',
      preset: '@react-native/jest-preset',
      testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/__tests__/**/*.test.ts'],
      // exclude integration tests that need jsdom
      testPathIgnorePatterns: ['/node_modules/', '__tests__/integration/'],
    },
    {
      displayName: 'integration',
      preset: '@react-native/jest-preset',
      testEnvironment: 'jsdom',
      testMatch: ['<rootDir>/__tests__/integration/**/*.test.ts'],
    },
  ],
};
```

The projects approach cleanly separates environments — unit tests stay fast in Node, integration tests get the JSDOM `WebSocket`. May need to install `jest-environment-jsdom` separately (it was removed from Jest core in Jest 30):

```bash
npm install --save-dev jest-environment-jsdom
```

### 4. Build a Harmony Link mock server helper

The mock server needs to speak the full sync protocol. Encapsulate it as a reusable class:

```typescript
// __tests__/integration/helpers/HarmonyLinkMockServer.ts

import WS from 'jest-websocket-mock';

const DEFAULT_WSS_URL = 'wss://localhost:8443/harmony-link';

/**
 * Mock Harmony Link server speaking the sync protocol.
 *
 * State machine:
 *   HANDSHAKE_REQUEST  → HANDSHAKE_ACCEPT
 *   SYNC_REQUEST       → SYNC_REQUEST (response with sync_session_id)
 *   SYNC_START         → server sends SYNC_DATA *, then SYNC_COMPLETE
 *   SYNC_DATA (client) → server stores, responds SYNC_DATA_CONFIRM
 *   SYNC_COMPLETE      → server confirms
 *   SYNC_FINALIZE      → server confirms
 */
export class HarmonyLinkMockServer {
  private server: WS;
  public receivedEvents: any[] = [];

  constructor(url: string = DEFAULT_WSS_URL) {
    this.server = new WS(url, {jsonProtocol: true});
  }

  async waitForConnection(): Promise<void> {
    await this.server.connected;
  }

  /** Register a handler that fires when a matching event arrives. */
  onEvent(eventType: string, handler: (event: any) => void): void {
    this.server.on('connection', () => {
      // Each connection gets its own message handler
    });
    // ... wire up handler. Simpler approach: poll receivedEvents.
  }

  async nextMessage(): Promise<any> {
    return this.server.nextMessage;
  }

  /** Send an event from server to client. */
  send(event: any): void {
    this.server.send(event);
  }

  /** Drive the protocol forward automatically based on incoming events. */
  startAutoResponder(): void {
    // Implementation: subscribe to messages, dispatch based on event_type,
    // send canned responses. Useful for happy-path tests.
    // For conflict / retry / error scenarios, don't use auto-responder —
    // manually drive each step.
  }

  close(): void {
    WS.clean();
  }

  get sentEvents(): any[] {
    return this.receivedEvents;
  }
}
```

Refine the implementation based on actual protocol details from `SyncService.ts` (`routeSyncEvent` method shows the full state machine).

### 5. Document the test-environment choice

Add a README in `__tests__/integration/`:

```markdown
# Integration tests

These tests use the `jsdom` environment to provide a global WebSocket,
which jest-websocket-mock intercepts. They use a real in-memory SQLite
(via NodeDatabase) — no DB mocking.

Run: `npx jest integration`
```

## Files to Create

- `src/services/connection/createWebSocket.ts` — the factory
- `__tests__/integration/helpers/HarmonyLinkMockServer.ts` — protocol-aware mock server
- `__tests__/integration/README.md` — environment explanation

## Files to Modify

- `package.json` — add `jest-websocket-mock`, `jest-environment-jsdom`
- `jest.config.js` — add `projects` array separating unit (Node) from integration (JSDOM)
- `src/services/connection/ConnectionManager.ts` — use `getWebSocketCtor()` instead of importing `react-native-websocket-self-signed` directly

## Validation

- [ ] `npm install` succeeds with the new dependencies
- [ ] Existing `__tests__/services/SyncService.test.ts` still passes (it doesn't use the new factory — it mocks ConnectionManager entirely)
- [ ] A trivial integration test that opens a mock WSS and asserts connection works:
  ```typescript
  test('mock server accepts connections', async () => {
    const server = new WS('wss://localhost:8443', {jsonProtocol: true});
    const client = new WebSocket('wss://localhost:8443');
    await server.connected;
    client.send({type: 'PING'});
    await expect(server).toReceiveMessage({type: 'PING'});
    WS.clean();
  });
  ```
- [ ] `ConnectionManager.ts` no longer imports `react-native-websocket-self-signed` directly (uses factory)
- [ ] Running the app on a device still connects to Harmony Link (verify the production path through the factory works)

## Open Questions to Resolve During Implementation

- **Does `react-native-websocket-self-signed` accept the same constructor args as standard `WebSocket`?** If not, the factory needs to normalize the API. Read the library's README and the existing `ConnectionManager` usage.
- **What does `ConnectionManager.ts` look like exactly?** Read it before refactoring. The change should be minimal — just swap the `new SelfSignedWebSocket(...)` call.
- **Should the JSDOM environment be global or per-project?** Per-project (via Jest `projects`) is recommended — unit tests stay fast in Node, only integration tests pay the JSDOM cost.

## Estimated Effort

One day. Mostly reading ConnectionManager and designing the protocol-aware mock server.

## Spike Item (validate before committing)

Per the research report, `jest-websocket-mock` v2.5.0 was last released in 2023. Validate it works under Jest 30 + jsdom 26 + Node 20. If it doesn't, fall back to `mock-socket` directly (lower-level but stable).

## Estimated Effort

Half a day to one day.

---

## Production Override (post-plan completion)

> **STATUS: ✅ COMPLETE** (July 2026). The original Phase 4-1 work shipped the
> *test-side* WebSocket factory but explicitly deferred the *production-side*
> env-var override (documented in `tls-current-state.md` line 78). That gap is
> now closed.

### What was deferred

`tls-current-state.md` originally said:

> The E2E `.env.e2e` file defines `HARMONY_LINK_WSS_URL`, but the app does not
> currently read this value. Phase 4-1 (WSS Mock Infrastructure) owns adding
> the factory/configuration layer that:
> 1. Reads `Config.HARMONY_LINK_WSS_URL` from react-native-config at build time
> 2. Passes it through to `ConnectionManager.createConnection()` as the WSS URL
> 3. Bypasses the normal WS→WSS handshake upgrade path in E2E mode

### What was implemented

**File**: `src/services/ConnectionStateManager.ts:applyE2EOverride()`

**Strategy**: cloud-mode auto-pairing via expired-token repair path
(documented in `harmony-link-private/eventserver/synchronization.go:260`).

Rather than bypassing the handshake (option 3 above), we trigger it via the
existing `requiresRepair` code path. `SyncConnectionContext.initializeConnection()`
already has a branch for paired-but-token-expired devices that calls
`connectWithRefresh()` — which runs the WS handshake first, then upgrades to WSS.

Pre-seeded AsyncStorage state when `Config.HARMONY_LINK_WSS_URL` AND
`Config.HARMONY_LINK_WS_URL` are both non-empty:

| Key | Value | Purpose |
|-----|-------|---------|
| `harmony_paired` | `'true'` | Passes `isPaired` check (`pairedStr === 'true' && jwtToken !== null`) |
| `harmony_jwt` | `'e2e-pending'` | Non-null satisfies check; replaced on first real handshake |
| `harmony_token_expires_at` | `'0'` | Always expired → `requiresRepair=true` → triggers `connectWithRefresh()` |
| `harmony_wss_url` | env var | WSS URL for post-handshake upgrade |
| `harmony_ws_url` | env var (second env var) | Plain-WS URL for initial handshake (different port from WSS) |
| `harmony_security_mode` | `'insecure-ssl'` | Accepts harmony-link's self-signed cert |

### Why a second env var (`HARMONY_LINK_WS_URL`)?

The harmony-link handshake protocol runs over **plain WS** (port 28080) first,
then upgrades to **WSS** (port 28443). The two are independent ports in the
harmony-link config — they can't be derived from each other. So we need both URLs.

### Build mechanism

react-native-config's `dotenv.gradle` reads the `ENVFILE` env var to pick a
`.env` file. However, this interacts poorly with the gradle daemon (env vars
get cached at daemon start). A more reliable mechanism is gradle `-P` flags,
which are per-invocation. The build helper scripts use `-P` flags:

```bash
# Linux/macOS/WSL:
./e2e/build-apk.sh

# Windows PowerShell:
.\e2e\build-apk.ps1
```

Both invoke:
```
./gradlew assembleDevDebug \
  -PHARMONY_LINK_WSS_URL=wss://10.0.2.2:28443 \
  -PHARMONY_LINK_WS_URL=ws://10.0.2.2:28080
```

The gradle `buildConfigField` declarations in `android/app/build.gradle`
read these via `project.findProperty('HARMONY_LINK_WSS_URL')` (same pattern
as the existing `GOOGLE_WEB_CLIENT_ID`). Verified empirically: after the
build, `app/build/generated/source/buildConfig/dev/debug/.../BuildConfig.java`
contains both URLs.

### Production safety

The `prod` flavor pins both fields to empty strings as a defensive measure:
even if CI accidentally sets the `-P` flags on a production build, the values
are overridden to `""`, and `applyE2EOverride()` no-ops on empty input.

### Related files

- `src/services/ConnectionStateManager.ts` — `applyE2EOverride()` method
- `src/types/react-native-config.d.ts` — typed `HARMONY_LINK_WSS_URL` + `HARMONY_LINK_WS_URL`
- `android/app/build.gradle` — `buildConfigField` declarations in both flavors
- `e2e/.env.e2e` — reference values for Android
- `e2e/.env.e2e.ios` — reference values for iOS Simulator (uses `localhost`)
- `e2e/build-apk.sh` / `e2e/build-apk.ps1` — helper scripts
- `tls-current-state.md` — updated with the "implemented" status
