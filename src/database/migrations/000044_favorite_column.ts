/**
 * Migration 000044: is_favorite column on character_profiles (paired with engine 000044)
 *
 * DESIGN RULING (user decision 2026-09-01): character favorites move from the
 * `character_favorites` sidecar table to an `is_favorite` column on
 * `character_profiles`. The row-LWW coupling trade-off is ACCEPTED by the user:
 * a favorite toggle now bumps the profile row's `updated_at` and rides the
 * full-row profile sync, so a concurrent profile edit on another device can
 * lose LWW against a favorite toggle. The coupling is acceptable because
 * favorites/profile edits rarely happen on different devices before a sync.
 *
 * Identical ALTER (both repos): `ALTER TABLE character_profiles ADD COLUMN
 * is_favorite INTEGER NOT NULL DEFAULT 0;` — SQLite inserts ALTER-added columns
 * after the last column, before table constraints. The original character_profiles
 * DDL is byte-identical in both repos (already in parity), so the identical
 * ALTER yields an identical stored DDL on both sides.
 *
 * In-place data carry (run BEFORE dropping the sidecar so dev devices on the
 * current branch state keep their favorites, no new wipe):
 *   UPDATE character_profiles SET is_favorite = 1
 *   WHERE id IN (SELECT profile_id FROM character_favorites WHERE deleted_at IS NULL);
 * then `DROP TABLE IF EXISTS character_favorites;`.
 *
 * The sidecar drop is `DROP TABLE IF EXISTS` so an already-wiped DB applies
 * cleanly (same convention as 000043).
 */
export const migration044 = `
ALTER TABLE character_profiles ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;

UPDATE character_profiles SET is_favorite = 1
WHERE id IN (SELECT profile_id FROM character_favorites WHERE deleted_at IS NULL);

DROP TABLE IF EXISTS character_favorites;
`;
