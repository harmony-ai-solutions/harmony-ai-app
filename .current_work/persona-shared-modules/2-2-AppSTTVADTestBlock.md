# 2-2 — App: STT/VAD Recorder Test Block

> Repo: `harmony-ai-app` (branch `senju-design-updates-rebase`). Protocol + gates as 2-1. Consumes the PINNED contract from `1-2-EngineModuleTestAPI.md`.

## Objective

A self-contained "Test your configuration" block for STT/VAD config UIs: record from the mic → POST to the engine test endpoint → show transcript, duration, and VAD segment bars. True end-to-end: the engine runs the *configured* provider.

## Component contract

`<SttTestPanel />` (new, `src/components/config/` or `src/services/voiceInput/` — follow component conventions): props = `{ draftConfig: { provider_type, provider_config_id, module_config }, enabled?: boolean }`. Renders: record/stop button (state machine idle→recording→processing→done/error), duration, transcript text, VAD segment visualization (simple horizontal bar timeline; `vad_segments: []` → transcript only + note), error state with the endpoint's `error` message.

## Implementation steps (TDD)

1. **Client call** (`src/services/voiceInput/moduleTestClient.ts` or existing engine-HTTP client location — investigate how the app reaches engine HTTP today: pairing/connection plumbing, `ConnectionStateManager`, or an existing management client; document the found pattern): `testStt(cfg, audioBase64, mimeType)` → typed response per pinned contract. **Mock the HTTP layer in tests with contract-shaped fixtures** (no live engine in unit tests).
2. **Request/response mapping tests first:** happy path, error shape, empty `vad_segments`.
3. **Mic capture:** reuse the existing voice-message recording path (ChatInputBar / EntitySessionService audio recording — find the capture util; WAV preferred; note the actual container the existing recorder produces and send the matching `mime_type`).
4. **Panel UI:** record button (permission request flow mirrors the chat mic permission handling), processing spinner, results layout as above, disabled/offline state ("Connect to Harmony Link to test") when no engine connection.
5. **Mount into** the Voice input screen (2-1) — and into `ModuleConfigEditScreen` when `moduleType === 'stt'` (benefits AI STT config too; pass the current draft form state as `draftConfig`).
6. i18n keys (en).

## Files

- `src/services/voiceInput/moduleTestClient.ts` (+ tests), `<SttTestPanel />` (+ tests where feasible)
- `src/screens/config/ModuleConfigEditScreen.tsx`, `VoiceInputSettingsScreen.tsx` (mount points)
- i18n locale files

## Gates

- tsc = 0 · targeted + full jest green · grep: no direct `fetch` bypassing the chosen engine-client pattern
- Commit: `feat(config): STT/VAD recorder test panel - record, transcribe, VAD segments via engine (persona modules 2-2)`

## Checklist

- [x] Engine-HTTP access pattern investigated + documented here
- [x] RED client tests (contract-shaped)
- [x] Mic capture reused, mime_type correct
- [x] Panel states + VAD visualization + offline handling
- [x] Mounted in both surfaces, i18n, gates green, committed, docs updated

## Engine-HTTP access pattern (investigated + documented)

**Finding:** the app reaches Harmony Link (the engine) **only over WebSocket** today — WSS `/events` (`harmony_wss_url` / `harmony_ws_url` in AsyncStorage), authenticated with the stored `harmony_jwt`. There is **no pre-existing engine HTTP client** (the app has no management REST client; the only `fetch` usages are cloud/Soulbits auth in `authFetch.ts`/`AuthService.ts`, which target `CLOUD_HOSTS`, not the engine).

**Decision:** introduce a minimal engine HTTP client in `src/services/voiceInput/moduleTestClient.ts`, consistent with the existing config/host handling:
- `resolveEngineHttpBaseUrl()` derives the HTTP base URL from the stored WSS/WS URL by swapping `wss://` → `https://` (and `ws://` → `http://`) and stripping the `/events` path — so `wss://host:8081/events` → `https://host:8081`.
- Auth = the same stored Harmony Link JWT as a `Bearer` token (the exact credential the WebSocket connection uses).
- Payload = the PINNED contract from `1-2-EngineModuleTestAPI.md`; credentials are never echoed in the request (only `provider_config_id`, resolved server-side).
- Gate verified: the only `fetch(` in `src/services/voiceInput/` is inside `moduleTestClient.ts` (no bypass).

## Deviations

- **Mic capture reused as-is (no wrapper):** the panel calls the existing `AudioRecorder` singleton (the chat voice-message capture util). It produces `audio/wav` (`mimeType: 'audio/wav'`), which is exactly what the panel forwards as the request `mime_type`. No new capture code was introduced.
- **`ModuleConfigEditScreen` STT mount renders the panel only when a transcription provider is selected** (draft config is `null` until then), with `enabled` driven by the same condition. `VoiceInputSettingsScreen` mounts it only in the `state.enabled` branch.
- **Panel's VAD timeline** uses a pure exported helper `computeVadBars(segments, durationMs)` for the percentage layout — unit-tested. `vad_segments: []` renders a "no VAD segments" note (no timeline).
