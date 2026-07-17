export const migration007 = `
-- 1. Add image support
ALTER TABLE chat_messages ADD COLUMN image_data TEXT;
ALTER TABLE chat_messages ADD COLUMN image_mime_type TEXT;
ALTER TABLE chat_messages ADD COLUMN vl_model TEXT;
ALTER TABLE chat_messages ADD COLUMN vl_model_interpretation TEXT;
ALTER TABLE chat_messages ADD COLUMN vl_model_embedding TEXT;

-- 2. AUDIO: Add audio_data + audio_mime_type columns
-- Note: audio_file column from initial schema is left in place (dead column).
-- DROP COLUMN requires SQLite 3.35.0+ which many Android devices lack.
ALTER TABLE chat_messages ADD COLUMN audio_data TEXT;
ALTER TABLE chat_messages ADD COLUMN audio_mime_type TEXT;

-- 3. Indexes
CREATE INDEX idx_chat_messages_conversation ON chat_messages(entity_id, sender_entity_id, created_at);
CREATE INDEX idx_chat_messages_id ON chat_messages(id);
`;
