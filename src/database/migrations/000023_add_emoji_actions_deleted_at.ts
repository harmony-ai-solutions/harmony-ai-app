export const migration023 = `
-- Add missing deleted_at column to entity_emoji_actions for soft-delete sync support
ALTER TABLE entity_emoji_actions ADD COLUMN deleted_at TEXT DEFAULT NULL;
`;
