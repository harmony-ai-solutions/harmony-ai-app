export const migration035 = `
-- Migration 000035: Convert character_image primary key from INTEGER autoincrement to TEXT (UUID).
-- Mirrors 000031 config-table pattern. character_image.id has NO inbound FKs (nothing references it),
-- so unlike 031 no _idmap table is needed. Existing rows backfilled with UUIDv4 (SQL); new rows
-- get UUIDv7 from app code (uuid v7).

CREATE TABLE character_image_new (
    id TEXT PRIMARY KEY,
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

INSERT INTO character_image_new (
    id, character_profile_id, image_data, mime_type, description, is_primary, display_order,
    vl_model_interpretation, vl_model, created_at, updated_at, deleted_at
)
SELECT
    lower(hex(randomblob(4)) || '-' || substr(hex(randomblob(2)),2) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1,1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
    character_profile_id, image_data, mime_type, description, is_primary, display_order,
    vl_model_interpretation, vl_model, created_at, updated_at, deleted_at
FROM character_image;

DROP TABLE character_image;
ALTER TABLE character_image_new RENAME TO character_image;

CREATE INDEX IF NOT EXISTS idx_character_image_profile ON character_image(character_profile_id);
CREATE INDEX IF NOT EXISTS idx_character_image_primary ON character_image(character_profile_id, is_primary);
`;
