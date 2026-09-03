# 3-2-A — RN: Persona Data Layer (full-profile writes, copy, delete parity, sync test)

> Repo: `harmony-ai-app`, branch `senju-design-updates-rebase`. **Agent: code-expert** (repos/services/tests — no screens).
> Findings basis: `3-1-RN-Findings.md` §3/§4/§7. Decisions 4, 6, 7, 9, 10, 15 bind.

## Scope

1. **Full-profile persona writes** (`src/database/repositories/userEntities.ts`): `createUserPersona`/`updateUserPersona` accept the full V3+Soulbits field set (not just `minimalProfileColumns()`); entity id stays frozen, alias synced; built-in `user` editable-once-seeded, delete-protected (existing tests keep passing).
2. **Local full-card copy helper** (persona-from-card; mirrors engine 1-3): all spec + Soulbits fields, fresh `id`, name deduped via `getNextEntityAliasCopy`, `is_favorite` reset, `lifecycle_config` reset `{}`, `card_provenance` as-is, **all images copied with primary flag preserved**, then user-entity create. Tests: `personas.test.ts` / new `personaFromCard.test.ts`.
3. **`deleteUserPersona` parity**: soft-delete persona's `character_image` rows too; protect built-in; then **fire `syncService.initiateSync()` (non-blocking)** per decision 15 (put it in the repo/service layer so all callers benefit).
4. **Persona-cascade sync integration test**: entity+profile+image tombstones apply + purge cleanly (extend the `HarmonyLinkMockServer` harness).
5. **Defensive read guard**: filtered single-profile getter or persona-owned assertion for the `AIProfileScreen` `getCharacterProfile(id)` path.

## Gates

`npx.cmd tsc --noEmit` = 0 · targeted jest (`persona|userEntities|characters`) RED→GREEN · full `npm.cmd test` · `gitnexus_impact` before edits, `gitnexus_detect_changes` before commit · parity script exit 0 (no schema change).
Commit: `feat(personas): full-profile persona data layer - copy, delete parity, cascade sync test (persona cards 3-2-A)`

## Checklist

- [x] Full-field writes
- [x] Copy helper + tests
- [x] Delete parity + initiateSync
- [x] Cascade sync integration test
- [x] Read guard
- [x] Gates green, committed
