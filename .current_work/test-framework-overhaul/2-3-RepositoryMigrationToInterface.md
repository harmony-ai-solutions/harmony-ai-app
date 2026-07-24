# Phase 2-3: Repository Migration to Interface

## Objective

Refactor `connection.ts` and the repository files so they depend on the `Database` interface (from Phase 2-1) instead of directly on `react-native-sqlite-storage`. Production code keeps using `react-native-sqlite-storage` exactly as before — only the *types* change.

## Context

This is the highest-risk phase because it touches production code paths. The good news: the changes are mechanical type-swap refactors, not behavioral. The bad news: this codebase has had subtle concurrency work (the main + sync dual connection pool for WAL), so a wrong move could break app startup.

**Impact analysis is mandatory** per `AGENTS.md`. Before editing each symbol, run `gitnexus_impact` on it. Symbols to analyze before this phase begins:
- `initializeDatabase` (in `connection.ts`)
- `getDatabase` (in `connection.ts`)
- `getSyncDatabase` (in `connection.ts`)
- `clearDatabaseData` (in `connection.ts`)
- `wipeDatabaseCompletely` (in `connection.ts`)
- `executeRawQuery` (in `connection.ts`)
- `withTransaction` (in `src/database/transaction.ts`) — already done in Phase 2-1
- Each repository's exported functions (in `src/database/repositories/*.ts`)

## Prerequisites

- Phase 2-1 complete (interface defined).
- Phase 2-2 complete (adapter available for end-to-end validation).
- All impact analyses run and reviewed. Any HIGH/CRITICAL risk findings discussed with the team before proceeding.

## Implementation Steps

### 1. Run impact analyses (mandatory)

For each symbol listed above, run:

```
gitnexus_impact({target: "initializeDatabase", direction: "upstream"})
gitnexus_impact({target: "getDatabase", direction: "upstream"})
gitnexus_impact({target: "getSyncDatabase", direction: "upstream"})
... etc.
```

Record the risk levels and affected processes in this phase's working notes. If any return HIGH or CRITICAL, surface them to the user before proceeding — per `AGENTS.md`.

### 2. Refactor `connection.ts`

The file currently imports `SQLite, {SQLiteDatabase} from 'react-native-sqlite-storage'`. The internal `db`/`syncDb` variables are typed as `SQLiteDatabase | null`.

Change the **internal types only** — keep the actual SQLite calls identical:

```diff
- import SQLite, {SQLiteDatabase} from 'react-native-sqlite-storage';
+ import SQLite from 'react-native-sqlite-storage';
+ import {Database} from './types';

  // Global database instance
- let db: SQLiteDatabase | null = null;
+ let db: Database | null = null;

  // Secondary database connection used exclusively by the sync pipeline.
- let syncDb: SQLiteDatabase | null = null;
+ let syncDb: Database | null = null;
```

Then update the wrapper. The cleanest approach is a tiny adapter class that wraps the RN `SQLiteDatabase` and exposes the `Database` interface:

```typescript
// src/database/reactNativeDatabase.ts
import type {SQLiteDatabase} from 'react-native-sqlite-storage';
import type {
  Database as IDatabase,
  DatabaseResultSet,
  DatabaseTransaction,
} from './types';

/**
 * Adapts react-native-sqlite-storage's SQLiteDatabase to the Database interface.
 * This is the production-side counterpart to NodeDatabase.
 */
export class ReactNativeDatabase implements IDatabase {
  constructor(private readonly rnDb: SQLiteDatabase) {}

  async executeSql(
    sql: string,
    params: any[] = [],
  ): Promise<[DatabaseResultSet]> {
    // RN's executeSql already returns Promise<[ResultSet]> and the ResultSet
    // shape matches DatabaseResultSet (rows.length, rows.item, rowsAffected, insertId).
    return this.rnDb.executeSql(sql, params) as Promise<[DatabaseResultSet]>;
  }

  transaction<T>(
    fn: (tx: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    // RN's transaction() callback receives a tx with executeSql — same shape.
    return this.rnDb.transaction(fn) as Promise<T>;
  }

  close(): Promise<void> {
    return this.rnDb.close();
  }
}
```

Then in `connection.ts`, wrap the open results:

```diff
  async function openDatabase(encryptionKey: string): Promise<Database> {
    // ...
    try {
      const database = await SQLite.openDatabase({
        name: DATABASE_NAME,
        location: 'default',
        key: encryptionKey,
      });
      await configureDatabase(database);
-     log.info('Successfully opened encrypted database');
-     return database;
+     log.info('Successfully opened encrypted database');
+     return new ReactNativeDatabase(database);
    } catch (error) {
      log.error('Failed to open database:', error);
      throw error;
    }
  }
```

Update `configureDatabase` to accept `Database`:

```diff
- async function configureDatabase(database: SQLiteDatabase): Promise<void> {
+ async function configureDatabase(database: Database): Promise<void> {
    try {
      await database.executeSql('PRAGMA foreign_keys = ON;');
      // ...
```

