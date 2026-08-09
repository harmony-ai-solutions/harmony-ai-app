# 1-1 — Go Migration `000037_add_character_card_standard_fields`

> **Phase 1 · Coupled release.** Read [`00-VerificationAndGroundTruth.md`](00-VerificationAndGroundTruth.md) first.
> **Repo:** `harmony-link-private/` (Go engine). **Mirrors:** app `000037` ([1-3](1-3-AppMigration000037AndModels.md)).

## Objective

Additive `ALTER TABLE … ADD COLUMN` for every new standard field on `character_profiles`, **including the `character_book` JSON column**. All nullable → backward compatible. This is the single Go migration for the whole feature (P3 lorebook adds **no** new migration — it rides this column).

## Ground truth (verified)

- Current max migration = `000036_harmonyspeech_api_key`. **`000037` is free.** ([00 §C](00-VerificationAndGroundTruth.md))
- Migration guard `database/migrations.go:311-358` forbids `DROP/RENAME COLUMN` on UpSQL only; **`ADD COLUMN` is permitted** (precedent `000036`).
- Migrations ship paired `.up.sql`/`.down.sql`. Down-migrations are **not** guarded (rollback escape-hatch) — but keep the down migration honest (it may use `DROP COLUMN`; older-Android SQLite is not a concern server-side).

## Files to create

- `harmony-link-private/database/migrations/000037_add_character_card_standard_fields.up.sql`
- `harmony-link-private/database/migrations/000037_add_character_card_standard_fields.down.sql`

## Columns to add (all `TEXT`, all nullable — matches §1.3 of the data concept)

> Type rationale: SQLite has no native JSON type; JSON values are stored as TEXT. `extensions`/`assets`/`card_provenance`/`character_book`/`tags`/`alternate_greetings`/`group_only_greetings` are JSON-encoded TEXT. Scalar fields are plain TEXT.

```sql
-- 000037_add_character_card_standard_fields.up.sql
-- Character Card V3 standard-field fidelity (spec-compliant). All additive, all nullable.
ALTER TABLE character_profiles ADD COLUMN first_mes TEXT;
ALTER TABLE character_profiles ADD COLUMN mes_example TEXT;
ALTER TABLE character_profiles ADD COLUMN alternate_greetings TEXT;      -- JSON array of strings
ALTER TABLE character_profiles ADD COLUMN post_history_instructions TEXT; -- UJB
ALTER TABLE character_profiles ADD COLUMN creator_notes TEXT;
ALTER TABLE character_profiles ADD COLUMN creator TEXT;
ALTER TABLE character_profiles ADD COLUMN character_version TEXT;
ALTER TABLE character_profiles ADD COLUMN nickname TEXT;                 -- drives {{char}}
ALTER TABLE character_profiles ADD COLUMN tags TEXT;                     -- JSON array of strings
ALTER TABLE character_profiles ADD COLUMN group_only_greetings TEXT;     -- JSON array of strings
ALTER TABLE character_profiles ADD COLUMN extensions TEXT;               -- JSON object (opaque, spec MUST round-trip)
ALTER TABLE character_profiles ADD COLUMN assets TEXT;                   -- JSON array (full asset manifest)
ALTER TABLE character_profiles ADD COLUMN card_provenance TEXT;          -- JSON object (spec/spec_version/source/dates/multilingual)
ALTER TABLE character_profiles ADD COLUMN character_book TEXT;           -- JSON object: full spec character_book (top-level + entries[])
```

```sql
-- 000037_add_character_card_standard_fields.down.sql
-- Rollback (server-side; not guarded). Columns are nullable additions.
ALTER TABLE character_profiles DROP COLUMN character_book;
ALTER TABLE character_profiles DROP COLUMN card_provenance;
ALTER TABLE character_profiles DROP COLUMN assets;
ALTER TABLE character_profiles DROP COLUMN extensions;
ALTER TABLE character_profiles DROP COLUMN group_only_greetings;
ALTER TABLE character_profiles DROP COLUMN tags;
ALTER TABLE character_profiles DROP COLUMN nickname;
ALTER TABLE character_profiles DROP COLUMN character_version;
ALTER TABLE character_profiles DROP COLUMN creator;
ALTER TABLE character_profiles DROP COLUMN creator_notes;
ALTER TABLE character_profiles DROP COLUMN post_history_instructions;
ALTER TABLE character_profiles DROP COLUMN alternate_greetings;
ALTER TABLE character_profiles DROP COLUMN mes_example;
ALTER TABLE character_profiles DROP COLUMN first_mes;
```

> The existing `backstory` and `example_dialogues` columns are **kept** (not dropped). They stay as dormant fallback for any already-imported rows; new imports leave them NULL (see [1-6](1-6-CharacterCardMapperRedesign.md)).

## Implementation steps

1. Create the two SQL files above.
2. If the migrations runner auto-discovers files by filename, confirm discovery; if there is a registry slice, add `000037` (check `database/migrations.go` for a list — the guard runs per-file via `assertMigrationSQLSupported`, `migrations.go:338`).
3. Regenerate the Go schema baseline so CI parity passes ([00 §A9](00-VerificationAndGroundTruth.md)): `soulbits-engine dump-schema > schema/go-schema.json` (per `cmd/dump_schema.go:38`, `README.md:147-148`). Commit the regenerated `schema/go-schema.json`.

## Verification

- [ ] `000037.up.sql` / `.down.sql` created with all 14 columns.
- [ ] Go migration test passes (run the Go migration test suite under `harmony-link-private/database`).
- [ ] `schema/go-schema.json` regenerated and committed.
- [ ] `assertMigrationSQLSupported` does not reject the up migration (no `DROP/RENAME COLUMN` in UpSQL).

## Notes / deviations

- None. Concept §5.1 is accurate; only the (non-existent) `sync_utils` lockstep comment is corrected in [00 §A9](00-VerificationAndGroundTruth.md) — parity is CI-enforced.
