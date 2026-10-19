# Config, Presets & Partner Editor UX Rework — Implementation Plan

**Created:** 2026-10-19 · **Branch:** `feat/app-engine-parity` · **Repo:** `harmony-ai-app` (consumes existing `harmony-link-private` `/api/presets`, `/api/providers/*` endpoints)

## Overview

Post-v0.4.7 on-device testing surfaced three critical bugs and a set of structural UX/UI issues across the **Chats** screen, the **8 Module Config Edit screens** (`ModuleConfigEditScreen`), and the **Edit AI Partner / Character Card V3 screen** (`CreateAIScreen`):

1. **Chats "Not connected" overlay bug (`SyncConnectionContext.tsx:208-211`):** `handleStateChange` overwrites `isPaired` with `state.isPaired || false` (omitting `|| engineAvailable()`) the instant `ConnectionStateManager.markConnected()` fires on embedded-engine WebSocket connect, hiding the loaded chat list behind the `"Not connected"` overlay.
2. **Module Config Edit UX & Capability Bugs (`ModuleConfigEditScreen` across all 8 module types):**
   - `supportedParams()` in `src/constants/modelCapabilities.ts:102` merges `model.capabilities` (`["vision"]`) into `model.param_support`, causing **all 10 sampling parameters** to display false-positive `⚠ Not supported by <model>` warnings.
   - `PROVIDER_SCHEMAS` in `src/constants/providerFieldSchemas.ts` has no per-module field scoping, causing TTS fields (`Voice`, `Language`, `Speed`, `Format`) and Imagination fields to bleed into **Backend**, **Cognition**, **Movement**, **RAG**, **STT**, and **Vision** configs (even in Simple mode).
   - **TextGen WebUI YAML Presets** lack a first-class workflow to save the current hyperparameters as a named YAML preset (`POST /api/presets`) or import/delete presets directly from the capability bar.
   - **STT** renders two full 3-card stacks (8 cards total) instead of a compact segmented `1. Transcription | 2. VAD` pipeline card.
3. **Edit AI Partner (`CreateAIScreen.tsx`) UX & Visual Bugs:**
   - `useTranslation(['createAI', 'characters'])` without `fallbackNS: 'characters'` renders raw uppercase keys (`GREETINGSECTION`, `LOREBOOKSECTION`, `LIFECYCLESECTION`, `ATTRIBUTIONSECTION`, `EXPORTCARD`, `nickname`, `nicknamePlaceholder`).
   - Multiline `Description` clips its top line of text due to double vertical padding (`multilineShell` + `styles.input`).
   - `ThemedButton` `variant="outline"` renders a muddy grey-to-pink full-face gradient (`0.15` alpha inner fill over a gradient wrapper).
   - 9 stacked double-striped accordion cards and a misaligned module-selector pencil icon clutter the screen.

## Codebase Mapping & Memory Bank References

All phase documents align with:
- `.planning/codebase/ARCHITECTURE.md` — Layered feature-folder architecture (`screens/`, `components/`, `contexts/`, `services/`, `constants/`, `i18n/`).
- `.planning/codebase/CONVENTIONS.md` — TypeScript strict typing, exported pure helpers for unit testability, co-located `__tests__/*.test.ts(x)`, Prettier single-quote/trailing-comma style.
- `.planning/codebase/TESTING.md` & `docs/TESTING.md` — `npx.cmd tsc --noEmit` + `npm.cmd test` (`unit` project).
- `memory-bank/activeContext.toon` & `.current_work/provider-registry/plan.md` — Provider Registry R1–R12 and §11 A1–A11 rulings (presets supply defaults, explicit local values override; `soulbitscloud` account is system-managed).

## Phase Overview

| Phase | Sub-Phases | Description |
|---|---|---|
| **Phase 1: Core Bug Fixes & Shared Primitives** | `1-1` → `1-3` | Fix `Chats` embedded-engine connection overlay + chat menu; fix `supportedParams()` false warnings + add `modules` scoping to `PROVIDER_SCHEMAS` + enhance `FormField` (`toggle`, 2-col `half` width, `disabledValue` display); fix `ThemedButton` outline bleed + `ScreenHeader` top-left stripe + card double-stripes. |
| **Phase 2: YAML Preset Manager, Engine Speech Upgrades & Shared Config Chrome** | `2-1` → `2-4` | Add `savePreset`/`deletePreset` to `EngineApiClient` + TextGen WebUI YAML serializer (`presetYaml.ts`); rework `SamplingPresetSelect` with a `Save as… / Import YAML` modal; merge `General + Provider + Account` card; upgrade Engine TTS/STT clients (`soulbitscloud` speaker embedding + prosody, `soulvoice` Chatterbox fields, `elevenlabs` IVC/Voice Design/Scribe STT, `openai` voice instructions). |
| **Phase 3: Per-Module Config Screens (All 8 Modules)** | `3-1` → `3-8` | Dedicated sub-phase per module screen: **Backend** (`3-1`), **Cognition** (`3-2`), **Movement** (`3-3`), **RAG** (`3-4`), **TTS (Voice Design & Cloning)** (`3-5`), **STT + Realtime AutoVAD** (`3-6`), **Vision** (`3-7`), and **Imagination** (`3-8`). |
| **Phase 4: Edit AI Partner Screen (`CreateAIScreen`) 1:1 Rework** | `4-1` → `4-3` | Fix `characters` i18n fallback + `Description` clipping + header `Export` button (`4-1`); consolidate V3 sections into one `Character Card Sections` card with live summary badges (`4-2`); align `Module Wiring` selectors and add `provider · model` subtitles in the bottom sheet (`4-3`). |
| **Phase 5: Verification, Tests & Dev Release** | `5-1` | Full unit/component test coverage, `tsc --noEmit` + Jest gate run, CHANGELOG + Memory Bank updates, and dev-channel release. |

