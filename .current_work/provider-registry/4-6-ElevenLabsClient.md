# Phase 4-6 — Engine: ElevenLabs Client Rework

**Repo:** harmony-link-private · **Depends on:** 3-3 · Serial engine chain
**Refs:** research/elevenlabs.md (§2.3 envelope, §3 models, §4.2-4.4 gating, §5 wire names, §8.2 recipe) · SYNTHESIS §5 item 6

## Objective

Fix the lossy vendored SDK error handling, move to canonical v2 voices,
models listing with per-version param gating. STT is OUT of scope (audit:
no STT discriminator in `/v1/models`, no engine ElevenLabs STT consumer —
`TranscriptionConfig` supports soulvoice/openai/openrouter/soulbitscloud).

## Implementation steps

1. **Raw-HTTP client path (required for more than errors):** the vendored
   `haguro/elevenlabs-go@v0.2.4` (no `replace`, vendor/) hardcodes `/v1`
   (client.go:19), has unexported internals, NO `/v2/voices` method, lacks
   `maximum_text_length_per_request` (models.go:18-33) and `speed`
   (models.go:64-69). Error handling parses only 400/401/422 and discards
   the rest (client.go:113-134). Build a raw-HTTP layer for: error
   envelopes, voices, models, subscription; keep SDK only where adequate
2. **Error envelope preservation:** parse
   `{"detail":{type,code,message,request_id,param}}` → VerifyResult:
   401 `authentication_error` invalid; 402 `payment_required` blocked;
   403 `authorization_error` (incl. IP-allowlist) scope_limited; 429
   `rate_limit_error` throttled; transport unreachable
3. `ValidateConfig()`: **today calls `GetVoices()` (legacy /v1/voices —
   elevenlabs.go:70-78)** — switch to `GET /v1/user/subscription`:
   tier, character_count/limit, reset in the payload
4. **Voices: `GET /v2/voices`** (canonical, paginated/filtered) —
   account-scoped, live-only, surfaced via 5-1's models route
5. `ListModels()`: `GET /v1/models` filtered `can_do_text_to_speech` AND
   `!requires_alpha_access`; map `maximum_text_length_per_request`
   (not deprecated fields), languages → 3-3 ModelInfo. No STT clause
6. Param gating per model version via the 3-3 helper: `style` v2/v3-only;
   **`speed` v2-only** (research §4.2: not on v3 or v4); v4 =
   stability+similarity_boost only; `language_code` unsupported on
   multilingual v2; `apply_text_normalization` Enterprise-only on Flash;
   `optimize_streaming_latency` deprecated — never emitted
7. Wire names: `voice_settings{stability,similarity_boost,style,
   use_speaker_boost}` (research §5 — note `use_speaker_boost`, the
   config field is SpeakerBoost)

## Test gates

- Engine gate green
- Tests: envelope parsing for all VerifyResult states, v2 voices
  pagination, model filtering + field mapping, per-version gating fixtures

## Checklist

- [ ] Raw-HTTP layer (envelope, voices, models, subscription)
- [ ] VerifyResult taxonomy complete
- [ ] Verify via /v1/user/subscription (+tier/quota payload)
- [ ] /v2/voices canonical listing
- [ ] Model listing with TTS + alpha filters (no STT)
- [ ] Per-version param gating (speed v2-only)
- [ ] Engine gate green
