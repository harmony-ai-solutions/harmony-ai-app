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
- ✅ **SHIPPED 2026-10-19**: engine `v0.4.3-dev` ([run 39172194525](https://github.com/harmony-ai-solutions/harmony-link-private/actions/runs/39172194525), artifact 200 @ engine/v0.4.3-dev/arm64/libengine.so, 57.6MB) · app `v0.4.5-dev` ([run 39174517889](https://github.com/harmony-ai-solutions/harmony-ai-app/actions/runs/39174517889), APK 200 @ app/v0.4.5/dev/harmony-ai-app-v0.4.5-android.apk, 111.8MB, manifest serving v0.4.5-dev). ENGINE_SIDECAR_VERSION=v0.4.3-dev. No tags anywhere.
- Post-ship: memory banks updated (app dde66ef, engine 56ef889) + pushed. summary.md 38/38 checked.
- Release incidents (resolved): CharactersScreen 5s timeout deterministic on new Ubuntu-26 runners → jest.setTimeout(15s) (f780bee); version input must be BARE (v0.4.5) — pipeline appends channel → my -dev suffix produced a v0.4.5-dev-dev run (39173254084, superseded; orphaned immutable objects under app/v0.4.5-dev-dev/ — optional CDN cleanup).
- Owner rollout pending: direct-install once, then quick-succession device upgrades (plan §3.3 sync-surface mitigation).

## Event log
- 2026-10-18: wave 1 dispatched — R-AUDIO, R-MD, engine 1-1, app 1-2.
- 2026-10-18: engine chain complete (1-1 → 5-2, 19 commits incl. Silero client v0.1.2 regen+push).
- 2026-10-18: app chain complete (1-2 → 6-5, gates green throughout; runInBand 1631/1631 final).
- 2026-10-19: SHIPPED engine v0.4.3-dev + app v0.4.5-dev (dev channel).

## Patch v0.4.6 (owner device testing round 1 — 2026-10-19)
Owner reports: (1) chat-entry from CharactersScreen fails w/ unspecified error; (2) soulbitscloud account shows STT-flavored name + key icon says token expired (expectation: startup refreshes the token). App-logs gap: no in-app app-log access (engine logs only) — owner ruling: viewer+share+error-diag logging, ONE combined release (app v0.4.6 + engine v0.4.4-dev).
- ✅ Engine 000053 name canonicalization — `bbd7b4c` (longestName merge fix; "Soulbits Cloud"; 3 tests; 43 pkgs green). DIAGNOSED: migration_provider_accounts.go:704.
- ✅ App token freshness fix — `dbfd94a` (startup refreshIfExpiring + ensure-flow resolveFreshToken stale-guard; +15 tests; runInBand 1646/1646). DIAGNOSED: AuthService.getToken() no expiry check; auth:changed only on login/register/refresh; ensure bootstrap propagated stale PASETO (seeding.ts:153).
- ✅ Bug-1 fix (engine) — **DROPPED per owner ruling 2026-10-19** (`27057c5` reset off the branch, recoverable via reflog/cherry-pick while it lives). Reasoning: diagnosis was static inference, not reproduced; with app-side logging (9bebd5b) the owner will capture the exact error on-device and we fix the real cause, not a guess. PRESERVED ANALYSIS for when logs arrive: (a) suspected chain — LoadAllEntities all-or-nothing 500s GET /api/entities when one entity mapping refs a missing/soft-deleted config → app openCharacterChat generic alert; engine startup log line `Failed to load entities from database: failed to load config for entity <ID>: ...` would confirm + name the offender. (b) Two WRITE-PATH holes found regardless (fix later, design pending): config soft-delete does no mapping cleanup/in-use check (repository/modules/*.go:124-139), and UpdateEntityMappings writes config ids unvalidated (entity_controller.go:527). Deferred fork: cascade-NULL on delete vs 409-block; mapping-write validation either way.
- ✅ App logging feature — `9bebd5b` (ring buffer w/ persisted tail + App Logs viewer + share/copy diagnostics + error-dialog action; +37 tests; runInBand 186/186, 1683/1683)
- ✅ AppLogScreen parity polish — `6e3c1e4` (dedup ×N badges, per-row long-press copy, pause freezes snapshot; owner review round 2)
- **PATCH v0.4.6 SHIPPED 2026-10-19**: app `v0.4.6-dev` ([run 39229905769](https://github.com/harmony-ai-solutions/harmony-ai-app/actions/runs/39229905769), APK 200 @ app/v0.4.6/dev/, 111.9MB, manifest serving v0.4.6-dev) + engine `v0.4.4-dev` ([run 39229585547](https://github.com/harmony-ai-solutions/harmony-link-private/actions/runs/39229585547), artifact 200, 57.6MB; ENGINE_SIDECAR_VERSION updated). Commits: app dbfd94a + 9bebd5b + 6e3c1e4 + f9319fd; engine bbd7b4c + 3206a5c. No tags.
- NEXT (owner-driven): install v0.4.6, reproduce chat-entry bug, share App-logs diagnostics → evidence-based fix round for bug-1 + the two write-path holes.
- ⬜ Combined release: app v0.4.6 + engine v0.4.4-dev (owner go required)

## Patch v0.4.7 (owner device testing round 2 — 2026-10-19)
Owner reports, with **App-logs diagnostics shared** (run 2): (1) starting a chat fails with `failed to load config for entity Iris-Hawthorne-…: failed to load TTS config: failed to get TTS config: sql: Scan error on column index 3, name "provider_account_id": converting NULL to string is unsupported`; (2) the App-logs viewer shows oldest-at-top → newest-at-bottom (owner expects the reverse, matching the Engine-logs viewer). The shared diagnostics turned the v0.4.6 NEXT item into an evidence-based fix — Bug-1 is **confirmed** (the preserved analysis' entity-config-load chain) and is a READ-path defect, not the write-path holes.
- ✅ Engine NULL-account read fix — `a281843`. ROOT CAUSE: migration 000052 makes `provider_account_id` nullable and writes NULL for orphaned configs (`nullStr(accountID)`), but every module-config `SELECT` scanned the column into a Go `string`. All 8 module repos (backend/cognition/imagination/movement/rag/tts/vision + STT dual slots) now `COALESCE(provider_account_id, '')` = the "no account" sentinel `loadProviderModelForModule` already uses. `+ null_provider_account_test.go` (per-table regression; proven to reproduce the exact Scan error pre-fix). Gates: `go test ./database/... ./database/repository/...` green; `go vet` clean. (Full `go build ./...` cannot link `cmd/engine-sidecar` on this box — missing local `sqlite3changeset_*` symbols; pre-existing env limitation, CI covers it.)
- ✅ App logs order fix — `04cbaca`. `buildAppLogRows` now returns newest→oldest, follow pins to the top (`scrollToOffset(0)`), dedup still keeps the newest representative; share/copy exports stay chronological so the diagnostics header time range is unchanged. `AppLogScreen` 16/16, `appLogs`+`appDiagnostics` 45/45, `tsc --noEmit` clean, eslint no errors.
- **PATCH v0.4.7 SHIPPED 2026-10-19**: engine `v0.4.5-dev` (`ef9506d`; [run 39238540497](https://github.com/harmony-ai-solutions/harmony-link-private/actions/runs/39238540497), artifact 200 @ engine/v0.4.5-dev/{arm64,x86_64}) + app `v0.4.7-dev` (`c407183`; [run 39238858031](https://github.com/harmony-ai-solutions/harmony-ai-app/actions/runs/39238858031), APK 200 @ app/v0.4.7/dev/, manifest serving v0.4.7-dev). ENGINE_SIDECAR_VERSION repo variable → `v0.4.5-dev`. No tags, no republish.
- NOTE (data): the Iris TTS config's account link is genuinely orphaned (the referenced provider row was gone at 000052 — the old `provider_config_*` tables are dropped, so it is unrecoverable). v0.4.7 stops the crash so the chat loads; that module needs its provider account re-selected in Settings → Modules.
- STILL OPEN (deferred, unchanged): the two write-path holes (config soft-delete does no mapping cleanup/in-use check; UpdateEntityMappings writes config ids unvalidated).
