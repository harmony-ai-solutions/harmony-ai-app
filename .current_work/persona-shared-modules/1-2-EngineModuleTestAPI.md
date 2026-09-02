# 1-2 — Engine: Module Test API (STT / TTS)

> Repo: `harmony-link-private` (branch `feat/engine-track-phase2`). Consult `.planning/codebase/` docs before starting. Protocol: impact → edit → detect_changes → commit, TDD.

## Objective

Two management-API endpoints that execute a **provider test against a (possibly unsaved) module config**, so config screens can prove their setup end-to-end. Scoped strictly to STT and TTS. This contract is PINNED — the app (phases 2-2/2-3) builds against it in parallel.

## Pinned contract

Route paths follow the router's existing grouping/casing conventions (adapt prefix; semantic fields are fixed). Auth = existing management middleware.

```
POST /modules/test/stt
{
  "provider_type": "<engine provider key, e.g. harmonyspeech|elevenlabs|…>",
  "provider_config_id": <int|null>,        // credentials resolved server-side; never echoed
  "module_config": { …engine STTConfig-shaped fields incl. nested VAD config… },
  "audio_base64": "<base64 audio bytes>",
  "mime_type": "audio/wav"
}
→ 200 { "transcript": "hello world",
        "vad_segments": [ {"start_ms":0,"end_ms":1200} ],   // [] when provider can't report segments
        "duration_ms": 2100 }
→ 4xx { "error": "<human-readable reason>" }

POST /modules/test/tts
{
  "provider_type": "<provider key>",
  "provider_config_id": <int|null>,
  "module_config": { …engine TTSConfig-shaped fields… },
  "text": "Hello, this is a test."
}
→ 200 { "audio_base64": "<base64 audio>", "mime_type": "audio/mpeg" }
→ 4xx { "error": "…" }
```

Error taxonomy (all 4xx + `{"error"}`): unknown provider_type · provider_config_id unresolvable · provider invocation failure · (stt) undecodable audio. Never leak credentials in responses or logs.

## Implementation steps (TDD)

1. Explore the cleanest invocation path: `modules.STTModule`/`TTSModule` (or their provider layer) initialized with a synthetic config → transcribe/synthesize. The Wails simulator (`frontend/src/components/SimulatorView.jsx`) may already exercise modules outside sessions — mirror its mechanism if one exists server-side. Decide + document the chosen path in the phase doc before writing the handler.
2. Handler tests with a stubbed provider invocation (see how engine tests fake providers): happy path shapes above; each error case; `vad_segments: []` fallback when the provider reports none.
3. Register routes in the management router next to existing module/config routes; reuse request-size limits conventions (audio base64 payloads — check any existing body-size middleware and note it).
4. Credential resolution: `provider_config_id` → the provider-config table row (same loader the module init uses). Provider failure → 4xx with the provider's error message (no stack traces).

## Files

- `management/routes_moduletests.go` (new) + router registration + tests
- Provider invocation helper (location per step-1 finding; keep it reusable)

## Gates

- `go build/vet/test ./...` green · endpoints covered by route tests
- Commit: `feat(management): STT/TTS module test endpoints - provider-faithful config testing (persona modules 1-2)`

## Checklist

- [x] Invocation path explored + documented in this file (deviations section)
- [x] RED handler tests (happy + error taxonomy + empty-VAD fallback)
- [x] Routes registered, contract shapes exactly as pinned
- [x] Gates green, committed, phase doc + summary.md updated

## Deviations

- **Invocation path chosen: the provider layer, not the full module.** `modules.STTModule`/`TTSModule` are streaming state machines: `Init` needs `config.ApplicationConfig.General.WorkingDir` (creates per-entity folders), an event emitter, and both clients to `ConnectToBackend`, plus a VAD pipeline. For a one-shot config test we only need `providers.GlobalRegistry.New(provider)` → `FromConfig(providerConfig)` → `ConnectToBackend()` → `TranscribeAudio`/`RenderSpeech`, exactly mirroring `STTModule.InitSTTClient` / `TTSModule.InitTTSClient`. Reusable helpers live in `management/routes_moduletests.go` (`sttTranscribeClient`, `sttVADClient`, `ttsRenderClient`). No Wails-simulator mechanism exists server-side that exercises modules outside sessions (the simulator is connect/send-event only), so this is the cleanest reusable path. Tests fake providers by registering them in `providers.GlobalRegistry` (the engine's established faking pattern) — no seam required.
- **`provider_config_id` type.** The pinned contract shows `<int|null>`, but the engine's module-config and provider-config primary keys are string UUIDs (migration 000031 `config_uuid_primary_keys`). The field NAME `provider_config_id` is preserved exactly; the engine type is `*string`. Resolved via `config/db.GetSTTModuleConfig` / `GetTTSModuleConfig` (the same loader the module init uses) and merged onto the request `module_config` by copying the active provider's credential block — never echoed.
- **Body-size note.** The management router has no `http.MaxBytesReader` / request-body-size middleware today. Audio base64 payloads (STT) are therefore not capped at the router level. A `MaxBytesReader` cap should be added when the app rollout lands; documented here rather than silently adding a limit that could break larger fixtures.
- **VAD segments + duration are best-effort.** The engine `stt.VADClient.DetectVoiceActivity` returns only a `bool` (no segment boundaries), and `TranscribeAudio` returns only a transcript. So the endpoint reports a single `{start_ms:0, end_ms:duration_ms}` segment when the VAD provider detects voice, otherwise `[]`. `duration_ms` is derived from the WAV header (`stt.ExtractPCMFromWAV`); 0 when the payload is not a parseable WAV.
- **Route prefix.** Registered under the existing `/api` group with the same API-key middleware → full paths `/api/modules/test/stt` and `/api/modules/test/tts`. The semantic path `/modules/test/{stt,tts}` is preserved; only the router's `/api` group prefix is applied.
