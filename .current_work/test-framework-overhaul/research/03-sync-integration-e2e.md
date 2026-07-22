# Research Report 3: Sync Integration Testing & E2E for React Native

**Date:** July 20, 2026
**Researcher:** code-expert subagent (session `ses_07f0073f7ffe4I5p6YIuRqcAlf`)
**Project context:** HarmonyAIChat — bidirectional sync protocol over self-signed-TLS WSS to a Go backend ("Harmony Link"). 7 message types: HANDSHAKE_REQUEST/ACCEPT, SYNC_REQUEST, SYNC_START, SYNC_DATA, SYNC_DATA_CONFIRM, SYNC_COMPLETE, SYNC_FINALIZE. Existing Jest test mocks the entire DB layer.

---

## 1. Executive Summary

### Integration Tests (Part A)

**Recommendation:** Rewrite the existing `__tests__/services/SyncService.test.ts` to use **real SQLite** via `sql.js` (or `better-sqlite3` for sync), paired with **`jest-websocket-mock`** for transport mocking at the WSS boundary. Avoid the current "mock-everything" approach where `jest.mock('../../src/database/sync')` replaces DB helpers — this hides schema drift and SQL bugs. Add a second suite of **Pact contract tests** (`@pact-foundation/pact-js` v17+) to verify that the TypeScript client sends the correct message shapes to the Go server.

### E2E Tests (Part B)

**Primary recommendation: Maestro** (CLI 2.7.0, July 2026). Surpassed Detox in community momentum (15k stars, 141 releases), supports RN 0.86 / New Architecture transparently (black-box), simplest YAML-based authoring. **Secondary recommendation: Detox** (20.51.3, May 2026, 12k stars) as fallback for gray-box synchronization.

## 2. Test Pyramid Recommendation

```
         ┌──────────────┐
         │    E2E (5%)   │  Maestro (preferred) or Detox
         │  Full app →   │  Full boot → DB migrate → WSS connect → sync → UI
         ├──────────────┤
         │ Integration   │  Jest + real SQLite + jest-websocket-mock
         │   (25%)       │  Conflict, retry, clock drift, network drops
         ├────────────┤
         │  Unit (70%)  │  Jest + RNTL
         └──────────────┘
```

## 3. Part A: Integration Testing for Sync

### 3.1 SQLite in Jest Tests — The Pattern

**Pattern from Expensify's App** (5k stars, 278k commits — largest RN codebase in the world): database abstraction layer, swap implementations in tests.

> Wrap your SQLite calls behind a thin facade. In production, use `op-sqlite` or `react-native-sqlite-storage`. In Jest tests, inject `sql.js` (or `better-sqlite3`).

**Recommended libraries:**
- Production: `op-sqlite` v17.1.2 (1k stars, 154 releases, fastest RN SQLite)
- Integration tests: `sql.js` (WASM, zero-config) or `better-sqlite3` (sync, 3-5x faster)
- Mock WS: `jest-websocket-mock` v2.5.0 (258k weekly downloads)

### 3.2 WebSocket Mocking — Current State

| Library | Stars | Last Release | Notes |
|---------|-------|-------------|-------|
| `jest-websocket-mock` v2.5.0 | ~1k | 2023 | Best DX, async matchers. Built on `mock-socket`. **Known issue:** incompatible with Jest fake timers. |
| `mock-socket` v9.0.0 | 805 | 2019 | Lower-level, stable. |

**For HarmonyAIChat:** `jest-websocket-mock` with `jsonProtocol: true` maps directly to the JSON protocol.

### 3.3 Pact Contract Testing — Is It Worth It?

**Verdict: Yes, but only for the Go server boundary.**

`@pact-foundation/pact-js` v17.0.1 (July 2026). Pact-Go for server side. Define contracts for each message exchange (HANDSHAKE_REQUEST → HANDSHAKE_ACCEPT, etc.). Catches field renames, type changes, missing fields between TS client and Go server.

**Limitation:** Pact assumes HTTP request/response. WSS bidirectional streaming isn't a natural fit — use Pact's message pact support, focus on individual message shapes.

### 3.4 Integration Test Code Sketch

