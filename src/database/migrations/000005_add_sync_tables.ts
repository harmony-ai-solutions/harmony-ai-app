export const migration005 = `
-- 1.1 Sync Devices Table
CREATE TABLE IF NOT EXISTS sync_devices (
  device_id TEXT PRIMARY KEY,
  device_name TEXT NOT NULL,
  device_type TEXT NOT NULL,        -- 'harmony_link' | 'harmony_app'
  device_platform TEXT,              -- 'windows' | 'android' | 'linux' | 'macos'
  is_approved INTEGER DEFAULT 0,     -- 0 = pending, 1 = approved, 2 = rejected
  approval_requested_at DATETIME,    -- When device first requested access
  approved_by_user_at DATETIME,      -- When user approved in UI
  last_sync_timestamp INTEGER NOT NULL DEFAULT 0, -- Unix timestamp (UTC)
  last_sync_initiated_by TEXT NOT NULL DEFAULT 'local', -- 'local' | 'remote'
  jwt_token TEXT,                    -- Current JWT token for this device
  jwt_expires_at INTEGER,            -- Token expiration timestamp
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME                -- Soft delete support
);

-- 1.2 Sync History Table
CREATE TABLE IF NOT EXISTS sync_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  sync_started_at DATETIME NOT NULL,
  sync_completed_at DATETIME,
  records_sent INTEGER DEFAULT 0,
  records_received INTEGER DEFAULT 0,
  sync_status TEXT NOT NULL,         -- 'in_progress' | 'completed' | 'failed'
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME,               -- Soft delete support
  FOREIGN KEY (device_id) REFERENCES sync_devices(device_id)
);

-- 1.3 Chat Messages Table
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,               -- UUID
  entity_id TEXT NOT NULL,           -- Reference to the entity this message belongs to
  sender_entity_id TEXT NOT NULL,    -- Entity ID of sender
  session_id TEXT,                   -- Optional: group messages by session
  content TEXT NOT NULL,
  audio_file TEXT,                   -- Path or data URL for audio messages
  audio_duration REAL,               -- Duration in seconds
  message_type TEXT NOT NULL,        -- 'text' | 'audio' | 'combined'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME,               -- Soft delete support
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (sender_entity_id) REFERENCES entities(id)
);

-- 1.4 Add deleted_at to ALL Existing Tables
  ALTER TABLE character_profiles ADD COLUMN deleted_at DATETIME;
  ALTER TABLE character_image ADD COLUMN deleted_at DATETIME;
  ALTER TABLE entities ADD COLUMN deleted_at DATETIME;
ALTER TABLE entity_module_mappings ADD COLUMN deleted_at DATETIME;

  -- Provider config tables
  ALTER TABLE provider_config_openai ADD COLUMN deleted_at DATETIME;
  ALTER TABLE provider_config_ollama ADD COLUMN deleted_at DATETIME;
  ALTER TABLE provider_config_characterai ADD COLUMN deleted_at DATETIME;
  ALTER TABLE provider_config_elevenlabs ADD COLUMN deleted_at DATETIME;
  ALTER TABLE provider_config_harmonyspeech ADD COLUMN deleted_at DATETIME;
  ALTER TABLE provider_config_kajiwoto ADD COLUMN deleted_at DATETIME;
  ALTER TABLE provider_config_kindroid ADD COLUMN deleted_at DATETIME;
  ALTER TABLE provider_config_localai ADD COLUMN deleted_at DATETIME;
  ALTER TABLE provider_config_mistral ADD COLUMN deleted_at DATETIME;
  ALTER TABLE provider_config_openaicompatible ADD COLUMN deleted_at DATETIME;
  ALTER TABLE provider_config_openrouter ADD COLUMN deleted_at DATETIME;

  -- Module config tables
  ALTER TABLE backend_configs ADD COLUMN deleted_at DATETIME;
  ALTER TABLE cognition_configs ADD COLUMN deleted_at DATETIME;
  ALTER TABLE movement_configs ADD COLUMN deleted_at DATETIME;
  ALTER TABLE rag_configs ADD COLUMN deleted_at DATETIME;
  ALTER TABLE stt_configs ADD COLUMN deleted_at DATETIME;
  ALTER TABLE tts_configs ADD COLUMN deleted_at DATETIME;
`;
