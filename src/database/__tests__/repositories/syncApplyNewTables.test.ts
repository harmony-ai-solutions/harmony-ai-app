/**
 * chat_conversation_settings sync shape contract (4-1, Q5).
 *
 * The `applySyncRecord` tests that used to live here were deleted with the
 * function itself (4-1 / D73: test-only dead code — the REAL apply path is
 * `applyBufferedSyncData` in SyncService, not `applySyncRecord`). What remains
 * is the pre-decided wire-shape contract: `chat_conversation_settings`
 * `pinned`/`archived` ride through `getChangedRecords` as JSON numbers (0/1),
 * NOT booleans (Go int64).
 * (The favorites table used to be registered here too but was replaced by the
 * `is_favorite` column on character_profiles in migration 000044.)
 */

import {useFreshDatabase} from '../repositoryFixtures';
import {getChangedRecords} from '../../sync';

describe('chat_conversation_settings sync shape contract (4-1)', () => {
  const {getDb} = useFreshDatabase();

  it('rides pinned/archived as JSON numbers (0/1) through getChangedRecords (4-1 contract)', async () => {
    const db = getDb();
    await db.executeSql(
      `INSERT INTO chat_conversation_settings
        (participant_key, entity_id, pinned, archived, reply_mode, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'pk-wire',
        'entity-1',
        1,
        0,
        'realistic',
        '2026-08-31T00:00:00.000Z',
        '2026-08-31T00:00:00.000Z',
        null,
      ],
    );

    const records = await getChangedRecords('chat_conversation_settings', 0);
    const match = records.find(r => r.participant_key === 'pk-wire');
    expect(match).toBeDefined();
    // Pre-decided shape contract: NO boolean normalization for
    // chat_conversation_settings — pinned/archived ride as 0/1 JSON numbers
    // (Go int64), NOT booleans.
    expect(typeof match.pinned).toBe('number');
    expect(match.pinned).toBe(1);
    expect(typeof match.archived).toBe('number');
    expect(match.archived).toBe(0);
  });
});