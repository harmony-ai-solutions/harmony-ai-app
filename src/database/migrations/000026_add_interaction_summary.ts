export const migration026 = `
-- Add summary column to interactions table
ALTER TABLE interactions ADD COLUMN summary TEXT DEFAULT '';
`;
