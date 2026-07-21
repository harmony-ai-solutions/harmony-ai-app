# Schema Parity Gate

## What It Does

The schema parity gate ensures that the React Native app's database schema and the Harmony Link Go backend's database schema are **identical**. This is critical because the two databases exchange data via bidirectional sync — if the schemas diverge, sync can silently corrupt data.

The gate compares normalized JSON dumps of both schemas, entry by entry, checking:
- Same set of tables and indexes
- Same column types, constraints, and defaults
- Same CREATE INDEX statements

## How It Runs

The parity gate runs as a **GitHub Actions workflow** (`.github/workflows/schema-parity.yml`):

1. **Trigger:** Pull request that touches migration files, schema baselines, or the parity tooling itself. Also available via `workflow_dispatch`.
2. **RN side:** `npm run schema:dump` — runs all RN migrations against an in-memory SQLite DB, dumps the resulting schema as normalized JSON.
3. **Go side:** `go run . dump-schema` — runs all Go migrations against an in-memory SQLite DB, dumps the resulting schema as normalized JSON.
4. **Comparison:** `python3 scripts/compare-schemas.py` — compares the two JSON files and reports any divergences.
5. **Failure:** If divergences are found, the workflow fails and uploads both schema dumps as artifacts for inspection.

## How to Interpret Failures

The comparison script reports:

| Category | Meaning | Action |
|----------|---------|--------|
| **RN-only entries** | Table/index exists in RN but not in Go | Add migration to Go |
| **Go-only entries** | Table/index exists in Go but not in RN | Add migration to RN |
| **Different SQL** | Tables/indexes exist on both sides but with different column types, constraints, or defaults | Fix one side to match the other |

### Common Cosmetic Differences

- **Inline SQL comments:** Go migrations include `-- comments` within CREATE TABLE statements. RN migrations don't. These appear as "Different SQL" even though the effective schema is identical. The normalization step does NOT strip comments — if this becomes too noisy, update `normalizeSql()` on both sides to strip SQL comments.
- **TEXT vs DATETIME/TIMESTAMP:** SQLite treats all of these as TEXT affinity — functionally identical but the SQL text differs.
- **INTEGER vs BOOLEAN:** SQLite has no native BOOLEAN type — both are stored as 0/1. But `BOOLEAN` in SQL text differs from `INTEGER`.

### Real Differences (Fix Required)

- **Missing columns:** A column exists on one side but not the other
- **Missing FOREIGN KEY constraints**
- **Missing DEFAULT values**
- **Different column types with different affinities** (e.g., `TEXT` vs `BLOB`, `INTEGER` vs `REAL`)

## How to Update Baselines

When you **intentionally** change the schema (adding a new table, column, or index):

1. **Update migrations in BOTH repos** — RN and Go must have matching migration pairs
2. **Regenerate the RN baseline:**
   ```bash
   npm run schema:dump -- --output schema/rn-schema.json
   ```
3. **Regenerate the Go baseline** (requires Go toolchain):
   ```bash
   cd path/to/harmony-link-private
   go run . dump-schema 2>/dev/null | tail -n +4 > schema/go-schema.json
   ```
4. **Commit both baseline files** alongside the migration changes

## Local Testing

```bash
# Dump RN schema
npm run schema:dump > rn-schema.json

# Dump Go schema
cd ../harmony-link-private
go run . dump-schema 2>/dev/null | tail -n +4 > ../harmony-ai-app/go-schema.json

# Compare
cd ../harmony-ai-app
python3 scripts/compare-schemas.py rn-schema.json go-schema.json
```

## Related Documents

- [Phase 5-1: RN Schema Dump Utility](../.current_work/test-framework-overhaul/5-1-RNSchemaDumpUtility.md)
- [Phase 5-2: Go Schema Dump Command](../.current_work/test-framework-overhaul/5-2-GoSchemaDumpCommand.md)
- [Phase 5-3: Parity CI Gate](../.current_work/test-framework-overhaul/5-3-ParityCIGate.md)
- [Schema Parity Findings](../.current_work/test-framework-overhaul/schema-parity-findings.md)
