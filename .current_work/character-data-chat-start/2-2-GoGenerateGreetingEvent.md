# 2-2 — Go `GENERATE_GREETING` Event Handler (random / directed / regenerate)

> **Phase 2.** Depends on [2-1](2-1-GoBuildScenarioGreetingPrompt.md), [1-8](1-8-GoGreetingDeliveryPrimitives.md). Read [`00-VerificationAndGroundTruth.md`](00-VerificationAndGroundTruth.md) first.
> **Repo:** `harmony-link-private/`.

## Objective

Add the `GENERATE_GREETING` event for **user-initiated** greeting generation: `mode: 'random' | 'directed'`, optional `guided: { mood, setting, relationship, timeOfDay, whoFirst, premise }`. Serves the **first custom greeting** and **regenerate** ("generate another"). The engine generates via `BuildScenarioGreetingPrompt` + `SendComplexPromptSync`, persists the result as a `message_type="greeting"` message (replacing the existing greeting while still on the opening turn), and signals failure (no fabricated fallback).

## Ground truth (verified — [00 §B.1](00-VerificationAndGroundTruth.md), [§A6](00-VerificationAndGroundTruth.md))

- Event constants `events/events.go:7-127` (`INIT_ENTITY:15`). Dispatch `IsHandlerFor:99-115` + `HandleEvent:117-133` + `routeIncomingEvent:974-1040` (hard-error default `:1034-1038`). `SendEvent:78-97`.
- A new inbound event MUST be registered in `IsHandlerFor`/`HandleEvent` or `routeIncomingEvent` raises "none of the active modules has a receiver" ([00 §A6](00-VerificationAndGroundTruth.md)).
- Generation call: `SendComplexPromptSync` `modules/backend.go:185` (template `fireOutreachBeat` `runner.go:618`).
- `BuildScenarioGreetingPrompt` from [2-1](2-1-GoBuildScenarioGreetingPrompt.md); `DeliverGreeting` from [1-8](1-8-GoGreetingDeliveryPrimitives.md).

## Design

**Event payload (app → engine):**
```jsonc
{
  "event_type": "GENERATE_GREETING",
  "data": {
    "entity_id": "<character>",
    "target_entity_id": "<own/client>",
    "interaction_id": "<current>",
    "mode": "random" | "directed",
    "guided": { "mood": [], "setting": "", "relationship": "", "timeOfDay": "", "whoFirst": "character"|"user", "premise": "" }  // directed only
  }
}
```

**Precondition (regenerate gate — concept §3.5):** `GENERATE_GREETING` regenerate-mode is only allowed while the greeting is the **only** message in the interaction (no user/character turn has happened yet). Verify via `GetConversationMessagesByInteraction` (`messages.go:175`) — if more than the single greeting row exists, reject with an error (the client should use `START_NEW_SCENARIO` instead, [2-3](2-3-GoStartNewScenarioHandler.md)).

**Handler flow:**
1. Resolve interaction (the payload's `interaction_id`).
2. Enforce the regenerate precondition (≤ 1 message, and that message is the greeting).
3. Load `CharacterProfile`; build `instruction` from `guided` (directed) or `""` (random).
4. `BuildScenarioGreetingPrompt(profile, instruction)` → `SendComplexPromptSync(system, user)`.
5. On success: resolve macros on the generated text; **replace** the existing greeting message (delete the old `message_type="greeting"` row, insert the new) OR update it in place; emit to the live session. (Persist via the messages repo; reuse the persistence shape from `DeliverGreeting` [1-8](1-8-GoGreetingDeliveryPrimitives.md).)
6. On failure: signal failure (do NOT fabricate a fallback — concept §3.2); the app informs the user of a backend issue. The chat stays as it was.

> The authored `first_mes` is **never** auto-generated (it was delivered at init by [1-9](1-9-GoInitEntityGreetingHook.md)); this path only produces a *replacement* greeting on user demand.

## Files to modify — Go

### `events/events.go`

Add `EVENT_TYPE_GENERATE_GREETING = "GENERATE_GREETING"` (near `:15`).

### `eventserver/eventprocessor.go`

- Register in `IsHandlerFor` (`:99-115`) + `HandleEvent` (`:117-133`).
- Add `handleGenerateGreeting(event)` mirroring the shape of `handleInitEntity` (`:145`) for payload parsing + response. Implement the flow above.
- Return a SUCCESS payload (e.g. `{ "greeting": "...", "interaction_id": "..." }`) or ERROR.

### Tests

- random mode → generates + replaces greeting; directed mode → instruction folded; regenerate precondition violated (conversation started) → ERROR; generation failure → ERROR (no fallback); macros resolved in the persisted greeting.

## Implementation steps

1. Run `gitnexus_impact({target:"routeIncomingEvent",direction:"upstream"})` — report blast radius.
2. Add the event constant + handler registration.
3. Implement `handleGenerateGreeting` (TDD).
4. Wire the failure path (no fabrication).

## Verification

- [ ] `gitnexus_impact` run.
- [ ] `GENERATE_GREETING` registered (constant + `IsHandlerFor` + `HandleEvent`).
- [ ] Random + directed modes work; macros resolved; greeting replaced.
- [ ] Regenerate precondition enforced (ERROR if conversation started).
- [ ] Failure → ERROR, no fabricated fallback.
- [ ] `go test ./eventserver/...` passes.

## Notes / deviations

- **[00 §A6](00-VerificationAndGroundTruth.md):** must register the event or hit the hard-error default.
- Scenario restart (`START_NEW_SCENARIO`) is a separate event ([2-3](2-3-GoStartNewScenarioHandler.md)) — it force-creates a new interaction rather than replacing the greeting in-place.
