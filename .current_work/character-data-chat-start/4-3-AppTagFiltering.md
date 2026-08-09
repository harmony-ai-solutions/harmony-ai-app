# 4-3 — App Character-Card Tag Filtering

> **Phase 4** (frontend). Depends on P1 `tags` JSON column ([1-3](1-3-AppMigration000037AndModels.md)). Read [`00-VerificationAndGroundTruth.md`](00-VerificationAndGroundTruth.md) first.
> **Repo:** `harmony-ai-app/`.

## Objective

Add tag filtering to the **character-card / management screen** (Discover is **out of scope** — concept §4.2). v1 uses SQLite JSON1 (`json_each(tags)`) over the `tags` JSON column; revisit a join table only at P4 if list perf degrades. Also surface `CreatorAttributionBadge` on each card (tap creator → filter).

## Ground truth (verified — [00 §B.2](00-VerificationAndGroundTruth.md))

- `CharactersScreen.tsx`: `ScreenHeader:341-372` (search bar only today); card list below.
- `CharacterProfile.tags` is a JSON string column ([1-3](1-3-AppMigration000037AndModels.md)).
- `TagChips` shared component from [3-5](3-5-AppProfileEditorSectionsAndImport.md) (dual-use: editor + filter).

## Design

- A horizontal **`TagChips` filter row** (multi-select) at the top of `CharactersScreen`, sourced from all distinct tags across the library (`SELECT DISTINCT value FROM character_profiles, json_each(tags)` — or compute client-side from the loaded profiles for v1 simplicity).
- Filter the list: a profile matches if **any** of its tags is in the selected set (multi-select OR). Use SQLite JSON1 server-side (`json_each(tags)`) for v1; if the repo's query helper doesn't expose JSON1, filter client-side from the loaded set and note the join-table upgrade as a P4+ option.
- `CreatorAttributionBadge` on each card (`creator`/`character_version` from `card_provenance`/columns); tap creator → set a creator filter.

> **Scope:** Discover screen is **out of scope** (concept §4.2) — tag filtering applies only to the character-card / management screen.

## Files to create / modify

- `src/screens/CharactersScreen.tsx` — add the `TagChips` filter row + creator filter; wire into the list query/render.
- `src/components/character-card/TagChips.tsx` ([3-5](3-5-AppProfileEditorSectionsAndImport.md)) — `mode: 'filter'` (selected set, no add/remove).
- `src/components/characters/CharacterProfileCard.tsx` — add `CreatorAttributionBadge`.
- A repository helper for distinct tags (if server-side JSON1) — `src/database/repositories/characters.ts`: `getDistinctTags(): Promise<string[]>` using `json_each`.
- Extend `characters.json` i18n (`filterByTag`, `filterByCreator`, `clearFilters`).

## Implementation steps

1. Add `getDistinctTags` (JSON1) or compute client-side.
2. Add the `TagChips` filter row + multi-select state to `CharactersScreen`.
3. Filter the list (server-side JSON1 preferred; client-side fallback).
4. Add `CreatorAttributionBadge` to `CharacterProfileCard` + creator-filter.
5. Tests: tag filter (multi-select OR); creator filter; reduced-motion.

## Verification

- [ ] `TagChips` filter row on `CharactersScreen` (multi-select); distinct tags sourced via `json_each` (or client-side with a noted TODO).
- [ ] List filters correctly (any-tag-in-set).
- [ ] `CreatorAttributionBadge` on each card; tap → creator filter.
- [ ] Discover untouched (out of scope).
- [ ] `npx tsc --noEmit` + tests pass.

## Notes / deviations

- v1 = JSON1 over the `tags` column; a `character_tags(profile_id, tag)` join table is the P4+ upgrade **only if** list perf degrades (concept §4.2). The JSON column does not block it (backfill from JSON is trivial).
