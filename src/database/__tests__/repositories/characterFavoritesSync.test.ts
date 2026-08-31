/**
 * character_favorites round-trip through getChangedRecords (4-1).
 *
 * Favorites now participate in engine sync (Phase-1 schema + this registration).
 * The sync contract is a watermark triple + soft delete: a favorited row rides
 * as a live row, an un-favorite lands as a tombstone (`deleted_at` set) in the
 * changed set, and a resurrect clears the tombstone and bumps `updated_at` —
 * exactly the Phase-1 repository semantics (favorited_at dropped, created_at
 * subsumes it, Q5).
 */

import {useFreshDatabase} from '../repositoryFixtures';
import {getChangedRecords} from '../../sync';
import {
  addCharacterFavorite,
  removeCharacterFavorite,
  isCharacterFavorite,
} from '../../repositories/characters';
import {createCharacterProfile} from '../../repositories/characters';

describe('character_favorites sync round-trip via getChangedRecords (4-1)', () => {
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

  it('a favorited row is picked up by getChangedRecords(since=0) as live', async () => {
    await createProfile('fav-live-1');
    await addCharacterFavorite('fav-live-1');

    const records = await getChangedRecords('character_favorites', 0);
    const match = records.find(r => r.profile_id === 'fav-live-1');
    expect(match).toBeDefined();
    expect(match.deleted_at).toBeNull();
  });

  it('an un-favorite (soft-delete tombstone) lands in the changed set with deleted_at set', async () => {
    await createProfile('fav-tom-1');
    await addCharacterFavorite('fav-tom-1');
    await removeCharacterFavorite('fav-tom-1');

    const records = await getChangedRecords('character_favorites', 0);
    const match = records.find(r => r.profile_id === 'fav-tom-1');
    expect(match).toBeDefined();
    expect(match.deleted_at).not.toBeNull();
  });

  it('a resurrect clears the tombstone, bumps updated_at, and is reported live', async () => {
    await createProfile('fav-res-1');
    await addCharacterFavorite('fav-res-1');

    // Tombstone it (the `deleted_at` earlier than the resurrect's).
    await removeCharacterFavorite('fav-res-1');
    const [tombRes] = await getDb().executeSql(
      'SELECT updated_at, deleted_at FROM character_favorites WHERE profile_id = ?',
      ['fav-res-1'],
    );
    const tombstoneDeletedAt = tombRes.rows.item(0).deleted_at;

    // Resurrect it after a small delay so updated_at strictly increases.
    await new Promise(r => setTimeout(r, 5));
    await addCharacterFavorite('fav-res-1');

    expect(await isCharacterFavorite('fav-res-1')).toBe(true);

    const [res] = await getDb().executeSql(
      'SELECT updated_at, deleted_at FROM character_favorites WHERE profile_id = ?',
      ['fav-res-1'],
    );
    const row = res.rows.item(0);
    expect(row.deleted_at).toBeNull();
    expect(Date.parse(row.updated_at)).toBeGreaterThan(Date.parse(tombstoneDeletedAt));

    const records = await getChangedRecords('character_favorites', 0);
    const match = records.find(r => r.profile_id === 'fav-res-1');
    expect(match).toBeDefined();
    expect(match.deleted_at).toBeNull();
  });

  it('unchanged rows only reload with since=0 (full) — incremental path requires updated_at freshness', async () => {
    await createProfile('fav-inc-1');
    await addCharacterFavorite('fav-inc-1');

    const [res] = await getDb().executeSql(
      'SELECT updated_at FROM character_favorites WHERE profile_id = ?',
      ['fav-inc-1'],
    );
    const nowUnix = Math.floor(Date.parse(res.rows.item(0).updated_at) / 1000);

    // With since = now (a future watermark), the row is NOT returned.
    const incremental = await getChangedRecords('character_favorites', nowUnix + 5);
    expect(incremental.find(r => r.profile_id === 'fav-inc-1')).toBeUndefined();
  });
});
