# 5-2 — App: Reusable Streaming Service (Live VAD / Transcription)

> Repo: `harmony-ai-app` (branch `senju-design-updates-rebase`). User ruling 2026-09-02: live VAD streaming will be needed for realtime voice/video calls with AIs — implement as a REUSABLE, standardized service; extensible toward video through Harmony Link later. Reference implementation: the VNGE plugin (`vnge-harmony-link-plugin/src/harmony_modules/speech_to_text.py`) + engine `modules/stt.go`.

## Verified protocol (engine-driven PULL — do not invent events)

1. Client → engine: `STT_START_LISTEN` `{ auto_vad: bool, result_mode: "return"|"process", channels, bit_depth, sample_rate }` (VNGE uses return-mode when auto_vad).
2. Engine → client: `STT_FETCH_MICROPHONE` events (status SUCCESS) with payload `{ start_byte, bytes_count }` — sequential, fixed time-sliced ranges (`mainStreamChunkSize = bytesPerSec/1000 * mainStreamTimeMillis`); the next pull is only issued after the previous chunk arrives.
3. Client → engine: respond `STT_FETCH_MICROPHONE_RESULT` (status NEW) with `AudioChunk` payload `{ audio_bytes: <base64 PCM>, channels, bit_depth, sample_rate }` — sliced from a local RING BUFFER; if the engine reads ahead of the mic, WAIT for the buffer to grow (VNGE: `get_buffer_fetch_indices` + wait loop + `dropped_buffer_bytes` accounting for overflow) — never block the connection's event loop.
4. Transcripts return as result events per `result_mode` ("return" → back to the requesting client; investigate exactly which event the engine emits in return mode during streaming — `dispatchTranscriptionResult` — and consume it).
5. Client → engine: `STT_STOP_LISTEN` `{}` to end; engine loop exits after the outstanding chunk.

## Service design (reusable, video-extensible)

```
src/services/streaming/
  types.ts                — StreamTrack types, AudioFormat, callbacks (onTranscript, onError, onStateChange); designed track-generic (audio v1, video later)
  audioRingBuffer.ts      — byte ring buffer + fetch-slice + read-ahead wait + overflow accounting (VNGE semantics), pure & unit-testable
  streamingService.ts     — orchestrator: session (debug | regular/phone param), START/STOP LISTEN, FETCH round-trip responder wired to the ring buffer, result-event fan-out to subscribers, guaranteed teardown
```

- **Session source:** build on the existing connection primitives; for module tests use `device_type: 'debug'` (transient) — for future calls the same service accepts a regular session/entity (parameterize; do NOT hardcode debug).
- **Mic source:** investigate the existing recorder stack (`react-native-audio-record` via the app's `AudioRecorder`): if it can stream raw PCM chunks (onData), feed the ring buffer live; if it only produces WAV files, fall back to feeding recorded WAV PCM into the buffer in a documented bridging mode (v1). DOCUMENT the decision + native capability found.
- API sketch: `startAudioStream({ entityId, sessionType, format, autoVad, resultMode, onTranscript, onError })` → handle; `stop(handle)`; internal responder MUST never block other events.

## SttTestPanel integration

Upgrade the panel: **Live test** becomes the primary action (stream → live transcript accumulation + activity indication), one-shot `STT_INPUT_AUDIO` stays as a secondary "quick test" (useful when no VAD is configured). Persona entity resolution + saved-config semantics unchanged. Document UX choice.

## Implementation steps (TDD)

1. `audioRingBuffer` RED tests: slice correctness, read-ahead wait (fake timers), overflow/dropped-bytes accounting.
2. `streamingService` RED tests with mocked connection: START payload shape, FETCH→RESULT round-trip (correct event types/statuses/payloads per protocol above), result fan-out, STOP + guaranteed teardown, non-blocking responder.
3. Mic-source investigation + documented decision; wire the chosen source.
4. Panel integration + panel tests updated (live mode with mocked service).
5. i18n for new copy.

## Gates

tsc = 0 · targeted jest green · full `npm.cmd test` green · grep: no new engine HTTP usage.
Commit: `feat(streaming): reusable audio streaming service (engine pull protocol) + live VAD test mode (persona modules 5-2)`

## Checklist

- [x] Ring buffer (RED first) with VNGE-parity semantics
- [x] StreamingService round-trip + teardown (RED first, mocked connection)
- [x] Mic-source decision documented
- [x] Panel live mode + kept one-shot fallback
- [x] Gates green, committed, docs ticked (+ deviations)

## Decisions & deviations (2026-09-02)

### Mic source — LIVE raw PCM (not WAV bridging)
Verified the existing recorder stack (`react-native-audio-record`):
- Android `RNAudioRecordModule.java` reads `AudioRecord.read(...)` in a thread and emits `eventEmitter.emit("data", Base64.encodeToString(buffer, NO_WRAP))` — raw 16-bit PCM, NO WAV header, per buffer (`getMinBufferSize`, mono unless channels=2).
- iOS `RNAudioRecord.m` `HandleInputBuffer` emits `sendEventWithName:@"data" body:base64(inBuffer->mAudioData)` — again raw 16-bit PCM from the audio-queue callback.

**Decision:** the library CAN stream live raw PCM chunks via `AudioRecord.on('data', cb)`. Because the engine's PULL protocol issues `STT_FETCH_MICROPHONE` immediately after `STT_START_LISTEN` (before the mic has produced the requested range), the ring buffer MUST be fed in real time for streaming to make progress — WAV-bridging-at-stop cannot satisfy the initial fetches. So v1 feeds the ring buffer LIVE from `AudioRecorder.subscribeLivePcm(...)` (added to the app recorder wrapper), which decodes the base64 `data` chunks into `Uint8Array` raw PCM. **Documented limitations:** (1) the native lib keeps a SINGLE `data` listener (it removes prior listeners before adding), acceptable for the one-at-a-time test panel; (2) Android encodes the full `buffer` (not `bytesRead`) so a partial read can carry stale trailing bytes — tolerable via the engine's VAD and not observed on iOS. The WAV-PCM-at-stop bridge is the documented fallback (NOT wired in v1) for a future recorder without a live `data` event.

### Streaming return-mode result event
The engine dispatches streaming transcripts in return mode via `STT_OUTPUT_TEXT` (engine `onTranscriptionFinished` → `RESULT_MODE_RETURN`, `modules/stt.go:587`). Same event as the one-shot path. The service consumes exactly `STT_OUTPUT_TEXT` and fans it out.

### Panel UX choice
Live test is the PRIMARY (default) action — stream → live transcript accumulation while recording + activity indicator. The one-shot `STT_INPUT_AUDIO` path is kept as a SECONDARY "Quick test" mode (useful when no VAD is configured / a single utterance). Live always uses `auto_vad: true` (the panel label says the engine uses VAD segmentation).
