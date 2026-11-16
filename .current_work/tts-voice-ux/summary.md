# Voice & Context UX — Implementation Plan Summary

Plan folder: `.current_work/tts-voice-ux/` (app repo, harmony-ai-app)
Created: 2026-11-17
Status: **design agreed with owner; plan docs committed 2026-11-17; implementation not started**
Companion engine plan: `harmony-link-private/.current_work/audio-tags/` (Phases 1-9
committed as `03a416a`); its optional Phase 6 (`6-AppCatalogSurface.md`) is the
sketch this plan expands. That engine doc is left untouched on purpose (no new
uncommitted engine diff); this summary links back to it.

## Overview

The engine now owns a kinded audio-tag capability model (cues / tones / breaks ×
`none | closed | open`), translates `*asterisk spans*` to provider tags at the
TTS boundary, gates prompt vocabulary by a per-entity vocal expressiveness
level, and derives `speech_options.paralinguistic_tags` from `audio_tags`. None
of that is visible in the app yet. This plan:

1. makes the kinded capability data visible in the TTS config and test studio,
2. adds kinded pickers + shows the engine-rendered provider string in the test studio,
3. repurposes the language selector into a Language / **Accent** row (EL accents
   are multi-word bracket tags injected once per utterance by the engine),
4. combines the expressiveness display with two long-desired features into ONE
   coherent "Character state" surface: a live **emotional-state indicator**
   (toggle in chat settings) and a **memory + RAG collection browser**.

## Verified current state (app + engine, 2026-11-17)

- `GET /api/providers/capabilities` serves `providers.CatalogModel` directly →
  `audio_tags` **is on the wire** (`json:"audio_tags,omitempty"`), but the app's
  `CatalogModelDto` does not declare it and `catalogModelToModelInfo` drops it.
- Live model descriptors (elevenlabs / soulvoice `speech_options` synthesis)
  carry the derived flat `paralinguistic_tags` but NOT `audio_tags`. The app's
  `ProviderSlotSection` prefers live models (`liveModels ?? catalog…`), so the
  kinded block must be resolved by **(providerType, modelId) in the tier-2
  catalog**, not from the selected descriptor's meta. Both screens already hold
  `catalog` from `useProviderCapabilityCatalog()`.
- `ModuleConfigEditScreen.tsx:1322-1327` passes only
  `getSpeechOptions(selectedTtsModel)?.paralinguistic_tags` to `TtsTestPanel`;
  `TtsTagPickerModal` is a flat searchable list; `MAX_INLINE_TAGS = 20`.
- Stale hardcoded 5-tag fallback lists in `resolveEffectiveSpeechOptions`
  (`modelCapabilities.ts:271-277`) and `ProviderSlotSection.tsx:1135-1140`
  contradict the engine's de-tagged Chatterbox base/multilingual decision.
- Engine test route (`routes_modules.go:719-767`) already returns `input_text`
  and `text` (exact provider string) and accepts `vocalize_nonverbal` +
  `audio_tag_budget`; the app ignores both. `TtsSpeechTestResponseDto` has only
  an index signature.
- Accent gotcha (verified in `modules/tts/cue.go`): bracket input in open mode
  falls through `cuePassThrough`, which keeps ONLY THE HEAD TOKEN —
  `[British accent]` → `[British]`. Accents therefore CANNOT be inline text
  chips; they need a start-tag injection from voice config (the engine plan's
  locked decision 10: "engine later gains a voice-config field → start-tag").
- Emotion: `GET /api/entities/:id/emotion` → 8 Ekman intensities + baselines +
  crystallization timestamps (`EmotionState` / `emotion_state.ts` repository,
  read-only; engine owns writes). No live emotion event exists in the app → v1
  is pull-based (chat focus + after each assistant turn). `EKMAN8_EMOTIONS`
  lives in `src/types/emoji.ts`.
- Memories: `GET /api/entities/:id/memories` (paginated, `compaction_level`,
  `emotional_state_bits`, dates) → `memories.ts` repository (read-only).
- RAG collections: engine has `GET /api/entities/:id/rag/collections`,
  `/:name` (info + stats), `/:name/documents` (+ archetype/category filters),
  `/:name/documents/:docId` (details), `/:name/test-query`, groups routes
  (`management/server.go:648-678`, `routes_rag.go`). The app has NO client
  methods/DTOs for them yet — additive app work.
- `vocal_expressiveness` is on `config.CharacterProfileConfig` with a JSON tag;
  `handleListCharacterProfiles` marshals the struct directly, so it is on the
  wire; the app's `CharacterProfileDto` does not declare it yet.
- Chat surfaces: `ScreenHeader` supports `titleRight` / `right` ReactNodes +
  `subtitle`; `ChatDetailScreen.tsx:2901+` renders the in-chat overflow menu;
  `ChatConversationMenuModal.tsx` holds per-chat toggles (pin/archive/mute/
  reply pacing). i18n has exactly ONE locale (`en`).

## Locked decisions (owner, 2026-11-17)

