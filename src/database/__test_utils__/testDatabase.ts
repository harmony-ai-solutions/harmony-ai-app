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
import {runMigrations} from '../migrations';

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
