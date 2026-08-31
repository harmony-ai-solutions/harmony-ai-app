# 1-3 — Paired Migration 000042: entity_type + is_muted + is_disabled

> Phase 1 / repo: **BOTH** (app `senju-design-updates-rebase` + engine `feat/engine-track-phase2`).
> Contract: `21-Engine-Contract-Persona-Enums.md` §3.4, Q8/Q9/Q15.

## Objective

Same-numbered migration on both sides adding the entity flags. **Engine = ALTERs (below); app = full
`_new`-table REBUILD (§9-A9) whose canonical text adopts the engine's `alias TEXT NOT NULL DEFAULT ''` AND
carries the three new columns** — reconciling the last pre-existing `entities` drift. Both sides end with the
same final column set/order and the same backfill:

```sql
-- ENGINE side (app uses a rebuild — see below)
ALTER TABLE entities ADD COLUMN entity_type TEXT NOT NULL DEFAULT 'ai';
ALTER TABLE entities ADD COLUMN is_muted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entities ADD COLUMN is_disabled INTEGER NOT NULL DEFAULT 0;
UPDATE entities SET entity_type = 'user' WHERE character_profile_id IS NULL;
```

- Pattern precedent (engine): `000028_add_interaction_presence_type` (add-with-DEFAULT + backfill UPDATE).
- **No SQL CHECK constraint** (Q9 — enums validated in Go/TS code only; zero repo precedent).
- **APP side (§9-A9): rebuild, not ALTERs** — write ONE clean `CREATE TABLE "entities" (…)` with the engine's
  canonical text: `alias TEXT NOT NULL DEFAULT ''` (dormant — both repos' `CreateEntity` INSERTs always supply
  alias), the three new columns after `rag_reindex_required`, and the existing trailing
  `FOREIGN KEY (character_profile_id) REFERENCES character_profiles(id) ON DELETE RESTRICT` clause. Wrap in
  `PRAGMA foreign_keys = OFF/ON` (000037 pattern) — `emotion_state`/`entity_emoji_actions` FK-reference
  `entities`. **Verify the engine's actual post-ALTER stored text with a fresh `dump-schema` run and mirror its
  exact column/constraint order** (SQLite inserts ALTER-added column defs after the last column, before table
  constraints — confirm on the real dump, never assume). Data carried by INSERT SELECT (all pre-000042 columns).
- Backfill note: production devices and the engine both run it; `character_profile_id IS NULL` covers the engine's
  seeded `user`, dev persona shim rows, and any profile-less rows. No other legacy handling (Q10 ruling).
- **Lockstep workflow (§9-A11): author both sides in ONE session; gates run once both exist locally.**

## App side (`src/database/migrations/000042_entity_type_and_flags.ts`)

- Register in `src/database/migrations.ts` (version 42, sequential — enforced by `migrations.rollforward.test.ts:37-43`).
- Update in the SAME commit (green rule; **land app-side 1-2 + 1-3 as ONE change set with the 1-2 consumer
  rewiring — amendment A5**): `src/database/models.ts` `Entity` model += `entity_type`, `is_muted`, `is_disabled`;
  `src/database/repositories/entities.ts` INSERT/SELECT column lists + `updateEntityFields` allowlist + the A5 flag
  surface (`setEntityMuted`/`setEntityDisabled` — **A3 guard: throw for `entity_type='user'`** — plus
  `getDisabledEntityIds`/`getMutedEntityIds`).
- Regenerate snapshots + `schema/rn-schema.json`.

## Engine side (`database/migrations/000042_entity_type_and_flags.{up,down}.sql`)

- Up = the four statements above (comments stripped-safe; keep inline comments OUT of ALTER statements — they don't
  land in sqlite_master for ALTERs, but keep the file clean anyway).
- **Down**: rebuild `entities` without the three columns (guard bans DROP COLUMN) — `_new` table copying all
  pre-000042 columns + data, drop, rename; re-create `idx_entities_alias_unique` partial index exactly as
  `000018` defined it (check the stored text in the dump when writing).
- Rollback + re-apply must pass (`go test ./database/...`).

## Verification

- [ ] App: tsc 0, `npm test` green, snapshots regenerated; engine: build + `go test ./...` green
- [ ] Local parity compare (once BOTH sides exist locally — §9-A11): `entities` **MATCHES** (app rebuild adopted
      `alias DEFAULT ''` + identical column order — §9-A9 closes the drift, no allowlist entry); no new divergence
- [ ] Both repos committed; `gitnexus_detect_changes()` run per repo
