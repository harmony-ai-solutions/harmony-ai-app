export const migration022 = `
-- Per-entity emoji action mappings
CREATE TABLE IF NOT EXISTS entity_emoji_actions (
  id TEXT PRIMARY KEY NOT NULL,
  entity_id TEXT NOT NULL,
  emoji_native TEXT NOT NULL,
  emotion_effect TEXT,
  metabolism_vector TEXT,
  substitution_text TEXT,
  auto_generated INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  UNIQUE(entity_id, emoji_native)
);

CREATE INDEX idx_emoji_actions_entity_id ON entity_emoji_actions(entity_id);
`;