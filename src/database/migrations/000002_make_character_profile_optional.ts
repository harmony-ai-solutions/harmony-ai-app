/**
 * Migration 000002: Make character_profile_id Optional
 */

export const migration002 = `
-- Migration to make character_profile_id nullable in entities table
-- This allows backend providers to handle character profiles on their end

-- SQLite doesn't support direct foreign key manipulation, so we need to:
-- 1. Create a new table with the desired schema
-- 2. Copy data from the old table
-- 3. Drop the old table
-- 4. Rename the new table

-- Step 1: Create a temporary table with the new schema (nullable character_profile_id)
CREATE TABLE entities_new (
    id TEXT PRIMARY KEY,
    character_profile_id TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (character_profile_id) REFERENCES character_profiles(id) ON DELETE RESTRICT
);

-- Step 2: Copy data from the old table to the new table
INSERT INTO entities_new (id, character_profile_id, created_at, updated_at)
SELECT id, character_profile_id, created_at, updated_at FROM entities;

-- Step 3: Drop the old table
DROP TABLE entities;

-- Step 4: Rename the new table to the original name
ALTER TABLE entities_new RENAME TO entities;
`;
