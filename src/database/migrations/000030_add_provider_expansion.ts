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

-- ============================================================
-- Unify model fields: merge embedding_model into model
-- ============================================================
-- NOTE: ALTER TABLE ... DROP/RENAME COLUMN does not work in SQLite
-- We use the _new-table rebuild pattern instead.

-- OpenAI: already has 'model' column. Copy data (for completeness),
-- then rebuild the table to drop the embedding_model column.
UPDATE provider_config_openai SET model = embedding_model WHERE (model IS NULL OR model = '') AND embedding_model IS NOT NULL AND embedding_model != '';
CREATE TABLE IF NOT EXISTS provider_config_openai_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    api_key TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    max_tokens INTEGER NOT NULL DEFAULT 0,
    temperature REAL NOT NULL DEFAULT 0,
    top_p REAL NOT NULL DEFAULT 0,
    n INTEGER NOT NULL DEFAULT 0,
    stop_tokens TEXT NOT NULL DEFAULT '',
    voice TEXT NOT NULL DEFAULT '',
    speed REAL NOT NULL DEFAULT 0,
    format TEXT NOT NULL DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME,
    frequency_penalty REAL NOT NULL DEFAULT 0,
    presence_penalty REAL NOT NULL DEFAULT 0,
    max_completion_tokens INTEGER NOT NULL DEFAULT 0,
    seed INTEGER NOT NULL DEFAULT 0,
    response_format TEXT NOT NULL DEFAULT '',
    reasoning_effort TEXT NOT NULL DEFAULT '',
    top_k INTEGER NOT NULL DEFAULT 0,
    top_a REAL NOT NULL DEFAULT 0,
    min_p REAL NOT NULL DEFAULT 0,
    repetition_penalty REAL NOT NULL DEFAULT 0,
    sampling_preset_name TEXT NOT NULL DEFAULT '',
    extra_params TEXT NOT NULL DEFAULT '{}'
);
INSERT INTO provider_config_openai_new (
    id, name, api_key, model, max_tokens, temperature, top_p, n, stop_tokens,
    voice, speed, format, created_at, updated_at, deleted_at,
    frequency_penalty, presence_penalty, max_completion_tokens, seed, response_format,
    reasoning_effort, top_k, top_a, min_p, repetition_penalty, sampling_preset_name, extra_params
)
SELECT
    id, name, api_key, model, max_tokens, temperature, top_p, n, stop_tokens,
    voice, speed, format, created_at, updated_at, deleted_at,
    frequency_penalty, presence_penalty, max_completion_tokens, seed, response_format,
    reasoning_effort, top_k, top_a, min_p, repetition_penalty, sampling_preset_name, extra_params
FROM provider_config_openai;
DROP TABLE provider_config_openai;
ALTER TABLE provider_config_openai_new RENAME TO provider_config_openai;

-- OpenAI Compatible: already has 'model' column. Same rebuild approach.
UPDATE provider_config_openaicompatible SET model = embedding_model WHERE (model IS NULL OR model = '') AND embedding_model IS NOT NULL AND embedding_model != '';
CREATE TABLE IF NOT EXISTS provider_config_openaicompatible_new (
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME,
    frequency_penalty REAL NOT NULL DEFAULT 0,
    presence_penalty REAL NOT NULL DEFAULT 0,
    max_completion_tokens INTEGER NOT NULL DEFAULT 0,
    seed INTEGER NOT NULL DEFAULT 0,
    response_format TEXT NOT NULL DEFAULT '',
    top_k INTEGER NOT NULL DEFAULT 0,
    top_a REAL NOT NULL DEFAULT 0,
    min_p REAL NOT NULL DEFAULT 0,
    repetition_penalty REAL NOT NULL DEFAULT 0,
    sampling_preset_name TEXT NOT NULL DEFAULT '',
    extra_params TEXT NOT NULL DEFAULT '{}'
);
INSERT INTO provider_config_openaicompatible_new (
    id, name, base_url, api_key, model, max_tokens, temperature, top_p, n, stop_tokens,
    created_at, updated_at, deleted_at,
    frequency_penalty, presence_penalty, max_completion_tokens, seed, response_format,
    top_k, top_a, min_p, repetition_penalty, sampling_preset_name, extra_params
)
SELECT
    id, name, base_url, api_key, model, max_tokens, temperature, top_p, n, stop_tokens,
    created_at, updated_at, deleted_at,
    frequency_penalty, presence_penalty, max_completion_tokens, seed, response_format,
    top_k, top_a, min_p, repetition_penalty, sampling_preset_name, extra_params
FROM provider_config_openaicompatible;
DROP TABLE provider_config_openaicompatible;
ALTER TABLE provider_config_openaicompatible_new RENAME TO provider_config_openaicompatible;


-- LocalAI: has NO 'model' column, only 'embedding_model'. Rename via rebuild.
CREATE TABLE IF NOT EXISTS provider_config_localai_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);
INSERT INTO provider_config_localai_new (id, name, model, created_at, updated_at, deleted_at)
SELECT id, name, embedding_model, created_at, updated_at, deleted_at FROM provider_config_localai;
DROP TABLE provider_config_localai;
ALTER TABLE provider_config_localai_new RENAME TO provider_config_localai;

-- Ollama: has NO 'model' column, only 'embedding_model'. Rename via rebuild.
CREATE TABLE IF NOT EXISTS provider_config_ollama_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    model TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);
INSERT INTO provider_config_ollama_new (id, name, base_url, model, created_at, updated_at, deleted_at)
SELECT id, name, base_url, embedding_model, created_at, updated_at, deleted_at FROM provider_config_ollama;
DROP TABLE provider_config_ollama;
ALTER TABLE provider_config_ollama_new RENAME TO provider_config_ollama;
`;
