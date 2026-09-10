import {createInMemoryDatabase} from '../__test_utils__/testDatabase';

describe('NodeDatabase smoke', () => {
  it('executes a SELECT', async () => {
    const db = createInMemoryDatabase();
    const [result] = await db.executeSql('SELECT 42 AS answer');
    expect(result.rows.length).toBe(1);
    expect(result.rows.item(0).answer).toBe(42);
    await db.close();
  });

  it('runs a transaction', async () => {
    const db = createInMemoryDatabase();
    await db.executeSql('CREATE TABLE t (x INTEGER)');
    await db.transaction(async tx => {
      await tx.executeSql('INSERT INTO t VALUES (1)');
      await tx.executeSql('INSERT INTO t VALUES (2)');
    });
    const [r] = await db.executeSql('SELECT COUNT(*) AS n FROM t');
    expect(r.rows.item(0).n).toBe(2);
    await db.close();
  });

  it('rolls back on error', async () => {
    const db = createInMemoryDatabase();
    await db.executeSql('CREATE TABLE t (x INTEGER UNIQUE)');

    await expect(
      db.transaction(async tx => {
        await tx.executeSql('INSERT INTO t VALUES (1)');
        await tx.executeSql('INSERT INTO t VALUES (1)'); // throws
      }),
    ).rejects.toThrow();

    const [r] = await db.executeSql('SELECT COUNT(*) AS n FROM t');
    expect(r.rows.item(0).n).toBe(0); // rolled back
    await db.close();
  });
});
