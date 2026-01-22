export const migration006 = `
-- Migration: Fix sync_devices table to use autoincrement ID
-- This fixes the issue where device_id as PRIMARY KEY causes collisions when devices re-authenticate

-- Create new table with correct schema
CREATE TABLE IF NOT EXISTS sync_devices_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
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
  deleted_at DATETIME,               -- Soft delete support
  UNIQUE(device_id, deleted_at)      -- Allow same device_id if previous is soft-deleted
);

-- Copy existing data if any
INSERT INTO sync_devices_new (device_id, device_name, device_type, device_platform, is_approved,
                               approval_requested_at, approved_by_user_at, last_sync_timestamp,
                               last_sync_initiated_by, jwt_token, jwt_expires_at, created_at,
                               updated_at, deleted_at)
SELECT device_id, device_name, device_type, device_platform, is_approved,
       approval_requested_at, approved_by_user_at, last_sync_timestamp,
       last_sync_initiated_by, jwt_token, jwt_expires_at, created_at,
       updated_at, deleted_at
FROM sync_devices
WHERE EXISTS (SELECT 1 FROM sync_devices LIMIT 1);

-- Drop old table
DROP TABLE sync_devices;

-- Rename new table
ALTER TABLE sync_devices_new TO sync_devices;

-- Recreate sync_history table (no changes, but recreate for consistency)
CREATE TABLE IF NOT EXISTS sync_history_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  sync_started_at DATETIME NOT NULL,
  sync_completed_at DATETIME,
  records_sent INTEGER DEFAULT 0,
  records_received INTEGER DEFAULT 0,
  sync_status TEXT NOT NULL,         -- 'in_progress' | 'completed' | 'failed'
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME                -- Soft delete support
);

-- Copy existing sync history data if any
INSERT INTO sync_history_new (device_id, sync_started_at, sync_completed_at, records_sent,
                               records_received, sync_status, error_message, created_at,
                               deleted_at)
SELECT device_id, sync_started_at, sync_completed_at, records_sent,
       records_received, sync_status, error_message, created_at,
       deleted_at
FROM sync_history
WHERE EXISTS (SELECT 1 FROM sync_history LIMIT 1);

-- Drop old sync_history table
DROP TABLE sync_history;

-- Rename new table
ALTER TABLE sync_history_new TO sync_history;
`;
