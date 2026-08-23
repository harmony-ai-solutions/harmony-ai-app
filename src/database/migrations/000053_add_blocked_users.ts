/**
 * Migration 000053: Blocked users (client-only)
 *
 * Lets the local user block other cloud users. A blocked user's AI characters
 * (creator records), posts and profile are hidden app-wide until unblocked.
 *
 *   blocked_users — which cloud users the local user has blocked
 *
 * This table is CLIENT-ONLY (never synced to the engine — strict schema
 * parity, see docs/schema-parity.md), mirroring the follows / notifications
 * sidecar pattern. It has no FK REFERENCES pointing at synced tables, and
 * never appears in scripts/dump-schema.ts (CLIENT_ONLY_TABLES).
 */
export const migration053 = `
-- Blocked users (client-only, single device/user)
CREATE TABLE IF NOT EXISTS blocked_users (
    blocked_user_id TEXT PRIMARY KEY,
    blocked_display_name TEXT NOT NULL DEFAULT '',
    blocked_avatar_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;