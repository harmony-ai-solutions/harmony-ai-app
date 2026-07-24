# Phase 5-2: Go Schema Dump Command (Cross-Repo)

## Objective

Add a `dump-schema` subcommand to the **Harmony Link Go backend** (`harmony-link-private`) that produces a JSON dump of the schema produced by the Go migrations. This is the counterpart to Phase 5-1's RN dump. The output must be byte-identical to the RN dump for an identical schema.

> **Note on cross-repo context.** This phase touches a different repository but doesn't require external coordination — the same developer who owns `harmony-ai-app` also owns `harmony-link-private`. The work can be done in either order, in either repo, without waiting on a team.

---

## Current State (As-Is Investigation Results)

### 1. Migration System Overview

**File location:** `database/migrations/*.sql` in `harmony-link-private`

**Runner:** Custom implementation at `database/migrations.go`, entirely hand-rolled (no golang-migrate, goose, sqlc, or Atlas).

**Embedding:** SQL files are embedded at compile time via:
```go
//go:embed migrations/*.sql
var migrationsFS embed.FS
```
(See `database/migrations.go`, line 14-15)

**File format:** Paired `{version}_{description}.up.sql` / `{version}_{description}.down.sql` files. Version is extracted from the numeric prefix. Example:
- `000001_initial_schema.up.sql` (forward)
- `000001_initial_schema.down.sql` (rollback)

**Version tracking:** A `schema_migrations` table (`version INTEGER PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, description TEXT`) is created on first run and records each applied migration.

**Migration application:** Each migration runs inside a dedicated transaction via `runMigrationTx()` (lines 195-241 of `migrations.go`). Foreign keys are temporarily disabled at the connection level before the transaction begins, then re-enabled after commit. This allows the SQLite table-rebuild pattern (CREATE `_new` → DROP → RENAME) used by migrations like 000031.

**Rollback support:** Yes — `rollbackMigrations()` applies `.down.sql` files in reverse order. Not directly relevant to the dump command, but confirms the migration system is bidirectional.

**Migration count:** 32 migrations (000001 through 000032) — exactly matching the RN side.

**Migration inventory:**
```
database/migrations/000001_initial_schema.up.sql
database/migrations/000001_initial_schema.down.sql
database/migrations/000002_make_character_profile_optional.up.sql
database/migrations/000002_make_character_profile_optional.down.sql
... (all 32 versions have paired .up.sql / .down.sql)
database/migrations/000032_add_soulbitscloud_provider.up.sql
database/migrations/000032_add_soulbitscloud_provider.down.sql
```

**SQLite driver:** `github.com/mattn/go-sqlite3` (CGO required). Imported in `database/connection.go`:
```go
import _ "github.com/mattn/go-sqlite3"
```

**DSN format:** Built by `BuildDSN()` in `database/encryption.go`:
```
file:{path}?_foreign_keys=1[&_key=...&_cipher=chacha20]
```
Foreign keys are always enabled. Encryption is optional (used when `DatabaseEncryption` config is true).

**Test DB helper:** `database/helpers_test.go` has a `setupTestDB(t *testing.T)` function used by the existing `migrations_test.go`:
```go
func setupTestDB(t *testing.T) *sql.DB {
    if GetDB() != nil {
        require.NoError(t, CloseDatabase())
    }
    require.NoError(t, InitDatabase(":memory:", ""))
    return GetDB()
}
```
This pattern demonstrates exactly how to open an in-memory DB and run migrations. The dump command should follow the same pattern.

### 2. Existing Schema Introspection / Dump Capability

**Nothing exists.** No existing subcommand or utility dumps the schema. Grepping for `sqlite_master`, `dump`, `introspect`, `describe` across the Go codebase turns up:

- `database/encryption.go` already queries `sqlite_master` during encryption conversion (lines 152, 172, 191, 314, 334, 353) — but only to copy tables, not to dump schema
- `database/migrations_test.go` queries `sqlite_master` to verify tables exist (lines 53, 77) — again, test-only validation
- `database/connection_test.go` queries `sqlite_master` for the `schema_migrations` table (line 30)

