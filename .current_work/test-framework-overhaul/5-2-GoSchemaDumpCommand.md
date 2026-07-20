# Phase 5-2: Go Schema Dump Command (Cross-Repo)

## Objective

Add a `dump-schema` command to the **Harmony Link Go backend** (`harmony-link-private`, separate private repo owned by the same developer) that produces a JSON dump of the schema produced by the Go migrations. This is the counterpart to Phase 5-1's RN dump.

> **Note on cross-repo context.** This phase touches a different repository but doesn't require external coordination — the same developer who owns `harmony-ai-app` also owns `harmony-link-private`. The work can be done in either order, in either repo, without waiting on a team.

## Context

The Go backend likely uses `golang-migrate`, `goose`, `sqlc`, or hand-rolled migrations. Whatever the tool, the requirement is identical: a CLI command that applies all migrations to a fresh in-memory SQLite DB and dumps the resulting schema as normalized JSON.

## Prerequisites

- Access to `harmony-link-private` repo (same developer, both repos).
- Phase 5-1 complete (so we know the exact JSON shape the Go command must produce).

## Implementation Steps

### 1. Survey the Go repo's migration setup

Before writing code, understand:
- Which migration tool is used? (`golang-migrate`, `goose`, `sqlc`, Atlas, custom)
- Where do migration files live? (e.g., `database/migrations/*.up.sql`)
- Is there an existing "build a fresh DB for testing" helper? If yes, reuse it.
- What SQLite driver is used? (`mattn/go-sqlite3`, `modernc.org/sqlite`, etc.)

### 2. Define the JSON shape (must match RN dump)

The Go output must produce byte-identical JSON to the RN dump for an identical schema. Confirm the shape:

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

Sorting: by `(type, name)` ascending.
Normalization: SQL text has whitespace collapsed, trailing semicolon stripped.

### 3. Implement the command

Sketch (adjust to the actual migration tool):

```go
// cmd/dump-schema/main.go
package main

import (
    "encoding/json"
    "fmt"
    "os"

    "github.com/harmony-ai-solutions/harmony-link-private/database"
    _ "modernc.org/sqlite"  // or mattn/go-sqlite3
)

type SchemaEntry struct {
    Type string `json:"type"`
    Name string `json:"name"`
    SQL  string `json:"sql"`
}

func main() {
    // 1. Open in-memory SQLite
    db, err := database.OpenInMemory()
    if err != nil {
        fmt.Fprintf(os.Stderr, "open: %v\n", err)
        os.Exit(1)
    }
    defer db.Close()

    // 2. Apply all migrations
    if err := database.RunAllMigrations(db); err != nil {
        fmt.Fprintf(os.Stderr, "migrate: %v\n", err)
        os.Exit(1)
    }

    // 3. Query sqlite_master with the same normalization as the RN side
    rows, err := db.Query(`
        SELECT type, name, sql FROM sqlite_master
        WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
        ORDER BY type, name
    `)
    if err != nil {
        fmt.Fprintf(os.Stderr, "query: %v\n", err)
        os.Exit(1)
    }
    defer rows.Close()

    var entries []SchemaEntry
    for rows.Next() {
        var e SchemaEntry
        if err := rows.Scan(&e.Type, &e.Name, &e.SQL); err != nil {
            fmt.Fprintf(os.Stderr, "scan: %v\n", err)
            os.Exit(1)
        }
        // Apply same normalization as RN side
        e.SQL = normalizeWhitespace(e.SQL)
        entries = append(entries, e)
    }

    // 4. Write JSON to stdout
    encoder := json.NewEncoder(os.Stdout)
    encoder.SetIndent("", "  ")
    if err := encoder.Encode(entries); err != nil {
        fmt.Fprintf(os.Stderr, "encode: %v\n", err)
        os.Exit(1)
    }
}

func normalizeWhitespace(s string) string {
    // Collapse runs of whitespace to single space, strip trailing semicolon
    // (mirror src/database/__test_utils__/dumpSchema.ts:normalizeSql)
    // ...
}
```

### 4. Test the command locally

```bash
cd path/to/harmony-link-private
go run ./cmd/dump-schema > go-schema.json
head go-schema.json
```

### 5. Run the parity diff against the RN dump

```bash
cd path/to/harmony-ai-app
diff schema/rn-schema.json path/to/harmony-link-private/go-schema.json
```

**This is the moment of truth.** The first diff will likely show many divergences — that's expected, this is the first automated check. Triage:

- **Cosmetic differences** (whitespace, semicolons, case): fix the normalization on one side or both until they match.
- **Real schema differences** (different column types, missing columns, extra tables): these are **bugs in one or both repos**. Document each and decide which side is canonical.

### 6. Resolve divergences

For each real divergence:
- Decide which side is correct (usually the Go server is the source of truth since it ships first).
- File a fix PR in the appropriate repo (RN migration update or Go migration update).
- Re-dump and re-diff until clean.

This is the most valuable output of the entire parity effort. **Every divergence caught here is a production bug prevented.**

### 7. Commit the Go dump command

In `harmony-link-private`, the `cmd/dump-schema/main.go` is committed. Document how to run it in the repo's README.

### 8. Commit the canonical baseline

Once RN and Go dumps match, commit both:
- `schema/rn-schema.json` (in harmony-ai-app repo)
- `schema/go-schema.json` (in harmony-link-private repo) — or at minimum, ensure the Go dump command is reproducible from a clean checkout

## Files to Create (in `harmony-link-private`)

- `cmd/dump-schema/main.go` — the dump command
- `schema/go-schema.json` — committed baseline (optional; can be regenerated in CI)

## Files to Modify (in `harmony-link-private`)

- `database/` — may need an `OpenInMemory` or `RunAllMigrations` helper exposed for the CLI's use

## Validation

- [ ] `go run ./cmd/dump-schema` in `harmony-link-private` produces valid JSON
- [ ] Output shape matches RN dump exactly (same field names, same sorting, same normalization)
- [ ] Initial diff against `schema/rn-schema.json` reveals all real divergences
- [ ] Every divergence triaged and resolved (fix in RN, fix in Go, or documented as acceptable)
- [ ] Final `diff rn-schema.json go-schema.json` shows zero differences

## Open Questions to Resolve During Implementation

- **Which SQLite driver does the Go backend use?** Different drivers report types slightly differently in `sqlite_master`. Confirm and match.
- **Does the Go backend use a `schema_migrations` table or `PRAGMA user_version`?** It will appear in the dump. Decide whether to filter it out (recommend yes, since it's an implementation detail).
- **Are there Go-side tables that aren't in the RN schema by design?** (e.g., server-only audit tables). Document and filter them explicitly rather than tolerating diff noise.

## Risk

This is the highest-variance phase. The first diff will likely uncover multiple real schema divergences that have been silently causing sync issues. Budget time for triage — possibly a week or more if many bugs are found.

## Estimated Effort

- Implementing the Go command: 1 day
- Initial diff and triage: 1-5 days depending on how many divergences exist
- Resolving each divergence: variable (may require its own migration in one repo or the other)
