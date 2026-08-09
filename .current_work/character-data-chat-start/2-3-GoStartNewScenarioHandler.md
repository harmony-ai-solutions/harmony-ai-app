# 2-3 — Go `START_NEW_SCENARIO` (Scenario Restart) Handler

> **Phase 2.** Depends on [2-1](2-1-GoBuildScenarioGreetingPrompt.md), [1-8](1-8-GoGreetingDeliveryPrimitives.md). Read [`00-VerificationAndGroundTruth.md`](00-VerificationAndGroundTruth.md) first.
> **Repo:** `harmony-link-private/`.

## Objective

Implement mid-conversation **scenario restart** ("new scene"): the user taps the composer ✨ icon (or the ✨ Scenario pill) **after** the conversation has started; the engine **force-creates a brand-new interaction** for the same entity pair, seeds it with the generated scenario as its first `greeting` message, persists it, and emits the new `interaction_id` back to the app (which swaps the active interaction + blocking-syncs). The **same** `BuildScenarioGreetingPrompt` machinery is reused — only the invocation point + interaction lifecycle differ from [2-2](2-2-GoGenerateGreetingEvent.md).

## Ground truth (verified — [00 §B.1](00-VerificationAndGroundTruth.md), [§A6](00-VerificationAndGroundTruth.md))

- `ResolveInteraction` `config/db/handler.go:838` may **resume** within the 60-min window — restart must **force** a new interaction rather than let `ResolveInteraction` resume the just-closed one.
- Interaction creation/repository: `database/repository/interaction/interactions.go` + controllers (`interaction_controller.go`). `FindActiveInteraction` (`interactions.go:393-404`), `FindPriorInteractions` (`:279`).
- Event registration mandatory ([00 §A6](00-VerificationAndGroundTruth.md)).
- `BuildScenarioGreetingPrompt` ([2-1](2-1-GoBuildScenarioGreetingPrompt.md)); `DeliverGreeting` ([1-8](1-8-GoGreetingDeliveryPrimitives.md)); `SendComplexPromptSync` (`backend.go:185`).

## Design

**Event payload (app → engine):**
```jsonc
{
  "event_type": "START_NEW_SCENARIO",
  "data": {
    "entity_id": "<character>",
    "target_entity_id": "<own/client>",
    "mode": "random" | "directed",
    "guided": { … }  // directed only
  }
}
```
(Equivalent: `GENERATE_GREETING { scenario_restart: true }` — pick one transport. **Decision: dedicated `START_NEW_SCENARIO` event** for clarity, registered like `GENERATE_GREETING`.)

**Handler flow (concept §3.3):**
1. **Close** the current interaction for the pair (status=`closed`) — so the new one is distinct.
2. **Force-create** a new interaction (do NOT call `ResolveInteraction` — it would resume within the 60-min window). Insert a fresh `interactions` row (`status='active'`) for the pair.
3. Load `CharacterProfile`; build `instruction` (directed) or `""` (random).
4. `BuildScenarioGreetingPrompt(profile, instruction)` → `SendComplexPromptSync`.
5. On success: resolve macros; persist the generated scenario as the **first `message_type="greeting"` message** of the **new** interaction via `DeliverGreeting` ([1-8](1-8-GoGreetingDeliveryPrimitives.md)); emit to the live session.
6. Emit SUCCESS carrying the **new `interaction_id`** back to the app.
7. On failure: signal failure (no fabricated fallback); the current interaction is unchanged (do not close it on failure — or close + reopen; **decision: do not close the current interaction until generation succeeds**, to avoid leaving the user with neither).

## Files to modify — Go

### `events/events.go`

Add `EVENT_TYPE_START_NEW_SCENARIO = "START_NEW_SCENARIO"`.

### `config/db/handler.go` (or controllers)

Add a helper to **force-create** a new interaction (bypassing `ResolveInteraction`'s resume logic):
```go
// ForceCreateInteraction creates a brand-new active interaction for the pair,
// ignoring the 60-min resume window. Used by scenario restart.
func ForceCreateInteraction(ctx context.Context, entityID string, participantIDs []string, presenceType common.PresenceType) (*models.Interaction, error)
```
(May also close the prior interaction as part of this, or do it in the handler — pick the cleaner transactional boundary.)

### `eventserver/eventprocessor.go`

- Register `START_NEW_SCENARIO` in `IsHandlerFor`/`HandleEvent`.
- Add `handleStartNewScenario(event)` implementing the flow above.
- Return SUCCESS: `{ "interaction_id": "<new>", "greeting": "..." }`.

### Tests

- restart mid-conversation → new interaction created, old closed, greeting seeded in the new interaction, new `interaction_id` returned; failure → current interaction unchanged; macros resolved.

## Implementation steps

1. Run `gitnexus_impact({target:"ResolveInteraction",direction:"upstream"})` — understand resume logic (do not change it; add `ForceCreateInteraction` alongside).
2. Add `ForceCreateInteraction` (TDD).
3. Add the event constant + registration + `handleStartNewScenario` (TDD).
4. Failure-path: generation failure leaves the current interaction intact.

## Verification

- [ ] `gitnexus_impact` run on `ResolveInteraction` (reference).
- [ ] `ForceCreateInteraction` added (bypasses resume).
- [ ] `START_NEW_SCENARIO` registered + handler creates new interaction + seeds greeting + returns new id.
- [ ] Failure → no state corruption (current interaction intact).
- [ ] `go test ./eventserver/... ./config/...` passes.

## Notes / deviations

- This is the mid-conversation counterpart to `GENERATE_GREETING` ([2-2](2-2-GoGenerateGreetingEvent.md)); both reuse `BuildScenarioGreetingPrompt` ([2-1](2-1-GoBuildScenarioGreetingPrompt.md)).
- The app swaps the interaction ID + blocking-syncs (see [2-4](2-4-AppScenarioGeneratorSheetAndGenerateUx.md)).
