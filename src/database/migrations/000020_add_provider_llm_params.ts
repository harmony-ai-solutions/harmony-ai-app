/**
 * Migration 020: Add LLM provider configuration parameters
 *
 * Adds new LLM API parameters to OpenAI, OpenAI Compatible, and OpenRouter provider configs.
 * Mirrors Harmony Link migration 000020.
 */

export const migration020 = `
-- Add new LLM API parameters to OpenAI provider config
ALTER TABLE provider_config_openai ADD COLUMN frequency_penalty REAL DEFAULT 0;
ALTER TABLE provider_config_openai ADD COLUMN presence_penalty REAL DEFAULT 0;
ALTER TABLE provider_config_openai ADD COLUMN max_completion_tokens INTEGER;
ALTER TABLE provider_config_openai ADD COLUMN seed INTEGER;
ALTER TABLE provider_config_openai ADD COLUMN response_format TEXT;
ALTER TABLE provider_config_openai ADD COLUMN reasoning_effort TEXT;

-- Add new LLM API parameters to OpenAI Compatible provider config
ALTER TABLE provider_config_openaicompatible ADD COLUMN frequency_penalty REAL DEFAULT 0;
ALTER TABLE provider_config_openaicompatible ADD COLUMN presence_penalty REAL DEFAULT 0;
ALTER TABLE provider_config_openaicompatible ADD COLUMN max_completion_tokens INTEGER;
ALTER TABLE provider_config_openaicompatible ADD COLUMN seed INTEGER;
ALTER TABLE provider_config_openaicompatible ADD COLUMN response_format TEXT;
ALTER TABLE provider_config_openaicompatible ADD COLUMN chat_template_kwargs TEXT;

-- Add new LLM API parameters to OpenRouter provider config
ALTER TABLE provider_config_openrouter ADD COLUMN frequency_penalty REAL DEFAULT 0;
ALTER TABLE provider_config_openrouter ADD COLUMN presence_penalty REAL DEFAULT 0;
ALTER TABLE provider_config_openrouter ADD COLUMN max_completion_tokens INTEGER;
ALTER TABLE provider_config_openrouter ADD COLUMN seed INTEGER;
ALTER TABLE provider_config_openrouter ADD COLUMN response_format TEXT;
ALTER TABLE provider_config_openrouter ADD COLUMN top_k INTEGER;
ALTER TABLE provider_config_openrouter ADD COLUMN top_a REAL DEFAULT 0;
ALTER TABLE provider_config_openrouter ADD COLUMN min_p REAL DEFAULT 0;
ALTER TABLE provider_config_openrouter ADD COLUMN repetition_penalty REAL DEFAULT 0;
ALTER TABLE provider_config_openrouter ADD COLUMN chat_template_kwargs TEXT;
`;