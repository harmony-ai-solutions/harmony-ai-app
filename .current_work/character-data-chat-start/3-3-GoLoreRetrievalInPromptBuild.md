# 3-3 — Go Lore Semantic Retrieval in Prompt Build

> **Phase 3.** Depends on [3-1](3-1-GoLoreRagCollection.md), [3-2](3-2-GoLoreEmbedding.md), [1-7](1-7-MacroEngine.md). Read [`00-VerificationAndGroundTruth.md`](00-VerificationAndGroundTruth.md) first.
> **Repo:** `harmony-link-private/`.

## Objective

At prompt-build time, run a **semantic query** over recent conversation context and inject the **top-N** matching lore entries (unioned with `constant` entries) into the system prompt. **Follow the established processor pre-fetch pattern** — the builder does NOT run queries ([00 §A3](00-VerificationAndGroundTruth.md)).

## Ground truth (verified — [00 §B.1](00-VerificationAndGroundTruth.md), [§A3](00-VerificationAndGroundTruth.md))

- `BuildSystemPrompt` `prompt_builder.go:1215` consumes pre-fetched `PromptContext` (`modules/cognition/base.go:177-253`) — **no RAG handle**. `RecalledMemories:195`, `CoreMemories:197`, `CurrentChatHistory:199`.
- Processor pre-fetch pattern: `ThoughtProcessor.generateComplexBackendPrompt` `processor.go:824-871` — query text from last message of `CurrentChatHistory` (`:835-840`); `FetchRecalledMemoriesForContext` (`:842`, helper `state.go:100-120`); feed `ctx.RecalledMemories` (`:855`); `BuildSystemPrompt` (`:871`).
- Top-N + `constant` union + dedup precedent: `buildSystemPromptMemorySection` `prompt_builder.go:220-272` (dedup `:244-259`, "P-01").
- Processor holds `c.memoryService rag.MemoryService` (`processor.go:57`), refreshed by `RefreshMemoryService` (`:246-249`).
- `LoreService` from [3-1](3-1-GoLoreRagCollection.md); nil-store → empty.

## Design (corrected from concept — [00 §A3](00-VerificationAndGroundTruth.md))

The concept's "the prompt builder runs a semantic query" is **inaccurate**; the builder has no RAG handle. Instead:

1. **Pre-fetch (processor side):** in `generateComplexBackendPrompt` (`processor.go:824-871`), alongside the memory fetch (`:842`), add a lore fetch:
   - query text = recent conversation context (last N messages — mirror the spec's `scan_depth` intent; reuse the same query-text derivation as memory, `:835-840`).
   - `loreEntries := loreService.QueryLore(ctx, queryText, topN)` (nil-service → empty).
   - Union `constant` entries (always injected) — either query `QueryLore` with a `constant=true` metadata filter, or fetch a larger N and filter; **decision: add a `QueryConstantLore()` method to `LoreService`** returning all `constant=true` entries, unioned + deduped with the top-N.
2. **Feed the builder:** add `RecalledLore []LoreEntry` (or reuse a generic structure) to `PromptContext` (`base.go:177-253`); populate it in the processor.
3. **Inject in the builder:** add a `buildSystemPromptLoreSection` (mirroring `buildSystemPromptMemorySection:220-272`) that emits the recalled lore (top-N) + constant lore, deduped, into the system prompt. Apply `ResolveMacros` ([1-7](1-7-MacroEngine.md)) to each entry's `content` (and trim `@@` decorators from the *emitted* text — they are preserved verbatim in the JSON column for export, [concept 01 §2.4](../character-data-chat-start-concept/01-data-and-engine-concept.md)).
4. **Nil-service tolerance:** empty `RecalledLore` → section omitted.

> `BuildScenarioGreetingPrompt` ([2-1](2-1-GoBuildScenarioGreetingPrompt.md)) consumes the same recalled lore — fill the P3 lore hook left in [2-1](2-1-GoBuildScenarioGreetingPrompt.md).

## Files to modify — Go

### `modules/rag/base.go` ([3-1](3-1-GoLoreRagCollection.md))

- Add `QueryConstantLore() ([]QueryTextResultElement, error)` to `LoreService` (or fetch constants via metadata filter in `QueryLore`).

### `modules/cognition/base.go`

- Add `RecalledLore` (and a `ConstantLore`) field to `PromptContext` (`:177-253`).

### `modules/cognition/processor.go`

- In `generateComplexBackendPrompt` (`:824-871`): after the memory fetch (`:842`), fetch lore (top-N + constants); populate `ctx.RecalledLore`/`ctx.ConstantLore` before `BuildSystemPrompt` (`:871`). Hold a `loreService rag.LoreService` (`:57`-style), refreshed via a `RefreshLoreService` wired in [3-1](3-1-GoLoreRagCollection.md).

### `modules/cognition/prompt_builder.go`

- Add `buildSystemPromptLoreSection` (mirror `:220-272`) emitting top-N + constant (deduped), macros resolved, `@@` decorators trimmed.
- Call it from `BuildSystemPrompt` (`:1215`) near the memory section.
- Fill the lore hook in `BuildScenarioGreetingPrompt` ([2-1](2-1-GoBuildScenarioGreetingPrompt.md)).

## Implementation steps

1. Run `gitnexus_impact({target:"BuildSystemPrompt",direction:"upstream"})` + `ThoughtProcessor`/`generateComplexBackendPrompt` — report blast radius.
2. TDD: lore section builder (top-N + constant union + dedup; macros resolved; `@@` trimmed; empty → omitted).
3. Wire the processor pre-fetch + `PromptContext` field.
4. Fill the `BuildScenarioGreetingPrompt` lore hook.

## Verification

- [ ] `gitnexus_impact` run.
- [ ] `QueryConstantLore` (or filter) added; `RecalledLore`/`ConstantLore` on `PromptContext`.
- [ ] Processor pre-fetches lore (nil-service → empty); builder consumes it.
- [ ] `buildSystemPromptLoreSection`: top-N + constant union + dedup; macros resolved; `@@` trimmed.
- [ ] `BuildScenarioGreetingPrompt` lore hook filled.
- [ ] No `{{…}}` leaks; `go test ./modules/cognition/... ./modules/rag/...` passes.

## Notes / deviations

- **[00 §A3](00-VerificationAndGroundTruth.md):** retrieval follows the **processor pre-fetch pattern**, NOT "builder runs the query". This is the key correction.
- Accepted trade-off (concept §1.4): semantic matching, not keyword/regex; `selective`/`position`/`token_budget`/`@@` are stored for export only; only `constant` is honored behaviourally.
