# 1-6 — Character-Card Mapper Redesign (stop the mangling)

> **Phase 1.** Depends on [1-2](1-2-GoCharacterProfileModelAndSync.md), [1-3](1-3-AppMigration000037AndModels.md), [1-5](1-5-CharacterCardV3TypesAndPngParser.md). Read [`00-VerificationAndGroundTruth.md`](00-VerificationAndGroundTruth.md) first. **Both repos.**

## Objective

Convert both mappers from "mangle the card to fit a Harmony-flavoured shape" to **1:1 field mapping**. Delete the `mapExampleDialogues` concatenation and the `mapCharacterBook` flattening. Store the entire `character_book` to the new JSON column (lossless). Leave `example_dialogues`/`backstory` NULL for new imports (kept columns, dormant fallback).

## Ground truth (verified — [00 §B.1](00-VerificationAndGroundTruth.md), [§B.2](00-VerificationAndGroundTruth.md))

**Go `utils/charactercard/mapper.go`:**
- `MapToCharacterProfile:12`. `mapCharacterBook:44-62` (called `:22`) → `"CHARACTER LORE:\n\n"`. `mapExampleDialogues:65-85` (called `:26`) → `"EXAMPLE DIALOGUES:\n\n"`.
- Defaults: `Appearance:""` `:21`, `VoiceCharacteristics:""` `:23`, `TypingSpeedWPM:60` `:27`, `AudioResponseChancePercent:50` `:28`; `BasePrompt: card.Data.SystemPrompt` `:24`.
- Dropped today: `post_history_instructions`, `creator_notes`, `tags`, `creator`, `character_version`, `extensions`.

**TS `src/utils/charactercard/mapper.ts`:**
- `mapCharacterBook:24` (`:29` `'CHARACTER LORE:\n\n'`), `mapExampleDialogues:52` (`:53` `'EXAMPLE DIALOGUES:\n\n'`), `mapCardToProfile:85` (object `:98-113`; `backstory:104`, `base_prompt:106`, `example_dialogues:108`; defaults `appearance:103`,`voice:105`,`typing:109`,`audio:110`).

## Target 1:1 field map (both repos, identical semantics)

| Card field | → Profile column | Notes |
|---|---|---|
| `data.first_mes` | `first_mes` | scalar |
| `data.mes_example` | `mes_example` | scalar |
| `data.alternate_greetings` ([]string) | `alternate_greetings` | `json.Marshal`/`JSON.stringify` → JSON string |
| `data.post_history_instructions` | `post_history_instructions` | scalar (previously DROPPED) |
| `data.creator_notes` | `creator_notes` | scalar (previously DROPPED) |
| `data.creator` | `creator` | scalar (previously DROPPED) |
| `data.character_version` | `character_version` | scalar (previously DROPPED) |
| `data.nickname` | `nickname` | scalar (V3-only) |
| `data.tags` ([]string) | `tags` | JSON string |
| `data.group_only_greetings` ([]string) | `group_only_greetings` | JSON string (V3-only) |
| `data.extensions` (object) | `extensions` | JSON string (previously DROPPED) |
| `data.assets` ([]object) | `assets` | JSON string (V3-only); **also** extract primary `icon` → existing `character_images` table (display) — keep this extraction behavior |
| `spec`/`spec_version`/`source`/`creation_date`/`modification_date`/`creator_notes_multilingual` | `card_provenance` | fold into one JSON object |
| `data.character_book` (whole object) | `character_book` | `json.Marshal`/`JSON.stringify` the **entire** object (top-level + entries[]) — lossless |
| `data.system_prompt` | `base_prompt` | unchanged rename |
| `data.name`/`description`/`personality`/`scenario` | (existing columns) | unchanged |

**Keep** the Harmony-extension defaults (`appearance=""`, `voice_characteristics=""`, `typing_speed_wpm=60`, `audio_response_chance_percent=50`) — they are functional knobs, not spec fields.

**Delete:** `mapExampleDialogues` and `mapCharacterBook` (both repos). `example_dialogues` and `backstory` are left NULL/empty for new imports.

## Files to modify — Go

### `harmony-link-private/utils/charactercard/mapper.go`

1. In `MapToCharacterProfile` (`:12`):
   - Remove the `mapCharacterBook(book)` call (`:22`) and the `mapExampleDialogues(data)` call (`:26`).
   - Set `ExampleDialogues: ""` (leave NULL/empty — no concatenation).
   - Set `Backstory: ""` (no flattening; if the card genuinely has non-lore backstory, the spec has no separate field for it, so empty is correct).
   - Add the 14 new assignments per the table above. For JSON columns use `json.Marshal` (handle arrays/objects); for `character_book` use `json.Marshal(card.Data.CharacterBook)` only when non-nil, else `""`.
   - Build `card_provenance` from `spec`/`spec_version`/`source`/`creation_date`/`modification_date`/`creator_notes_multilingual` (marshal to JSON).
2. **Delete** `mapCharacterBook` (`:44-62`) and `mapExampleDialogues` (`:65-85`).

### `harmony-link-private/management/routes_character_profiles.go`

Confirm the import call site (`:140` `ExtractCharacterCardFromPNG` → `:153` `MapToCharacterProfile`) still compiles — the mapper signature is unchanged; only its body changes.

## Files to modify — TS

### `src/utils/charactercard/mapper.ts`

1. In `mapCardToProfile` (`:85`):
   - Remove `backstory: mapCharacterBook(card.data.character_book)` (`:104`) and `example_dialogues: mapExampleDialogues(card.data)` (`:108`).
   - Set `backstory: ''` and `example_dialogues: ''` (or `null` per the interface type).
   - Add the 14 new assignments per the table above (`JSON.stringify` for JSON columns; `JSON.stringify(card.data.character_book ?? null)` for the lorebook).
   - Build `card_provenance` from the V3 fields.
2. **Delete** `mapCharacterBook` (`:24`) and `mapExampleDialogues` (`:52`).

### `src/utils/charactercard/index.ts` (if it re-exports the deleted helpers)

Update any barrel exports.

## Implementation steps

1. Run `gitnexus_impact({target:"MapToCharacterProfile"})` (Go) / `mapCardToProfile` (TS) — report blast radius (consumed by import flows + tests).
2. Go: rewrite `MapToCharacterProfile`; delete the two helpers.
3. TS: rewrite `mapCardToProfile`; delete the two helpers.
4. Update import tests: assert that after import, `profile.first_mes === card.data.first_mes`, `profile.character_book` parses back to the full book, `profile.example_dialogues` is empty, etc.

## Verification

- [ ] `gitnexus_impact` run on both mappers.
- [ ] Go: `mapCharacterBook` + `mapExampleDialogues` deleted; `MapToCharacterProfile` does 1:1 mapping incl. `character_book` JSON.
- [ ] TS: mirror; `mapCardToProfile` does 1:1 mapping.
- [ ] `example_dialogues`/`backstory` empty for new imports (not concatenated/flattened).
- [ ] `character_images` still receives the primary icon asset (regression check).
- [ ] `go test ./utils/charactercard/...` + `npx jest charactercard` pass.
- [ ] `gitnexus_detect_changes()` — expected scope only.

## Notes / deviations

- Lorebook **embedding** into RAG is engine-side and lands in P3 ([3-2](3-2-GoLoreEmbedding.md)) — this subtask only stores the JSON column. The mapper does not touch RAG.
- TS field names are snake_case ([00 §A12](00-VerificationAndGroundTruth.md)).
