export const migration029 = `
-- Add rag_reindex_required flag to entities table.
-- When set to 1, triggers a one-time re-index of the entity's vector store data.
-- Default is 1 so all existing entities trigger a re-index on upgrade.
ALTER TABLE entities ADD COLUMN rag_reindex_required INTEGER NOT NULL DEFAULT 1;
`;
