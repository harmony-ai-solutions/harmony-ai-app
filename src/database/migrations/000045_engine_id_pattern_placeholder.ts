export const migration045 = `
-- PLACEHOLDER — no-op migration (D85 format: comment-only SQL template string).
--
-- Engine migration 000045 (harmony-link-private, phase 3-1) performs the
-- entity id-pattern migration (legacy ids -> D2 timestamped ids). The app
-- does NOT mirror it: convergence is engine-authoritative (D11) — this app
-- release wipes its local database once (phase 3-2 boot-window wipe) and
-- re-syncs from the already-migrated engine, receiving migrated ids verbatim.
-- No local data migration is required.
--
-- This placeholder keeps the app migration NUMBER aligned with the engine's
-- (app 000045 == engine 000045). The runner strips SQL comments, leaving zero
-- executable statements; version 45 is still recorded in schema_migrations.
`;