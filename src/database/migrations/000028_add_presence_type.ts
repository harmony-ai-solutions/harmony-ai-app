export const migration028 = `
-- Add presence_type column to interactions table
ALTER TABLE interactions ADD COLUMN presence_type TEXT NOT NULL DEFAULT 'unknown';

-- Backfill existing interactions to 'phone' (all existing are phone-originated)
UPDATE interactions SET presence_type = 'phone' WHERE presence_type = 'unknown';
`;
