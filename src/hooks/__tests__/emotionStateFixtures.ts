/**
 * Shared test fixtures for an `EmotionState` vector and the engine-derived view
 * (not a suite — the jest `testMatch` only picks `*.test.ts(x)` files).
 */

import type { EmotionState } from '../../database/models';
import type { EmotionSnapshot } from '../../services/engine/repositories/emotion_state';
import type { EmotionDerived } from '../../services/engine/engineApiMappers';

export function buildEmotionState(overrides: Partial<EmotionState> = {}): EmotionState {
  return {
    entity_id: 'ent-1',
    joy_intensity: 7.2,
    sadness_intensity: 1.1,
    trust_intensity: 3.0,
    disgust_intensity: 0,
    fear_intensity: 0.4,
    anger_intensity: 0,
    surprise_intensity: 2.2,
    anticipation_intensity: 4.5,
    joy_baseline: 3.1,
    sadness_baseline: 1.0,
    trust_baseline: 3.0,
    disgust_baseline: 0,
    fear_baseline: 0.4,
    anger_baseline: 0,
    surprise_baseline: 2.0,
    anticipation_baseline: 4.0,
    joy_crystallize_start: new Date('2026-11-16T09:00:00Z'),
    sadness_crystallize_start: null,
    trust_crystallize_start: null,
    disgust_crystallize_start: null,
    fear_crystallize_start: null,
    anger_crystallize_start: null,
    surprise_crystallize_start: null,
    anticipation_crystallize_start: null,
    last_update: new Date('2026-11-17T14:32:00Z'),
    decay_tau: 6,
    high_threshold: 7,
    low_threshold: 2,
    crystallize_intensity: 9,
    crystallize_min_hours: 24,
    created_at: new Date('2026-11-01T00:00:00Z'),
    updated_at: new Date('2026-11-17T14:32:00Z'),
    deleted_at: null,
    ...overrides,
  };
}

export function buildEmotionDerived(overrides: Partial<EmotionDerived> = {}): EmotionDerived {
  return {
    dominantEmotion: 'joy',
    dominantIntensity: 9.4,
    intensityLabel: 'overwhelming',
    intensityLabels: { joy: 'overwhelming', sadness: 'neutral' },
    activeDyads: [
      {
        keyword: 'affection',
        type: 'primary',
        sourceEmotions: ['joy', 'trust'],
        sourceIntensities: [9.4, 6.2],
        combinedIntensity: 15.6,
        description: 'a warm sense of affection blooms in your heart',
      },
    ],
    topEmotions: [
      { emotion: 'joy', intensity: 9.4, label: 'overwhelming' },
      { emotion: 'trust', intensity: 6.2, label: 'strong' },
      { emotion: 'anticipation', intensity: 4.8, label: 'moderate' },
    ],
    ...overrides,
  };
}

export function buildEmotionSnapshot(
  overrides: Partial<EmotionSnapshot> = {},
): EmotionSnapshot {
  return {
    state: buildEmotionState(),
    derived: buildEmotionDerived(),
    ...overrides,
  };
}
