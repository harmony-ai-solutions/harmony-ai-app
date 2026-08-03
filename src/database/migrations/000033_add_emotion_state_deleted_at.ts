export const migration033 = `-- Add missing deleted_at column to emotion_state for soft-delete sync support
ALTER TABLE emotion_state ADD COLUMN deleted_at TEXT DEFAULT NULL;
`;
