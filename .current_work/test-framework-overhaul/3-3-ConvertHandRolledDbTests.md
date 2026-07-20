# Phase 3-3: Convert Hand-Rolled DB Tests to Real Jest

## Objective

Re-implement the test cases that were deleted in Phase 1-2 as real Jest tests using the `Database` interface and `NodeDatabase` adapter. The old tests used a custom `runTest`/`runTestWithCleanup` framework and required the in-app runtime; the new tests run under plain Jest in Node.

## Context

The deleted files contained valuable test logic — they verified that repository functions like `createEntity`, `getEntity`, `updateEntity`, `createCharacter`, etc. actually work. That logic must be preserved in the new Jest-based form.

Phase 1-2 produced a `test-cases-inventory.md` enumerating every deleted test case. This phase ports them.

## Prerequisites

- Phase 1-2 complete (the inventory of deleted tests exists).
- Phase 2 complete (the `Database` interface, `NodeDatabase` adapter, and refactored repositories exist).
- Phase 3-1 complete (the migration test infrastructure exists, including `createMigratedDatabase` helper).

## Implementation Steps

### 1. Read the inventory

Open `.current_work/test-framework-overhaul/test-cases-inventory.md` (produced in Phase 1-2). It lists every test case from the deleted files: name, what it tested, expected behavior.

If the inventory is missing or incomplete, recover the test cases from git history:

```bash
git show pre-test-runner-deletion:src/database/__tests__/entities.test.ts
# ... and so on for each deleted file
```

### 2. Set up shared test fixtures

Create `src/database/__tests__/repositoryFixtures.ts`:

```typescript
import {createInMemoryDatabase} from '../__test_utils__/testDatabase';
import {runMigrations} from '../migrations';
import type {NodeDatabase} from '../__test_utils__/nodeDatabase';

/**
 * Jest beforeEach/afterEach hooks that give each test a fresh migrated DB.
 *
 * Usage:
 *   describe('entities repo', () => {
 *     useFreshDatabase();
 *     it('creates an entity', async () => {
 *       const db = getTestDatabase();
 *       const e = await createEntity({id: 'e1', ...});
 *       // ...
 *     });
 *   });
 */
export function useFreshDatabase() {
  let db: NodeDatabase;

  beforeEach(async () => {
    db = createInMemoryDatabase();
    await runMigrations(db, true);
  });

  afterEach(async () => {
    await db.close();
  });

  return {
    getDb: () => db,
  };
}

/** Alternate pattern: per-test fresh DB via async helper. */
export async function withFreshDatabase<T>(
  fn: (db: NodeDatabase) => Promise<T>,
): Promise<T> {
  const db = createInMemoryDatabase();
  try {
    await runMigrations(db, true);
    return await fn(db);
  } finally {
    await db.close();
  }
}
```

### 3. Port the entities tests

Create `src/database/__tests__/repositories/entities.test.ts`:

```typescript
import {createEntity, getEntity, getAllEntities, updateEntity} from '../../repositories/entities';
import {useFreshDatabase} from '../repositoryFixtures';

describe('entities repository', () => {
  const {getDb} = useFreshDatabase();

  describe('createEntity', () => {
    it('creates an entity with the given ID', async () => {
      const id = 'test-entity-' + Date.now();
      const created = await createEntity({
        id,
        character_profile_id: null,
      });
      expect(created).toBeDefined();
      expect(created.id).toBe(id);
    });

    it('persists the entity', async () => {
      const id = 'test-entity-persist';
      await createEntity({id, character_profile_id: null});
      const retrieved = await getEntity(id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(id);
    });
  });

  describe('getEntity', () => {
    it('returns null for non-existent ID', async () => {
      const result = await getEntity('does-not-exist');
      expect(result).toBeNull();
    });

    it('excludes soft-deleted entities by default', async () => {
      // Port from deleted test: create, soft-delete, verify getEntity returns null
      // ... actual implementation depends on the deleted test logic
    });

    it('includes soft-deleted entities when includeDeleted=true', async () => {
      // Port from deleted test
    });
  });

  // ... continue porting every test case from the inventory
});
```

