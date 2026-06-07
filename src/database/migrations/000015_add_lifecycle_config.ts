/**
 * Migration 000015: Add Lifecycle Config
 *
 * Mirrors Harmony Link migration 000015_add_lifecycle_config.up.sql.
 * Adds lifecycle_config JSON column to character_profiles and entities.
 * Stored as opaque TEXT blob (consistent with stop_tokens, workflow_profiles).
 */

export const migration015 = `
ALTER TABLE character_profiles ADD COLUMN lifecycle_config TEXT NOT NULL DEFAULT '{}';
ALTER TABLE entities ADD COLUMN lifecycle_config TEXT NOT NULL DEFAULT '{}'
`;