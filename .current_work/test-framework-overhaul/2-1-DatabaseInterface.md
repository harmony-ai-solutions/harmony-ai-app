# Phase 2-1: Database Interface

## Objective

Define the `Database` TypeScript interface that production code and tests will both depend on. This is the **keystone** of the entire test overhaul: it breaks the direct dependency on `react-native-sqlite-storage` so tests can substitute a Node-side adapter (Phase 2-2) without changing repository code.

## Context

The current API surface in use (derived from reading `connection.ts`, `repositories/entities.ts`, and the existing custom tests):

```typescript
// What production code actually calls on a SQLiteDatabase:
database.executeSql(sql: string, params?: any[]): Promise<[SQLiteResultSet]>
database.close(): Promise<void>
// Via the withTransaction(db, fn) helper, which internally calls:
database.transaction(fn: (tx: Transaction) => Promise<void>): Promise<void>
// Where tx has:
tx.executeSql(sql, params?): Promise<[SQLiteResultSet]>

// And SQLiteResultSet has:
{
  rows: { length: number; item(index: number): any },
  rowsAffected: number,
  insertId?: number,
}
```

The interface needs to capture this contract without depending on `react-native-sqlite-storage` types.

## Prerequisites

- Phase 1-1 complete (Jest modernized).
- Read `src/database/transaction.ts` to confirm `withTransaction`'s exact signature and how it uses `database.transaction()`.

## Implementation Steps

### 1. Survey all DB API usage

Before defining the interface, exhaustively list every method/property actually called on a `SQLiteDatabase` in the codebase. Use Grep tool to search for:

- `\.executeSql\(` (across `src/`)
- `\.transaction\(` (across `src/`)
- `\.close\(\)` (across `src/database/`)
- `\.attach\(` and `\.detach\(` (in case any code uses these — currently not seen but verify)
- `rows\.item\(` and `rows\.length` (to confirm result shape usage)
- `insertId` and `rowsAffected`

Document the full list. Any method/property found in use MUST appear in the interface. Anything NOT in use should NOT appear (YAGNI).

### 2. Create the interface file

Create `src/database/types.ts`:

```typescript
/**
 * Database abstraction layer.
 *
 * This interface captures the subset of the react-native-sqlite-storage
 * SQLiteDatabase API that the codebase actually uses. Production code
 * resolves this to ReactNativeDatabase (a thin wrapper around
 * react-native-sqlite-storage). Tests resolve this to NodeDatabase
 * (backed by better-sqlite3) via Jest's moduleNameMapper.
 *
 * See `.current_work/test-framework-overhaul/2-1-DatabaseInterface.md`.
 */

/** Mirror of react-native-sqlite-storage's SQLiteResultSet shape. */
export interface DatabaseResultSet {
  rows: {
    length: number;
    item(index: number): Record<string, any>;
  };
  rowsAffected: number;
  insertId?: number;
}

/** A transaction context handed to the callback of Database.transaction(). */
export interface DatabaseTransaction {
  executeSql(sql: string, params?: any[]): Promise<[DatabaseResultSet]>;
}

/** A database connection. Subset of SQLiteDatabase that the codebase uses. */
export interface Database {
  /** Execute raw SQL. Returns a tuple to mirror react-native-sqlite-storage. */
  executeSql(sql: string, params?: any[]): Promise<[DatabaseResultSet]>;

  /**
   * Run a function inside a transaction.
   * Implementations must:
   *  - BEGIN before invoking fn
   *  - COMMIT if fn resolves
   *  - ROLLBACK if fn rejects (then re-throw)
   *  - Support nested calls via SAVEPOINT (SQLite does not allow nested BEGIN)
   */
  transaction<T>(fn: (tx: DatabaseTransaction) => Promise<T>): Promise<T>;

  /** Close the connection. Idempotent — calling twice must not throw. */
  close(): Promise<void>;
}

/** Factory shape compatible with how connection.ts opens a DB. */
export interface DatabaseOpenOptions {
  /** SQLCipher encryption key. Ignored by NodeDatabase. */
  key?: string;
  /** RN-specific location string. Ignored by NodeDatabase. */
  location?: string;
  /** For NodeDatabase: ':memory:' or a file path. For RN: the DB name. */
  name: string;
}
```

### 3. Adjust `withTransaction` to use the new types

Read `src/database/transaction.ts` first to see its current signature. If it currently takes `SQLiteDatabase`, change it to take `Database`:

```typescript
// Before (approximate):
import {SQLiteDatabase} from 'react-native-sqlite-storage';
export async function withTransaction<T>(
  db: SQLiteDatabase,
  fn: (tx: ...) => Promise<T>,
): Promise<T> { ... }

// After:
import {Database, DatabaseTransaction} from './types';
export async function withTransaction<T>(
  db: Database,
  fn: (tx: DatabaseTransaction) => Promise<T>,
): Promise<T> { ... }
```

The body should not need changes — it delegates to `db.transaction()`.

### 4. Re-export from a barrel

Create or update `src/database/index.ts` (if it doesn't exist) so consumers can import from one place:

```typescript
export type {
  Database,
  DatabaseTransaction,
  DatabaseResultSet,
  DatabaseOpenOptions,
} from './types';
```

### 5. Type-check

```bash
npx tsc --noEmit
```

This will fail in places that still import `SQLiteDatabase` from `react-native-sqlite-storage` for type annotations. That's expected — Phase 2-3 fixes them. The interface file itself must compile cleanly.

## Files to Create

- `src/database/types.ts` — the interface definitions
- `src/database/index.ts` — barrel re-exports (only if it doesn't already exist; if it does, just add the re-exports)

## Files to Modify

- `src/database/transaction.ts` — change `withTransaction` parameter type from `SQLiteDatabase` to `Database`

## Validation

- [ ] `src/database/types.ts` exists and exports `Database`, `DatabaseTransaction`, `DatabaseResultSet`, `DatabaseOpenOptions`
- [ ] `withTransaction` accepts the new `Database` type
- [ ] `npx tsc --noEmit` on `src/database/types.ts` and `src/database/transaction.ts` (alone, in isolation) succeeds
- [ ] Full `npx tsc --noEmit` is expected to still have errors elsewhere — those are fixed in Phase 2-3
- [ ] The interface captures every method/property enumerated in step 1 (cross-check the survey list)

## Open Questions to Resolve During Implementation

- **Does `withTransaction` return the callback's value?** The signature above assumes yes (`Promise<T>`). Confirm by reading `src/database/transaction.ts`. If it currently returns `Promise<void>`, decide whether to extend it or keep it as-is.
- **Are `attach`/`detach` used anywhere?** Grep didn't find them in the initial survey but verify before locking the interface.
- **Is there a `transaction(fn)` overload that returns void?** Some SQLite libraries support both. Confirm RN's exact behavior.

## Estimated Effort

Half a day to one day. Most of the time is the API survey — the interface itself is small.
