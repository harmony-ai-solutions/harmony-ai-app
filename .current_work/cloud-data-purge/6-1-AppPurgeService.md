# Phase 6-1: App — `CloudSessionService.purgeCloudData()` + Reconnect Suppression

**Repo:** `C:\Users\sge20\go\src\github.com\harmony-ai-solutions\harmony-ai-app`
**Files:** `src/services/cloud/CloudSessionService.ts`, `src/contexts/SyncConnectionContext.tsx`

> ⚠️ This repo IS GitNexus-indexed — run `gitnexus_impact` on
> `CloudSessionService` (and the SyncConnectionContext connect/reconnect entry
> symbols) before editing, and `gitnexus_detect_changes` before committing.
> Consult `.planning/codebase/ARCHITECTURE.md` + `CONVENTIONS.md`.

## Objective

App-side purge orchestration: disconnect, call the endpoint, survive
`snapshot_busy`/`in_progress` with bounded retries, expose a `purging` state,
and make sure nothing auto-spawns a cloud session while purging (defense in
depth — broker 409 is the backstop, app state is the UX layer).

## Context

- `CloudSessionService` is a singleton EventEmitter with statuses
  `idle|requesting|provisioning|ready|active?|failed|deviceAuthRequired`;
  `connect(opts?)`, `disconnect()`, `scheduleProactiveRefresh`, and it builds a
  client per call via `buildSoulbitsClient({ paseto })`.
- `SyncConnectionContext` owns auto-connect/reconnect for cloud mode and calls
  `cloudSessionService.connect()` — read it to find the exact reconnect entry
  points (WS failure re-provision path, app foreground, etc.).
- The JS client (v0.2.0, Phase 5) exposes `session.deleteDataOrThrow` and typed
  `PurgeInProgressError`/`SnapshotBusyError`.

## Implementation

### `CloudSessionService`

- Extend the status union with `'purging'`.
- New public method:

```ts
/**
 * Purge all cloud-side engine data for the signed-in user.
 * 1. disconnect() locally (best-effort broker notify — broker hard-kills anyway)
 * 2. POST /v1/session/data/delete with bounded retries:
 *    - SnapshotBusyError → wait 3s, retry (max 10 attempts)
 *    - 200 in_progress (another device) → wait 3s, re-call (max 40 attempts / ~2min)
 *      (re-calling is safe: idempotent; when the other purge finishes, our call
 *       re-runs the (now empty) purge and returns 'deleted')
 * 3. On success: status → 'idle', emit 'purge:done'
 * Emits 'purge:failed' with reason otherwise. Never auto-reconnects.
 */
async purgeCloudData(): Promise<void>
```

- Add `isPurging()` getter (status === 'purging'). Guard `connect()`:
  `if (this.status === 'purging') throw new Error('purge in progress')` —
  belt-and-braces against internal callers.

### `SyncConnectionContext`

- While `cloudSessionService.isPurging()`: skip every auto-connect trigger
  (find the connect call sites: initial cloud connect, reconnect timers,
  foreground/WS-failure re-provision). Minimal change: an early-return guard
  at the shared connect entry + listen for the `'purge:done'`/`'purge:failed'`
  events to re-evaluate (do NOT auto-connect after purge — the user explicitly
  reconnects; the success dialog guides them).
- Map `PurgeInProgressError` from `connectPoll` (thrown when ANOTHER device is
  purging) to a non-reconnecting state + toast via the context's existing
  toast/error channel: message key `syncSettings:purgeInProgressOtherDevice`.

## Tests (`src/services/cloud/__tests__/` — mock the client package exactly like
`deviceAuth.test.ts` does with `jest.mock('@harmony-ai-solutions/soulbits-api-client', ...)`)

- happy path: deleteData resolves deleted → status idle, `purge:done` emitted,
  disconnect called first.
- snapshot_busy ×2 then success → 3 calls, success.
- in_progress ×3 then deleted → polls, succeeds.
- exhausted retries → `purge:failed`, status idle (not failed — session didn't fail).
- connect() during purging throws.

## Verification

```powershell
npx jest --selectProjects unit --testPathPatterns "services/cloud"
```

## Commit

Part of the Phase 6 commit: `feat(settings): reset cloud data action (purge flow, reconnect suppression)`

## Checklist

- [ ] gitnexus impact run on edited symbols first
- [ ] 'purging' status + purgeCloudData with bounded retries
- [ ] connect() guard + SyncConnectionContext suppression + 409 mapping
- [ ] Unit tests green
