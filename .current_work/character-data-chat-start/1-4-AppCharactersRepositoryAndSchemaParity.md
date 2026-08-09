# 1-4 — App `characters.ts` Repository + Schema-Parity Baselines

> **Phase 1 · Coupled release.** Depends on [1-3](1-3-AppMigration000037AndModels.md). Read [`00-VerificationAndGroundTruth.md`](00-VerificationAndGroundTruth.md) first.
> **Repo:** `harmony-ai-app/`.

## Objective

Update the 4 explicit-column SQL statements in `characters.ts` to carry the 14 new columns, and update the snapshot + parity baselines so the CI `schema-parity.yml` gate passes for the coupled release.

## Ground truth (verified — [00 §B.2](00-VerificationAndGroundTruth.md), [§A9](00-VerificationAndGroundTruth.md), [§A14](00-VerificationAndGroundTruth.md))

- `src/database/repositories/characters.ts`: INSERT `:31-38` (14 cols + 2 timestamps, 16 placeholders), SELECT-id `:76-89`, SELECT-all `:127-141`, UPDATE `:183-189`; row-map `:98-116` / `:148-166`.
- Sync is **column-agnostic** (`applySyncRecord` `sync.ts:384-436`; send `SELECT *` `:321/334/341`; `TABLE_ORDER` at `src/services/SyncService.ts:876`) → **zero wire changes** for new columns. The real edit surface is here + `models.ts` + migration.
- Parity gate: `.github/workflows/schema-parity.yml:28-35` triggers on `src/database/migrations/**`; `:81-92` runs `npm run schema:dump` + Go `dump-schema`, diffs via `scripts/compare-schemas.py`. Baseline `schema/rn-schema.json` is committed; `go-schema.json` is **not** committed (generated in CI from the Go repo).
- Snapshot tests: `src/database/__tests__/migrations.snapshot.test.ts:34-38`; snapshots in `__tests__/__snapshots__/`.

## Files to modify

### `src/database/repositories/characters.ts`

Update the **4** statements + row-mapping functions:

1. **INSERT** (`:31-38`): add the 14 columns to the column list + 14 more `?` placeholders + 14 bound params.
2. **SELECT-by-id** (`:76-89`): add 14 columns to the SELECT list.
3. **SELECT-all** (`:127-141`): same.
4. **UPDATE** (`:183-189`): add `first_mes = ?, mes_example = ?, …` to SET.
5. **Row mapping** (`:98-116` and `:148-166`): add 14 `first_mes: row.first_mes, …` assignments (and any `includeDeleted` variant that duplicates the mapping).

> ⚠️ A new column omitted from **any** of these silently breaks that path (e.g. `updateCharacterProfile` won't persist it; `getCharacterProfile` returns `undefined`). Be exhaustive.

### Snapshot + parity baselines

1. **Update snapshots:**
   ```bash
   npx jest --selectProjects unit --testPathPatterns migrations.snapshot --updateSnapshot
   npx jest --selectProjects unit --testPathPatterns migrations.rollforward --updateSnapshot
   ```
   (Per the test header at `migrations.snapshot.test.ts:9-12`.)
2. **Regenerate the RN schema baseline:**
   ```bash
   npm run schema:dump   # produces schema/rn-schema.json via scripts/dump-schema.ts
   ```
   Commit `schema/rn-schema.json`.
3. **Go side** (in `harmony-link-private`): the mirrored migration ([1-1](1-1-GoMigration000037.md)) + `soulbits-engine dump-schema > schema/go-schema.json` must land in the **same coupled release**. CI generates `go-schema.current.json` and diffs against the RN baseline via `compare-schemas.py` (indexes by `{type}:{name}`).

## Implementation steps

1. Run `gitnexus_impact({target:"createCharacterProfile",direction:"upstream"})` (and the update/get equivalents) — report blast radius.
2. Edit the 4 SQL statements + 2 row-mapping functions in `characters.ts`.
3. Run the snapshot update commands.
4. Regenerate `schema/rn-schema.json`.
5. `npx tsc --noEmit` + `npx jest --selectProjects unit --testPathPatterns characters`.

## Verification

- [ ] `gitnexus_impact` run on the repository functions.
- [ ] `characters.ts`: INSERT/SELECT-id/SELECT-all/UPDATE + both row-maps carry all 14 columns.
- [ ] **New test:** repository round-trip — `createCharacterProfile` with all 14 fields populated → `getCharacterProfile` → assert all 14 fields survive (TDD; catches any column omitted from INSERT/SELECT/row-map).
- [ ] Snapshot tests updated (`migrations.snapshot.test.ts.snap`, `migrations.rollforward.test.ts.snap`).
- [ ] `schema/rn-schema.json` regenerated + committed.
- [ ] `npx tsc --noEmit` passes.
- [ ] Unit tests for the repository pass.
- [ ] `gitnexus_detect_changes()` shows expected scope.

## Notes / deviations

- **Sync needs no changes** ([00 §A14](00-VerificationAndGroundTruth.md)) — do not look for a per-field sync mapping to extend; there isn't one. The concept's "extend the sync mapping" framing is corrected here.
- The CI parity gate is the enforcement mechanism, not a `sync_utils` comment ([00 §A9](00-VerificationAndGroundTruth.md)).
