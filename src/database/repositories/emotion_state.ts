import { getDatabase } from '../connection';
import { EmotionState } from '../models';

/**
 * Upsert an emotion_state row (full row replace by entity_id).
 * Used when receiving sync data from Harmony Link.
 */
export async function upsertEmotionState(state: EmotionState): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();

  await db.executeSql(
    `INSERT OR REPLACE INTO emotion_state (
      entity_id,
      joy_intensity, sadness_intensity, trust_intensity, disgust_intensity,
      fear_intensity, anger_intensity, surprise_intensity, anticipation_intensity,
      joy_baseline, sadness_baseline, trust_baseline, disgust_baseline,
      fear_baseline, anger_baseline, surprise_baseline, anticipation_baseline,
      joy_crystallize_start, sadness_crystallize_start, trust_crystallize_start,
      disgust_crystallize_start, fear_crystallize_start, anger_crystallize_start,
      surprise_crystallize_start, anticipation_crystallize_start,
      last_update, decay_tau, high_threshold, low_threshold,
      crystallize_intensity, crystallize_min_hours,
      created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )`,
    [
      state.entity_id,
      state.joy_intensity, state.sadness_intensity, state.trust_intensity, state.disgust_intensity,
      state.fear_intensity, state.anger_intensity, state.surprise_intensity, state.anticipation_intensity,
      state.joy_baseline, state.sadness_baseline, state.trust_baseline, state.disgust_baseline,
      state.fear_baseline, state.anger_baseline, state.surprise_baseline, state.anticipation_baseline,
      state.joy_crystallize_start ? state.joy_crystallize_start.toISOString() : null,
      state.sadness_crystallize_start ? state.sadness_crystallize_start.toISOString() : null,
      state.trust_crystallize_start ? state.trust_crystallize_start.toISOString() : null,
      state.disgust_crystallize_start ? state.disgust_crystallize_start.toISOString() : null,
      state.fear_crystallize_start ? state.fear_crystallize_start.toISOString() : null,
      state.anger_crystallize_start ? state.anger_crystallize_start.toISOString() : null,
      state.surprise_crystallize_start ? state.surprise_crystallize_start.toISOString() : null,
      state.anticipation_crystallize_start ? state.anticipation_crystallize_start.toISOString() : null,
      state.last_update instanceof Date ? state.last_update.toISOString() : state.last_update,
      state.decay_tau, state.high_threshold, state.low_threshold,
      state.crystallize_intensity, state.crystallize_min_hours,
      state.created_at instanceof Date ? state.created_at.toISOString() : (state.created_at ?? now),
      state.updated_at instanceof Date ? state.updated_at.toISOString() : (state.updated_at ?? now),
    ]
  );
}

/**
 * Get the emotion state for a specific entity.
 */
export async function getEmotionState(entityId: string): Promise<EmotionState | null> {
  const db = getDatabase();
  const [result] = await db.executeSql(
    'SELECT * FROM emotion_state WHERE entity_id = ?',
    [entityId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows.item(0);
  return mapRowToEmotionState(row);
}

function mapRowToEmotionState(row: any): EmotionState {
  return {
    entity_id: row.entity_id,
    joy_intensity: row.joy_intensity,
    sadness_intensity: row.sadness_intensity,
    trust_intensity: row.trust_intensity,
    disgust_intensity: row.disgust_intensity,
    fear_intensity: row.fear_intensity,
    anger_intensity: row.anger_intensity,
    surprise_intensity: row.surprise_intensity,
    anticipation_intensity: row.anticipation_intensity,
    joy_baseline: row.joy_baseline,
    sadness_baseline: row.sadness_baseline,
    trust_baseline: row.trust_baseline,
    disgust_baseline: row.disgust_baseline,
    fear_baseline: row.fear_baseline,
    anger_baseline: row.anger_baseline,
    surprise_baseline: row.surprise_baseline,
    anticipation_baseline: row.anticipation_baseline,
    joy_crystallize_start: row.joy_crystallize_start ? new Date(row.joy_crystallize_start) : null,
    sadness_crystallize_start: row.sadness_crystallize_start ? new Date(row.sadness_crystallize_start) : null,
    trust_crystallize_start: row.trust_crystallize_start ? new Date(row.trust_crystallize_start) : null,
    disgust_crystallize_start: row.disgust_crystallize_start ? new Date(row.disgust_crystallize_start) : null,
    fear_crystallize_start: row.fear_crystallize_start ? new Date(row.fear_crystallize_start) : null,
    anger_crystallize_start: row.anger_crystallize_start ? new Date(row.anger_crystallize_start) : null,
    surprise_crystallize_start: row.surprise_crystallize_start ? new Date(row.surprise_crystallize_start) : null,
    anticipation_crystallize_start: row.anticipation_crystallize_start ? new Date(row.anticipation_crystallize_start) : null,
    last_update: new Date(row.last_update),
    decay_tau: row.decay_tau,
    high_threshold: row.high_threshold,
    low_threshold: row.low_threshold,
    crystallize_intensity: row.crystallize_intensity,
    crystallize_min_hours: row.crystallize_min_hours,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}