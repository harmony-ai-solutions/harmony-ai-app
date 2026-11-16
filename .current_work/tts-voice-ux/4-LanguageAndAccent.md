# Phase 4: Language & Accent (repurposed selector)

## Objective

Repurpose the existing Language picker so it also serves **accents** on the
ElevenLabs v3/v4 family. Chatterbox Multilingual keeps its language picker
(HSE language names); EL accents are multi-word bracket tags injected ONCE per
utterance at the TTS boundary by the engine.

Depends on: Phase 1/2 (capability resolution). Requires small ENGINE companions
(both repos). **Owner-confirmed 2026-11-17: Option A** (full engine companion).
Option B is retained for reference only.

## Context (verified)

- `ProviderSlotSection.tsx:932-1059` `renderTtsVoiceAndLanguage()` is gated to
  `SOUL_TTS_PROVIDERS = ['soulbitscloud','soulvoice']`; it reads
  `state.capability.language` / `.voice` and uses `SelectPicker` with
  `normalizeTtsLanguageOptions(speechOptions.languages)`. HSE live metadata
  supplies `languages` (`soulvoice.go:soulvoiceLanguagesAndVoices`); the static
  catalog declares NONE (`catalog_data.json` has 0 `languages` keys).
- EL: `elevenSpeechOptions` exposes `language_code` as a generation param
  (`supported_generation_params`), but accents are NOT a language code — they
  are EL v3 audio tags like `[British accent]`, `[Australian accent]`,
  `[strong X accent]` (ElevenLabs docs). The engine's `audio_tags` vocabularies
  deliberately do NOT contain accents (out of scope in the engine plan, locked
  decision 10: "accents belong to the UI/UX workstream … engine later gains a
  voice-config field → start-tag injection").
- Engine translator gotcha (`modules/tts/cue.go:318-354, 493-525`): bracket
  input resolves every part via `classifySpanPart`; in open mode an unknown
  phrase falls through `cuePassThrough` → **head token only**. So
  `[British accent]` typed into the sample text becomes `[British]`. Accents
  MUST bypass inline classification: inject the rendered start tag after
  `PrepareTtsTextWithBudgets`, before `RenderPieces`.
- Guard: only models with ANY `audio_tags` kind enabled (EL v3/v4). NEVER offer
  accents on `eleven_multilingual_v2` / `eleven_turbo_v2_5` — those are
  officially tag-free and would SPEAK the tag aloud.

## The two options (owner asked for examples)

### Option A — full engine companion (OWNER-CONFIRMED, LOCKED)

Config: user picks "British accent" → `capability.accent = "British accent"`.

| Where | What happens |
|---|---|
| Test studio | `POST /api/module-configs/tts/test-speech` → `handleTestSpeech` prepends `[British accent]` → provider string `[British accent] [sighs] Hello…`; "Sent to TTS" shows it |
| Real chat | Every AI utterance from `TTSModule.renderSpeech` gets the same prefix — no user action per message |
| Storage/chat text | Unchanged: `*sighs* Hello…` (asterisk dialect); the accent tag is NEVER stored or shown in chat |

The accent is a *voice property*, set once, applied to everything the AI says.

### Option B — test-studio-only (defer the engine part)

Only the test route gains an `accent` request field; the config selector is
shown in the test studio only.

| Where | What happens |
|---|---|
| Test studio | Sample sounds British: `[British accent] Hello…` |
| Real chat | NO accent — the AI keeps its default voice. The picker is a preview toy, not a voice setting |

Option B is a half feature; it needs an engine change anyway (test route), so A
is barely larger. **Not chosen** — retained for reference only; do not implement
the B variant.

## Steps

### App (this repo)

1. `renderTtsVoiceAndLanguage()` → `renderLanguageAndAccent()`:
   - Soul TTS: unchanged `language` option source + `language` capability key.
   - EL (tag-capable models): `Accent` `SelectPicker` sourced from
     `speech_options.accents` (engine-seeded display strings, e.g.
     `"British accent"`, `"American accent"`, `"Australian accent"`,
     `"French accent"`, `"German accent"`, `"Irish accent"`, `"pirate voice"`),
     writing `capability.accent`. Value = the tag WORD (without brackets);
     display can show `[British accent]` to teach the boundary syntax.
   - Keep the "declared metadata only" rule: no fabricated accent list. An
     empty/absent list → no row. A saved value missing from the list is shown
     as-is (same pattern as languages/voices at `:964-973`).
   - Both rows reuse `styles.halfCol` / `twoColRow`; never show an accent row
     for a tag-free model.
2. `ModuleConfigEditScreen` — pass the resolved `audio_tags` (Phase 1) to the
   capability section; ensure `accent` is in `capability_json` sent by
   `TtsTestPanel` (it already forwards the whole `capability` object).
3. i18n: `accent`, `accentLocked`, `accentNoneHint`, `accentBoundaryHint`.

### Engine companions (harmony-link-private)

4. Catalog: seed `speech_options.accents` for EL v3/v4 in `curated.json`
   (derived/generated into `catalog_data.json` via the existing generator; add
   to `elevenSpeechOptions` live synthesis through `CatalogAudioTagCapabilities`)
   — engine-owned vocabulary, same single-source-of-truth principle as
   `paralinguistic_tags` (Phase 9).
5. `config.TTSConfig` / a tiny helper: read `capability_json.accent` (string,
   tolerate JSON-string-wrapped overlays like `AudioTagCapabilitiesFromCapability`).
6. `TTSModule.renderSpeech` (`modules/tts.go:310-344`): after
   `PrepareTtsTextWithBudgets`, if a validated accent is set AND any
   `audio_tags` kind is enabled, prepend `capabilities.Template(word)` as its
   own piece ONCE (not counted in cue/tone budgets, not affected by
   VocalizeNonverbal). `management.handleTestSpeech` mirrors the same helper
   and includes it in the returned `text` (test == production).
7. Validation: accent must be in the seeded list (fail-safe: unknown → no tag),
   lowercase-insensitive; never inject on tag-free models.
8. Engine tests: start tag appears once, on models with tags only; unknown
   accent ignored; budgets unaffected; test-route parity; `-check` catalog regen
   green; `go test ./...` (47 packages) green.

## Files

- App: `src/components/config/ProviderSlotSection.tsx`,
  `src/screens/config/ModuleConfigEditScreen.tsx`,
  `src/components/config/__tests__/ProviderSlotSection.test.tsx`, i18n `en`.
- Engine: `tools/gen-model-catalog/input/curated.json`,
  `providers/catalog_data.json` (regen), `providers/elevenlabs.go`,
  `config/types.go` (helper), `modules/tts.go`,
  `management/routes_modules.go`, tests in both.

## Checklist

- [x] Owner confirmed Option A (2026-11-17); Option B retained for reference
- [ ] Language row preserved for Chatterbox Multilingual; accent row for EL v3/v4 only
- [ ] Engine seeds + start-tag injection in renderSpeech AND test route
- [ ] Guard: tag-free models never receive an accent tag
- [ ] App + engine tests green; catalog `-check` green
- [x] Plan docs committed on explicit owner request (2026-11-17); implementation still uncommitted
