# 2-2 — App: STT/VAD Recorder Test Block (eventserver transport)

> Repo: `harmony-ai-app` (branch `senju-design-updates-rebase`). **REWORKED 2026-09-02** per user correction: NO HTTP/management-server calls (not cloud-reachable). Transport = the eventserver WebSocket protocol with EXISTING STT events; the persona entity is initialized in a transient `debug` session (engine 1-3). Protocol: impact → edit → detect_changes → commit, TDD.

## Objective (UX unchanged)

`<SttTestPanel />` with the same UX as before — record from the mic, then show transcript (+ VAD indication where available) — but executed by INITing the **currently selected persona entity** in a `debug` session and driving the EXISTING STT events through the app's normal eventserver connection layer.

## Pinned event contract (verified engine-side — do not invent new events)

- INIT_ENTITY for the persona entity id with `device_type: "debug"` (transient; engine skips interaction/memories/lifecycle; immediate cleanup on disconnect).
- One-shot transcription: `STT_INPUT_AUDIO` payload `{ "message_id": <uuid>, "audio_data": { "audio_bytes": <base64>, "channels": <n>, "bit_depth": <n>, "sample_rate": <n> }, "result_mode": "return" }` → transcript in the response/result.
- VAD streaming (optional richer mode — study before deciding): `STT_START_LISTEN` (`ListenParams`: `auto_vad`, `result_mode`, `channels`, `bit_depth`, `sample_rate`) → stream chunks → `STT_STOP_LISTEN` → `STT_FETCH_MICROPHONE_RESULT` (`{ start_byte, bytes_count }`). If wiring live VAD into the panel is disproportionate for v1, ship one-shot `STT_INPUT_AUDIO` (transcript) and note VAD live-testing as a follow-up — document the decision here.

## Implementation steps (TDD)

1. **DELETE the HTTP client** `src/services/voiceInput/moduleTestClient.ts` (+ tests) from the previous approach — grep `fetch(` under `src/services/voiceInput/` → zero.
2. **New `ModuleTestSessionService`** (`src/services/voiceInput/`): minimal standalone session on top of the EXISTING connection primitives (study `EntitySessionService.startInteractionSession` internals: connection creation via ConnectionStateManager, JWT, INIT payload construction — reuse, don't duplicate): `runTest(entityId, fn)` → open connection → INIT with `device_type: 'debug'` → run fn(sendEvent/awaitEvent helpers) → disconnect. MUST NOT touch live chat sessions (own connection, own interaction id namespace). Unit tests with mocked connection layer (contract-shaped: INIT payload assertions incl. device_type, event round-trip, guaranteed disconnect on error).
3. **Panel rework:** resolve the active persona id (`ChatPreferencesService.getGlobalImpersonatedEntity` + `resolvePersonaId` — the entity the user currently chats as); record via the existing `AudioRecorder` (WAV; extract channels/bit_depth/sample_rate from the recorder output or WAV header for the payload); base64; `STT_INPUT_AUDIO` with `result_mode: 'return'`; render transcript (+ VAD affordance if implemented); error/offline states as before.
4. Keep the existing mounts: Voice input screen + `ModuleConfigEditScreen` STT branch (draft config reminder: with the eventserver transport the test runs against the persona entity's SYNCED config — for unsaved drafts note in UI copy that the test uses the saved configuration; document this delta in deviations).
5. i18n adjustments if any copy changes.

## Gates

- tsc = 0 · targeted jest green · full `npm.cmd test` green (known flakes: nodeSide/nodeDatabase.smoke — verify isolated)
- Grep: no engine HTTP fetch; no `/api/modules/test` references anywhere
- Commit: `refactor(config): STT/VAD test panel via eventserver debug session - remove HTTP client (persona modules 2-2)`

## Checklist

- [x] HTTP client deleted (grep clean) — `moduleTestClient.ts` + test removed; `fetch(` in `src/services/voiceInput/` = 0; `/api/modules/test` repo-wide = 0
- [x] ModuleTestSessionService (mocked-connection tests RED first) — `moduleTestSessionService.ts` + 7-test suite green
- [x] Panel on existing events; persona resolution; WAV params correct
- [x] Gates green, committed, phase doc + summary.md updated (+ deviations: VAD live mode decision, saved-vs-draft copy)

## Deviations (documented)

- **VAD live-vs-one-shot decision:** v1 ships the ONE-SHOT `STT_INPUT_AUDIO` (`result_mode: "return"`) path and renders the transcript; the panel always reports `[]` VAD segments. Live VAD streaming (`STT_START_LISTEN` → chunks → `STT_STOP_LISTEN` → `STT_FETCH_MICROPHONE_RESULT`) is a heavier wiring — chunked PCM transport + VAD segment reconstruction — that is disproportionate for the panel's v1 UX. **Follow-up:** live VAD streaming with segment bars.
- **Config transport delta:** the eventserver `debug` session tests the persona entity's **SYNCED** STT config. Unsaved draft changes in the editor are NOT applied (the engine has no draft config over eventserver). UI copy notes this ("Tests your saved voice input configuration…"). The screen still passes only `enabled` (no draft config prop anymore).
- **Two source files touched by both 2-2/2-3:** `ModuleConfigEditScreen.tsx` and `src/services/voiceInput/moduleTestSessionService.ts` are SHARED by the STT and TTS panels, so the second commit rides on the first (they cannot be tsc-disjoint).
