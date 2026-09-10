/**
 * Database abstraction layer.
 *
 * This interface captures the subset of the react-native-sqlite-storage
 * SQLiteDatabase API that the codebase actually uses. Production code
 * resolves this to ReactNativeDatabase (a thin wrapper around
 * react-native-sqlite-storage). Tests resolve this to NodeDatabase
 * (backed by better-sqlite3) via Jest's moduleNameMapper.
 *
 * @see docs/TESTING.md#architecture-decisions for the rationale behind the abstraction.
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
  /** Promise-based form (used by repository code via withTransaction). */
  executeSql(sql: string, params?: any[]): Promise<[DatabaseResultSet]>;
  /** Callback-based form for backward compatibility with direct callers. */
  executeSql(
    sql: string,
    params: any[] | undefined,
    successCallback?: (tx: any, results: any) => void,
    errorCallback?: (tx: any, error: Error) => void,
  ): void;
}

/** A database connection. Subset of SQLiteDatabase that the codebase uses. */
export interface Database {
  /** Execute raw SQL. Returns a tuple to mirror react-native-sqlite-storage. */
  executeSql(sql: string, params?: any[]): Promise<[DatabaseResultSet]>;

  /**
   * Promise-based form (used by withTransaction and most repository code).
   * Implementations must:
   *  - BEGIN before invoking fn
   *  - COMMIT if fn resolves
   *  - ROLLBACK if fn rejects (then re-throw)
   *  - Support nested calls via SAVEPOINT (SQLite does not allow nested BEGIN)
   */
  transaction<T>(fn: (tx: DatabaseTransaction) => Promise<T>): Promise<T>;
  /**
   * Callback-based form for backward compatibility with direct transaction
   * callers (characters.ts, modules.ts, SyncService.ts, provider repos).
   */
  transaction(
    fn: (tx: DatabaseTransaction) => void,
    errorCallback?: (error: Error) => void,
    successCallback?: () => void,
  ): void;

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
