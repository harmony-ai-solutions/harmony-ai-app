# Phase 4-3: Edge Case Scenarios

## Objective

Add the failure-mode and edge-case scenarios that the happy-path test in Phase 4-2 doesn't cover: conflicts, network drops mid-sync, retry logic, clock drift, partial failures, and concurrent sessions. These are where sync bugs hide.

## Context

The happy-path integration test (Phase 4-2) proves the protocol works when everything succeeds. Real-world sync rarely succeeds cleanly — devices go offline mid-sync, server and client disagree on timestamps, conflicts arise when both sides edit the same record. The existing tests don't exercise any of this.

The `HarmonyLinkMockServer` from Phase 4-1 needs to support manual step-by-step driving (not just `startAutoResponder`) so each test can inject failures at specific points in the protocol.

## Prerequisites

- Phase 4-1 complete (mock infrastructure, `HarmonyLinkMockServer`).
- Phase 4-2 complete (happy-path integration test works).

## Implementation Steps

### 1. Extend `HarmonyLinkMockServer` for failure injection

The class needs methods for:

```typescript
class HarmonyLinkMockServer {
  // ... existing happy-path methods

  /** Close the connection unceremoniously (simulates network drop). */
  dropConnection(): void;

  /** Send an ERROR status for a specific event type. */
  sendError(eventType: string, errorMessage: string): void;

  /** Delay the next response by N ms (simulates slow server). */
  delayNextResponse(ms: number): void;

  /** Don't auto-respond — wait for explicit send() calls (manual mode). */
  setManualMode(manual: boolean): void;

  /** Track the current protocol state for assertions. */
  get currentPhase(): 'IDLE' | 'HANDSHAKE' | 'SYNC_REQUEST' | 'SYNC_START' | 'SYNC_DATA' | 'SYNC_COMPLETE' | 'SYNC_FINALIZE';
}
```

### 2. Conflict resolution tests

Reference `SyncService.ts` for the actual conflict strategy (likely "server wins" or "last-write-wins by timestamp"). Then test both directions:

```typescript
describe('conflict resolution', () => {
  it('server overwrites client when server timestamp is newer', async () => {
    // 1. Seed local DB with a character at timestamp T
    await db.executeSql(
      `INSERT INTO character_profiles (id, name, ..., updated_at)
       VALUES ('char-conflict', 'Local Name', ..., ?)`,
      [new Date(Date.now() - 5000).toISOString()],
    );

    // 2. Sync — server sends same ID with newer timestamp
    mockServer.setServerData('character_profiles', [
      {
        id: 'char-conflict',
        name: 'Server Name',
        updated_at: new Date(Date.now() - 1000).toISOString(), // newer
        // ...
      },
    ]);

    await runFullSync(syncService);

    // 3. Verify server version won
    const [r] = await db.executeSql(
      "SELECT name FROM character_profiles WHERE id = 'char-conflict'",
    );
    expect(r.rows.item(0).name).toBe('Server Name');
  });

  it('client overwrites server when client timestamp is newer', async () => {
    // ... mirror of above, with timestamps reversed
  });

  it('soft-deleted record on server overrides local update', async () => {
    // Port from existing test scenario, with real DB assertions
  });
});
```

### 3. Network drop + retry tests

```typescript
describe('network resilience', () => {
  it('recovers when connection drops during HANDSHAKE', async () => {
    // 1. Initiate sync
    const syncPromise = syncService.initiateSync();

    // 2. Server drops connection immediately
    await mockServer.waitForConnection();
    mockServer.dropConnection();

    // 3. Verify SyncService emits error state
    await expect(syncPromise).rejects.toThrow(/* or emits sync:error */);

    // 4. New server starts (simulates reconnect)
    mockServer = new HarmonyLinkMockServer(WSS_URL);

    // 5. Retry succeeds
    const completedPromise = new Promise<void>(resolve =>
      syncService.on('sync:completed', () => resolve()),
    );
    await syncService.initiateSync();
    await completedPromise;
  });

  it('recovers when connection drops mid-SYNC_DATA', async () => {
    // 1. Server is sending a batch of SYNC_DATA messages
    // 2. Connection drops after 3 of 10 records
    // 3. Verify: client has the 3 received records, no partial transactions
    // 4. Reconnect — verify sync resumes from where it left off (or restarts)
  });

  it('times out if server is unresponsive', async () => {
    // 1. Initiate sync
    // 2. Server accepts connection but never responds to HANDSHAKE_REQUEST
    // 3. Verify SyncService times out after configured duration
    // 4. Verify cleanup (no leaked pendingHandshake promises)
  });
});
```