```typescript
import WS from 'jest-websocket-mock';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { SyncService } from '../../src/services/SyncService';

jest.mock('../../src/services/wsFactory', () => ({
  createWebSocket: (url: string) => new WebSocket(url),
}));

describe('SyncService Integration — Real DB + Mocked WSS', () => {
  let server: WS;
  let db: SqlJsDatabase;
  let syncService: SyncService;
  const WSS_URL = 'wss://localhost:8443/harmony-link';

  beforeAll(async () => {
    server = new WS(WSS_URL, { jsonProtocol: true });
    const SQL = await initSqlJs();
    db = new SQL.Database();
    db.run(`CREATE TABLE records (id TEXT PRIMARY KEY, content TEXT NOT NULL, ...);`);
    // ... seed, instantiate SyncService with real DB
  });

  test('full sync cycle — HANDSHAKE through SYNC_FINALIZE', async () => {
    const syncPromise = syncService.startSync();
    await expect(server).toReceiveMessage({ type: 'HANDSHAKE_REQUEST', ... });
    server.send({ type: 'HANDSHAKE_ACCEPT', ... });
    // ... drive protocol, verify real DB state at the end
  });
});
```

(Full code sketch in original report.)

### 3.5 Integration Test Structure

```
__tests__/
  integration/
    SyncService.integration.test.ts    # Full sync cycle
    SyncService.disconnect.test.ts     # Network drop
    SyncService.concurrent.test.ts     # Concurrent syncs
  database/
    sync.test.ts                       # Unit tests for helpers
  contract/
    consumer.test.ts                   # Pact consumer tests
```

### 3.6 Patterns from Real Projects

| Project | Approach |
|---------|----------|
| **Expensify** (5k ⭐) | Jest with mocked DB layer. `__mocks__` directory extensively. React-Native-Onyx's in-memory adapter. |
| **PowerSync** | Full integration test suite testing sync engine against real SQLite + mocked server. |
| **Yjs** | Tests CRDT merging with real Yjs documents. Websocket provider tests use `mock-socket`. |
| **RxDB** | Comprehensive test suite with real IndexedDB + mocked replication. |

## 4. Part B: E2E Framework Comparison

### 4.1 Comparison Table

| Criteria | **Maestro** | **Detox** | **Appium 3** | **RNTL** |
|----------|-------------|-----------|--------------|----------|
| **GitHub Stars** | 15k ⭐ | 12k ⭐ | 19k ⭐ | 3.2k ⭐ |
| **Latest Release** | CLI 2.7.0 (Jul 20, 2026) | 20.51.3 (May 30, 2026) | 2.17.x (Jun 2026) | 14.x (2026) |
| **RN 0.86 / New Arch** | ✅ Black-box, transparent | ✅ RN 0.77–0.84 tested | ✅ Via drivers | ✅ Component-level |
| **Test Type** | Black-box (YAML) / Gray-box (JS) | Gray-box (Jest) | Black-box | Component |
| **Execution Speed** | Fast (interpreted YAML) | Medium | Slowest | Fastest |
| **Self-signed TLS** | Custom cert trust via env vars | Device-level trust profile | Device-level | N/A |
| **Community Momentum** | 🚀 Rapidly growing | 📈 Steady | 📉 Declining | 📈 Steady |

### 4.2 Maestro (Recommended Primary)

State in mid-2026: Strong and growing. mobile.dev built a complete ecosystem: Maestro CLI (open source), Maestro Studio (free desktop IDE), Maestro Cloud (paid). YAML-first approach is readable by non-engineers (QA, PMs).

**RN 0.86 support:** Black-box — drives native UI layer via UiAutomator2 (Android) and XCUITest (iOS). Doesn't care about RN internals. RN upgrades almost never break Maestro tests.

**Self-signed TLS:** Pass environment variables to app at launch via `env:` in flow YAML.

### 4.3 Detox (Recommended Secondary)

Solid and mature. Wix continues active maintenance. Latest 20.51.3 (May 2026). Officially supports RN 0.77–0.84 — RN 0.86 outside tested range but likely works.

**RN 0.86 concern:** Gray-box approach injects into JS runtime — needs to understand RN internals. May have edge cases with New Architecture default.

### 4.4 Appium 3

Still relevant when: cross-platform + browser + desktop testing. Slowest of the three, flakiest, hardest to debug. Not recommended for pure RN app.

### 4.5 RN Testing Library (RNTL)

Not E2E — but essential. v14.x (2026, Callstack). Standard for component-level testing.

## 5. Self-Signed TLS Handling

