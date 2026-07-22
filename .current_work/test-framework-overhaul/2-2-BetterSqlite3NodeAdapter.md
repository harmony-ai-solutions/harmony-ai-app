# Phase 2-2: better-sqlite3 Node Adapter

## Objective

Implement a test-only `Database` (from Phase 2-1) backed by `better-sqlite3`. This adapter runs real SQLite in Node, enabling actual SQL execution under Jest for migration tests, repository tests, and sync integration tests.

## Context

`better-sqlite3` is synchronous, so this adapter wraps sync calls in `Promise.resolve(...)`. The async surface is preserved because that's what the `Database` interface requires (and what production code expects). Synchronous-internal-but-async-external is a common and clean adapter pattern.

**Why `better-sqlite3` over alternatives**: See the research report — it's the fastest Node SQLite, very actively maintained (v12.12.0 in July 2026, 7.4k stars), has prebuilt binaries for Windows/Linux/macOS on Node 20–25, and the sync API is actually a benefit in tests (no race conditions, deterministic ordering).

**SQLCipher gap**: `better-sqlite3` does not support SQLCipher. Tests run on plain SQLite. SQLCipher compatibility is verified separately by a small on-device smoke test (see Phase 8-2 backlog).

## Prerequisites

- Phase 2-1 complete (interface defined).
- Validated that `better-sqlite3` installs cleanly on the team's Windows machines AND on `ubuntu-latest` CI runners. If installation fails on Windows due to missing VS Build Tools, install them first (`choco install visualstudio2022-workload-vctools` or use the Microsoft C++ Build Tools installer).

## Implementation Steps

### 1. Add `better-sqlite3` as a dev dependency

```bash
npm install --save-dev better-sqlite3
npm install --save-dev @types/better-sqlite3
```

Verify prebuilt binary loaded (no `node-gyp` rebuild):

```bash
node -e "const Database = require('better-sqlite3'); const db = new Database(':memory:'); console.log(db.prepare('SELECT 1 AS x').get());"
```

Should print `{ x: 1 }` with no build warnings.

### 2. Implement the adapter

Create `src/database/__test_utils__/nodeDatabase.ts`:

