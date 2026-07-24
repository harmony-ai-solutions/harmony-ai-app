/**
 * Migration Schema Snapshot Test
 *
 * Verifies that running all migrations produces the expected database schema.
 * The schema is dumped from sqlite_master, normalized (whitespace-collapsed,
 * sorted by type+name, trailing semicolons stripped), and stored as a Jest
 * snapshot.
 *
 * When you intentionally change the schema (new migration, modified migration):
 *   1. Run: npx jest migrations.snapshot --updateSnapshot
 *   2. Inspect the diff in git carefully
 *   3. Commit the .snap file alongside your migration
 *
 * If you didn't intend to change the schema, this test failing is a signal
 * that your migration is doing something unexpected — investigate.
 */

import {createInMemoryDatabase} from '../__test_utils__/testDatabase';
import {dumpSchema, renderSchema} from '../__test_utils__/dumpSchema';
import {runMigrations} from '../migrations';
import type {NodeDatabase} from '../__test_utils__/nodeDatabase';

describe('migration schema snapshot', () => {
  let db: NodeDatabase;

  beforeEach(() => {
    db = createInMemoryDatabase();
  });

  afterEach(async () => {
    await db.close();
  });

  it('all migrations produce the expected schema', async () => {
    await runMigrations(db, true);
    const schema = await dumpSchema(db);
    expect(renderSchema(schema)).toMatchSnapshot();
  });

  it('schema has at least the core tables', async () => {
    // Sanity check — guards against the snapshot being empty due to a bug
    await runMigrations(db, true);
    const schema = await dumpSchema(db);
    const tableNames = schema
      .filter(e => e.type === 'table')
      .map(e => e.name);

    // These tables are referenced throughout the codebase; assert they exist.
    const expectedTables = [
      'character_profiles',
      'entities',
      'provider_config_openai',
      'backend_configs',
      'sync_devices',     // from migration 000005
      'sync_history',     // from migration 000005
      'memories',         // from migration 000016
      'conversation_messages',
      'interactions',
    ];

    for (const expected of expectedTables) {
      expect(tableNames).toContain(expected);
    }
  });

  it('migration is idempotent (running twice produces the same schema)', async () => {
    await runMigrations(db, true);
    const schema1 = renderSchema(await dumpSchema(db));

    await runMigrations(db, true);
    const schema2 = renderSchema(await dumpSchema(db));

    expect(schema2).toBe(schema1);
  });
});
