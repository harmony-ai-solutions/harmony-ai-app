/**
 * Node-side Database implementation for Jest tests.
 *
 * Wraps better-sqlite3 to satisfy the Database interface defined in
 * src/database/types.ts. Test-only — never imported by production code
 * (enforced by Jest's moduleNameMapper in setup).
 *
 * @see docs/TESTING.md#architecture-decisions for why better-sqlite3 was chosen
 *      over node:sqlite and why the Database abstraction exists.
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
  /**
   * If true, bind all numbers as doubles to mimic react-native-sqlite-storage's
   * known limitation (issue #4141). Set this for tests that need to reproduce
   * RN-specific number-binding behavior.
   */
  mimicRnNumberBinding?: boolean;
}

export class NodeDatabase implements IDatabase {
  private db: Database.Database;
  private transactionDepth = 0;
  private opts: NodeDatabaseOptions;

  constructor(opts: NodeDatabaseOptions) {
    this.opts = opts;
    this.db = new Database(opts.path);
    if (!opts.skipPragmas) {
      // Match production PRAGMAs (see connection.ts configureDatabase)
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
      this.db.pragma('synchronous = NORMAL');
    }
  }

  async executeSql(sql: string, params: any[] = []): Promise<[DatabaseResultSet]> {
    const trimmed = sql.trim().replace(/;$/, '');
    const leading = trimmed.slice(0, 6).toUpperCase();

    // Normalize params for better-sqlite3 compatibility
    let boundParams = params.map(p => {
      // better-sqlite3 cannot bind booleans directly — convert to 0/1
      if (typeof p === 'boolean') return p ? 1 : 0;
      return p;
    });
    if (this.opts.mimicRnNumberBinding) {
      boundParams = boundParams.map(p =>
        typeof p === 'number' ? Number.parseFloat(p.toString()) : p,
      );
    }

    // Handle PRAGMA statements using better-sqlite3's native pragma() helper,
    // which correctly handles both getters (returns rows) and setters (no rows).
    // Using stmt.all() on a PRAGMA setter throws "This statement does not return
    // data. Use run() instead".
    if (leading === 'PRAGMA') {
      // Strip 'PRAGMA' prefix for the native helper
      const pragmaCmd = trimmed.replace(/^PRAGMA\s+/i, '');
      const rows = this.db.pragma(pragmaCmd, { simple: false }) as Record<string, any>[];
      return [
        {
          rows: {
            length: rows.length,
            item: (i: number) => rows[i],
          },
          rowsAffected: 0,
        },
      ];
    }

    if (leading === 'SELECT' || leading === 'WITH') {
      const stmt = this.db.prepare(trimmed);
      const rows = stmt.all(...boundParams) as Record<string, any>[];
      return [
        {
          rows: {
            length: rows.length,
            item: (i: number) => rows[i],
          },
          rowsAffected: 0,
        },
      ];
    }

    // INSERT/UPDATE/DELETE/CREATE/DROP/etc.
    const stmt = this.db.prepare(trimmed);
    const info = stmt.run(...boundParams);
    return [
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
    ];
  }

  // --- transaction overloads ---

  transaction<T>(fn: (tx: DatabaseTransaction) => Promise<T>): Promise<T>;
  transaction(
    fn: (tx: DatabaseTransaction) => void,
    errorCallback?: (error: Error) => void,
    successCallback?: () => void,
  ): void;
  transaction<T>(
    fn: (tx: DatabaseTransaction) => Promise<T> | void,
    errorCallback?: (error: Error) => void,
    successCallback?: () => void,
  ): Promise<T> | void {
    // For NodeDatabase, only the promise form is supported in tests.
    // The callback form is a no-op pass-through for type compatibility.
    if (errorCallback !== undefined || successCallback !== undefined) {
      // Callback form: execute synchronously and call callbacks
      try {
        (fn as (tx: DatabaseTransaction) => void)(this.makeTx());
        if (successCallback) successCallback();
      } catch (err) {
        if (errorCallback) errorCallback(err as Error);
      }
      return;
    }

    return this.transactionImpl(fn as (tx: DatabaseTransaction) => Promise<T>);
  }

  private async transactionImpl<T>(
    fn: (tx: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    const depth = this.transactionDepth++;
    const savepointName = `sp_${depth}`;
    const tx = this.makeTx();

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

  private makeTx(): DatabaseTransaction {
    // Use a function that accepts all overload forms and delegates to executeSql
    const executeSqlFn = (
      sql: string,
      params?: any[],
      successCallback?: any,
      errorCallback?: any,
    ): any => {
      const promise = this.executeSql(sql, params);
      if (successCallback !== undefined || errorCallback !== undefined) {
        // Callback form: invoke callbacks based on Promise resolution
        promise.then(
          (result) => {
            if (successCallback) successCallback(null, result[0]);
          },
          (error) => {
            if (errorCallback) errorCallback(null, error);
          },
        );
        return; // void return for callback overload
      }
      return promise;
    };
    return {executeSql: executeSqlFn as DatabaseTransaction['executeSql']};
  }

  close(): Promise<void> {
    try {
      this.db.close();
    } catch (err) {
      // Idempotent close — match RN's behavior of not throwing on double-close.
      if (
        (err as Error).message !==
        'Cannot close a database while it is opening or closing.'
      ) {
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
