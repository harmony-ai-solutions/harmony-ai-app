# Phase 2-4 — Engine TTS Voice Design/Cloning, ElevenLabs & Realtime VAD Upgrades

**Repo:** `harmony-link-private` · **Depends on:** none · **Blocks:** 3-5, 3-6, 5-1  
**Codebase Mapping Refs:** `providers/soulbitscloud.go`, `providers/soulvoice.go`, `providers/elevenlabs.go`, `providers/openai.go`, `config/voice.go`, `config/types.go`, `management/routes_config.go`, `management/routes_modules.go`

## Objective

Close the Engine-side gaps discovered when auditing the desktop `VoiceConfigManager.jsx` against the Go provider clients (`soulbitscloud`, `soulvoice`, `elevenlabs`, `openai`) and the `STTModule` / `VAD` pipeline:

1. **Soulbits Cloud (`providers/soulbitscloud.go`):**
   - Implement `EmbedSpeaker(inputAudioB64)` using `p.client.SpeakerEmbed(ctx, &gen.SpeakerEmbedRequest{ Model: p.model, InputAudio: rawBytes })` (`POST /v1/embed/speaker` is already supported by the gateway and generated client!).
   - Upgrade `RenderSpeech(text)` to support `operation_mode` (`single_speaker_tts` vs `voice_cloning`), `target_embedding` (`InputEmbedding`) / `input_audio` (`InputAudio`), and full `gen.GenerationOptions`: `Speed`, `Pitch`, `Energy`, `Style`, `Seed`, `Exaggeration`, `CfgWeight`, `Temperature`, `RepetitionPenalty`, `TopP`, `MinP`, `TopK`, `NormLoudness`.
   - Pass Silero VAD tunables (`Threshold`, `MinSpeechDurationMs`, `MinSilenceDurationMs`, `SpeechPadMs`) in `DetectVoiceActivity` (`gen.VADRequest`).
2. **Soulvoice & Voice Config Files (`config/voice.go`, `providers/soulvoice.go`):**
   - Extend `config.SoulvoiceVoiceConfig` with the 8 Chatterbox fields that `VoiceConfigManager.jsx` already writes (`Exaggeration`, `CfgWeight`, `Temperature`, `RepetitionPenalty`, `TopP`, `MinP`, `TopK`, `NormLoudness`) and forward them in `SoulvoiceProvider.RenderSpeech` (`GenerationOptions.AdditionalProperties`), plus allow inline `capability_json` voice fields when `VoiceConfigFile` is empty.
3. **ElevenLabs Client (`providers/elevenlabs.go`, `config/types.go`):**
   - **SDK Research Verdict (Oct 2026):** ElevenLabs has **no official Go SDK** (`elevenlabs.io/docs/eleven-api/resources/libraries` lists only Python & JS/TS for REST). The previously vendored `github.com/haguro/elevenlabs-go` (`v0.2.4`) was a community repo archived in Feb 2024; the two active community Go repos (`plexusone/elevenlabs-go v0.13.0` and `taigrr/elevenlabs v0.2.5`) both call legacy `/v1/voices` in their wrappers, drop `maximum_text_length_per_request` / `is_owner` / `verified_languages` / `seed` / `apply_text_normalization`, and discard the `detail.type` / `detail.code` error discriminators needed for `402`/`403`/`429` classification. Keeping and extending our focused raw HTTP client (`providers/elevenlabs.go`, verified against live `https://api.elevenlabs.io/openapi.json`) is strictly superior and zero-dependency.
   - Wire `BaseURL` on `config.ElevenlabsConfig` (`baseurl`) and `models.ElevenLabsProviderConfig` so regional residency hosts (`api.us.elevenlabs.io`, `api.eu.residency.elevenlabs.io`, `api.in.residency.elevenlabs.io`, `api.sg.residency.elevenlabs.io`) work in production as well as `httptest`.
   - Add missing TTS request parameters to `ElevenlabsConfig` and `RenderSpeech`: `output_format` (query param, e.g. `mp3_44100_128`, `mp3_44100_192`, `pcm_24000`, `opus_48000_128`), `language_code` (ISO 639-1), `apply_text_normalization` (`auto` | `on` | `off`), and `seed`.
   - Add a `rawMultipart` helper alongside `rawRequest` and implement:
     - **Instant Voice Cloning (IVC):** `CloneVoice(ctx, name, description, audioFiles, removeBgNoise)` → `POST /v1/voices/add` (`multipart/form-data`).
     - **Voice Design:** `CreateVoicePreviews(ctx, req)` → `POST /v1/text-to-voice/create-previews` and `SaveDesignedVoice(ctx, voiceName, voiceDescription, generatedVoiceID)` → `POST /v1/text-to-voice` (verified against live `https://api.elevenlabs.io/openapi.json` — replaces the retired `/v1/text-to-voice/create-voice-from-preview` path).
     - **Scribe STT (`stt.STTClient`):** `TranscribeAudio(audioData)` → `POST /v1/speech-to-text` (`multipart/form-data` with `model_id` defaulting to `scribe_v2` / `scribe_v1`) and wire `ProviderElevenlabs` into `STTConfig.Transcription` (`config/types.go`, `modules/stt.go`, `database/controllers/module_controller.go`).
