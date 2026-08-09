# 2-1 — Go `BuildScenarioGreetingPrompt` (4th builder mode)

> **Phase 2.** Depends on P1 (model columns, macro engine). Read [`00-VerificationAndGroundTruth.md`](00-VerificationAndGroundTruth.md) first.
> **Repo:** `harmony-link-private/`.

## Objective

Add a fourth prompt-builder mode alongside conversational/beat/compaction: `BuildScenarioGreetingPrompt(profile, instruction)` for **random** (instruction empty) and **directed** (user instruction) greeting generation. This is the single builder shared by `GENERATE_GREETING` (first custom / regenerate) and `START_NEW_SCENARIO` (scenario restart) — only the invocation point + interaction lifecycle differ.

## Ground truth (verified — [00 §B.1](00-VerificationAndGroundTruth.md))

- Existing builder modes in `modules/cognition/prompt_builder.go`: `BuildSystemPrompt:1215` (conversational), `BuildBeatSystemPrompt:1148` (beat), `BuildCompactionSummaryPrompt:2008` (compaction), plus `BuildDreamBeatUserPrompt:1929`, `BuildOutreachBeatUserPrompt:1408`, `BuildOutreachDecisionPrompt:1464`.
- `buildSystemPromptCharacterSection:178` reads Name/Description/Personality/Scenario/Appearance/Backstory/ExampleDialogues (`:180-205`).
- `buildBasePromptSection:999-1008` emits `BasePrompt` RAW → **wire macro resolution here** ([1-7](1-7-MacroEngine.md), [00 §A1](00-VerificationAndGroundTruth.md)).
- `SendComplexPromptSync` `modules/backend.go:185` (→ `client.go:35`) — the generation call (template: `fireOutreachBeat` `runner.go:618`).
- Lore retrieval is **not** part of this subtask (P3, [3-3](3-3-GoLoreRetrievalInPromptBuild.md)) — leave a clearly-marked hook for it.

## Design

`BuildScenarioGreetingPrompt(profile *models.CharacterProfile, instruction string, opts ...) (*PromptBuildResult, error)`

- **System prompt:** reuse `BuildSystemPrompt` base + character section (`buildSystemPromptCharacterSection`). Apply `ResolveMacros` ([1-7](1-7-MacroEngine.md)) to all character text (`description`, `scenario`, `mes_example`, `post_history_instructions`) and to `base_prompt` (`{{original}}` → cognition base prompt; `{{char}}`/`{{user}}`).
- **User prompt:** a dedicated scenario-generation instruction, e.g.:
  > "Write {charName}'s opening message. Set the scene in-character. Do not speak for {{user}}. Honor the user's direction if provided."
  Inject `mes_example` as few-shot voice guidance. Fold in the user instruction (directed mode) or omit (random). **Random fallback chain** (because `scenario` is often empty): `scenario → description → backstory → mes_example → first_mes` (as style cue) to infer setting/tone/voice.
- **Post-history:** append `post_history_instructions` (ujb) after the (empty) history, before the assistant turn — wires the previously-dropped ujb field into the build for the first time.
- **Macro invariant:** every `{{…}}` resolved before the prompt reaches `SendComplexPromptSync` (no leakage — [1-7](1-7-MacroEngine.md)).
- **Lore hook (P3 prep):** leave a `// P3: inject top-N lore entries here` marker where `BuildScenarioGreetingPrompt` will union in RAG lore (top-N semantic + `constant`).

## Files to modify — Go

### `modules/cognition/prompt_builder.go`

- Add `BuildScenarioGreetingPrompt` near the other `Build*` functions. Follow the `PromptContext`/`PromptBuildResult` shape used by `BuildSystemPrompt`.
- Update `buildBasePromptSection` (`:999-1008`) to resolve `{{original}}`/`{{char}}`/`{{user}}` via `ResolveMacros` ([1-7](1-7-MacroEngine.md)) — this is the fix for [00 §A1](00-VerificationAndGroundTruth.md). (Confirm whether to apply resolution globally here or only in the scenario path; recommended: apply in the base section so every consumer benefits, and audit other callers for breakage.)

### `modules/cognition/macros.go` (from [1-7](1-7-MacroEngine.md))

- Ensure `ResolveMacros` is importable from `prompt_builder.go`.

## Implementation steps

1. Run `gitnexus_impact({target:"BuildSystemPrompt",direction:"upstream"})` + `gitnexus_impact({target:"buildBasePromptSection",direction:"upstream"})` — report blast radius before editing the base section.
2. TDD: write a `BuildScenarioGreetingPrompt` test (random: empty instruction → prompt built from profile fallback chain; directed: instruction folded into user prompt; macros fully resolved; ujb appended).
3. Implement the builder + base-section macro wiring.
4. Tests green.

## Verification

- [ ] `gitnexus_impact` run on `BuildSystemPrompt` + `buildBasePromptSection`.
- [ ] `BuildScenarioGreetingPrompt` added (random + directed); reuses character section; appends ujb; applies macros.
- [ ] `buildBasePromptSection` resolves `{{original}}`/`{{char}}`/`{{user}}` (no raw leakage).
- [ ] Lore hook marked for P3.
- [ ] No `{{…}}` in the returned prompt (assertion in test).
- [ ] `go test ./modules/cognition/...` passes.

## Notes / deviations

- **[00 §A1](00-VerificationAndGroundTruth.md):** the macro engine is net-new; `buildBasePromptSection` does not resolve today.
- Lore retrieval is P3 ([3-3](3-3-GoLoreRetrievalInPromptBuild.md)) — this subtask leaves a marker, not the query.