## Implementation Status

Track the completion of each phase and sub-phase as implementation progresses:

- [ ] **Phase 1: Core Bug Fixes & Shared Primitives**
  - [ ] Chats Connection Overlay & Chat Menu Fix ([1-1-ChatsConnectionOverlayFix.md](1-1-ChatsConnectionOverlayFix.md))
  - [ ] Capability Warnings, Module Field Scoping & FormField Upgrades ([1-2-CapabilityWarningsAndModuleFieldScoping.md](1-2-CapabilityWarningsAndModuleFieldScoping.md))
  - [ ] Themed Primitives, Outline Button & Header Polish ([1-3-ThemedPrimitivesAndHeaderPolish.md](1-3-ThemedPrimitivesAndHeaderPolish.md))
- [ ] **Phase 2: TextGen WebUI YAML Preset Management, Engine Speech Upgrades & Shared Config Chrome**
  - [ ] Preset CRUD API Client & TextGen YAML Serializer ([2-1-YamlPresetCrudAndSerializer.md](2-1-YamlPresetCrudAndSerializer.md))
  - [ ] SamplingPresetSelect Bar, Save-as-Preset Modal & Unsupported Param Drawer ([2-2-SamplingPresetSelectAndSaveModal.md](2-2-SamplingPresetSelectAndSaveModal.md))
  - [ ] Unified General + Provider + Account Card & Capability Mode Switch ([2-3-SharedGeneralProviderAccountCard.md](2-3-SharedGeneralProviderAccountCard.md))
  - [ ] Engine TTS Voice Design/Cloning, ElevenLabs & Realtime VAD Upgrades ([2-4-EngineTtsVoiceCloningAndSttUpgrade.md](2-4-EngineTtsVoiceCloningAndSttUpgrade.md))
- [ ] **Phase 3: Per-Module Config Screen Reworks (All 8 Modules)**
  - [ ] Backend Config Screen — Main Chat LLM ([3-1-BackendConfigScreen.md](3-1-BackendConfigScreen.md))
  - [ ] Cognition Config Screen — Emotion & Inner Monologue ([3-2-CognitionConfigScreen.md](3-2-CognitionConfigScreen.md))
  - [ ] Movement Config Screen — Action & Avatar Execution ([3-3-MovementConfigScreen.md](3-3-MovementConfigScreen.md))
  - [ ] RAG Config Screen — Memory & Embeddings ([3-4-RagConfigScreen.md](3-4-RagConfigScreen.md))
  - [ ] TTS Config Screen — Speech Synthesis & Voice Pickers ([3-5-TtsConfigScreen.md](3-5-TtsConfigScreen.md))
  - [ ] STT Config Screen — Segmented Transcription + VAD Pipeline ([3-6-SttConfigScreen.md](3-6-SttConfigScreen.md))
  - [ ] Vision Config Screen — Multimodal Image Understanding ([3-7-VisionConfigScreen.md](3-7-VisionConfigScreen.md))
  - [ ] Imagination Config Screen — Cloud Image Gen & ComfyUI ([3-8-ImaginationConfigScreen.md](3-8-ImaginationConfigScreen.md))
- [ ] **Phase 4: Edit AI Partner Screen (`CreateAIScreen`) 1:1 Rework**
  - [ ] i18n Namespace Fix, Identity Card & Header Export Action ([4-1-CreateAiI18nAndIdentityCard.md](4-1-CreateAiI18nAndIdentityCard.md))
  - [ ] Consolidated Character Card Sections Accordion & Summary Badges ([4-2-CharacterCardSectionsAccordionAndBadges.md](4-2-CharacterCardSectionsAccordionAndBadges.md))
  - [ ] Module Wiring Selector Alignment & Provider/Model Subtitles ([4-3-EntityModuleWiringSelectorRework.md](4-3-EntityModuleWiringSelectorRework.md))
- [ ] **Phase 5: Verification, Tests & Dev Release**
  - [ ] Test Suites, Documentation & Dev-Channel Release ([5-1-TestSuitesAndDevRelease.md](5-1-TestSuitesAndDevRelease.md))
