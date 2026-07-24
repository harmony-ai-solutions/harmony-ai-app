# Phase 4-2: SyncService Integration Test

> **STATUS: ✅ COMPLETE.** Initial implementation quarantined the old test to
> `__tests__/services/__legacy__/`. **Post-plan cleanup deleted it entirely**
> — see "Legacy test final disposition" at the bottom of this file.

## Objective

Replace the existing mock-everything `__tests__/services/SyncService.test.ts` with a real integration test that exercises `SyncService` + `ConnectionManager` + `NodeDatabase` (running real SQL) end-to-end. The only mocked boundary is the WebSocket transport itself.

## Context

The current test (`__tests__/services/SyncService.test.ts`) does this:

```typescript
jest.mock('../../src/database/sync');  // Mock the entire DB helper layer
const mockGetChangedRecords = SyncHelpers.getChangedRecords as jest.MockedFunction<...>;
// ... provides a fake Map<string, any[]> as "the database"

class MockConnectionManager {
  // Simulates the server inline with setTimeout
}

beforeEach(() => {
  (SyncService as any).instance = null;
  syncService = SyncService.getInstance();
  (syncService as any).connectionManager = mockConnectionManager;  // Direct property override
});
```

**Why this is bad**: the test mocks the entire DB layer, so any drift between the SQL the real helpers generate and what the schema actually expects is invisible. A migration that renames a column or changes a type silently breaks sync in production but passes the test.

The new test keeps the DB layer real (via the `NodeDatabase` adapter from Phase 2-2) and only mocks the WebSocket. This catches:
- SQL errors in `getChangedRecords` / `applySyncRecord` after schema changes
- Wrong column types (e.g., expecting `INTEGER` but receiving `TEXT`)
- Missing columns after a migration
- Actual transaction behavior (commit/rollback on conflict)

## Prerequisites

- Phase 2 complete.
- Phase 4-1 complete (mock WSS infrastructure, `ConnectionManager` uses the WebSocket factory).

## Implementation Steps

### 1. Quaratine or delete the old test

The existing `__tests__/services/SyncService.test.ts` will be replaced. Options:

- **Delete**: cleanest, but loses the protocol assertions that document expected message orderings.
- **Quarantine**: move to `__tests__/services/__legacy__/SyncService.test.ts` with a comment explaining why it's not the canonical test.

Recommended: delete after extracting the protocol assertions into the new integration test.

### 2. Reset `SyncService` singleton state in tests

`SyncService` is a singleton with a private constructor. The existing test resets it via `(SyncService as any).instance = null`. Preserve this pattern but extract to a helper:

```typescript
// __tests__/integration/helpers/resetSyncService.ts

export function resetSyncServiceSingleton(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (SyncService as any).instance = null;
}
```

### 3. Build the integration test setup

Create `__tests__/integration/syncService.integration.test.ts`:

