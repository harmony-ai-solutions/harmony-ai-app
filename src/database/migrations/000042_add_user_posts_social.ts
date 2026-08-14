/**
 * Migration 000042: User posts, follows & notifications (client-only)
 *
 * Adds client-only support for a local social layer:
 *
 *   user_posts              — text/image posts published by the local user
 *   user_post_likes         — the local user liked a post
 *   user_post_comments      — comments left on a post
 *   follows                 — the local user follows a cloud user (creator)
 *   notifications           — local notification feed (who followed me, liked
 *                             my AI profile / image / post, commented on my
 *                             posts / images)
 *
 * These tables follow the same client-only sidecar pattern as the character
 * social layer (migration 041): they are never selected by the sync layer, so
 * the engine schema stays untouched, and they are excluded from the schema
 * dump in scripts/dump-schema.ts (CLIENT_ONLY_TABLES).
 *
 * Cascades:
 *  - Deleting a post cleans up its likes + comments (ON DELETE CASCADE via FK).
 */
export const migration042 = `
-- User posts (client-only) — text and/or image content
CREATE TABLE IF NOT EXISTS user_posts (
    id TEXT PRIMARY KEY,
    author_user_id TEXT,
    author_display_name TEXT NOT NULL DEFAULT '',
    author_avatar_url TEXT,
    text TEXT NOT NULL DEFAULT '',
    image_data TEXT,
    image_mime_type TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User post likes (client-only, single device/user)
CREATE TABLE IF NOT EXISTS user_post_likes (
    post_id TEXT PRIMARY KEY REFERENCES user_posts(id) ON DELETE CASCADE,
    liked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User post comments (client-only)
CREATE TABLE IF NOT EXISTS user_post_comments (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL REFERENCES user_posts(id) ON DELETE CASCADE,
    author_user_id TEXT,
    author_display_name TEXT NOT NULL DEFAULT '',
    author_avatar_url TEXT,
    text TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_user_post_comments_post ON user_post_comments(post_id);

-- Follows (client-only) — the local user follows a cloud user (e.g. an AI creator)
CREATE TABLE IF NOT EXISTS follows (
    target_user_id TEXT PRIMARY KEY,
    target_display_name TEXT NOT NULL DEFAULT '',
    target_avatar_url TEXT,
    followed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Notifications (client-only) — local feed of social activity addressed to a user
CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    recipient_user_id TEXT NOT NULL DEFAULT '',
    actor_user_id TEXT,
    actor_display_name TEXT NOT NULL DEFAULT '',
    actor_avatar_url TEXT,
    type TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT '',
    target_id TEXT,
    target_label TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_read INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_user_id);
`;
