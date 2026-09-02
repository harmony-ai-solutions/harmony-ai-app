# 1-3 — Engine: Debug Session Type + Remove HTTP Test Endpoints

> Repo: `harmony-link-private` (branch `feat/engine-track-phase2`). Protocol: `.planning/codebase/` docs consulted (note which); `gitnexus_impact` before edits; `gitnexus_detect_changes` before commit; TDD.

## Objective

1. **Remove** the `/api/modules/test/stt|tts` management endpoints (commit `490cca2`) — wrong transport per user correction (management server is not cloud-reachable; nothing consumes them).
2. Add a **`debug` device/session type** for transient module-testing sessions: initializes ALL modules but has NO interaction/memory/lifecycle side effects; state is transient and cleaned up immediately on disconnect.

## Verified facts

- Existing device-type constants: `config/config.go:64-68` (`DeviceTypePhone/Plugin/Web/Messaging`). Phone sessions suspend on disconnect; **non-phone sessions are removed immediately** (`eventserver/session.go:637-641` + `handler_websocket.go:75-82` else-branch destroys) — the transient cleanup for `debug` already exists by virtue of being non-phone.
- INIT flow: `eventprocessor.go` `handleInitEntity`/INIT path (≈:195-280): disabled gate → session create → push-token registration → `initModules()` → greeting wiring → beat-runner start (autonomy + `ShouldAutomate`). The greeting hook may create interactions; beat runner is lifecycle behavior — both must be skipped for debug.
- STT events already exist: `STT_INPUT_AUDIO` (one-shot, `result_mode` return/process), `STT_START_LISTEN`/`STT_STOP_LISTEN` (VAD streaming, `ListenParams`), `STT_FETCH_MICROPHONE_RESULT` (`modules/stt.go:266-303`, `modules/stt/base.go:51-82`).
- TTS: `TTS_GENERATE_SPEECH` (`TTSGenerateRequest{utterance, tts_output_type}`; `"binary"` = inline audio) → emits `ENTITY_UTTERANCE` (`modules/tts.go:225-281`; `config.TTSOutputFile="file"`, `TTSOutputBinary="binary"`).

## Implementation steps (TDD)

1. **Remove 1-2 endpoints** (`management/routes_moduletests.go` + its tests + router registration). Grep: `modules/test` → zero.
2. `config`: add `DeviceTypeDebug = "debug"` constant (+ doc comment: transient module-testing sessions; no interaction/memories/lifecycle; immediate cleanup).
3. **Audit the INIT path** for side effects and gate them for `debug` (test RED first where feasible):
   - SKIP: beat-runner start / emotion-engine wiring (`EnsureEmotionEngine`/`EnsureBeatRunnerStarted` calls), greeting generator wiring + the greeting hook (no generated greeting → no interaction creation), push-token registration (n/a — no token), presence broadcast if it would announce the entity as "online" to other clients (keep presence object for capabilities, but skip announcing — verify how presence is broadcast on session create and gate the announce).
   - KEEP: disabled-AI INIT rejection (Q8 gate still applies), full `initModules()` (that's the point), session registration.
   - Lifecycle `EnsureBeatRunnerStarted` callers in the INIT path: early-return for debug device type.
4. **Tests** (`eventserver` suite, follow `entity_gates_test.go`/`init_entity_resume_integration_test.go` patterns):
   - INIT with `device_type='debug'` on an AI entity: session created, modules initialized (e.g. backend present when configured), NO interaction row created, NO greeting event, NO beat runner.
   - INIT debug for a user entity (persona): modules initialized via canonical inheritance (from 1-1), STT usable.
   - Disconnect: session removed immediately (no suspend) — assert via session-manager state (non-phone path).
   - Existing phone-session behavior unchanged (regression).
5. Cloud path: verify no cloud-specific branch treats unknown device types differently (grep `DeviceType` usages; add debug where phoneness is checked ONLY if a check would misbehave — `IsPhoneSession` must stay false for debug).

## Files

- `config/config.go` (+tests if constants have them), `eventserver/eventprocessor.go` (INIT gating), `management/routes_moduletests.go` (DELETE) + router, `eventserver/*_test.go`

## Gates

- `go build`/`go vet`/`go test ./...` all green · grep `modules/test` → zero · `cmd /c "go run . dump-schema > NUL"` exit 0
- Commits: ① `revert(management): remove HTTP module test endpoints - eventserver protocol is the transport (persona modules 1-3)` ② `feat(eventserver): debug device type - transient all-modules session, no interaction/memories/lifecycle (persona modules 1-3)`

## Checklist

- [x] 1-2 endpoints + tests removed, grep clean
- [x] `DeviceTypeDebug` constant + INIT side-effect gating (RED tests first)
- [x] Immediate-cleanup + persona-debug-INIT tests green; phone regression green
- [x] Gates green, committed, phase doc + summary.md updated
