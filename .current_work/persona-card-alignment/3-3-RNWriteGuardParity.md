# 3-3 — RN: Write-Side Guard Parity + Filter Hardening

> Repo: `harmony-ai-app`. **code-expert** (write-path guards + tests); ui-ux-expert only if copy refresh is actually needed.

## Scope

1. Guard app-side entity write paths (`createEntity` / `updateEntityFields` in `src/database/repositories/entities.ts`): reject linking a persona-owned profile (referenced by a user entity) to an `entity_type='ai'` entity — mirrors engine 1-1; unit tests.
2. Verify read-side filtering remains complete (findings §2/§5 say yes; pin with a test if cheap).
3. Copy refresh on AI surfaces only if a reachable stale case emerges (expected: none).

## Gates

tsc 0 · targeted + full jest · parity exit 0.
Commit: `feat(personas): app-side guard - persona cards cannot link to AI entities (persona cards 3-3)`

## Checklist

- [x] Write guards + tests
- [x] Read-side pin
- [x] Gates green, committed (`9e54702`)