**Fake timers caveat**: `jest-websocket-mock` uses real `setTimeout`. If sync's timeout logic is short (e.g., 30s), tests can use real timers but will be slow. If timeouts are long (e.g., 5min), fake timers are needed but conflict with `jest-websocket-mock`. Resolution options:

- **Option A**: Make timeout configurable via SyncService constructor, set to 100ms in tests, use real timers.
- **Option B**: Use `jest.useFakeTimers({doNotFake: ['setTimeout']})` (Jest 30 supports per-function opt-out).
- **Option C**: Use real timers and accept slow tests for these specific cases.

Option A is cleanest. Add a `timeoutMs` parameter to `SyncService`:

```typescript
constructor(
  private connectionManager: ConnectionManager,
  private timeoutMs: number = 30_000,  // default
) { ... }
```

### 4. Clock drift tests

The sync protocol handles clock drift (see `clock_drift_seconds` in the existing test's mock server response, and `toUnixTimestamp` / `normalizeTimestampForSync` in `database/sync.ts`).

```typescript
describe('clock drift handling', () => {
  it('normalizes SQLite CURRENT_TIMESTAMP to ISO 8601 before sending', async () => {
    // 1. Insert a record using SQLite's CURRENT_TIMESTAMP (space separator)
    await db.executeSql(
      `INSERT INTO character_profiles (id, name, ..., created_at, updated_at)
       VALUES ('char-time', 'Test', ..., CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    );

    // 2. Sync — capture the SYNC_DATA event the client sends
    const sentEvents: any[] = [];
    mockServer.onEvent('SYNC_DATA', e => sentEvents.push(e));

    await runFullSync(syncService);

    // 3. Verify timestamps in sent records are ISO 8601 (have 'T')
    const charEvent = sentEvents.find(
      e => e.payload.table === 'character_profiles' &&
           e.payload.record.id === 'char-time',
    );
    expect(charEvent.payload.record.created_at).toMatch(/\dT\d/);
    expect(charEvent.payload.record.updated_at).toMatch(/\dT\d/);
  });

  it('handles server reporting positive clock drift', async () => {
    // Server's clock_drift_seconds > 0
    // Verify client adjusts outgoing timestamps accordingly
  });

  it('handles server reporting negative clock drift', async () => {
    // Server's clock_drift_seconds < 0
  });
});
```

### 5. Partial failure tests

```typescript
describe('partial sync failures', () => {
  it('continues syncing other records when one fails', async () => {
    // 1. Server sends 3 SYNC_DATA records
    // 2. Second record triggers a SQL error (e.g., FK violation)
    // 3. Verify: records 1 and 3 succeeded, record 2 sent SYNC_DATA_CONFIRM with status=ERROR
    // 4. Verify: sync overall completes (doesn't abort the whole session)
  });

  it('sends SYNC_DATA_CONFIRM with ERROR status on apply failure', async () => {
    // Same scenario, focused on the confirm message
    const confirmEvents: any[] = [];
    mockServer.onEvent('SYNC_DATA_CONFIRM', e => confirmEvents.push(e));

    // Force applySyncRecord to fail for one record (e.g., by locking the table)
    // ...

    await runFullSync(syncService);

    const errorConfirm = confirmEvents.find(e => e.payload.status === 'ERROR');
    expect(errorConfirm).toBeDefined();
  });

  it('rolls back buffered data if SYNC_COMPLETE never arrives', async () => {
    // SyncService buffers incoming SYNC_DATA and applies atomically on SYNC_COMPLETE.
    // If the server drops connection before SYNC_COMPLETE, verify nothing was applied.
    // (Confirms the buffer's transactional integrity.)
  });
});
```

### 6. Concurrent session tests

```typescript
describe('concurrent sync sessions', () => {
  it('rejects a second sync while one is in progress', async () => {
    // Start sync, don't complete it
    const firstSyncPromise = syncService.initiateSync();

    // Try to start a second
    await expect(syncService.initiateSync()).rejects.toThrow(/in progress/i);

    // Cleanup: let the first one finish or abort
  });

  it('handles UI-triggered sync while background sync is running', async () => {
    // Simulate the ChatDetailScreen triggering a sync while a periodic background sync is mid-flight
  });
});
```

### 7. Test data fixtures

Create a fixtures file to reduce boilerplate:

```typescript
// __tests__/integration/helpers/fixtures.ts