4. **OpenAI TTS (`providers/openai.go`, `config/types.go`):**
   - Add `Instructions` (`voice_instructions` / `instructions`) to `OpenAIProviderConfig` and pass it in `RenderSpeech` when the model supports voice-design instructions (`gpt-4o-mini-tts`).
5. **Loopback Management Endpoints for Speaker Embedding, Voice Cloning/Design & Direct TTS Test (`management/`):**
   - Expose `POST /api/module-configs/tts/embed-speaker` (runs `EmbedSpeaker` for `soulbitscloud` / `soulvoice` and returns `{ data: base64Embedding }`).
   - Expose `POST /api/module-configs/tts/test-speech` (stateless direct synthesis test like `POST /api/module-configs/imagination/test-generation`, so `TtsTestPanel` works even without an active entity session).
   - Expose `POST /api/providers/elevenlabs/voices/clone` and `POST /api/providers/elevenlabs/voices/design` for ElevenLabs IVC and Voice Design.
   - Standardize `meta.speech_options` across `soulbitscloud`, `soulvoice`, `elevenlabs`, and `openai` in `ListModels` / `catalog_data.json` so the App's capability tree knows each model's `operation_modes`, `supports_voice_cloning`, `supports_voice_design`, `paralinguistic_tags`, and `supported_generation_params`.

---

## Files to Modify (`harmony-link-private`)

- `config/voice.go`
- `config/types.go`
- `database/models/provider_*.go` & `database/controllers/provider_mapper.go`
- `providers/soulbitscloud.go` & `providers/soulbitscloud_test.go`
- `providers/soulvoice.go` & `providers/soulvoice_test.go`
- `providers/elevenlabs.go` & `providers/elevenlabs_test.go`
- `providers/openai.go` & `providers/openai_test.go`
- `modules/stt.go`
- `management/routes_modules.go` & `management/server.go`

---

## Progress Checklist

- [ ] Wire `SoulbitsCloudProvider.EmbedSpeaker`, full `RenderSpeech` (`voice_cloning` + `GenerationOptions`), and `DetectVoiceActivity` Silero tunables
- [ ] Extend `SoulvoiceVoiceConfig` and `SoulvoiceProvider.RenderSpeech` with Chatterbox prosody/sampling fields and capability-overlay fallback
- [ ] Upgrade `ElevenLabsProvider` with `output_format`, `language_code`, `apply_text_normalization`, `seed`, Instant Voice Cloning (`/v1/voices/add`), Voice Design (`/v1/text-to-voice/*`), and Scribe STT (`TranscribeAudio`)
- [ ] Add `instructions` support to `OpenAIProvider.RenderSpeech` for `gpt-4o-mini-tts`
- [ ] Add loopback management endpoints for `embed-speaker`, `test-speech`, and ElevenLabs voice clone/design
