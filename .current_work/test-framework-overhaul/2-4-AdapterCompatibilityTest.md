# Phase 2-4: Adapter Compatibility Test

## Objective

Build a test that runs the same SQL queries through both the `ReactNativeDatabase` adapter (production) and the `NodeDatabase` adapter (test) to catch any drift in their behavior. This is the safety net that justifies the entire Phase 2 refactor — without it, we're trusting that the adapters behave identically.

## Context

The two adapters have known differences (per the research):

- **Number binding**: `react-native-sqlite-storage` binds all numbers as doubles (issue #4141). `better-sqlite3` binds ints/floats correctly. This is a *production* bug in the RN lib, not in our adapter — but it can cause tests to pass in Node while failing on device (or vice versa).
- **BLOB handling**: Different default representations.
- **Transaction semantics**: RN uses JS-level transaction objects; better-sqlite3 uses native BEGIN/COMMIT. Nested transactions behave differently without SAVEPOINT handling (Phase 2-2 adds SAVEPOINT support — verify it matches RN's behavior).
- **Error messages and codes**: Different error strings from each library.

The compatibility test doesn't need to run on every commit. It's a confidence-building measure to run during the Phase 2 spike and again whenever the adapter changes.

## Prerequisites

- Phase 2-1, 2-2, 2-3 complete.
- Access to a booted RN environment (Android emulator or device) to execute the RN adapter side. The Node side runs in plain Jest.

## Implementation Steps

### 1. Design the test corpus

Define ~20 representative SQL operations that exercise the surface area where adapters might diverge:

```typescript
// src/database/__tests__/compat/queries.ts

export interface QueryCase {
  name: string;
  setup?: string[];          // SQL statements to run before the test query
  sql: string;               // The query under test
  params?: any[];            // Bound parameters
  validate?: (result: DatabaseResultSet) => void;  // Assertion on result
  validateInsertId?: (insertId: number | undefined) => void;
  validateRowsAffected?: (n: number) => void;
}

export const queryCases: QueryCase[] = [
  {
    name: 'select integer literal',
    sql: 'SELECT 42 AS x',
    validate: r => expect(r.rows.item(0).x).toBe(42),
  },
  {
    name: 'select float literal',
    sql: 'SELECT 3.14 AS x',
    validate: r => expect(r.rows.item(0).x).toBeCloseTo(3.14),
  },
  {
    name: 'bind integer param',
    setup: ['CREATE TABLE t (n INTEGER)'],
    sql: 'INSERT INTO t VALUES (?)',
    params: [42],
    validateRowsAffected: n => expect(n).toBe(1),
  },
  {
    name: 'bind float param',
    setup: ['CREATE TABLE t (n REAL)'],
    sql: 'INSERT INTO t VALUES (?)',
    params: [3.14],
    validateRowsAffected: n => expect(n).toBe(1),
  },
  {
    name: 'bind null param',
    setup: ['CREATE TABLE t (n INTEGER)'],
    sql: 'INSERT INTO t VALUES (?)',
    params: [null],
  },
  {
    name: 'bind string param',
    setup: ['CREATE TABLE t (s TEXT)'],
    sql: 'INSERT INTO t VALUES (?)',
    params: ['hello'],
  },
  {
    name: 'bind boolean param (stored as 0/1 in SQLite)',
    setup: ['CREATE TABLE t (b INTEGER)'],
    sql: 'INSERT INTO t VALUES (?)',
    params: [true],
    validate: async (r, ctx) => {
      const [sel] = await ctx.db.executeSql('SELECT b FROM t');
      expect(sel.rows.item(0).b).toBe(1);  // SQLite stores bools as 0/1
    },
  },
  // ... add cases for: BLOB, large string, unicode, datetime string, multiple rows, JOIN, FK constraint, UNIQUE violation, etc.
];
```

### 2. Build the Node-side test runner

```typescript
// src/database/__tests__/compat/nodeSide.test.ts

import {createInMemoryDatabase} from '../../__test_utils__/testDatabase';
import type {NodeDatabase} from '../../__test_utils__/nodeDatabase';
import {queryCases} from './queries';

describe('NodeDatabase compatibility', () => {
  let db: NodeDatabase;

  beforeEach(() => {
    db = createInMemoryDatabase();
  });

  afterEach(async () => {
    await db.close();
  });

  for (const testCase of queryCases) {
    it(`Node: ${testCase.name}`, async () => {
      for (const setupSql of testCase.setup ?? []) {
        await db.executeSql(setupSql);
      }
      const [result] = await db.executeSql(testCase.sql, testCase.params);
      if (testCase.validate) testCase.validate(result, {db});
      if (testCase.validateRowsAffected) testCase.validateRowsAffected(result.rowsAffected);
    });
  }
});
```

### 3. Build the RN-side test runner

This one runs **on device** (or in the Android emulator). It's not a Jest test — it's a small in-app script that exercises the same queries through `ReactNativeDatabase` and writes the results to a file or log.

Two options:

**Option A: Reuse the in-app test runner pattern (recommended short-term)**

Resurrect a minimal version of the deleted `run-all-tests.ts` framework specifically for this compatibility test. It runs inside the app via a hidden debug screen or CLI command, executes the `queryCases` against the production `getDatabase()`, and logs pass/fail.

**Option B: Maestro E2E flow (recommended long-term)**

After Phase 6 lands, write a Maestro flow that:
1. Boots the app
2. Navigates to a hidden "DB compat" debug screen
3. The screen runs the queries and displays results
4. Maestro asserts the on-screen pass/fail indicator

Defer this until Phase 6 is done. For Phase 2, use Option A.

### 4. Compare outputs

Run both test runners (Node in CI, RN on device/emulator). Manually diff the results. Any divergence is a finding — document each:

- **Divergence type**: number binding, BLOB representation, error message, transaction semantics, etc.
- **Severity**: silent data corruption vs. cosmetic difference vs. error-message-only.
- **Mitigation**: how to handle in production code (e.g., explicit `CAST(? AS INTEGER)` if number type matters), or in the test adapter (e.g., force double-binding in `NodeDatabase` to match RN).

### 5. Document findings

Write `.current_work/test-framework-overhaul/adapter-compat-findings.md` summarizing every divergence found and the chosen mitigation. This becomes the reference whenever someone asks "why does this test pass in Node but fail on device?"

### 6. Add `NodeDatabase` configuration flag for known divergences

If number-binding divergence is significant (it usually is for SQLite schemas with INTEGER columns), add an option to `NodeDatabase` to mimic RN's behavior:

```typescript
export interface NodeDatabaseOptions {
  path: string;
  skipPragmas?: boolean;
  /**
   * If true, bind all numbers as doubles to mimic react-native-sqlite-storage's
   * known limitation (issue #4141). Set this for tests that need to reproduce
   * RN-specific number-binding behavior.
   */
  mimicRnNumberBinding?: boolean;
}
```

In `executeSql`:

```typescript
if (this.opts.mimicRnNumberBinding) {
  params = params.map(p => typeof p === 'number' ? Number.parseFloat(p.toString()) : p);
}
```

Use this flag in repository tests that depend on integer column behavior matching on-device behavior exactly.

## Files to Create

- `src/database/__tests__/compat/queries.ts` — shared query corpus
- `src/database/__tests__/compat/nodeSide.test.ts` — Jest test for Node side
- `src/database/__tests__/compat/rnSide.ts` — in-app runner for RN side (resurrect minimal pattern from Phase 1-2 deletion)
- `.current_work/test-framework-overhaul/adapter-compat-findings.md` — divergence report

## Files to Modify

- `src/database/__test_utils__/nodeDatabase.ts` — add `mimicRnNumberBinding` option if divergence is found

## Validation

- [ ] Query corpus has ≥20 cases covering: int/float/null/bool/string/BLOB params, multi-row results, JOIN, FK constraint, UNIQUE violation, transaction commit/rollback
- [ ] Node-side Jest test passes
- [ ] RN-side runner produces a complete result set for every case
- [ ] Every divergence documented in `adapter-compat-findings.md` with mitigation
- [ ] `mimicRnNumberBinding` flag added if number binding diverges (it will)

## Estimated Effort

One to two days. Most of the time is running the RN side on a device and analyzing divergences.
