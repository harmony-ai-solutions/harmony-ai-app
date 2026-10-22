# Phase 2-1 — Engine: SQLite Session Extension Wrapper

> **Repo:** `harmony-link-private` (branch `feat/app-engine-parity`)
> **Assessment basis:** §12.2 (session extension, verified capabilities + caveats)
> **Codebase mapping consulted:** `.planning/codebase/` (engine — harmony-link-private): ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md
>
> **Owner ruling (2026-10-11, final):** the session extension is enabled via the
> `CGO_CFLAGS` environment variable
> (`-DSQLITE_ENABLE_SESSION -DSQLITE_ENABLE_PREUPDATE_HOOK`) wired into every
> build/test path. **No fork, no `third_party` copy, no `vendor/` patch, no
> `go.mod`/`go.sum` change** — the environment variable is the single source of
> the defines. The "Fork build flags" wording in the Design/Steps below is
> retained for context but is **superseded**; see *Implementation notes*.

## Objective

Enable and wrap SQLite's **session extension** in the engine's Go stack: record logical changesets per table, apply foreign changesets with conflict callbacks, and diff two DB states. This is the primitive all later sync phases build on.

## Design

- Build flags (Option 3, owner ruling): the vendored `jgiannuzzi/go-sqlite3` amalgamation must compile with `-DSQLITE_ENABLE_SESSION -DSQLITE_ENABLE_PREUPDATE_HOOK`. Delivered by exporting `CGO_CFLAGS` in every build/test path — no fork or module change. Verified no conflict with SQLite3MultipleCiphers.
- NEW package `database/sessionext/` — thin CGO wrappers over the C API surface we need:
  - `NewSession(ctx, db *sql.DB, tables []string) (*Session, error)` (sqlite3session_create + attach per table; PK tables only — all sync tables qualify)
  - `(*Session) Changeset() ([]byte, error)` / `Patchset()`
  - `Apply(ctx, db *sql.DB, changeset []byte, policy ConflictPolicy) (ApplyResult, error)` — wraps `sqlite3changeset_apply` with `xConflict` mapped to `policy(table, op, conflict) → OMIT|REPLACE|ABORT`; collect per-table counts
  - `Invert(changeset) ([]byte, error)` (undo support — useful for rollback tooling)
  - `Diff(ctx, fromPath string, to *sql.DB) ([]byte, error)` — retroactive changeset between two DB states (bootstrap + repair)
  - Memory mgmt: explicit `Close()`; changesets as `[]byte` copies out of SQLite-owned buffers
- Raw handle: the session extension needs the raw `*C.sqlite3`, but the vendored driver exposes no accessor for `SQLiteConn.db` (unexported) and, under Option 3, there is no fork in which to add one. The handle is reached by reflection + `unsafe` in **one** place (`sessionext.rawHandle`) with an init guard that fails loudly if a driver bump renames/retypes the field. Documented fragility: the `mattn/jgiannuzzi` conn struct field name `db`.
- Concurrency: sessions attach to a specific connection — pin with `db.Conn(ctx)` while a session is recording; recording writes MUST run on `(*Session).Conn()`. The engine opens its databases with `SetMaxOpenConns(1)`, so the pinned connection is the pool's only connection (a write through the pool while the session holds it blocks rather than misrecords, but `Conn()` is still the correct path). `(*Session).IsSessionConn(c)` is the guard against running writes on a foreign connection and expecting them to be captured.
- Encryption: changesets are produced/consumed in-process; fork's page encryption is transparent. No plaintext on disk beyond the DB itself.

## Implementation steps

