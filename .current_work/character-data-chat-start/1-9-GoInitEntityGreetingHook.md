# 1-9 — Go `handleInitEntity` Greeting Hook (4 guards + `has_first_mes`)

> **Phase 1.** Depends on [1-2](1-2-GoCharacterProfileModelAndSync.md), [1-8](1-8-GoGreetingDeliveryPrimitives.md), [1-7](1-7-MacroEngine.md). Read [`00-VerificationAndGroundTruth.md`](00-VerificationAndGroundTruth.md) first.
> **Repo:** `harmony-link-private/`.

## Objective

Inject the greeting hook into `handleInitEntity` **immediately after `ResolveInteraction` succeeds**, emitting the authored `first_mes` as a `greeting` message **only when all 4 guards pass**. This hook emits the **authored** greeting only — generation (random/directed/scenario-restart) is the separate `GENERATE_GREETING` path ([2-2](2-2-GoGenerateGreetingEvent.md)). Also surface **`has_first_mes: boolean`** in the INIT_ENTITY SUCCESS payload so the app branches synchronously.

## Ground truth (verified — [00 §B.1](00-VerificationAndGroundTruth.md), [§A4–A7](00-VerificationAndGroundTruth.md), [§A21](00-VerificationAndGroundTruth.md))

- `handleInitEntity` `eventserver/eventprocessor.go:145`; `ResolveInteraction` called `:233` (60-min gap `:237`); injection point `~:241-246` (after the interactionID assignment).
- `ResolveInteraction` `config/db/handler.go:838` may **resume** within the 60-min window (`:867-882` via `FindActiveInteraction`). `CloseStaleEmptyInteractions` call `:863` (def `interactions.go:159`) reaps stale empties first.
- **Truly-new-chat gate primitives:** `FindPriorInteractions` `repository/interaction/interactions.go:279` (private scope `:285`) returns **ALL** historical interactions for the pair (any status/time) — **no `config/db/handler.go` wrapper exists**. Message count via `GetConversationMessagesByInteraction` `messages.go:175` (`len()==0`). ([00 §A5](00-VerificationAndGroundTruth.md))
- `initEntityResponse` `eventprocessor.go:137-143`; marshalled fresh `:263` AND resume `:364-368` (same struct) — add `has_first_mes` once, populate both paths ([00 §A7](00-VerificationAndGroundTruth.md)).
- `DeliverGreeting` (built in [1-8](1-8-GoGreetingDeliveryPrimitives.md)).

## The 4 guards (all mandatory)

1. **Truly-new-chat gate (do NOT trust the 60-min resume threshold).** Fire **only** when:
   - (a) the resolved interaction has **zero messages**: `len(GetConversationMessagesByInteraction(tx, interactionID)) == 0`; AND
   - (b) **no prior interaction WITH MESSAGES exists for the pair**: a new `config/db/handler.go`-level wrapper (`HasPriorConversation`, see below) returns false — i.e. none of the prior interactions for the pair has any messages.
   
   **Decision (E1-loose — overrides concept E1 per orchestrator direction):** gate on "no prior interaction WITH MESSAGES" AND "zero messages on the resolved interaction". This closes the strict-E1 edge case: an empty/abandoned prior interaction (auto-created by a previous `INIT_ENTITY` that never received a message) does NOT block the greeting. The wrapper must count messages on each prior interaction (`FindPriorInteractions` → for each, `COUNT(messages WHERE interaction_id = ?) > 0`). On resume (existing interaction within 60 min), do nothing.
2. **Idempotency.** Persist the greeting as a `conversation_messages` row with `message_type="greeting"` (reusing the existing `message_type` column — no schema change). Guard = **no existing `message_type="greeting"` row for this interaction**. (Query the messages repo for a greeting row by interaction_id; if present, skip.)
3. **Autonomy-independence.** Fire at `autonomy_level 0`; do NOT consult/update `lastOutreachTime`. Satisfied by construction — `DeliverGreeting` ([1-8](1-8-GoGreetingDeliveryPrimitives.md)) is a separate path that skips the outreach cooldown.
4. **Bypass the reactive `len<=1` drop.** Satisfied by construction — `DeliverGreeting` persists + emits directly (not through `ENTITY_UTTERANCE`).

> If the card has **no** `first_mes`, the hook emits **nothing** (the chat opens empty + app hint). No generic fallback is ever emitted.

## Delivery shape

