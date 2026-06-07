/**
 * Migration 020: Add LLM provider configuration parameters
 *
 * Adds new LLM API parameters to OpenAI, OpenAI Compatible, and OpenRouter provider configs.
 * Mirrors Harmony Link migration 000020.
 */

export const migration020 = `
-- Add new LLM API parameters to OpenAI provider config
ALTER TABLE provider_config_openai ADD COLUMN frequency_penalty REAL NOT NULL DEFAULT 0;
ALTER TABLE provider_config_openai ADD COLUMN presence_penalty REAL NOT NULL DEFAULT 0;
ALTER TABLE provider_config_openai ADD COLUMN max_completion_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_config_openai ADD COLUMN seed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_config_openai ADD COLUMN response_format TEXT NOT NULL DEFAULT '';
ALTER TABLE provider_config_openai ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT '';
ALTER TABLE provider_config_openai ADD COLUMN top_k INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_config_openai ADD COLUMN top_a REAL NOT NULL DEFAULT 0;
ALTER TABLE provider_config_openai ADD COLUMN min_p REAL NOT NULL DEFAULT 0;
ALTER TABLE provider_config_openai ADD COLUMN repetition_penalty REAL NOT NULL DEFAULT 0;
ALTER TABLE provider_config_openai ADD COLUMN chat_template_kwargs TEXT NOT NULL DEFAULT '';

-- Add new LLM API parameters to OpenAI Compatible provider config
ALTER TABLE provider_config_openaicompatible ADD COLUMN frequency_penalty REAL NOT NULL DEFAULT 0;
ALTER TABLE provider_config_openaicompatible ADD COLUMN presence_penalty REAL NOT NULL DEFAULT 0;
ALTER TABLE provider_config_openaicompatible ADD COLUMN max_completion_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_config_openaicompatible ADD COLUMN seed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_config_openaicompatible ADD COLUMN response_format TEXT NOT NULL DEFAULT '';
ALTER TABLE provider_config_openaicompatible ADD COLUMN chat_template_kwargs TEXT NOT NULL DEFAULT '';
ALTER TABLE provider_config_openaicompatible ADD COLUMN top_k INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_config_openaicompatible ADD COLUMN top_a REAL NOT NULL DEFAULT 0;
ALTER TABLE provider_config_openaicompatible ADD COLUMN min_p REAL NOT NULL DEFAULT 0;
ALTER TABLE provider_config_openaicompatible ADD COLUMN repetition_penalty REAL NOT NULL DEFAULT 0;

-- Add new LLM API parameters to OpenRouter provider config
ALTER TABLE provider_config_openrouter ADD COLUMN frequency_penalty REAL NOT NULL DEFAULT 0;
ALTER TABLE provider_config_openrouter ADD COLUMN presence_penalty REAL NOT NULL DEFAULT 0;
ALTER TABLE provider_config_openrouter ADD COLUMN max_completion_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_config_openrouter ADD COLUMN seed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_config_openrouter ADD COLUMN response_format TEXT NOT NULL DEFAULT '';
ALTER TABLE provider_config_openrouter ADD COLUMN top_k INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_config_openrouter ADD COLUMN top_a REAL NOT NULL DEFAULT 0;
ALTER TABLE provider_config_openrouter ADD COLUMN min_p REAL NOT NULL DEFAULT 0;
ALTER TABLE provider_config_openrouter ADD COLUMN repetition_penalty REAL NOT NULL DEFAULT 0;
ALTER TABLE provider_config_openrouter ADD COLUMN chat_template_kwargs TEXT NOT NULL DEFAULT '';
`;
