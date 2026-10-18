# Phase 4-11 — Engine: Soulvoice Client Rework

**Repo:** harmony-link-private · **Depends on:** 3-3 · Serial engine chain
**Refs:** research/soulvoice.md (§1.5, §2, §5.2, §8) · SYNTHESIS §5 item 8 · plan §11 (voice-config ruling)

## Objective

Implement model listing, fix the missing HTTP timeout, align auth headers
with the server, structured verify. **Voice configs stay file/URL-based
(owner ruling 2026-10-18 — the SoulvoiceVoiceConfig file mechanism is
KEPT; the overlay covers non-voice capability fields only).**

## Implementation steps

1. **Timeout (hang risk):** replace `http.DefaultClient` (client.go:63)
   with explicit timeouts (verify 3-5s; synthesis generous but bounded —
   no infinite waits)
2. `ListModels()` ("not implemented" — soulvoice.go:321-323): fan-out
   `GET /v1/audio/{speech,transcriptions,vad}/models`; map ModelCard
   (nested `languages[].voices[]`) → 3-3 ModelInfo (tts/stt/vad tags;
   languages/voices into meta)
3. `ValidateConfig()` (returns raw errExecute, no status check —
   soulvoice.go:101-107): keyless `GET /version` (reachability + identity)
   → optional `GET /v1/audio/speech/models` (auth check when a key is
   set); VerifyResult: 401 invalid; 404 wrong-path (detail); transport
   unreachable. `/health` is NOT called (dropped from scope — audit)
4. **Auth alignment (server code is authoritative — api_server.py:325-326,
   345):** server reads `Api-Key` AND (when HARMONYSPEECH_API_KEY is set)
   requires `Authorization: Bearer <token>`; `x-api-key` is dead. Client
   change: **send `Api-Key` + `Authorization: Bearer`; drop `x-api-key`**
   (all six call sites: 96-98, 173-175, 225-227, 263-265, 298-300). The
   generated client has no Authorization setter — custom header/transport
5. **Config split (owner ruling):** account row keeps endpoint (→base_url)
   + api_key. **The 8 voice fields (mode/language/voice/style/speed/pitch/
   seed/target_embedding) STAY in `SoulvoiceVoiceConfig` loaded from
   `VoiceConfigFile` (config/voice.go:16-31; legacy-V1 upgrade path
   144-155) — NOT moved to capability_json.** Overlay carries only
   non-voice capability fields (e.g. STT/VAD model per plan §3.2 — TTS
   model comes from the voice config, research quirk). `stream=true` is
   400 server-side — never emit; `mode` required for TTS
6. **Client regeneration REQUIRED (not conditional):** the server HAS the
   Silero VAD params (protocol.py:277-286) while the external module
   `harmony-speech-engine-client-go v0.1.1-…` (go.mod:25, NOT vendored)
   lacks them — regenerate in the sibling repo + go.mod bump here

## Test gates

- Engine gate green
- Tests: fan-out listing + ModelCard mapping, VerifyResult mapping (401/
  404/transport), timeout enforcement (hanging server), stream never
  emitted, header set (Api-Key + Bearer, no x-api-key)

## Checklist

- [ ] HTTP timeouts everywhere
- [ ] ListModels fan-out + mapping
- [ ] VerifyResult + status-code checks
- [ ] Headers: Api-Key + Authorization Bearer; x-api-key dropped
- [ ] Voice config stays file/URL-based; overlay = non-voice fields
- [ ] Client regenerated (Silero params) + go.mod bump
- [ ] Engine gate green
