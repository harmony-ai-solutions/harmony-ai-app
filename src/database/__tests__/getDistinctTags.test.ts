/**
 * getDistinctTags (4-3) — character tag filtering over SQLite JSON1.
 *
 * Uses the NodeDatabase (better-sqlite3, JSON1-enabled) to verify:
 *  - `json_each(tags)` returns distinct tags (case-insensitively deduped, sorted)
 *  - soft-deleted profiles are excluded
 *  - malformed/absent JSON columns are tolerated
 *  - the client-side fallback kicks in when JSON1 is unavailable
 */

import { createMigratedDatabase } from '../__test_utils__/testDatabase';
import type { Database } from '../types';

jest.mock('../connection', () => ({
  getDatabase: jest.fn(),
}));

import { getDatabase } from '../connection';
import { getDistinctTags } from '../repositories/characters';

const mockGetDatabase = getDatabase as jest.Mock;

async function insertProfile(
  db: Database,
  id: string,
  name: string,
  tags: string,
): Promise<void> {
  await db.executeSql(
    `INSERT INTO character_profiles (id, name, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, name, tags, new Date().toISOString(), new Date().toISOString()],
  );
}

describe('getDistinctTags (4-3)', () => {
  let db: Database;

  beforeEach(async () => {
    db = await createMigratedDatabase();
    mockGetDatabase.mockReturnValue(db);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await db.close();
  });

  it('returns distinct tags via JSON1 json_each, deduped case-insensitively + sorted', async () => {
    await insertProfile(db, 'p1', 'Aria', '["fantasy","mage","music"]');
    await insertProfile(db, 'p2', 'Bryn', '["FANTASY","rogue"]');
    await insertProfile(db, 'p3', 'Cara', '["music"]');

    const tags = await getDistinctTags();

    // "FANTASY"/"fantasy" deduped to one entry; sorted case-insensitively.
    expect(tags).toEqual(['fantasy', 'mage', 'music', 'rogue']);
  });

  it('excludes profiles without tags and soft-deleted profiles', async () => {
    await insertProfile(db, 'p1', 'Aria', '["fantasy"]');
    // Migration 000037 made tags NOT NULL DEFAULT '' — "no tags" is '' now.
    await insertProfile(db, 'p2', 'NoTags', '');
    await insertProfile(db, 'p3', 'NullTags', 'null');
    await insertProfile(db, 'p4', 'Deleted', '["deleted-tag"]');
    await db.executeSql(
      `UPDATE character_profiles SET deleted_at = ? WHERE id = 'p4'`,
      [new Date().toISOString()],
    );

    expect(await getDistinctTags()).toEqual(['fantasy']);
  });

  it('falls back to client-side computation when the JSON1 query fails', async () => {
    await insertProfile(db, 'p1', 'Aria', '["fantasy","mage"]');
    await insertProfile(db, 'p2', 'Bryn', '["Rogue"]');

    const realExecute = db.executeSql.bind(db);
    const broken = {
      ...db,
      executeSql: jest.fn((sql: string, params?: any[]) => {
        if (sql.includes('json_each')) {
          return Promise.reject(new Error('no such function: json_each'));
        }
        return realExecute(sql, params);
      }),
    } as unknown as Database;
    mockGetDatabase.mockReturnValue(broken);

    const tags = await getDistinctTags();
    // Casing is deduped case-insensitively but the first-seen spelling survives.
    expect(tags).toEqual(['fantasy', 'mage', 'Rogue']);
  });
});