### 5.1 The Packages

| Package | Last Updated | Approach |
|---------|-------------|----------|
| `react-native-websocket-self-signed` | 2024 | Native modules accept any cert. `SecTrustSetExceptions` (iOS), custom `SSLSocketFactory` (Android). |
| `react-native-wss` | 2024 | Supports `ca`, `pfx`, `passphrase` options. Better for pinning specific certs. |

### 5.2 E2E Strategy

For Maestro:
```yaml
appId: com.harmonyai.chat
env:
  HARMONY_WSS_URL: wss://localhost:8443/harmony-link
  HARMONY_CA_CERT: |
    -----BEGIN CERTIFICATE-----
    MIID...
    -----END CERTIFICATE-----
---
- launchApp:
    env:
      CA_CERT: ${HARMONY_CA_CERT}
      WSS_URL: ${HARMONY_WSS_URL}
```

**Recommended:** `react-native-wss` (supports explicit CA certs) over self-signed variant.

## 6. CI Considerations

### Maestro (self-hosted)

```yaml
jobs:
  maestro:
    runs-on: macos-15
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4
      - run: npx react-native build-android --mode debug
      - run: ./scripts/start-test-server.sh &
      - run: curl -fsSL "https://get.maestro.mobile.dev" | bash
      - run: maestro test e2e/
```

### Cost Comparison

| Option | CI Runner Cost | Parallelism | Total Est. |
|--------|---------------|-------------|------------|
| Detox (self-hosted) | ~$0.08/min macOS | Free (Jest sharding) | ~$80–150/mo |
| Maestro (self-hosted) | Same | Free (sharding) | ~$80–150/mo |
| Maestro Cloud | N/A | Included | ~$200–500/mo |
| Detox + BrowserStack | ~$0 | ~$150/mo | ~$150/mo |

## 7. Open Risks / Things to Validate

1. `jest-websocket-mock` + Jest 29 compatibility (last release 2023).
2. `sql.js` WASM loading in Jest Node environment.
3. `react-native-wss` in E2E — env-var cert injection.
4. Detox RN 0.86 compatibility (only claims 0.84).
5. Go WSS test server in CI — deterministic cert generation, startup time.
6. Pact for WSS bidirectional patterns — imperfect fit.
7. Maestro Studio on Windows — requires WSL.
8. Test data isolation — `sql.js` `new SQL.Database()` performance.
9. Parallel integration tests — `sql.js` synchronous, may need `--runInBand`.
10. Time-sensitive sync tests — fake timers conflict with `jest-websocket-mock`.

## 8. Sources

| URL | Summary |
|-----|---------|
| github.com/wix/Detox | 12k stars, 20.51.3 (May 2026), RN 0.77–0.84 supported. |
| github.com/mobile-dev-inc/maestro | 15k stars, CLI 2.7.0 (Jul 2026), YAML-based. |
| docs.maestro.dev | YAML flows, Maestro Cloud, Maestro Studio. |
| npmjs.com/package/jest-websocket-mock | v2.5.0, 258k weekly downloads. |
| github.com/thoov/mock-socket | 805 stars, underlying engine. |
| github.com/OP-Engineering/op-sqlite | 1k stars, v17.1.2 (Jul 2026), fastest RN SQLite. |
| github.com/Expensify/App | 5k stars, largest RN codebase. |
| github.com/pact-foundation/pact-js | 1.8k stars, v17.0.1 (Jul 2026). |
| docs.pact.io | Consumer-driven contract testing. |
| appium.io | Appium 3 docs. |
| callstack.github.io/react-native-testing-library/ | v14.x (2026). |
| github.com/facebook/react-native/releases | RN 0.86.0 (Jun 2026), 0.87.0-rc.0 (Jul 2026). |
| npmjs.com/package/react-native-websocket-self-signed | Bypasses cert validation. |
| npmjs.com/package/react-native-wss | Supports `ca`, `pfx`, `passphrase`. |
| github.com/facebook/react-native/issues/30341 | WebSocket cert support issue. |
| electric-sql.com | Postgres sync engine. |
| www.powersync.com | Sync engine for SQLite. |
| blog.codemagic.io/testing-local-database-for-react-native | Guide to testing RN DB with Jest + sql.js. |
| dev.to/eira-wexford/best-sqlite-solutions... | 2026 SQLite options for RN. |
