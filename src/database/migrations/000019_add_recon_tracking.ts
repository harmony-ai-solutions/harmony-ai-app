export const migration019 = `
-- Add recon follow-up and edit tracking to conversation_messages
ALTER TABLE conversation_messages ADD COLUMN is_recon_followup INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversation_messages ADD COLUMN is_edited INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversation_messages ADD COLUMN edit_of_message_id TEXT;
`;
