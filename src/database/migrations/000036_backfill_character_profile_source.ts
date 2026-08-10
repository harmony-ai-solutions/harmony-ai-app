/**
 * Migration 000036: Backfill character profile sources (client-only)
 *
 * Tags every character profile that already exists as 'user'. The Discover
 * (community browse) feature did not exist before, so all characters in an
 * existing install are effectively "the user's own" — they must NOT appear in
 * the Discover community grid. Only NEW characters arriving via import or
 * sync (which have no sidecar row) are treated as 'community' and shown.
 *
 * Uses INSERT OR IGNORE so it is safe to re-run (e.g. when an install already
 * applied migration 000035 from an earlier build that did not backfill).
 */
export const migration036 = `
-- Backfill: tag all pre-existing profiles as 'user' so the Discover
-- community grid only shows characters imported/synced AFTER this feature.
INSERT OR IGNORE INTO character_profile_sources (profile_id, source)
SELECT id, 'user' FROM character_profiles;
`;
