# Phase 2-1: S3 Versioned Purge — `session.DeleteUserSnapshot`

**Repo:** `C:\Users\sge20\go\src\github.com\harmony-ai-solutions\soulbits-cloud-backend`
**Files:** `pkg/session/s3.go` (add), `pkg/session/session_test.go` (extend fakeS3Server + tests)

## Objective

Permanent, version-aware deletion of ALL objects under a user's S3 prefix in the
sessions bucket. Plain `DeleteObjects` would only add delete markers (the prod
bucket has versioning enabled — `infrastructure/tofu/modules/s3/main.tf`), so the
implementation MUST list versions and delete explicit `VersionId`s.

## Context

- `pkg/session/s3.go` already has: `validateUserID` (path-traversal guard —
  REUSE for the prefix), `SnapshotKeys` (`{userID}/data.sqlite{,-wal,-shm}`),
  `DownloadSnapshot`/`UploadSnapshot` (style reference), multipart upload.
- RAG files live under `{userID}/rag/*` (see `snapshot_rag.go` → `ragKeyPrefix`).
  The purge is prefix-based, so DB files + RAG + any stray keys are all covered.
- Error style: `fmt.Errorf("session: ...: %w", err)`.
- `session_test.go` has a `fakeS3Server` (HTTP test server) implementing
  PutObject/GetObject/HeadObject/ListObjectsV2 (XML) — see `writeListObjectsV2`.
  It does NOT yet implement `ListObjectVersions` or the batch `DeleteObjects`
  POST endpoint; both must be added.

## Implementation

### `pkg/session/s3.go`

```go
// DeleteUserSnapshot permanently deletes ALL objects and versions under the
// user's S3 prefix ({userID}/), covering the sync DB files, the RAG directory,
// delete markers, and every historical version (the sessions bucket has
// versioning enabled — plain deletes would only add delete markers).
// Returns (objectsDeleted, versionsDeleted). A missing bucket/prefix is
// success with zero counts (idempotent re-runs). Buckets without versioning
// (dev MinIO default) return objects without VersionIds — the same
// DeleteObjects call then removes the live objects.
func DeleteUserSnapshot(ctx context.Context, client *s3.Client, bucket, userID string) (int, int, error) {
    if err := validateUserID(userID); err != nil {
        return 0, 0, err
    }
    prefix := userID + "/"
    // 1. Paginate ListObjectVersions (KeyMarker/VersionMarker), collecting
    //    types.ObjectIdentifier{Key, VersionId} for every Version and
    //    DeleteMarker entry (nil VersionId deletes the live object).
    //    Treat NoSuchBucket as (0,0,nil).
    // 2. Batch DeleteObjects (max 1000 per request — same pattern as
    //    tests/e2e/snapshot_store.go:85-95) with explicit VersionIds.
    //    Count objects vs versions for the response payload.
    ...
}
```

Notes:
- AWS SDK v2 types: `s3.ListObjectVersionsInput{Bucket, Prefix, KeyMarker, VersionMarker}`,
  `s3.DeleteObjectsInput{Bucket, Delete: &types.Delete{Objects: ids, Quiet: aws.Bool(true)}}`.
- `Quiet: true` → per-key errors come back in `out.Errors` — fail the call if any
  `types.Error` entry is present (`fmt.Errorf("session: delete S3 key %s: %s", e.Key, e.Message)`).

### `pkg/session/session_test.go` — fakeS3Server extensions

1. **`ListObjectVersions`**: `GET /{bucket}?versions&prefix=...` (plus
   `key-marker`/`version-id-marker` query params) → XML
   `<ListVersionsOutput>` with `<Version>`/`<DeleteMarker>` children
   (`<Key>`, `<VersionId>`, `<IsLatest>`). Mirror `writeListObjectsV2`'s
   XML-escaping approach. The fake must version objects: extend the in-memory
   `objects map[string][]byte` to track versions (e.g.
   `map[string][]versionEntry` where each PutObject appends a version) or keep a
   parallel `versions map[string][]fakeVersion` — implementer's choice, but
   repeated PutObject to the same key MUST yield 2 versions.
2. **`DeleteObjects` batch**: `POST /{bucket}?delete` with XML body of keys
   (+optional versionIds) → removes matching entries (or all versions of a key
   when no versionId given) → empty XML result.
3. Existing endpoints must keep working unchanged (ListObjectsV2 path may need
   to expose only latest versions now — keep behaviour compatible with existing
   RAG download tests).

### Required tests (TDD — write first, watch fail)

- `TestDeleteUserSnapshot_RemovesAllVersions` — PutObject same key twice →
  delete → HeadObject 404 AND ListObjectVersions empty for prefix.
- `TestDeleteUserSnapshot_ScopesToUserPrefix` — objects under `otheruser/`
  survive.
- `TestDeleteUserSnapshot_EmptyPrefix` — no objects → (0, 0, nil).
- `TestDeleteUserSnapshot_MissingBucket` — (0, 0, nil).
- `TestDeleteUserSnapshot_InvalidUserID` — returns `ErrInvalidUserID`, no calls.
- `TestDeleteUserSnapshot_RemovesDeleteMarkers` — a prior plain delete (if fake
  supports marker creation) is also purged.
- Existing tests in the package stay green.

## Verification

```powershell
go build ./pkg/session/...
go test ./pkg/session/... -run 'TestDeleteUserSnapshot' -v
go test ./pkg/session/...
```

## Commit

Combined with 2-2 and 2-3 into the Phase 2 commit:
`feat(pkg): data purge foundations (S3 versioned purge, valkey purge flag + ZSET cleanup, keystore delete)`

## Checklist

- [ ] Tests written first and observed failing
- [ ] `DeleteUserSnapshot` implemented per spec
- [ ] fakeS3Server supports ListObjectVersions + batch DeleteObjects
- [ ] All package tests green (`go test ./pkg/session/...`)
- [ ] GitNexus impact run on `UploadSnapshot`/`DownloadSnapshot` neighbours if any shared symbol was touched (expected: none)
