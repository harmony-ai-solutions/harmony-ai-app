# Testing Patterns

**Analysis Date:** 2026-03-05

## Test Framework

**Runner:**
- Jest 29.6.3
- Config: `jest.config.js`
- Preset: `react-native`

**Assertion Library:**
- Jest built-in expect

**Run Commands:**
```bash
npm test                    # Run all tests
npm test -- --watch         # Watch mode
npm test -- --coverage      # Coverage (if configured)
```

## Test File Organization

**Location:**
- Co-located with source in `__tests__/` directory for integration tests
- Co-located with source in `src/database/__tests__/` for database tests

**Naming:**
- `.test.ts` for unit/integration tests
- `.test.tsx` for React component tests

**Structure:**
```
__tests__/
├── App.test.tsx                    # Main app test
└── services/
    └── SyncService.test.ts         # Service tests

src/database/__tests__/
├── characters.test.ts              # Repository tests
├── entities.test.ts
├── modules.test.ts
├── providers.test.ts
├── test-utils.ts                   # Test helpers
└── run-all-tests.ts                # Test runner
```

## Test Structure

**Suite Organization:**
- Use `test()` function for individual tests
- Use `describe()` for grouping related tests
- Async tests with `async/await`

**Patterns:**

**Simple Component Test** from [`__tests__/App.test.tsx`](__tests__/App.test.tsx:9):
```typescript
test('renders correctly', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });
});
```

**Service Integration Test** from [`__tests__/services/SyncService.test.ts`](__tests__/services/SyncService.test.ts:1):
```typescript
/**
 * SyncService Test Suite
 * 
 * Mirrors the synchronization_test.go test suite from Harmony Link
 * Tests the complete bidirectional sync protocol flow using mocks
 */

import { SyncService } from '../../src/services/SyncService';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Mock modules
jest.mock('react-native-device-info', () => ({
  getUniqueId: jest.fn(() => Promise.resolve('test-device-001')),
  getDeviceName: jest.fn(() => Promise.resolve('Test Device')),
}));

jest.mock('react-native', () => ({
  Platform: {
    OS: 'test',
  },
}));

// Mock SyncHelpers
jest.mock('../../src/database/sync');
```

## Mocking

**Framework:** Jest

**Patterns:**

**Mocking React Native Modules** from [`jest.setup.js`](jest.setup.js:1):
```typescript
// Mock react-native-sqlite-storage
jest.mock('react-native-sqlite-storage', () => ({
  enablePromise: jest.fn(),
  DEBUG: jest.fn(),
  openDatabase: jest.fn(() => Promise.resolve({
    executeSql: jest.fn(() => Promise.resolve([{ rows: { length: 0, item: jest.fn() } }])),
    transaction: jest.fn(),
    close: jest.fn(() => Promise.resolve()),
  })),
}));

// Mock react-native-fs
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/mock/documents',
  mkdir: jest.fn(() => Promise.resolve()),
  exists: jest.fn(() => Promise.resolve(false)),
  unlink: jest.fn(() => Promise.resolve()),
  readFile: jest.fn(() => Promise.resolve('')),
  writeFile: jest.fn(() => Promise.resolve()),
}));

// Mock react-native-keychain
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: {
    WHEN_UNLOCKED: 'WhenUnlocked',
  },
  getGenericPassword: jest.fn(() => Promise.resolve(false)),
  setGenericPassword: jest.fn(() => Promise.resolve()),
  resetGenericPassword: jest.fn(() => Promise.resolve()),
}));

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
  clear: jest.fn(() => Promise.resolve()),
}));
```