export const sampleCharacter = (overrides: Partial<any> = {}) => ({
  id: `char-${Math.random().toString(36).slice(2, 10)}`,
  name: 'Test Character',
  description: 'Test description',
  personality: 'Friendly',
  appearance: '',
  backstory: '',
  voice_characteristics: '',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  deleted_at: null,
  ...overrides,
});

export const sampleEntity = (overrides: Partial<any> = {}) => ({
  id: `entity-${Math.random().toString(36).slice(2, 10)}`,
  alias: '',
  character_profile_id: null,
  lifecycle_config: null,
  rag_reindex_required: 1,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  deleted_at: null,
  ...overrides,
});

// ... and so on for each syncable table
```

### 8. Helper to drive a full sync to completion

```typescript
// __tests__/integration/helpers/runFullSync.ts

export async function runFullSync(
  syncService: SyncService,
  timeoutMs: number = 10_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Sync did not complete within timeout')),
      timeoutMs,
    );

    syncService.on('sync:completed', () => {
      clearTimeout(timeout);
      resolve();
    });
    syncService.on('sync:error', (err: string) => {
      clearTimeout(timeout);
      reject(new Error(err));
    });

    syncService.initiateSync().catch(reject);
  });
}
```

## Files to Create

- `__tests__/integration/sync.conflict.test.ts`
- `__tests__/integration/sync.network.test.ts`
- `__tests__/integration/sync.clock.test.ts`
- `__tests__/integration/sync.failures.test.ts`
- `__tests__/integration/sync.concurrent.test.ts`
- `__tests__/integration/helpers/fixtures.ts`
- `__tests__/integration/helpers/runFullSync.ts`

## Files to Modify

- `__tests__/integration/helpers/HarmonyLinkMockServer.ts` — add failure-injection methods
- `src/services/SyncService.ts` — add `timeoutMs` constructor parameter (Option A above) if fake-timers conflict materializes

## Validation

- [ ] Conflict tests pass for both directions (server-wins, client-wins)
- [ ] Network-drop tests verify cleanup (no leaked promises, no partial transactions)
- [ ] Clock drift tests confirm timestamp normalization in outgoing records
- [ ] Partial failure tests confirm atomicity (buffered data either fully applies or doesn't apply at all)
- [ ] Concurrent session tests confirm serialization
- [ ] All edge-case tests run in <30s total (use real timers with short timeouts where needed)
- [ ] No flakes across 5 consecutive runs (sync tests are notoriously flaky — be honest about this)

## Open Questions to Resolve During Implementation

- **What's the actual conflict resolution strategy?** Read `SyncService.ts` and `database/sync.ts` carefully. The tests must match the actual behavior, not assumed behavior.
- **Does SyncService serialize sync requests, or can multiple run concurrently?** The `currentSession` state suggests serialization, but verify.
- **What's the timeout duration in production?** If it's long (>30s), tests need to override it.
- **Are there race conditions in the buffer-flushing logic?** The `incomingDataBuffer` is flushed on SYNC_COMPLETE — what happens if SYNC_COMPLETE arrives while a previous flush is still running?

## Estimated Effort

Three to four days. Edge cases multiply, and sync tests are inherently fiddly. Budget for iteration and flake investigation.

## Spike Item

Before writing all the failure tests, validate that `jest-websocket-mock` can actually simulate a dropped connection mid-stream. If it can't, fall back to `mock-socket` directly or write a thin custom wrapper around `ws` (the Node WebSocket library).