1. Wire `CGO_CFLAGS="-DSQLITE_ENABLE_SESSION -DSQLITE_ENABLE_PREUPDATE_HOOK"` into every engine build/test path (Makefile, build scripts, CI, Dockerfile); document the requirement. No fork/module change. Confirm `go build/vet/test ./...` green.
2. `database/sessionext/` wrapper + exhaustive unit tests against temp DBs: record inserts/updates/deletes → apply to twin DB → row equality; conflict matrix tests (DATA/NOTFOUND/CONFLICT × OMIT/REPLACE/ABORT); apply runs inside SQLite's own savepoint (atomicity confirmed by the ABORT test).
3. Integration probe: wrap the engine's own schema — record a scripted entity creation → apply to a fresh migrated DB → engine reads it correctly.
4. Benchmarks: changeset size/latency for representative write bursts — data for 2-2 retention decisions.

## Files to create/modify

- `Makefile`, `build_linux.sh`, `build_macos.sh`, `build_win.bat`, `wails_dev.bat`, `build_sidecar_android.sh`, `build_sidecar_android.ps1` — export `CGO_CFLAGS`
- `.github/workflows/build.yml` (all four jobs) + `Dockerfile` (builder stage) — set `CGO_CFLAGS`
- `README.md` — build-requirements note (canonical docs spot)
- NEW `database/sessionext/sessionext.go` + `sessionext_test.go` + `integration_test.go` + `bench_test.go`
- Engine CHANGELOG.md

## Verification gates

- `go build/vet/test ./...` green with `CGO_CFLAGS` set (verified 2026-10-11 — see *Implementation notes*)
- Conflict-matrix tests green; apply atomicity confirmed (ABORT rolls the whole changeset back)
- Benchmark numbers recorded in this file after execution
- Without `CGO_CFLAGS`: `go build ./...` and `go vet ./...` still pass (library archives are not linked), and the failure is **confined to `database/sessionext`** (its test/binary link fails on the missing session symbols). This is the documented Option 3 trade-off.

## Risks & rollback

- `CGO_CFLAGS` is now a hard build requirement for anything that links `database/sessionext` (all engine binaries once 2-2 imports it). A build/test path that forgets to export it will fail at link with undefined `sqlite3session_*` / `sqlite3changeset_*` — confined to that package, never silent.
- The raw handle is reached by reflection on the unexported `SQLiteConn.db` field: a future go.mod replace bump that renames/retypes it will trip the package `init()` guard (loud panic) rather than corrupt silently. Fix is one function (`sessionext.rawHandle`) + the guard.
- Rebase API intentionally NOT wrapped yet (experimental) — defer with 2-2 decision.

## Implementation notes (executed 2026-10-11)

### Final API (frozen for 2-2 / 2-3)

Package `github.com/harmony-ai-solutions/harmony-link-private/database/sessionext`.

```go
type Op int        // OpInsert | OpUpdate | OpDelete
type Conflict int  // ConflictData | ConflictNotFound | ConflictConflict | ConflictConstraint | ConflictForeignKey
type Action int    // ActionOmit | ActionReplace | ActionAbort
type ConflictPolicy func(table string, op Op, conflict Conflict) Action

func NewSession(ctx context.Context, db *sql.DB, tables []string) (*Session, error)
func (s *Session) Conn() *sql.Conn
func (s *Session) IsSessionConn(c *sql.Conn) bool
func (s *Session) Changeset() ([]byte, error)   // (nil, nil) when empty
func (s *Session) Patchset() ([]byte, error)    // (nil, nil) when empty
func (s *Session) Close() error                 // idempotent

func Apply(ctx context.Context, db *sql.DB, changeset []byte, policy ConflictPolicy) (ApplyResult, error)
func Invert(changeset []byte) ([]byte, error)   // (nil, nil) on empty input
func Diff(ctx context.Context, fromPath string, to *sql.DB) ([]byte, error)

type TableStat struct { Inserts, Updates, Deletes int }
type ApplyResult struct {
    Total     int
    PerTable  map[string]TableStat
    Conflicts int
    Omitted   int
    Replaced  int
    Aborted   bool
}

var ErrClosed, ErrApplyAborted, ErrDriverLayout error
```

