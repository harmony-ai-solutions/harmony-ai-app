/**
 * Migration 000039: Character categories + favorites (client-only)
 *
 * Adds client-only support for organizing AI characters into user-defined
 * categories and marking favorites:
 *
 *   character_categories        — user-defined category names (id, name, order)
 *   character_category_members  — many-to-many: profile_id → category_id
 *   character_favorites         — favorited character profiles (profile_id PK)
 *
 * These tables are deliberately NOT columns on `character_profiles`:
 *  - `getChangedRecords` reads character_profiles with `SELECT *` and syncs
 *    every column to the engine, which enforces strict schema parity (see
 *    docs/schema-parity.md). Any new column would break the parity gate.
 *  - Sidecar tables are never selected by the sync layer, so the engine schema
 *    stays untouched (same pattern as character_profile_sources / personas).
 *  - Excluded from the schema dump in scripts/dump-schema.ts
 *    (CLIENT_ONLY_TABLES).
 *
 * Cascades:
 *  - Deleting a category deletes its member rows (category owns membership).
 *  - Deleting a character profile cleans up its favorites + category members
 *    (profile_id FOREIGN KEY ON DELETE CASCADE — the app's deleteCharacterProfile
 *    uses soft-delete, so rows are kept; a permanent delete removes them).
 */
export const migration039 = `
-- User-defined character categories (client-only)
CREATE TABLE IF NOT EXISTS character_categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Many-to-many: which profiles belong to which categories
CREATE TABLE IF NOT EXISTS character_category_members (
    profile_id TEXT NOT NULL REFERENCES character_profiles(id) ON DELETE CASCADE,
    category_id TEXT NOT NULL REFERENCES character_categories(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (profile_id, category_id)
);

-- Favorited character profiles (client-only)
CREATE TABLE IF NOT EXISTS character_favorites (
    profile_id TEXT PRIMARY KEY REFERENCES character_profiles(id) ON DELETE CASCADE,
    favorited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;