```typescript
/**
 * @jest-environment jsdom
 */
import WS from 'jest-websocket-mock';
import {SyncService} from '../../src/services/SyncService';
import {createInMemoryDatabase} from '../../src/database/__test_utils__/testDatabase';
import {runMigrations} from '../../src/database/migrations';
import type {NodeDatabase} from '../../src/database/__test_utils__/nodeDatabase';
import * as syncHelpers from '../../src/database/sync';
import {resetSyncServiceSingleton} from './helpers/resetSyncService';
import {HarmonyLinkMockServer} from './helpers/HarmonyLinkMockServer';

// Mock native modules that sync touches but we don't need to exercise
jest.mock('react-native-device-info', () => ({
  getUniqueId: jest.fn(() => Promise.resolve('test-device-001')),
  getDeviceName: jest.fn(() => Promise.resolve('Test Device')),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
  clear: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../src/utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
  }),
}));

const WSS_URL = 'wss://localhost:8443/harmony-link';

describe('SyncService integration', () => {
  let db: NodeDatabase;
  let mockServer: HarmonyLinkMockServer;
  let syncService: SyncService;

  beforeEach(async () => {
    // 1. Fresh in-memory DB with migrations applied
    db = createInMemoryDatabase();
    await runMigrations(db, true);

    // 2. Mock AsyncStorage state
    (require('@react-native-async-storage/async-storage').getItem as jest.Mock)
      .mockResolvedValue(null);

    // 3. Start mock WSS server
    mockServer = new HarmonyLinkMockServer(WSS_URL);
    await mockServer.waitForConnection(); // pre-start

    // 4. Reset singleton and create fresh SyncService
    resetSyncServiceSingleton();
    syncService = SyncService.getInstance();

    // 5. Override the DB getters to return our test DB
    // This requires either:
    //   (a) jest.mock('../../src/database/connection', ...) returning our db, OR
    //   (b) dependency injection on SyncService (preferred long-term — out of scope here)
    jest.doMock('../../src/database/connection', () => ({
      getDatabase: () => db,
      getSyncDatabase: async () => db,
    }));
  });

  afterEach(async () => {
    WS.clean();
    await db.close();
    jest.resetModules();
  });

  describe('happy path — new device', () => {
    it('completes a full sync cycle', async () => {
      // Seed server-side data
      mockServer.setServerData('character_profiles', [
        {
          id: 'char-1',
          name: 'Test Character',
          description: 'Test',
          personality: 'Friendly',
          created_at: new Date(Date.now() - 10000).toISOString(),
          updated_at: new Date(Date.now() - 10000).toISOString(),
          deleted_at: null,
        },
      ]);

      // Drive sync
      const completedPromise = new Promise<void>(resolve =>
        syncService.on('sync:completed', () => resolve()),
      );
      await syncService.initiateSync();
      await completedPromise;

      // VERIFY: real DB has the character
      const [result] = await db.executeSql(
        "SELECT * FROM character_profiles WHERE id = 'char-1'",
      );
      expect(result.rows.length).toBe(1);
      expect(result.rows.item(0).name).toBe('Test Character');
    });
  });

  // ... more test cases in Phase 4-3
});
```

### 4. Implement the `HarmonyLinkMockServer` helper

Flesh out the class started in Phase 4-1. It needs to:

