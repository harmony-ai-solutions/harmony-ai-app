# 2-3 — App: TTS Playback Test Block

> Repo: `harmony-ai-app` (branch `senju-design-updates-rebase`). Protocol + gates as 2-1. Consumes the PINNED contract from `1-2-EngineModuleTestAPI.md`.

## Objective

A test block on the TTS config editor (`ModuleConfigEditScreen`, `moduleType === 'tts'` — used for AI entities; personas never speak, confirmed ruling): text input → "Play" → engine synthesizes with the *draft* config → playback via the existing audio player. Users hear exactly what the entity would produce.

## Implementation steps (TDD)

1. Extend `moduleTestClient` (from 2-2) with `testTts(cfg, text)` → `{ audio_base64, mime_type }` per pinned contract; tests with contract-shaped mocks (happy + error).
2. **`<TtsTestPanel />`** (same location convention as SttTestPanel): props `{ draftConfig }`; text input (multiline, sensible default sample text via i18n), Play/Stop button, loading state, playback via the app's existing player (`AudioPlayer`/TrackPlayer — reuse the chat playback path; base64 data-URL handling as done for avatars/audio elsewhere), error state with endpoint message, offline state ("Connect to Harmony Link to test").
3. Mount into `ModuleConfigEditScreen` when `moduleType === 'tts'`, passing current draft form state.
4. i18n keys (en).

## Files

- `moduleTestClient` (+ tests), `<TtsTestPanel />` (+ tests where feasible)
- `src/screens/config/ModuleConfigEditScreen.tsx` (mount)
- i18n locale files

## Gates

- tsc = 0 · targeted + full jest green
- Commit: `feat(config): TTS playback test panel - synthesize and listen via engine (persona modules 2-3)`

## Checklist

- [x] RED client tests for testTts
- [x] Panel: input, play/stop, loading, playback, error, offline
- [x] Mounted on TTS editor, i18n, gates green, committed, docs updated

## Deviations

- **Reuses the same engine-HTTP client (`moduleTestClient`) as 2-2** — `testTts` was added to the existing client (single source of truth; the engine HTTP/`/events`-strip + Bearer JWT pattern documented in 2-2 applies wholesale to TTS). Tests use contract-shaped mocked HTTP (`audio_base64` + `mime_type`), no live engine.
- **Playback** reuses the existing `AudioPlayer` (TrackPlayer) via `playAudio(base64, mime_type)` — the same data-URL handling used for chat voice messages (`data:${mimeType};base64,${...}` is built inside `AudioPlayer`). "Stop" calls `AudioPlayer.stop()`.
- **Mount on the TTS config editor** is gated on a selected provider (`buildTtsTestDraft` returns null until `formValues.provider` is set), consistent with the 2-2 STT mount. Personas never speak (confirmed ruling), so the panel only appears in the AI-entity TTS editor — not the Voice input screen.
- **Default sample text** is a `moduleConfig` i18n key; the panel uses the `moduleConfig` namespace (matches the config-editor context).
