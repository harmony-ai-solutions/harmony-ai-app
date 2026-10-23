# Soulbits Cloud — per-model default parameter values (research)

Research date: 2026-10-23. Produced by code-expert subagent (session
ses_e969a4ff7ffe4GwIhZt6H5KV7A) for the module-config validator + Soulbits
model-defaults rework. Feeds `src/constants/soulbitsModelDefaults.ts`.

**Scope:** every model in the active gateway catalog (`soulbitscloud.md` §3), mapped onto the exact capability-field surface in `src/constants/providerFieldSchemas.ts` (soulbitscloud block) and the current generic seeds in `src/constants/moduleDefaults.ts`.

**Method / provenance tags**
- **[official]** = number read from the upstream model repo/paper/README.
- **[hse]** = number read from Harmony Speech Engine source (the engine the gateway actually proxies for TTS/STT/VAD) — stronger than the upstream default because HSE may differ.
- **[derived]** = reasoned from the closest documented family (no doc for the exact id).
- **[gw]** = from this repo's gateway research (`.current_work/provider-registry/research/soulbitscloud.md`).

**Key structural finding up front:** for TTS, the gateway is *not* a parameter-agnostic passthrough. HSE **raises `ValueError`** on cross-family generation params (`harmonyspeech/task_handler/inputs.py`, `prepare_chatterbox_*_inputs`), and it **always returns WAV at the model's native sample rate**, ignoring `output_options.format`/`sample_rate` (`harmonyspeech/task_handler/model_runner_base.py`).

---

## 0. Honour matrix (what each family actually consumes)

| Family | `voice` | `language` | `speed` | `pitch` | `energy` | `style` | `exaggeration` | `cfg_weight` | `norm_loudness` | `seed` | `temperature`/`top_p`/`rep_pen` |
|---|---|---|---|---|---|---|---|---|---|---|---|
| kitten-tts-* | ✅ exact alias | ✅ must be `default` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| harmonyspeech | ❌ (embedding) | ❌ (EN only) | ✅ α | ✅ × | ✅ × | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| openvoice_v1 | ✅ style id | ✅ `EN`/`ZH` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| openvoice_v2 (MeloTTS) | ✅ `EN-*` | ✅ `EN`/`ES`/… | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| chatterbox | ❌ (built-in conds) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | 🚫 **raises** | ❌ | ✅ (not exposed) |
| chatterbox_multilingual | ❌ | ✅ (`en`) | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | 🚫 **raises** | ❌ | ✅ (not exposed) |
| chatterbox_turbo | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | 🚫 **raises** | 🚫 **raises** | ✅ | ❌ | ✅ (not exposed) |

🚫 = must be **omitted from the request** (HSE checks `is not None`, so `false`/`0` still raises).

---

## 1. LLM family (backend / cognition / movement / vision)

### `qwen-35-9b` — Qwen3.5-9B (free; text+image+video → text, 32 768 ctx)
**Confidence: documented** (official model card).

