# Schema Parity Gate

## What It Does

The schema parity gate ensures that the React Native app's database schema and the Harmony Link Go backend's database schema are **identical**. This is critical because the two databases exchange data via bidirectional sync — if the schemas diverge, sync can silently corrupt data.

The gate compares normalized JSON dumps of both schemas, entry by entry, checking:
- Same set of tables and indexes
- Same column types, constraints, and defaults
- Same CREATE INDEX statements

**Sanctioned divergences** (intentional cross-repo design differences) are tracked in a versioned allowlist rather than treated as drift — see [Parity Allowlist](#parity-allowlist).

## How It Runs

The parity gate runs as a **GitHub Actions workflow** (`.github/workflows/schema-parity.yml`):

1. **Trigger:** Pull request that touches migration files, schema baselines, or the parity tooling itself. Also available via `workflow_dispatch`.
2. **RN side:** `npm run schema:dump` — runs all RN migrations against an in-memory SQLite DB, dumps the resulting schema as normalized JSON.
3. **Go side:** `go run . dump-schema` — runs all Go migrations against an in-memory SQLite DB, dumps the resulting schema as normalized JSON (pure JSON on stdout, no banner lines — §9-A15).
4. **Comparison:** `python3 scripts/compare-schemas.py` — compares the two JSON files, reports divergences, and applies the allowlist.
5. **Failure:** If **un-allowlisted** divergences are found, the workflow fails and uploads both schema dumps as artifacts for inspection.

### Comment-insensitive, quote-normalized comparator (§9-A8 / §9-A13)

Both dump writers (`scripts/dump-schema.ts` and Go `cmd/dump_schema.go`) normalize the SQL text before the comparator sees it:

- **Comment stripper** (§9-A8): string-literal-aware removal of `--` line comments and `/* */` block comments, applied **before** the whitespace collapse. Comment-only drifts therefore cease to exist as a category.
- **Header table-name quote normalization** (§9-A13): the `CREATE TABLE` header's surrounding double quotes are stripped. Quoted and unquoted headers produce identical output, so quote-only drifts also cease to exist.
- **Whitespace collapse + trailing-semicolon strip:** runs as before, after comment stripping.

Because sqlite_master reaches the comparator already whitespace-collapsed, inline `--` comments have no recoverable terminator there — the stripping must happen on the writer side (a comparator-side stripper truncates DDL at the first comment). Cross-implementation fixture tests in both repos (TS `dumpSchemaNormalize.test.ts`, Go `cmd/dump_schema_test.go`) assert identical outputs for identical inputs.

## How to Interpret Failures

The comparison script reports:

| Category | Meaning | Action |
|----------|---------|--------|
| **RN-only entries** | Table/index exists in RN but not in Go | Add migration to Go, OR allowlist (rare) |
| **Go-only entries** | Table/index exists in Go but not in RN | Add migration to RN, OR allowlist (engine infra) |
| **Different SQL** | Tables/indexes exist on both sides but with different column types, constraints, or defaults | Reconcile, OR allowlist (interim) |

Entries that are on the allowlist are annotated `[allowlisted]` with their reason, and do **not** count as drift. The gate is green only when:
1. The **actual divergence set minus the allowlist set is empty** (no un-allowlisted drift), **AND**
2. **Every allowlist entry still matches a real divergence** (a stale allowlist entry — one whose drift was reconciled or removed without cleaning up the allowlist — is itself a failure, forcing cleanup when a drift is reconciled).

### Common Cosmetic Differences — (now reconciled/ceased to exist)

The former "cosmetic" categories are **no longer categories**. Each was reconciled or eliminated by the Phase-1 schemas:

- **Inline SQL comments:** comment-only drifts **ceased to exist** via the §9-A8 comment stripper (both writers strip comments before the comparator sees the DDL).
- **Table-name quotes:** quote-only drifts **ceased to exist** via the §9-A13 header quote normalization.
- **TEXT vs DATETIME/TIMESTAMP label drift:** reconciled app-side by the §9-A9 label sweep — the app adopted the engine's `TIMESTAMP`/`DATETIME` labels on the rebuilt tables. No longer appears as drift (see [Timestamp Column Labels](#timestamp-column-labels-rn-text-vs-go-timestamp)).
- **INTEGER vs BOOLEAN:** reconciled app-side by the same §9-A9 sweep; both sides use `INTEGER` for boolean-ish columns today.

The old **10** cosmetic SQL drifts recorded in the prior "Current Divergence State" section were reconciled by §9-A8 (comment-only), §9-A13 (quote-only), and §9-A9 (label/column). They are counted as reconciled, not pending.

## Timestamp Column Labels (RN TEXT vs Go TIMESTAMP)

**§9-A9 policy (supersedes the earlier per-side-labels ruling):** the Phase-1 canonical rebuilds adopted the **engine** timestamp labels on both sides. Rebuilt tables (`conversation_messages`, `emotion_state`, `entity_emoji_actions`, `interactions`, `entities`) now carry `TIMESTAMP`/`DATETIME` labels on `created_at`/`updated_at`/`deleted_at` (and others where applicable). The app rebuild **drops all timestamp defaults** — the actual 000025 hazard — while adopting the engine labels.

**Why the labels are load-bearing for the Go side:** `mattn`/`jgiannuzzi go-sqlite3` `Scan` dispatches on the **declared column type** — `TIMESTAMP/DATETIME/DATE`-declared columns are parsed into `time.Time`; `TEXT`-declared columns return raw strings. Relabeling a Go-scanned date column TIMESTAMP→TEXT breaks every `time.Time`/`sql.NullTime` scan at runtime (`unsupported Scan, storing driver.Value type string into type time.Time`). RN reads by SQLite **storage class** (`react-native-sqlite-storage`), not declared type, so the label choice is functionally neutral app-side (a `TIMESTAMP`-labeled column holding an ISO string still reads as a string).

**History (why app tables originally used TEXT):** `conversation_messages` timestamps were originally `DATETIME/TIMESTAMP DEFAULT CURRENT_TIMESTAMP` (000005, 000013). SQLite's `CURRENT_TIMESTAMP` default writes space-separated `'YYYY-MM-DD HH:MM:SS'`, which (a) iOS JavaScriptCore fails to parse via `new Date(...)` and (b) does not match the ISO-8601 'T'-separated format the sync protocol expects. 000025 (commit `c62c7ca` "fix: sync issues") switched these columns to `TEXT NOT NULL` without defaults. §9-A9 now restores the engine labels but **keeping the defaults dropped**.

**Invariants:**
- **No timestamp defaults on either side.** The §9-A9 rebuilds drop all `DEFAULT CURRENT_TIMESTAMP`; both sides keep the columns default-free.
- **The app NEVER relies on `DEFAULT CURRENT_TIMESTAMP`** on a date column, ever — writers supply explicit ISO-8601 timestamps (`new Date().toISOString()`), with the `normalizeTimestampForSync` upload failsafe (`src/database/sync.ts`) as a backstop. (The existing `DEFAULT CURRENT_TIMESTAMP` on dormant app tables like `chat_conversation_settings`/`character_favorites` is tolerated only because writers are explicit; any table that carries defaults is not relied upon for generated values.)
- The sync wire is safe across formats: the Go side marshals `time.Time` to RFC3339Nano (ISO 'T') JSON and binds/parses `time.Time` on write/read, so app DBs only ever receive ISO-T strings even though the engine DB stores space-format internally.

## Real Differences (Fix Required)

Real divergences — missing columns, missing FOREIGN KEY constraints, missing DEFAULT values, different affinities (`TEXT` vs `BLOB`, `INTEGER` vs `REAL`) — that are **not** on the allowlist are genuine drift and fail the gate. They must be reconciled (add a mirrored migration to the other side, or align the column).

## Parity Allowlist

The parity allowlist — `scripts/parity-allowlist.json`, loaded by the comparator from its own directory — is a **versioned registry** of sanctioned, intentional cross-repo schema divergences — not drift. Each entry carries a `key` (`type:name`), a `kind` (`rn-only` / `go-only` / `different-sql`), and a one-line `reason`.

**Today's entries (Phase 1, after §9-A8/A13/A9):**

- `table:device_push_tokens` — **Go-only** — engine push infrastructure; the app's `000039` is the reserved-name placeholder that deliberately never creates this table.
- `table:sync_history` — **different-SQL, INTERIM** — the app copy is dead code (zero callers per §9-A14) and lacks the engine's `updated_at` column; it is DROPPED by paired app migration `000043` in phase 4-2 (§9-A14), at which point this entry converts to a **Go-only** entry.

**Removal-only policy:** allowlist entries may only be **REMOVED** (when a drift is reconciled), never **ADDED**, without a senior-dev ruling. The phase 4-2 additions (`table:sync_devices`, and `table:sync_history` converting to go-only) are pre-sanctioned by the engine contract §9-A14 and cited in the entry reasons.

**End state (after phase 4-2):** the allowlist shrinks to **3 uniform Go-only infra entries** — `device_push_tokens`, `sync_devices`, `sync_history` (engine-local sync infrastructure that the app deliberately does not mirror; the app drops its dead `sync_devices`/`sync_history` copies in `000043`). No RN-only or different-SQL entries remain; every real divergence is a deliberate engine-infrastructure table.

## How to Update Baselines

When you **intentionally** change the schema (adding a new table, column, or index):

1. **Update migrations in BOTH repos** — RN and Go must have matching migration pairs
2. **Regenerate the RN baseline:**
   ```bash
   npm run schema:dump -- --output schema/rn-schema.json
   ```
3. **Regenerate the Go baseline** (requires Go toolchain; stdout is pure JSON — no `tail` strip, §9-A15):
   ```bash
   cd path/to/harmony-link-private
   cmd /c "go run . dump-schema > schema/go-schema.json"
   ```
   Before committing, mechanically assert the file starts with `[` (the stdout purity gate).
4. **Commit both baseline files** alongside the migration changes
5. **Re-run the local comparator** — if the change introduces a deliberate divergence, add/update its allowlist entry (with a senior-dev ruling, per the removal-only policy).

## Local Testing

```bash
# Dump RN schema
npm run schema:dump > rn-schema.json

# Dump Go schema (pure JSON stdout, no tail strip — §9-A15)
cd ../harmony-link-private
cmd /c "go run . dump-schema > ../harmony-ai-app/go-schema.json"

# Compare (allowlist loaded from scripts/parity-allowlist.json)
cd ../harmony-ai-app
python scripts/compare-schemas.py rn-schema.json go-schema.json
```

## Current Divergence State (verified 2026-08-31, fresh dumps)

A fresh RN dump vs a fresh engine dump currently compare as:

| Metric | Count |
|--------|-------|
| Total RN entries | 58 |
| Total Go entries | 59 |
| Matching | 57 |
| RN-only | 0 |
| Go-only | 1 (`table:device_push_tokens`) |
| Different SQL | 1 (`table:sync_history`) |

Both divergences are allowlisted, so the local parity comparator is **green** (exit 0) with exactly **2 `[allowlisted]` entries**. `conversation_messages`, `entities`, `emotion_state`, `entity_emoji_actions`, and `interactions` all **match** — the D3 `conversation_messages` divergence (and the other Phase-1 rebuild targets) have been closed by the canonical rebuilds (§9-A9). RN-only index leaks are zero. After the phase 4-2 pair, the end state is the 3 uniform Go-only infra entries described above per §9-A14.

**Drift-count reconciliation note:** the previous version of this document recorded **10** cosmetic SQL drifts (and the contract's earlier draft said 9). Those 10 cosmetic drifts have all been reconciled — comment-only via §9-A8, quote-only via §9-A13, label/column drifts via §9-A9 — so they are counted as **reconciled**, not pending. They are no longer in the divergence set; only the 2 sanctioned divergences remain.

## CI-Red-by-Design (Q16)

The parity CI workflow pins the engine checkout to **`main`** (`.github/workflows/schema-parity.yml`, `ref: main`). During Phase 2 the engine lives on the `feat/engine-track-phase2` branch and is **not** merged to `main`, so the engine `main` schema differs from the local `feat/engine-track-phase2` schema that the app is pairing against. Consequently the CI parity check is **red by design** until the coordinated mainline merge happens. **Do not "fix" the CI parity red** — **local parity compare is the authoritative gate** during this phase. Run `npm run schema:dump` + `cmd /c "go run . dump-schema > go-schema.json"` + `python scripts/compare-schemas.py` locally after any schema change, and treat that result as the gate.

## Related Documents

- [Phase 5-1: RN Schema Dump Utility](../.current_work/test-framework-overhaul/5-1-RNSchemaDumpUtility.md)
- [Phase 5-2: Go Schema Dump Command](../.current_work/test-framework-overhaul/5-2-GoSchemaDumpCommand.md)
- [Phase 5-3: Parity CI Gate](../.current_work/test-framework-overhaul/5-3-ParityCIGate.md)
- [Schema Parity Findings](../.current_work/test-framework-overhaul/schema-parity-findings.md)
- [Engine Contract (Phase 2 rulings, §9-A8/A9/A13/A14/A17)](../.current_work/senju-rebase-integration/21-Engine-Contract-Persona-Enums.md)
