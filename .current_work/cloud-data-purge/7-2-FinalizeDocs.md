# Phase 7-2: Finalize — Docs, Changelog, Memory Bank, Final Verification

**Repos:** all four (backend, go client, js client, app)

## Objective

Close the loop: documentation, changelogs, memory-bank updates, and a final
cross-repo verification sweep before the user pushes.

## Steps

### Backend (`soulbits-cloud-backend`)
- Check `docs/` for API/endpoint documentation that enumerates routes — add
  `POST /v1/session/data/delete` where the other /v1/session routes are
  documented (grep for `session/connect`). Also note the new env vars
  (`DATAPURGE_KILL_TIMEOUT_SEC`, `DATAPURGE_FLAG_TTL`) in any config/env docs.
- `memory-bank/`: update per the backend's memory-bank conventions (check
  `memory-bank/` structure — add/update the feature entry for the data purge).
- `go build ./... && go test ./...` (unit level) — final green sweep.

### Go client (`soulbits-api-client-go`)
- README: add `DeleteSessionData` to the API surface list (check README
  structure first — mirror how ConnectSession is listed).

### JS client (`soulbits-api-client-js`)
- README: document `session.deleteData` + typed errors + the connect 409
  behaviour; note v0.2.0.

### App (`harmony-ai-app`)
- `CHANGELOG.md`: new entry (follow existing format) — feature: Reset Cloud
  Data in Settings → Data Synchronization (cloud mode).
- Final `npm test` green.

### Final verification sweep (orchestrator-provided results go in the report)
- Backend: `git log --oneline` shows the phase commits; working tree clean.
- `gitnexus_detect_changes` in backend + app against their pre-phase baselines
  (the orchestrator will have run this per phase — re-run if anything changed
  since).
- Confirm no repo has uncommitted files (`git status` clean everywhere).

## Commit(s)

Per-repo docs commits: `docs: data purge feature (endpoint, env vars)` /
`docs: deleteData API` etc. — one per repo that changed.

## Checklist

- [ ] Backend docs + memory-bank updated
- [ ] Both client READMEs updated
- [ ] App CHANGELOG entry added
- [ ] All repos: tests green, working trees clean, commits in place
- [ ] Report to user: commit list per repo (user pushes)
