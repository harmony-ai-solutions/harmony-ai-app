/**
 * Migration 000017: Add deleted_at to memories table
 *
 * Mirrors Harmony Link migration 000017_add_memories_deleted_at.up.sql.
 * Adds soft-delete support to memories so compacted source memories can be
 * marked as superseded after level promotion.
 */

export const migration017 = `
ALTER TABLE memories ADD COLUMN deleted_at TIMESTAMP NULL;
CREATE INDEX IF NOT EXISTS idx_memories_deleted_at ON memories(entity_id, deleted_at)
`;