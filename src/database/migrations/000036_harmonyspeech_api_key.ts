export const migration036 = `
-- Add api_key column to provider_config_harmonyspeech
-- Optional user-supplied API key for self-hosted Harmony Speech Engine instances.
-- Mirrors engine migration 000036 (schema parity contract for bidirectional sync).
ALTER TABLE provider_config_harmonyspeech ADD COLUMN api_key TEXT NOT NULL DEFAULT '';
`;
