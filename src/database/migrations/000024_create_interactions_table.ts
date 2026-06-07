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
  metadata TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Per D-07: composite index for scope-aware lookup (REQ-8.1.1)
CREATE INDEX idx_interactions_lookup ON interactions(entity_id, interaction_scope, participant_key);

-- Index for finding active interactions by entity (status + recency)
CREATE INDEX idx_interactions_active ON interactions(entity_id, status, last_activity_at DESC);

-- Per D-08: add interaction_id to conversation_messages (nullable for now — populated via sync)
ALTER TABLE conversation_messages ADD COLUMN interaction_id TEXT;

-- Per D-08: index on interaction_id for Phase 2 query patterns
CREATE INDEX idx_conversation_messages_interaction_id ON conversation_messages(interaction_id);
`;
