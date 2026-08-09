# 3-6 — App Guided-Mode Plumbing + UJB / `{{original}}` Surfacing

> **Phase 3** (frontend, finishing pass). Depends on [2-4](2-4-AppScenarioGeneratorSheetAndGenerateUx.md), [3-5](3-5-AppProfileEditorSectionsAndImport.md). Read [`00-VerificationAndGroundTruth.md`](00-VerificationAndGroundTruth.md) first.
> **Repo:** `harmony-ai-app/`.

## Objective

(1) Surface `post_history_instructions` (UJB) and `{{original}}` semantics in the Advanced section of the editor with explainer text + macro highlighting; (2) complete the guided-mode UX plumbing so the `ScenarioGeneratorSheet`'s guided inputs round-trip cleanly to `GENERATE_GREETING`/`START_NEW_SCENARIO` and persist any editor-driven scenario test; (3) ensure the macro-highlighting + preview rules are consistent across all card-management/preview surfaces.

## Ground truth (verified — [00 §B.2](00-VerificationAndGroundTruth.md), [§A1](00-VerificationAndGroundTruth.md))

- Macro engine `resolveMacros` ([1-7](1-7-MacroEngine.md)) — app scope is **preview only**; card-management screens keep macros **visible + highlighted** (concept 02 §3.1/§3.8).
- `ScenarioGeneratorSheet` ([2-4](2-4-AppScenarioGeneratorSheetAndGenerateUx.md)) already emits guided inputs; this subtask polishes the round-trip + adds UJB/`{{original}}` editor surfaces.
- `EntitySessionService` dispatch helpers (`generateGreeting`/`startNewScenario`) from [2-4](2-4-AppScenarioGeneratorSheetAndGenerateUx.md).

## Deliverables

### UJB / `{{original}}` editor surfaces (Advanced section — [3-5](3-5-AppProfileEditorSectionsAndImport.md))

- **`post_history_instructions`** (UJB) multiline editor + an explainer tooltip: *"Injected after the conversation history, before the character's turn."* Macros (`{{char}}`/`{{user}}`/`{{original}}`) **highlighted, not resolved** on this management screen.
- **`base_prompt`** (`system_prompt`) editor with a note that `{{original}}` expands to the user's own default system prompt at the engine (resolved server-side; never resolved in the editor).
- A small reusable `MacroHighlighter` helper (detect `{{char}}`/`{{user}}`/`{{original}}` and render as a subtle accent chip/underline) used by `GreetingEditor`, `LorebookEntryEditor`, and the Advanced fields. (Promotes the "highlighted macros" rule to one shared component.)

### Guided-mode plumbing completion

- Ensure the `ScenarioGeneratorSheet` guided inputs (`mood`, `setting`, `relationship`, `timeOfDay`, `whoFirst`, `premise`) map 1:1 to the `guided` object on `GENERATE_GREETING`/`START_NEW_SCENARIO` payloads ([2-2](2-2-GoGenerateGreetingEvent.md), [2-3](2-3-GoStartNewScenarioHandler.md)).
- "Surprise me" → clears inputs → `mode: 'random'` (no `guided`).
- Persist the result of an editor-driven `[Test scenario generation]` only on explicit "use this" (not auto-save) — generated greetings are ephemeral until chosen.

### Consistency pass

- All preview surfaces (`GreetingBubble` live preview, "Preview opening", card-creation previews) resolve macros via `resolveMacros` (roleplay-selected entity = `{{user}}`; name/nickname = `{{char}}`).
- All management surfaces (`GreetingEditor`, `LorebookEntryEditor`, Advanced UJB/base_prompt) use `MacroHighlighter` (visible + highlighted, not resolved).

## Files to create / modify

- `src/components/character-card/MacroHighlighter.tsx` (shared helper — accent chip/underline for `{{…}}`).
- `src/components/character-card/GreetingEditor.tsx` ([3-5](3-5-AppProfileEditorSectionsAndImport.md)) — use `MacroHighlighter` on the raw field; resolve only in the preview bubble.
- `src/components/character-card/LorebookEntryEditor.tsx` ([3-4](3-4-AppLorebookEditor.md)) — `MacroHighlighter` on `content`.
- `src/screens/CharacterProfileEditScreen.tsx` — Advanced section: `post_history_instructions` + `base_prompt` editors with explainers + `MacroHighlighter`.
- `src/components/chat/ScenarioGeneratorSheet.tsx` ([2-4](2-4-AppScenarioGeneratorSheetAndGenerateUx.md)) — confirm guided→payload mapping; "Surprise me" → random.
- Extend `characters.json` (`postHistoryInstructions`, `postHistoryHint`, `basePrompt`, `originalMacroHint`, …).

## Implementation steps

1. Create `MacroHighlighter`; adopt in the three management surfaces.
2. Add the Advanced UJB + base_prompt editors + explainers.
3. Confirm/fix the guided→payload mapping + "Surprise me" → random.
4. Tests: macros highlighted (not resolved) on management screens; resolved on preview; guided payload shape correct.

## Verification

- [ ] `MacroHighlighter` created + adopted in `GreetingEditor`, `LorebookEntryEditor`, Advanced UJB/base_prompt.
- [ ] Preview surfaces resolve macros; management surfaces highlight them.
- [ ] `post_history_instructions` + `base_prompt` editors + explainers in Advanced.
- [ ] Guided→payload mapping correct; "Surprise me" → `mode:'random'`.
- [ ] `npx tsc --noEmit` + tests pass.

## Notes / deviations

- **[00 §A1](00-VerificationAndGroundTruth.md):** `{{original}}` is resolved engine-side; the editor only highlights/explains it.
- This subtask closes P3's frontend scope; P4 (export + tags filtering) is independent.
