/**
 * Migration 000043: Personas table (client-only)
 *
 * Personas are the identities the USER chats AS (created via My Profile).
 * They are deliberately SEPARATE from AI characters (entities the user chats
 * WITH):
 *   - A persona row stores ONLY name / description / personality / avatar.
 *   - No character profile, no AI module configs, no provider bindings.
 *   - The persona id doubles as an Entity id (alias = name, NO character
 *     profile, NO module mapping) so chat INIT_ENTITY still works — the same
 *     way the built-in 'user' identity works today.
 *
 * Existing user-created AI characters (entities linked to a user-tagged
 * character profile, created via Create AI / character-card import / chat)
 * are intentionally NOT backfilled into this table — they stay AI characters
 * with their full AI configs and appear on the Characters screen. Only NEW
 * personas created via the My Profile personas tab are stored here.
 *
 * Client-only table: never synced to the engine (strict schema parity — see
 * docs/schema-parity.md). Excluded from the schema dump in
 * scripts/dump-schema.ts (CLIENT_ONLY_TABLES).
 */
export const migration043 = `
-- Personas: identities the user chats as (client-only)
CREATE TABLE IF NOT EXISTS personas (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    personality TEXT NOT NULL DEFAULT '',
    avatar_image_data TEXT,
    avatar_mime_type TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;
