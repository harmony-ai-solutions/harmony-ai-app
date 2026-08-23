/**
 * Migration 000049: Character profile visibility (client-only)
 *
 * Adds a `visibility` column to the CLIENT-ONLY sidecar table
 * `character_profile_sources`, recording whether a character profile is
 * **public** (visible + searchable on the Discover screen) or **private**
 * (hidden from Discover and search on this device).
 *
 * This is deliberately NOT a column on `character_profiles`:
 *  - `getChangedRecords` reads character_profiles with `SELECT *` and syncs
 *    every column to the engine, which enforces strict schema parity (see
 *    docs/schema-parity.md). A new column would break the parity gate.
 *  - The sidecar table is never selected by the sync layer, so the engine
 *    schema stays untouched (same pattern as `character_profile_sources`
 *    itself, `character_favorites`, `personas`, etc.).
 *
 * `ALTER TABLE ADD COLUMN` (not DROP/RENAME) is safe on older Android SQLite
 * and passes the migration SQL guard. `NOT NULL DEFAULT 'public'` keeps
 * existing rows public — a profile with no explicit visibility is public.
 */
export const migration049 = `
ALTER TABLE character_profile_sources
ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'private'));
`;