### 4. Port each deleted test file

For each of the five deleted files:
- `entities.test.ts` → `src/database/__tests__/repositories/entities.test.ts`
- `characters.test.ts` → `src/database/__tests__/repositories/characters.test.ts`
- `modules.test.ts` → `src/database/__tests__/repositories/modules.test.ts`
- `providers.test.ts` → `src/database/__tests__/repositories/providers.test.ts`
- `memories.test.ts` → `src/database/__tests__/repositories/memories.test.ts`

For each, walk through the inventory and port every test case. Use idiomatic Jest:
- `it('does X', async () => {...})` instead of `runTestWithCleanup('does X', async () => {...})`
- `expect(...).toBe(...)` instead of `if (x !== y) throw new Error(...)`
- `beforeEach` for DB setup instead of explicit `clearDatabaseData` calls

The custom framework's `runTestWithCleanup` cleared the DB between tests — the new `useFreshDatabase` fixture achieves the same by creating a new in-memory DB per test.

### 5. Handle cross-repository tests

Some tests in the deleted files likely exercised relationships between repositories (e.g., creating an entity, then a character linked to it, then deleting the entity and verifying cascade behavior). Group these into a `cross-repo.test.ts`:

```typescript
// src/database/__tests__/repositories/cross-repo.test.ts

describe('cross-repository behavior', () => {
  const {getDb} = useFreshDatabase();

  it('deleting a character cascades to dependent rows', async () => {
    // Port from deleted test if any covered FK cascade behavior
  });
});
```

### 6. Identify gaps in the original tests

While porting, you'll likely find:
- Test cases that were trivially true (e.g., `getAllEntities()` was called but its return value never asserted)
- Missing coverage for repository functions that exist but weren't tested
- Tests that depended on RN-specific behavior (e.g., number-binding) that need the `mimicRnNumberBinding` flag from Phase 2-4

Note these gaps in `.current_work/test-framework-overhaul/repository-test-gaps.md` for future work.

### 7. Run the new tests

```bash
npx jest src/database/__tests__/repositories/
```

All should pass. Investigate any failures — most will be either:
- A test that was incorrectly ported (fix the test)
- A bug in a repository function that the old test missed (fix the bug — this is a win)
- A number-binding divergence (apply `mimicRnNumberBinding: true` to the test's `NodeDatabase`)

## Files to Create

- `src/database/__tests__/repositoryFixtures.ts`
- `src/database/__tests__/repositories/entities.test.ts`
- `src/database/__tests__/repositories/characters.test.ts`
- `src/database/__tests__/repositories/modules.test.ts`
- `src/database/__tests__/repositories/providers.test.ts`
- `src/database/__tests__/repositories/memories.test.ts`
- `src/database/__tests__/repositories/cross-repo.test.ts` (if cross-repo cases exist)
- `.current_work/test-framework-overhaul/repository-test-gaps.md`

## Validation

- [ ] Every test case from the deleted files has a corresponding `it(...)` block in the new tests (cross-check against the inventory)
- [ ] `npx jest src/database/__tests__/repositories/` passes
- [ ] No remaining references to `runTest`, `runTestWithCleanup`, or `TestResult` (use Grep tool to confirm)
- [ ] Any bugs discovered during porting are either fixed or filed as separate issues
- [ ] Repository test gaps documented for future work

## Open Questions to Resolve During Implementation

- **Did the deleted tests cover soft-delete and `deleted_at` semantics?** The memories table has a `deleted_at` column (migration 000017). Verify the old tests covered soft-delete; add coverage if missing.
- **Did the deleted tests verify FK cascade behavior?** The schema has `ON DELETE CASCADE` and `ON DELETE RESTRICT` constraints. Verify the old tests exercised these.
- **Are there repository functions that have zero coverage?** Cross-reference exported function names in each repository file against tested functions.

## Estimated Effort

Two to three days for 5 files × ~10-20 test cases each. Most of the time is mechanical translation; some is investigation when the old test's intent is unclear.
