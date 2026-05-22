export const migration025 = `
-- Drop session_id column from conversation_messages
-- SQLite doesn't support DROP COLUMN directly, so we use rename-recreate pattern

-- Create new table without session_id but keeping interaction_id
CREATE TABLE conversation_messages_new (
  id TEXT PRIMARY KEY NOT NULL,
  entity_id TEXT NOT NULL,
  sender_entity_id TEXT NOT NULL,
  interaction_id TEXT,
  content TEXT NOT NULL,
  audio_duration REAL,
  message_type TEXT NOT NULL,
  audio_data TEXT,
  audio_mime_type TEXT,
  image_data TEXT,
  image_mime_type TEXT,
  vl_model TEXT,
  vl_model_interpretation TEXT,
  emotional_state_bits INTEGER NOT NULL DEFAULT 0,
  memory_id TEXT,
  is_recon_followup INTEGER NOT NULL DEFAULT 0,
  is_edited INTEGER NOT NULL DEFAULT 0,
  edit_of_message_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

-- Copy data from old table (exclude session_id)
INSERT INTO conversation_messages_new (
  id, entity_id, sender_entity_id, interaction_id, content,
  audio_duration, message_type, audio_data, audio_mime_type,
  image_data, image_mime_type, vl_model, vl_model_interpretation,
  emotional_state_bits, memory_id,
  is_recon_followup, is_edited, edit_of_message_id,
  created_at, updated_at, deleted_at
)
SELECT
  id, entity_id, sender_entity_id, interaction_id, content,
  audio_duration, message_type, audio_data, audio_mime_type,
  image_data, image_mime_type, vl_model, vl_model_interpretation,
  emotional_state_bits, memory_id,
  is_recon_followup, is_edited, edit_of_message_id,
  created_at, updated_at, deleted_at
FROM conversation_messages;

-- Drop old table
DROP TABLE conversation_messages;

-- Rename new table
ALTER TABLE conversation_messages_new RENAME TO conversation_messages;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_conversation_messages_interaction_id ON conversation_messages(interaction_id);
`;
