# Phase 2-1 — Engine: SQLite Session Extension Wrapper

> **Repo:** `harmony-link-private` (branch `feat/app-engine-parity`)
> **Assessment basis:** §12.2 (session extension, verified capabilities + caveats)
> **Codebase mapping consulted:** `.planning/codebase/` (engine — harmony-link-private): ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md

## Objective

Enable and wrap SQLite's **session extension** in the engine's Go stack: record logical changesets per table, apply foreign changesets with conflict callbacks, and diff two DB states. This is the primitive all later sync phases build on.

## Design

- Fork build flags: the `jgiannuzzi/go-sqlite3` fork must compile with `-DSQLITE_ENABLE_SESSION -DSQLITE_ENABLE_PREUPDATE_HOOK` (cgo CFLAGS in the package; verify no conflicts with SQLite3MultipleCiphers).
- NEW package `database/sessionext/` — thin CGO wrappers over the C API surface we need:
  - `NewSession(db *sql.DB, tables []string) (*Session, error)` (sqlite3session_create + attach per table; PK tables only — all sync tables qualify)
  - `(*Session) Changeset() ([]byte, error)` / `Patchset()`
  - `Apply(db *sql.DB, changeset []byte, policy ConflictPolicy) (ApplyResult, error)` — wraps `sqlite3changeset_apply` with `xConflict` mapped to `policy(table, op, conflict) → OMIT|REPLACE|ABORT`; collect per-table counts
  - `Invert(changeset) ([]byte, error)` (undo support — useful for rollback tooling)
  - `Diff(from, to string) ([]byte, error)` — retroactive changeset between two DBs/files (bootstrap + repair)
  - Memory mgmt: explicit `Close()`; changesets as `[]byte` copies out of SQLite-owned buffers
- Concurrency: sessions attach to a specific connection — pin with `db.Conn(ctx)` while a session is recording; document that recording spans must not reassign the pool connection (engine uses SetMaxOpenConns(1) in places — verify interaction; if single-conn, simpler).
- Encryption: changesets are produced/consumed in-process; fork's page encryption is transparent. No plaintext on disk beyond the DB itself.

## Implementation steps

1. Fork branch: add build flags; confirm `go test` for the fork's existing suites still green locally; document flag set.
2. `database/sessionext/` wrapper + exhaustive unit tests against temp DBs: record inserts/updates/deletes → apply to twin DB → row equality; conflict matrix tests (DATA/NOTFOUND/CONFLICT/CONSTRAINT × OMIT/REPLACE/ABORT); delete-propagation FK ordering (apply runs inside one savepoint — verify child-first ordering isn't required, or pre-sort).
3. Integration probe: wrap the engine's own schema — record a scripted entity+profile+message creation → apply to a fresh migrated DB → engine reads it correctly.
4. Benchmarks: changeset size/latency for representative write bursts (message send, config edit, sync-sized batches) — data for 2-2 retention decisions.

## Files to create/modify

- Fork repo: build flags (its own branch/PR)
- `go.mod` replace bump to the flagged fork commit
- NEW `database/sessionext/sessionext.go` + `sessionext_test.go` (+ `bench_test.go`)
- Engine CHANGELOG.md

## Verification gates

- `go build/vet/test ./...` green with flagged fork
- Conflict-matrix tests green; FK-ordering behavior documented (savepoint atomicity confirmed)
- Benchmark numbers recorded in this file after execution

## Risks & rollback

- Fork flag interaction with MultipleCiphers — worst case: maintain flags in our fork's build recipe only for sidecar/server builds; desktop unaffected if flags are compile-time global (they are — one fork, one flag set)
- Rebase API intentionally NOT wrapped yet (experimental) — defer with 2-2 decision

## Progress checklist

- [ ] Fork flags merged + pinned
- [ ] Wrapper package + conflict matrix tests green
- [ ] Engine-schema integration probe green
- [ ] Benchmarks recorded