No Makefile target, justfile recipe, or shell script dumps schema. No existing command in `cmd/` does anything schema-related.

The `soulbits-cloud-backend` repo has no schema introspection utilities relevant to harmony-link.

### 3. Config System

**Config file:** JSON format, defaults to `./config.json`. Set via Viper in `cmd/root.go`.

**Config structs:** Defined in `config/types.go`. Top-level:
```go
type Config struct {
    General  GeneralConfig            `mapstructure:"general" json:"general"`
    Entities map[string]EntityConfig  `mapstructure:"entities" json:"entities,omitempty"`
    Admin    AdminConfig              `mapstructure:"admin" json:"admin"`
}
```

**Initialization flow (`cmd/root.go` `initConfig()`):**
1. Cobra's `OnInitialize(initConfig)` runs before every command
2. If `--config` flag is given, uses that file; otherwise searches `.` for `config.json`
3. Sets defaults (port 28080, data dir `./data`, DB filename `data.sqlite`, etc.)
4. Calls `SafeWriteConfig()` to create `config.json` with defaults if it doesn't exist
5. Calls `ReadInConfig()` — exits with error if config can't be read
6. Unmarshals into `config.ApplicationConfig` (global `*Config`)
7. Initializes themes and presets from defaults

**Env var prefix:** `HARMONY_LINK` (defined in `constants/constants.go` as `EnvPrefix = "HARMONY_LINK"`)

**Cloud mode:** Additional `CLOUD_MODE=true` env var triggers `applyCloudModeOverrides()` in `cmd/cloud_mode.go`, which reads `HL_*` env vars to override config values. This means the dump command could work in CI purely via env vars — though config.json will still need to exist (see note below).

**Critical observation:** `cobra.OnInitialize(initConfig)` is registered in `root.go`'s `init()` and runs for ALL subcommands, including `version`. The `initConfig` function calls `delayedShutdownWithExitCode` if `config.json` cannot be read. However, `SafeWriteConfig()` auto-creates `config.json` with defaults on first run, so on a fresh checkout the file will be created automatically. In CI, a minimal `config.json` (`{}` or `{"general":{}}`) is sufficient because Viper defaults fill in the rest.

### 4. CLI Subcommand Patterns

**Existing subcommands** (all in `cmd/`):

| File | Command | Registered via |
|------|---------|---------------|
| `cmd/version.go` | `version` | `rootCmd.AddCommand(versionCmd)` in `init()` |
| `cmd/database.go` | `encrypt-db`, `decrypt-db` | `rootCmd.AddCommand(...)` in `init()` |
| `cmd/run.go` | `run` (default) | `rootCmd.AddCommand(runCmd)` in `init()` |

**Pattern to follow** (from `cmd/version.go`):
```go
package cmd

import (
    "fmt"
    "github.com/harmony-ai-solutions/harmony-link-private/constants"
    "github.com/spf13/cobra"
)

var versionCmd = &cobra.Command{
    Use:   "version",
    Short: fmt.Sprintf("Shows the version of %v", constants.AppName),
    Long:  fmt.Sprintf("Shows the version of %v", constants.AppName),
    Run: func(cmd *cobra.Command, args []string) {
        fmt.Println(fmt.Sprintf("%v %v", constants.AppName, constants.AppVersion))
    },
}

func init() {
    rootCmd.AddCommand(versionCmd)
}
```

Key observations:
- Commands are in `package cmd` (same package as root)
- `rootCmd.AddCommand()` in `init()` registers them
- `Run` is a `func(cmd *cobra.Command, args []string)` — use `RunE` if error return needed
- Global flags registered in `rootCmd.PersistentFlags()` (currently only `--config`)
- Default command (if no subcommand given) is automatically `run` (lines 47-51 of `root.go`)

**How the dump-schema command should use the database:**

The existing `database.InitDatabase(":memory:", "")` pattern (used in `setupTestDB` in `database/helpers_test.go`) opens an in-memory SQLite database and runs all migrations against it. The dump command needs to:

