/**
 * Migration 021: Add sampling preset and extra params to provider configs
 *
 * Adds sampling_preset_name and extra_params (JSON) columns to OpenAI, OpenAI Compatible,
 * and OpenRouter provider configs. Drops the deprecated chat_template_kwargs column.
 * Mirrors Harmony Link migration 021.
 */

export const migration021 = `
-- Add sampling preset reference and extended params to OpenAI provider config
ALTER TABLE provider_config_openai ADD COLUMN sampling_preset_name TEXT NOT NULL DEFAULT '';
ALTER TABLE provider_config_openai ADD COLUMN extra_params TEXT NOT NULL DEFAULT '{}';

-- Add sampling preset reference and extended params to OpenAI Compatible provider config
ALTER TABLE provider_config_openaicompatible ADD COLUMN sampling_preset_name TEXT NOT NULL DEFAULT '';
ALTER TABLE provider_config_openaicompatible ADD COLUMN extra_params TEXT NOT NULL DEFAULT '{}';

-- Add sampling preset reference and extended params to OpenRouter provider config
ALTER TABLE provider_config_openrouter ADD COLUMN sampling_preset_name TEXT NOT NULL DEFAULT '';
ALTER TABLE provider_config_openrouter ADD COLUMN extra_params TEXT NOT NULL DEFAULT '{}';

-- Drop deprecated chat_template_kwargs column (replaced by extra_params)
-- FIXME: Properly handle drop columns here in a later migration, since SQLite does NOT support this pattern
-- ALTER TABLE provider_config_openai DROP COLUMN chat_template_kwargs;
-- ALTER TABLE provider_config_openaicompatible DROP COLUMN chat_template_kwargs;
-- ALTER TABLE provider_config_openrouter DROP COLUMN chat_template_kwargs;
`;