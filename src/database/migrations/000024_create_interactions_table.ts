export const migration024 = `
-- Create interactions table (mirrors server interactions table)
CREATE TABLE IF NOT EXISTS interactions (
  id TEXT PRIMARY KEY NOT NULL,
  entity_id TEXT NOT NULL,
  interaction_scope TEXT NOT NULL,
  participant_key TEXT,
  participant_ids TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  started_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  ended_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

-- Indexes for interaction lookups
CREATE INDEX IF NOT EXISTS idx_interactions_entity_scope_key ON interactions(entity_id, interaction_scope, participant_key);
CREATE INDEX IF NOT EXISTS idx_interactions_entity_id ON interactions(entity_id);
CREATE INDEX IF NOT EXISTS idx_interactions_status ON interactions(status);

-- Add interaction_id column to conversation_messages (nullable for now — populated via sync)
ALTER TABLE conversation_messages ADD COLUMN interaction_id TEXT;

-- Index for JOIN performance
CREATE INDEX IF NOT EXISTS idx_conversation_messages_interaction_id ON conversation_messages(interaction_id);
`;