1. Close any existing DB connection (`database.CloseDatabase()`)
2. Initialize with `:memory:` (`database.InitDatabase(":memory:", "")`)
3. Query `sqlite_master` via `database.GetDB()`
4. Close when done

**Important:** `initConfig()` will still run (auto-creating `config.json` if needed) and set up global config. The dump command doesn't need any config values — it uses `:memory:` — but the `initConfig` infrastructure auto-creates what it needs.

### 5. Output Format — Must Match RN Side Byte-for-Byte

**JSON shape** (from Phase 3-1 / Phase 5-1):
```json
[
  {
    "type": "table",
    "name": "character_profiles",
    "sql": "CREATE TABLE character_profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, ...)"
  },
  {
    "type": "index",
    "name": "idx_entities_character_profile_id",
    "sql": "CREATE INDEX idx_entities_character_profile_id ON entities(character_profile_id)"
  }
]
```

**Normalization rules** (from Phase 3-1 `dumpSchema.ts`):
1. Sort entries by `(type, name)` ascending
2. Collapse all runs of whitespace in SQL text to a single space (using `strings.Fields` to split and rejoin)
3. Strip trailing semicolon (`;`) from SQL text
4. Exclude entries where `sql IS NULL` or `name LIKE 'sqlite_%'`
5. Do NOT uppercase SQL keywords — preserve the migration author's style

The RN `dumpSchema` function (to be implemented in Phase 5-1) uses this TypeScript:
```typescript
function normalizeSql(sql: string): string {
  return sql
    .replace(/\s+/g, ' ')       // collapse whitespace
    .replace(/;\s*$/, '')       // strip trailing semicolon
    .trim();
}
```

The Go equivalent uses `strings.Fields` + `strings.Join` + `strings.TrimSuffix`:
```go
func normalizeSQL(s string) string {
    s = strings.Join(strings.Fields(s), " ")
    s = strings.TrimSuffix(strings.TrimSpace(s), ";")
    return s
}
```

Note: `strings.Fields` splits on any whitespace (spaces, tabs, newlines) and `strings.Join` reconstructs with single spaces — this is the Go equivalent of `/\s+/g` and `.trim()` combined. The trailing semicolon is stripped with `TrimSuffix` after `TrimSpace`.

### 6. The "Claire" / "user" Seed Data Problem

**Seed data is NOT in migrations.** It lives in `config/db/init.go` in `createDefaultData()`:

```go
func createDefaultData(ctx context.Context) error {
    return database.WithTransaction(ctx, func(tx *sql.Tx) error {
        // Creates "Claire" character profile
        // Creates "claire" entity (id="claire")
        // Creates entity module mappings (all disabled)
        // Creates "user" entity (id="user", no character profile)
        // Creates user entity module mappings
    })
}
```

This function is called by `config/db/init.go` `InitializeDatabase()` **after** `database.InitDatabase()` completes migrations, and only if `isDatabaseEmpty()` returns true (no entities exist yet).

**Impact on schema dump:** The dump queries `sqlite_master` which only contains schema definitions (CREATE TABLE, CREATE INDEX, etc.) — NOT row data. Even if seed data were present, it wouldn't appear in the dump. The `entities` table's schema definition is captured, but no rows. This is exactly the desired behavior.

**Conclusion:** No special handling is needed. The dump is schema-only by nature of querying `sqlite_master`. The seed data is invisible to the dump. Both RN and Go dumps will produce identical schema entries for the `entities` table regardless of whether seed data exists.

### 7. Cross-Reference: Migration Numbers Between Go and RN

Both sides have 32 migrations with matching version numbers. Spot-check confirms:

