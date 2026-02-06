/**
 * Migration 000008: Remove UNIQUE constraint from provider config table names
 * 
 * Provider configs are shared across module types (backend, cognition, movement), 
 * so names don't need to be unique across the provider tables.
 * Module config tables (backend_configs, cognition_configs, etc.) already enforce name uniqueness.
 * 
 * This fixes the issue where creating configs with the same name but different modules
 * (e.g., Backend and Cognition both using the same provider) would fail.
 */
export const migration008 = `
-- provider_config_openai
CREATE TABLE provider_config_openai_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    api_key TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    max_tokens INTEGER NOT NULL DEFAULT 0,
    temperature REAL NOT NULL DEFAULT 0,
    top_p REAL NOT NULL DEFAULT 0,
    n INTEGER NOT NULL DEFAULT 0,
    stop_tokens TEXT NOT NULL DEFAULT '',
    embedding_model TEXT NOT NULL DEFAULT '',
    voice TEXT NOT NULL DEFAULT '',
    speed REAL NOT NULL DEFAULT 0,
    format TEXT NOT NULL DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);
INSERT INTO provider_config_openai_new SELECT * FROM provider_config_openai;
DROP TABLE provider_config_openai;
ALTER TABLE provider_config_openai_new RENAME TO provider_config_openai;

-- provider_config_openrouter
CREATE TABLE provider_config_openrouter_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    api_key TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    max_tokens INTEGER NOT NULL DEFAULT 0,
    temperature REAL NOT NULL DEFAULT 0,
    top_p REAL NOT NULL DEFAULT 0,
    n INTEGER NOT NULL DEFAULT 0,
    stop_tokens TEXT NOT NULL DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);
INSERT INTO provider_config_openrouter_new SELECT * FROM provider_config_openrouter;
DROP TABLE provider_config_openrouter;
ALTER TABLE provider_config_openrouter_new RENAME TO provider_config_openrouter;

-- provider_config_openaicompatible
CREATE TABLE provider_config_openaicompatible_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    max_tokens INTEGER NOT NULL DEFAULT 0,
    temperature REAL NOT NULL DEFAULT 0,
    top_p REAL NOT NULL DEFAULT 0,
    n INTEGER NOT NULL DEFAULT 0,
    stop_tokens TEXT NOT NULL DEFAULT '',
    embedding_model TEXT NOT NULL DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);
INSERT INTO provider_config_openaicompatible_new SELECT * FROM provider_config_openaicompatible;
DROP TABLE provider_config_openaicompatible;
ALTER TABLE provider_config_openaicompatible_new RENAME TO provider_config_openaicompatible;

-- provider_config_harmonyspeech
CREATE TABLE provider_config_harmonyspeech_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    voice_config_file TEXT NOT NULL DEFAULT '',
    format TEXT NOT NULL DEFAULT '',
    sample_rate INTEGER NOT NULL DEFAULT 0,
    stream INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);
INSERT INTO provider_config_harmonyspeech_new SELECT * FROM provider_config_harmonyspeech;
DROP TABLE provider_config_harmonyspeech;
ALTER TABLE provider_config_harmonyspeech_new RENAME TO provider_config_harmonyspeech;

-- provider_config_elevenlabs
CREATE TABLE provider_config_elevenlabs_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    api_key TEXT NOT NULL,
    voice_id TEXT NOT NULL DEFAULT '',
    model_id TEXT NOT NULL DEFAULT '',
    stability REAL NOT NULL DEFAULT 0,
    similarity_boost REAL NOT NULL DEFAULT 0,
    style REAL NOT NULL DEFAULT 0,
    speaker_boost INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);
INSERT INTO provider_config_elevenlabs_new SELECT * FROM provider_config_elevenlabs;
DROP TABLE provider_config_elevenlabs;
ALTER TABLE provider_config_elevenlabs_new RENAME TO provider_config_elevenlabs;

-- provider_config_kindroid
CREATE TABLE provider_config_kindroid_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    api_key TEXT NOT NULL,
    kindroid_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);
INSERT INTO provider_config_kindroid_new SELECT * FROM provider_config_kindroid;
DROP TABLE provider_config_kindroid;
ALTER TABLE provider_config_kindroid_new RENAME TO provider_config_kindroid;

-- provider_config_kajiwoto
CREATE TABLE provider_config_kajiwoto_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    room_url TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);
INSERT INTO provider_config_kajiwoto_new SELECT * FROM provider_config_kajiwoto;
DROP TABLE provider_config_kajiwoto;
ALTER TABLE provider_config_kajiwoto_new RENAME TO provider_config_kajiwoto;

-- provider_config_characterai
CREATE TABLE provider_config_characterai_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    api_token TEXT NOT NULL,
    chatroom_url TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);
INSERT INTO provider_config_characterai_new SELECT * FROM provider_config_characterai;
DROP TABLE provider_config_characterai;
ALTER TABLE provider_config_characterai_new RENAME TO provider_config_characterai;

-- provider_config_localai
CREATE TABLE provider_config_localai_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    embedding_model TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);
INSERT INTO provider_config_localai_new SELECT * FROM provider_config_localai;
DROP TABLE provider_config_localai;
ALTER TABLE provider_config_localai_new RENAME TO provider_config_localai;

-- provider_config_mistral
CREATE TABLE provider_config_mistral_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    api_key TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);
INSERT INTO provider_config_mistral_new SELECT * FROM provider_config_mistral;
DROP TABLE provider_config_mistral;
ALTER TABLE provider_config_mistral_new RENAME TO provider_config_mistral;

-- provider_config_ollama
CREATE TABLE provider_config_ollama_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    embedding_model TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);
INSERT INTO provider_config_ollama_new SELECT * FROM provider_config_ollama;
DROP TABLE provider_config_ollama;
ALTER TABLE provider_config_ollama_new RENAME TO provider_config_ollama;
`;
