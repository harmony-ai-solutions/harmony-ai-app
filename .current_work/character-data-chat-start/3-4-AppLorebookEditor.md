# 3-4 — App Lorebook Editor (`LorebookViewerSheet` + `LorebookEntryEditor`)

> **Phase 3** (frontend). Depends on P1 `character_book` JSON column ([1-3](1-3-AppMigration000037AndModels.md)). Read [`00-VerificationAndGroundTruth.md`](00-VerificationAndGroundTruth.md) first.
> **Repo:** `harmony-ai-app/`.

## Objective

Surface the lorebook in the profile editor: a summary card → `LorebookViewerSheet` (browse/search entries) → per-entry `LorebookEntryEditor`. Because matching is **semantic** (not keyword), `content` is the primary field; keyword/position/budget fields are shown under "Advanced — preserved for export" and do not drive matching. Each entry carries a "retrieved when the conversation is semantically related" hint. An optional semantic "Test match" (type a phrase → top matches) requires an engine call ([00 §7 #1](../character-data-chat-start-concept/02-frontend-and-ux-concept.md)).

## Ground truth (verified — [00 §B.2](00-VerificationAndGroundTruth.md), [§A18–A20](00-VerificationAndGroundTruth.md))

- No `@gorhom/bottom-sheet` → sheets use **paper `Modal`+`Portal`** ([00 §A18](00-VerificationAndGroundTruth.md)). Precedent `SelectPicker.tsx:8/72`, `ImpersonationSelectorModal.tsx:212-217`.
- `CharacterProfile.character_book` is a JSON string ([1-3](1-3-AppMigration000037AndModels.md)) → parse/encode client-side with `JSON.parse`/`JSON.stringify` (mirrors the engine types from [1-5](1-5-CharacterCardV3TypesAndPngParser.md)).
- Macro handling on card-management screens: raw macros **visible + highlighted**, not silently resolved (concept 02 §3.1; [1-7](1-7-MacroEngine.md)).
- i18n `characters.json` (extend with `lorebook`, `lorebookEmpty`, `lorebookEntryRetrievedWhen`, `lorebookFieldsExportOnly`, etc.).

## Components to create

### `src/components/character-card/LorebookViewerSheet.tsx`

Paper `Modal`+`Portal` listing entries for a profile:
- Header: *"Lorebook · N entries · C constant · scan depth S"* (parse top-level `character_book` keys: `scan_depth`, `token_budget`, `name`, `description`).
- Each row: enabled/disabled toggle, key preview (`entry.keys`), `constant` badge, entry `name`/`comment`.
- Tap row → `LorebookEntryEditor`.
- Add-entry action.

### `src/components/character-card/LorebookEntryEditor.tsx`

- **Primary field:** `content` (multiline) — what gets embedded + matched semantically. Live hint: `characters.lorebookEntryRetrievedWhen` (*"retrieved when the conversation is semantically related to this entry"*).
- **Advanced — preserved for export** (collapsible): `keys[]`, `selective` + `secondary_keys[]`, `constant`, `position` (`before_char`/`after_char`), `insertion_order`, `case_sensitive`, `use_regex`, `name`, `comment`, `priority`, `id`. These round-trip to the card but do **not** drive matching — label them `characters.lorebookFieldsExportOnly`.
- **Sensible defaults:** `enabled=true`, `position=before_char`, `insertion_order=10`.
- **Optional "Test match" (semantic query):** type a phrase → call the engine semantic-retrieval endpoint → show top-matching entries ranked by similarity. (Engine call — see [3-3](3-3-GoLoreRetrievalInPromptBuild.md); may require a small dedicated event/endpoint. Ship the static hint without it if the engine call is deferred.)
- Macros in `content` shown **highlighted, not resolved** (card-management screen).

## Data handling

- The editor reads/writes the `character_book` JSON string on the profile. On save, `JSON.stringify` the (possibly edited) book back into `profile.character_book`. The engine re-embeds on edit ([3-2](3-2-GoLoreEmbedding.md)).
- Enable/disable toggle: optimistic local update + the engine re-ingests on save (full `IngestLore`). (No live single-entry embed RPC from the app in v1 — the editor edits the JSON; embedding happens on profile save. Keep it simple.)

## Files to create

- `src/components/character-card/LorebookViewerSheet.tsx`
- `src/components/character-card/LorebookEntryEditor.tsx`
- Extend `src/i18n/locales/en/characters.json` with lorebook keys.

## Implementation steps

1. Create the two components (paper `Modal`+`Portal`); parse/encode the `character_book` JSON.
2. `content` primary; Advanced collapsible (preserved-for-export fields).
3. Semantic hint; optional Test-match (engine call — gate behind P3 engine availability).
4. Macros highlighted, not resolved.
5. Tests: round-trip a `character_book` through view → edit → save (JSON fidelity); reduced-motion sheet cross-fade.

## Verification

- [ ] `LorebookViewerSheet` + `LorebookEntryEditor` (paper `Modal`+`Portal`).
- [ ] `content` primary; Advanced fields labeled "preserved for export".
- [ ] Semantic hint shown; macros highlighted not resolved.
- [ ] `character_book` JSON round-trips losslessly through the editor.
- [ ] Sensible defaults on new entries.
- [ ] `npx tsc --noEmit` + tests pass.

## Notes / deviations

- **[00 §A18](00-VerificationAndGroundTruth.md):** paper `Modal`+`Portal`, no gorhom.
- "Test match" needs an engine semantic-retrieval surface — if not available, ship the static hint and defer the interactive test.
