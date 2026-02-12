/**
 * Migration 000009: Add character chat behavior fields
 * Adds typing_speed_wpm and audio_response_chance_percent to character_profiles
 */

export const migration009 = `
-- Add chat behavior fields to character_profiles
ALTER TABLE character_profiles ADD COLUMN typing_speed_wpm INTEGER DEFAULT 60;
ALTER TABLE character_profiles ADD COLUMN audio_response_chance_percent INTEGER DEFAULT 50;
`;
