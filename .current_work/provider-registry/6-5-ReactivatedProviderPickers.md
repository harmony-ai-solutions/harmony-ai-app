# Phase 6-5 — App: Reactivated Provider Pickers + Schema Additions

**Repo:** harmony-ai-app · **Depends on:** 4-7/4-8/4-9 (clients), 6-1 · Serial app chain · **Gated by:** R-AUDIO (ollama tts/stt only)
**Refs:** plan.md §10.-0.5 (amended), §11 · research mistral.md §4-§5/§8, ollama.md §4.2/§8.5, localai.md

## Objective

Expose the reactivated providers in the module pickers with
research-derived fields — plus the engine-param schema additions from
4-3/4-4 (google thinking, xai image_model).

## Implementation steps

1. `src/constants/moduleConfiguration.ts` providerOptions:
   - `mistral`: backend, cognition, movement, vision, rag — **NO tts/stt**
     (audit: 4-7 builds no STT client; Voxtral exists but is out of
     engine scope — future work note)
   - `ollama`: backend, cognition, movement, vision, rag — **tts/stt only
     if R-AUDIO confirms a tractable protocol** (owner ruling); otherwise
     omitted
   - `localai`: same set as `openaicompatible` (backend, cognition,
     movement, rag, stt, tts, vision)
2. **Per-slot STT provider lists (audit + A11):** the transcription and
   VAD pickers currently share one list (openai / openaicompatible /
   openrouter / soulbitscloud / elevenlabs —
   ModuleConfigEditScreen.tsx:839-850; note: soulvoice is NOT in it
   today). Split per slot by actual engine clients:
   - transcription: current five **+ soulvoice (A11)** + ollama/localai
     (ollama only post-R-AUDIO)
   - VAD: **soulbitscloud + soulvoice** — the two providers with real
     VADClient implementations; today's shared list over-offers VAD on
     providers without VAD clients, and fixing that is in-scope here
3. `providerFieldSchemas.ts` (flat per-provider `fields[]` — fields
   surface for ALL modules the provider serves; acceptable, advanced) +
   `moduleDefaults.ts`:
   - ollama: full research §4.2/§8.5 option set (top_k, min_p,
     repeat_penalty, repeat_last_n, num_ctx, num_predict, stop, seed,
     think, format, keep_alive + defaults) — NOT the shortened list
   - mistral: random_seed (not seed), no max_completion_tokens, temp max
     1.5, reasoning_effort enum note (research §4/§5 tables — the §8 refs
     are recommendations only)
   - localai: superset note (native names accepted)
   - **google: thinking_level/thinking_budget fields (4-3)**; **xai:
     image_model field (4-4)**
4. `moduleConfiguration.test.ts`: **NEW provider→modules expectation map**
   (audit: the existing assertion is soulbitscloud-specific and gated on
   SOULBITS_MODEL_QUERY — a new map pins mistral/ollama/localai, not an
   extension of the old loop)
5. STT note: VoiceInputSettingsScreen has no provider list of its own —
   it routes to ModuleConfigEditScreen pinned to stt; the per-slot lists
   (step 2) are the whole change
6. Manual-verify note at execution: dev build shows the providers across
   expected module pickers

## Test gates

- `npx.cmd tsc --noEmit` + `npm.cmd run test` green incl. the new
  expectation-map test

## Checklist

- [ ] Picker entries per module × provider (mistral no tts/stt; ollama per R-AUDIO)
- [ ] Per-slot STT lists (VAD unchanged)
- [ ] Field schemas: full ollama set, mistral rules, google thinking, xai image_model
- [ ] New expectation-map test
- [ ] tsc + jest gates green
