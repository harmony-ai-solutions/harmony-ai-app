export const migration034 = `
-- Migration 000034: Add UNIQUE constraint on vision_configs.name and imagination_configs.name
-- Mirrors the module-config table family (backend/cognition/movement/rag/stt/tts
-- configs), which all enforce name TEXT NOT NULL UNIQUE. The sync engine's
-- name-clash resolution requires every module config table with a DB-level
-- UNIQUE name to be in its clash-detection lists, so the two remaining module
-- config tables must match.
--
-- Uses the _new-table rebuild pattern because SQLite cannot ALTER a column in
-- place to add a UNIQUE constraint.
--
-- vision_configs is referenced by character_profiles.vision_config_id (FK
-- ON DELETE SET NULL) and by entity_module_mappings.vision_config_id. A plain
-- DROP TABLE with PRAGMA foreign_keys = ON would fire the implicit DELETE and
-- NULL out those references on devices. So foreign keys are disabled around
-- the rebuild and re-enabled afterwards. The migration runner executes each
-- statement outside an enclosing transaction, so the pragma takes effect.

PRAGMA foreign_keys = OFF;

-- ------------------------------------------------------------------
-- 1.  vision_configs
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vision_configs_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL,
    provider_config_id TEXT NOT NULL,
    resolution_width INTEGER DEFAULT 640,
    resolution_height INTEGER DEFAULT 480,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);

INSERT INTO vision_configs_new (id, name, provider, provider_config_id, resolution_width, resolution_height, created_at, updated_at, deleted_at)
SELECT id, name, provider, provider_config_id, resolution_width, resolution_height, created_at, updated_at, deleted_at
FROM vision_configs;

DROP TABLE vision_configs;
ALTER TABLE vision_configs_new RENAME TO vision_configs;

-- ------------------------------------------------------------------
-- 2.  imagination_configs
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS imagination_configs_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL,
    provider_config_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);

INSERT INTO imagination_configs_new (id, name, provider, provider_config_id, created_at, updated_at, deleted_at)
SELECT id, name, provider, provider_config_id, created_at, updated_at, deleted_at
FROM imagination_configs;

DROP TABLE imagination_configs;
ALTER TABLE imagination_configs_new RENAME TO imagination_configs;

PRAGMA foreign_keys = ON;
`;
