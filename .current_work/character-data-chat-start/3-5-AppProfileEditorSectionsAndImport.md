# 3-5 — App Profile-Editor Sections + `ImportReviewSheet`

> **Phase 3** (frontend). Depends on P1 ([1-3](1-3-AppMigration000037AndModels.md), [1-7](1-7-MacroEngine.md)), [3-4](3-4-AppLorebookEditor.md). Read [`00-VerificationAndGroundTruth.md`](00-VerificationAndGroundTruth.md) first.
> **Repo:** `harmony-ai-app/`.

## Objective

Extend `CharacterProfileEditScreen` with the new card sections (Greeting editor + live preview, Alternate Greetings manager, Lorebook summary, Attribution, Tags, Advanced), add `CreatorAttributionBadge` + `TagChips`, and add the post-import `ImportReviewSheet` (review/edit before save + "generate a greeting" CTA when none detected).

## Ground truth (verified — [00 §B.2](00-VerificationAndGroundTruth.md), [§A16](00-VerificationAndGroundTruth.md))

- `CharacterProfileEditScreen.tsx`: field state `:61-71` (camelCase local state); composes `ThemedCard:14/302`,`SectionHeader:15/303`,`ScreenHeader:16/349`,`ThemedButton:29/608`,`useAppAlert:25/52`,`ProfileImagePicker:30/582`. **Natural insertion point for the new sections.**
- `CharactersScreen.tsx`: import is a **FAB speed-dial item** (`:450-475`), NOT a header action; `handleImportCard:272-300` (`pick:278`, `importCharacterCardFromFile:286`); **no success toast today** (only failure `showAlert:298`); `importSuccess` i18n key is dead ([00 §A16](00-VerificationAndGroundTruth.md)).
- No `@gorhom/bottom-sheet` → `ImportReviewSheet` uses paper `Modal`+`Portal` ([00 §A18](00-VerificationAndGroundTruth.md)).
- i18n: extend `characters.json` (keys per concept 02 §5.14).

> **Naming caveat:** the screen's local state is camelCase (`voiceCharacteristics`, `basePrompt`), but the DB/sync `CharacterProfile` is snake_case ([00 §A12](00-VerificationAndGroundTruth.md)). Map at the load/save boundary (the screen already does this for existing fields).

## Components to create

| Component | Purpose | Composes |
|---|---|---|
| `GreetingEditor` | `first_mes` multiline editor with a **live `GreetingBubble` preview** beneath it (macros resolved: `{{user}}`→own entity, `{{char}}`→name/nickname). | `TextInput`,`GreetingBubble` ([1-10](1-10-AppGreetingRenderUx.md)),`SectionHeader` |
| `AlternateGreetingsManager` | Reorderable list (drag handle) of openers, each mini-preview + edit/delete + **"default" radio** (promotes into `first_mes`, demotes prior into `alternate_greetings[]`). Count badge. Empty hint. | `ThemedCard` list, drag handle, `ThemedButton` |
| `LorebookViewerSheet` (summary card → sheet) | From [3-4](3-4-AppLorebookEditor.md) — a summary card *"Lorebook · N entries · C constant"* in the editor; tap opens the sheet. | [3-4](3-4-AppLorebookEditor.md) |
| `CreatorAttributionBadge` | `creator`/`creator_notes`/`character_version` + provenance badge from `card_provenance`. `source` read-only (spec append-only). | `ThemedText`,`ThemedCard` |
| `TagChips` (shared, dual-use: editor + filter) | Add/remove tags with suggestions from existing library tags. (Promoted from the P2 inline row — [2-4](2-4-AppScenarioGeneratorSheetAndGenerateUx.md).) | `ThemedButton` |
| `ImportReviewSheet` | Post-import review: detected greeting? alt-greetings count? lorebook entries? tags? provenance; ✓/⚠ rows; "Review & edit fields" (deep-link editor); "Generate a greeting" CTA if none; Cancel/Save. | `ThemedCard`,`ThemedButton`,`useAppAlert` |

## Editor section layout (concept 02 §3.1)

