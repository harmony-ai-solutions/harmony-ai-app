# OpenCode Go Provider — Soulbits Engine + App

Adds **OpenCode Go** (OpenCode's Go / Go Plus / Go Teams subscription) as a first-class
LLM provider (`opencodego`) for the chat-family modules (Backend, Cognition, Movement,
Vision), and prepares the provider architecture for **typed-decision models** (Jev-style)
without implementing them.

## Background

- OpenCode Go serves curated open coding models over OpenAI-compatible
  `POST https://opencode.ai/inference/go/openai/v1/chat/completions`
  (Console translates dialects — every text model works over chat/completions).
- Model list: `GET https://opencode.ai/inference/go/v1/models` (⚠ different prefix from
  the chat base — no `/openai` segment).
- Auth: `Authorization: Bearer <console API key>`.
- Client obligations (enforced — requests without a session id are rejected):
  1. Stable `x-opencode-session` header per conversation (routing + prompt-cache warmth).
  2. Self-identifying `User-Agent` (own client name, not a generic SDK/library name).
- Response extras: `opencode.allowance` (Go usage in $), `opencode.tokens` (follow-up, not v1).
- Chosen defaults: provider id `opencodego`; default model `deepseek-v4.1-flash`.

## Design decisions (owner-approved 2026-11-15)

- **Option B — dedicated provider** (vs. generic custom-headers on `openaicompatible`).
- **Session ids are engine-derived and deterministic**: `soulbits-<entityId>-<module>`.
  Provider instances are already per-entity (each module `Init(entityId, …)` builds its
  own), so this maps 1:1 onto OpenCode's "stable session per conversation" semantic and
  keeps the cache warm across engine restarts.
- **Decision-model preparation (Jev-ready, Jev-not-built)**:
  1. `OpenCodeGoProvider` is a *capability shell*: it owns account/session/UA/header
     concerns; the OpenAI chat client is an inner piece. A future decision client is one
     new file + an interface assertion — no refactor.
  2. Future capability = optional client interface asserted by modules (the existing
     `backend.Client` pattern). The `decision.Client` contract is specified in
     [4-1-FutureDecisionModels.md](4-1-FutureDecisionModels.md) — NOT implemented now.
  3. Account row stays capability-agnostic (key + base_url serve all capabilities;
     endpoint paths resolve per-capability). Preserve this invariant.
  4. Catalog: `opencodego` Tier-1 entries carry `capabilities: ["chat"]`; a future
     `jev-1.13` entry would carry `["decision"]`; module slots filter on the tag
     (existing `CatalogModel.Capabilities` field — no schema change).

## Phases

Engine work targets the sibling repo `harmony-link-private`; app work targets this repo.
Engine phase files consulted `harmony-link-private/.planning/codebase/INTEGRATIONS.md`;
app phase files consult this repo's `.planning/` mapping where relevant.

- **Phase 1 — Engine provider core** (`harmony-link-private`)
  - [1-1 Engine config, models & account type](1-1-EngineConfigAndModels.md)
  - [1-2 Engine provider client (chat capability + headers/session/UA)](1-2-EngineProviderClient.md)
  - [1-3 Engine session-aware seam (module call sites)](1-3-EngineSessionSeam.md)
  - [1-4 Engine wiring & account validation](1-4-EngineWiringAndValidation.md)
  - [1-5 Engine emission tables & provider tests](1-5-EngineEmissionAndTests.md)
- **Phase 2 — Catalog & management contract** (`harmony-link-private`)
  - [2-1 Tier-1 model catalog + capability tags](2-1-CatalogTierOne.md)
  - [2-2 Management contract bump 1.11.0 → 1.12.0](2-2-ContractBump.md)
- **Phase 3 — App integration** (`harmony-ai-app`)
  - [3-1 Provider options, defaults & TS types](3-1-AppProviderOptions.md)
  - [3-2 Account & capability field schemas](3-2-AppFieldSchemas.md)
  - [3-3 Engine contract pin & fixtures](3-3-AppContractPin.md)
  - [3-4 i18n, store-variant sanity & manual E2E](3-4-AppI18nAndE2E.md)
- **Phase 4 — Future (out of scope, spec only)**
  - [4-1 Typed-decision models (Jev) — seam spec](4-1-FutureDecisionModels.md)

## Implementation Status

- [ ] **Phase 1: Engine provider core**
  - [ ] 1-1 Config, models & account type
  - [ ] 1-2 Provider client
  - [ ] 1-3 Session seam
  - [ ] 1-4 Wiring & validation
  - [ ] 1-5 Emission & tests
- [ ] **Phase 2: Catalog & contract**
  - [ ] 2-1 Catalog Tier-1
  - [ ] 2-2 Contract bump
- [ ] **Phase 3: App integration**
  - [ ] 3-1 Options & defaults
  - [ ] 3-2 Field schemas
  - [ ] 3-3 Contract pin
  - [ ] 3-4 i18n & E2E

## Risks & notes

- **Traffic shape**: Go is intended for coding-agent-like traffic; Pi (a companion-style
  agent) is validated and we satisfy session + UA requirements by design. One-time read
  of OpenCode's terms recommended; OpenCode monitors for abuse.
- **Privacy/regions**: workspace defaults region-gate DeepSeek / LongCat-2.5-Free
  (need "Global") and block training-on-data models (Muse Spark, Iceman) — catalog
  labels surface this in the picker.
- **Free-tier models** return 403 from non-OpenCode clients → verify classifies as
  `scope_limited` (existing taxonomy).
- **Per-model usage limits** (5h / weekly / monthly $ windows) can 429 → `throttled`.
- OpenCode Go has **no embeddings/speech** → never offered for RAG/TTS/STT/VAD/Imagination.
- Per AGENTS.md: run `gitnexus impact` before editing any engine symbol, and
  `gitnexus detect_changes` before committing in either repo.
