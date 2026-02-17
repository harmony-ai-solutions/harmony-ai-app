/**
 * Migration 000011: Add Vision Module Support
 * 
 * This migration adds:
 * 1. vision_configs table for Vision module configurations
 * 2. vision_config_id column to entity_module_mappings
 * 3. resolution_width and resolution_height columns for image processing dimensions
 * 
 * Note: Vision module reuses existing provider config tables:
 * - provider_config_openai
 * - provider_config_openrouter
 * - provider_config_openaicompatible
 */

export const migration011 = `
-- Create vision_configs table
CREATE TABLE IF NOT EXISTS vision_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL,
    provider_config_id INTEGER NOT NULL,
    resolution_width INTEGER DEFAULT 640,
    resolution_height INTEGER DEFAULT 480,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);

-- Recreate entity_module_mappings with FK for vision_config_id
-- SQLite doesn't support ADD CONSTRAINT via ALTER TABLE, so we recreate the table

-- Create new table with FK
CREATE TABLE IF NOT EXISTS entity_module_mappings_new (
    entity_id TEXT PRIMARY KEY,
    backend_config_id INTEGER,
    cognition_config_id INTEGER,
    movement_config_id INTEGER,
    rag_config_id INTEGER,
    stt_config_id INTEGER,
    tts_config_id INTEGER,
    vision_config_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME,
    FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
    FOREIGN KEY (backend_config_id) REFERENCES backend_configs(id) ON DELETE SET NULL,
    FOREIGN KEY (cognition_config_id) REFERENCES cognition_configs(id) ON DELETE SET NULL,
    FOREIGN KEY (movement_config_id) REFERENCES movement_configs(id) ON DELETE SET NULL,
    FOREIGN KEY (rag_config_id) REFERENCES rag_configs(id) ON DELETE SET NULL,
    FOREIGN KEY (stt_config_id) REFERENCES stt_configs(id) ON DELETE SET NULL,
    FOREIGN KEY (tts_config_id) REFERENCES tts_configs(id) ON DELETE SET NULL,
    FOREIGN KEY (vision_config_id) REFERENCES vision_configs(id) ON DELETE SET NULL
);

-- Copy data from old table (explicitly list columns to handle new vision_config_id column)
INSERT INTO entity_module_mappings_new (
    entity_id,
    backend_config_id,
    cognition_config_id,
    movement_config_id,
    rag_config_id,
    stt_config_id,
    tts_config_id,
    created_at,
    updated_at,
    deleted_at
)
SELECT 
    entity_id,
    backend_config_id,
    cognition_config_id,
    movement_config_id,
    rag_config_id,
    stt_config_id,
    tts_config_id,
    created_at,
    updated_at,
    deleted_at
FROM entity_module_mappings;

-- Drop old table and rename new one
DROP TABLE entity_module_mappings;
ALTER TABLE entity_module_mappings_new RENAME TO entity_module_mappings;
`;
