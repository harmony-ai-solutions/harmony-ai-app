export const migration038 = `
-- Create the lifecycle_state table (per-entity ephemeral lifecycle state).
-- Mirrors engine migration 000038 (harmony-link-private) verbatim as step 1 of
-- the lifecycle sync propagation: engine migration 000040 (mirrored here as app
-- migration 000040) then brings the table into the sync watermark contract
-- (created_at/deleted_at + TEXT updated_at), exactly as on the engine.
--
-- The app has no writer for this table yet; rows arrive via the sync pipeline
-- (engine beat persists) and will eventually feed a lifecycle status UI +
-- standalone app operation.

CREATE TABLE IF NOT EXISTS lifecycle_state (
    entity_id         TEXT PRIMARY KEY REFERENCES entities(id),
    exhaustion        REAL NOT NULL DEFAULT 0,
    sleeping          BOOLEAN NOT NULL DEFAULT false,
    sleep_start_time  INTEGER,     -- unix seconds, nullable
    last_beat_at      INTEGER,     -- unix seconds, nullable
    last_outreach_at  INTEGER,     -- unix seconds, nullable (N1-A: outreach cooldown persistence)
    inner_monologue   TEXT NOT NULL DEFAULT '[]', -- JSON array of last-N entries (D-BEH-01)
    updated_at        INTEGER NOT NULL
);
`;