1. **Kinded data source of truth = tier-2 catalog** `audio_tags` resolved by
   (provider, modelId); flat `paralinguistic_tags` remains the legacy fallback
   for older engines. Never fabricate capabilities.
2. **Insertion dialect = asterisk natural forms** (`*sighs*`, `*whispers*`,
   `*short pause*`) in the test studio; the "Sent to TTS" box shows the
   engine-rendered bracket output. Brackets remain a TTS-boundary-only syntax.
   **Owner-confirmed and locked 2026-11-17.**
3. **Accents = Option A (full engine companion) — OWNER-CONFIRMED 2026-11-17** —
   config-level selector + engine start-tag injection so real chat AND the test
   studio both apply the accent. Option B (test-studio-only, runtime chat keeps
   the default voice) remains documented in `4-LanguageAndAccent.md` for
   reference only. Nothing is implemented yet.
4. **Expressiveness is displayed READ-ONLY** (engine-derived, stored explicitly;
   owner decision "derived, not a manual knob"). No editable 3-way knob in v1.
5. **Combine** expressiveness + emotion indicator + memory/RAG browser into one
   "Character state" bottom sheet, entered via a tappable mood chip in the chat
   header. Toggle "Show emotional state" lives in chat settings; v1 stores the
   preference app-locally (AsyncStorage, per participantKey) — NO engine change.
6. **No user-editable vocabularies in v1** (engine-seeded). No SFX/staging/IPA.
   Bracket-free storage invariant (asterisks only in stored/shown chat text).
   Telemetry stays at DEBUG.

## Phases

- **Phase 1: Catalog Data Plumbing** ([1-CatalogDataPlumbing.md](1-CatalogDataPlumbing.md)) —
  `audio_tags` DTO + hook + typed accessor, stale fallback cleanup.
- **Phase 2: Capability Display** ([2-CapabilityDisplay.md](2-CapabilityDisplay.md)) —
  "Voice expression" block in the TTS config card, per-kind badges and none-states.
- **Phase 3: Test Studio Pickers** ([3-TestStudioPickers.md](3-TestStudioPickers.md)) —
  kinded pickers, asterisk insertion, "Sent to TTS", VocalizeNonverbal + budget demo.
- **Phase 4: Language & Accent** ([4-LanguageAndAccent.md](4-LanguageAndAccent.md)) —
  repurposed selector + engine start-tag companion (both repos).
- **Phase 5: Character State & Emotion** ([5-CharacterStateAndEmotion.md](5-CharacterStateAndEmotion.md)) —
  mood chip, chat-settings toggle, emotion panel, expressiveness card.
- **Phase 6: Memory & RAG Browser** ([6-MemoryAndRagBrowser.md](6-MemoryAndRagBrowser.md)) —
  new RAG client methods, memories timeline + collection/document browser.
- **Phase 7: i18n, Tests & Docs** ([7-I18nTestsAndDocs.md](7-I18nTestsAndDocs.md)) —
  `en` strings, test matrix, docs verification.

## Implementation Status

- [ ] **Phase 1: Catalog Data Plumbing** ([1-CatalogDataPlumbing.md](1-CatalogDataPlumbing.md))
- [ ] **Phase 2: Capability Display** ([2-CapabilityDisplay.md](2-CapabilityDisplay.md))
- [ ] **Phase 3: Test Studio Pickers** ([3-TestStudioPickers.md](3-TestStudioPickers.md))
- [ ] **Phase 4: Language & Accent** ([4-LanguageAndAccent.md](4-LanguageAndAccent.md))
- [ ] **Phase 5: Character State & Emotion** ([5-CharacterStateAndEmotion.md](5-CharacterStateAndEmotion.md))
- [ ] **Phase 6: Memory & RAG Browser** ([6-MemoryAndRagBrowser.md](6-MemoryAndRagBrowser.md))
- [ ] **Phase 7: i18n, Tests & Docs** ([7-I18nTestsAndDocs.md](7-I18nTestsAndDocs.md))

## Engine companions (small; both repos tested)

- `speech_options.accents` display list seeded in the catalog (engine-owned
  vocabulary, like `paralinguistic_tags`), EL v3/v4 rows only.
- `TTSConfig` reads `capability_json.accent`; `TTSModule.renderSpeech` and
  `management.handleTestSpeech` prepend the template-rendered start tag ONCE
  per utterance (after `PrepareTtsTextWithBudgets`, before `RenderPieces`),
  outside cue/tone budgets; guard = any `audio_tags` kind enabled (never the
  tag-free v2 family — they speak tags aloud).
- App-side new client methods for existing engine RAG collection routes.

## Open items

- [x] Accent Option A confirmed by owner (2026-11-17)
- [ ] Emotion live-update event (engine sync) — v2; v1 polls.
- [ ] RAG write paths (engine `PUT`/`DELETE` document + group routes exist) —
      v1 browser is read-only + test-query; editing deferred.
- [ ] Engine `6-AppCatalogSurface.md` pointer/refresh — on request.
- Standing rule: never commit implementation work unless explicitly asked
  (these plan docs were committed on an explicit owner request, 2026-11-17).
