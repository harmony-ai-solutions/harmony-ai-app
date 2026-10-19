# Phase 3-6 — STT Config Screen (Realtime AutoVAD + Transcription Pipeline)

**Repo:** `harmony-ai-app` · **Depends on:** 1-2, 2-3, 2-4 · **Blocks:** 5-1  
**Codebase Mapping Refs:** `.planning/codebase/ARCHITECTURE.md`, `harmony-link-private/modules/stt.go`, `src/services/streaming/streamingService.ts`, `src/components/config/SttTestPanel.tsx`

## Objective

Make the **Edit / New STT Config** screen (`moduleType = 'stt'`) and the **Realtime Audio Streaming Service (`streamingService.ts` + `SttTestPanel.tsx`)** reflect and expose the Engine's full **Realtime `AutoVAD` + Transcription on Voice Detection** pipeline:

1. **Visual 2-Stage Realtime Pipeline Header (`Stage 1: VAD Voice Gate ➔ Stage 2: Transcription on Speech`):**
   - Instead of presenting `Transcription` and `VAD` as two unrelated slots, render an interactive **Realtime Audio Pipeline** flow header showing how **Stage 1: VAD (`silero-vad`)** continuously gates the 16kHz PCM stream and triggers **Stage 2: Transcription (`FasterWhisper` / `Whisper` / `Scribe v2`)** automatically when speech pauses (`STT_SPEECH_STOPPED`) or the chunk buffer fills.
   - Tapping either stage node (`Stage 1: VAD` vs `Stage 2: Transcription`) switches the active stage configuration below within a single card.
2. **Complete the `STT_SPEECH_STARTED` & `STT_SPEECH_STOPPED` Wiring in `streamingService.ts` & `SttTestPanel.tsx`:**
   - Currently, `streamingService.ts` (`lines 88–114`) subscribes to `STT_FETCH_MICROPHONE` and `STT_OUTPUT_TEXT` (with `auto_vad: true`), **but ignores `STT_SPEECH_STARTED` and `STT_SPEECH_STOPPED`** emitted by `modules/stt.go`!
   - Add `onVoiceActivity?: (speaking: boolean, timestampMs: number) => void` to `StartAudioStreamOptions` in `src/services/streaming/types.ts` and handle `event.event_type === 'STT_SPEECH_STARTED'` / `'STT_SPEECH_STOPPED'` in `streamingService.ts`.
   - In `SttTestPanel.tsx` (**Live AutoVAD** mode):
     - Display a live **Voice Activity Status Pill** (`🟢 STT_SPEECH_STARTED · Voice Detected` vs `🟡 STT_SPEECH_STOPPED · Listening for voice…`).
     - Record `[start_ms, end_ms]` intervals from `STT_SPEECH_STARTED` → `STT_SPEECH_STOPPED` in real time and render the **Live VAD Segment Timeline Bars** (`computeVadBars`) during and after Live streaming (not just in Quick mode!).
3. **Silero VAD Tunables for Both `Soulbits Cloud` and `Soulvoice`:**
   - Expose `Speech Threshold` (`threshold`, default `0.5`), `Speech Pad (ms)` (`speech_pad_ms`, default `30`), `Min Speech Duration (ms)` (`min_speech_duration_ms`, default `250`), and `Min Silence Duration (ms)` (`min_silence_duration_ms`, default `100`) in **Stage 1: VAD (Advanced)** for both `soulbitscloud` and `soulvoice`.
4. **Realtime Stream Buffer & Overlap Card (Advanced):**
   - Clearly label `Main Stream (ms)` (`2000 ms`), `Transition Overlap (ms)` (`1000 ms`, with validation hint that it must be a multiple/divisor for phrase stitching), and `Max Speech Chunks per Batch` (`5`) as the **AutoVAD Window & Phrase-Stitching Buffer**.

---

## Files to Modify

- `src/services/streaming/types.ts`
- `src/services/streaming/streamingService.ts`
- `src/services/streaming/__tests__/streamingService.test.ts`
- `src/components/config/SttTestPanel.tsx`
- `src/components/config/__tests__/SttTestPanel.test.tsx`
- `src/constants/providerFieldSchemas.ts`
- `src/screens/config/ModuleConfigEditScreen.tsx`
- `src/screens/config/__tests__/ModuleConfigEditScreen.test.tsx`

---

## Progress Checklist

- [ ] Forward `STT_SPEECH_STARTED` and `STT_SPEECH_STOPPED` events in `streamingService.ts` via `onVoiceActivity(speaking, elapsedMs)`
- [ ] Update `SttTestPanel.tsx` Live mode to display real-time `Voice Detected` / `Waiting for voice` state and live VAD segment timeline bars
- [ ] Enable Silero VAD tunables (`threshold`, `min_speech_duration_ms`, `min_silence_duration_ms`, `speech_pad_ms`) on `soulbitscloud` as well as `soulvoice`
- [ ] Render the 2-stage **Realtime Audio Pipeline (`Stage 1: VAD ➔ Stage 2: Transcription`)** selector in `ModuleConfigEditScreen.tsx`
- [ ] Update `streamingService.test.ts` and `SttTestPanel.test.tsx` to cover `STT_SPEECH_STARTED` / `STT_SPEECH_STOPPED` segment tracking