```
CharacterProfileEditScreen
├─ Identity            (name, NICKNAME, description)
├─ Voice & Persona     (personality, voice, mes_example)
├─ GREETING            (first_mes + LIVE PREVIEW bubble)  → GreetingEditor
│   └─ Alternate Greetings manager        → AlternateGreetingsManager
├─ Scenario            (scenario, helper text)
├─ Lorebook            (summary card → LorebookViewerSheet)  → [3-4]
├─ Attribution         (creator, creator_notes, character_version, SOURCE[locked], tags) → CreatorAttributionBadge + TagChips
└─ Advanced  (collapsible)
    ├─ post_history_instructions (UJB) + explainer        → [3-6]
    ├─ base_prompt (system_prompt / {{original}})          → [3-6]
    └─ Harmony extensions (appearance, typing_speed, audio_response_chance)
+ [Preview opening] / [Test scenario generation]  action bar  (Test scenario gates on P2 engine)
```

## Files to create

- `src/components/character-card/GreetingEditor.tsx`
- `src/components/character-card/AlternateGreetingsManager.tsx`
- `src/components/character-card/CreatorAttributionBadge.tsx`
- `src/components/character-card/TagChips.tsx` (shared)
- `src/components/character-card/ImportReviewSheet.tsx`
- Extend `src/i18n/locales/en/characters.json` (greeting, alternateGreetings, addAlternate, markDefault, mesExample, creator, creatorNotes, characterVersion, source, tags, addTag, lorebook, advanced, previewOpening, testScenario, importReviewTitle, importGreetingDetected, importNoGreeting, generateGreeting, …).

## Files to modify

### `src/screens/CharacterProfileEditScreen.tsx`

- Add local state for the new fields (`firstMes`, `alternateGreetings` [], `mesExample`, `postHistoryInstructions`, `creatorNotes`, `creator`, `characterVersion`, `nickname`, `tags` [], `extensions`, `assets`, `cardProvenance`, `characterBook`). Map camelCase↔snake_case at load/save.
- Add the sections above (Greeting/Voice&Persona/Scenario/Lorebook/Attribution/Advanced).
- `[Preview opening]` renders a mock chat-start with the current `first_mes` (macros resolved, no persistence). `[Test scenario generation]` (P2 gates) triggers `GENERATE_GREETING` with editor contents → `GreetingBubble` *Preview*.

### `src/screens/CharactersScreen.tsx` ([00 §A16](00-VerificationAndGroundTruth.md))

- After `importCharacterCardFromFile` (`:286`) parses the card, **before persisting**, open `ImportReviewSheet` with the parsed detection summary.
- On Save → persist + `loadProfiles()` + `syncService.initiateSync()` (existing flow `:287-294`).
- On "no greeting detected" → prominent "Generate a greeting" CTA (P2) / "author one" prompt.
- (Optional) surface the previously-dead `importSuccess` toast on save.

## Implementation steps

1. Create `TagChips` (shared) → `CreatorAttributionBadge` → `GreetingEditor` (live preview) → `AlternateGreetingsManager` → `ImportReviewSheet`.
2. Extend `CharacterProfileEditScreen` with the new sections + state (camelCase↔snake_case mapping).
3. Wire `ImportReviewSheet` into `CharactersScreen` import flow.
4. Tests: editor round-trips new fields; `ImportReviewSheet` detection (greeting/alt/lore/tags/provenance); preview resolves macros; reduced-motion.

## Verification

- [ ] `GreetingEditor` (live preview, macros resolved), `AlternateGreetingsManager` (reorder + mark-default), `CreatorAttributionBadge` (source read-only), `TagChips` (shared), `ImportReviewSheet` created.
- [ ] `CharacterProfileEditScreen` has all new sections; camelCase↔snake_case mapping at load/save.
- [ ] `CharactersScreen` opens `ImportReviewSheet` post-parse, before persist; no-greeting CTA.
- [ ] `characters.json` extended.
- [ ] `npx tsc --noEmit` + tests pass; `gitnexus_detect_changes()`.

## Notes / deviations

- **[00 §A16](00-VerificationAndGroundTruth.md):** import is a FAB speed-dial item, not a header action; no success toast today.
- **[00 §A12](00-VerificationAndGroundTruth.md):** snake_case DB fields ↔ camelCase screen state.
- UJB/`{{original}}` surfacing detail is [3-6](3-6-AppGuidedModeAndUjbSurfacing.md).
