/**
 * Migration 000012: Add Imagination Module Support
 *
 * This migration adds:
 * 1. provider_config_comfyui table for ComfyUI provider configuration
 *    - workflow_profiles stores a JSON blob (map of workflow profile names to configs)
 *    - Always accessed as a unit, so stored as a single TEXT column
 * 2. imagination_configs table for Imagination module configurations
 * 3. imagination_config_id column to entity_module_mappings (via table recreate)
 *
 * Note: SQLite does not support ADD CONSTRAINT via ALTER TABLE,
 * so entity_module_mappings is recreated with the new FK.
 */

export const migration012 = `
-- Create ComfyUI provider config table
CREATE TABLE IF NOT EXISTS provider_config_comfyui (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key TEXT NOT NULL DEFAULT '',
    workflow_profiles TEXT NOT NULL DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);

-- Create imagination_configs module config table
CREATE TABLE IF NOT EXISTS imagination_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_config_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);

-- Recreate entity_module_mappings with FK for imagination_config_id
CREATE TABLE IF NOT EXISTS entity_module_mappings_new (
    entity_id TEXT PRIMARY KEY,
    backend_config_id INTEGER,
    cognition_config_id INTEGER,
    imagination_config_id INTEGER,
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
    FOREIGN KEY (imagination_config_id) REFERENCES imagination_configs(id) ON DELETE SET NULL,
    FOREIGN KEY (movement_config_id) REFERENCES movement_configs(id) ON DELETE SET NULL,
    FOREIGN KEY (rag_config_id) REFERENCES rag_configs(id) ON DELETE SET NULL,
    FOREIGN KEY (stt_config_id) REFERENCES stt_configs(id) ON DELETE SET NULL,
    FOREIGN KEY (tts_config_id) REFERENCES tts_configs(id) ON DELETE SET NULL,
    FOREIGN KEY (vision_config_id) REFERENCES vision_configs(id) ON DELETE SET NULL
);

-- Copy data from old table (imagination_config_id defaults to NULL)
INSERT INTO entity_module_mappings_new (
    entity_id,
    backend_config_id,
    cognition_config_id,
    movement_config_id,
    rag_config_id,
    stt_config_id,
    tts_config_id,
    vision_config_id,
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
    vision_config_id,
    created_at,
    updated_at,
    deleted_at
FROM entity_module_mappings;

-- Drop old table and rename new one
DROP TABLE entity_module_mappings;
ALTER TABLE entity_module_mappings_new RENAME TO entity_module_mappings;
`;