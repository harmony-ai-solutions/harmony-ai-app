/**
 * Adapts react-native-sqlite-storage's SQLiteDatabase to the Database interface.
 * This is the production-side counterpart to NodeDatabase.
 */

import type {SQLiteDatabase} from 'react-native-sqlite-storage';
import type {
  Database as IDatabase,
  DatabaseResultSet,
  DatabaseTransaction,
} from './types';

/**
 * Wraps a react-native-sqlite-storage SQLiteDatabase instance and exposes
 * it through the Database interface. All methods are thin pass-throughs —
 * the RN SQLiteDatabase already returns Promise-based APIs with a result
 * shape that matches DatabaseResultSet.
 */
export class ReactNativeDatabase implements IDatabase {
  constructor(private readonly rnDb: SQLiteDatabase) {}

  async executeSql(
    sql: string,
    params?: any[],
  ): Promise<[DatabaseResultSet]> {
    // RN's executeSql already returns Promise<[ResultSet]> and the ResultSet
    // shape matches DatabaseResultSet (rows.length, rows.item, rowsAffected, insertId).
    return this.rnDb.executeSql(sql, params) as Promise<[DatabaseResultSet]>;
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
    // Detect which overload was called: if the fn is async/promise-based,
    // use the promise form; otherwise fall through to the callback form.
    if (errorCallback === undefined && successCallback === undefined) {
      // Promise-based form (1 arg): wrap RN's 3-arg callback into a Promise
      return new Promise<T>((resolve, reject) => {
        let result: T;

        (this.rnDb as any).transaction(
          async (tx: any) => {
            try {
              result = await (fn as (tx: DatabaseTransaction) => Promise<T>)(
                tx as unknown as DatabaseTransaction,
              );
            } catch (error) {
              reject(error);
              throw error; // Trigger RN's rollback
            }
          },
          (error: Error) => {
            reject(error);
          },
          () => {
            resolve(result!);
          },
        );
      });
    }

    // Callback-based form (2-3 args): pass through directly to RN
    (this.rnDb as any).transaction(
      fn,
      errorCallback,
      successCallback,
    );
  }

  close(): Promise<void> {
    return this.rnDb.close();
  }
}