| Version | Go `.up.sql` | RN `.ts` | Match? |
|---------|-------------|----------|--------|
| 000001 | `database/migrations/000001_initial_schema.up.sql` | `src/database/migrations/000001_initial_schema.ts` | Structure identical |
| 000010 | Single statement: `ALTER TABLE chat_messages RENAME TO conversation_messages;` | Same SQL in `000010_rename_chat_messages.ts` | Identical |
| 000016 | Creates `memories` table + adds columns to `conversation_messages` | Same in `000016_add_memories_table_and_emotional_state_bits.ts` | Identical |
| 000020 | Adds columns to `provider_config_openai`, `openaicompatible`, `openrouter` | Same in `000020_add_provider_llm_params.ts` | Identical |
| 000031 | Full table rebuild for UUID primary keys (15 provider + 8 module tables + entity_module_mappings + character_profiles) | Same in `000031_config_uuid_primary_keys.ts` | Schema output should be identical |
| 000032 | Creates `provider_config_soulbitscloud` table + index | Same in `000032_add_soulbitscloud_provider.ts` | Identical |

No obvious divergence spotted during spot-check. The RN migration comments confirm they mirror Go migration `XXXX` — and the Go migration comments reference the RN app's Android SQLite version constraints.

---

## Prerequisites

- Access to `harmony-link-private` repo (same developer, both repos).
- Phase 5-1 complete (so we know the exact JSON shape the Go command must produce).
- Go 1.22+ with CGO enabled (required by `mattn/go-sqlite3`).

## Implementation Steps

### 1. Create the command file

Create `cmd/dump_schema.go`:

```go
// Package cmd
/*
Copyright © 2023 Project Harmony.AI
*/
package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/harmony-ai-solutions/harmony-link-private/database"
	"github.com/spf13/cobra"
)

// SchemaEntry represents a single item from sqlite_master.
type SchemaEntry struct {
	Type string `json:"type"`
	Name string `json:"name"`
	SQL  string `json:"sql"`
}

// dumpSchemaCmd represents the dump-schema command
var dumpSchemaCmd = &cobra.Command{
	Use:   "dump-schema",
	Short: "Dumps the database schema as normalized JSON",
	Long: `Applies all migrations to an in-memory SQLite database and dumps
the resulting schema as normalized JSON to stdout.

The output format matches the RN schema dump format exactly:
  - Sorted by (type, name) ascending
  - Whitespace collapsed to single spaces
  - Trailing semicolons stripped
  - Internal sqlite_* tables excluded

Usage:
  harmony-link dump-schema > go-schema.json
  harmony-link dump-schema --pretty > go-schema.json`,
	RunE: func(cmd *cobra.Command, args []string) error {
		// Close any existing DB connection (e.g., from a prior run in the same process)
		database.CloseDatabase()

		// Open in-memory database — this automatically runs all migrations
		if err := database.InitDatabase(":memory:", ""); err != nil {
			return fmt.Errorf("failed to initialize in-memory database: %w", err)
		}
		defer database.CloseDatabase()

		db := database.GetDB()

		// Query sqlite_master with the same SQL as the RN side
		// Exclude sqlite_* internal tables, sort by (type, name)
		rows, err := db.Query(`
			SELECT type, name, sql FROM sqlite_master
			WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
			ORDER BY type, name
		`)
		if err != nil {
			return fmt.Errorf("failed to query sqlite_master: %w", err)
		}
		defer rows.Close()

		var entries []SchemaEntry
		for rows.Next() {
			var e SchemaEntry
			if err := rows.Scan(&e.Type, &e.Name, &e.SQL); err != nil {
				return fmt.Errorf("failed to scan row: %w", err)
			}
			e.SQL = normalizeSQL(e.SQL)
			entries = append(entries, e)
		}
		if err := rows.Err(); err != nil {
			return fmt.Errorf("rows iteration error: %w", err)
		}

		// Write JSON to stdout with 2-space indent (matching JSON.stringify(..., null, 2))
		encoder := json.NewEncoder(os.Stdout)
		encoder.SetIndent("", "  ")
		if err := encoder.Encode(entries); err != nil {
			return fmt.Errorf("failed to encode JSON: %w", err)
		}

		return nil
	},
}

func init() {
	rootCmd.AddCommand(dumpSchemaCmd)
}

// normalizeSQL matches the RN normalizeSql() function:
//   - Collapse runs of whitespace to a single space
//   - Strip trailing semicolon
//   - Trim leading/trailing whitespace
//
// Go's strings.Fields splits on any Unicode whitespace (spaces, tabs, newlines),
// which is the equivalent of /\s+/g in JavaScript.
func normalizeSQL(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	s = strings.TrimSuffix(strings.TrimSpace(s), ";")
	return s
}
```

