/**
 * Migration 000046: Extend visibility CHECK to include 'marketplace'
 *
 * Migration 000043 added `character_profile_sources.visibility` with a CHECK
 * constraint `visibility IN ('public', 'private')`. The Marketplace feature
 * adds a third visibility state, so a profile can be listed for sale on the
 * Market screen ('marketplace'). SQLite does not support `ALTER TABLE ...
 * DROP CONSTRAINT` or `ALTER TABLE ... RENAME COLUMN`, so the guard-mandated
 * `_new`-table rebuild pattern is used:
 *
 *   1. CREATE TABLE character_profile_sources_new (extended CHECK)
 *   2. INSERT ... SELECT ... FROM character_profile_sources
 *   3. DROP TABLE character_profile_sources
 *   4. ALTER TABLE character_profile_sources_new RENAME TO character_profile_sources
 *
 * The table is CLIENT-ONLY (never synced) and has no FK REFERENCES pointing
 * at it, so a plain DROP is safe (no foreign-key gate to worry about).
 */
export const migration046 = `
-- Rebuild character_profile_sources with the extended visibility CHECK
CREATE TABLE IF NOT EXISTS character_profile_sources_new (
    profile_id TEXT PRIMARY KEY,
    source TEXT NOT NULL DEFAULT 'community'
        CHECK (source IN ('user', 'community')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    visibility TEXT NOT NULL DEFAULT 'public'
        CHECK (visibility IN ('public', 'private', 'marketplace'))
);

INSERT INTO character_profile_sources_new (profile_id, source, created_at, visibility)
    SELECT profile_id, source, created_at, COALESCE(visibility, 'public')
    FROM character_profile_sources;

DROP TABLE character_profile_sources;

ALTER TABLE character_profile_sources_new RENAME TO character_profile_sources;
`;
