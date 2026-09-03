# 2-1 — Engine FE: Characters Tab Hides Persona-Owned Profiles

> Repo: `harmony-link-private/frontend` (NESTED git repo), branch `feat/engine-track-phase2`. Gate: `npm.cmd run build` exit 0 + TDZ self-review (no test runner).

## Objective

Characters tab shows only plain profiles: unlinked or AI-linked. Persona-owned profiles (referenced by any `user`-type entity) are hidden — they're managed in Personas.

## Implementation

- `CharacterProfilesView.jsx`: extend the existing `referencingByProfile` machinery (3-2) with a derived set `personaOwnedProfileIds` = profile ids referenced by ≥1 user entity.
- Filter `filteredProfiles` chain: exclude persona-owned ids (also when searching — they shouldn't resurface via search).
- Defensive rule only (state can't occur post-guards, decision 10): if a profile were referenced by BOTH ai + user entities, hide (persona ownership wins).
- No engine changes needed (list endpoints already return what's required).
- Empty-state copy: if the ONLY profiles are persona-owned, the existing empty state shows — add a one-line hint pointing to the Personas tab (i18n key).

## Gates

Build exit 0; self-review pass; grep: no leftover unfiltered rendering path.
Commit (nested repo): `feat(frontend): characters tab hides persona-owned profiles (persona cards 2-1)`

## Checklist

- [ ] Filter + search interplay
- [ ] Empty-state hint + i18n
- [ ] Build green, self-review, committed
