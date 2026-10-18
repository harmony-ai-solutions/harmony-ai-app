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

- [ ] **Pre-tasks**
  - [ ] R-AUDIO ollama audio protocol → `research/ollama-audio.md`
  - [ ] R-MD models.dev addendum → `research/modelsdev-catalog.md`
- [ ] **Phase 1: Competitor Removal**
  - [ ] Engine removal + migration ([1-1](1-1-EngineCompetitorRemoval.md))
  - [ ] App removal ([1-2](1-2-AppCompetitorRemoval.md))
- [ ] **Phase 2: Preset & Picker UX (current API)**
  - [ ] Model catalog + pickers ([2-1](2-1-ModelCatalogPickers.md))
  - [ ] Sampling presets + form structure ([2-2](2-2-SamplingPresetsAndFormStructure.md))
- [ ] **Phase 3: Engine Accounts Data Model**
  - [ ] Schema + migration + field-split + sync surface ([3-1](3-1-ProviderAccountsSchemaMigration.md))
  - [ ] Accounts management API ([3-2](3-2-AccountsManagementApi.md))
  - [ ] Runtime resolution + validation + shared types ([3-3](3-3-RuntimeResolutionAndValidation.md))
- [ ] **Phase 4: Provider Client Rework** (serial: 4-1 → 4-13)
  - [ ] OpenAI ([4-1](4-1-OpenAIClient.md))
  - [ ] Anthropic ([4-2](4-2-AnthropicClient.md))
  - [ ] Google ([4-3](4-3-GoogleClient.md))
  - [ ] xAI ([4-4](4-4-XaiClient.md))
  - [ ] OpenRouter ([4-5](4-5-OpenRouterClient.md))
  - [ ] ElevenLabs ([4-6](4-6-ElevenLabsClient.md))
  - [ ] Mistral chat client, NEW ([4-7](4-7-MistralChatClient.md))
  - [ ] Ollama chat client, NEW, R-AUDIO-gated audio ([4-8](4-8-OllamaChatClient.md))
  - [ ] LocalAI + RAG config fix ([4-9](4-9-LocalAIAndRagConfig.md))
  - [ ] ComfyUI native re-target ([4-10](4-10-ComfyUINativeRetarget.md))
  - [ ] Soulvoice ([4-11](4-11-SoulvoiceClient.md))
  - [ ] SoulbitsCloud ([4-12](4-12-SoulbitsCloudClient.md))
  - [ ] OpenAI-compatible generic client, NEW ([4-13](4-13-OpenAICompatibleClient.md))
- [ ] **Phase 5: Verify / Models / Capabilities**
  - [ ] Verify + models endpoints ([5-1](5-1-VerifyAndModelsEndpoints.md))
  - [ ] Capability catalog + gated emission, R-MD-gated ([5-2](5-2-CapabilityCatalogAndGatedEmission.md))
- [ ] **Phase 6: App Account UX & Seeding**
  - [ ] Provider repo re-target + contract gates 1.6.0 ([6-1](6-1-ProviderRepoRetarget.md))
  - [ ] Providers screen + account schemas ([6-2](6-2-ProvidersScreen.md))
  - [ ] Account picker in module configs ([6-3](6-3-AccountPickerModuleConfig.md))
  - [ ] Seeding ensure-flow — token on auth/re-auth + gap-fill ([6-4](6-4-SeedingDriver.md))
  - [ ] Reactivated provider pickers + schema additions ([6-5](6-5-ReactivatedProviderPickers.md))
- [ ] **Phase 7: Release**
  - [ ] Docs, changelog, big release — dev channel ([7-1](7-1-DocsChangelogAndRelease.md))
