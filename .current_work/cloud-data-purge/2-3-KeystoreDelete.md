# Phase 2-3: Keystore Delete — `DeleteUserKey`

**Repo:** `C:\Users\sge20\go\src\github.com\harmony-ai-solutions\soulbits-cloud-backend`
**Files:** `pkg/keystore/keystore.go`, `pkg/keystore/postgres.go`, `pkg/keystore/local.go`, `pkg/keystore/keystore_test.go` (+ any in-repo implementers/stubs of the interface)

## Objective

Add `DeleteUserKey(ctx, userID) error` to the `keystore.KeyStore` interface so
the data purge can remove the per-user DEK (fresh key is lazily created on next
connect — D-ISO-02 pattern stays intact).

## Context

- `pkg/keystore/keystore.go` — interface with `CreateUserKey`/`GetUserKey`
  (+ `ErrKeyNotFound`).
- `pkg/keystore/postgres.go` — `PostgresKeyStore`: DEK ciphertext lives in
  `users.db_encryption_key_encrypted` (KMS envelope, D-ISO-03). **Never delete
  the users row** (auth-service owns it) — NULL the column.
- `pkg/keystore/local.go` — `LocalFileKeyStore` (dev): one file per user under
  the keystore dir; read it to get the exact path scheme.
- Interface implementers to update: grep the repo for `keystore.KeyStore` —
  includes test stubs in `cmd/lifecycle-worker` (job_test.go) and possibly
  broker tests. Every implementer must compile with the new method; test stubs
  get a trivial implementation.

## Implementation

### `keystore.go`

```go
// DeleteUserKey removes the user's DEK. Idempotent: deleting a missing key is
// a no-op (nil error). Used by the user-initiated data purge; the next connect
// lazily creates a fresh key (D-ISO-02).
DeleteUserKey(ctx context.Context, userID string) error
```

### `postgres.go`

```go
const deleteUserKeySQL = `UPDATE users SET db_encryption_key_encrypted = NULL WHERE id = $1`

func (s *PostgresKeyStore) DeleteUserKey(ctx context.Context, userID string) error {
    // ExecContext; wrap error as "keystore: delete DEK: %w". 0 rows affected = nil (idempotent).
}
```

### `local.go`

Remove the user's key file; `os.IsNotExist` → nil. Follow the file-naming the
impl already uses (read it first).

### Tests (TDD)

- Postgres impl: use the existing test approach in `keystore_test.go` (it
  stubs KMS; check whether it uses a real Postgres via testcontainers or a sqlmock —
  follow whatever exists). Cover: delete after create → `GetUserKey` returns
  `ErrKeyNotFound`; delete on missing user → nil; delete then `CreateUserKey`
  → brand-new key (not the old one).
- Local impl: temp dir; same three behaviours.

### Ripple updates

- `grep -r "keystore.KeyStore" --include=*.go` → update every stub/implementer
  (e.g. `cmd/lifecycle-worker/job_test.go` fake keystore) with a working
  `DeleteUserKey`.
- Broker handler will consume this in Phase 3 — no wiring here.

## Verification

```powershell
go build ./pkg/keystore/... ./...
go test ./pkg/keystore/... -v
go test ./cmd/lifecycle-worker/... # stub updates compile + green
```

## Commit

Part of the Phase 2 combined commit (see 2-1).

## Checklist

- [ ] Interface extended; both production impls + all stubs updated
- [ ] Idempotency tests (missing key → nil) written first
- [ ] Postgres impl NULLs the column, never deletes the row
- [ ] `go build ./...` and affected tests green