Copy the `fireOutreachBeat` template (`runner.go:618`) at the delivery level, but with no LLM call (authored delivery is a DB read + macro resolution):
1. Resolve interaction (already done by `ResolveInteraction`).
2. Load the `CharacterProfile` for the character entity → read `first_mes` (raw).
3. If `first_mes` is empty → set `has_first_mes=false`, emit nothing.
4. Else → `resolved = ResolveMacros(firstMes, charName, userName, original)` ([1-7](1-7-MacroEngine.md)); `charName = profile.Nickname || profile.Name`; `userName` = the own/client entity display name; `original` = the cognition base prompt. Call `DeliverGreeting(entityID, targetEntityID, interactionID, resolved, emotionalStateBits)`; set `has_first_mes=true`.

## Files to modify — Go

### `config/db/handler.go` (new wrapper)

Add a handler-level wrapper for the prior-conversation check (none exists today, [00 §A5](00-VerificationAndGroundTruth.md)):
```go
// HasPriorConversation returns true if any prior interaction for the entity pair
// (other than excludeInteractionID, private scope) has at least one message —
// i.e. the pair has had a real conversation before.
// Wraps controllers.FindPriorInteractions + a message-count check per result.
func HasPriorConversation(ctx context.Context, entityID, participantKey, excludeInteractionID string) (bool, error)
```
(Mirror the existing handler→controller→repository layering; `participantKey` via `DeriveParticipantKey` `interaction_controller.go:53-74`. Implementation: call `FindPriorInteractions` → for each result, `COUNT(conversation_messages WHERE interaction_id = ?) > 0`; short-circuit on first hit.)

### `eventserver/eventprocessor.go`

1. In `handleInitEntity` (`:145`), after the injection point (`~:246`), call the greeting hook:
   - Run guard 1 (zero messages on resolved interaction + no prior conversation with messages) via the new `HasPriorConversation` wrapper + `GetConversationMessagesByInteraction`.
   - Run guard 2 (no existing `greeting` row).
   - If both pass and `first_mes` non-empty → `DeliverGreeting(...)`; `hasFirstMes=true`. Else `hasFirstMes=false`.
2. Add `has_first_mes` to `initEntityResponse` (`:137-143`): `HasFirstMes bool `json:"has_first_mes,omitempty"` ` (mirror `Resumed bool` `:142`).
3. Populate `HasFirstMes` in **both** the fresh-init path (`:263`) and the resume path (`:364-368`) — on resume it is always `false` (no greeting injected on resume), or `omitempty` it.

### Tests

- `handleInitEntity` greeting-hook unit/integration test: truly-new chat (no prior interaction) → greeting persisted + `has_first_mes=true`; **prior interaction WITHOUT messages (empty/abandoned) → greeting STILL fires** (E1-loose); prior interaction WITH messages → nothing; resume → nothing; zero `first_mes` → nothing + `has_first_mes=false`; idempotency (second init with a greeting row) → nothing.

## Implementation steps

1. Run `gitnexus_impact({target:"handleInitEntity",direction:"upstream"})` — HIGH blast radius expected (central handler). Report it.
2. Add the `HasPriorConversation` wrapper (`config/db/handler.go`) + a controller/repository path if needed (the repository function `FindPriorInteractions` already exists; add the per-interaction message-count check on top).
3. Add the 4-guard hook + `has_first_mes` field.
4. TDD: the greeting-hook test cases above.

## Verification

- [ ] `gitnexus_impact` run on `handleInitEntity` (report blast radius).
- [ ] `HasPriorConversation` wrapper added (checks for prior interaction WITH messages, not just existence).
- [ ] Hook fires only when: zero messages on resolved interaction AND no prior conversation with messages AND no existing greeting row AND `first_mes` non-empty.
- [ ] `has_first_mes` in `initEntityResponse` (both paths).
- [ ] Autonomy-independent; does not touch outreach cooldown.
- [ ] `go test ./eventserver/... ./config/...` passes.
- [ ] `gitnexus_detect_changes()` — expected scope (init flow + greeting delivery).

## Notes / deviations

- **[00 §A5](00-VerificationAndGroundTruth.md):** `FindPriorInteractions` has no handler wrapper and returns all-history; this subtask adds the `HasPriorConversation` wrapper (existence + message-count) + uses E1-loose ("no prior conversation with messages") per orchestrator direction — overrides the concept's strict E1.
- **[00 §A7](00-VerificationAndGroundTruth.md):** populate `has_first_mes` in both init paths.
- Generation paths (`GENERATE_GREETING`, `START_NEW_SCENARIO`) are **not** in this subtask — they land in P2 ([2-2](2-2-GoGenerateGreetingEvent.md), [2-3](2-3-GoStartNewScenarioHandler.md)).
