export const migration032 = `
CREATE TABLE IF NOT EXISTS provider_config_soulbitscloud (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL DEFAULT 'https://api.soulbits.app',
  api_key TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  max_tokens INTEGER NOT NULL DEFAULT 0,
  max_completion_tokens INTEGER NOT NULL DEFAULT 0,
  temperature REAL NOT NULL DEFAULT 0,
  top_p REAL NOT NULL DEFAULT 0,
  frequency_penalty REAL NOT NULL DEFAULT 0,
  presence_penalty REAL NOT NULL DEFAULT 0,
  n INTEGER NOT NULL DEFAULT 0,
  stop_tokens TEXT NOT NULL DEFAULT '[]',
  seed INTEGER,
  response_format TEXT NOT NULL DEFAULT '',
  sampling_preset_name TEXT NOT NULL DEFAULT '',
  extra_params TEXT NOT NULL DEFAULT '{}',
  voice TEXT NOT NULL DEFAULT '',
  speed REAL NOT NULL DEFAULT 1.0,
  format TEXT NOT NULL DEFAULT 'mp3',
  image_aspect_ratio TEXT NOT NULL DEFAULT '1:1',
  image_size TEXT NOT NULL DEFAULT '1k',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_provider_config_soulbitscloud_name ON provider_config_soulbitscloud(name);
`;
