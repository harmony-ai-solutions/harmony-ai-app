# 2-3 — App: TTS Playback Test Block (eventserver transport)

> Repo: `harmony-ai-app` (branch `senju-design-updates-rebase`). **REWORKED 2026-09-02** — same correction as 2-2: eventserver protocol, no HTTP. TTS only works in the context of an AI entity + its module config → the AI entity is initialized in a transient `debug` session (engine 1-3; non-phone → no lifecycle, immediate cleanup).

## Pinned event contract (verified engine-side)

- INIT_ENTITY for the AI entity with `device_type: "debug"`.
- `TTS_GENERATE_SPEECH` payload: `TTSGenerateRequest { "utterance": { …Utterance fields… }, "tts_output_type": "binary" }` (inline audio; `"file"` writes a file — use `"binary"`).
- Response: `ENTITY_UTTERANCE` event carrying the synthesized audio (binary/base64 payload — inspect `GenerateAISpeechEvent` output shape engine-side and parse accordingly; document the exact response fields you consumed in deviations).

## Implementation steps (TDD)

1. Extend `ModuleTestSessionService` usage (from 2-2): `runTest(aiEntityId, …)`.
2. **Panel rework `<TtsTestPanel />`:** needs the AI entity context — the panel lives on `ModuleConfigEditScreen` TTS branch; resolve the entity whose config is being edited (the screen is opened in an entity context via CreateAIScreen/entity wiring — pass/derive the entity id; if the screen genuinely lacks an entity binding in some entry paths, disable the panel with a hint "Open this editor from an entity to test" and document).
3. Send `TTS_GENERATE_SPEECH` with the entered text + `tts_output_type: 'binary'`; await `ENTITY_UTTERANCE`; play via `AudioPlayer` (data-URL handling as before); loading/error/offline states; disconnect after the test (guaranteed cleanup — service handles it).
4. Note: the test synthesizes with the entity's SAVED synced TTS config (eventserver path can't test unsaved drafts) — same UI-copy note as 2-2; document in deviations.
5. i18n adjustments.

## Gates

- tsc = 0 · targeted + full jest green · grep: no `/api/modules/test` refs
- Commit: `refactor(config): TTS playback test panel via eventserver debug session (persona modules 2-3)`

## Checklist

- [x] Entity-context resolution (or documented disable-with-hint) — **documented disable** (see Deviations)
- [x] TTS_GENERATE_SPEECH 'binary' → ENTITY_UTTERANCE → playback (mocked tests RED first)
- [x] Guaranteed disconnect; saved-config copy note
- [x] Gates green, committed, phase doc + summary.md updated

## ENTITY_UTTERANCE response fields consumed (verified engine-side `modules/tts.go` + `events/events.go`)

The engine's `GenerateAISpeechEvent` (engine `modules/tts.go:151-223`) marshals the updated `Utterance` as the `ENTITY_UTTERANCE` payload. For `tts_output_type: "binary"` it sets `utterance.Audio = renderResult.DataB64` and `utterance.AudioType = renderResult.DataType` (engine `events/events.go:147-166`). The app consumes:

- `payload.audio` — base64 inline synth audio (`Utterance.Audio`; set only for `binary`).
- `payload.audio_type` — MIME type (`Utterance.AudioType`, e.g. `audio/mpeg` / `audio/wav`); falls back to `audio/wav` when absent.
- `payload.content` — the synthesized text echo (not used for playback).
- `payload.message_id` / `payload.entity_id` — correlation (not required for playback; the panel keys off `payload.audio`).
- `payload.audio_file` — empty for `binary`; the file-write path (`tts_output_type: "file"`) is NOT used.

## Deviations (documented)

- **Entity-context finding:** `ModuleConfigEditScreen` is opened with route params `{ moduleType, configId }` ONLY. Verified entry paths: `EntityModuleSelectorWithActions` (from `CreateAIScreen`, passes `moduleType`+`configId` only) and `VoiceInputSettingsScreen` (pinned `moduleType='stt'`). **No entry path carries an AI entity id.** The screen genuinely has no entity binding, so the TTS panel is **disabled with a hint** ("Open this config from an AI profile to test."). `TtsTestPanel` accepts an optional `entityId` prop so a future entity-bound entry path (e.g. editing a specific AI's TTS config) can enable it. Threading `entityId` through the whole nav stack was judged out of scope for this rework (would touch `AppNavigator`/`EntityModuleSelectorWithActions`/`CreateAIScreen` and is not reliable from create-mode where the entity doesn't exist yet).
- **Config transport delta:** the eventserver `debug` session synthesizes with the entity's **SYNCED** TTS config. Unsaved draft changes are NOT applied; UI copy notes this ("Tests your saved configuration…").
- **Two source files shared with 2-2:** `ModuleConfigEditScreen.tsx` and `moduleTestSessionService.ts` are shared, so this commit builds on the 2-2 commit (see 2-2 Deviations).
