# 1-8 — Go Greeting Delivery Primitives (`DeliverGreeting`, `message_type="greeting"`)

> **Phase 1.** Depends on [1-2](1-2-GoCharacterProfileModelAndSync.md), [1-7](1-7-MacroEngine.md). Read [`00-VerificationAndGroundTruth.md`](00-VerificationAndGroundTruth.md) first.
> **Repo:** `harmony-link-private/`.

## Objective

Add the engine-side primitives that persist + deliver an authored greeting as a first-class `message_type="greeting"` message, **autonomy-independent** and **bypassing the reactive cognition `len<=1` drop**. Use a **separate `DeliverGreeting`** (not a parameterized `DeliverOutreach`) to avoid `SessionManagerCallback` interface churn. This subtask builds the *delivery primitive*; the `handleInitEntity` *hook* that calls it is [1-9](1-9-GoInitEntityGreetingHook.md).

## Ground truth (verified — [00 §B.1](00-VerificationAndGroundTruth.md), [§A4](00-VerificationAndGroundTruth.md), [§A21](00-VerificationAndGroundTruth.md))

- `DeliverOutreach` `eventserver/session.go:296` (sig: `entityID, targetEntityID, channel, message string, emotionalStateBits int64`). **Live path does NOT persist** (`UpdateCognitionOnUtterance` `:317-331`); offline path persists with hardcoded `MessageType:"outreach"` (`:339-352`). Does NOT touch `lastOutreachTime`.
- `DeliverOutreach` is on `SessionManagerCallback` (`lifecycle/session.go:24`); impl `EntitySessionManager`; call site `runner.go:743` — parameterizing it churns all three → use a separate `DeliverGreeting`.
- Reactive `len<=1` drop: `modules/cognition.go:727-730` (case `ENTITY_UTTERANCE` `:719`) — a greeting routed through the reactive handler would be dropped; deliver directly.
- `message_type` is free TEXT (`conversation.go:16`, default `'text'`); `'dream'` precedent (`000016:37`). **No schema change** to add `'greeting'`.
- Message persistence repo: `database/repository/conversation/messages.go` (`GetConversationMessagesByInteraction:175`, etc.); model `database/models/conversation.go:9-39` (`MessageType string:16`), sync twin `ConversationMessageSync:42-72` (`:49`), `ToSyncModel`/`ToDBModel` pass `MessageType` through (`:80`,`:126`).

## Design

`DeliverGreeting` does **two things unconditionally** (unlike `DeliverOutreach`, whose live path skips persistence):

1. **Persist** a `conversation_messages` row: `message_type="greeting"`, `sender_entity_id` = character entity, `interaction_id` = resolved interaction, `content` = macro-resolved `first_mes` ([1-7](1-7-MacroEngine.md)), with an initial `emotional_state_bits` (seed the character's default emotion, mirroring outreach at `session.go:296`). The profile's `first_mes` column stays **raw** (export fidelity).
2. **Emit** to the live phone session (if any): deliver the persisted message to the event stream so the app renders it immediately. If no live session, the row is still persisted and arrives via sync.

It must:
- **NOT** consult or update `lastOutreachTime` (autonomy-independent — fires at autonomy 0).
- **NOT** route through the reactive `ENTITY_UTTERANCE` handler (bypass the `len<=1` drop).
- **NOT** start the beat runner (the beat runner is already gated `autonomy_level>0` at `eventprocessor.go:214`, independent of this).

## Files to modify — Go

### `database/models/conversation.go`

- Update the `MessageType` doc comment (`:16`) to include `'greeting'`. (No type change — it's a free string.)

### `eventserver/session.go`

Add `DeliverGreeting` alongside `DeliverOutreach` (`:296`):
```go
// DeliverGreeting persists a greeting message (message_type="greeting") and emits it
// to the live phone session if present. Autonomy-independent; does NOT touch the
// outreach cooldown; bypasses the reactive ENTITY_UTTERANCE handler.
func (m *EntitySessionManager) DeliverGreeting(entityID, targetEntityID, interactionID, content string, emotionalStateBits int64) error
```
Body:
1. Resolve macros is done by the **caller** ([1-9](1-9-GoInitEntityGreetingHook.md)) — `content` arrives already resolved. (Or accept raw + a `ResolveMacros` dep; pick one and keep it consistent. Recommended: caller resolves, primitive persists as-given — keeps the primitive simple and testable.)
2. Persist: insert a `ConversationMessage{ MessageType:"greeting", SenderEntityID: entityID, InteractionID: interactionID, Content: content, EmotionalStateBits: emotionalStateBits }` via the messages repository (open a tx or use the existing create path).
3. Emit: if `m.IsPhoneSession() && m.EventProcessor != nil`, push the message to the event stream (mirror the live-emit shape in `DeliverOutreach:317-331`, but as a finished greeting message, not a cognition input). If no live session, the persisted row arrives via sync — nothing more to do.

### Consumer audit (`message_type="greeting"` — [00 §A21](00-VerificationAndGroundTruth.md))

Audit and confirm `'greeting'` is not mis-routed:
- `GetOldestUncompactedMessages` (`messages.go:365`) excludes `'dream'` — decide whether greeting messages should be exempt from compaction like dream, or compact normally. **Decision: greetings are normal messages → compact normally** (do not add an exclusion).
- Dream queries (`messages.go:399`,`:431`) filter `'dream'` — unaffected.
- `processor.go:1261-1265` / `cognition.go:783-787` message-type derivation — confirm a `'greeting'` row is treated as a normal partner message for cognition/history purposes (it should appear in chat history; it should NOT trigger a reactive response — the greeting is a finished message, not an utterance to respond to).

## Implementation steps

1. Run `gitnexus_impact({target:"DeliverOutreach",direction:"upstream"})` — understand the delivery pattern + consumers (do **not** change `DeliverOutreach`).
2. Add `DeliverGreeting` in `session.go` (TDD: test persist + emit shape; test it does NOT touch `lastOutreachTime`; test live-vs-offline).
3. Update the `conversation.go:16` doc comment.
4. Audit the `message_type` consumers above; document the compaction decision.
5. Add a unit test for the persistence + emission.

## Verification

- [ ] `gitnexus_impact` run on `DeliverOutreach` (reference) + new `DeliverGreeting` once added.
- [ ] `DeliverGreeting` persists a `message_type="greeting"` row unconditionally (live and offline).
- [ ] It does NOT touch `lastOutreachTime`; it does NOT route through the reactive handler.
- [ ] `conversation.go:16` doc comment updated.
- [ ] `message_type` consumer audit done + compaction decision documented (greetings compact normally).
- [ ] `go test ./eventserver/... ./database/...` passes.

## Notes / deviations

- **[00 §A4](00-VerificationAndGroundTruth.md):** the critical correction — `DeliverOutreach`'s live path does NOT persist, so the greeting primitive must persist explicitly. Do not "just copy `DeliverOutreach`".
- The hook in [1-9](1-9-GoInitEntityGreetingHook.md) is what actually decides whether to call `DeliverGreeting` (the 4 guards).
