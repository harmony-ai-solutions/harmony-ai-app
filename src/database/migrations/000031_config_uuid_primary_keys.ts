export const migration031 = `
-- Migration 000031: Convert config table family to UUID primary keys
-- Mirrors harmony-link-private/database/migrations/000031_config_uuid_primary_keys.up.sql
--
-- Migrates the INTEGER-autoincrement config-table family to TEXT (UUID) primary
-- keys so that every user-data table becomes roam-safe.  Uses the established
-- _new-table copy pattern with temporary _idmap_* mapping tables to translate
-- the 3-level FK chain.

-- ============================================================================
-- LEVEL 1: Provider Config Tables (15 tables)
-- ============================================================================

-- ------------------------------------------------------------------
-- 1.1  provider_config_openai
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _idmap_openai (old_id INTEGER PRIMARY KEY, new_id TEXT NOT NULL);

INSERT INTO _idmap_openai (old_id, new_id)
SELECT id,
       lower(hex(randomblob(4)) || '-' || substr(hex(randomblob(2)),2) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1,1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))
FROM provider_config_openai;

CREATE TABLE IF NOT EXISTS provider_config_openai_new (
    id TEXT PRIMARY KEY,
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
    extra_params TEXT NOT NULL DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);

INSERT INTO provider_config_openai_new (
    id, name, api_key, model, max_tokens, temperature, top_p, n, stop_tokens,
    voice, speed, format, frequency_penalty, presence_penalty, max_completion_tokens,
    seed, response_format, reasoning_effort, top_k, top_a, min_p, repetition_penalty,
    sampling_preset_name, extra_params, created_at, updated_at, deleted_at
)
SELECT
    m.new_id, t.name, t.api_key, t.model, t.max_tokens, t.temperature, t.top_p, t.n, t.stop_tokens,
    t.voice, t.speed, t.format, t.frequency_penalty, t.presence_penalty, t.max_completion_tokens,
    t.seed, t.response_format, t.reasoning_effort, t.top_k, t.top_a, t.min_p, t.repetition_penalty,
    t.sampling_preset_name, t.extra_params, t.created_at, t.updated_at, t.deleted_at
FROM provider_config_openai t
JOIN _idmap_openai m ON m.old_id = t.id;

DROP TABLE provider_config_openai;
ALTER TABLE provider_config_openai_new RENAME TO provider_config_openai;

-- ------------------------------------------------------------------
-- 1.2  provider_config_openrouter
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _idmap_openrouter (old_id INTEGER PRIMARY KEY, new_id TEXT NOT NULL);

INSERT INTO _idmap_openrouter (old_id, new_id)
SELECT id,
       lower(hex(randomblob(4)) || '-' || substr(hex(randomblob(2)),2) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1,1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))
FROM provider_config_openrouter;

CREATE TABLE IF NOT EXISTS provider_config_openrouter_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    api_key TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    max_tokens INTEGER NOT NULL DEFAULT 0,
    temperature REAL NOT NULL DEFAULT 0,
    top_p REAL NOT NULL DEFAULT 0,
    n INTEGER NOT NULL DEFAULT 0,
    stop_tokens TEXT NOT NULL DEFAULT '',
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
    extra_params TEXT NOT NULL DEFAULT '{}',
    voice TEXT NOT NULL DEFAULT '',
    speed REAL NOT NULL DEFAULT 1.0,
    format TEXT NOT NULL DEFAULT 'mp3',
    image_aspect_ratio TEXT NOT NULL DEFAULT '',
    image_size TEXT NOT NULL DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);

INSERT INTO provider_config_openrouter_new (
    id, name, api_key, model, max_tokens, temperature, top_p, n, stop_tokens,
    frequency_penalty, presence_penalty, max_completion_tokens, seed, response_format,
    top_k, top_a, min_p, repetition_penalty, sampling_preset_name, extra_params,
    voice, speed, format, image_aspect_ratio, image_size, created_at, updated_at, deleted_at
)
SELECT
    m.new_id, t.name, t.api_key, t.model, t.max_tokens, t.temperature, t.top_p, t.n, t.stop_tokens,
    t.frequency_penalty, t.presence_penalty, t.max_completion_tokens, t.seed, t.response_format,
    t.top_k, t.top_a, t.min_p, t.repetition_penalty, t.sampling_preset_name, t.extra_params,
    t.voice, t.speed, t.format, t.image_aspect_ratio, t.image_size, t.created_at, t.updated_at, t.deleted_at
FROM provider_config_openrouter t
JOIN _idmap_openrouter m ON m.old_id = t.id;

DROP TABLE provider_config_openrouter;
ALTER TABLE provider_config_openrouter_new RENAME TO provider_config_openrouter;

-- ------------------------------------------------------------------
-- 1.3  provider_config_openaicompatible
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _idmap_openaicompatible (old_id INTEGER PRIMARY KEY, new_id TEXT NOT NULL);

INSERT INTO _idmap_openaicompatible (old_id, new_id)
SELECT id,
       lower(hex(randomblob(4)) || '-' || substr(hex(randomblob(2)),2) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1,1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))
FROM provider_config_openaicompatible;

CREATE TABLE IF NOT EXISTS provider_config_openaicompatible_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    max_tokens INTEGER NOT NULL DEFAULT 0,
    temperature REAL NOT NULL DEFAULT 0,
    top_p REAL NOT NULL DEFAULT 0,
    n INTEGER NOT NULL DEFAULT 0,
    stop_tokens TEXT NOT NULL DEFAULT '',
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
    extra_params TEXT NOT NULL DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);

INSERT INTO provider_config_openaicompatible_new (
    id, name, base_url, api_key, model, max_tokens, temperature, top_p, n, stop_tokens,
    frequency_penalty, presence_penalty, max_completion_tokens, seed, response_format,
    top_k, top_a, min_p, repetition_penalty, sampling_preset_name, extra_params,
    created_at, updated_at, deleted_at
)
SELECT
    m.new_id, t.name, t.base_url, t.api_key, t.model, t.max_tokens, t.temperature, t.top_p, t.n, t.stop_tokens,
    t.frequency_penalty, t.presence_penalty, t.max_completion_tokens, t.seed, t.response_format,
    t.top_k, t.top_a, t.min_p, t.repetition_penalty, t.sampling_preset_name, t.extra_params,
    t.created_at, t.updated_at, t.deleted_at
FROM provider_config_openaicompatible t
JOIN _idmap_openaicompatible m ON m.old_id = t.id;

DROP TABLE provider_config_openaicompatible;
ALTER TABLE provider_config_openaicompatible_new RENAME TO provider_config_openaicompatible;

-- ------------------------------------------------------------------
-- 1.4  provider_config_harmonyspeech
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _idmap_harmonyspeech (old_id INTEGER PRIMARY KEY, new_id TEXT NOT NULL);

INSERT INTO _idmap_harmonyspeech (old_id, new_id)
SELECT id,
       lower(hex(randomblob(4)) || '-' || substr(hex(randomblob(2)),2) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1,1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))
FROM provider_config_harmonyspeech;

CREATE TABLE IF NOT EXISTS provider_config_harmonyspeech_new (
    id TEXT PRIMARY KEY,
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

INSERT INTO provider_config_harmonyspeech_new (
    id, name, endpoint, model, voice_config_file, format, sample_rate, stream,
    created_at, updated_at, deleted_at
)
SELECT
    m.new_id, t.name, t.endpoint, t.model, t.voice_config_file, t.format, t.sample_rate, t.stream,
    t.created_at, t.updated_at, t.deleted_at
FROM provider_config_harmonyspeech t
JOIN _idmap_harmonyspeech m ON m.old_id = t.id;

DROP TABLE provider_config_harmonyspeech;
ALTER TABLE provider_config_harmonyspeech_new RENAME TO provider_config_harmonyspeech;

-- ------------------------------------------------------------------
-- 1.5  provider_config_elevenlabs
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _idmap_elevenlabs (old_id INTEGER PRIMARY KEY, new_id TEXT NOT NULL);

INSERT INTO _idmap_elevenlabs (old_id, new_id)
SELECT id,
       lower(hex(randomblob(4)) || '-' || substr(hex(randomblob(2)),2) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1,1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))
FROM provider_config_elevenlabs;

CREATE TABLE IF NOT EXISTS provider_config_elevenlabs_new (
    id TEXT PRIMARY KEY,
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

INSERT INTO provider_config_elevenlabs_new (
    id, name, api_key, voice_id, model_id, stability, similarity_boost, style, speaker_boost,
    created_at, updated_at, deleted_at
)
SELECT
    m.new_id, t.name, t.api_key, t.voice_id, t.model_id, t.stability, t.similarity_boost, t.style, t.speaker_boost,
    t.created_at, t.updated_at, t.deleted_at
FROM provider_config_elevenlabs t
JOIN _idmap_elevenlabs m ON m.old_id = t.id;

DROP TABLE provider_config_elevenlabs;
ALTER TABLE provider_config_elevenlabs_new RENAME TO provider_config_elevenlabs;

-- ------------------------------------------------------------------
-- 1.6  provider_config_kindroid
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _idmap_kindroid (old_id INTEGER PRIMARY KEY, new_id TEXT NOT NULL);

INSERT INTO _idmap_kindroid (old_id, new_id)
SELECT id,
       lower(hex(randomblob(4)) || '-' || substr(hex(randomblob(2)),2) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1,1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))
FROM provider_config_kindroid;

CREATE TABLE IF NOT EXISTS provider_config_kindroid_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    api_key TEXT NOT NULL,
    kindroid_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);

INSERT INTO provider_config_kindroid_new (
    id, name, api_key, kindroid_id, created_at, updated_at, deleted_at
)
SELECT
    m.new_id, t.name, t.api_key, t.kindroid_id, t.created_at, t.updated_at, t.deleted_at
FROM provider_config_kindroid t
JOIN _idmap_kindroid m ON m.old_id = t.id;

DROP TABLE provider_config_kindroid;
ALTER TABLE provider_config_kindroid_new RENAME TO provider_config_kindroid;

-- ------------------------------------------------------------------
-- 1.7  provider_config_kajiwoto
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _idmap_kajiwoto (old_id INTEGER PRIMARY KEY, new_id TEXT NOT NULL);

INSERT INTO _idmap_kajiwoto (old_id, new_id)
SELECT id,
       lower(hex(randomblob(4)) || '-' || substr(hex(randomblob(2)),2) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1,1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))
FROM provider_config_kajiwoto;

CREATE TABLE IF NOT EXISTS provider_config_kajiwoto_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    room_url TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);

INSERT INTO provider_config_kajiwoto_new (
    id, name, username, password, room_url, created_at, updated_at, deleted_at
)
SELECT
    m.new_id, t.name, t.username, t.password, t.room_url, t.created_at, t.updated_at, t.deleted_at
FROM provider_config_kajiwoto t
JOIN _idmap_kajiwoto m ON m.old_id = t.id;

DROP TABLE provider_config_kajiwoto;
ALTER TABLE provider_config_kajiwoto_new RENAME TO provider_config_kajiwoto;

-- ------------------------------------------------------------------
-- 1.8  provider_config_characterai
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _idmap_characterai (old_id INTEGER PRIMARY KEY, new_id TEXT NOT NULL);

INSERT INTO _idmap_characterai (old_id, new_id)
SELECT id,
       lower(hex(randomblob(4)) || '-' || substr(hex(randomblob(2)),2) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1,1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))
FROM provider_config_characterai;

CREATE TABLE IF NOT EXISTS provider_config_characterai_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    api_token TEXT NOT NULL,
    chatroom_url TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);

INSERT INTO provider_config_characterai_new (
    id, name, api_token, chatroom_url, created_at, updated_at, deleted_at
)
SELECT
    m.new_id, t.name, t.api_token, t.chatroom_url, t.created_at, t.updated_at, t.deleted_at
FROM provider_config_characterai t
JOIN _idmap_characterai m ON m.old_id = t.id;

DROP TABLE provider_config_characterai;
ALTER TABLE provider_config_characterai_new RENAME TO provider_config_characterai;

-- ------------------------------------------------------------------
-- 1.9  provider_config_localai
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _idmap_localai (old_id INTEGER PRIMARY KEY, new_id TEXT NOT NULL);

INSERT INTO _idmap_localai (old_id, new_id)
SELECT id,
       lower(hex(randomblob(4)) || '-' || substr(hex(randomblob(2)),2) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1,1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))
FROM provider_config_localai;

CREATE TABLE IF NOT EXISTS provider_config_localai_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);

INSERT INTO provider_config_localai_new (
    id, name, model, created_at, updated_at, deleted_at
)
SELECT
    m.new_id, t.name, t.model, t.created_at, t.updated_at, t.deleted_at
FROM provider_config_localai t
JOIN _idmap_localai m ON m.old_id = t.id;

DROP TABLE provider_config_localai;
ALTER TABLE provider_config_localai_new RENAME TO provider_config_localai;

-- ------------------------------------------------------------------
-- 1.10  provider_config_mistral
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _idmap_mistral (old_id INTEGER PRIMARY KEY, new_id TEXT NOT NULL);

INSERT INTO _idmap_mistral (old_id, new_id)
SELECT id,
       lower(hex(randomblob(4)) || '-' || substr(hex(randomblob(2)),2) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1,1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))
FROM provider_config_mistral;

CREATE TABLE IF NOT EXISTS provider_config_mistral_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    api_key TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);

INSERT INTO provider_config_mistral_new (
    id, name, api_key, created_at, updated_at, deleted_at
)
SELECT
    m.new_id, t.name, t.api_key, t.created_at, t.updated_at, t.deleted_at
FROM provider_config_mistral t
JOIN _idmap_mistral m ON m.old_id = t.id;

DROP TABLE provider_config_mistral;
ALTER TABLE provider_config_mistral_new RENAME TO provider_config_mistral;

-- ------------------------------------------------------------------
-- 1.11  provider_config_ollama
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _idmap_ollama (old_id INTEGER PRIMARY KEY, new_id TEXT NOT NULL);

INSERT INTO _idmap_ollama (old_id, new_id)
SELECT id,
       lower(hex(randomblob(4)) || '-' || substr(hex(randomblob(2)),2) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1,1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))
FROM provider_config_ollama;

CREATE TABLE IF NOT EXISTS provider_config_ollama_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    model TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);

INSERT INTO provider_config_ollama_new (
    id, name, base_url, model, created_at, updated_at, deleted_at
)
SELECT
    m.new_id, t.name, t.base_url, t.model, t.created_at, t.updated_at, t.deleted_at
FROM provider_config_ollama t
JOIN _idmap_ollama m ON m.old_id = t.id;

DROP TABLE provider_config_ollama;
ALTER TABLE provider_config_ollama_new RENAME TO provider_config_ollama;

-- ------------------------------------------------------------------
-- 1.12  provider_config_comfyui
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _idmap_comfyui (old_id INTEGER PRIMARY KEY, new_id TEXT NOT NULL);

INSERT INTO _idmap_comfyui (old_id, new_id)
SELECT id,
       lower(hex(randomblob(4)) || '-' || substr(hex(randomblob(2)),2) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1,1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))
FROM provider_config_comfyui;

CREATE TABLE IF NOT EXISTS provider_config_comfyui_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key TEXT NOT NULL DEFAULT '',
    workflow_profiles TEXT NOT NULL DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);

INSERT INTO provider_config_comfyui_new (
    id, name, base_url, api_key, workflow_profiles, created_at, updated_at, deleted_at
)
SELECT
    m.new_id, t.name, t.base_url, t.api_key, t.workflow_profiles, t.created_at, t.updated_at, t.deleted_at
FROM provider_config_comfyui t
JOIN _idmap_comfyui m ON m.old_id = t.id;

DROP TABLE provider_config_comfyui;
ALTER TABLE provider_config_comfyui_new RENAME TO provider_config_comfyui;

-- ------------------------------------------------------------------
-- 1.13  provider_config_xai
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _idmap_xai (old_id INTEGER PRIMARY KEY, new_id TEXT NOT NULL);

INSERT INTO _idmap_xai (old_id, new_id)
SELECT id,
       lower(hex(randomblob(4)) || '-' || substr(hex(randomblob(2)),2) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1,1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))
FROM provider_config_xai;

CREATE TABLE IF NOT EXISTS provider_config_xai_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    api_key TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT 'grok-4.3',
    max_tokens INTEGER NOT NULL DEFAULT 0,
    max_completion_tokens INTEGER NOT NULL DEFAULT 0,
    temperature REAL NOT NULL DEFAULT 0,
    top_p REAL NOT NULL DEFAULT 0,
    frequency_penalty REAL NOT NULL DEFAULT 0,
    presence_penalty REAL NOT NULL DEFAULT 0,
    n INTEGER NOT NULL DEFAULT 0,
    stop_tokens TEXT NOT NULL DEFAULT '[]',
    seed INTEGER NOT NULL DEFAULT 0,
    response_format TEXT NOT NULL DEFAULT '',
    reasoning_effort TEXT NOT NULL DEFAULT '',
    sampling_preset_name TEXT NOT NULL DEFAULT '',
    extra_params TEXT NOT NULL DEFAULT '{}',
    image_aspect_ratio TEXT NOT NULL DEFAULT '1:1',
    image_resolution TEXT NOT NULL DEFAULT '1k',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);

INSERT INTO provider_config_xai_new (
    id, name, api_key, model, max_tokens, max_completion_tokens, temperature, top_p,
    frequency_penalty, presence_penalty, n, stop_tokens, seed, response_format,
    reasoning_effort, sampling_preset_name, extra_params,
    image_aspect_ratio, image_resolution, created_at, updated_at, deleted_at
)
SELECT
    m.new_id, t.name, t.api_key, t.model, t.max_tokens, t.max_completion_tokens, t.temperature, t.top_p,
    t.frequency_penalty, t.presence_penalty, t.n, t.stop_tokens, t.seed, t.response_format,
    t.reasoning_effort, t.sampling_preset_name, t.extra_params,
    t.image_aspect_ratio, t.image_resolution, t.created_at, t.updated_at, t.deleted_at
FROM provider_config_xai t
JOIN _idmap_xai m ON m.old_id = t.id;

DROP TABLE provider_config_xai;
ALTER TABLE provider_config_xai_new RENAME TO provider_config_xai;

-- ------------------------------------------------------------------
-- 1.14  provider_config_google
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _idmap_google (old_id INTEGER PRIMARY KEY, new_id TEXT NOT NULL);

INSERT INTO _idmap_google (old_id, new_id)
SELECT id,
       lower(hex(randomblob(4)) || '-' || substr(hex(randomblob(2)),2) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1,1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))
FROM provider_config_google;

CREATE TABLE IF NOT EXISTS provider_config_google_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    api_key TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    max_output_tokens INTEGER NOT NULL DEFAULT 0,
    temperature REAL NOT NULL DEFAULT 0,
    top_p REAL NOT NULL DEFAULT 0,
    top_k INTEGER NOT NULL DEFAULT 0,
    stop_tokens TEXT NOT NULL DEFAULT '[]',
    seed INTEGER NOT NULL DEFAULT 0,
    response_mime_type TEXT NOT NULL DEFAULT '',
    sampling_preset_name TEXT NOT NULL DEFAULT '',
    extra_params TEXT NOT NULL DEFAULT '{}',
    number_of_images INTEGER NOT NULL DEFAULT 1,
    aspect_ratio TEXT NOT NULL DEFAULT '1:1',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);

INSERT INTO provider_config_google_new (
    id, name, api_key, model, max_output_tokens, temperature, top_p, top_k,
    stop_tokens, seed, response_mime_type, sampling_preset_name, extra_params,
    number_of_images, aspect_ratio, created_at, updated_at, deleted_at
)
SELECT
    m.new_id, t.name, t.api_key, t.model, t.max_output_tokens, t.temperature, t.top_p, t.top_k,
    t.stop_tokens, t.seed, t.response_mime_type, t.sampling_preset_name, t.extra_params,
    t.number_of_images, t.aspect_ratio, t.created_at, t.updated_at, t.deleted_at
FROM provider_config_google t
JOIN _idmap_google m ON m.old_id = t.id;

DROP TABLE provider_config_google;
ALTER TABLE provider_config_google_new RENAME TO provider_config_google;

-- ------------------------------------------------------------------
-- 1.15  provider_config_anthropic
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _idmap_anthropic (old_id INTEGER PRIMARY KEY, new_id TEXT NOT NULL);

INSERT INTO _idmap_anthropic (old_id, new_id)
SELECT id,
       lower(hex(randomblob(4)) || '-' || substr(hex(randomblob(2)),2) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1,1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))
FROM provider_config_anthropic;

CREATE TABLE IF NOT EXISTS provider_config_anthropic_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    api_key TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
    max_tokens INTEGER NOT NULL DEFAULT 4096,
    temperature REAL NOT NULL DEFAULT 0,
    top_p REAL NOT NULL DEFAULT 0,
    top_k INTEGER NOT NULL DEFAULT 0,
    stop_sequences TEXT NOT NULL DEFAULT '[]',
    sampling_preset_name TEXT NOT NULL DEFAULT '',
    extra_params TEXT NOT NULL DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);

INSERT INTO provider_config_anthropic_new (
    id, name, api_key, model, max_tokens, temperature, top_p, top_k,
    stop_sequences, sampling_preset_name, extra_params,
    created_at, updated_at, deleted_at
)
SELECT
    m.new_id, t.name, t.api_key, t.model, t.max_tokens, t.temperature, t.top_p, t.top_k,
    t.stop_sequences, t.sampling_preset_name, t.extra_params,
    t.created_at, t.updated_at, t.deleted_at
FROM provider_config_anthropic t
JOIN _idmap_anthropic m ON m.old_id = t.id;

DROP TABLE provider_config_anthropic;
ALTER TABLE provider_config_anthropic_new RENAME TO provider_config_anthropic;

-- ============================================================================
-- LEVEL 2: Module Config Tables (8 tables)
-- ============================================================================

-- ------------------------------------------------------------------
-- 2.1  backend_configs
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _idmap_backend (old_id INTEGER PRIMARY KEY, new_id TEXT NOT NULL);

INSERT INTO _idmap_backend (old_id, new_id)
SELECT id,
       lower(hex(randomblob(4)) || '-' || substr(hex(randomblob(2)),2) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1,1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))
FROM backend_configs;

CREATE TABLE IF NOT EXISTS backend_configs_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL,
    provider_config_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);

INSERT INTO backend_configs_new (id, name, provider, provider_config_id, created_at, updated_at, deleted_at)
SELECT
    m.new_id, t.name, t.provider,
    CASE t.provider
        WHEN 'openai' THEN (SELECT new_id FROM _idmap_openai WHERE old_id = t.provider_config_id)
        WHEN 'openrouter' THEN (SELECT new_id FROM _idmap_openrouter WHERE old_id = t.provider_config_id)
        WHEN 'openaicompatible' THEN (SELECT new_id FROM _idmap_openaicompatible WHERE old_id = t.provider_config_id)
        WHEN 'harmonyspeech' THEN (SELECT new_id FROM _idmap_harmonyspeech WHERE old_id = t.provider_config_id)
        WHEN 'elevenlabs' THEN (SELECT new_id FROM _idmap_elevenlabs WHERE old_id = t.provider_config_id)
        WHEN 'kindroid' THEN (SELECT new_id FROM _idmap_kindroid WHERE old_id = t.provider_config_id)
        WHEN 'kajiwoto' THEN (SELECT new_id FROM _idmap_kajiwoto WHERE old_id = t.provider_config_id)
        WHEN 'characterai' THEN (SELECT new_id FROM _idmap_characterai WHERE old_id = t.provider_config_id)
        WHEN 'localai' THEN (SELECT new_id FROM _idmap_localai WHERE old_id = t.provider_config_id)
        WHEN 'mistral' THEN (SELECT new_id FROM _idmap_mistral WHERE old_id = t.provider_config_id)
        WHEN 'ollama' THEN (SELECT new_id FROM _idmap_ollama WHERE old_id = t.provider_config_id)
        WHEN 'comfyui' THEN (SELECT new_id FROM _idmap_comfyui WHERE old_id = t.provider_config_id)
        WHEN 'xai' THEN (SELECT new_id FROM _idmap_xai WHERE old_id = t.provider_config_id)
        WHEN 'google' THEN (SELECT new_id FROM _idmap_google WHERE old_id = t.provider_config_id)
        WHEN 'anthropic' THEN (SELECT new_id FROM _idmap_anthropic WHERE old_id = t.provider_config_id)
    END,
    t.created_at, t.updated_at, t.deleted_at
FROM backend_configs t
JOIN _idmap_backend m ON m.old_id = t.id;

DROP TABLE backend_configs;
ALTER TABLE backend_configs_new RENAME TO backend_configs;

-- ------------------------------------------------------------------
-- 2.2  cognition_configs
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _idmap_cognition (old_id INTEGER PRIMARY KEY, new_id TEXT NOT NULL);

INSERT INTO _idmap_cognition (old_id, new_id)
SELECT id,
       lower(hex(randomblob(4)) || '-' || substr(hex(randomblob(2)),2) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1,1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))
FROM cognition_configs;

CREATE TABLE IF NOT EXISTS cognition_configs_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL,
    provider_config_id TEXT NOT NULL,
    max_cognition_events INTEGER NOT NULL DEFAULT 20,
    generate_expressions INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);

INSERT INTO cognition_configs_new (id, name, provider, provider_config_id, max_cognition_events, generate_expressions, created_at, updated_at, deleted_at)
SELECT
    m.new_id, t.name, t.provider,
    CASE t.provider
        WHEN 'openai' THEN (SELECT new_id FROM _idmap_openai WHERE old_id = t.provider_config_id)
        WHEN 'openrouter' THEN (SELECT new_id FROM _idmap_openrouter WHERE old_id = t.provider_config_id)
        WHEN 'openaicompatible' THEN (SELECT new_id FROM _idmap_openaicompatible WHERE old_id = t.provider_config_id)
        WHEN 'harmonyspeech' THEN (SELECT new_id FROM _idmap_harmonyspeech WHERE old_id = t.provider_config_id)
        WHEN 'elevenlabs' THEN (SELECT new_id FROM _idmap_elevenlabs WHERE old_id = t.provider_config_id)
        WHEN 'kindroid' THEN (SELECT new_id FROM _idmap_kindroid WHERE old_id = t.provider_config_id)
        WHEN 'kajiwoto' THEN (SELECT new_id FROM _idmap_kajiwoto WHERE old_id = t.provider_config_id)
        WHEN 'characterai' THEN (SELECT new_id FROM _idmap_characterai WHERE old_id = t.provider_config_id)
        WHEN 'localai' THEN (SELECT new_id FROM _idmap_localai WHERE old_id = t.provider_config_id)
        WHEN 'mistral' THEN (SELECT new_id FROM _idmap_mistral WHERE old_id = t.provider_config_id)
        WHEN 'ollama' THEN (SELECT new_id FROM _idmap_ollama WHERE old_id = t.provider_config_id)
        WHEN 'comfyui' THEN (SELECT new_id FROM _idmap_comfyui WHERE old_id = t.provider_config_id)
        WHEN 'xai' THEN (SELECT new_id FROM _idmap_xai WHERE old_id = t.provider_config_id)
        WHEN 'google' THEN (SELECT new_id FROM _idmap_google WHERE old_id = t.provider_config_id)
        WHEN 'anthropic' THEN (SELECT new_id FROM _idmap_anthropic WHERE old_id = t.provider_config_id)
    END,
    t.max_cognition_events, t.generate_expressions, t.created_at, t.updated_at, t.deleted_at
FROM cognition_configs t
JOIN _idmap_cognition m ON m.old_id = t.id;

DROP TABLE cognition_configs;
ALTER TABLE cognition_configs_new RENAME TO cognition_configs;

-- ------------------------------------------------------------------
-- 2.3  movement_configs
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _idmap_movement (old_id INTEGER PRIMARY KEY, new_id TEXT NOT NULL);

INSERT INTO _idmap_movement (old_id, new_id)
SELECT id,
       lower(hex(randomblob(4)) || '-' || substr(hex(randomblob(2)),2) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1,1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))
FROM movement_configs;

CREATE TABLE IF NOT EXISTS movement_configs_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL,
    provider_config_id TEXT NOT NULL,
    startup_sync_timeout INTEGER NOT NULL DEFAULT 0,
    execution_threshold REAL NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);

INSERT INTO movement_configs_new (id, name, provider, provider_config_id, startup_sync_timeout, execution_threshold, created_at, updated_at, deleted_at)
SELECT
    m.new_id, t.name, t.provider,
    CASE t.provider
        WHEN 'openai' THEN (SELECT new_id FROM _idmap_openai WHERE old_id = t.provider_config_id)
        WHEN 'openrouter' THEN (SELECT new_id FROM _idmap_openrouter WHERE old_id = t.provider_config_id)
        WHEN 'openaicompatible' THEN (SELECT new_id FROM _idmap_openaicompatible WHERE old_id = t.provider_config_id)
        WHEN 'harmonyspeech' THEN (SELECT new_id FROM _idmap_harmonyspeech WHERE old_id = t.provider_config_id)
        WHEN 'elevenlabs' THEN (SELECT new_id FROM _idmap_elevenlabs WHERE old_id = t.provider_config_id)
        WHEN 'kindroid' THEN (SELECT new_id FROM _idmap_kindroid WHERE old_id = t.provider_config_id)
        WHEN 'kajiwoto' THEN (SELECT new_id FROM _idmap_kajiwoto WHERE old_id = t.provider_config_id)
        WHEN 'characterai' THEN (SELECT new_id FROM _idmap_characterai WHERE old_id = t.provider_config_id)
        WHEN 'localai' THEN (SELECT new_id FROM _idmap_localai WHERE old_id = t.provider_config_id)
        WHEN 'mistral' THEN (SELECT new_id FROM _idmap_mistral WHERE old_id = t.provider_config_id)
        WHEN 'ollama' THEN (SELECT new_id FROM _idmap_ollama WHERE old_id = t.provider_config_id)
        WHEN 'comfyui' THEN (SELECT new_id FROM _idmap_comfyui WHERE old_id = t.provider_config_id)
        WHEN 'xai' THEN (SELECT new_id FROM _idmap_xai WHERE old_id = t.provider_config_id)
        WHEN 'google' THEN (SELECT new_id FROM _idmap_google WHERE old_id = t.provider_config_id)
        WHEN 'anthropic' THEN (SELECT new_id FROM _idmap_anthropic WHERE old_id = t.provider_config_id)
    END,
    t.startup_sync_timeout, t.execution_threshold, t.created_at, t.updated_at, t.deleted_at
FROM movement_configs t
JOIN _idmap_movement m ON m.old_id = t.id;

DROP TABLE movement_configs;
ALTER TABLE movement_configs_new RENAME TO movement_configs;

-- ------------------------------------------------------------------
-- 2.4  rag_configs
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _idmap_rag (old_id INTEGER PRIMARY KEY, new_id TEXT NOT NULL);

INSERT INTO _idmap_rag (old_id, new_id)
SELECT id,
       lower(hex(randomblob(4)) || '-' || substr(hex(randomblob(2)),2) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1,1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))
FROM rag_configs;

CREATE TABLE IF NOT EXISTS rag_configs_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL,
    provider_config_id TEXT NOT NULL,
    embedding_concurrency INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);

INSERT INTO rag_configs_new (id, name, provider, provider_config_id, embedding_concurrency, created_at, updated_at, deleted_at)
SELECT
    m.new_id, t.name, t.provider,
    CASE t.provider
        WHEN 'openai' THEN (SELECT new_id FROM _idmap_openai WHERE old_id = t.provider_config_id)
        WHEN 'openrouter' THEN (SELECT new_id FROM _idmap_openrouter WHERE old_id = t.provider_config_id)
        WHEN 'openaicompatible' THEN (SELECT new_id FROM _idmap_openaicompatible WHERE old_id = t.provider_config_id)
        WHEN 'harmonyspeech' THEN (SELECT new_id FROM _idmap_harmonyspeech WHERE old_id = t.provider_config_id)
        WHEN 'elevenlabs' THEN (SELECT new_id FROM _idmap_elevenlabs WHERE old_id = t.provider_config_id)
        WHEN 'kindroid' THEN (SELECT new_id FROM _idmap_kindroid WHERE old_id = t.provider_config_id)
        WHEN 'kajiwoto' THEN (SELECT new_id FROM _idmap_kajiwoto WHERE old_id = t.provider_config_id)
        WHEN 'characterai' THEN (SELECT new_id FROM _idmap_characterai WHERE old_id = t.provider_config_id)
        WHEN 'localai' THEN (SELECT new_id FROM _idmap_localai WHERE old_id = t.provider_config_id)
        WHEN 'mistral' THEN (SELECT new_id FROM _idmap_mistral WHERE old_id = t.provider_config_id)
        WHEN 'ollama' THEN (SELECT new_id FROM _idmap_ollama WHERE old_id = t.provider_config_id)
        WHEN 'comfyui' THEN (SELECT new_id FROM _idmap_comfyui WHERE old_id = t.provider_config_id)
        WHEN 'xai' THEN (SELECT new_id FROM _idmap_xai WHERE old_id = t.provider_config_id)
        WHEN 'google' THEN (SELECT new_id FROM _idmap_google WHERE old_id = t.provider_config_id)
        WHEN 'anthropic' THEN (SELECT new_id FROM _idmap_anthropic WHERE old_id = t.provider_config_id)
    END,
    t.embedding_concurrency, t.created_at, t.updated_at, t.deleted_at
FROM rag_configs t
JOIN _idmap_rag m ON m.old_id = t.id;

DROP TABLE rag_configs;
ALTER TABLE rag_configs_new RENAME TO rag_configs;

-- ------------------------------------------------------------------
-- 2.5  stt_configs  (special: two provider refs with own provider columns)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _idmap_stt (old_id INTEGER PRIMARY KEY, new_id TEXT NOT NULL);

INSERT INTO _idmap_stt (old_id, new_id)
SELECT id,
       lower(hex(randomblob(4)) || '-' || substr(hex(randomblob(2)),2) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1,1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))
FROM stt_configs;

CREATE TABLE IF NOT EXISTS stt_configs_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    main_stream_time_millis INTEGER NOT NULL DEFAULT 0,
    transition_stream_time_millis INTEGER NOT NULL DEFAULT 0,
    max_buffer_count INTEGER NOT NULL DEFAULT 0,
    transcription_provider TEXT NOT NULL,
    transcription_provider_config_id TEXT NOT NULL,
    vad_provider TEXT NOT NULL,
    vad_provider_config_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);

INSERT INTO stt_configs_new (
    id, name, main_stream_time_millis, transition_stream_time_millis, max_buffer_count,
    transcription_provider, transcription_provider_config_id,
    vad_provider, vad_provider_config_id,
    created_at, updated_at, deleted_at
)
SELECT
    m.new_id, t.name, t.main_stream_time_millis, t.transition_stream_time_millis, t.max_buffer_count,
    t.transcription_provider,
    CASE t.transcription_provider
        WHEN 'openai' THEN (SELECT new_id FROM _idmap_openai WHERE old_id = t.transcription_provider_config_id)
        WHEN 'openrouter' THEN (SELECT new_id FROM _idmap_openrouter WHERE old_id = t.transcription_provider_config_id)
        WHEN 'openaicompatible' THEN (SELECT new_id FROM _idmap_openaicompatible WHERE old_id = t.transcription_provider_config_id)
        WHEN 'harmonyspeech' THEN (SELECT new_id FROM _idmap_harmonyspeech WHERE old_id = t.transcription_provider_config_id)
        WHEN 'elevenlabs' THEN (SELECT new_id FROM _idmap_elevenlabs WHERE old_id = t.transcription_provider_config_id)
        WHEN 'kindroid' THEN (SELECT new_id FROM _idmap_kindroid WHERE old_id = t.transcription_provider_config_id)
        WHEN 'kajiwoto' THEN (SELECT new_id FROM _idmap_kajiwoto WHERE old_id = t.transcription_provider_config_id)
        WHEN 'characterai' THEN (SELECT new_id FROM _idmap_characterai WHERE old_id = t.transcription_provider_config_id)
        WHEN 'localai' THEN (SELECT new_id FROM _idmap_localai WHERE old_id = t.transcription_provider_config_id)
        WHEN 'mistral' THEN (SELECT new_id FROM _idmap_mistral WHERE old_id = t.transcription_provider_config_id)
        WHEN 'ollama' THEN (SELECT new_id FROM _idmap_ollama WHERE old_id = t.transcription_provider_config_id)
        WHEN 'comfyui' THEN (SELECT new_id FROM _idmap_comfyui WHERE old_id = t.transcription_provider_config_id)
        WHEN 'xai' THEN (SELECT new_id FROM _idmap_xai WHERE old_id = t.transcription_provider_config_id)
        WHEN 'google' THEN (SELECT new_id FROM _idmap_google WHERE old_id = t.transcription_provider_config_id)
        WHEN 'anthropic' THEN (SELECT new_id FROM _idmap_anthropic WHERE old_id = t.transcription_provider_config_id)
    END,
    t.vad_provider,
    CASE t.vad_provider
        WHEN 'openai' THEN (SELECT new_id FROM _idmap_openai WHERE old_id = t.vad_provider_config_id)
        WHEN 'openrouter' THEN (SELECT new_id FROM _idmap_openrouter WHERE old_id = t.vad_provider_config_id)
        WHEN 'openaicompatible' THEN (SELECT new_id FROM _idmap_openaicompatible WHERE old_id = t.vad_provider_config_id)
        WHEN 'harmonyspeech' THEN (SELECT new_id FROM _idmap_harmonyspeech WHERE old_id = t.vad_provider_config_id)
        WHEN 'elevenlabs' THEN (SELECT new_id FROM _idmap_elevenlabs WHERE old_id = t.vad_provider_config_id)
        WHEN 'kindroid' THEN (SELECT new_id FROM _idmap_kindroid WHERE old_id = t.vad_provider_config_id)
        WHEN 'kajiwoto' THEN (SELECT new_id FROM _idmap_kajiwoto WHERE old_id = t.vad_provider_config_id)
        WHEN 'characterai' THEN (SELECT new_id FROM _idmap_characterai WHERE old_id = t.vad_provider_config_id)
        WHEN 'localai' THEN (SELECT new_id FROM _idmap_localai WHERE old_id = t.vad_provider_config_id)
        WHEN 'mistral' THEN (SELECT new_id FROM _idmap_mistral WHERE old_id = t.vad_provider_config_id)
        WHEN 'ollama' THEN (SELECT new_id FROM _idmap_ollama WHERE old_id = t.vad_provider_config_id)
        WHEN 'comfyui' THEN (SELECT new_id FROM _idmap_comfyui WHERE old_id = t.vad_provider_config_id)
        WHEN 'xai' THEN (SELECT new_id FROM _idmap_xai WHERE old_id = t.vad_provider_config_id)
        WHEN 'google' THEN (SELECT new_id FROM _idmap_google WHERE old_id = t.vad_provider_config_id)
        WHEN 'anthropic' THEN (SELECT new_id FROM _idmap_anthropic WHERE old_id = t.vad_provider_config_id)
    END,
    t.created_at, t.updated_at, t.deleted_at
FROM stt_configs t
JOIN _idmap_stt m ON m.old_id = t.id;

DROP TABLE stt_configs;
ALTER TABLE stt_configs_new RENAME TO stt_configs;

-- ------------------------------------------------------------------
-- 2.6  tts_configs
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _idmap_tts (old_id INTEGER PRIMARY KEY, new_id TEXT NOT NULL);

INSERT INTO _idmap_tts (old_id, new_id)
SELECT id,
       lower(hex(randomblob(4)) || '-' || substr(hex(randomblob(2)),2) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1,1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))
FROM tts_configs;

CREATE TABLE IF NOT EXISTS tts_configs_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL,
    provider_config_id TEXT NOT NULL,
    output_type TEXT NOT NULL DEFAULT '',
    words_to_replace TEXT NOT NULL DEFAULT '',
    vocalize_nonverbal INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME
);

INSERT INTO tts_configs_new (id, name, provider, provider_config_id, output_type, words_to_replace, vocalize_nonverbal, created_at, updated_at, deleted_at)
SELECT
    m.new_id, t.name, t.provider,
    CASE t.provider
        WHEN 'openai' THEN (SELECT new_id FROM _idmap_openai WHERE old_id = t.provider_config_id)
        WHEN 'openrouter' THEN (SELECT new_id FROM _idmap_openrouter WHERE old_id = t.provider_config_id)
        WHEN 'openaicompatible' THEN (SELECT new_id FROM _idmap_openaicompatible WHERE old_id = t.provider_config_id)
        WHEN 'harmonyspeech' THEN (SELECT new_id FROM _idmap_harmonyspeech WHERE old_id = t.provider_config_id)
        WHEN 'elevenlabs' THEN (SELECT new_id FROM _idmap_elevenlabs WHERE old_id = t.provider_config_id)
        WHEN 'kindroid' THEN (SELECT new_id FROM _idmap_kindroid WHERE old_id = t.provider_config_id)
        WHEN 'kajiwoto' THEN (SELECT new_id FROM _idmap_kajiwoto WHERE old_id = t.provider_config_id)
        WHEN 'characterai' THEN (SELECT new_id FROM _idmap_characterai WHERE old_id = t.provider_config_id)
        WHEN 'localai' THEN (SELECT new_id FROM _idmap_localai WHERE old_id = t.provider_config_id)
        WHEN 'mistral' THEN (SELECT new_id FROM _idmap_mistral WHERE old_id = t.provider_config_id)
        WHEN 'ollama' THEN (SELECT new_id FROM _idmap_ollama WHERE old_id = t.provider_config_id)
        WHEN 'comfyui' THEN (SELECT new_id FROM _idmap_comfyui WHERE old_id = t.provider_config_id)
        WHEN 'xai' THEN (SELECT new_id FROM _idmap_xai WHERE old_id = t.provider_config_id)
        WHEN 'google' THEN (SELECT new_id FROM _idmap_google WHERE old_id = t.provider_config_id)
        WHEN 'anthropic' THEN (SELECT new_id FROM _idmap_anthropic WHERE old_id = t.provider_config_id)
    END,
    t.output_type, t.words_to_replace, t.vocalize_nonverbal, t.created_at, t.updated_at, t.deleted_at
FROM tts_configs t
JOIN _idmap_tts m ON m.old_id = t.id;

DROP TABLE tts_configs;
ALTER TABLE tts_configs_new RENAME TO tts_configs;

-- ------------------------------------------------------------------
-- 2.7  vision_configs
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _idmap_vision (old_id INTEGER PRIMARY KEY, new_id TEXT NOT NULL);

INSERT INTO _idmap_vision (old_id, new_id)
SELECT id,
       lower(hex(randomblob(4)) || '-' || substr(hex(randomblob(2)),2) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1,1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))
FROM vision_configs;

CREATE TABLE IF NOT EXISTS vision_configs_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_config_id TEXT NOT NULL,
    resolution_width INTEGER DEFAULT 640,
    resolution_height INTEGER DEFAULT 480,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);

INSERT INTO vision_configs_new (id, name, provider, provider_config_id, resolution_width, resolution_height, created_at, updated_at, deleted_at)
SELECT
    m.new_id, t.name, t.provider,
    CASE t.provider
        WHEN 'openai' THEN (SELECT new_id FROM _idmap_openai WHERE old_id = t.provider_config_id)
        WHEN 'openrouter' THEN (SELECT new_id FROM _idmap_openrouter WHERE old_id = t.provider_config_id)
        WHEN 'openaicompatible' THEN (SELECT new_id FROM _idmap_openaicompatible WHERE old_id = t.provider_config_id)
        WHEN 'harmonyspeech' THEN (SELECT new_id FROM _idmap_harmonyspeech WHERE old_id = t.provider_config_id)
        WHEN 'elevenlabs' THEN (SELECT new_id FROM _idmap_elevenlabs WHERE old_id = t.provider_config_id)
        WHEN 'kindroid' THEN (SELECT new_id FROM _idmap_kindroid WHERE old_id = t.provider_config_id)
        WHEN 'kajiwoto' THEN (SELECT new_id FROM _idmap_kajiwoto WHERE old_id = t.provider_config_id)
        WHEN 'characterai' THEN (SELECT new_id FROM _idmap_characterai WHERE old_id = t.provider_config_id)
        WHEN 'localai' THEN (SELECT new_id FROM _idmap_localai WHERE old_id = t.provider_config_id)
        WHEN 'mistral' THEN (SELECT new_id FROM _idmap_mistral WHERE old_id = t.provider_config_id)
        WHEN 'ollama' THEN (SELECT new_id FROM _idmap_ollama WHERE old_id = t.provider_config_id)
        WHEN 'comfyui' THEN (SELECT new_id FROM _idmap_comfyui WHERE old_id = t.provider_config_id)
        WHEN 'xai' THEN (SELECT new_id FROM _idmap_xai WHERE old_id = t.provider_config_id)
        WHEN 'google' THEN (SELECT new_id FROM _idmap_google WHERE old_id = t.provider_config_id)
        WHEN 'anthropic' THEN (SELECT new_id FROM _idmap_anthropic WHERE old_id = t.provider_config_id)
    END,
    t.resolution_width, t.resolution_height, t.created_at, t.updated_at, t.deleted_at
FROM vision_configs t
JOIN _idmap_vision m ON m.old_id = t.id;

DROP TABLE vision_configs;
ALTER TABLE vision_configs_new RENAME TO vision_configs;

-- ------------------------------------------------------------------
-- 2.8  imagination_configs
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _idmap_imagination (old_id INTEGER PRIMARY KEY, new_id TEXT NOT NULL);

INSERT INTO _idmap_imagination (old_id, new_id)
SELECT id,
       lower(hex(randomblob(4)) || '-' || substr(hex(randomblob(2)),2) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1,1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))
FROM imagination_configs;

CREATE TABLE IF NOT EXISTS imagination_configs_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_config_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);

INSERT INTO imagination_configs_new (id, name, provider, provider_config_id, created_at, updated_at, deleted_at)
SELECT
    m.new_id, t.name, t.provider,
    CASE t.provider
        WHEN 'openai' THEN (SELECT new_id FROM _idmap_openai WHERE old_id = t.provider_config_id)
        WHEN 'openrouter' THEN (SELECT new_id FROM _idmap_openrouter WHERE old_id = t.provider_config_id)
        WHEN 'openaicompatible' THEN (SELECT new_id FROM _idmap_openaicompatible WHERE old_id = t.provider_config_id)
        WHEN 'harmonyspeech' THEN (SELECT new_id FROM _idmap_harmonyspeech WHERE old_id = t.provider_config_id)
        WHEN 'elevenlabs' THEN (SELECT new_id FROM _idmap_elevenlabs WHERE old_id = t.provider_config_id)
        WHEN 'kindroid' THEN (SELECT new_id FROM _idmap_kindroid WHERE old_id = t.provider_config_id)
        WHEN 'kajiwoto' THEN (SELECT new_id FROM _idmap_kajiwoto WHERE old_id = t.provider_config_id)
        WHEN 'characterai' THEN (SELECT new_id FROM _idmap_characterai WHERE old_id = t.provider_config_id)
        WHEN 'localai' THEN (SELECT new_id FROM _idmap_localai WHERE old_id = t.provider_config_id)
        WHEN 'mistral' THEN (SELECT new_id FROM _idmap_mistral WHERE old_id = t.provider_config_id)
        WHEN 'ollama' THEN (SELECT new_id FROM _idmap_ollama WHERE old_id = t.provider_config_id)
        WHEN 'comfyui' THEN (SELECT new_id FROM _idmap_comfyui WHERE old_id = t.provider_config_id)
        WHEN 'xai' THEN (SELECT new_id FROM _idmap_xai WHERE old_id = t.provider_config_id)
        WHEN 'google' THEN (SELECT new_id FROM _idmap_google WHERE old_id = t.provider_config_id)
        WHEN 'anthropic' THEN (SELECT new_id FROM _idmap_anthropic WHERE old_id = t.provider_config_id)
    END,
    t.created_at, t.updated_at, t.deleted_at
FROM imagination_configs t
JOIN _idmap_imagination m ON m.old_id = t.id;

DROP TABLE imagination_configs;
ALTER TABLE imagination_configs_new RENAME TO imagination_configs;

-- ============================================================================
-- LEVEL 3: entity_module_mappings
-- ============================================================================

CREATE TABLE IF NOT EXISTS entity_module_mappings_new (
    entity_id TEXT PRIMARY KEY,
    backend_config_id TEXT,
    cognition_config_id TEXT,
    imagination_config_id TEXT,
    movement_config_id TEXT,
    rag_config_id TEXT,
    stt_config_id TEXT,
    tts_config_id TEXT,
    vision_config_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP,
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

INSERT INTO entity_module_mappings_new (
    entity_id, backend_config_id, cognition_config_id, imagination_config_id,
    movement_config_id, rag_config_id, stt_config_id, tts_config_id, vision_config_id,
    created_at, updated_at, deleted_at
)
SELECT
    t.entity_id,
    (SELECT new_id FROM _idmap_backend WHERE old_id = t.backend_config_id),
    (SELECT new_id FROM _idmap_cognition WHERE old_id = t.cognition_config_id),
    (SELECT new_id FROM _idmap_imagination WHERE old_id = t.imagination_config_id),
    (SELECT new_id FROM _idmap_movement WHERE old_id = t.movement_config_id),
    (SELECT new_id FROM _idmap_rag WHERE old_id = t.rag_config_id),
    (SELECT new_id FROM _idmap_stt WHERE old_id = t.stt_config_id),
    (SELECT new_id FROM _idmap_tts WHERE old_id = t.tts_config_id),
    (SELECT new_id FROM _idmap_vision WHERE old_id = t.vision_config_id),
    t.created_at, t.updated_at, t.deleted_at
FROM entity_module_mappings t;

DROP TABLE entity_module_mappings;
ALTER TABLE entity_module_mappings_new RENAME TO entity_module_mappings;

-- ============================================================================
-- LEVEL 4: character_profiles.vision_config_id
-- ============================================================================

CREATE TABLE IF NOT EXISTS character_profiles_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    personality TEXT NOT NULL DEFAULT '',
    appearance TEXT NOT NULL DEFAULT '',
    backstory TEXT NOT NULL DEFAULT '',
    voice_characteristics TEXT NOT NULL DEFAULT '',
    base_prompt TEXT DEFAULT '',
    scenario TEXT DEFAULT '',
    example_dialogues TEXT DEFAULT '',
    typing_speed_wpm INTEGER DEFAULT 60,
    audio_response_chance_percent INTEGER DEFAULT 50,
    vision_config_id TEXT REFERENCES vision_configs(id) ON DELETE SET NULL,
    lifecycle_config TEXT NOT NULL DEFAULT '{}',
    deleted_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO character_profiles_new (
    id, name, description, personality, appearance, backstory,
    voice_characteristics, base_prompt, scenario, example_dialogues,
    typing_speed_wpm, audio_response_chance_percent, vision_config_id,
    lifecycle_config, deleted_at, created_at, updated_at
)
SELECT
    t.id, t.name, t.description, t.personality, t.appearance, t.backstory,
    t.voice_characteristics, t.base_prompt, t.scenario, t.example_dialogues,
    t.typing_speed_wpm, t.audio_response_chance_percent,
    (SELECT new_id FROM _idmap_vision WHERE old_id = t.vision_config_id),
    t.lifecycle_config, t.deleted_at, t.created_at, t.updated_at
FROM character_profiles t;

DROP TABLE character_profiles;
ALTER TABLE character_profiles_new RENAME TO character_profiles;

-- ============================================================================
-- CLEANUP: Drop temporary _idmap tables and recreate indexes
-- ============================================================================

DROP TABLE IF EXISTS _idmap_openai;
DROP TABLE IF EXISTS _idmap_openrouter;
DROP TABLE IF EXISTS _idmap_openaicompatible;
DROP TABLE IF EXISTS _idmap_harmonyspeech;
DROP TABLE IF EXISTS _idmap_elevenlabs;
DROP TABLE IF EXISTS _idmap_kindroid;
DROP TABLE IF EXISTS _idmap_kajiwoto;
DROP TABLE IF EXISTS _idmap_characterai;
DROP TABLE IF EXISTS _idmap_localai;
DROP TABLE IF EXISTS _idmap_mistral;
DROP TABLE IF EXISTS _idmap_ollama;
DROP TABLE IF EXISTS _idmap_comfyui;
DROP TABLE IF EXISTS _idmap_xai;
DROP TABLE IF EXISTS _idmap_google;
DROP TABLE IF EXISTS _idmap_anthropic;
DROP TABLE IF EXISTS _idmap_backend;
DROP TABLE IF EXISTS _idmap_cognition;
DROP TABLE IF EXISTS _idmap_movement;
DROP TABLE IF EXISTS _idmap_rag;
DROP TABLE IF EXISTS _idmap_stt;
DROP TABLE IF EXISTS _idmap_tts;
DROP TABLE IF EXISTS _idmap_vision;
DROP TABLE IF EXISTS _idmap_imagination;

-- Recreate indexes (the _new-table pattern does not preserve indexes)
CREATE INDEX IF NOT EXISTS idx_provider_config_xai_name ON provider_config_xai(name);
CREATE INDEX IF NOT EXISTS idx_provider_config_google_name ON provider_config_google(name);
CREATE INDEX IF NOT EXISTS idx_provider_config_anthropic_name ON provider_config_anthropic(name);
`;
