# Phase 3: Test Studio Pickers & Engine Result

## Objective

Redesign the TTS test studio so the user can (a) see which kinds of tags the
model supports, (b) insert tags by kind through pickers, and (c) SEE the exact
string the engine handed to the provider — demonstrating the
`*asterisks* → [brackets]` translation that is otherwise invisible.

Depends on: Phase 1 (typed `audio_tags`) + Phase 2 (shared capability view).
No engine changes (the route already supports everything below).

## Context (verified)

- `ModuleConfigEditScreen.tsx:1322-1327` renders `TtsTestPanel` with
  `providerType`, `accountId`, `capability`,
  `paralinguisticTags={getSpeechOptions(selectedTtsModel)?.paralinguistic_tags}`.
- `TtsTestPanel.tsx`: `paralinguisticTags` flat chips (`:724-761`,
  `MAX_INLINE_TAGS = 20`), `insertTag` appends the literal `[tag]` (`:697-701`),
  `TtsTagPickerModal` searchable flat list (`:862-870`), `synthesize()` posts
  `text`/`provider`/`model`/`capability_json` (`:486-538`) and ignores the rest
  of the response.
- `TtsTagPickerModal.tsx`: `sortTags` alphabetical, `tags: string[]`, stable
  `testID`s via `paralinguisticTagTestIds.ts` (`tts-tag-row:<slug>`, search
  `tts-tag-search`, empty `tts-tag-empty`).
- Engine `management/routes_modules.go:719-767` returns `{status,
  audio_base64, format, input_text, text}` where `text` = exact provider string
  (`strings.Join(pieces, " ")`); `testSpeechRequest` (`:432-442`) accepts
  `vocalize_nonverbal` and `audio_tag_budget`. `TtsSpeechTestResponseDto`
  (`EngineApiClient.ts:726-735`) has only `[key: string]: unknown`.
- Locked decision 2 (owner-confirmed 2026-11-17): chips/picker insert **asterisk natural forms**
  (`*sighs*`, `*whispers*`, `*short pause*`), built from the kind's vocabulary
  words (NOT provider-native bracket strings). The engine classifier accepts
  exact/±s/±ing/±es spellings, so closed vocabularies (`laugh`, `groan`) also
  work. "Sent to TTS" shows the bracket output. Brackets remain TTS-boundary
  syntax only; stored/shown CHAT text never contains them.

## Design

```
[ Cues | Tones | Breaks ]        [ Search all… ]      ← segmented + picker
*sighs*  *laughs*  *clears throat*                  ← inline chips (per kind)

Sample text
*sighs* Well… *pause* I didn't expect that. *whispers* Come closer.

Sent to TTS                                    [engine-rendered]
[sighs] Well… [short pause] I didn't expect that. [whispers] Come closer.

Voice actions (VocalizeNonverbal)  [ OFF ]
Cue budget demo  [ 1 | 3 | 5 ]   (maps to audio_tag_budget)
[ ▶ Synthesize & Play Sample ]   [MP3] [⬇]
```

## Steps

1. `EngineApiClient.ts` — add typed `input_text?: string` and `text?: string`
   to `TtsSpeechTestResponseDto` (additive; index signature stays).
2. `ModuleConfigEditScreen.tsx` — pass `audioTags={getAudioTagCapabilities(
   catalog, slots.provider?.providerType, selectedTtsModelId)}` and
   `legacyTags` (flat list fallback) to `TtsTestPanel`; keep `paralinguisticTags`
   prop for backward compatibility/old engines.
3. `TtsTestPanel.tsx`
   - New optional `audioTags?: AudioTagCapabilitiesDto` prop. Derive per-kind
     word lists (cues/tones/breaks vocabularies, mode ≠ none); fall back to
     splitting the legacy flat list (`[x]` → `x` → `*x*`).
   - `insertTag(tag)` receives the ASTERISK form (`*word*`); keep the same
     trim/append behavior.
   - Replace the single chip row with a segmented kind switch (Cues/Tones/
     Breaks; hidden when a kind is `none`) + the active kind's chips. Cap inline
     chips at a per-kind `MAX_INLINE_TAGS` (keep 20 or lower, e.g. 8 per kind),
     with `[+ N more]` opening the picker restricted to that kind.
   - `TtsTagPickerModal` receives **grouped** tags:
     `sections: {kind, label, tags}[]` (or a `kinds` map). Preserve all existing
     `testID`s; add `tts-tag-section-<kind>` headers. When a kind filter is set,
     show only that section; "Search all…" opens unfiltered. Alphabetical sort
     stays per section.
   - Keep state: `res.text` → `synthText`, `res.input_text` → `inputText`;
     render a "Sent to TTS" monospace box (collapsible; hidden until a sample
     exists) + show the input echo in a muted line. Clear both on a new
     synthesis; do NOT include them in `synthesisFingerprint` (display only).
   - Add a `VocalizeNonverbal` switch (default off, matching engine default)
     and a cue-budget demo `[1|3|5]` (default 3) → post
     `vocalize_nonverbal` + `audio_tag_budget` in `testTtsSpeech`. Include both
     in `synthesisFingerprint` so changing a toggle re-synthesizes rather than
     replaying stale audio.
   - Add 2-3 preset sample scripts (tap to fill the input) that exercise
     cue+tone+break and a narrative action (`*sits down*`), so the
     VocalizeNonverbal matrix is audible.
   - Preserve player/download/keep-awake behavior untouched.
4. `paralinguisticTagTestIds.ts` — extend `paralinguisticTagSlug` to handle
   `*word*` forms (strip asterisks), so `testID`s stay stable for chips and rows.
5. Tests: grouped picker sections + search filter; asterisk insertion;
   "Sent to TTS" from `res.text`; toggles posted; fingerprint invalidation;
   old-engine legacy fallback; `eleven_multilingual_v2` → no chips/pickers.

## Files

- `src/services/engine/EngineApiClient.ts`
- `src/screens/config/ModuleConfigEditScreen.tsx`
- `src/components/config/TtsTestPanel.tsx`
- `src/components/config/TtsTagPickerModal.tsx`
- `src/components/config/paralinguisticTagTestIds.ts`
- `src/components/config/__tests__/{TtsTestPanel,TtsTagPickerModal}.test.tsx`
- `src/screens/config/__tests__/*` (if the new props affect a screen test)

## Checklist

- [ ] Kinded segmented pickers + grouped modal (stable testIDs preserved)
- [ ] Asterisk insertion; "Sent to TTS" shows bracket output
- [ ] `vocalize_nonverbal` + `audio_tag_budget` wired through the fingerprint
- [ ] Preset sample scripts + none-state for tag-free models
- [ ] Player/download/keep-awake unchanged; tests pass; nothing committed