### 2. Test locally

```bash
cd path/to/harmony-link-private
go run . dump-schema > go-schema.json
head -20 go-schema.json
```

**Note:** The binary is run via `go run .` (not `go run ./cmd/dump-schema/main.go`) because the `cmd` package is part of the same `main` module. The existing subcommands live as files in `cmd/` package, not as separate `main` packages. The entry point is `main.go` which calls `cmd.Execute()`.

If you prefer a standalone binary:
```bash
go build -o harmony-link.exe
./harmony-link.exe dump-schema > go-schema.json
```

### 3. Run the parity diff against the RN dump

```bash
cd path/to/harmony-ai-app
diff schema/rn-schema.json path/to/harmony-link-private/go-schema.json
```

Or using the comparison script from Phase 5-3:
```bash
python3 scripts/compare-schemas.py \
  path/to/harmony-ai-app/schema/rn-schema.json \
  path/to/harmony-link-private/go-schema.json
```

**This is the moment of truth.** The first diff will likely show differences — that's expected, this is the first automated check. Triage:

- **Cosmetic differences** (whitespace, semicolons, case): fix the normalization on one side or both until they match.
- **Real schema differences** (different column types, missing columns, extra tables): these are **bugs in one or both repos**. Document each and decide which side is canonical.

### 4. Resolve divergences

For each real divergence:
- Decide which side is correct (usually the Go server is the source of truth since it ships first).
- File a fix PR in the appropriate repo (RN migration update or Go migration update).
- Re-dump and re-diff until clean.

This is the most valuable output of the entire parity effort. **Every divergence caught here is a production bug prevented.**

### 5. Commit the Go dump command

In `harmony-link-private`, create `cmd/dump_schema.go`. No other files need modification — the command reuses the existing `database.InitDatabase(":memory:", "")` pattern.

### 6. Commit the canonical baseline

Once RN and Go dumps match, commit both:
- `schema/rn-schema.json` (in harmony-ai-app repo)
- `schema/go-schema.json` (in harmony-link-private repo) — or at minimum, ensure the Go dump command is reproducible from a clean checkout

## Files to Create (in `harmony-link-private`)

- `cmd/dump_schema.go` — the dump command (note: Go naming convention uses underscores, not hyphens, for filenames)

## Files to Modify (in `harmony-link-private`)

None — `database.InitDatabase(":memory:", "")` already provides the "fresh DB with all migrations" pattern the dump command needs. No new helpers are required.

## Files to Create (in `harmony-ai-app`)

- `schema/go-schema.json` — committed baseline (optional; can be regenerated in CI)

## Validation

