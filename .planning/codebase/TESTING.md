# Testing Patterns

**Analysis Date:** 2026-05-24

## Test Framework

**Runner:**
- Jest 29.6.3
- Config: `jest.config.js`
- Preset: `react-native`

**Assertion Library:**
- Jest built-in `expect`

**Run Commands:**
```bash
npm test                    # Run all Jest tests
npm test -- --watch         # Watch mode
```

**Additional Test Runners:**
- `run-db-tests.js`: Standalone Node.js script for database integration tests (runs via `node run-db-tests.js`)
- Database tests execute against a REAL SQLite database (not mocked)

**E2E (scaffolded but not active):**
- Appium MCP-based E2E test scaffolding was added (commit `23e8eb4`) with basic connection test
- Directory `e2e/` not present in current working tree
- Pattern used: `describe`/`it` with Jest in `e2e/appium/tests/basic-connection.test.ts`

## Test File Organization

**Location:**
- Root `__tests__/` directory for app-level integration tests (Jest)
- `src/database/__tests__/` for database repository tests (standalone runner)

**Naming:**
- `.test.ts` for unit/integration tests
- `.test.tsx` for React component tests

**Structure:**
```
__tests__/
├── App.test.tsx                    # Main app smoke test
└── services/
    └── SyncService.test.ts         # Service integration tests (631 lines)

src/database/__tests__/
├── characters.test.ts              # Character repository tests (401 lines)
├── entities.test.ts                # Entity repository tests (223 lines)
├── modules.test.ts                 # Module repository tests (299 lines)
├── providers.test.ts               # Provider repository tests (215 lines)
├── memories.test.ts                # Memory cleanup tests (235 lines) - NEW
├── test-utils.ts                   # Test helpers (TestResult, runTest, runTestWithCleanup)
└── run-all-tests.ts                # Comprehensive test runner with summary output
```

**Database test files last updated:**
- `memories.test.ts`: April 2026
- `characters.test.ts`: March 2026
- `entities.test.ts`: March 2026
- `modules.test.ts`: March 2026
- `providers.test.ts`: January 2026

## Test Structure

**Jest Tests (Root `__tests__/`):**
- Use `describe()` for grouping related tests
- Use `test()` or `it()` for individual tests
- Async tests with `async/await`
- `beforeEach`/`afterEach` for setup/teardown

