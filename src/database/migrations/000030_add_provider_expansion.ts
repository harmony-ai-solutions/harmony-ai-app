export const migration030 = `
-- Create xAI provider config table
CREATE TABLE IF NOT EXISTS provider_config_xai (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    api_key TEXT NOT NULL,
    model TEXT DEFAULT '',
    max_tokens INTEGER DEFAULT 0,
    max_completion_tokens INTEGER DEFAULT 0,
    temperature REAL DEFAULT 0.7,
    top_p REAL DEFAULT 1.0,
    frequency_penalty REAL DEFAULT 0,
    presence_penalty REAL DEFAULT 0,
    n INTEGER DEFAULT 1,
    stop_tokens TEXT DEFAULT '',
    seed INTEGER DEFAULT NULL,
    response_format TEXT DEFAULT '',
    reasoning_effort TEXT DEFAULT '',
    sampling_preset_name TEXT NOT NULL DEFAULT '',
    extra_params TEXT NOT NULL DEFAULT '{}',
    image_aspect_ratio TEXT DEFAULT '',
    image_resolution TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);

-- Create Google provider config table
CREATE TABLE IF NOT EXISTS provider_config_google (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    api_key TEXT NOT NULL,
    model TEXT DEFAULT '',
    max_output_tokens INTEGER DEFAULT 0,
    temperature REAL DEFAULT 0.7,
    top_p REAL DEFAULT 1.0,
    top_k INTEGER DEFAULT 0,
    stop_tokens TEXT DEFAULT '',
    seed INTEGER DEFAULT NULL,
    response_mime_type TEXT DEFAULT '',
    sampling_preset_name TEXT NOT NULL DEFAULT '',
    extra_params TEXT NOT NULL DEFAULT '{}',
    number_of_images INTEGER DEFAULT 1,
    aspect_ratio TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);

-- Create Anthropic provider config table
CREATE TABLE IF NOT EXISTS provider_config_anthropic (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    api_key TEXT NOT NULL,
    model TEXT DEFAULT '',
    max_tokens INTEGER DEFAULT 0,
    temperature REAL DEFAULT 0.7,
    top_p REAL DEFAULT 1.0,
    top_k INTEGER DEFAULT 0,
    stop_sequences TEXT DEFAULT '',
    sampling_preset_name TEXT NOT NULL DEFAULT '',
    extra_params TEXT NOT NULL DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);

-- Add new columns to provider_config_openrouter for TTS/Imagination/RAG support
ALTER TABLE provider_config_openrouter ADD COLUMN voice TEXT DEFAULT '';
ALTER TABLE provider_config_openrouter ADD COLUMN speed REAL DEFAULT 1.0;
ALTER TABLE provider_config_openrouter ADD COLUMN format TEXT DEFAULT '';
ALTER TABLE provider_config_openrouter ADD COLUMN image_aspect_ratio TEXT DEFAULT '';
ALTER TABLE provider_config_openrouter ADD COLUMN image_size TEXT DEFAULT '';

-- Unify embedding_model into model for pre-existing tables

-- OpenAI: already has 'model' column. Copy data, then drop.
UPDATE provider_config_openai SET model = embedding_model WHERE (model IS NULL OR model = '') AND embedding_model IS NOT NULL AND embedding_model != '';
ALTER TABLE provider_config_openai DROP COLUMN embedding_model;

-- OpenAI Compatible: already has 'model' column.
UPDATE provider_config_openaicompatible SET model = embedding_model WHERE (model IS NULL OR model = '') AND embedding_model IS NOT NULL AND embedding_model != '';
ALTER TABLE provider_config_openaicompatible DROP COLUMN embedding_model;

-- LocalAI: has NO 'model' column, only 'embedding_model'. Just rename it.
ALTER TABLE provider_config_localai RENAME COLUMN embedding_model TO model;

-- Ollama: has NO 'model' column, only 'embedding_model'. Just rename it.
ALTER TABLE provider_config_ollama RENAME COLUMN embedding_model TO model;
`;
