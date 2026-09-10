/**
 * Type declarations for modules without TypeScript definitions
 */

// Declare react-native-sqlite-storage module
declare module 'react-native-sqlite-storage' {
  export interface DatabaseParams {
    name: string;
    location?: string;
    key?: string;
    createFromLocation?: string;
  }

  export interface ResultSet {
    insertId: number;
    rowsAffected: number;
    rows: ResultSetRowList;
  }

  export interface ResultSetRowList {
    length: number;
    item(index: number): any;
    raw(): any[];
  }

  export interface Transaction {
    executeSql(
      sql: string,
      params?: any[],
      successCallback?: (tx: Transaction, results: ResultSet) => void,
      errorCallback?: (tx: Transaction, error: Error) => boolean
    ): Promise<[ResultSet]>;
  }

  export interface SQLiteDatabase {
    executeSql(
      sql: string,
      params?: any[]
    ): Promise<[ResultSet]>;

    transaction(
      fn: (tx: Transaction) => void,
      errorCallback?: (error: Error) => void,
      successCallback?: () => void
    ): void;

    close(): Promise<void>;
  }

  export interface SQLite {
    DEBUG(debug: boolean): void;
    enablePromise(enable: boolean): void;
    openDatabase(params: DatabaseParams): Promise<SQLiteDatabase>;
    deleteDatabase(databaseName: string): Promise<void>;
  }

  const SQLiteStorage: SQLite;
  export default SQLiteStorage;
}

// Declare SQL files as string modules
declare module '*.sql' {
  const content: string;
  export default content;
}
