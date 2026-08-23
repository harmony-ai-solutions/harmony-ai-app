/**
 * Migration 000047: AI character social layer (client-only)
 *
 * Adds client-only support for interacting with AI characters beyond chat:
 *
 *   character_likes              — the local user "liked" this AI character
 *                                  (profile_id PK, mirrors character_favorites)
 *   character_saves              — the local user saved this AI character to
 *                                  find it later in My Profile > Saved
 *   character_image_likes        — the local user liked one of the character's
 *                                  gallery images (post-level like)
 *   character_image_comments     — comments left on a character image post
 *   character_creators           — which cloud user created this AI character
 *                                  (drives the creator badge + creator-only
 *                                  Edit Profile / Edit AI Settings buttons)
 *
 * These tables are deliberately NOT columns on `character_profiles` / the
 * engine schema:
 *  - `getChangedRecords` reads synced tables with `SELECT *` and pushes every
 *    column to the engine, which enforces strict schema parity (see
 *    docs/schema-parity.md). Any new column would break the parity gate.
 *  - Sidecar tables are never selected by the sync layer, so the engine
 *    schema stays untouched (same pattern as character_profile_sources,
 *    character_favorites and personas).
 *  - Excluded from the schema dump in scripts/dump-schema.ts
 *    (CLIENT_ONLY_TABLES).
 *
 * Cascades:
 *  - Deleting a character profile cleans up its likes/saves/creator rows.
 *  - Deleting a character image cleans up its likes + comments
 *    (ON DELETE CASCADE via FK).
 */
export const migration047 = `
-- AI character likes (client-only, single device/user)
CREATE TABLE IF NOT EXISTS character_likes (
    profile_id TEXT PRIMARY KEY REFERENCES character_profiles(id) ON DELETE CASCADE,
    liked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Saved AI characters (client-only)
CREATE TABLE IF NOT EXISTS character_saves (
    profile_id TEXT PRIMARY KEY REFERENCES character_profiles(id) ON DELETE CASCADE,
    saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- AI character image likes (client-only)
CREATE TABLE IF NOT EXISTS character_image_likes (
    image_id INTEGER PRIMARY KEY REFERENCES character_image(id) ON DELETE CASCADE,
    liked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- AI character image comments (client-only)
CREATE TABLE IF NOT EXISTS character_image_comments (
    id TEXT PRIMARY KEY,
    image_id INTEGER NOT NULL REFERENCES character_image(id) ON DELETE CASCADE,
    author_user_id TEXT,
    author_display_name TEXT NOT NULL DEFAULT '',
    author_avatar_url TEXT,
    text TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_character_image_comments_image ON character_image_comments(image_id);

-- AI character creator (client-only) — which cloud user created this AI
CREATE TABLE IF NOT EXISTS character_creators (
    profile_id TEXT PRIMARY KEY REFERENCES character_profiles(id) ON DELETE CASCADE,
    creator_user_id TEXT NOT NULL DEFAULT '',
    creator_display_name TEXT NOT NULL DEFAULT '',
    creator_avatar_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;
