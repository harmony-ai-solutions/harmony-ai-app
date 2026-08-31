/**
 * is_favorite profile-row sync round-trip via getChangedRecords (000044).
 *
 * Favorites now live on the `character_profiles` row as the `is_favorite` flag
 * (the favorites sidecar table is gone). The sync contract is: a
 * favorite toggle bumps the profile row's `updated_at` (writers-supply-
 * timestamps) so the change rides the full-row profile sync through
 * `getChangedRecords`. `is_favorite` is a JSON NUMBER (0/1) — there is NO
 * boolean normalization entry for character_profiles (same convention as
 * `pinned`/`archived`).
 */

import {useFreshDatabase} from '../repositoryFixtures';
import {getChangedRecords} from '../../sync';
import {
  addCharacterFavorite,
  removeCharacterFavorite,
} from '../../repositories/characters';
import {createCharacterProfile} from '../../repositories/characters';

describe('is_favorite profile-row sync round-trip via getChangedRecords (000044)', () => {
  const {getDb} = useFreshDatabase();

  async function createProfile(id: string): Promise<void> {
    await createCharacterProfile({
      id,
      name: `Profile ${id}`,
      description: '',
      personality: '',
      voice_characteristics: '',
      base_prompt: '',
      scenario: '',
      typing_speed_wpm: 60,
      audio_response_chance_percent: 50,
      vision_config_id: null,
      lifecycle_config: '{}',
    });
  }

  it('a favorited profile is picked up by getChangedRecords(since=0) with is_favorite=1 (JSON number)', async () => {
    await createProfile('fav-live-1');
    await addCharacterFavorite('fav-live-1');

    const records = await getChangedRecords('character_profiles', 0);
    const match = records.find(r => r.id === 'fav-live-1');
    expect(match).toBeDefined();
    // Pre-decided shape contract: NO boolean normalization for character_profiles —
    // is_favorite rides as a 0/1 JSON number (Go int64), NOT a boolean.
    expect(typeof match.is_favorite).toBe('number');
    expect(match.is_favorite).toBe(1);
    expect(match.deleted_at).toBeNull();
  });

  it('a non-favorited profile rides as is_favorite=0', async () => {
    await createProfile('fav-off-1');
    const records = await getChangedRecords('character_profiles', 0);
    const match = records.find(r => r.id === 'fav-off-1');
    expect(match).toBeDefined();
    expect(match.is_favorite).toBe(0);
  });

  it('an un-favorite clears the flag and bumps updated_at (plain flag clear, no tombstone)', async () => {
    await createProfile('fav-tom-1');
    await addCharacterFavorite('fav-tom-1');

    const [beforeRes] = await getDb().executeSql(
      'SELECT updated_at, is_favorite, deleted_at FROM character_profiles WHERE id = ?',
      ['fav-tom-1'],
    );
    const beforeRow = beforeRes.rows.item(0);
    expect(beforeRow.is_favorite).toBe(1);

    // Cursor-safe delay so the explicit updated_at strictly increases.
    await new Promise(r => setTimeout(r, 5));
    await removeCharacterFavorite('fav-tom-1');

    const [afterRes] = await getDb().executeSql(
      'SELECT updated_at, is_favorite, deleted_at FROM character_profiles WHERE id = ?',
      ['fav-tom-1'],
    );
    const afterRow = afterRes.rows.item(0);
    expect(afterRow.is_favorite).toBe(0);
    expect(Date.parse(afterRow.updated_at)).toBeGreaterThan(Date.parse(beforeRow.updated_at));
    expect(afterRow.deleted_at).toBeNull(); // no tombstone — plain flag clear

    // And it flows through the changed set as is_favorite=0 with a bumped watermark.
    const records = await getChangedRecords('character_profiles', 0);
    const match = records.find(r => r.id === 'fav-tom-1');
    expect(match).toBeDefined();
    expect(match.is_favorite).toBe(0);
    expect(match.deleted_at).toBeNull();
  });

  it('incremental getChangedRecords only returns a favorited profile when updated_at is fresh', async () => {
    await createProfile('fav-inc-1');
    await addCharacterFavorite('fav-inc-1');

    const [res] = await getDb().executeSql(
      'SELECT updated_at FROM character_profiles WHERE id = ?',
      ['fav-inc-1'],
    );
    const nowUnix = Math.floor(Date.parse(res.rows.item(0).updated_at) / 1000);

    // With since = now+5 (a future watermark), the row is NOT returned.
    const incremental = await getChangedRecords('character_profiles', nowUnix + 5);
    expect(incremental.find(r => r.id === 'fav-inc-1')).toBeUndefined();
  });
});
