/**
 * Regression test for migration 000037 (add_character_card_standard_fields).
 *
 * BACKGROUND: migration 037 rebuilds `character_profiles` via the _new-table
 * pattern and ends with `DROP TABLE character_profiles`. On a database that has
 * character data, the DROP fires the implicit DELETE, which triggers the FK
 * action on child tables. `entities.character_profile_id` references
 * character_profiles with `ON DELETE RESTRICT`, so any existing entity row
 * referencing a character profile makes the DROP throw
 * SQLITE_CONSTRAINT_TRIGGER (1811) — observed on-device as:
 *
 *   "Failed to apply migration 37: FOREIGN KEY constraint failed (code 1811
 *    SQLITE_CONSTRAINT_TRIGGER)"
 *
 * …which left the app with `db = null` (initialization aborted), and the next
 * sync failed to apply because the database was never initialized.
 *
 * Migration 034 handles the identical situation by wrapping its DROP in
 * `PRAGMA foreign_keys = OFF` / `ON`. Migration 037 assumed "FKs are disabled
 * for the migration session" but the runner never disables them. This test pins
 * the fix: upgrading v36 → v37 with existing character data must succeed and
 * preserve the rows.
 */

import {createInMemoryDatabase} from '../__test_utils__/testDatabase';
import {runMigrationsToVersion} from '../migrations';
import type {NodeDatabase} from '../__test_utils__/nodeDatabase';

describe('migration 037 with existing character data', () => {
  let db: NodeDatabase;

  beforeEach(() => {
    db = createInMemoryDatabase();
  });

  afterEach(async () => {
    await db.close();
  });

  it('upgrades v36 → v37 without FK violation when entities reference character_profiles', async () => {
    await runMigrationsToVersion(db, 36, true);

    // Seed data that triggers the bug: a character profile with an entity
    // referencing it (entities FK is ON DELETE RESTRICT).
    await db.executeSql(
      `INSERT INTO character_profiles (id, name) VALUES (?, ?)`,
      ['cp-1', 'Test Character'],
    );
    await db.executeSql(
      `INSERT INTO entities (id, character_profile_id, alias) VALUES (?, ?, ?)`,
      ['ent-1', 'cp-1', 'Test Entity'],
    );

    // Regression: with FKs ON and a child row present, migration 037's
    // DROP TABLE character_profiles used to throw SQLITE_CONSTRAINT_TRIGGER.
    await expect(runMigrationsToVersion(db, 37, true)).resolves.toBeUndefined();

    // The rebuilt table must retain the seeded row.
    const [rows] = await db.executeSql(
      `SELECT id, name FROM character_profiles WHERE id = ?`,
      ['cp-1'],
    );
    expect(rows.rows.length).toBe(1);
    expect(rows.rows.item(0).name).toBe('Test Character');
  });

  it('preserves V3 folded content (appearance/backstory → description) with data present', async () => {
    await runMigrationsToVersion(db, 36, true);

    await db.executeSql(
      `INSERT INTO character_profiles (id, name, appearance, backstory) VALUES (?, ?, ?, ?)`,
      ['cp-2', 'Folded', 'AppearanceText', 'BackstoryText'],
    );

    await runMigrationsToVersion(db, 37, true);

    const [rows] = await db.executeSql(
      `SELECT description FROM character_profiles WHERE id = ?`,
      ['cp-2'],
    );
    expect(rows.rows.length).toBe(1);
    const description: string = rows.rows.item(0).description;
    expect(description).toContain('AppearanceText');
    expect(description).toContain('BackstoryText');
  });
});