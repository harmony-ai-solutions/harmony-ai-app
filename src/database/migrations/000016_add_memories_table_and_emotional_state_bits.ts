/**
 * Migration 000016: Add Memories Table and Emotional State Bits
 *
 * Mirrors Harmony Link migration 000016_add_memories_table_and_emotional_state_bits.up.sql.
 * Creates the memories table for hierarchical memory compaction.
 * Adds emotional_state_bits and memory_id columns to conversation_messages.
 */

export const migration016 = `
CREATE TABLE IF NOT EXISTS memories (
    id               TEXT PRIMARY KEY,
    entity_id        TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    compaction_level INTEGER NOT NULL DEFAULT 1,
    content          TEXT NOT NULL,
    emotional_state_bits INTEGER NOT NULL DEFAULT 0,
    start_date       TIMESTAMP NULL,
    end_date         TIMESTAMP NULL,
    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_memories_entity_id    ON memories(entity_id);
CREATE INDEX IF NOT EXISTS idx_memories_entity_level ON memories(entity_id, compaction_level);
CREATE INDEX IF NOT EXISTS idx_memories_end_date     ON memories(entity_id, end_date);

ALTER TABLE conversation_messages ADD COLUMN emotional_state_bits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversation_messages ADD COLUMN memory_id TEXT NULL REFERENCES memories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_conversation_messages_memory_id ON conversation_messages(memory_id)
`;