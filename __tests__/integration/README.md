# Integration Tests

These tests exercise `SyncService` + real SQLite database (via `NodeDatabase`)
end-to-end.  The `ConnectionManager` is replaced with a lightweight mock that
routes events through the `HarmonyLinkMockServer` — an EventEmitter-based mock
server that speaks the full Harmony Link sync protocol.

## Architecture

```
┌──────────────────────┐       ╔══════════════════════════╗
│  SyncService         │──────▶║  mock ConnectionManager  ║
│  (real state machine)│       ╚═══════╦══════════════════╝
└──────────────────────┘               │
       │                               │
       ▼                               ▼
┌──────────────────────┐       ╔══════════════════════════╗
│  database/sync.ts    │       ║ HarmonyLinkMockServer    ║
│  (real helpers)      │       ║ (EventEmitter-based,     ║
└──────────────────────┘       ║  no real WebSocket)      ║
       │                       ╚══════════════════════════╝
       ▼
┌──────────────────────┐
│  NodeDatabase         │
│  (real better-sqlite3)│
└──────────────────────┘
```

**Only mocked:** `ConnectionManager`, native modules (`react-native-device-info`,
`@react-native-async-storage/async-storage`, logger).

**Real:** `SyncService` state machine, database helpers (`getChangedRecords`,
`applySyncRecord`, etc.), SQLite (via `better-sqlite3`), migrations.

## Why EventEmitter instead of WebSocket?

`jest-websocket-mock` patches `global.WebSocket` to intercept connections.
This patching is incompatible with Jest 30's `jest-environment-jsdom` (the
global object is proxied).  Using an EventEmitter-based mock avoids this
entirely while still exercising the full protocol state machine.

## Run

```bash
# All integration tests
npx jest --selectProjects integration --forceExit

# Single test file
npx jest --selectProjects integration syncService.integration --forceExit

# Smoke test (quick infrastructure verification)
npx jest --selectProjects integration wss.smoke --forceExit
```

The `--forceExit` flag is needed because `SyncService` sets 30-second timers
for data confirmation timeouts that are not always cleaned up in tests.

## Test Cases

| File | Tests | Status |
|------|-------|--------|
| `wss.smoke.integration.test.ts` | 1 (infrastructure) | ✅ Passing |
| `syncService.integration.test.ts` | 7 (happy path) | ✅ Passing |

### Happy Path Tests (syncService.integration)

1. **New device — empty DB pulls everything from server**
2. **New device — with existing content (bidirectional first sync)**
3. **Existing device — server updates only (incremental pull)**
4. **Existing device — client updates only (incremental push)**
5. **Existing device — with deletes (soft-delete propagation)**
6. **Protocol flow — verify event ordering**
7. **Last sync timestamp update**

## Key Files

| File | Purpose |
|------|---------|
| `HarmonyLinkMockServer.ts` | EventEmitter-based mock speaking the sync protocol |
| `resetSyncService.ts` | Singleton reset helper |
| `fixtures.ts` | Test data factories (sampleCharacter, etc.) |
| `runFullSync.ts` | Drive sync to completion with timeout |

## Common Pitfalls

1. **AsyncStorage state leaks between tests** — Always call `AsyncStorage.clear()`
   in `beforeEach`.
2. **Singleton state** — Always call `resetSyncServiceSingleton()` in `beforeEach`.
3. **Mock server state** — Always call `mockServer.reset()` in `afterEach`.
4. **Fake timers** — Do NOT use `jest.useFakeTimers()` (conflicts with
   `setImmediate` used by the mock server's async delivery).
