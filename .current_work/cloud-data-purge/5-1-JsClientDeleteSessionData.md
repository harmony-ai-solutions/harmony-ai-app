# Phase 5-1: JS Client — `session.deleteData` + Typed Purge Errors (v0.2.0)

**Repo:** `C:\Users\sge20\go\src\github.com\harmony-ai-solutions\soulbits-api-client-js`
(Not GitNexus-indexed — use read/grep.)

## Objective

TypeScript client support for the purge endpoint + typed 409 handling in
`connectPoll`, released as **0.2.0**. The app consumes this repo via a pinned
git hash — **the commit hash produced here feeds Phase 6** and MUST be reported.

## Context

- Spec vendored at `openapi.yaml`; codegen: `npm run gen`
  (openapi-typescript → `src/generated.d.ts`).
- `src/session.ts` — `createSessionAPI(client)` factory style with
  `xxxOrThrow` convenience wrappers; `connectPoll` already maps 403
  device_authorization_required → `DeviceAuthRequiredError` (mirror this for
  409 purge_in_progress).
- `src/errors.ts` — `APIError`, `DeviceAuthRequiredError`, `unwrap` helper.
- Tests: `src/__tests__/session.test.ts` (vitest) — follow the existing
  fetch-mock patterns.
- Build: `npm run build` (tsup); `dist/` is committed.

## Steps

1. Copy the Phase-1 spec from the backend repo over `openapi.yaml`.
2. `npm run gen` → `src/generated.d.ts` gains the path + schemas.
3. `src/errors.ts`:

```ts
/** A data purge is in progress for this user (connect blocked / purge mid-flight). */
export class PurgeInProgressError extends Error {
  readonly retryAfterMs?: number;
  constructor(retryAfterMs?: number) {
    super('purge_in_progress');
    this.name = 'PurgeInProgressError';
    this.retryAfterMs = retryAfterMs;
  }
}
/** Snapshot lease contended — retry shortly. */
export class SnapshotBusyError extends Error { /* same shape, 'snapshot_busy' */ }
/** DELETE confirmation string missing/wrong. */
export class ConfirmationRequiredError extends Error { /* 'confirmation_required' */ }
```

4. `src/session.ts`:

```ts
/**
 * Purge ALL cloud-side engine data for the authenticated user (hard-kills a
 * live session, deletes every S3 version, the beat schedule, and the DEK).
 * Requires confirm: "DELETE". Idempotent.
 */
deleteData(confirm: string = 'DELETE') {
  return client.POST('/v1/session/data/delete', { body: { confirm } });
},
async deleteDataOrThrow(confirm: string = 'DELETE') {
  // unwrap + map 400/409 error codes to the typed errors above
},
```

`deleteDataOrThrow` mapping: 400 → `ConfirmationRequiredError`; 409 with
`error === 'snapshot_busy'` → `SnapshotBusyError(retry_after_ms)`;
409/others → `APIError` (base behaviour). A 200 with
`status === 'in_progress'` resolves normally (caller checks `data.status`).

5. `connectPoll`: in the non-2xx branch, before the generic `APIError` throw:
```ts
if (response.status === 403 && errBody.error === 'device_authorization_required') throw new DeviceAuthRequiredError(); // existing
if (response.status === 409 && errBody.error === 'purge_in_progress') {
  throw new PurgeInProgressError(errBody.retry_after_ms); // terminal for the poll
}
```
Export the new errors from `src/index.ts`.

6. `package.json`: version `0.1.0` → `0.2.0`.
7. Tests (`src/__tests__/session.test.ts`): success + counts; in_progress 200;
   confirmation 400 typed; snapshot_busy 409 typed; connectPoll 409 →
   PurgeInProgressError and poll stops (single request).
8. `npm run build` (commit refreshed `dist/` + `src/generated.d.ts`).

## Verification

```powershell
npm run gen ; npm run build ; npm test
```

## Commit (no push) — REPORT THE HASH

`feat(session): deleteData + purge_in_progress/snapshot_busy typed errors (v0.2.0)`

## Checklist

- [ ] Spec vendored; `npm run gen` clean
- [ ] `deleteData`/`deleteDataOrThrow` + typed errors exported
- [ ] `connectPoll` 409 mapping (terminal, single request)
- [ ] vitest green; build artifacts committed
- [ ] Version 0.2.0; committed — **commit hash reported back**
