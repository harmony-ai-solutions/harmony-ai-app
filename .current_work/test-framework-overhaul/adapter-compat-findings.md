# Adapter Compatibility Findings

## Overview

This document captures the known behavioral divergences between the two
`Database` interface implementations:

| Adapter | Backend | Purpose |
|---------|---------|---------|
| `ReactNativeDatabase` | `react-native-sqlite-storage` | Production (on-device) |
| `NodeDatabase` | `better-sqlite3` | Test (Node.js Jest) |

The query corpus (`src/database/__tests__/compat/queries.ts`) defines ~20
representative SQL operations. The Node-side runner
(`nodeSide.test.ts`) validates correctness in Jest. The RN-side runner
(`rnSide.ts`) is a stub — it requires a booted React Native environment.

## Known Divergences

### 1. Number Binding (react-native-sqlite-storage issue #4141)

**Severity**: Medium — can cause silent type mismatches.

`react-native-sqlite-storage` binds **all** JavaScript numbers as doubles
(REAL in SQLite terms). `better-sqlite3` correctly distinguishes
`Number.isInteger()` values (INTEGER) from floats (REAL).

**Impact**: A query like `INSERT INTO t (int_col) VALUES (?)` with `42`
will store `42.0` (REAL) on RN but `42` (INTEGER) on Node. For most
schemas this is invisible (SQLite's type affinity handles it), but it can
matter for:
- `GROUP BY` on integer columns (different precision)
- `ORDER BY` comparison edge cases
- Triggers that check `typeof()` values

**Mitigation**: The `mimicRnNumberBinding` flag in `NodeDatabaseOptions`
forces all numbers through `Number.parseFloat()` before binding, matching
RN's behavior. Enable it in test helpers when the integer-vs-float
distinction matters:
```typescript
const db = new NodeDatabase({path: ':memory:', mimicRnNumberBinding: true});
```

### 2. BLOB Representation

**Severity**: Low — only matters for binary data tests.

`react-native-sqlite-storage` returns `BLOB` columns as base64-encoded
strings in JavaScript. `better-sqlite3` returns `Buffer` objects.

**Impact**: Tests that read BLOB values and compare them need explicit
conversion (Buffer → base64 or vice versa).

### 3. Transaction Semantics

**Severity**: Low — both implementations are correct but differ internally.

| Aspect | ReactNativeDatabase | NodeDatabase |
|--------|-------------------|--------------|
| BEGIN | RN's `transaction()` callback | Explicit `BEGIN` / `SAVEPOINT` |
| COMMIT | RN's success callback | `COMMIT` / `RELEASE SAVEPOINT` |
| ROLLBACK | RN's error callback | `ROLLBACK` / `ROLLBACK TO SAVEPOINT` |
| Nested | Delegates to RN (likely unsupported) | SAVEPOINT-based nesting |

**Impact**: Nested transactions work in NodeDatabase but may silently
fail on RN (SQLite does not allow nested `BEGIN`). The app code does not
use nested transactions, so this is safe.

### 4. Error Messages and Codes

**Severity**: Low — only matters if tests assert exact error strings.

`react-native-sqlite-storage` error messages come from the native SQLite
library. `better-sqlite3` errors have different wording. Tests that check
`.toThrow('...')` with exact strings will fail across adapters.

**Workaround**: Use `.toThrow()` without argument, or match on error
codes instead of messages.

### 5. WAL Mode with `:memory:`

**Severity**: Informational — no impact on correctness.

SQLite silently ignores `PRAGMA journal_mode = WAL` for in-memory
databases. File-backed test databases will get WAL; in-memory ones
will use the default journal mode. This is harmless.

## RN-Side Runner Status

The RN-side compatibility test runner (`src/database/__tests__/compat/rnSide.ts`)
is a **stub** that throws `Not implemented — requires booted RN environment`.
It was deferred because:

1. Running RN tests requires an Android emulator or physical device
2. The Phase 1-2 deletion removed the original in-app test framework
3. Phase 6 (Maestro E2E) is still in progress

**Plan to resurrect**: When a booted RN environment is available:
1. Write a small debug screen that calls `runRnSideCompatibilityTests()`
2. The function iterates `queryCases` against `getDatabase()` (via ReactNativeDatabase)
3. Log each case's pass/fail to the console or a results file
4. Compare outputs manually with the Node-side Jest results

## Final Recommendation

For Phase 3-3 (repository tests), use `NodeDatabase` with default options
for most tests. If a test is sensitive to integer column behavior (e.g.,
comparing `typeof` values), enable `mimicRnNumberBinding`. The compatibility
test corpus provides confidence that the adapters agree on all common SQL
operations.