Update `getDatabase` and `getSyncDatabase` return types — they now return `Database`, which is what callers want.

**Caveat for `getSyncDatabase`**: It calls `SQLite.openDatabase` and `configureDatabase` directly. Both calls need to go through `ReactNativeDatabase`:

```diff
  export async function getSyncDatabase(): Promise<Database> {
    // ...
-   syncDb = await SQLite.openDatabase({...});
-   await configureDatabase(syncDb);
+   const rawSyncDb = await SQLite.openDatabase({...});
+   await configureDatabase(rawSyncDb);  // configureDatabase now takes Database — wrap first
+   syncDb = new ReactNativeDatabase(rawSyncDb);
    return syncDb;
  }
```

Actually — since `configureDatabase` now takes `Database`, either:
- Wrap first, then pass the wrapper to `configureDatabase` (cleaner), OR
- Have `configureDatabase` take the raw `SQLiteDatabase` for internal use only.

Pick one and be consistent. Recommended: wrap first.

### 3. Update `clearDatabaseData` and `wipeDatabaseCompletely`

These already use `database.executeSql(...)` so they should work as-is once the type is `Database`. Verify they compile.

`wipeDatabaseCompletely` also calls `SQLite.deleteDatabase(DATABASE_NAME)` — this is a static method on the imported module, unrelated to the interface. Keep that call as-is.

### 4. Update `executeRawQuery`

```diff
  export async function executeRawQuery(
    sql: string,
    params?: any[]
- ): Promise<any> {
+ ): Promise<DatabaseResultSet> {
    const database = getDatabase();
    const [results] = await database.executeSql(sql, params);
    return results;
  }
```

### 5. Update each repository file

For each file in `src/database/repositories/`:

```diff
- import {getDatabase} from '../connection';
- import {SQLiteDatabase} from 'react-native-sqlite-storage';
+ import {getDatabase} from '../connection';
+ import type {Database} from '../types';
```

If any repository declares a local variable typed as `SQLiteDatabase`, change it to `Database`. The repository bodies should be unchanged — they call `executeSql` and `withTransaction`, both of which now go through the interface.

### 6. Update `src/database/migrations/` consumers

`runMigrations` is imported by `connection.ts`. Check its signature — does it take `SQLiteDatabase`? If so, change to `Database`:

```diff
- export async function runMigrations(db: SQLiteDatabase, silent?: boolean): Promise<void> {
+ export async function runMigrations(db: Database, silent?: boolean): Promise<void> {
```

### 7. Run type-check

```bash
npx tsc --noEmit
```

Should be clean. Any remaining errors are missed spots — fix them.

### 8. Run the existing Jest suite

```bash
npm test
```

`__tests__/App.test.tsx` and `__tests__/services/SyncService.test.ts` should still pass (the latter mocks `../../src/database/sync` entirely, so it's unaffected).

### 9. Smoke-test the running app

This phase touches production code. **Manual smoke test required**:
- Build the app for Android (`npm run android`)
- Verify it boots without errors
- Open a chat (triggers DB read)
- Send a message (triggers DB write)
- Trigger a sync (if Harmony Link is available)

If anything is broken in production, revert and investigate — the refactor should be type-only, so any behavioral change is a bug in the adapter wrapping.

## Files to Modify

- `src/database/connection.ts` — type swaps, wrap open results in `ReactNativeDatabase`
- `src/database/transaction.ts` — already done in Phase 2-1
- `src/database/migrations/index.ts` (or wherever `runMigrations` lives) — type swap
- `src/database/repositories/*.ts` — type swaps for any `SQLiteDatabase` references (likely ~10 files)
- `src/database/sync.ts` — type swaps if it references `SQLiteDatabase`

## Files to Create

- `src/database/reactNativeDatabase.ts` — the production-side adapter wrapping `SQLiteDatabase`

## Validation

- [ ] `gitnexus_impact` run for all symbols listed in step 1; risk levels recorded; HIGH/CRITICAL findings escalated
- [ ] `npx tsc --noEmit` passes
- [ ] `npm test` passes (existing Jest tests)
- [ ] App boots and basic DB operations work on Android (manual smoke)
- [ ] No remaining `SQLiteDatabase` references in production code outside `reactNativeDatabase.ts` (use Grep tool to confirm)
- [ ] `gitnexus_detect_changes()` run before any commit; affected symbols match expectations

## Open Questions to Resolve During Implementation

- **Does `withTransaction` already return `Promise<T>` or `Promise<void>`?** Read `src/database/transaction.ts` and align the interface accordingly.
- **Are there usages of `SQLiteDatabase` methods beyond `executeSql`/`transaction`/`close`?** Read each repository carefully — if any uses `.attach()`, `.detach()`, or reads properties like `.databaseName`, extend the interface.
- **Does the sync pipeline (`SyncService.ts`, `ConnectionStateManager.ts`) hold direct `SQLiteDatabase` references?** It uses `getSyncDatabase()` so should be fine, but verify.

## Estimated Effort

Two to three days, including the manual smoke test and impact analysis overhead. The actual code changes are small but the verification surface is wide.