| field | default | screen range | note |
|---|---|---|---|
| `temperature` | **0.7** | 0–2, step 0.01 (sane 0.2–1.0) | Qwen non-thinking/Instruct general recommendation |
| `top_p` | **0.8** | 0–1, step 0.01 | same source; `1.0` (today's generic) is looser than Qwen recommends |
| `max_tokens` | **1024** | 1–32768 (or `-1`) | gateway ctx 32768 minus prompt |
| `presence_penalty` | **0.0** | −2–2, step 0.01 | *documented Qwen value is 1.5, but only for thinking mode / repetition rescue; Qwen itself warns higher values cause language mixing and quality loss. For roleplay keep 0.* |
| `frequency_penalty` | **0.0** | −2–2 | neutral |
| `max_completion_tokens` | **0** (unset) | — | use `max_tokens`; engine pushes this as an extra-param |
| `n` | **0** (unset → 1) | — | never set >1 |
| `seed` | **0** (random) | — | |
| `stop_tokens`, `response_format`, `sampling_preset_name` | `''` | — | leave manual |

Official values (reference): non-thinking general `temp 0.7 / top_p 0.8 / top_k 20 / min_p 0 / presence 1.5`; thinking general `1.0 / 0.95 / 20 / 0 / 1.5`; non-thinking VL `0.7 / 0.80`. Sources: <https://huggingface.co/Qwen/Qwen3.5-9B>, <https://modelscope.cn/models/qwen/Qwen3.5-9B>, <https://github.com/QwenLM/Qwen3/blob/main/docs/source/getting_started/quickstart.md>.
⚠ `top_k=20` / `min_p=0` are **not fields** on the soulbitscloud schema — cannot be set from the app.

**Per-module differentiation (recommended):**

| module | temp | top_p | max_tokens |
|---|---|---|---|
| backend | 0.7 | 0.8 | 1024 |
| cognition | 0.3 | 0.8 | 256 |
| movement | **0.2** | 0.8 | 256 |
| vision | 0.3 | 0.8 | 512 (image descriptions stay short) |

### `starfallen-24b` — internal fine-tune (free; text → text, 32 768 ctx)
**Confidence: derived / assumed.** No public docs for this exact id. Closest documented relative: the community merge *Starfallen Snow Fantasy 24B MS3.2* is a DELLA merge on **Mistral-Small-3.2-24B-Instruct-2506** (<https://huggingface.co/LyraNovaHeart/Starfallen-Snow-Fantasy-24B-MS3.2-v0.0>). Mistral's own guidance is `temperature 0.15, top_p 1.00` (<https://huggingface.co/mistralai/Mistral-Small-3.2-24B-Instruct-2506>) — a *benchmark/assistant* setting, too greedy for roleplay. Community roleplay norm for Mistral Small merges is 0.7–0.8 / 0.9–0.95.

| field | default | range | note |
|---|---|---|---|
| `temperature` | **0.75** | 0–2 | derived; roleplay-tuned merge, not Mistral's 0.15 |
| `top_p` | **0.95** | 0–1 | derived |
| `max_tokens` | **1024** | 1–32768 | |
| `presence_penalty` | **0.0** | −2–2 | |
| `frequency_penalty` | **0.0** | −2–2 | |
| `seed` | 0 | — | |
| `max_completion_tokens` / `n` | 0 | — | |

Per-module: cognition `0.3 / 0.9 / 256`, movement `0.2 / 0.9 / 192`. **Vision: not applicable** — catalog says text → text only; `SOULBITS_FALLBACK_MODELS.vision` already excludes it.

### `gemma4-meromero-26b-a4b` — Gemma 4 26B-A4B MoE fine-tune (core; text+image+video+audio, 32 768 ctx)
**Confidence: documented for the base; `meromero` suffix assumed community fine-tune.**
Base is real: `google/gemma-4-26B-A4B-it` — 26B total / ~4B active, 30 layers, 128 experts top-8, 262 144 max positions (<https://huggingface.co/google/gemma-4-26B-A4B>). Google's standardized config: **`temperature 1.0, top_p 0.95, top_k 64`** (`generation_config.json`; model card; NVIDIA NIM "Best Practices").

| field | default | range | note |
|---|---|---|---|
| `temperature` | **1.0** | 0–2 | Gemma 4 is trained for 1.0; Google says use it across use cases |
| `top_p` | **0.95** | 0–1 | |
| `max_tokens` | **1024** | 1–32768 | |
| `presence_penalty` | **0.0** | −2–2 | no penalty recommended |
| `frequency_penalty` | **0.0** | — | |
| `seed` | 0 | — | |

`top_k=64` is not exposed by the app schema. Gemma 4 is a **thinking** model (llama.cpp config docs: "clients must read `reasoning_content`"); the gateway has no thinking toggle.

Per-module: **backend 0.95–1.0 / 0.95 / 1024**; cognition `0.3 / 0.9 / 256`; movement `0.2 / 0.9 / 256`; vision `0.2 / 0.9 / 512`.

## 2. Embeddings (RAG)

The soulbitscloud schema exposes **no** RAG capability fields (no `dimensions`, no `normalize`) — nothing to seed beyond `model`. Values for documentation / future fields:

| model | dims | max tokens | defaults | confidence |
|---|---|---|---|---|
| `harrier-oss-v1-0-6b` | **1024** | 32 768 | L2-normalised, last-token pooling; **no** sampling params. Instruction-aware (query instruction per `search_instructions.json`; docs need none). | **documented** — <https://huggingface.co/microsoft/harrier-oss-v1-0.6b> |
| `qwen3-embed-4b` | **2560** (MRL 32–2560) | 32 768 | L2-normalised, instruction-aware query prefix; no sampling params. | **documented** (Qwen3-Embedding family) |

If a `dimensions` field is added later: `1024` / `2560`; do **not** truncate `harrier` (its 1024 is native, not MRL).

## 3. TTS family

`format` is **always WAV** in practice — HSE hard-codes `sf.write(..., format="wav")` in every TTS executor (`model_runner_base.py`); `output_options.format` and `sample_rate` are never read. Seed the truthful native values.

### `kitten-tts-mini` / `kitten-tts-micro` / `kitten-tts-nano` (free)
**Confidence: documented + hse.** Only `voice`, `language`, `speed` are consumed (`inputs.py::prepare_kittentts_synthesizer_inputs`; `kittentts.py`).

| field | default | range | note |
|---|---|---|---|
| `voice` | **`Bella`** | `Bella, Jasper, Luna, Bruno, Rosie, Hugo, Kiki, Leo` | exact casing; HSE raises `Voice 'X' not available` otherwise. HSE's own fallback is `Jasper`. |
| `language` | **`default`** | must be `default` | required — wrong/missing ⇒ worker rejection |
| `speed` | **1.0** | 0.25–4.0 (sane 0.8–1.3) | multiplied by a per-voice `speed_prior` |
| `format` | **`wav`** | wav only | |
| `sample_rate` | **`24000`** | — | native 24 kHz |

**No-op / unsupported:** `pitch`, `energy`, `exaggeration`, `cfg_weight`, `style`, `seed`, `norm_loudness` (and all LLM params).

Model-size note: mini = 80M, micro = 40M, nano = 15M (<https://github.com/KittenML/KittenTTS>). Identical parameter surface — only quality/latency differ; **mini is the recommended default**, nano for low-end devices.

### `harmonyspeech` (free) — Harmony Speech V1
**Confidence: hse / documented.** Forward-Tacotron + MultiBand-MelGAN (<https://github.com/harmony-ai-solutions/harmony-speech-engine/blob/main/docs/models.md>).

| field | default | range | note |
|---|---|---|---|
| `speed` | **1.0** | 0.5–2.0 | applied as `length_scale = 1/α` |
| `pitch` | **1.0** | 0.5–2.0 (sane 0.85–1.15) | multiplier on predicted pitch |
| `energy` | **1.0** | 0.5–2.0 (sane 0.85–1.15) | multiplier on predicted energy |
| `voice` | **`''`** | — | no voice IDs — speaker comes from an **embedding** |
| `language` | **`''`** | — | English-only synthesizer |
| `format` | `wav` | — | |
| `sample_rate` | `22050` (label) | — | HSE actually writes **16 000 Hz** (vocoder hard-coded `samplerate=16000`) |

**No-op:** `style`, `exaggeration`, `cfg_weight`, `seed`, `norm_loudness`.
⚠ **Cannot do single-speaker TTS without an embedding** — `prepare_harmonyspeech_synthesizer_inputs` requires `input_embedding`, and the engine's `RenderSpeech` sends none. In practice this model only works through the voice-cloning path.

### `openvoice_v1` (free)
**Confidence: hse / documented.**

| field | default | range | note |
|---|---|---|---|
| `language` | **`EN`** | `EN`, `ZH` | |
| `voice` | **`default`** | `default, whispering, shouting, excited, cheerful, terrified, angry, sad, friendly` (EN); `default` (ZH) | these *are* the style controls — `style` is not used |
| `speed` | **1.0** | 0.5–2.0 | only generation knob besides voice |
| `format` | `wav` | — | |
| `sample_rate` | `22050` | — | native ~22.05 kHz |

**No-op:** `pitch`, `energy`, `style`, `exaggeration`, `cfg_weight`, `seed`, `norm_loudness`.
Sources: HSE `docs/models.md`, `tests/e2e/tts/test_openvoice_v1.py` (`language="EN", voice="default"`), OpenVoice demo `speed=1.0` (<https://github.com/myshell-ai/OpenVoice>).

### `openvoice_v2` (free) — MeloTTS + tone-colour converter
**Confidence: hse / documented.**

| field | default | range | note |
|---|---|---|---|
| `language` | **`EN`** | `EN, ES, FR, ZH, JP, KR` | |
| `voice` | **`EN-Newest`** | `EN-Newest`, `EN-Default`, `EN-US`, `EN-BR`, `EN-INDIA`, `EN-AU` (EN); `ZH`, `ES`, `FR`, `JP`, `KR` | language-scoped; must match the deployed MeloTTS checkpoint |
| `speed` | **1.0** | 0.5–2.0 | |
| `format` | `wav` | — | |
| `sample_rate` | `44100` | — | MeloTTS native 44.1 kHz |

**No-op:** same as v1. `EN-Newest` is what HSE's own E2E test uses (`test_melotts.py`); validate against live `speech_options.voices` since the deployed MeloTTS variant changes the list.

### `chatterbox` (core)
**Confidence: documented + hse.** Defaults exactly match `chatterbox/src/chatterbox/tts.py` and HSE's `prepare_chatterbox_tts_inputs` fallbacks.

| field | default | range | note |
|---|---|---|---|
| `exaggeration` | **0.5** | official 0.25–2.0 (neutral 0.5) | **schema caps at 1.0 — widen to 1.5** to reach "dramatic" |
| `cfg_weight` | **0.5** | official 0.2–1.0 | 0.3 for fast-speaking reference voices; below 0.2 unstable |
| `voice` | **`''`** | — | no voice IDs; single-speaker mode uses the built-in conditionals |
| `language` | **`''`** | — | English-only model |
| `format` | `wav` | — | |
| `sample_rate` | `24000` | — | S3GEN native 24 kHz |

**Raises (must be omitted):** `norm_loudness`, `top_k`.
**No-op:** `speed`, `pitch`, `energy`, `style`, `seed`.
Not exposed by the app (but honored): `temperature 0.8`, `repetition_penalty 1.2`, `top_p 1.0`, `min_p 0.05`.
Sources: <https://github.com/resemble-ai/chatterbox>, HF Space sliders (0.25–2 / 0.2–1), `tts.py` signature, HSE `inputs.py`.

### `chatterbox_multilingual` (core) — 23 languages
**Confidence: documented + hse.**

| field | default | range | note |
|---|---|---|---|
| `language` | **`en`** | 23 codes (HSE `SUPPORTED_LANGUAGES`) | HSE defaults to `en` when absent |
| `exaggeration` | **0.5** | 0.25–2.0 | |
| `cfg_weight` | **0.5** | 0.2–1.0 | |
| `voice` | `''` | — | no voice IDs |
| `format` / `sample_rate` | `wav` / `24000` | — | |

**Raises:** `norm_loudness`, `top_k`. **No-op:** `speed/pitch/energy/style/seed`.

### `chatterbox_turbo` (infinite)
**Confidence: documented + hse.** Upstream defaults: `exaggeration=0.0, cfg_weight=0.0, temperature=0.8, top_p=0.95, top_k=1000, min_p=0.0, norm_loudness=True` (`src/chatterbox/tts_turbo.py`).

| field | default | range | note |
|---|---|---|---|
| `norm_loudness` | **`true`** | boolean | the one turbo-only knob exposed by the app |
| `format` / `sample_rate` | `wav` / `24000` | — | |
| `voice` | **absent** | — | no voice IDs |

**Raises (must be omitted):** `exaggeration`, `cfg_weight`, `min_p` — *even when `0`*, because HSE tests `is not None`.
**No-op:** `speed`, `pitch`, `energy`, `style`, `seed`, `language`.
Not exposed: `temperature 0.8`, `repetition_penalty 1.2`, `top_p 0.95`, `top_k 1000`.

## 4. STT (`faster-whisper-*`)

Gateway request surface is only `input_audio`, `get_language`, `get_timestamps` — **no tunable transcription params to seed**. HSE calls `model.transcribe(audio_ref, batch_size=16)` with library defaults: `beam_size=5`, `language=None` (auto-detect), `temperature=[0.0,0.2,0.4,0.6,0.8,1.0]` fallback schedule, `condition_on_previous_text=True`, `vad_filter=False`.

| model | defaults | confidence |
|---|---|---|
| `faster-whisper-tiny` (free) | model only | documented |
| `faster-whisper-large-v3-turbo` (core) | model only | documented |

## 5. VAD (`silero-vad`)

**Confidence: documented + authoritative for our gateway.** HSE's pydantic defaults (`protocol.py::DetectVoiceActivityRequest`) equal the official Silero helper defaults (`src/silero_vad/utils_vad.py::get_speech_timestamps`).

| field | default | range | source |
|---|---|---|---|
| `threshold` | **0.5** | 0.05–0.95, step 0.05 | silero `threshold: float = 0.5`; HSE `default=0.5` |
| `min_speech_duration_ms` | **250** | 0–2000, step 10 | silero `250` |
| `min_silence_duration_ms` | **100** | 50–2000, step 10 | silero `100`; HSE `100` |
| `speech_pad_ms` | **30** | 0–500, step 10 | silero `30` |
| `return_seconds` | **0 (false)** | — | silero `False` |

Sources: <https://github.com/snakers4/silero-vad/blob/master/src/silero_vad/utils_vad.py>, HSE `harmonyspeech/endpoints/openai/protocol.py`, `inputs.py::prepare_silero_vad_inputs`.

The `400 / 30 / 0 / 2000` variant people cite is **faster-whisper's** `VadOptions` (designed for offline Whisper chunking) — **not** the silero defaults and **not** what HSE uses. Use 0.5 / 250 / 100 / 30.
Use-case note: 100 ms silence is chatty for turn-end auto-stop; 500–700 ms is the usual conversational value — an app decision, not a model default.

## 6. Proposed TS shape

Implemented as `src/constants/soulbitsModelDefaults.ts` — see that file. Summary:

- `SOULBITS_MODEL_DEFAULTS: Record<string, Record<string, number|string|boolean>>` — only keys each model honours.
- `SOULBITS_MODEL_UNSUPPORTED: Record<string, string[]>` — keys to strip on model switch (HSE raises, not ignores).
- `SOULBITS_MODEL_MODULE_OVERRIDES` — per-module sampling overlays (cognition/movement/vision lower temp + capped max_tokens).
- `nextSoulbitsCapability(prev, modelId, moduleType)` — prunes unsupported + module-foreign keys, overlays defaults, sets `model`.

## 7. Conflicts, risks, inconclusive

**Blocking correctness (worker errors, not just ignored params)**

1. HSE **raises** on cross-family Chatterbox params — contradicts `soulbitscloud.md` §5 ("silently ignored"). Omit keys; do not send zeros/false.
2. `norm_loudness: false` is not "off" — HSE checks `is not None`; the key must be **absent** for `chatterbox`/`chatterbox_multilingual`.
3. `resolveEffectiveSpeechOptions` (`modelCapabilities.ts`) mis-advertises turbo: `slug.includes('chatterbox')` returns `exaggeration, cfg_weight, min_p` as supported — exactly the three turbo **rejects**. Per-model map is the safer source of truth until the catalog's `supported_generation_params` is verified.
4. `kitten-tts` voice/language are hard requirements with exact casing (`Bella|Jasper|Luna|Bruno|Rosie|Hugo|Kiki|Leo`; `language: 'default'`). Engine's `RenderSpeech` default `"claire"` would **fail**; app default `"Bella"` is correct.
5. `openvoice_*` voices are language-scoped internals (`default`; `EN-Newest`…). Sending `"Bella"` → KeyError/500. Derive the picker from live `speech_options`.
6. `harmonyspeech` cannot run single-speaker without an embedding — works only through the voice-cloning path.
7. `chatterbox*` has no voice IDs in single-speaker mode — do not present a voice picker.

**Silent no-ops (UX lies, no error)**

8. `format` is always WAV; `sample_rate` is the model's native rate. Both request fields are never read by HSE.
9. `seed` is a no-op for every TTS model. 10. `style` is a no-op everywhere (OpenVoice "styles" are voice ids). 11. `pitch`/`energy` only work on HarmonySpeech.

**Schema gaps vs. model recommendations**

12. `top_k`/`min_p` not on the soulbitscloud schema — Qwen's `top_k=20`, Gemma's `top_k=64` unreachable (fields exist on other providers; or engine sampling presets).
13. `exaggeration` schema max 1.0; official range 0.25–2.0 — widen to 1.5 max.
14. `cfg_weight` schema min 0.0; usable floor 0.2 — clamp 0.2–1.0.
15. Chatterbox `temperature 0.8` / `repetition_penalty 1.2` / `min_p 0.05` honored by HSE but not on the app's TTS surface.

**Engine plumbing (inert defaults — prerequisite, engine repo)**

16. The Go engine drops TTS capability keys: `SoulbitsCloudProviderConfig` (`harmony-link-private/config/types.go:548-578`) has only `Voice, Speed, Format, Language, ImageAspectRatio, ImageSize, ExtraParams`; `RenderSpeech` sends `GenerationOptions{Speed}` only. `pitch`, `energy`, `exaggeration`, `cfg_weight`, `style`, `seed`, `norm_loudness` in `capability_json` are discarded by Go before the gateway sees them. LLM params (`temperature`/`top_p`/`max_tokens`) are wired and effective immediately.

**Model/identity risks**

18. `qwen-35-9b` thinking mode: cannot send `chat_template_kwargs.enable_thinking`; if the worker leaves thinking on, the thinking recommendation is `1.0 / 0.95`. Verify the deployed chat template default.
19. Qwen's documented `presence_penalty 1.5` deliberately not adopted (language mixing risk) — documented deviation.
20. `starfallen-24b` values are an assumption (Mistral-Small-3.2 base via the Starfallen Snow Fantasy merge); also no `INSERT` in gateway migrations (404 risk).
21. `gemma4-meromero-26b-a4b`: base documented (`1.0 / 0.95 / 64`); `1.0` is hot for a companion — per-module overrides are the guardrail.
22. `harrier-oss-v1-0-6b` vs `-06b` id mismatch still unresolved (RAG 404 looks like "no defaults").
23. VAD `min_silence_duration_ms 100` may over-segment conversational turns; product decision.

**Inconclusive**

24. Deployed `chatterbox_multilingual` language codes case (`en` vs `EN`). 25. Whether `speech_options.supported_generation_params` is populated for the chatterbox family. 26. Rerank skipped (no module screen).
