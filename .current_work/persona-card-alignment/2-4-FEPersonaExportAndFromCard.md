# 2-4 — Engine FE: Persona Export + Full-Copy From-Card + Delete Copy

> Repo: `harmony-link-private/frontend`, branch `feat/engine-track-phase2`. Gate: build + self-review.
> Depends on: 1-3 (duplicate endpoint), 1-2 (delete cascade).

## Objective (decisions 1 + 4)

Persona↔card round-trip: export personas as standard cards; create personas from cards as rich full copies; delete copy reflects the cascade.

## Implementation

1. **Export**: per-persona export button (card hover action alongside edit/delete) → `exportCharacterCard(persona.profile.id, 'png')` (format toggle png/json if the Characters UX has one — mirror it). No engine change.
2. **Create-persona-from-card** (Characters tab card menu — currently identity-prefill): switch to **immediate full copy** (decision 7): call 1-3 duplicate endpoint → `createPersonaEntity(name, newProfileId)` + alias sync → switch to Personas tab with the new persona open in the editor for tweaks. The persona store's `createPrefill` stash flow is retired (delete `setCreatePrefill`/`clearCreatePrefill` + the prefill effect in PersonasView). Copy target name: keep duplicate-endpoint dedupe; then entity name = profile name.
3. **Delete copy**: persona delete confirm text updated — "this permanently removes the persona, its card, and card images" (i18n). Call remains `deleteEntity` (cascade is engine-side per 1-2).
4. i18n keys for all new strings (personas + characters namespaces).

## Gates

Build exit 0; self-review; grep: no `createPrefill` leftovers.
Commit: `feat(frontend): persona export, full-copy create-from-card, cascade-aware delete copy (persona cards 2-4)`

## Checklist

- [ ] Export button works (png/json)
- [ ] From-card = duplicate + entity create + editor open
- [ ] Prefill flow removed
- [ ] Delete copy + i18n
- [ ] Build green, committed
