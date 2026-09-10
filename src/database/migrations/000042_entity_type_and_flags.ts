/**
 * Migration 000042: entity_type + is_muted + is_disabled (paired with engine 000042)
 *
 * App side is a full `_new`-table REBUILD (§9-A9), NOT ALTERs (the migration
 * guard bans DROP COLUMN; and a clean rebuild is the only way to reconcile the
 * last pre-existing `entities` drift — the engine's `alias TEXT NOT NULL
 * DEFAULT ''`). The canonical text matches the engine's post-ALTER stored text
 * EXACTLY after comment + quote normalization (§9-A8/A13):
 *
 *   - `alias TEXT NOT NULL DEFAULT ''` (dormant — both repos' CreateEntity
 *     INSERTs always supply alias)
 *   - the three new columns after `rag_reindex_required`:
 *       entity_type TEXT NOT NULL DEFAULT 'ai'
 *       is_muted    INTEGER NOT NULL DEFAULT 0
 *       is_disabled INTEGER NOT NULL DEFAULT 0
 *   - the existing trailing FK clause preserved
 *
 * Backfill: `UPDATE entities SET entity_type = 'user' WHERE
 * character_profile_id IS NULL` (Q9 — covers the engine-seeded `user`, dev
 * persona shim rows, and any profile-less rows). No SQL CHECK constraint (Q9 —
 * enums validated in Go/TS code only).
 *
 * PRAGMA foreign_keys: emotion_state / entity_emoji_actions / interactions
 * FK-reference `entities`, so like 000037 the migration session disables FKs
 * for the rebuild (dropping the referenced table would otherwise fire FK
 * cascades).
 */
export const migration042 = `
PRAGMA foreign_keys = OFF;

CREATE TABLE entities_new (
    id TEXT PRIMARY KEY,
    character_profile_id TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME,
    lifecycle_config TEXT NOT NULL DEFAULT '{}',
    alias TEXT NOT NULL DEFAULT '',
    rag_reindex_required INTEGER NOT NULL DEFAULT 1,
    entity_type TEXT NOT NULL DEFAULT 'ai',
    is_muted INTEGER NOT NULL DEFAULT 0,
    is_disabled INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (character_profile_id) REFERENCES character_profiles(id) ON DELETE RESTRICT
);

INSERT INTO entities_new (
    id, character_profile_id, created_at, updated_at, deleted_at,
    lifecycle_config, alias, rag_reindex_required
)
SELECT
    id, character_profile_id, created_at, updated_at, deleted_at,
    lifecycle_config, alias, rag_reindex_required
FROM entities;

-- Q9 backfill: profile-less entities are user identities.
UPDATE entities_new SET entity_type = 'user' WHERE character_profile_id IS NULL;

DROP TABLE entities;
ALTER TABLE entities_new RENAME TO entities;

-- The rebuild dropped the partial unique index; re-create it exactly as
-- migration 000018 defined it.
CREATE UNIQUE INDEX idx_entities_alias_unique ON entities (alias) WHERE alias IS NOT NULL AND alias != '' AND deleted_at IS NULL;

PRAGMA foreign_keys = ON;
`;
