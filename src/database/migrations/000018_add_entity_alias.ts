/**
 * Migration 000018: Add Entity Alias Field
 *
 * Adds a human-readable `alias` column to the `entities` table.
 * The alias is required (NOT NULL), unique among non-deleted entities,
 * and defaults to empty string (set by app logic to character profile name on creation).
 */

export const migration018 = `
  ALTER TABLE entities ADD COLUMN alias TEXT NOT NULL;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_alias_unique
    ON entities (alias)
    WHERE alias IS NOT NULL AND alias != '' AND deleted_at IS NULL;
`;
