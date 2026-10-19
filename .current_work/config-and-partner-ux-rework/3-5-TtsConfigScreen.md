# Phase 3-5 — TTS Config Screen (Voice Design, Pitch/Speed/Prosody & Voice Cloning)

**Repo:** `harmony-ai-app` · **Depends on:** 1-2, 2-3, 2-4 · **Blocks:** 5-1  
**Codebase Mapping Refs:** `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/CONVENTIONS.md`, Engine desktop `VoiceConfigManager.jsx`

## Objective

Rework the **Edit / New TTS Config** screen (`moduleType = 'tts'`) to achieve full parity with the Engine's `VoiceConfigManager.jsx` while extending capability-driven **Voice Design**, **Acoustic/Prosody Tuning**, and **Voice Cloning** across all TTS providers (`Soulbits Cloud`, `Soulvoice`, `ElevenLabs`, `OpenAI`, `OpenRouter`):

1. **Capability-Tree-Driven UI (`selectedModel.meta.speech_options` + `param_support`):**
   - Inspects `speech_options` on the selected TTS model to determine supported `operation_modes` (`single_speaker_tts`, `voice_cloning`, `instant_clone`, `voice_design`), `languages`, `voices`, `paralinguistic_tags`, and `supported_generation_params`.
2. **Voice Configuration Profile Bar (`/api/voices` for `soulvoice` & `soulbitscloud`):**
   - Select, Save, Save New, Rename, or Delete named voice configurations (`GET/POST/PUT/DELETE /api/voices`) directly from the TTS capability card.
3. **Voice Cloning & 2D Speaker Embedding Heatmap (`operation_mode === 'voice_cloning'`):**
   - Pick an audio file (`.wav`, `.mp3`, `.flac`) or record a reference sample with `AudioRecorder`, preview the reference audio inline, tap **`⚡ Generate Embedding`** (`POST /api/module-configs/tts/embed-speaker` → `POST /v1/embed/speaker`), and view the **2D Speaker Embedding Heatmap** (`VoiceEmbeddingHeatmap.tsx`,ported from the desktop `Heatmap.jsx`) + status badge.
   - For **ElevenLabs (`instant_clone`)**: upload/record 1–3 reference samples + voice name + background noise isolation toggle → `POST /api/providers/elevenlabs/voices/clone` (`POST /v1/voices/add`) and auto-select the newly cloned `voice_id`.
4. **Voice Design & Model-Gated Acoustic / Prosody Controls:**
   - **OpenVoice V1/V2 & HarmonySpeech:** `Speed` (`0.5–2.0`), `Pitch` (`0.5–2.0`), `Energy` (`0.5–2.0`), plus Advanced `Style` index, `Seed`, `Format`, and `Sample Rate`.
   - **Chatterbox & Chatterbox Multilingual:** `Exaggeration` (`0.0–1.0` emotion intensity) + `CFG Weight` (`0.0–1.0` reference adherence), plus Advanced `Temperature` (`0.8`), `Repetition Penalty` (`1.2`), `Top P` (`1.0`), `Min P` (`0.05`).
   - **Chatterbox Turbo:** interactive **Paralinguistic Tag** chips (`[laughter]`, `[sigh]`, `[gasp]`, `[chuckle]`, `[clears throat]`), `Normalize Loudness` (`Switch`), `Temperature`, `Repetition Penalty`, `Top P`, `Top K` (`1000`).
   - **ElevenLabs:** **Voice Design (Text-to-Voice prompt)** tab (`POST /v1/text-to-voice/create-previews` + save designed voice), live `/v2/voices` picker with inline preview ▶, plus `Stability`, `Similarity Boost`, `Style` (gated by `can_use_style`), `Speed` (v2 family), `Speaker Boost` (`Switch`, gated by `can_use_speaker_boost`), and Advanced `Output Format` (`mp3_44100_128`, `pcm_24000`, `opus_48000_128`), `Language Code`, `Text Normalization`, and `Seed`.
   - **OpenAI (`gpt-4o-mini-tts`):** 11 built-in voice chips + **`Voice Design Instructions`** (`instructions` prompt field to steer accent, whisper, emotion, pacing) + `Speed` + `Format`.
5. **Direct Voice Test Studio (`TtsTestPanel.tsx`):**
   - Calls `POST /api/module-configs/tts/test-speech` with the current form's live settings when no `entityId` is bound (or when unsaved edits exist), so users can test voice cloning, pitch/speed, and voice design immediately without leaving the screen.

---

## Files to Create / Modify

- `src/components/config/VoiceCloneAndDesignSection.tsx` (new — handles Operation Mode tabs, Reference Audio picker/recorder, `Generate Embedding` + 2D Heatmap, ElevenLabs IVC & Voice Design)
- `src/components/config/VoiceEmbeddingHeatmap.tsx` (new — React Native SVG/View port of desktop `Heatmap.jsx`)
- `src/components/config/VoiceProfileBar.tsx` (new — `/api/voices` profile selector + Save/Update/Rename/Delete)
- `src/components/config/TtsTestPanel.tsx`
- `src/components/config/ProviderSlotSection.tsx`
- `src/constants/providerFieldSchemas.ts`
- `src/constants/moduleConfiguration.ts`
- `src/services/engine/EngineApiClient.ts` (add `/api/voices` CRUD + `embedSpeaker` + `testTtsSpeech` + ElevenLabs clone/design calls)

---

## Progress Checklist

- [ ] Add `/api/voices` CRUD, `embedSpeaker`, `testTtsSpeech`, and ElevenLabs voice clone/design methods to `EngineApiClient.ts`
- [ ] Create `VoiceEmbeddingHeatmap.tsx` and `VoiceProfileBar.tsx`
- [ ] Create `VoiceCloneAndDesignSection.tsx` driven by `selectedModel.meta.speech_options`
- [ ] Add model-family-gated acoustic & prosody fields (`pitch`, `energy`, `style`, `seed`, `exaggeration`, `cfg_weight`, `norm_loudness`, `instructions`, `output_format`, `language_code`, `apply_text_normalization`) to `providerFieldSchemas.ts`
- [ ] Upgrade `TtsTestPanel.tsx` to support direct stateless synthesis (`POST /api/module-configs/tts/test-speech`) and paralinguistic tag quick-insert chips
- [ ] Add unit & component tests for voice cloning, embedding heatmap, and model-gated prosody fields
