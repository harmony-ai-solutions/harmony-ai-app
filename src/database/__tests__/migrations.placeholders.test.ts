/**
 * Placeholder migration tests (phase 3-2 / D85).
 *
 * Migrations 000045 and 000046 are comment-only no-op placeholders that keep
 * the app migration NUMBER aligned with the engine's (app 000045 == engine
 * 000045, same for 000046). The runner strips SQL comments
 * (`migrations.ts` `stripSqlComments`), leaving zero executable statements,
 * while the version is still recorded in `schema_migrations`.
 *
 * These tests pin:
 *   - the binding description texts (D11 / D73 / phase 3-2 doc),
 *   - version recording for both placeholders,
 *   - that applying them executes NO SQL statements (only the runner's own
 *     bookkeeping: create-if-not-exists, applied-versions SELECT, version
 *     INSERT).
 */

import {createInMemoryDatabase} from '../__test_utils__/testDatabase';
import {runMigrations, runMigrationsToVersion, MIGRATIONS} from '../migrations';
import type {NodeDatabase} from '../__test_utils__/nodeDatabase';

describe('placeholder migrations 000045 / 000046', () => {
  let db: NodeDatabase;

  beforeEach(() => {
    db = createInMemoryDatabase();
  });

  afterEach(async () => {
    await db.close();
  });

  it('registers 000045 and 000046 with the binding descriptions', () => {
    const m45 = MIGRATIONS.find(m => m.version === 45);
    const m46 = MIGRATIONS.find(m => m.version === 46);

    expect(m45).toBeDefined();
    expect(m45!.description).toBe(
      'Placeholder — engine counterpart 000045 performs the entity id-pattern migration; ' +
        'app converges via full re-sync (no local data migration required).',
    );

    expect(m46).toBeDefined();
    expect(m46!.description).toBe(
      'Placeholder — engine counterpart 000046 adds engine-local `sync_gc_state` ' +
        '(tombstone-GC purge floor); the app needs no schema change.',
    );

    // Sequential numbering is preserved (the roll-forward harness relies on it).
    expect(MIGRATIONS[MIGRATIONS.length - 1].version).toBe(46);
    expect(MIGRATIONS[MIGRATIONS.length - 2].version).toBe(45);
  });

  it('000045 records its version and executes zero SQL statements', async () => {
    // Build the DB at version 44 first, then apply only 000045.
    await runMigrationsToVersion(db, 44, true);

    const executeSql = jest.spyOn(db, 'executeSql');
    await runMigrationsToVersion(db, 45, true);

    // The version was recorded.
    const [result] = await db.executeSql(
      'SELECT version FROM schema_migrations WHERE version = 45',
    );
    expect(result.rows.length).toBe(1);

    // Every executeSql call during the v45 apply is runner bookkeeping — no
    // statement from the migration body (it is comment-only, so the
    // statement-split loop in applyMigration never fires).
    const unexpected = executeSql.mock.calls.filter(
      ([sql]) =>
        !String(sql).trimStart().startsWith('CREATE TABLE IF NOT EXISTS schema_migrations') &&
        !String(sql).trim().startsWith('SELECT version FROM schema_migrations') &&
        !String(sql).trim().startsWith('INSERT INTO schema_migrations'),
    );
    expect(unexpected).toEqual([]);
  });

  it('000046 records its version and executes zero SQL statements', async () => {
    await runMigrationsToVersion(db, 45, true);

    const executeSql = jest.spyOn(db, 'executeSql');
    await runMigrationsToVersion(db, 46, true);

    const [result] = await db.executeSql(
      'SELECT version FROM schema_migrations WHERE version = 46',
    );
    expect(result.rows.length).toBe(1);

    const unexpected = executeSql.mock.calls.filter(
      ([sql]) =>
        !String(sql).trimStart().startsWith('CREATE TABLE IF NOT EXISTS schema_migrations') &&
        !String(sql).trim().startsWith('SELECT version FROM schema_migrations') &&
        !String(sql).trim().startsWith('INSERT INTO schema_migrations'),
    );
    expect(unexpected).toEqual([]);
  });

  it('runs cleanly to latest (both placeholders) from a fresh DB', async () => {
    // The full-run path (used by the snapshot + roll-forward suites) must
    // apply both placeholders without error and record both versions.
    await runMigrations(db, true);

    const [result] = await db.executeSql(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    const versions: number[] = [];
    for (let i = 0; i < result.rows.length; i++) {
      versions.push(result.rows.item(i).version);
    }
    expect(versions).toContain(45);
    expect(versions).toContain(46);
  });
});