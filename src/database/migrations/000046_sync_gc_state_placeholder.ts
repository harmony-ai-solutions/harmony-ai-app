export const migration046 = `
-- PLACEHOLDER — no-op migration (D85 format: comment-only SQL template string).
--
-- Engine migration 000046 (harmony-link-private, phase 1-2) adds the
-- engine-local \`sync_gc_state\` table carrying the tombstone-GC purge floor
-- (max_purged_deleted_at, D76). The app needs no schema change: the floor is
-- engine-internal — a lagging device is detected at SYNC_REQUEST and reacts
-- via the phase 3-2 one-time wipe flag (phase 4-5 rebuild reaction), not via
-- any local table.
--
-- SHIPPED WITH PHASE 3-2 on behalf of phase 4-1 (D73) per orchestrator
-- instruction — the app-local GC keep-and-align phase consumes the number.
-- This placeholder keeps the app migration NUMBER aligned with the engine's
-- (app 000046 == engine 000046). The runner strips SQL comments, leaving zero
-- executable statements; version 46 is still recorded in schema_migrations.
`;