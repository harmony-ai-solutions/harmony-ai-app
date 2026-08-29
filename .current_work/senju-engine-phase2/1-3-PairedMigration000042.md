# 1-3 — Paired Migration 000042: entity_type + is_muted + is_disabled

> Phase 1 / repo: **BOTH** (app `senju-design-updates-rebase` + engine `feat/engine-track-phase2`).
> Contract: `21-Engine-Contract-Persona-Enums.md` §3.4, Q8/Q9/Q15.

## Objective

Same-numbered migration on both sides adding the entity flags — identical statements, same order:

```sql
ALTER TABLE entities ADD COLUMN entity_type TEXT NOT NULL DEFAULT 'ai';
ALTER TABLE entities ADD COLUMN is_muted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entities ADD COLUMN is_disabled INTEGER NOT NULL DEFAULT 0;
UPDATE entities SET entity_type = 'user' WHERE character_profile_id IS NULL;
```

- Pattern precedent: `000028_add_interaction_presence_type` (add-with-DEFAULT + backfill UPDATE).
- **No SQL CHECK constraint** (Q9 — enums validated in Go/TS code only; zero repo precedent).
- The ALTERs append after `rag_reindex_required` → both dumps grow the same appended text → the pre-existing
  `entities` cosmetic drift (engine `alias DEFAULT ''`) is untouched.
- Backfill note: production devices and the engine both run it; `character_profile_id IS NULL` covers the engine's
  seeded `user`, dev persona shim rows, and any profile-less rows. No other legacy handling (Q10 ruling).

## App side (`src/database/migrations/000042_entity_type_and_flags.ts`)

- Register in `src/database/migrations.ts` (version 42, sequential — enforced by `migrations.rollforward.test.ts:37-43`).
- Update in the SAME commit (green rule): `src/database/models.ts` `Entity` model += `entity_type`, `is_muted`,
  `is_disabled`; `src/database/repositories/entities.ts` INSERT/SELECT column lists + `updateEntityFields` allowlist.
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
- [ ] Local parity compare: `entities` text differs ONLY by the known `alias DEFAULT ''` drift (allowlisted);
      no new divergence
- [ ] Both repos committed; `gitnexus_detect_changes()` run per repo
