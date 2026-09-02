# Persona Shared Module Config — "One voice, many faces"

> Plan created 2026-09-02. Cross-repo: **harmony-link-private** (Soulbits Engine / Harmony Link, branch `feat/engine-track-phase2`) + **harmony-ai-app** (branch `senju-design-updates-rebase`). NEVER merge/push either repo.

## Overview

User entities (personas) currently have **no module config path**: `createUserPersona` creates no mapping row, the engine treats missing mappings as all-modules-disabled, and only the built-in `user` entity carries the engine seeder's STT config (`config/db/init.go:79,336`). Voice input therefore only works as the built-in "You".

Approved design (user rulings 2026-09-02):

- **Principle:** identity & memory are per-persona; input processing (STT/VAD) is shared. All user entities resolve their modules from the **canonical built-in `user` entity's mapping** — one source of truth by construction, zero drift.
- **RAG:** NOT for user entities — no UI for it on any user-entity view.
- **TTS:** personas never speak (mic-only). TTS stays AI-only.
- **App UX:** "Voice input" is a *global user setting* (Settings entry + PersonaEdit info link), never per-persona editing. On/off switch maps to the engine provider sentinel (`ProviderDisabled = "disabled"`).
- **Test blocks:** STT/VAD config editor gets a recorder test (record → transcribe → VAD segments); TTS config editor gets a playback test (text → synthesize → listen). Both execute against the *configured* provider via new engine test endpoints — real end-to-end fidelity, local + cloud.
- **Engine frontend:** Entities tab filters to AI entities; new Personas tab (identity CRUD + ONE tab-level "Shared user modules" card, STT-only); Characters tab gets "used-by" badges + create-persona-from-card (copy semantics).

## Critical design constraints

1. **LWW hazard (app):** the engine seeder creates the canonical `user` mapping row with STT wiring. The app must NEVER blindly ensure-create that row — a locally-created NULL row would win row-LWW sync and wipe the engine's STT wiring. Read path treats *missing* as disabled; writes happen only on deliberate user save (legitimate LWW win).
2. **Contract pinning:** phase 1-2 pins the HTTP test-API contract; app phases 2-2/2-3 build against it with contract-shaped mocks (no live engine in unit tests).
3. **AGENTS.md protocol (both repos):** `gitnexus_impact` before editing any symbol, `gitnexus_detect_changes` before committing, TDD where a harness exists.
4. **Codebase mapping:** `.planning/codebase/` exists in both repo roots AND `frontend/.planning/codebase/` in the engine — consult the relevant docs (ARCHITECTURE/STRUCTURE/CONVENTIONS) before implementing; phase files note which were used.

## Phases

- **Phase 1 — Engine backend**
  - 1-1 Canonical module inheritance for user entities + management-API guard
  - 1-2 Module test API (STT transcribe / TTS synthesize) — pinned contract
- **Phase 2 — App**
  - 2-1 "Voice input" settings screen (resolution semantics, first-save provisioning, switch = sentinel, entry points, i18n)
  - 2-2 STT/VAD recorder test block (consumes 1-2 contract)
  - 2-3 TTS playback test block (consumes 1-2 contract)
- **Phase 3 — Engine frontend (Wails/React)**
  - 3-1 Personas tab + AI-entities filter + "Shared user modules" card
  - 3-2 Characters tab "used-by" badges + create-persona-from-card
- **Phase 4 — Docs & verification**
  - 4-1 Memory bank, CHANGELOG, docs, final gates

## Execution order

- **Wave 1 (parallel):** 1-1 + 1-2 (engine backend) ∥ 2-1 + 2-2 + 2-3 (app) — the pinned contract makes this safe.
- **Wave 2:** 3-1 + 3-2 (engine frontend) — after 1-1/1-2 land.
- **Wave 3:** 4-1 (orchestrator-run gates + docs).

## Implementation Status

Track the completion of each phase as implementation progresses:

- [x] **Phase 1: Engine backend**
  - [x] Canonical inheritance + API guard ([1-1-EngineCanonicalInheritance.md](1-1-EngineCanonicalInheritance.md))
  - [x] Module test API ([1-2-EngineModuleTestAPI.md](1-2-EngineModuleTestAPI.md))
- [ ] **Phase 2: App**
  - [x] Voice input settings screen ([2-1-AppVoiceInputSettings.md](2-1-AppVoiceInputSettings.md))
  - [x] STT/VAD recorder test block ([2-2-AppSTTVADTestBlock.md](2-2-AppSTTVADTestBlock.md))
  - [x] TTS playback test block ([2-3-AppTTSTestBlock.md](2-3-AppTTSTestBlock.md))
- [ ] **Phase 3: Engine frontend**
  - [ ] Personas tab + entities filter ([3-1-EngineFrontendPersonasTab.md](3-1-EngineFrontendPersonasTab.md))
  - [ ] Characters badges + persona-from-card ([3-2-EngineFrontendCharactersBadges.md](3-2-EngineFrontendCharactersBadges.md))
- [ ] **Phase 4: Docs & verification**
  - [ ] Docs, memory bank, gates ([4-1-DocsAndVerification.md](4-1-DocsAndVerification.md))
