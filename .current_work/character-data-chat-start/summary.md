# Character Data & Chat-Start — Implementation Plan

> **Status:** Ready for execution. Plan validated against both repos by 6 parallel code-expert verification passes (see [`00-VerificationAndGroundTruth.md`](00-VerificationAndGroundTruth.md)).
> **Source concepts:** [`../character-data-chat-start-concept/01-data-and-engine-concept.md`](../character-data-chat-start-concept/01-data-and-engine-concept.md) (data/backend) · [`../character-data-chat-start-concept/02-frontend-and-ux-concept.md`](../character-data-chat-start-concept/02-frontend-and-ux-concept.md) (frontend/UX).
> **Affected repos (coupled release mandatory):**
> - **Go backend (engine):** `../harmony-link-private` — referenced below as **`harmony-link-private/`**.
> - **RN/TS app:** this repo — referenced as **`harmony-ai-app/`** (root).

---

## Overview

This plan implements spec-compliant **Character Card V3** data fidelity, a **chat-start engine** that delivers an authored `first_mes` greeting on truly-new chats and generates custom/scenario greetings on demand, **semantic lorebook retrieval** via the existing RAG store, and **V3 round-trip export**.

Four headline outcomes:
1. **Cards finally open with a message** — the #1 UX gap. The engine delivers the authored `first_mes` at `INIT_ENTITY` (truly-new chats only); the app renders it.
2. **No more data mangling** — the importer stops burying `first_mes`/`mes_example`/`alternate_greetings` into `example_dialogues` and stops flattening `character_book` into `backstory`. Every standard field gets a real home.
3. **World-info works (semantic)** — lorebook entries are embedded into a per-entity `lore` RAG collection and retrieved by semantic similarity at prompt-build time.
4. **Community shareability** — a V3 exporter (JSON + PNG `ccv3`) preserves every field losslessly, including the full `character_book`.

**Architectural anchors (fixed decisions — see concept docs + verification):**
- **Greeting ownership = engine-authoritative end-to-end.** The app is **render-only** — no local `first_mes`, no optimistic placeholder, no reconciliation. The authored `first_mes` is delivered at `INIT_ENTITY` **only for a truly-new chat** (zero messages on the resolved interaction AND no prior interaction WITH MESSAGES for the pair — the pair has never had a real conversation; empty/abandoned prior interactions do NOT block the greeting). No auto-generation, no generic fallback. A card with no `first_mes` opens empty + a "generate a greeting" hint.
- **Guided-input transport = single dedicated `GENERATE_GREETING` event.** `INIT_ENTITY` never carries generation params; every custom / regenerate / scenario-restart greeting is a follow-up `GENERATE_GREETING`.
- **Lorebook = single `character_book` JSON column** on `character_profiles` (lossless round-trip) + per-entity `lore` RAG collection (semantic index over the JSON source-of-truth). Accepted trade-off: semantic matching, not keyword/regex; only `constant` is honoured behaviourally.
- **Macro engine = net-new on both sides** (none exists today). App resolves on preview surfaces only; engine resolves for delivery/generation/all prompt-built text so no `{{…}}` reaches an LLM.
- **Backward-compat backfill = OUT OF SCOPE.** Nothing is deployed yet; dev DBs are wiped + re-imported with the new mapper.
- **Coupled release mandatory** — the `CharacterProfileSync` wire format gains fields; app/engine skew would silently desync.

---

## Repos & codebase maps consulted

Executors MUST read the relevant codebase-mapping docs before touching each repo:
- **App:** `harmony-ai-app/.planning/codebase/{ARCHITECTURE,STRUCTURE,CONVENTIONS,TESTING,CONCERNS}.md`
- **Engine:** `harmony-link-private/.planning/codebase/{ARCHITECTURE,STRUCTURE,CONVENTIONS,TESTING,CONCERNS}.md`
- **Spec reference:** `harmony-link-private/.current_work/character-card-spec-v3/SPEC_V3.md` (605 lines; anchors verified accurate — `ccv3` mandate :28, fields :75, entries :290, decorators :374, macros :564).

All file:line anchors in this plan are **verified ground truth** (see [`00-VerificationAndGroundTruth.md`](00-VerificationAndGroundTruth.md)). Where a concept doc's anchor drifted, the plan uses the corrected anchor.

