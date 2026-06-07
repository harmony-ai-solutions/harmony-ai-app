/**
 * Migration 000014: Add Emotion State
 *
 * Mirrors Harmony Link migration 000014_add_emotion_state.up.sql.
 * Creates the emotion_state table for Ekman8 emotional model persistence.
 * Stores per-entity emotion intensities, crystallized baselines, and decay configuration.
 */

export const migration014 = `
CREATE TABLE IF NOT EXISTS emotion_state (
    entity_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,

    joy_intensity           REAL NOT NULL DEFAULT 0.1,
    sadness_intensity       REAL NOT NULL DEFAULT 0.1,
    trust_intensity         REAL NOT NULL DEFAULT 0.1,
    disgust_intensity       REAL NOT NULL DEFAULT 0.1,
    fear_intensity          REAL NOT NULL DEFAULT 0.1,
    anger_intensity         REAL NOT NULL DEFAULT 0.1,
    surprise_intensity      REAL NOT NULL DEFAULT 0.1,
    anticipation_intensity  REAL NOT NULL DEFAULT 0.1,

    joy_baseline            REAL NOT NULL DEFAULT 0.1,
    sadness_baseline        REAL NOT NULL DEFAULT 0.1,
    trust_baseline          REAL NOT NULL DEFAULT 0.1,
    disgust_baseline        REAL NOT NULL DEFAULT 0.1,
    fear_baseline           REAL NOT NULL DEFAULT 0.1,
    anger_baseline          REAL NOT NULL DEFAULT 0.1,
    surprise_baseline       REAL NOT NULL DEFAULT 0.1,
    anticipation_baseline   REAL NOT NULL DEFAULT 0.1,

    joy_crystallize_start           TIMESTAMP NULL,
    sadness_crystallize_start       TIMESTAMP NULL,
    trust_crystallize_start         TIMESTAMP NULL,
    disgust_crystallize_start       TIMESTAMP NULL,
    fear_crystallize_start          TIMESTAMP NULL,
    anger_crystallize_start         TIMESTAMP NULL,
    surprise_crystallize_start      TIMESTAMP NULL,
    anticipation_crystallize_start  TIMESTAMP NULL,

    last_update TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decay_tau REAL NOT NULL DEFAULT 3600.0,

    high_threshold REAL NOT NULL DEFAULT 6.0,
    low_threshold REAL NOT NULL DEFAULT 1.0,

    crystallize_intensity REAL NOT NULL DEFAULT 7.0,
    crystallize_min_hours REAL NOT NULL DEFAULT 2.0,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_emotion_state_entity_id ON emotion_state(entity_id)
`;