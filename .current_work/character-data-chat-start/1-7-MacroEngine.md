# 1-7 — Macro Engine `ResolveMacros` (net-new, both repos)

> **Phase 1 · cross-cutting.** Read [`00-VerificationAndGroundTruth.md`](00-VerificationAndGroundTruth.md) first. **Both repos.** Feeds: [1-8](1-8-GoGreetingDeliveryPrimitives.md), [1-9](1-9-GoInitEntityGreetingHook.md), [1-10](1-10-AppGreetingRenderUx.md), [2-1](2-1-GoBuildScenarioGreetingPrompt.md), [3-x](3-3-GoLoreRetrievalInPromptBuild.md).

## Objective

There is **no macro engine on either side today** (grep-confirmed, [00 §A1](00-VerificationAndGroundTruth.md) / greeting-track claim 12). Build a shared `ResolveMacros(text, charName, userName)` plus `{{original}}` resolution, with **different scope per side**:

- **App — authoring/preview only.** Resolved on interactive preview surfaces (greeting live-preview, "Preview opening", card-creation previews) using the **roleplay-selected entity** as `{{user}}` and `name`/`nickname` as `{{char}}`. On card-management screens (Greeting editor, Lorebook editor, `CharacterProfileEditScreen`) the raw macros are **kept visible but visually highlighted** (subtle accent chip/underline) — not silently resolved.
- **Engine — delivery & prompt-build.** Resolves for: (a) the static authored `first_mes` at delivery time (before persisting the `greeting` message; the profile column stays raw for export), (b) greeting generation, (c) all prompt-built text (`character_book` entry `content`, `description`, `scenario`, `mes_example`, `post_history_instructions`), (d) `{{original}}` in `base_prompt`/`post_history_instructions` → the user's own default system prompt/ujb.

**Invariant:** every prompt that reaches an LLM backend MUST have all macros fully resolved; no `{{…}}` may leak to the model.

## Spec reference (macros)

`SPEC_V3.md:564` (Curly Braced Syntaxes): `{{char}}` (`:570`) → `nickname` ‖ `name`; `{{user}}` → client display name; `{{original}}` → user's own default system prompt/ujb. Plus the standard SillyTavern macro set (`{{char}}`, `{{user}}`, `{{original}}`; the concept scope is these three plus any trivially-derived ones — keep it small, do not over-build).

## Design

A single pure function (per side), no I/O:

```
ResolveMacros(text, charName, userName, original?) -> string
  - {{char}}  -> charName            (nickname ?? name on the engine)
  - {{user}}  -> userName
  - {{original}} -> original ?? ""   (engine: the app-default system prompt/ujb; app-preview: "" or a placeholder marker)
  - case-insensitive matching; replace all occurrences
  - passthrough unknown {{...}} unchanged (do not strip)
```

- **Char-name precedence:** engine resolves `{{char}}` to `profile.Nickname` if non-empty else `profile.Name`. App-preview resolves to the editor's `name`/`nickname` field.
- **`{{original}}` on the engine:** = the user/entity's default system prompt (the cognition base prompt — see `buildCognitionBasePrompt`). Plumb it in as a parameter; do not hardcode.
- Keep the function side-effect-free and easily unit-testable.

## Files to create

### Go — `harmony-link-private/modules/cognition/macros.go` (or `utils/macros/macros.go`)

```go
// Package cognition (or a new macros util package).
// ResolveMacros expands {{char}}, {{user}}, {{original}} case-insensitively.
// Unknown macros are left unchanged.
func ResolveMacros(text, charName, userName, original string) string { … }
```
Choose a location consistent with `.planning/codebase/CONVENTIONS.md`. Add a `macros_test.go` (TDD).

### TS — `src/utils/macros.ts`

```ts
export function resolveMacros(
  text: string,
  charName: string,
  userName: string,
  original: string = '',
): string { … }
```
Add `src/utils/__tests__/macros.test.ts`.

## Wiring (this subtask establishes the function + minimal wiring; deeper wiring lands in the consuming subtasks)

- **Engine delivery (wired in [1-8](1-8-GoGreetingDeliveryPrimitives.md)):** `DeliverGreeting` resolves `first_mes` with `ResolveMacros(firstMes, charName, userName, original)` **before** persisting the `greeting` message. The profile column stays raw.
- **Engine prompt-build (wired in [2-1](2-1-GoBuildScenarioGreetingPrompt.md) / [3-3](3-3-GoLoreRetrievalInPromptBuild.md)):** `buildBasePromptSection` (`prompt_builder.go:999-1008`) currently emits `profile.BasePrompt` RAW — update it to resolve `{{original}}`/`{{char}}`/`{{user}}` (this is the fix for [00 §A1](00-VerificationAndGroundTruth.md)). Apply `ResolveMacros` to lore `content`, `description`, `scenario`, `mes_example`, `post_history_instructions` at the point they enter the prompt.
- **App preview (wired in [1-10](1-10-AppGreetingRenderUx.md) / [3-5](3-5-AppProfileEditorSectionsAndImport.md)):** the `GreetingBubble` live preview and "Preview opening" call `resolveMacros` with the editor's `name`/`nickname` and the roleplay-selected entity name.

## Implementation steps

1. **TDD:** write the macro tests first (case-insensitivity, char/user/original, unknown passthrough, empty original). Watch them fail.
2. Implement `ResolveMacros`/`resolveMacros`.
3. Tests green.
4. (Minimal wiring only here; full wiring in consuming subtasks.) Add a small helper `CharName(profile)` = `nickname || name` (Go) to centralize precedence.

## Verification

- [ ] `gitnexus_impact` not applicable (new symbol) — but run it once wired to catch consumers.
- [ ] Go `ResolveMacros` + `macros_test.go` (TDD: tests first).
- [ ] TS `resolveMacros` + `macros.test.ts` (TDD: tests first).
- [ ] Case-insensitive; unknown macros passthrough; `{{original}}` with empty `original` → `""`.
- [ ] `go test` + `npx jest macros` green.

## Notes / deviations

- **[00 §A1](00-VerificationAndGroundTruth.md):** the concept's framing that `buildBasePromptSection` is "for `{{original}}` resolution" is corrected — it emits raw today; this subtask adds the resolution.
- Scope is deliberately small (`{{char}}`/`{{user}}`/`{{original}}`); do not implement the full SillyTavern macro catalog (YAGNI).