**Database Tests (`src/database/__tests__/`):**
- NO Jest - custom test runner using exported async functions
- Each test file exports a `runXTests(): Promise<TestResult[]>` function
- Tests are named strings passed to `runTestWithCleanup()`
- Use `console.log` for output (not Jest's test runner)

**Pattern for database tests:**
```typescript
export async function runEntityTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  try {
    await initializeDatabase(true);
    await clearDatabaseData(true);

    results.push(
      await runTestWithCleanup('Create Entity', async () => {
        const testEntityId = 'test-entity-' + Date.now();
        const created = await entities.createEntity({ id: testEntityId, character_profile_id: null });
        if (!created || created.id !== testEntityId) {
          throw new Error('Entity creation failed or ID mismatch');
        }
      })
    );
    // ... more tests
  } catch (error) {
    console.error('Critical failure:', error);
  }
  return results;
}
```

## Database Test Utilities

**File:** `src/database/__tests__/test-utils.ts`

- `TestResult` interface: `{ name: string; passed: boolean; error?: string; duration?: number }`
- `runTest(name, fn)`: Wraps a test function, returns TestResult with timing
- `runTestWithCleanup(name, fn)`: Same as runTest but always runs `clearDatabaseData(true)` after (even on failure)

**Test Runner:** `src/database/__tests__/run-all-tests.ts`
- Orchestrates all database test suites in phases
- Prints formatted output with ✅/❌ indicators and timing
- Returns summary: "X tests | Y passed | Z failed"
- Phases: Entities → Characters → Modules → Providers

## Mocking

**Framework:** Jest

**Setup file:** `jest.setup.js` - Mocks for all React Native native modules:
- `react-native-sqlite-storage`: Mock `openDatabase` with `executeSql` stub
- `react-native-fs`: Mock file system operations
- `react-native-keychain`: Mock credential storage
- `@react-native-async-storage/async-storage`: Mock all storage methods
- `@react-native-documents/picker`: Mock document picker
- `react-native-paper`: Mock UI components as string mocks
- `react-native-vector-icons/MaterialCommunityIcons`: Mock as 'Icon' string
- `react-native-websocket-self-signed`: Mock WebSocket
- `react-native/Libraries/Utilities/Platform`: Mock Platform.select

**Patterns in SyncService test:**
```typescript
// Jest module mocking
jest.mock('react-native-device-info', () => ({
  getUniqueId: jest.fn(() => Promise.resolve('test-device-001')),
}));

jest.mock('../../src/database/sync');

// Type-safe mock function casting
const mockGetChangedRecords = SyncHelpers.getChangedRecords as jest.MockedFunction<typeof SyncHelpers.getChangedRecords>;

// Inline mock class for complex scenarios (MockConnectionManager)
class MockConnectionManager {
  // Simulates full server behavior
}
```

**What to Mock:**
- React Native native modules
- Database helpers in service tests
- External APIs and connections
- AsyncStorage in service/integration tests

**What NOT to Mock:**
- Business logic in pure TypeScript
- Repository functions in database tests (tested against real SQLite)

## Fixtures and Factories

**Patterns observed:**
- Inline test data creation in test functions using `Date.now()` for unique IDs
- Test entities use prefix + timestamp pattern: `'test-entity-' + Date.now()`
- Database tests create real records in SQLite, then verify them
- Service tests use in-memory Maps to simulate database storage

## Coverage

**Requirements:** Not explicitly enforced
**View Coverage:** Not configured in current Jest setup (no `--coverage` flag in npm scripts)

## Test Types

**Unit Tests:**
- `__tests__/services/SyncService.test.ts` (631 lines)
- Tests individual service methods with mocked dependencies
- Uses inline MockConnectionManager class to simulate full protocol flow

**Integration Tests:**
- `src/database/__tests__/*.test.ts` - All 5 database test files
- Test against real SQLite database with `initializeDatabase(true)` and `clearDatabaseData(true)`
- Tests CRUD operations, CASCADE deletes, error handling edge cases
- `memories.test.ts` tests orphaned memory cleanup with linked conversation messages

**E2E Tests:**
- Scaffolded via Appium MCP (commit `23e8eb4`) but directory not in current HEAD
- Would use `describe`/`it` pattern with Jest and http module for connectivity checks
- Not currently runnable

## Database Testing Pattern

**Setup/Teardown with real SQLite:**
```typescript
import { initializeDatabase, clearDatabaseData } from '../connection';
import * as characters from '../repositories/characters';
import { runTestWithCleanup, TestResult } from './test-utils';

export async function runCharacterTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  try {
    await initializeDatabase(true);    // Fresh DB with migrations
    await clearDatabaseData(true);     // Clean all data

    results.push(
      await runTestWithCleanup('Create Character Profile', async () => {
        const testProfileId = 'test-profile-' + Date.now();
        await characters.createCharacterProfile({
          id: testProfileId,
          name: 'Test Character',
          // ... all fields
        });
        // Verify by retrieving
        const retrieved = await characters.getCharacterProfile(testProfileId);
        if (!retrieved) throw new Error('Failed to create');
      })
    );
  } finally {
    await clearDatabaseData(true);
  }
  return results;
}
```

## Common Patterns

**Async Testing (Jest SyncService):**
```typescript
test('should sync data', async () => {
  // Setup using Promises for event-based assertions
  const syncCompleted = new Promise(resolve => syncService.on('sync:completed', resolve));
  
  await syncService.initiateSync();
  await syncCompleted;
  
  // Assert
  expect(characters.length).toBe(2);
}, 10000); // Timeout of 10s for async operations
```

**Error Testing (Jest):**
```typescript
it('should handle sync data errors gracefully', async () => {
  mockApplySyncRecord.mockRejectedValueOnce(new Error('Database error'));
  
  const syncCompleted = new Promise(resolve => syncService.on('sync:completed', resolve));
  await syncService.initiateSync();
  await syncCompleted;
  
  const errorConfirm = confirmEvents.find((e: any) => e.payload.status === 'ERROR');
  expect(errorConfirm).toBeDefined();
}, 10000);
```

**Error Testing (Database, throw-based):**
```typescript
// Tests expect functions to throw on invalid operations
await runTestWithCleanup('Delete Non-existent Entity (Error Handling)', async () => {
  try {
    await entities.deleteEntity('non-existent-id');
    throw new Error('Should have thrown error');
  } catch (error) {
    if ((error as Error).message === 'Should have thrown error') {
      throw error; // Re-throw if no error was thrown
    }
    // Correctly threw - test passes
  }
});
```

---

*Testing analysis: 2026-05-24*
