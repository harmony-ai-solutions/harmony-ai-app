/**
 * Migration 000004: Add Cognition Generate Expressions
 */

export const migration004 = `
-- Add generate_expressions flag to cognition_configs
ALTER TABLE cognition_configs ADD COLUMN generate_expressions INTEGER DEFAULT 1;
ALTER TABLE cognition_configs ADD COLUMN max_cognition_events INTEGER DEFAULT 20;
`;
