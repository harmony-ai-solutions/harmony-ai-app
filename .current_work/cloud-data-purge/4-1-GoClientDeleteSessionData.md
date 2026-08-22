# Phase 4-1: Go Client — `DeleteSessionData` + Typed Purge Errors

**Repo:** `C:\Users\sge20\go\src\github.com\harmony-ai-solutions\soulbits-api-client-go`
(Note: this repo is NOT GitNexus-indexed — use read/grep, not gitnexus tools.)

## Objective

Regenerate the typed client from the updated spec (Phase 1) and add an
idiomatic wrapper + typed errors, matching the house style of
`ConnectSession`/`ConnectSessionPoll`.

## Context

- Spec is vendored at `openapi.yaml` (repo root). Codegen config:
  `oapi-codegen.yaml` → output `gen/client.go`. `gen.go` at repo root likely
  holds the `go:generate` invocation — read it and use the exact same command.
- `session.go` holds the wrapper style: result structs, typed errors
  (`DeviceAuthRequiredError`), `IsProvisioning()` helpers, status-code switch
  with `resp.JSON200`/`resp.JSON409`-style accessors.
- Tests in `session_test.go` + `client_test.go` use httptest servers — follow
  the existing patterns exactly.

## Steps

1. Copy the Phase-1 spec from the backend repo over `openapi.yaml`:
   `soulbits-cloud-backend/pkg/openapi/openapi.yaml` → `./openapi.yaml`.
2. Regenerate (`go generate .` or the documented command). Confirm
   `gen/client.go` now has `PostV1SessionDataDelete*` and the connect 409 type.
3. `session.go` — add:

```go
// PurgeInProgressError indicates a data purge is active for the user
// (connect is blocked / delete is mid-flight on another request).
type PurgeInProgressError struct{ RetryAfterMs int }
func (e *PurgeInProgressError) Error() string { return "purge_in_progress" }

// SnapshotBusyError indicates the snapshot lease was contended — retry shortly.
type SnapshotBusyError struct{ RetryAfterMs int }
func (e *SnapshotBusyError) Error() string { return "snapshot_busy" }

// DeleteSessionDataRequest holds parameters for the data purge.
type DeleteSessionDataRequest struct {
    Confirm string // must be "DELETE"
}

// DeleteSessionDataResult wraps the purge response.
type DeleteSessionDataResult struct {
    *gen.SessionDataDeleteResponse
}

func (r *DeleteSessionDataResult) IsInProgress() bool
func (r *DeleteSessionDataResult) IsDeleted() bool

// DeleteSessionData purges the user's cloud-side engine data (hard-kills any
// live session, deletes ALL S3 versions, beat schedule, and DEK).
// Idempotent; returns *PurgeInProgressError (200 in_progress or 409) and
// *SnapshotBusyError (409) for typed retry handling.
func (c *Client) DeleteSessionData(ctx context.Context, req DeleteSessionDataRequest) (*DeleteSessionDataResult, error)
```

Status handling in the switch: 200 (both `status` values → result, nil error —
callers use `IsInProgress()`), 400 → typed `ConfirmationRequiredError` (add),
409 → inspect body `error` field → `*PurgeInProgressError` or
`*SnapshotBusyError`, 401/429/default → existing `responseError` helper.

4. `ConnectSession`: add `case http.StatusConflict:` BEFORE the default —
   parse body; `error == "purge_in_progress"` → `*PurgeInProgressError`;
   otherwise fall through to `responseError`.
5. `ConnectSessionPoll`: a `*PurgeInProgressError` from `ConnectSession` is
   terminal for the poll loop — return it immediately (do NOT keep polling).

## Tests (TDD where practical — write the httptest cases first)

- `TestDeleteSessionData_Success` — 200 deleted with counts.
- `TestDeleteSessionData_InProgress` — 200 in_progress → `IsInProgress()`.
- `TestDeleteSessionData_ConfirmationRequired` — 400 → typed error.
- `TestDeleteSessionData_SnapshotBusy` — 409 → `*SnapshotBusyError` with retry ms.
- `TestConnectSession_PurgeInProgress` — 409 → `*PurgeInProgressError`;
  poll variant aborts immediately (one HTTP call observed).

## Verification

```powershell
go build ./...
go vet ./...
go test ./... -v
gofmt -l .   # must be empty
```

## Commit (no push)

`feat: add DeleteSessionData and purge_in_progress/snapshot_busy typed errors`

## Checklist

- [ ] Spec vendored (exact copy of backend Phase-1 spec)
- [ ] Codegen run; gen/client.go compiles
- [ ] Wrappers + typed errors + connect 409 handling
- [ ] Tests green; vet/gofmt clean
- [ ] Committed (no push) — report commit hash
