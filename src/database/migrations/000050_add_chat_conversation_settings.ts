/**
 * Migration 000050: Chat conversation settings (client-only)
 *
 * Adds client-only per-conversation state so the chat list can offer the
 * standard messaging-app actions (pin / archive / mute / disable / unread):
 *
 *   chat_conversation_settings — one row per conversation, keyed by the
 *   interaction participant_key (the stable identifier used across the app:
 *   `${entityA}+${entityB}` sorted, or the sorted participant set for groups):
 *     - entity_id       partner entity id (NULL for group chats) — lets the
 *       Disabled AIs screen resolve names/avatars without re-parsing the key
 *     - pinned          1 → conversation is pinned to the top of the chat list
 *     - archived        1 → conversation is hidden from the main list
 *     - muted           1 → incoming messages do not surface alerts
 *     - blocked         1 → the AI is disabled (can no longer send OR receive
 *                           messages). Physical column name kept for migration
 *                           safety; surfaced to the user as "disabled".
 *     - unread_count    incremented on incoming messages while the chat is
 *                       not open, reset to 0 when the chat is opened/read
 *
 * This is deliberately NOT a column on `interactions` (or any synced table):
 *  - `getChangedRecords` reads interactions with `SELECT *` and syncs every
 *    column to the engine, which enforces strict schema parity (see
 *    docs/schema-parity.md). A new column would break the parity gate.
 *  - Sidecar tables are never selected by the sync layer, so the engine
 *    schema stays untouched (same pattern as character_profile_sources,
 *    character_favorites, personas, etc.).
 *  - Excluded from the schema dump in scripts/dump-schema.ts
 *    (CLIENT_ONLY_TABLES).
 *
 * `CREATE TABLE IF NOT EXISTS` is idempotent and passes the migration SQL
 * guard (no ALTER DROP/RENAME).
 */
export const migration050 = `
-- Per-conversation settings (client-only)
CREATE TABLE IF NOT EXISTS chat_conversation_settings (
    participant_key TEXT PRIMARY KEY,
    entity_id TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    muted INTEGER NOT NULL DEFAULT 0,
    blocked INTEGER NOT NULL DEFAULT 0,
    unread_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;