```typescript
/**
 * Node-side Database implementation for Jest tests.
 *
 * Wraps better-sqlite3 to satisfy the Database interface defined in
 * src/database/types.ts. Test-only — never imported by production code
 * (enforced by Jest's moduleNameMapper in setup).
 */

import Database from 'better-sqlite3';
import type {
  Database as IDatabase,
  DatabaseResultSet,
  DatabaseTransaction,
} from '../types';

export interface NodeDatabaseOptions {
  /** ':memory:' for ephemeral fast tests, or a file path for persistence. */
  path: string;
  /** Skip PRAGMA setup if true (used by the snapshot test which wants vanilla schema). */
  skipPragmas?: boolean;
}

export class NodeDatabase implements IDatabase {
  private db: Database.Database;
  private transactionDepth = 0;

  constructor(opts: NodeDatabaseOptions) {
    this.db = new Database(opts.path);
    if (!opts.skipPragmas) {
      // Match production PRAGMAs (see connection.ts configureDatabase)
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
      this.db.pragma('synchronous = NORMAL');
    }
  }

  executeSql(sql: string, params: any[] = []): Promise<[DatabaseResultSet]> {
    const trimmed = sql.trim().replace(/;$/, '');
    const leading = trimmed.slice(0, 6).toUpperCase();

    // PRAGMA statements: better-sqlite3 treats them as queries in some cases,
    // as commands in others. Normalize: if it returns rows, treat as query.
    if (leading === 'SELECT' || leading === 'PRAGMA' || leading === 'WITH') {
      const stmt = this.db.prepare(trimmed);
      const rows = stmt.all(...params) as Record<string, any>[];
      return Promise.resolve([
        {
          rows: {
            length: rows.length,
            item: (i: number) => rows[i],
          },
          rowsAffected: 0,
        },
      ]);
    }

    // INSERT/UPDATE/DELETE/CREATE/DROP/etc.
    const stmt = this.db.prepare(trimmed);
    const info = stmt.run(...params);
    return Promise.resolve([
      {
        rows: {
          length: 0,
          item: () => {
            throw new Error('No rows for a non-SELECT statement');
          },
        },
        rowsAffected: info.changes,
        insertId:
          info.lastInsertRowid !== null &&
          info.lastInsertRowid !== undefined
            ? Number(info.lastInsertRowid)
            : undefined,
      },
    ]);
  }

  async transaction<T>(
    fn: (tx: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    const depth = this.transactionDepth++;
    const savepointName = `sp_${depth}`;

    const tx: DatabaseTransaction = {
      executeSql: (sql, params) => this.executeSql(sql, params),
    };

    if (depth === 0) {
      this.db.exec('BEGIN');
    } else {
      this.db.exec(`SAVEPOINT ${savepointName}`);
    }

    try {
      const result = await fn(tx);
      if (depth === 0) {
        this.db.exec('COMMIT');
      } else {
        this.db.exec(`RELEASE SAVEPOINT ${savepointName}`);
      }
      this.transactionDepth--;
      return result;
    } catch (err) {
      if (depth === 0) {
        this.db.exec('ROLLBACK');
      } else {
        this.db.exec(`ROLLBACK TO SAVEPOINT ${savepointName}`);
        this.db.exec(`RELEASE SAVEPOINT ${savepointName}`);
      }
      this.transactionDepth--;
      throw err;
    }
  }

  close(): Promise<void> {
    try {
      this.db.close();
    } catch (err) {
      // Idempotent close — match RN's behavior of not throwing on double-close.
      if ((err as Error).message !== 'Cannot close a database while it is opening or closing.') {
        throw err;
      }
    }
    return Promise.resolve();
  }

  /** Exposed for tests that want to drop all tables (parallels clearDatabaseData). */
  async dropAllTables(): Promise<void> {
    this.db.pragma('foreign_keys = OFF');
    const tables = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';",
      )
      .all() as Array<{ name: string }>;
    for (const { name } of tables) {
      // name comes from sqlite_master, not user input — safe to interpolate.
      this.db.exec(`DROP TABLE IF EXISTS ${name};`);
    }
    this.db.pragma('foreign_keys = ON');
  }
}
```

### 3. Add a factory helper for tests

Create `src/database/__test_utils__/testDatabase.ts`:

```typescript
/**
 * Helpers for creating test databases.
 *
 * Usage in a Jest test:
 *   import {createInMemoryDatabase, runAllMigrations} from './testDatabase';
 *
 *   let db: NodeDatabase;
 *   beforeEach(async () => {
 *     db = createInMemoryDatabase();
 *     await runAllMigrations(db);
 *   });
 *   afterEach(async () => { await db.close(); });
 */

import {NodeDatabase} from './nodeDatabase';
import type {Database} from '../types';
import {runMigrations} from '../migrations'; // adjust path as needed

export function createInMemoryDatabase(): NodeDatabase {
  return new NodeDatabase({path: ':memory:'});
}

export function createFileDatabase(path: string): NodeDatabase {
  return new NodeDatabase({path});
}

/** Initialize a fresh in-memory DB and apply all migrations. */
export async function createMigratedDatabase(): Promise<Database> {
  const db = createInMemoryDatabase();
  await runMigrations(db, true);
  return db;
}
```

> **Note**: `runMigrations` currently lives in `src/database/migrations` (imported from `connection.ts`). Verify the exact path during execution — the migrations module may need its signature adjusted from `SQLiteDatabase` to `Database` (covered in Phase 2-3 if needed).

### 4. Wire the adapter into Jest setup

Update `jest.config.js` to expose the test utils to tests without polluting production imports:

```javascript
module.exports = {
  preset: '@react-native/jest-preset',
  transformIgnorePatterns: [/* unchanged */],
  setupFiles: ['./jest.setup.js'],
  moduleNameMapper: {
    // Allow tests to import the Node adapter directly
    '^@test-utils/database$': '<rootDir>/src/database/__test_utils__/testDatabase',
  },
};
```

