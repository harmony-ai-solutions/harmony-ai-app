# 2-4 — App `ScenarioGeneratorSheet` + Generate / Regenerate UX

> **Phase 2** (frontend). Depends on P1 ([1-10](1-10-AppGreetingRenderUx.md)) + engine events ([2-2](2-2-GoGenerateGreetingEvent.md), [2-3](2-3-GoStartNewScenarioHandler.md)). Read [`00-VerificationAndGroundTruth.md`](00-VerificationAndGroundTruth.md) first.
> **Repo:** `harmony-ai-app/`.

## Objective

Enable the P1-disabled composer ✨ icon + ✨ Scenario pill; add the `ScenarioGeneratorSheet` (guided inputs); wire `GENERATE_GREETING` (first custom / regenerate) and `START_NEW_SCENARIO` (scenario restart). Show the `GreetingShimmer` "preparing" state during generation, render the arriving greeting, and handle failure (inform user of a backend issue — no fabrication). The engine decides replace-vs-restart from conversation state.

## Ground truth (verified — [00 §B.2](00-VerificationAndGroundTruth.md), [§A15–A20](00-VerificationAndGroundTruth.md))

- `GreetingBubble`/`GreetingShimmer`/`AlternateGreetingSwiper`/`EmptyChatCTA`/`useReducedMotion` + `scenario` i18n namespace from [1-10](1-10-AppGreetingRenderUx.md).
- No `@gorhom/bottom-sheet` → `ScenarioGeneratorSheet` uses **react-native-paper `Modal`+`Portal`** ([00 §A18](00-VerificationAndGroundTruth.md)). Precedent: `ImpersonationSelectorModal.tsx:212-217`, `SelectPicker.tsx:8/72`.
- `ChatInput.tsx:1461`; `ChatDetailScreen.tsx` FlatList `:1364`, `ChatInput:1461`.
- `EntitySessionService` dispatches events (e.g. INIT_ENTITY dispatch `:479-500`) — add `GENERATE_GREETING` / `START_NEW_SCENARIO` dispatch helpers there.
- i18n `scenario` namespace created in P1; consume its keys (`mood`, `setting`, `relationship`, `timeOfDay`, `whoStarts`, `premise`, `surpriseMe`, `generate`, `generating`, `generateAnother`, `preparingOpening`, `generateFailedBackend`, `scenarioRestart`).

## Components to create

### `src/components/chat/ScenarioGeneratorSheet.tsx`

A paper `Modal`+`Portal` bottom sheet ([00 §A18](00-VerificationAndGroundTruth.md)) with the guided inputs (concept 02 §2.2):
- **Mood / Tone** — multi-select chips (`TagChips` from P3, or a local chip row here).
- **Setting / Location** — free text + quick suggestions.
- **Relationship** — `SelectPicker` (`src/components/config/SelectPicker.tsx`).
- **Time of day** — optional chips.
- **Who speaks first** — toggle (character default / user).
- **Scene premise** — multiline free text.
- **"Surprise me"** — clears all inputs (= random).
- **Generate** — collapses the sheet → emits the event.

Props: `open`, `onClose`, `onGenerate(guidedInputs | null)` (null = random/surprise), `suggestions`.

### `src/components/chat/TagChips.tsx` (dual-use: editor + filter)

> Conceptually listed in P3 ([3-5](3-5-AppProfileEditorSectionsAndImport.md)), but the `ScenarioGeneratorSheet` mood chips can use a lightweight local chip row to avoid the P3 dependency. **Decision: build the mood row inline in the sheet for P2; promote to a shared `TagChips` in P3.**

## Files to modify

### `src/services/EntitySessionService.ts`

Add dispatch helpers (mirror the INIT_ENTITY dispatch shape `:479-500`):
```ts
async generateGreeting(payload: { entityId; targetEntityId; interactionId; mode; guided? }): Promise<{ greeting; interactionId }>
async startNewScenario(payload: { entityId; targetEntityId; mode; guided? }): Promise<{ greeting; interactionId }>
```
Register the response handlers (`GENERATE_GREETING`, `START_NEW_SCENARIO`) alongside `handleInitEntityResponse` (`:1062`).

### `src/screens/ChatDetailScreen.tsx`

- **Composer ✨ icon** (`ChatInput:1461`): enable it (was disabled in P1). Shown whenever input empty (chat open and mid-conversation), vanishing on typing. Tapping opens `ScenarioGeneratorSheet`.
- **✨ Scenario pill** beside `AlternateGreetingSwiper` (discoverability) — opens the same sheet.
- On `onGenerate`:
  - If the greeting is still the only message → dispatch `GENERATE_GREETING` (replace).
  - If the conversation has started → dispatch `START_NEW_SCENARIO` (restart); on SUCCESS, **swap the active `interactionId`** in the chat UI + trigger a **blocking sync** to fetch the new interaction + its first message before unblocking.
- Show `GreetingShimmer` + "preparing an opening…" (`TypingIndicator`) while in flight (the `GreetingBubble` `preparing` state from P1).
- On the new/updated `message_type="greeting"` message arriving → render via `GreetingBubble` (`arrived`).
- On failure → non-blocking toast/alert (`scenario.generateFailedBackend`); chat stays as-is.
- **Regenerate swipe:** in `AlternateGreetingSwiper`, the "⟳ Generate another" affordance dispatches `GENERATE_GREETING` (gated: only while greeting is the only message — the engine enforces too, [2-2](2-2-GoGenerateGreetingEvent.md)). Generated greetings are ephemeral messages — only the chosen opener persists.

### `src/components/chat/AlternateGreetingSwiper.tsx`

- Enable the regenerate slot (disabled in P1): when the user swipes past the last authored greeting (or taps ⟳), show a shimmer slot + dispatch `GENERATE_GREETING`.

## Implementation steps

1. Create `ScenarioGeneratorSheet` (paper `Modal`+`Portal`, guided inputs, "Surprise me").
2. Wire `EntitySessionService` dispatch + response handlers for both events.
3. Wire `ChatDetailScreen`: enable ✨ icon + pill, dispatch logic (replace vs restart), `GreetingShimmer` preparing state, failure toast, interaction-id swap + blocking sync for restart.
4. Enable `AlternateGreetingSwiper` regenerate slot.
5. Tests: sheet open/close; random vs directed payload; replace vs restart dispatch; shimmer → arrived; failure toast; reduced-motion sheet cross-fade.

## Verification

- [ ] `ScenarioGeneratorSheet` (paper `Modal`+`Portal`) with all guided inputs + "Surprise me".
- [ ] `EntitySessionService`: `generateGreeting` + `startNewScenario` dispatch + response handlers.
- [ ] Composer ✨ icon + ✨ pill enabled; dispatch logic correct (replace vs restart).
- [ ] `GreetingShimmer` preparing state during generation; arriving greeting rendered.
- [ ] Restart: interaction-id swap + blocking sync.
- [ ] Failure → toast, no fabrication, chat intact.
- [ ] `AlternateGreetingSwiper` regenerate slot enabled.
- [ ] Reduced-motion: sheet cross-fade, shimmer → static skeleton.
- [ ] `npx tsc --noEmit` + tests pass; `gitnexus_detect_changes()`.

## Notes / deviations

- **[00 §A18](00-VerificationAndGroundTruth.md):** no gorhom — paper `Modal`+`Portal` only.
- **No streaming** (backend has none) — the "preparing" shimmer is the sole latency affordance (concept 02 §2.1).
- `TagChips` is promoted to a shared component in P3 ([3-5](3-5-AppProfileEditorSectionsAndImport.md)); P2 uses an inline chip row in the sheet.
