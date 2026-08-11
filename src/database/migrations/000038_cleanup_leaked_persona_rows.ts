/**
 * Migration 000038: Purge leaked AI-character rows from the personas table
 *
 * A development build of migration 000037 backfilled existing user-created AI
 * characters (entities linked to a user-tagged character profile) into the
 * `personas` table. Personas are STRICTLY identities the user chats AS and
 * must NEVER include AI characters (the entities the user chats WITH).
 *
 * This migration removes any persona row whose backing entity still links a
 * character profile — those rows are AI characters, not personas. Genuine
 * personas (created via createPersona) always have a backing entity with
 * character_profile_id IS NULL, so they are untouched.
 *
 * Client-only table — no engine schema parity impact.
 */
export const migration038 = `
-- Remove persona rows whose backing entity links a character profile
-- (i.e. AI characters leaked into personas). Real personas have a backing
-- entity with character_profile_id IS NULL.
DELETE FROM personas
WHERE id IN (
    SELECT p.id
    FROM personas p
    INNER JOIN entities e ON e.id = p.id
    WHERE e.character_profile_id IS NOT NULL
);
`;
