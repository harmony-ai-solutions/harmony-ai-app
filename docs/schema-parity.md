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
- **TEXT vs DATETIME/TIMESTAMP:** functionally identical for the RN app (see "Timestamp Column Labels" below) but the SQL text differs — and the labels are load-bearing for the Go side, so alignment is a coordinated decision, not a cosmetic fix-up.
- **INTEGER vs BOOLEAN:** SQLite has no native BOOLEAN type — both are stored as 0/1. But `BOOLEAN` in SQL text differs from `INTEGER`.

### Timestamp Column Labels (RN TEXT vs Go TIMESTAMP)

Declared-type labels on date columns behave asymmetrically across the two codebases:

- **RN side** (`react-native-sqlite-storage`): reads are dispatched by SQLite **storage class**, not declared type. A `TIMESTAMP`-labeled column holding `'2026-08-31T10:00:00.000Z'` returns the same string as a `TEXT`-labeled one. Affinity note: `TEXT` label = TEXT affinity, `TIMESTAMP`/`DATETIME` = NUMERIC affinity — ISO-8601 strings are not numeric-coercible, so they keep TEXT storage class either way (cosmetic in practice).
- **Go side** (`mattn`/`jgiannuzzi go-sqlite3`): `Scan` dispatches on the **declared column type** — `TIMESTAMP/DATETIME/DATE`-declared columns are parsed into `time.Time`; `TEXT`-declared columns return raw strings. Relabeling a Go-scanned date column TIMESTAMP→TEXT breaks every `time.Time`/`sql.NullTime` scan at runtime (`unsupported Scan, storing driver.Value type string into type time.Time`).

**History (why app tables use TEXT):** `conversation_messages` timestamps were originally `DATETIME/TIMESTAMP DEFAULT CURRENT_TIMESTAMP` (000005, 000013). SQLite's `CURRENT_TIMESTAMP` default writes space-separated `'YYYY-MM-DD HH:MM:SS'`, which (a) iOS JavaScriptCore fails to parse via `new Date(...)` and (b) does not match the ISO-8601 'T'-separated format the sync protocol expects. 000025 (commit `c62c7ca` "fix: sync issues") switched these columns to `TEXT NOT NULL` **without defaults**, with all writes explicit `new Date().toISOString()`, plus the `normalizeTimestampForSync` upload failsafe (`src/database/sync.ts`).

**Invariants:**
- Never reintroduce `DEFAULT CURRENT_TIMESTAMP` on app tables whose values feed `new Date(...)` or the sync wire — always write explicit ISO-8601.
- The sync wire is safe across formats: the Go side marshals `time.Time` to RFC3339Nano (ISO 'T') JSON and binds/parses `time.Time` on write/read, so app DBs only ever receive ISO-T strings even though the engine DB stores space-format internally.
- Timestamp-label changes on synced tables must be decided jointly for both repos (Go scan behavior depends on the label); the engine must keep `TIMESTAMP`-style labels on columns scanned as `time.Time`.

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

## Current Divergence State (as of Senju Follow-Up Phase 1 + reply restore, 2026-08-28)

The **D3 divergence set is now NARROWED** to `conversation_messages.reactions_json` +
`reply_to_message_id` + `is_pinned` (plus the `idx_conversation_messages_pinned` and
`idx_conversation_messages_reply_to` indexes). The `reply_to_message_id` column was RESTORED
(keep-but-hidden consensus: the feature pipeline is live again while the user-facing reply UI
stays gated behind `MESSAGE_REPLY_ENABLED` in `src/constants/chatFeatures.ts`). Phase 2
(engine track, B1 — a Go mirror migration for message actions including read flags, shape O12)
closes D3 and turns the parity gate green — the engine mirror must now include the reply
column + index. Everything else in the dump is the known pre-existing baseline (10 cosmetic
SQL drifts + `device_push_tokens` Go-only — RN's `000039` is the reserved-number placeholder
that deliberately never creates that table).

`CLIENT_ONLY_TABLES` in `scripts/dump-schema.ts` is an **interim 3-entry set**:
- `personas` — dies in Phase 2 B3 (personas → user entities conversion)
- `character_favorites` + `chat_conversation_settings` — redesigned in Phase 2 B2 (unread → derived read-flags;
  favorites gets an engine mirror + SyncService registration)

The client-only exclusion mechanism is deleted together with its last entry (end state = zero exclusions, no
client-only tables left).

## Related Documents

- [Phase 5-1: RN Schema Dump Utility](../.current_work/test-framework-overhaul/5-1-RNSchemaDumpUtility.md)
- [Phase 5-2: Go Schema Dump Command](../.current_work/test-framework-overhaul/5-2-GoSchemaDumpCommand.md)
- [Phase 5-3: Parity CI Gate](../.current_work/test-framework-overhaul/5-3-ParityCIGate.md)
- [Schema Parity Findings](../.current_work/test-framework-overhaul/schema-parity-findings.md)
