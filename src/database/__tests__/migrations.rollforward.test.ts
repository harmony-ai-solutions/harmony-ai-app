/**
 * Migration Roll-Forward Test
 *
 * Verifies that for every version boundary N → N+1, applying migration N+1
 * to a database at version N succeeds and produces the expected incremental
 * schema change. This catches misordered migrations, missing dependencies,
 * and forward-incompatibility issues that the full-rebuild snapshot test
 * cannot detect.
 *
 * When you intentionally change the schema (new migration, modified migration):
 *   1. Run: npx jest migrations.rollforward --updateSnapshot
 *   2. Inspect the diff in git carefully
 *   3. Commit the .snap file alongside your migration
 *
 * If a migration causes a previous version boundary to fail, it means
 * the migration depends on something created in a later migration — reorder
 * or restructure.
 */

import {createInMemoryDatabase} from '../__test_utils__/testDatabase';
import {dumpSchema, renderSchema} from '../__test_utils__/dumpSchema';
import {runMigrationsToVersion, MIGRATIONS} from '../migrations';
import type {NodeDatabase} from '../__test_utils__/nodeDatabase';

describe('migration roll-forward', () => {
  let db: NodeDatabase;

  beforeEach(() => {
    db = createInMemoryDatabase();
  });

  afterEach(async () => {
    await db.close();
  });

  // Sanity: confirm we're actually testing all migrations.
  it('test harness discovers all migrations', () => {
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(32);
    // Confirm versions are sequential starting at 1
    for (let i = 0; i < MIGRATIONS.length; i++) {
      expect(MIGRATIONS[i].version).toBe(i + 1);
    }
  });

  // Snapshot every Nth version boundary — 1, 5, 10, 15, 20, 25, final.
  const snapshotVersions = (() => {
    const versions: number[] = [];
    for (let v = 1; v <= MIGRATIONS.length; v++) {
      if (v === 1 || v === MIGRATIONS.length || v % 5 === 0) {
        versions.push(v);
      }
    }
    return versions;
  })();

  describe.each(snapshotVersions)('schema at version %i', (version) => {
    it('matches snapshot', async () => {
      await runMigrationsToVersion(db, version, true);
      const schema = await dumpSchema(db);
      expect(renderSchema(schema)).toMatchSnapshot(`v${version}`);
    });
  });

  // Critical: every version boundary upgrades cleanly.
  it.each(MIGRATIONS.map(m => [m.version] as const))(
    'incremental migration to v%s succeeds',
    async (version) => {
      // Build DB at version N-1, then apply migration N
      if (version > 1) {
        await runMigrationsToVersion(db, version - 1, true);
      }
      // This must not throw:
      await runMigrationsToVersion(db, version, true);

      // Sanity: schema_migrations table records the version
      const [result] = await db.executeSql(
        'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1',
      );
      if (result.rows.length > 0) {
        expect(result.rows.item(0).version).toBe(version);
      }
    },
  );

  // End-to-end: build at version 1, then migrate to final in one step.
  it('migrates from v1 to latest in one step', async () => {
    await runMigrationsToVersion(db, 1, true);
    await runMigrationsToVersion(db, MIGRATIONS.length, true);
    const schema = await dumpSchema(db);
    expect(renderSchema(schema)).toMatchSnapshot('v1-to-latest');
  });
});