---

## Phases

| Phase | Scope | Coupled? | Earliest user value |
|---|---|---|---|
| **P1 — Data model + authored static greeting** | Migration `000037` (both repos, incl. `character_book` JSON column); V3 types + parser `ccv3` fix; mapper stops mangling (stores `character_book` to JSON); net-new macro engine; engine greeting delivery primitives + `handleInitEntity` hook (4 guards); app render-only UX (GreetingBubble, authored swipes, empty+hint). | Yes (sync wire) | **Cards open with a message.** |
| **P2 — Engine generation hook + scenario restart** | `BuildScenarioGreetingPrompt` (4th builder mode); `GENERATE_GREETING` handler (random/directed) with regenerate precondition; `START_NEW_SCENARIO` (scenario restart — force-new interaction); app `ScenarioGeneratorSheet` + composer ✨ icon + generate/regenerate swipes + preparing shimmer. | Yes | **On-demand custom / scenario greetings.** |
| **P3 — Lorebook RAG + editor + guided mode** | Per-entity `lore` RAG collection + embedding (import/edit/init) + semantic retrieval in prompt build (top-N + `constant` union); lorebook editor UI; profile-editor sections (Greeting/Alternate/Lorebook/Attribution/Tags/Advanced); `ImportReviewSheet`; `post_history_instructions`/`{{original}}` surfacing; guided-mode plumbing. (No new migration — `character_book` column from P1.) | Yes | **World-info works (semantic).** |
| **P4 — Export / V3 round-trip + tags** | `ExportProfileToCardV3` (JSON + PNG `ccv3`; `character_book` verbatim; bump `modification_date`); app exporter mirror; character-card tag filtering (`json_each`); export affordance + round-trip test. | Partial (export = app+engine) | **Community shareability** + discoverability. |

**Dependency notes:** P1 unblocks P2 (generation reads the new `first_mes`/`mes_example`/`scenario` columns). P3 needs only P1's `character_book` JSON column. P4 depends on P1+P3 data.

---

## Implementation Status

Track the completion of each phase as implementation progresses:

- [ ] **Phase 0: Verification & Ground Truth** ([00-VerificationAndGroundTruth.md](00-VerificationAndGroundTruth.md)) — *reference; not a code deliverable*
- [ ] **Phase 1: Data Model + Authored Static Greeting**
  - [ ] 1-1 Go Migration `000037` ([1-1-GoMigration000037.md](1-1-GoMigration000037.md))
  - [ ] 1-2 Go `CharacterProfile` Model + Sync DTO + Repository + `sync_utils` ([1-2-GoCharacterProfileModelAndSync.md](1-2-GoCharacterProfileModelAndSync.md))
  - [ ] 1-3 App Migration `000037` + `models.ts` ([1-3-AppMigration000037AndModels.md](1-3-AppMigration000037AndModels.md))
  - [ ] 1-4 App `characters.ts` Repository + Schema-Parity Baselines ([1-4-AppCharactersRepositoryAndSchemaParity.md](1-4-AppCharactersRepositoryAndSchemaParity.md))
  - [ ] 1-5 Character-Card V3 Types + PNG `ccv3` Parser Fix ([1-5-CharacterCardV3TypesAndPngParser.md](1-5-CharacterCardV3TypesAndPngParser.md))
  - [ ] 1-6 Character-Card Mapper Redesign (stop the mangling) ([1-6-CharacterCardMapperRedesign.md](1-6-CharacterCardMapperRedesign.md))
  - [ ] 1-7 Macro Engine `ResolveMacros` (net-new, both repos) ([1-7-MacroEngine.md](1-7-MacroEngine.md))
  - [ ] 1-8 Go Greeting Delivery Primitives (`DeliverGreeting`, `message_type="greeting"`) ([1-8-GoGreetingDeliveryPrimitives.md](1-8-GoGreetingDeliveryPrimitives.md))
  - [ ] 1-9 Go `handleInitEntity` Greeting Hook (4 guards + `has_first_mes`) ([1-9-GoInitEntityGreetingHook.md](1-9-GoInitEntityGreetingHook.md))
  - [ ] 1-10 App Greeting Render-Only UX ([1-10-AppGreetingRenderUx.md](1-10-AppGreetingRenderUx.md))
