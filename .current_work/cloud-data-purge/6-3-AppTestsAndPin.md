# Phase 6-3: App — Tests, JS Client Pin Bump, Full Suite

**Repo:** `C:\Users\sge20\go\src\github.com\harmony-ai-solutions\harmony-ai-app`
**Files:** `package.json`, `package-lock.json`, any remaining test files from 6-1/6-2

## Objective

Consume the published JS client commit (Phase 5) and prove the whole app suite
is green. This phase CLOSES the client→app dependency chain.

## Input required

**The Phase-5 commit hash of `soulbits-api-client-js`** (provided by the
orchestrator in the dispatch prompt — it must be substituted below).

## Steps

1. `package.json`: update
   `"@harmony-ai-solutions/soulbits-api-client": "git+ssh://git@github.com:harmony-ai-solutions/soulbits-api-client-js.git#<PHASE5_HASH>"`
2. `npm install` (updates `package-lock.json`; verify the resolved commit in
   the lock file matches).
3. Typecheck the new surface compiles in app code:
   `npx tsc --noEmit` (or the repo's typecheck script).
4. Run the full unit suite:
   `npm test` (or `npx jest --selectProjects unit` per `docs/TESTING.md`;
   integration too if the repo's standard `npm test` includes it).
5. Fix any fallout from the client bump (should be none — additive API), then
   ensure all new tests from 6-1/6-2 are included and green.
6. `gitnexus_detect_changes()` — confirm only expected symbols/files changed.

## Commit

`feat(settings): reset cloud data action (purge flow, reconnect suppression)` —
includes 6-1/6-2 work if not yet committed, the pin bump, and lock file.

## Checklist

- [ ] Pin updated to the Phase-5 hash; lock file matches
- [ ] `npx tsc --noEmit` clean
- [ ] Full `npm test` green
- [ ] gitnexus_detect_changes reviewed — no unexpected scope
- [ ] Committed (no push)
