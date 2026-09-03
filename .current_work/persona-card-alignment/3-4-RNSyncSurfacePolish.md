# 3-4 — RN: Sync-Surface Polish

> Repo: `harmony-ai-app`. **code-expert**. Small; may fold into 3-2-A if that agent lands the `initiateSync` hook cleanly (3-2-A scope item 3 already covers the delete trigger — this phase then only covers reload triggers).

## Scope

1. `sync:data-applied` consumers: ensure reload triggers include `entities` / `character_image` where persona lists/avatars could be stale (today only `character_profiles` triggers CharactersScreen reload).
2. Verify post-delete non-blocking sync behavior end-to-end (if not already proven by 3-2-A's integration test).

## Gates

tsc 0 · full jest · manual smoke note for user.
Commit: `fix(sync): persona delete sync trigger + stale-surface reload polish (persona cards 3-4)`

## Checklist

- [ ] Reload triggers audited/extended
- [ ] Gates green, committed
