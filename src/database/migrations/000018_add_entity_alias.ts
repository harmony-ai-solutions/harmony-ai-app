/**
 * Migration 000018: Add Entity Alias Field
 *
 * Adds a human-readable `alias` column to the `entities` table.
 * The alias is optional (nullable), unique among non-deleted entities,
 * and defaults to the linked character profile name on creation (set in UI logic).
 */

export const migration018 = `
  ALTER TABLE entities ADD COLUMN alias TEXT NOT NULL;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_alias_unique
    ON entities (alias)
    WHERE alias IS NOT NULL AND deleted_at IS NULL;
`;
