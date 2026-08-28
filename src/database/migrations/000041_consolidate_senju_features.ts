/**
 * Migration 000041: Consolidate senju pre-release feature sidecars
 *
 * This migration replaces migrations 000041–000055 (all pre-release, never
 * shipped) with a single consolidated migration that keeps ONLY the client
 * pieces that still have a consumer after the stub-service layer landed:
 *
 *   personas                   — identities the user chats AS (My Profile tab)
 *   character_favorites        — favorited character profiles
 *   chat_conversation_settings — per-conversation pin/archive/mute/block/unread
 *   conversation_messages      — reactions_json + reply_to_message_id +
 *                                is_pinned (message actions; the reply column
 *                                is KEPT DORMANT — the user-facing reply UI is
 *                                gated off, plumbing restored for later enable)
 *
 * Dropped SQL (NOT carried over, per the approved consolidation amendment):
 *   character_profile_sources + backfill + visibility rebuilds (000041/42/49/52
 *     — A3: the stub layer replaces source/visibility persistence)
 *   persona-row cleanup DELETE (000044 — moot per B3)
 *   character_categories + character_category_members (000045 — O6: categories
 *     now live in AsyncStorage @harmony_character_categories + profile tags)
 *   character-social tables (000047), user-social + notifications (000048),
 *   marketplace + wallet tables (000051), blocked_users (000053),
 *   signup-bonus ALTER (000054), marketplace cache tables (000055)
 *
 * Note: 000039 remains the reserved-number placeholder for the engine-only
 * device_push_tokens migration (no-op app-side), so the 1:1 number mirror
 * between app and engine survives.
 *
 * DEV-DEVICE WIPE NOTE: this migration was amended in place (reply column
 * restored), and an already-applied migration never re-runs. Devices that
 * already ran the previous 000041 revision (or the old 41–55 migrations) keep
 * orphaned tables and MISS the reply_to_message_id column until wiped. A
 * one-time dev DB wipe (Dev DB viewer wipe or reinstall) is REQUIRED on those
 * devices to get the column back. Only dev installs ever executed these
 * migrations; fresh installs are unaffected.
 *
 * The surviving pieces (personas / character_favorites /
 * chat_conversation_settings) are the last client-only tables pending the
 * Phase-2 engine mirrors (B2/B3) that sync or replace them.
 */
export const migration041 = `
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

-- Favorited character profiles (client-only)
CREATE TABLE IF NOT EXISTS character_favorites (
    profile_id TEXT PRIMARY KEY REFERENCES character_profiles(id) ON DELETE CASCADE,
    favorited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Message actions for conversation_messages:
-- 1. reactions_json: JSON array of emoji reactions, e.g. '["❤️","👍"]'
-- 2. reply_to_message_id: references the message this one replies to (dormant — UI gated off)
-- 3. is_pinned: 0/1 flag for pinned messages
ALTER TABLE conversation_messages ADD COLUMN reactions_json TEXT;
ALTER TABLE conversation_messages ADD COLUMN reply_to_message_id TEXT;
ALTER TABLE conversation_messages ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_conversation_messages_reply_to ON conversation_messages(reply_to_message_id);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_pinned ON conversation_messages(is_pinned);

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