/**
 * Shared Test Fixtures for Repository Tests
 *
 * Provides Jest lifecycle hooks that give each test a fresh migrated in-memory
 * database with getDatabase() mocked to return the test DB instance.
 *
 * Usage:
 *   describe('entities repo', () => {
 *     const {getDb} = useFreshDatabase();
 *     it('creates an entity', async () => {
 *       const {createEntity} = await import('../../repositories/entities');
 *       const e = await createEntity({id: 'e1', ...});
 *     });
 *   });
 */

import {createInMemoryDatabase} from '../__test_utils__/testDatabase';
import {runMigrations} from '../migrations';
import type {NodeDatabase} from '../__test_utils__/nodeDatabase';
import * as connection from '../connection';

/**
 * Jest beforeEach/afterEach hooks that give each test a fresh migrated DB.
 * Mocks getDatabase() to return the test DB so repository functions work.
 *
 * Returns { getDb: () => NodeDatabase } for direct database access if needed.
 */
export function useFreshDatabase() {
  let db: NodeDatabase;

  beforeEach(async () => {
    db = createInMemoryDatabase();
    await runMigrations(db, true);
    jest.spyOn(connection, 'getDatabase').mockReturnValue(db);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await db.close();
  });

  return {
    getDb: () => db,
  };
}

/** Alternate pattern: per-test fresh DB via async helper. */
export async function withFreshDatabase<T>(
  fn: (db: NodeDatabase) => Promise<T>,
): Promise<T> {
  const db = createInMemoryDatabase();
  try {
    await runMigrations(db, true);
    jest.spyOn(connection, 'getDatabase').mockReturnValue(db);
    return await fn(db);
  } finally {
    jest.restoreAllMocks();
    await db.close();
  }
}