**Deviations from the plan signatures** (defects corrected — the repo convention is that context is the first parameter):
- `NewSession(db, tables)` → `NewSession(ctx, db, tables)`.
- `Apply(db, changeset, policy)` → `Apply(ctx, db, changeset, policy)`.
- `Diff(from, to string)` → `Diff(ctx, fromPath string, to *sql.DB)`: `to` is a live handle (so encrypted/WAL databases work and no DSN is re-derived inside this low-level package), and `fromPath` is ATTACHed read-only. A two-string diff was rejected because `sqlite3session_diff` compares the session's database against an *attached* database, which needs the `from` file path.

**Semantics pinned by tests** (relevant to 2-2 policy design):
- Apply is atomic (SQLite's own savepoint): `ActionAbort` → `ErrApplyAborted` + full rollback.
- A `DATA`-conflict `REPLACE` applies only the columns carried by the changeset; columns absent from it keep their local value.
- `ActionReplace` returned for `NOTFOUND`/`CONSTRAINT` is downgraded to `ActionOmit` (returning it would make SQLite abort with `SQLITE_MISUSE`).
- nil `ConflictPolicy` ⇒ every conflict is omitted.
- Empty session ⇒ `Changeset()`/`Patchset()` return `(nil, nil)`; `Apply(…, nil)` is a no-op with a zero result.

### Env wiring (the on-switch)

| Path | Wiring |
|---|---|
| `Makefile` | `CGO_CFLAGS += …` + `export CGO_CFLAGS` (inherited by all targets) |
| `build_linux.sh`, `build_macos.sh` | `export CGO_CFLAGS=…` |
| `build_win.bat`, `wails_dev.bat` | `set CGO_CFLAGS=…` |
| `build_sidecar_android.sh`, `.ps1` | export `CGO_CFLAGS` before the ABI loop |
| `.github/workflows/build.yml` | job-level `env:` on build-windows, build-linux, build-docker, build-android-sidecar |
| `Dockerfile` | `ENV CGO_CFLAGS=…` in the builder stage |
| `README.md` | "Building" section (canonical docs note) |

### Canonical gate commands (PowerShell)

```powershell
$env:CGO_CFLAGS='-DSQLITE_ENABLE_SESSION -DSQLITE_ENABLE_PREUPDATE_HOOK'
go build ./...
go vet ./...
go test ./...
```

### Gate results (2026-10-11, Windows, go1.26.2, CGO gcc)

- **With env**: `go build ./...` exit 0; `go vet ./...` exit 0; `go test ./...` exit 0 (all packages; `database/sessionext` 20 tests green incl. the engine-schema probe).
- **Without env**: `go build ./...` exit 0 and `go vet ./...` exit 0 (nothing links the package yet); `go test ./...` fails **only** at `database/sessionext` — `ld: undefined reference to sqlite3session_create / sqlite3changeset_apply / …`. Once 2-2 makes a binary import the package, a no-env `go build` of that binary fails the same way. Expected under the Option 3 ruling.

### Benchmarks (AMD Ryzen Threadripper 9960X; DB open/schema excluded from the timed section)

```
BenchmarkSessionRecordBurst100-48   30   1,784,863 ns/op   2901 changeset_bytes/100rows   53,146 B/op   1208 allocs/op
BenchmarkApplyBurst100-48           30     795,953 ns/op                               6,186 B/op    449 allocs/op
```

Recording a 100-row burst and extracting its changeset costs ~1.8 ms and yields ~2.9 KB (~29 bytes/row); applying a 100-change changeset costs ~0.8 ms. Input for 2-2's retention/backlog sizing.

## Progress checklist

- [x] Session extension enabled via `CGO_CFLAGS` env wiring (all build/test paths) — Option 3
- [x] Wrapper package + conflict matrix tests green
- [x] Engine-schema integration probe green
- [x] Benchmarks recorded
