/**
 * Node-side adapter compatibility test.
 *
 * Runs every QueryCase through the NodeDatabase adapter to verify
 * correct behavior. The RN-side runner (rnSide.ts) is a stub
 * pending a booted RN environment.
 */
import {createInMemoryDatabase} from '../../__test_utils__/testDatabase';
import type {NodeDatabase} from '../../__test_utils__/nodeDatabase';
import {queryCases} from './queries';

describe('NodeDatabase compatibility', () => {
  let db: NodeDatabase;

  beforeEach(() => {
    db = createInMemoryDatabase();
  });

  afterEach(async () => {
    await db.close();
  });

  for (const testCase of queryCases) {
    it(`Node: ${testCase.name}`, async () => {
      // Run setup statements
      for (const setupSql of testCase.setup ?? []) {
        await db.executeSql(setupSql);
      }

      // Run the query
      const [result] = await db.executeSql(testCase.sql, testCase.params);

      // Run validators
      if (testCase.validate) {
        testCase.validate(result, {db});
      }
      if (testCase.validateInsertId) {
        testCase.validateInsertId(result.insertId);
      }
      if (testCase.validateRowsAffected) {
        testCase.validateRowsAffected(result.rowsAffected);
      }
    });
  }

  // ====================================================================
  // Additional transaction-specific tests
  // ====================================================================

  it('Node: transaction commit persists changes', async () => {
    await db.executeSql('CREATE TABLE tx_test (x INTEGER)');
    await db.transaction(async tx => {
      await tx.executeSql('INSERT INTO tx_test VALUES (100)');
      await tx.executeSql('INSERT INTO tx_test VALUES (200)');
    });
    const [r] = await db.executeSql('SELECT COUNT(*) AS n FROM tx_test');
    expect(r.rows.item(0).n).toBe(2);
  });

  it('Node: transaction rollback on error', async () => {
    await db.executeSql('CREATE TABLE tx_rollback (x INTEGER UNIQUE)');
    await db.executeSql('INSERT INTO tx_rollback VALUES (1)');

    await expect(
      db.transaction(async tx => {
        await tx.executeSql('INSERT INTO tx_rollback VALUES (1)'); // duplicate
      }),
    ).rejects.toThrow();

    // Verify rollback: only the original row exists
    const [r] = await db.executeSql('SELECT COUNT(*) AS n FROM tx_rollback');
    expect(r.rows.item(0).n).toBe(1);
  });

  it('Node: FK constraint violation rejects', async () => {
    await db.executeSql('CREATE TABLE fk_parent (id INTEGER PRIMARY KEY)');
    await db.executeSql(
      'CREATE TABLE fk_child (id INTEGER PRIMARY KEY, pid INTEGER REFERENCES fk_parent(id))',
    );

    await expect(
      db.executeSql('INSERT INTO fk_child (id, pid) VALUES (1, 999)'),
    ).rejects.toThrow();
  });

  it('Node: UNIQUE constraint violation rejects', async () => {
    await db.executeSql('CREATE TABLE uniq (x INTEGER UNIQUE)');
    await db.executeSql('INSERT INTO uniq VALUES (1)');

    await expect(
      db.executeSql('INSERT INTO uniq VALUES (1)'),
    ).rejects.toThrow();
  });
});
