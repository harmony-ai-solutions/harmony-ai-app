export const migration040 = `
-- Bring lifecycle_state into the sync watermark contract.
-- Mirrors engine migration 000040 (harmony-link-private) exactly.
--
-- lifecycle_state (000038) was engine-internal: INTEGER unix-second updated_at,
-- no created_at, no deleted_at -- structurally incompatible with the shared
-- "changed since watermark" predicate (strftime over TEXT timestamps + 3-column
-- created/updated/deleted compare) every syncable table uses. This rebuild adds
-- the watermark columns so lifecycle state syncs app <-> engine like emotion_state
-- (same entity_id-PK shape).
--
-- Column-type changes need the established _new-table rebuild (SQLite cannot
-- ALTER COLUMN TYPE; DROP COLUMN is forbidden by the migration SQL guard). FKs
-- are disabled for the migration session, so the rebuild's DROP TABLE does not
-- fire FK cascades; nothing references lifecycle_state.
--
-- Data conversion: unix-second updated_at -> TEXT timestamp via
-- datetime(updated_at, 'unixepoch') (UTC). created_at is unknown for existing
-- rows -- the last write time is the closest proxy. deleted_at starts NULL.

CREATE TABLE lifecycle_state_new (
    entity_id         TEXT PRIMARY KEY REFERENCES entities(id),
    exhaustion        REAL NOT NULL DEFAULT 0,
    sleeping          BOOLEAN NOT NULL DEFAULT false,
    sleep_start_time  INTEGER,     -- unix seconds, nullable
    last_beat_at      INTEGER,     -- unix seconds, nullable
    last_outreach_at  INTEGER,     -- unix seconds, nullable (N1-A: outreach cooldown persistence)
    inner_monologue   TEXT NOT NULL DEFAULT '[]', -- JSON array of last-N entries (D-BEH-01)
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at        TIMESTAMP
);

INSERT INTO lifecycle_state_new (
    entity_id, exhaustion, sleeping, sleep_start_time, last_beat_at,
    last_outreach_at, inner_monologue, created_at, updated_at, deleted_at
)
SELECT
    entity_id, exhaustion, sleeping, sleep_start_time, last_beat_at,
    last_outreach_at, inner_monologue,
    datetime(updated_at, 'unixepoch'),
    datetime(updated_at, 'unixepoch'),
    NULL
FROM lifecycle_state;

DROP TABLE lifecycle_state;
ALTER TABLE lifecycle_state_new RENAME TO lifecycle_state;
`;
