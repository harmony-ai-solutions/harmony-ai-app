export const migration046 = `
-- Message actions for conversation_messages:
-- 1. reactions_json: JSON array of emoji reactions, e.g. '["❤️","👍"]'
-- 2. reply_to_message_id: references the message this one replies to
-- 3. is_pinned: 0/1 flag for pinned messages
ALTER TABLE conversation_messages ADD COLUMN reactions_json TEXT;
ALTER TABLE conversation_messages ADD COLUMN reply_to_message_id TEXT;
ALTER TABLE conversation_messages ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_conversation_messages_reply_to ON conversation_messages(reply_to_message_id);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_pinned ON conversation_messages(is_pinned);
`;
