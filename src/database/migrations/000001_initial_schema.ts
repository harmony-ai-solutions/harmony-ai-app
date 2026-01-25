/**
 * Migration 000001: Initial Schema
 */

export const migration001 = `
-- Initial database schema for Harmony Link configuration refactoring

-- Core Entity & Character Tables
CREATE TABLE character_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    personality TEXT NOT NULL DEFAULT '',
    appearance TEXT NOT NULL DEFAULT '',
    backstory TEXT NOT NULL DEFAULT '',
    voice_characteristics TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE entities (
    id TEXT PRIMARY KEY,
    character_profile_id TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (character_profile_id) REFERENCES character_profiles(id) ON DELETE RESTRICT
);

CREATE TABLE entity_module_mappings (
    entity_id TEXT PRIMARY KEY,
    backend_config_id INTEGER,
    cognition_config_id INTEGER,
    movement_config_id INTEGER,
    rag_config_id INTEGER,
    stt_config_id INTEGER,
    tts_config_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
    FOREIGN KEY (backend_config_id) REFERENCES backend_configs(id) ON DELETE SET NULL,
    FOREIGN KEY (cognition_config_id) REFERENCES cognition_configs(id) ON DELETE SET NULL,
    FOREIGN KEY (movement_config_id) REFERENCES movement_configs(id) ON DELETE SET NULL,
    FOREIGN KEY (rag_config_id) REFERENCES rag_configs(id) ON DELETE SET NULL,
    FOREIGN KEY (stt_config_id) REFERENCES stt_configs(id) ON DELETE SET NULL,
    FOREIGN KEY (tts_config_id) REFERENCES tts_configs(id) ON DELETE SET NULL
);

-- Provider Configuration Tables
CREATE TABLE provider_config_openai (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
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
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE provider_config_openrouter (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    api_key TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    max_tokens INTEGER NOT NULL DEFAULT 0,
    temperature REAL NOT NULL DEFAULT 0,
    top_p REAL NOT NULL DEFAULT 0,
    n INTEGER NOT NULL DEFAULT 0,
    stop_tokens TEXT NOT NULL DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE provider_config_openaicompatible (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
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
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE provider_config_harmonyspeech (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    endpoint TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    voice_config_file TEXT NOT NULL DEFAULT '',
    format TEXT NOT NULL DEFAULT '',
    sample_rate INTEGER NOT NULL DEFAULT 0,
    stream INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE provider_config_elevenlabs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    api_key TEXT NOT NULL,
    voice_id TEXT NOT NULL DEFAULT '',
    model_id TEXT NOT NULL DEFAULT '',
    stability REAL NOT NULL DEFAULT 0,
    similarity_boost REAL NOT NULL DEFAULT 0,
    style REAL NOT NULL DEFAULT 0,
    speaker_boost INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE provider_config_kindroid (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    api_key TEXT NOT NULL,
    kindroid_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE provider_config_kajiwoto (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    room_url TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE provider_config_characterai (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    api_token TEXT NOT NULL,
    chatroom_url TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE provider_config_localai (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    embedding_model TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE provider_config_mistral (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    api_key TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE provider_config_ollama (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    base_url TEXT NOT NULL,
    embedding_model TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Module Configuration Tables
CREATE TABLE backend_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL,
    provider_config_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE movement_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL,
    provider_config_id INTEGER NOT NULL,
    startup_sync_timeout INTEGER NOT NULL DEFAULT 0,
    execution_threshold REAL NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE stt_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    main_stream_time_millis INTEGER NOT NULL DEFAULT 0,
    transition_stream_time_millis INTEGER NOT NULL DEFAULT 0,
    max_buffer_count INTEGER NOT NULL DEFAULT 0,
    transcription_provider TEXT NOT NULL,
    transcription_provider_config_id INTEGER NOT NULL,
    vad_provider TEXT NOT NULL,
    vad_provider_config_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE cognition_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL,
    provider_config_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE rag_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL,
    provider_config_id INTEGER NOT NULL,
    embedding_concurrency INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tts_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL,
    provider_config_id INTEGER NOT NULL,
    output_type TEXT NOT NULL DEFAULT '',
    words_to_replace TEXT NOT NULL DEFAULT '',
    vocalize_nonverbal INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;
