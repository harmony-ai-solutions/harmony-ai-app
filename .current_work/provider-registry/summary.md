# Provider Registry & Config UX — Implementation Summary

Design contract: [plan.md](plan.md) — **APPROVED 2026-10-18**, including the
audit-round decisions (plan §11). Research foundation:
[research/SYNTHESIS.md](research/SYNTHESIS.md) + 13 per-provider docs.
Audit: 28 reviewer agents validated every phase doc against the code
(2026-10-18); findings incorporated.

## Execution model (owner ruling A1)

**Serial per repo; the two chains run in parallel** (disjoint repos —
subagents share one working tree per repo and cannot commit):

- **Engine chain** (`harmony-link-private`): 1-1 → 3-1 → 3-2 → 3-3 →
  4-1 → 4-2 → … → 4-13 → 5-1 → 5-2
- **App chain** (`harmony-ai-app`): 1-2 → 2-1 → 2-2 → 6-1 → 6-2 → 6-3 →
  6-4 → 6-5

The app chain's 6-1 requires the engine chain's 3-2+5-1 to have landed
(API availability) — in practice the engine chain leads. One big release
at the end (7-1, dev channel — ruling A4).

## Pre-tasks (research, docs-only — may run while a chain is idle)

- **R-AUDIO** — Ollama audio TTS/STT wire protocol research →
  `research/ollama-audio.md`. Gates 4-8's audio scope + 6-5's ollama
  tts/stt picker entries (ruling A2).
- **R-MD** — models.dev api.json schema + license addendum →
  `research/modelsdev-catalog.md`. Gates 5-2's codegen.

## Workstream overview

| Phase | Scope | Repo |
|---|---|---|
| 1 | Competitor removal (R9, hard-delete, shim removed per A6) | 1-1 engine · 1-2 app |
| 2 | Preset & picker UX on current API (A3 semantics) | app |
| 3 | `provider_accounts` data model: 3-1 schema/migration/field-split → 3-2 API → 3-3 runtime+validation+shared types | engine |
| 4 | Provider client rework: 11 fixes + 3 activations + ComfyUI re-target + 4-13 openaicompatible fingerprint tree | engine |
| 5 | 5-1 verify/models endpoints → 5-2 models.dev catalog + gated emission | engine |
| 6 | 6-1 repo re-target → 6-2 Providers screen + account schemas → 6-3 account picker forms → 6-4 seeding (7 configs) → 6-5 reactivated pickers | app |
| 7 | 7-1 docs + the single big release (dev channel, dispatch-only) | both |

Cross-phase dependency spine: engine **1 → 3 → 4 → 5**; app **2 → 6**;
engine 3-2/5-1 needed before app 6-1.

## Conventions for every phase doc

- **Repos:** engine = `C:\Users\sge20\go\src\github.com\harmony-ai-solutions\harmony-link-private`,
  app = `C:\Users\sge20\go\src\github.com\harmony-ai-solutions\harmony-ai-app`.
- **Engine test gate** (PowerShell, engine root):
  `$env:CGO_CFLAGS='-DSQLITE_ENABLE_PREUPDATE_HOOK -DSQLITE_ENABLE_SESSION'; go build ./... ; go vet ./... ; go test ./...`
- **App test gate** (PowerShell, app root): `npx.cmd tsc --noEmit` then
  `npm.cmd run test` (single `unit` jest project).
- Subagents run their gates before reporting done; the main session re-runs
  them before marking the phase complete. Windows: `npx.cmd`/`npm.cmd`, no
  `&&` in PS5 one-liners.
- No commits/stashes/pushes by subagents — main session gates and commits
  per owner authorization.
- Engine-contract gates (`engineContractConformance.test.ts`,
  `engineLoopbackSmoke.test.ts`, version canary 1.6.0 after 6-1) pin the
  management API; any API shape change updates them in the same phase.
- Known flaky suites under `jest --randomize` (4, pre-existing) — rerun in
  isolation before treating a failure as real.

## Implementation Status

- [x] **Pre-tasks**
  - [x] R-AUDIO ollama audio protocol → `research/ollama-audio.md`
  - [x] R-MD models.dev addendum → `research/modelsdev-catalog.md`
- [x] **Phase 1: Competitor Removal**
  - [x] Engine removal + migration ([1-1](1-1-EngineCompetitorRemoval.md))
  - [x] App removal ([1-2](1-2-AppCompetitorRemoval.md))
- [x] **Phase 2: Preset & Picker UX (current API)**
  - [x] Model catalog + pickers ([2-1](2-1-ModelCatalogPickers.md))
  - [x] Sampling presets + form structure ([2-2](2-2-SamplingPresetsAndFormStructure.md))
- [x] **Phase 3: Engine Accounts Data Model**
  - [x] Schema + migration + field-split + sync surface ([3-1](3-1-ProviderAccountsSchemaMigration.md))
  - [x] Accounts management API ([3-2](3-2-AccountsManagementApi.md))
  - [x] Runtime resolution + validation + shared types ([3-3](3-3-RuntimeResolutionAndValidation.md))
- [x] **Phase 4: Provider Client Rework** (serial: 4-1 → 4-13)
  - [x] OpenAI ([4-1](4-1-OpenAIClient.md))
  - [x] Anthropic ([4-2](4-2-AnthropicClient.md))
  - [x] Google ([4-3](4-3-GoogleClient.md))
  - [x] xAI ([4-4](4-4-XaiClient.md))
  - [x] OpenRouter ([4-5](4-5-OpenRouterClient.md))
  - [x] ElevenLabs ([4-6](4-6-ElevenLabsClient.md))
  - [x] Mistral chat client, NEW ([4-7](4-7-MistralChatClient.md))
  - [x] Ollama chat client, NEW, R-AUDIO-gated audio ([4-8](4-8-OllamaChatClient.md))
  - [x] LocalAI + RAG config fix ([4-9](4-9-LocalAIAndRagConfig.md))
  - [x] ComfyUI native re-target ([4-10](4-10-ComfyUINativeRetarget.md))
  - [x] Soulvoice ([4-11](4-11-SoulvoiceClient.md))
  - [x] SoulbitsCloud ([4-12](4-12-SoulbitsCloudClient.md))
  - [x] OpenAI-compatible generic client, NEW ([4-13](4-13-OpenAICompatibleClient.md))
- [x] **Phase 5: Verify / Models / Capabilities**
  - [x] Verify + models endpoints ([5-1](5-1-VerifyAndModelsEndpoints.md))
  - [x] Capability catalog + gated emission, R-MD-gated ([5-2](5-2-CapabilityCatalogAndGatedEmission.md))
- [x] **Phase 6: App Account UX & Seeding**
  - [x] Provider repo re-target + contract gates 1.6.0 ([6-1](6-1-ProviderRepoRetarget.md))
  - [x] Providers screen + account schemas ([6-2](6-2-ProvidersScreen.md))
  - [x] Account picker in module configs ([6-3](6-3-AccountPickerModuleConfig.md))
  - [x] Seeding ensure-flow — token on auth/re-auth + gap-fill ([6-4](6-4-SeedingDriver.md))
  - [x] Reactivated provider pickers + schema additions ([6-5](6-5-ReactivatedProviderPickers.md))
- [x] **Phase 7: Release**
  - [x] Docs, changelog, big release — dev channel ([7-1](7-1-DocsChangelogAndRelease.md))
