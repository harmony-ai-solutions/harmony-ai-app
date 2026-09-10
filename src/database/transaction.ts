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

/**
 * A single SQL statement to run sequentially within a transaction.
 */
export interface TransactionStatement {
  sql: string;
  params: any[];
}

/**
 * Run a list of statements sequentially inside a single callback-form
 * db.transaction, chaining each statement from the previous one's success
 * callback.
 *
 * This is the SAFE pattern for react-native-sqlite-storage's run-to-completion
 * transaction semantics (see src/database/README.md): every statement is issued
 * from a success callback (or synchronously for the first), so the transaction
 * is never finalized before a later statement is queued — unlike
 * `withTransaction` + sequential `await tx.executeSql()` which throws
 * DOM Exception 11 after the first statement.
 *
 * Resolves when the last statement succeeds; rejects on any statement error or
 * transaction-level error (rollback).
 */
export function runStatementsInTransaction(
  db: Database,
  statements: TransactionStatement[],
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (statements.length === 0) {
      resolve();
      return;
    }

    db.transaction(
      tx => {
        const run = (index: number) => {
          if (index >= statements.length) {
            resolve();
            return;
          }
          const { sql, params } = statements[index];
          tx.executeSql(
            sql,
            params,
            () => run(index + 1),
            (_, error) => {
              reject(error);
              return false;
            },
          );
        };
        run(0);
      },
      error => {
        reject(error);
      },
    );
  });
}