Tests then import via:

```typescript
import {createMigratedDatabase} from '@test-utils/database';
```

### 5. Add `better-sqlite3` to `transformIgnorePatterns` exception (if needed)

`better-sqlite3` ships as a CommonJS native module — Jest typically loads it without transformation. If Jest complains about it being untransformed, add it to the ignore patterns or use `transform`:

```javascript
transformIgnorePatterns: [
  // ... existing patterns
],
// Only if needed:
// transform: {
//   '^.+\\.jsx?$': 'babel-jest',
// },
```

Usually no change is needed.

### 6. Smoke test

Create `src/database/__tests__/nodeDatabase.smoke.test.ts`:

```typescript
import {createInMemoryDatabase} from '../__test_utils__/testDatabase';

describe('NodeDatabase smoke', () => {
  it('executes a SELECT', async () => {
    const db = createInMemoryDatabase();
    const [result] = await db.executeSql('SELECT 42 AS answer');
    expect(result.rows.length).toBe(1);
    expect(result.rows.item(0).answer).toBe(42);
    await db.close();
  });

  it('runs a transaction', async () => {
    const db = createInMemoryDatabase();
    await db.executeSql('CREATE TABLE t (x INTEGER)');
    await db.transaction(async tx => {
      await tx.executeSql('INSERT INTO t VALUES (1)');
      await tx.executeSql('INSERT INTO t VALUES (2)');
    });
    const [r] = await db.executeSql('SELECT COUNT(*) AS n FROM t');
    expect(r.rows.item(0).n).toBe(2);
    await db.close();
  });

  it('rolls back on error', async () => {
    const db = createInMemoryDatabase();
    await db.executeSql('CREATE TABLE t (x INTEGER UNIQUE)');

    await expect(
      db.transaction(async tx => {
        await tx.executeSql('INSERT INTO t VALUES (1)');
        await tx.executeSql('INSERT INTO t VALUES (1)'); // throws
      }),
    ).rejects.toThrow();

    const [r] = await db.executeSql('SELECT COUNT(*) AS n FROM t');
    expect(r.rows.item(0).n).toBe(0); // rolled back
    await db.close();
  });
});
```

### 7. Validate on Windows + Linux CI

Run the smoke test on both platforms to confirm prebuilt binaries load. Document any quirks.

## Files to Create

- `src/database/__test_utils__/nodeDatabase.ts` — the adapter
- `src/database/__test_utils__/testDatabase.ts` — factory helpers
- `src/database/__tests__/nodeDatabase.smoke.test.ts` — smoke test

## Files to Modify

- `package.json` — add `better-sqlite3`, `@types/better-sqlite3` as dev deps
- `jest.config.js` — add `moduleNameMapper` entry
- `jest.setup.js` — likely no changes (no need to mock better-sqlite3 since it works natively in Node)

## Validation

- [ ] `npm install` succeeds on Windows + Linux without `node-gyp` build errors
- [ ] Smoke test (`nodeDatabase.smoke.test.ts`) passes: SELECT, transaction, rollback
- [ ] `npx tsc --noEmit` succeeds for the new files
- [ ] Production build is unaffected (the adapter is in `__test_utils__` and never imported from production code paths)
- [ ] `moduleNameMapper` resolves correctly in Jest

## Open Risks

- **Parameter binding differences**: `react-native-sqlite-storage` binds all numbers as doubles (issue #4141). `better-sqlite3` binds them correctly (int vs float). This may cause some tests to pass in Node that fail on device, or vice versa. Mitigation: Phase 2-4 includes a compatibility test that runs identical queries through both adapters.
- **`better-sqlite3` BLOB handling**: Different default type for `BLOB` columns. Verify whether any repository stores binary data and add a compatibility test for it.
- **WAL mode in `:memory:`**: SQLite ignores `journal_mode = WAL` for in-memory databases. This is harmless but worth knowing — file-backed test DBs will get WAL, in-memory ones won't.

## Estimated Effort

One to two days. Most of the time is parameter-binding edge cases and validating the transaction/savepoint behavior matches RN's.
