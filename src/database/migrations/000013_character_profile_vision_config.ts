/**
 * Migration 000013: Character Profile Vision Config
 *
 * This migration:
 * 1. Adds vision_config_id to character_profiles - allows per-character preferred VL model
 * 2. Drops vl_model_embedding from character_image - embeddings are managed by chromem-go RAG engine
 * 3. Drops vl_model_embedding from conversation_messages - same reason
 *
 * Note: SQLite does not support DROP COLUMN before 3.35.0.
 * Table recreate pattern is used for all column removals for compatibility.
 */

export const migration013 = `
-- Add vision_config_id to character_profiles
ALTER TABLE character_profiles ADD COLUMN vision_config_id INTEGER REFERENCES vision_configs(id) ON DELETE SET NULL;

-- Drop vl_model_embedding from character_image via table recreate
CREATE TABLE character_image_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_profile_id TEXT NOT NULL,
    image_data BLOB NOT NULL,
    mime_type TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    is_primary BOOLEAN NOT NULL DEFAULT 0,
    display_order INTEGER NOT NULL DEFAULT 0,
    vl_model_interpretation TEXT NOT NULL DEFAULT '',
    vl_model TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME,
    FOREIGN KEY (character_profile_id) REFERENCES character_profiles(id) ON DELETE CASCADE
);

INSERT INTO character_image_new (id, character_profile_id, image_data, mime_type, description, is_primary, display_order, vl_model_interpretation, vl_model, created_at, updated_at, deleted_at)
SELECT id, character_profile_id, image_data, mime_type, description, is_primary, display_order, vl_model_interpretation, vl_model, created_at, updated_at, deleted_at
FROM character_image;

DROP TABLE character_image;
ALTER TABLE character_image_new RENAME TO character_image;

CREATE INDEX IF NOT EXISTS idx_character_image_profile ON character_image(character_profile_id);
CREATE INDEX IF NOT EXISTS idx_character_image_primary ON character_image(character_profile_id, is_primary);

-- Drop vl_model_embedding from conversation_messages via table recreate
CREATE TABLE conversation_messages_new (
    id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL,
    sender_entity_id TEXT NOT NULL,
    session_id TEXT,
    content TEXT NOT NULL DEFAULT '',
    audio_duration REAL,
    message_type TEXT NOT NULL DEFAULT 'text',
    audio_data BLOB,
    audio_mime_type TEXT,
    image_data BLOB,
    image_mime_type TEXT,
    vl_model TEXT,
    vl_model_interpretation TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME,
    FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
);

INSERT INTO conversation_messages_new (id, entity_id, sender_entity_id, session_id, content, audio_duration, message_type, audio_data, audio_mime_type, image_data, image_mime_type, vl_model, vl_model_interpretation, created_at, updated_at, deleted_at)
SELECT id, entity_id, sender_entity_id, session_id, content, audio_duration, message_type, audio_data, audio_mime_type, image_data, image_mime_type, vl_model, vl_model_interpretation, created_at, updated_at, deleted_at
FROM conversation_messages;

DROP TABLE conversation_messages;
ALTER TABLE conversation_messages_new RENAME TO conversation_messages;

CREATE INDEX IF NOT EXISTS idx_conversation_messages_entity ON conversation_messages(entity_id);
`;