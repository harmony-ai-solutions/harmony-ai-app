/**
 * Migration 000003: Add Character Card Fields
 */

export const migration003 = `
-- Migration to add character card fields to character_profiles table and create character_image table

-- Add new fields to character_profiles table
ALTER TABLE character_profiles ADD COLUMN base_prompt TEXT DEFAULT '';
ALTER TABLE character_profiles ADD COLUMN scenario TEXT DEFAULT '';
ALTER TABLE character_profiles ADD COLUMN example_dialogues TEXT DEFAULT '';

-- Create character images table
CREATE TABLE character_image (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_profile_id TEXT NOT NULL,
    image_data BLOB NOT NULL,
    mime_type TEXT NOT NULL,
    description TEXT DEFAULT '',
    is_primary BOOLEAN DEFAULT 0,
    display_order INTEGER DEFAULT 0,
    vl_model_interpretation TEXT DEFAULT '',
    vl_model TEXT DEFAULT '',
    vl_model_embedding BLOB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (character_profile_id) REFERENCES character_profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_character_image_profile ON character_image(character_profile_id);
CREATE INDEX idx_character_image_primary ON character_image(character_profile_id, is_primary);
`;