- [ ] **Phase 2: Engine Generation Hook + Scenario Restart**
  - [ ] 2-1 Go `BuildScenarioGreetingPrompt` (4th builder mode) ([2-1-GoBuildScenarioGreetingPrompt.md](2-1-GoBuildScenarioGreetingPrompt.md))
  - [ ] 2-2 Go `GENERATE_GREETING` Event Handler ([2-2-GoGenerateGreetingEvent.md](2-2-GoGenerateGreetingEvent.md))
  - [ ] 2-3 Go `START_NEW_SCENARIO` (Scenario Restart) Handler ([2-3-GoStartNewScenarioHandler.md](2-3-GoStartNewScenarioHandler.md))
  - [ ] 2-4 App `ScenarioGeneratorSheet` + Generate/Regenerate UX ([2-4-AppScenarioGeneratorSheetAndGenerateUx.md](2-4-AppScenarioGeneratorSheetAndGenerateUx.md))
- [ ] **Phase 3: Lorebook RAG + Editor + Guided Mode**
  - [ ] 3-1 Go `lore` RAG Collection + Service Wiring ([3-1-GoLoreRagCollection.md](3-1-GoLoreRagCollection.md))
  - [ ] 3-2 Go Lore Embedding (import/edit/`INIT_ENTITY`) ([3-2-GoLoreEmbedding.md](3-2-GoLoreEmbedding.md))
  - [ ] 3-3 Go Lore Semantic Retrieval in Prompt Build ([3-3-GoLoreRetrievalInPromptBuild.md](3-3-GoLoreRetrievalInPromptBuild.md))
  - [ ] 3-4 App Lorebook Editor (`LorebookViewerSheet` + `LorebookEntryEditor`) ([3-4-AppLorebookEditor.md](3-4-AppLorebookEditor.md))
  - [ ] 3-5 App Profile-Editor Sections + `ImportReviewSheet` ([3-5-AppProfileEditorSectionsAndImport.md](3-5-AppProfileEditorSectionsAndImport.md))
  - [ ] 3-6 App Guided-Mode Plumbing + UJB/`{{original}}` Surfacing ([3-6-AppGuidedModeAndUjbSurfacing.md](3-6-AppGuidedModeAndUjbSurfacing.md))
- [ ] **Phase 4: Export / V3 Round-Trip + Tags**
  - [ ] 4-1 Go `ExportProfileToCardV3` (JSON + PNG `ccv3`) ([4-1-GoExporter.md](4-1-GoExporter.md))
  - [ ] 4-2 App Exporter Mirror ([4-2-AppExporterMirror.md](4-2-AppExporterMirror.md))
  - [ ] 4-3 App Character-Card Tag Filtering ([4-3-AppTagFiltering.md](4-3-AppTagFiltering.md))
  - [ ] 4-4 Export Affordance + Round-Trip Test ([4-4-ExportAffordanceAndRoundTripTest.md](4-4-ExportAffordanceAndRoundTripTest.md))

---

## How to execute

1. **Read [`00-VerificationAndGroundTruth.md`](00-VerificationAndGroundTruth.md) first** — it contains every corrected anchor and the design refinements the verification surfaced. Every phase file assumes it.
2. **Work P1 subtasks in dependency order** (1-1 → 1-2 → 1-3 → 1-4 are the data spine; 1-5 → 1-6 are the importer; 1-7 macro engine is cross-cutting; 1-8 → 1-9 are the engine greeting; 1-10 is the app UX). P1 is a single coupled release — all of P1 ships together.
3. **Run `gitnexus_impact` before editing any existing symbol** (per `AGENTS.md`), and **`gitnexus_detect_changes()` before committing.**
4. **After each subtask:** tick its checklist, note deviations in the subtask file, and update this summary's status.

## Testing posture (per `CLAUDE.md` NGF philosophy + `docs/TESTING.md`)

- TDD where it applies (pure logic: macro engine, mapper round-trip, truly-new-chat gate predicate, exporter field fidelity).
- Migration tests: `npx jest --selectProjects unit --testPathPatterns migrations` (app); Go migration tests under `harmony-link-private/database`.
- Schema parity: CI `schema-parity.yml` gates the coupled release — a new migration on one repo without the mirror fails CI.
- Snapshot: update via `npx jest migrations.snapshot --updateSnapshot` after `000037`.
