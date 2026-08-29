# 2-3 — Engine Reaction Awareness (Cognition Reads + AI-Authored Reactions)

> Phase 2 / repo: **harmony-link-private**. Contract: `21-Engine-Contract` §5.4, Q3 addendum.
> Prerequisite: 2-1/2-2.

## Objective (user ruling Q3)

"On the next cognition cycle or lifecycle event, the AI may notice the reactions (or update a message with its own
reaction, similar to how this is done in the audio data update path)."

Two deliverables:

## 1. Reactions visible to cognition

- `modules/cognition/prompt_builder.go`: add a lightweight **reactions context** to the history/parallel-interaction
  sections — when assembling recent-message context (`PromptContext`, `base.go:182-239`; history section
  `prompt_builder.go:1172+`), annotate messages carrying non-empty `reactions_json` with a compact rendering
  (e.g. `[reactions: 😂, ❤️]`) appended to that message's context line. Pure-builder change, no new sections.
- `lifecycle/beat_memory_provider.go` / beat prompt path (`BuildBeatSystemPrompt`, `prompt_builder.go:1209-1261`):
  no dedicated beat changes in this phase — beats that query recent messages automatically see the annotations
  via the shared context assembly. (Scope guard: do NOT build a new "reaction analysis" beat.)

## 2. AI-authored reactions

- The AI can attach its own emoji reaction to a (recent) user message. Mechanism, mirroring `updateMessageAudio`
  (`modules/cognition.go:521-557`):
  - Wire shape: an optional `additional_effects`-adjacent field on the backend response is overkill — instead reuse
    the existing emoji-action channel: the thought processor's `applyAdditionalEffects`
    (`modules/cognition/processor.go:388-408`) currently applies emotion deltas from emoji actions. Add a sibling
    effect type `reaction` `{target_message_id, emoji}` emitted by the backend (model-dependent; gated behind the
    same `generate_expressions` module setting that governs emoji behavior — if the module flag is off, nothing
    changes).
  - On receipt: `UpdateConversationMessageActions` merges the emoji into the target message's `reactions_json`
    (JSON array; append if absent, no dedupe drama — same toggle semantics as the app's
    `handleReactToMessage`, `ChatDetailScreen.tsx:857-898`: array rewrite) + bump `updated_at` → syncs down.
  - Target resolution: most recent user-sent message in the interaction (no message-id targeting wire in this
    phase — the backend doesn't know app message ids; document this simplification).
- Both features are **AI-entity-only paths** (they run inside the AI's ThoughtProcessor; user entities never get
  one — 5-2).

## Tests

- [ ] Prompt snapshot: history lines show reaction annotations when present, nothing when empty
- [ ] Reaction effect: appends to `reactions_json`, bumps `updated_at`, persists; second effect appends (no dup of same emoji)
- [ ] `generate_expressions` off → no behavior change
- [ ] `go build ./...`; `go test ./...`; `gitnexus_impact` on `applyAdditionalEffects`/prompt builder symbols;
      `gitnexus_detect_changes()` before committing
