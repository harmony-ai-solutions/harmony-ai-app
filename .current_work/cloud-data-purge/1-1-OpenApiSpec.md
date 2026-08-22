# Phase 1-1: OpenAPI Spec — Data Purge Endpoint

**Repo:** `C:\Users\sge20\go\src\github.com\harmony-ai-solutions\soulbits-cloud-backend`
**File:** `pkg/openapi/openapi.yaml` (+ keep `pkg/openapi/openapi_test.go` green)

## Objective

Add the `POST /v1/session/data/delete` path and the new `409 purge_in_progress`
response on `POST /v1/session/connect` to the OpenAPI 3 spec, with request/response
schemas, following the exact style of the existing session paths (tags, `servers:`
beta/prod entries, `$ref` responses).

## Context

- The spec lives in `pkg/openapi/openapi.yaml` (~2372 lines). Session paths start
  at `/v1/session/connect` (line ~1670). Components schemas are under
  `components.schemas` (e.g. `SessionConnectResponse`, `SessionDisconnectResponse`).
- All session paths carry:
  ```yaml
  servers:
    - url: https://beta.cloud.soulbits.app
    - url: https://cloud.soulbits.app
  ```
- The e2e suite has an `OpenAPISpec` check (`tests/e2e/openapi.go`) that validates
  the spec — new paths must be well-formed (it may also compare spec vs. live
  routes; if it enumerates routes, `session/data/delete` must be listed there —
  verify and update if needed).
- This spec file is vendored (copied) into BOTH client repos in Phases 4/5 —
  keep it self-contained YAML with no repo-local references.

## Changes

### 1. New path `/v1/session/data/delete` (insert after `/v1/session/connected`)

```yaml
  /v1/session/data/delete:
    post:
      operationId: deleteSessionData
      tags: [Session]
      summary: Purge all cloud-side engine data for the authenticated user
      description: >
        Hard-kills any live session for the user (force-stop, no graceful
        snapshot upload), then permanently deletes ALL versions of the user's
        engine data from the sessions bucket (sync DB + RAG vectors), removes
        the user's autonomy beat schedule, and deletes the per-user encryption
        key. Requires typed confirmation. Idempotent — a second call after a
        completed purge returns zero counts. While a purge is in flight,
        /v1/session/connect returns 409 purge_in_progress. Protected by the
        snapshot lease; returns 409 snapshot_busy if the lease is contended.
      servers:
        - url: https://beta.cloud.soulbits.app
        - url: https://cloud.soulbits.app
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [confirm]
              properties:
                confirm:
                  type: string
                  enum: [DELETE]
                  description: Typed confirmation guard against accidental calls.
      responses:
        "200":
          description: Purge complete (status=deleted) or already in progress by another request (status=in_progress).
          content:
            application/json:
              schema: { $ref: "#/components/schemas/SessionDataDeleteResponse" }
        "400":
          description: Missing or wrong confirmation string.
          content:
            application/json:
              schema:
                type: object
                properties:
                  error: { type: string, enum: [confirmation_required] }
        "401": { $ref: "#/components/responses/Unauthorized" }
        "409":
          description: Snapshot lease busy — retry after retry_after_ms.
          content:
            application/json:
              schema:
                type: object
                properties:
                  error: { type: string, enum: [snapshot_busy] }
                  retry_after_ms: { type: integer }
        "429": { $ref: "#/components/responses/RateLimited" }
        "503":
          description: Task kill could not be confirmed — the resume sweeper will finish the purge.
          content:
            application/json:
              schema:
                type: object
                properties:
                  error: { type: string, enum: [kill_unconfirmed] }
```

### 2. New 409 on `/v1/session/connect` (add to its `responses:`)

```yaml
        "409":
          description: A data purge is in progress for this user — connecting is blocked until it completes.
          content:
            application/json:
              schema:
                type: object
                properties:
                  error: { type: string, enum: [purge_in_progress] }
                  retry_after_ms: { type: integer }
```

### 3. New component schemas (next to the other Session schemas)

```yaml
    SessionDataDeleteResponse:
      type: object
      required: [status]
      properties:
        status:
          type: string
          enum: [deleted, in_progress]
        request_id:
          type: string
          description: Present with status=in_progress — the request that owns the running purge.
        objects_deleted:
          type: integer
          description: S3 objects (incl. delete markers) removed — present with status=deleted.
        versions_deleted:
          type: integer
          description: S3 object versions permanently removed — present with status=deleted.
        beats_removed:
          type: integer
          description: due:lifecycle ZSET members removed — present with status=deleted.
        dek_deleted:
          type: boolean
          description: Whether the per-user encryption key was deleted — present with status=deleted.
```

## Verification

```powershell
go test ./pkg/openapi/...
# spec must also parse standalone (clients will run their own codegen over it):
# (in a temp dir or via a tool of your choice; the openapi_test.go suite is the gate)
```

## Commit

Single commit, no push:
`feat(openapi): add POST /v1/session/data/delete and connect 409 purge_in_progress`

## Checklist

- [ ] `/v1/session/data/delete` path added with full contract above
- [ ] `/v1/session/connect` 409 `purge_in_progress` added
- [ ] `SessionDataDeleteResponse` schema added
- [ ] `go test ./pkg/openapi/...` green
- [ ] `tests/e2e/openapi.go` checked — updated if it enumerates routes
- [ ] Committed (no push)
