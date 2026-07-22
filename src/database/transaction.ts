/**
 * Transaction Helper Utilities
 * 
 * Provides a convenient wrapper for executing database operations
 * within transactions, ensuring atomicity and proper error handling.
 */

import type {Database, DatabaseTransaction} from './types';

/**
 * Execute a function within a database transaction
 * If the function throws an error, the transaction is automatically rolled back
 * Otherwise, the transaction is committed
 * 
 * @param db - The database connection
 * @param fn - The function to execute within the transaction
 * @returns The result of the function
 */
export async function withTransaction<T>(
  db: Database,
  fn: (tx: DatabaseTransaction) => Promise<T>
): Promise<T> {
  // The Database interface's transaction() method handles the
  // callback-vs-promise conversion internally. ReactNativeDatabase
  // wraps the 3-arg callback form (fn, errCb, successCb) from
  // react-native-sqlite-storage. NodeDatabase uses SAVEPOINT-based
  // nesting. Both implement the same semantics: BEGIN, COMMIT on
  // success, ROLLBACK on reject.
  return db.transaction(fn);
}

/**
 * Execute SQL within a transaction
 * Helper for simple single-statement operations
 */
export async function execInTransaction(
  db: Database,
  sql: string,
  params?: any[]
): Promise<any> {
  return withTransaction(db, async (tx) => {
    const [results] = await tx.executeSql(sql, params);
    return results;
  });
}
