/**
 * Migration 021: Add sampling preset and extra params to provider configs
 *
 * Adds sampling_preset_name and extra_params (JSON) columns to OpenAI, OpenAI Compatible,
 * and OpenRouter provider configs. Drops the deprecated chat_template_kwargs column.
 * Mirrors Harmony Link migration 021.
 */

export const migration021 = `
-- Add sampling preset reference and extended params to OpenAI provider config
-- Columns are nullable (NOT NULL + DEFAULT triggers false SQLITE_OK error
-- on some Android SQLite builds via react-native-sqlite-storage).
ALTER TABLE provider_config_openai ADD COLUMN sampling_preset_name TEXT DEFAULT '';
ALTER TABLE provider_config_openai ADD COLUMN extra_params TEXT DEFAULT '{}';

-- Add sampling preset reference and extended params to OpenAI Compatible provider config
ALTER TABLE provider_config_openaicompatible ADD COLUMN sampling_preset_name TEXT DEFAULT '';
ALTER TABLE provider_config_openaicompatible ADD COLUMN extra_params TEXT DEFAULT '{}';

-- Add sampling preset reference and extended params to OpenRouter provider config
ALTER TABLE provider_config_openrouter ADD COLUMN sampling_preset_name TEXT DEFAULT '';
ALTER TABLE provider_config_openrouter ADD COLUMN extra_params TEXT DEFAULT '{}';

-- chat_template_kwargs column was never present in the app's initial schema
-- (only existed in Harmony Link backend). Skipping DROP.
-- DROP COLUMN requires SQLite 3.35.0+ which many Android devices lack.
`;