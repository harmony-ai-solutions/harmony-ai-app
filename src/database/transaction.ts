/**
 * Transaction Helper Utilities
 * 
 * Provides a convenient wrapper for executing database operations
 * within transactions, ensuring atomicity and proper error handling.
 */

import {SQLiteDatabase, Transaction} from 'react-native-sqlite-storage';

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
  db: SQLiteDatabase,
  fn: (tx: Transaction) => Promise<T>
): Promise<T> {
  // Using the Promise-based transaction API from react-native-sqlite-storage
  // Must capture result and wait for success callback
  return new Promise<T>((resolve, reject) => {
    let result: T;
    
    db.transaction(
      async (tx) => {
        try {
          result = await fn(tx);
        } catch (error) {
          reject(error);
          throw error; // Re-throw to trigger transaction rollback
        }
      },
      (error) => {
        // Transaction error/rollback callback
        reject(error);
      },
      () => {
        // Transaction success/commit callback
        resolve(result);
      }
    );
  });
}

/**
 * Execute SQL within a transaction
 * Helper for simple single-statement operations
 */
export async function execInTransaction(
  db: SQLiteDatabase,
  sql: string,
  params?: any[]
): Promise<any> {
  return withTransaction(db, async (tx) => {
    const [results] = await tx.executeSql(sql, params);
    return results;
  });
}
