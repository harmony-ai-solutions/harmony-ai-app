# Provider Registry — Execution Log

Orchestrated run started 2026-10-18 (owner go). Model: two serial chains in
parallel (A1); code-expert subagents implement, never commit; main session
gates + commits per phase. Contract: plan.md (R1–R12, A1–A11) + summary.md.

Legend: ⏳ running · ✅ committed · ⏸ paused/blocked · ⬜ queued

## Pre-tasks
- ✅ R-AUDIO → research/ollama-audio.md (2026-10-18). Verdict: Ollama audio = **STT only** (`POST /v1/audio/transcriptions`, multipart, experimental, server ≥ v0.20.0, text-only response, gemma4 e2b/e4b/12b); **no TTS, no VAD** (stock Ollama). 4-8 implements stt-experimental only; 6-5 adds ollama to transcription picker (labeled experimental), NOT tts/VAD. 7 unknowns flagged for live probes.
- ✅ R-MD → research/modelsdev-catalog.md (2026-10-18). MIT corroborated (`github.com/anomalyco/models.dev`, LICENSE (c) 2025, covers code+data; attribution header in 5-2). Schema: flat provider map, 232 providers / 9,048 models; `temperature` bool = gated-emission signal; voice/STT absent from api.json (stays hand-curated); snapshot-at-release pinning + go:embed. Gates 5-2 codegen.

## Engine chain (harmony-link-private, serial)
- ✅ 1-1 competitor removal — `c56d703` (34+4 files, −2417 net); sync 35→32. "App paired migration" handoff MOOT.
- ✅ 3-1 provider_accounts schema — 64 files +9 new (+1432/−6941); migration 000052 (Go-hook rebuilds, round-trip green); sync 32→20; seeder reworked per A8–A10; split helpers in database/controllers/provider_field_split.go (3-3 consumes). HANDOFF→6-1: app SYNC_TABLES must drop 13 provider_config_* + add provider_accounts (engine now at 20).
- ✅ 3-2 accounts management API — semantic CRUD + 409 refs + merged GET (A7) + flat no-minting module writes; §3.1 validator shared for 3-3. FLAG→6-3: module read does NOT expose provider_account_id/capability_json top-level yet — 6-3 flags if engine-side exposure needed.
- ✅ 3-3 runtime resolution + validation — ModelInfo (label+rich fields, A7-owned) + VerifyResult 6-state + emission helpers (zero-value=unset, WireMapper→5-2 loader); ValidateConfig now (VerifyResult, error) across all providers. HANDOFF→6-1: ModelInfo wire shape CHANGED (name/description → label+fields); validate-provider details now warn-only capability findings.
- ✅ 4-x client run COMPLETE: 4-1 (`9114468`) · 4-2 (`2d452d5`) · 4-3 (`46ab5d6`) · 4-4 (`c916db4`) · 4-5 (`1e711a9`) · 4-6 (`ce033ba`) · 4-7 (`b81c1bb`) · 4-8 (`cbcd78e`) · 4-9 (`e0440fc`) · 4-10 (`20d8652`) · 4-11 (`707dbc1`+v0.1.2+`09eaa51`+`4d2a1f2`) · 4-12 (`edb5328`) · 4-13 (`a147829`)
- ✅ 5-1 verify/models endpoints — `a217dd1` (stateless verify, models+fingerprint writer, voices; retired validate-provider + /api/models). **App hold RELEASED.**
- ✅ 5-2 capability catalog + gated emission — `8d9c1ba` (121KB embedded catalog, catalog-authoritative wire/suppression w/ in-code fallback, merger installed, GET /api/providers/capabilities landed → 6-1 fixture flag RESOLVED)
- **ENGINE CHAIN COMPLETE (code phases). Remaining: 7-1 release (docs + AppVersion bump + dispatch).**

## App chain (harmony-ai-app, serial; RESUMED after engine 3-2+5-1)
- ✅ 1-2 competitor removal — `04541dd` (12 files, −412 net)
- ✅ 2-1 model catalog + pickers — `c186e1e` (tier-2 constants + CatalogModelSelect + 27 tests)
- ✅ 2-2 sampling presets + form structure — `27a80c1` (usePresets + SamplingPresetSelect + 4-section form; 1538/1538)
- ⏳ 6-1 ✅ `4d1128e` · 6-2 ✅ `1713d94` · 6-3 ✅ `1d53efa` · 6-4 ✅ `a7068e4` (ensure-flow: ungated token on auth/re-auth + one-shot gap-fill incl. VAD; 17 tests) · ⏳ 6-5 running (LAST app code phase)

## Release
- 7-1: app docs/bump ✅ `da969e9` (v0.4.5) · engine docs/bump ✅ `472ef9e` (AppVersion v0.5.0-dev, openapi 1.6.0 + fixtures 49/49) · **AWAITING OWNER GO** for: push branches → engine android_only dispatch (v0.5.0-dev) → artifact 200 check → ENGINE_SIDECAR_VARIABLE=v0.5.0-dev → app publish_latest dispatch (0.4.5, build_ios=false) → APK/manifest verify. Never a tag; never republish.

## Event log
- 2026-10-18: wave 1 dispatched — R-AUDIO, R-MD, engine 1-1, app 1-2.
- 2026-10-18: engine chain complete (1-1 → 5-2, 19 commits incl. Silero client v0.1.2 regen+push).
- 2026-10-18: app chain complete (1-2 → 6-5, gates green throughout; runInBand 1631/1631 final).