**Mocking with Type Safety** from [`__tests__/services/SyncService.test.ts`](__tests__/services/SyncService.test.ts:30):
```typescript
// Import to get access to mocked functions
import * as SyncHelpers from '../../src/database/sync';

// Get the mocked functions
const mockGetChangedRecords = SyncHelpers.getChangedRecords as jest.MockedFunction<typeof SyncHelpers.getChangedRecords>;
const mockApplySyncRecord = SyncHelpers.applySyncRecord as jest.MockedFunction<typeof SyncHelpers.applySyncRecord>;
const mockToUnixTimestamp = SyncHelpers.toUnixTimestamp as jest.MockedFunction<typeof SyncHelpers.toUnixTimestamp>;
```

**What to Mock:**
- React Native native modules (sqlite, fs, keychain, etc.)
- Third-party services (device-info, async-storage)
- External APIs and network calls

**What NOT to Mock:**
- Business logic in pure TypeScript functions
- Repository functions (tested with real database via test utilities)

## Fixtures and Factories

**Test Data:**
- Inline test data creation in test functions
- Use timestamps for unique IDs (e.g., `'test-profile-' + Date.now()`)

**Location:**
- Test utilities in [`src/database/__tests__/test-utils.ts`](src/database/__tests__/test-utils.ts:1)

**Test Utilities** from [`src/database/__tests__/test-utils.ts`](src/database/__tests__/test-utils.ts:20):
```typescript
/**
 * Wrapper to run a test case and capture its result
 */
export async function runTest(
  name: string,
  testFn: () => Promise<void>
): Promise<TestResult> {
  const startTime = Date.now();
  try {
    await testFn();
    return {
      name,
      passed: true,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      name,
      passed: false,
      error: (error as Error).message || String(error),
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Wrapper to run a test case with automatic database cleanup
 */
export async function runTestWithCleanup(
  name: string,
  testFn: () => Promise<void>
): Promise<TestResult> {
  const result = await runTest(name, testFn);

  // Always cleanup after test, even if it failed
  try {
    await clearDatabaseData(true);
  } catch (error) {
    console.error(`[Test Cleanup] Failed to cleanup after "${name}":`, error);
  }

  return result;
}
```

## Coverage

**Requirements:** Not explicitly enforced

**View Coverage:** Not configured in current setup

## Test Types

**Unit Tests:**
- Test individual service methods with mocked dependencies
- Example: [`__tests__/services/SyncService.test.ts`](__tests__/services/SyncService.test.ts) - 632 lines

**Integration Tests:**
- Test database repositories with real SQLite database
- Use test utilities for setup/teardown
- Example: [`src/database/__tests__/characters.test.ts`](src/database/__tests__/characters.test.ts) - 409 lines

**E2E Tests:**
- Not detected in current codebase

## Database Testing Pattern

**Setup/Teardown** from [`src/database/__tests__/characters.test.ts`](src/database/__tests__/characters.test.ts:13):
```typescript
export async function runCharacterTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  try {
    console.log('[Test Setup] Initializing database...');
    await initializeDatabase(true);
    await clearDatabaseData(true);

    // Test 1: Create Character Profile
    results.push(
      await runTestWithCleanup('Create Character Profile', async () => {
        const testProfileId = 'test-profile-' + Date.now();
        await characters.createCharacterProfile({
          id: testProfileId,
          name: 'Test Character',
          description: 'A test character for database testing',
          // ... more fields
        });
      })
    );
    // ... more tests
  }
}
```

## Common Patterns

**Async Testing:**
```typescript
test('async operation', async () => {
  const result = await someAsyncFunction();
  expect(result).toBe(expectedValue);
});
```

**Error Testing:**
```typescript
test('throws error', async () => {
  await expect(async () => {
    await failingFunction();
  }).rejects.toThrow('Expected error message');
});
```

**Mocking Class Methods:**
```typescript
class MockConnectionManager {
  private eventHandlers: Map<string, Function> = new Map();
  
  on(event: string, handler: Function) {
    this.eventHandlers.set(event, handler);
  }
  
  async sendEvent(connectionType: string, event: any) {
    // Simulate server responses
  }
}
```

---

*Testing analysis: 2026-03-05*
