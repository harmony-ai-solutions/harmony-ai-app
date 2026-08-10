/**
 * Migration 000035: Character profile source tagging (client-only)
 *
 * Adds a CLIENT-ONLY sidecar table that records whether a character profile
 * was created by the app user (via the Create AI / profile-edit flows) or is a
 * community/default character (imported character cards or synced from the
 * engine).
 *
 * This is deliberately NOT a column on `character_profiles`:
 *  - `getChangedRecords` reads character_profiles with `SELECT *` and syncs
 *    every column to the engine, which enforces strict schema parity (see
 *    docs/schema-parity.md). A new column would break the parity gate.
 *  - A sidecar table is never selected by the sync layer, so the engine schema
 *    stays untouched.
 *
 * Default: any profile without a sidecar row is treated as 'community'.
 * (Migration 000036 backfills pre-existing profiles as 'user'.)
 */
export const migration035 = `
-- Character profile source tagging (client-only sidecar)
CREATE TABLE IF NOT EXISTS character_profile_sources (
    profile_id TEXT PRIMARY KEY,
    source TEXT NOT NULL DEFAULT 'community'
        CHECK (source IN ('user', 'community')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;