- Accept a `setServerData(table, records)` call that pre-populates what the "server" will send during SYNC_DATA
- Drive the protocol forward automatically for happy-path tests via `startAutoResponder()`
- Allow manual step-by-step driving for conflict/retry tests (don't use auto-responder)
- Track all received events in `receivedEvents` for assertions

Reference: the existing `MockConnectionManager` in the deleted test (still readable in git history if useful) shows the protocol sequence.

### 5. Implement the DB override mechanism

The `jest.doMock('../../src/database/connection', ...)` approach in the sketch above works but is fragile. Better approach: refactor `SyncService` to accept a Database dependency at construction time. This is a larger change but pays off across all tests.

Two options:

**Option A: Quick — module-level mock**

```typescript
jest.mock('../../src/database/connection', () => ({
  getDatabase: () => testDb,
  getSyncDatabase: async () => testDb,
}));
```

Works today, requires no SyncService refactor. Acceptable for Phase 4.

**Option B: Long-term — dependency injection**

```typescript
// SyncService.ts
export class SyncService extends EventEmitter<...> {
  constructor(
    private connectionManager: ConnectionManager,
    private getDb: () => Promise<Database>,
    private getSyncDb: () => Promise<Database>,
  ) { ... }
}
```

Singleton accessor pulls defaults from current modules; tests construct directly. Defer to Phase 8 backlog.

Use Option A for now.

### 6. Implement the core test cases

Port the test cases from the deleted `SyncService.test.ts`, but with real DB:

1. **New device — empty DB** (server has data, client pulls everything)
2. **New device — with existing content** (bidirectional first sync)
3. **Existing device — server updates only** (incremental pull)
4. **Existing device — client updates only** (incremental push)
5. **Existing device — with deletes** (soft-delete propagation both directions)
6. **Protocol flow** (verify event ordering: REQUEST → START → COMPLETE → FINALIZE)
7. **Last sync timestamp update** (verify AsyncStorage write)

For each, the assertions should check:
- WSS messages sent (via `mockServer.receivedEvents`)
- **Real DB state** (rows actually inserted/updated/deleted via `db.executeSql`)
- Event emissions (`sync:started`, `sync:completed`)

### 7. Run and iterate

```bash
npx jest syncService.integration
```

Investigate any failures. Most will be:
- Mock protocol mismatch (the canned server response doesn't match what `SyncService` expects — fix the mock)
- Real SQL bug in a sync helper (a query that worked against the old `Map<string, any[]>` mock but fails against real schema — **fix the bug, this is the test paying off**)
- Timing issue (sync didn't complete before assertion — increase timeout or use the `sync:completed` event promise)

## Files to Create

- `__tests__/integration/syncService.integration.test.ts` — the main test
- `__tests__/integration/helpers/resetSyncService.ts`
- (Phase 4-1 already created `HarmonyLinkMockServer.ts`)

## Files to Modify

- `__tests__/services/SyncService.test.ts` — delete or move to `__legacy__/`

## Validation

- [ ] Integration test runs under `jest-environment-jsdom`
- [ ] At least the "new device — empty DB" happy path passes
- [ ] Real DB assertions succeed (not just mock-state assertions)
- [ ] Mock server log shows expected event ordering
- [ ] No regressions in the existing unit tests (`__tests__/App.test.tsx`)

## Open Questions to Resolve During Implementation

- **How does `SyncService` actually get its DB?** It calls `getDatabase()` / `getSyncDatabase()` directly. Confirm the module-level mock approach works, or use `(syncService as any).getDb = () => testDb` style override.
- **What's the exact message envelope?** The existing test uses `{event_type, status, payload}`. Confirm this matches what `ConnectionManager` actually emits / receives.
- **Does the mock server need to handle JWT tokens, clock drift negotiation, or other handshake details?** Read `SyncService.routeSyncEvent` for the full protocol.

## Estimated Effort

Two to three days. The protocol mock is the bulk of the work — designing a server that drives the state machine correctly without being too rigid takes iteration.

---

## Legacy test final disposition

> **STATUS: ✅ DELETED** (post-plan cleanup, July 2026).

The initial Phase 4-2 implementation chose the "Quarantine" option from
section 1: the old `__tests__/services/SyncService.test.ts` was moved to
`__tests__/services/__legacy__/SyncService.test.ts` with a `@deprecated QUARANTINED`
header. It was excluded from Jest runs via `testPathIgnorePatterns` in
`jest.config.js`.

In a post-plan review pass, the file was **deleted entirely** along with the
now-empty `__legacy__/` directory. Rationale:

1. The protocol knowledge it preserved was fully extracted into
   `__tests__/integration/helpers/HarmonyLinkMockServer.ts` (the living,
   working replacement).
2. The 8 happy-path tests in `__tests__/integration/syncService.integration.test.ts`
   plus 14 edge-case tests across 5 files cover everything the legacy test
   attempted to cover — and they actually pass.
3. Git history preserves the file permanently if anyone needs to reference
   the old inline `MockConnectionManager`.
4. A 658-line `__legacy__/` test file with a deprecation header invites
   "should I fix this?" questions from future contributors — confusing.

The corresponding entry in `jest.config.js`'s `testPathIgnorePatterns`
(`/__tests__/services/__legacy__/`) was also removed. The `docs/TESTING.md`
"Legacy (Quarantined)" subsection was removed.

**Affected files (post-plan cleanup)**:
- ❌ Deleted: `__tests__/services/__legacy__/SyncService.test.ts`
- ✏️ Edited: `jest.config.js` (removed legacy entry from `testPathIgnorePatterns`)
- ✏️ Edited: `docs/TESTING.md` (removed "Legacy (Quarantined)" subsection)