- [ ] `go run . dump-schema` in `harmony-link-private` produces valid JSON to stdout
- [ ] Output shape matches RN dump exactly (same field names, same sorting, same normalization)
- [ ] `schema_migrations` table is excluded from output (name starts with `sqlite_%` — no, wait: it's `schema_migrations`, not `sqlite_%`. It will be included. The RN side also includes it. Discuss whether to filter it.)
- [ ] Initial diff against `schema/rn-schema.json` reveals all real divergences
- [ ] Every divergence triaged and resolved (fix in RN, fix in Go, or documented as acceptable)
- [ ] Final `diff rn-schema.json go-schema.json` shows zero differences

## Open Questions to Resolve During Implementation

### Should `schema_migrations` be included or excluded?

Both the Go and RN migration runners create a `schema_migrations` table. Since `sqlite_master` captures it, it will appear in both dumps. The table definition is identical on both sides (`version INTEGER PRIMARY KEY, applied_at TIMESTAMP, description TEXT`). It will produce a matching entry on both sides, so including it is fine. But it's an implementation detail, not user schema. If desired, filter it by adding `AND name != 'schema_migrations'` to the query on BOTH sides. **Decision: include it — it's consistent and matching.**

### Does the `_foreign_keys=1` DSN parameter affect the schema dump?

No. `PRAGMA foreign_keys` is a runtime setting that affects constraint enforcement, not the schema definition in `sqlite_master`. The dump is identical regardless.

### Is the `:memory:` database guaranteed to produce the same schema as a file-backed database?

Yes — SQLite treats `:memory:` databases identically to file-backed ones for schema purposes. The only difference is persistence. All DDL statements produce identical `sqlite_master` entries.

### How is CGO handled in CI?

`mattn/go-sqlite3` requires CGO. In GitHub Actions:
```yaml
- name: Setup Go
  uses: actions/setup-go@v5
  with:
    go-version: '1.22'
- run: go run . dump-schema
```
This works on `ubuntu-latest` (gcc is available) and `windows-latest` (MSVC is available). No special CGO setup is needed.

## Risk

This is the highest-variance phase. The first diff will likely uncover multiple real schema divergences that have been silently causing sync issues. Budget time for triage — possibly a week or more if many bugs are found.

However, the risk is lower than originally estimated because:
1. The migration counts already match (32 on both sides)
2. The comment conventions (`// Mirrors Harmony Link migration XXXX`) suggest active maintenance
3. No obvious divergence spotted during spot-check (000001, 000010, 000016, 000020, 000031, 000032)

## Estimated Effort

| Task | Effort | Notes |
|------|--------|-------|
| Create `cmd/dump_schema.go` | 2 hours | Simple command, follows existing patterns |
| Test locally, verify output | 1 hour | Run against `:memory:`, inspect JSON |
| Initial diff and triage | 1-3 days | Depends on divergence count |
| Resolve each divergence | Variable | May require migration in one or both repos |

**Total:** ~2 days optimistic, ~1 week worst-case.

The Go side is simpler than originally estimated because there's no external migration tool to interface with — the custom migration runner exposes a clean `InitDatabase(":memory:", "")` API.

---

## Cross-References

### Related files in `harmony-link-private`

| File | Purpose |
|------|---------|
| `database/migrations.go` | Migration runner (load, apply, rollback, FK safety) |
| `database/connection.go` | `InitDatabase`, `CloseDatabase`, `GetDB`, `BuildDSN` |
| `database/encryption.go` | `BuildDSN()` — DSN format with `_foreign_keys=1` |
| `database/helpers_test.go` | `setupTestDB(t)` — demonstrates `:memory:` + migration pattern |
| `database/migrations_test.go` | Tests migrations against `:memory:` DB |
| `config/db/init.go` | Seed data ("Claire", "user") — runs after migrations, not in dump |
| `config/types.go` | Config struct definitions |
| `cmd/root.go` | `initConfig()`, `Execute()`, root command setup |
| `cmd/version.go` | Minimal subcommand example — follow this pattern |
| `cmd/database.go` | `encrypt-db` / `decrypt-db` subcommands — config-dependent pattern |
| `cmd/cloud_mode.go` | `HL_*` env var overrides for cloud mode |
| `constants/constants.go` | `EnvPrefix = "HARMONY_LINK"`, app name/version |

### Related phase documents

| Document | Relationship |
|----------|-------------|
| `../5-1-RNSchemaDumpUtility.md` | **Output format must match exactly.** See `dumpSchema.ts` normalizeSql for the RN side's whitespace/semicolon rules. |
| `../5-3-ParityCIGate.md` | **CI consumption.** The CI workflow runs `go run . dump-schema > go-schema.json` (or `harmony-link dump-schema` if built). |
| `../3-1-SchemaSnapshotTest.md` | **Normalization spec source.** The `dumpSchema` and `normalizeSql` functions defined here are the canonical normalization rules. |
| `../6-2-GoConfigAndCLI.md` | **Config/CLI patterns.** The `cmd/` structure and config patterns documented in 6-2 apply directly to the `dump-schema` command. |

### Cross-repo notes

- **soulbits-cloud-backend:** No relevant schema introspection utilities found.
- **harmony-ai-app:** `src/database/__test_utils__/` does not yet exist (Phase 3-1 not implemented). The `dumpSchema.ts` utility described in Phase 3-1 is the RN-side normalization target.
