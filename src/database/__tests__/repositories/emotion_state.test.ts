/**
 * Emotion State Repository Tests
 *
 * Covers the deleted_at soft-delete support added in migration 000033:
 * - upsertEmotionState persists deleted_at
 * - getEmotionState filters out soft-deleted rows
 * - softDeleteEmotionState sets deleted_at + updated_at
 * - getChangedRecords('emotion_state') uses the standard 3-column deleted_at
 *   query path (NO_DELETED_AT_TABLES no longer contains emotion_state)
 */

import {useFreshDatabase} from '../repositoryFixtures';
import {getChangedRecords} from '../../sync';
import {createEntity} from '../../repositories/entities';
import {
  upsertEmotionState,
  getEmotionState,
  softDeleteEmotionState,
} from '../../repositories/emotion_state';
import type {EmotionState} from '../../models';

/** Create the parent entities row that emotion_state.entity_id FK references. */
async function createParentEntity(entityId: string): Promise<void> {
  await createEntity({
    id: entityId,
    character_profile_id: null,
    alias: '',
    lifecycle_config: '{}',
    rag_reindex_required: 1,
  });
}

function makeState(entityId: string, overrides: Partial<EmotionState> = {}): EmotionState {
  const now = new Date();
  return {
    entity_id: entityId,
    joy_intensity: 0.1,
    sadness_intensity: 0.1,
    trust_intensity: 0.1,
    disgust_intensity: 0.1,
    fear_intensity: 0.1,
    anger_intensity: 0.1,
    surprise_intensity: 0.1,
    anticipation_intensity: 0.1,
    joy_baseline: 0.1,
    sadness_baseline: 0.1,
    trust_baseline: 0.1,
    disgust_baseline: 0.1,
    fear_baseline: 0.1,
    anger_baseline: 0.1,
    surprise_baseline: 0.1,
    anticipation_baseline: 0.1,
    joy_crystallize_start: null,
    sadness_crystallize_start: null,
    trust_crystallize_start: null,
    disgust_crystallize_start: null,
    fear_crystallize_start: null,
    anger_crystallize_start: null,
    surprise_crystallize_start: null,
    anticipation_crystallize_start: null,
    last_update: now,
    decay_tau: 3600,
    high_threshold: 6,
    low_threshold: 1,
    crystallize_intensity: 7,
    crystallize_min_hours: 2,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    ...overrides,
  };
}

describe('emotion_state repository', () => {
  const {getDb} = useFreshDatabase();

  describe('soft delete support (migration 000033)', () => {
    it('upsertEmotionState persists deleted_at and getEmotionState returns the row', async () => {
      await createParentEntity('entity-emotion-1');
      const state = makeState('entity-emotion-1');
      await upsertEmotionState(state);

      const loaded = await getEmotionState('entity-emotion-1');
      expect(loaded).not.toBeNull();
      expect(loaded!.entity_id).toBe('entity-emotion-1');
      expect(loaded!.deleted_at).toBeNull();
    });

    it('getEmotionState filters out soft-deleted rows', async () => {
      await createParentEntity('entity-emotion-2');
      const state = makeState('entity-emotion-2');
      await upsertEmotionState(state);

      // Simulate a delete received from sync: set deleted_at.
      await softDeleteEmotionState('entity-emotion-2');

      const loaded = await getEmotionState('entity-emotion-2');
      expect(loaded).toBeNull();
    });

    it('softDeleteEmotionState sets deleted_at and updated_at on the row', async () => {
      await createParentEntity('entity-emotion-3');
      const state = makeState('entity-emotion-3');
      await upsertEmotionState(state);

      await softDeleteEmotionState('entity-emotion-3');

      const [result] = await getDb().executeSql(
        'SELECT deleted_at, updated_at FROM emotion_state WHERE entity_id = ?',
        ['entity-emotion-3'],
      );
      expect(result.rows.length).toBe(1);
      const row = result.rows.item(0);
      expect(row.deleted_at).not.toBeNull();
      expect(row.updated_at).not.toBeNull();
    });

    it('softDeleteEmotionState on a missing row does not throw', async () => {
      await expect(softDeleteEmotionState('entity-does-not-exist')).resolves.toBeUndefined();
    });

    it('getChangedRecords includes soft-deleted emotion_state rows (standard 3-column path)', async () => {
      await createParentEntity('entity-emotion-4');
      const state = makeState('entity-emotion-4');
      await upsertEmotionState(state);
      await softDeleteEmotionState('entity-emotion-4');

      // First sync (lastSyncTimestamp = 0): the standard deleted_at-aware path
      // includes rows with deleted_at > 0, so the soft-delete propagates.
      const records = await getChangedRecords('emotion_state', 0);
      const matching = records.filter(r => r.entity_id === 'entity-emotion-4');
      expect(matching.length).toBe(1);
      expect(matching[0].deleted_at).not.toBeNull();
    });

    it('getChangedRecords excludes live rows whose deleted_at is not set (normal query path)', async () => {
      await createParentEntity('entity-emotion-5');
      // A non-deleted row must still be returned on first sync.
      const state = makeState('entity-emotion-5');
      await upsertEmotionState(state);

      const records = await getChangedRecords('emotion_state', 0);
      const matching = records.filter(r => r.entity_id === 'entity-emotion-5');
      expect(matching.length).toBe(1);
      expect(matching[0].deleted_at).toBeNull();
    });
  });
});
