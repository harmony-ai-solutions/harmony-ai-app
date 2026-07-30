# Soulbits Cloud Config Convenience Features + Character Card Import

## Overview

Three user-requested features for the Harmony AI App, centered on the module
configuration menu and the Characters screen:

1. **Feature 1 — Endpoint auto-prefill.** When the **Soulbits Cloud** provider is
   selected **and** the app is connected to the cloud backend, prefill the
   endpoint (`base_url`) field with the correct inference-gateway API URL —
   precisely the **beta** URL when the build is in beta mode.

2. **Feature 2 — Module-filtered model dropdown.** When Soulbits Cloud is the
   provider, the model field becomes a dropdown that is **pre-filtered to valid
   models for that module type** (text LLM for Backend / Cognition / Movement,
   Whisper for STT, TTS models for TTS, embeddings for RAG, etc.). The list is
   fetched live from the public `GET /v1/models` catalog (filtered server-side),
   with a cached static fallback and a free-text override.

3. **Feature 3 — Character card import (JSON + PNG).** Port Harmony Link's
   `charactercard` package to TypeScript so the app can import standard **Tavern
   Card V1/V2/V3** character cards — both raw **JSON** and **PNG-embedded**
   (`tEXt`/`iTXt` `chara`/`ccv3` chunks) — map them to the existing
   `CharacterProfile` model, persist locally, and sync via the existing pipeline.

### Key investigation outcomes (drive the design)

- The provider-config form is **schema-driven**: `PROVIDER_SCHEMAS[providerType]`
  → [`FormField`](../../src/components/config/FormField.tsx). `FieldDefinition`
  already declares `type: 'select'` with `options`, **but `FormField` renders
  `select` as a read-only `TextInput`** (`editable={false}`) — Phase 1 fixes this.
- The beta-aware inference host already exists as
  [`CLOUD_HOSTS.inference`](../../src/config/cloud.ts) (`https://beta.api.soulbits.app`
  in beta). The soulbitscloud default in
  [`moduleDefaults.ts`](../../src/constants/moduleDefaults.ts) hardcodes the prod
  URL — the source of the bug Feature 1 fixes.
- Cloud-connection state is available via
  [`useSyncConnection()`](../../src/contexts/SyncConnectionContext.tsx)
  (`isConnected`, `connectionStatus.mode === 'cloud'`).
- The Soulbits inference gateway exposes a **public, unauthenticated**
  [`GET /v1/models`](../../soulbits-cloud-backend/cmd/inference-gateway/main.go)
  with `model_type` / `input_modalities` / `output_modalities` filters, already
  wrapped by the first-party client
  [`client.models.listModelsOrThrow(params)`](../../soulbits-api-client-js/src/models.ts).
  The client constructor accepts **no credentials**
  ([`createClient({ inferenceURL })`](../../soulbits-api-client-js/src/config.ts)),
  so the public catalog can be queried without a PASETO.
- Harmony Link's character-card package lives at
  [`harmony-link-private/utils/charactercard/`](../../harmony-link-private/utils/charactercard/)
  (`types.go`, `png_parser.go`, `mapper.go`) and maps onto the **same
  `CharacterProfile` shape** the app uses.

## Phases

- **Phase 1 — Shared infrastructure:** real `select` dropdown in `FormField`.
- **Phase 2 — Feature 1:** cloud-aware endpoint prefill.
- **Phase 3 — Feature 2:** module-filtered model dropdown (live catalog + fallback + override).
- **Phase 4 — Feature 3:** character card import (parser + mapper + service + UI).
- **Phase 5 — Finalize:** tests, GitNexus impact/detect_changes, docs/changelog/memory-bank.

## Implementation Status

Track the completion of each phase as implementation progresses:

- [x] **Phase 1: Shared Infrastructure**
  - [x] FormField Select Dropdown ([1-1-FormFieldSelectDropdown.md](1-1-FormFieldSelectDropdown.md))
- [x] **Phase 2: Feature 1 — Endpoint Prefill**
  - [x] Cloud-aware base_url Prefill ([2-1-CloudEndpointPrefill.md](2-1-CloudEndpointPrefill.md))
- [x] **Phase 3: Feature 2 — Model Dropdown**
  - [x] Module-type → Models Query Mapping + Static Fallback ([3-1-ModelsMappingAndFallback.md](3-1-ModelsMappingAndFallback.md))
  - [x] Soulbits Models Catalog Service ([3-2-ModelsCatalogService.md](3-2-ModelsCatalogService.md))
  - [x] SoulbitsModelSelect Component + Screen Wiring ([3-3-SoulbitsModelSelectUI.md](3-3-SoulbitsModelSelectUI.md))
  - [x] Model Selector i18n ([3-4-ModelSelectorI18n.md](3-4-ModelSelectorI18n.md))
- [x] **Phase 4: Feature 3 — Character Card Import**
  - [x] Character Card Parser Port ([4-1-CharacterCardParser.md](4-1-CharacterCardParser.md))
  - [x] Card → CharacterProfile Mapper Port ([4-2-CharacterCardMapper.md](4-2-CharacterCardMapper.md))
  - [x] Card Import Service ([4-3-CardImportService.md](4-3-CardImportService.md))
  - [x] CharactersScreen Import UI + i18n ([4-4-CharactersScreenImportUI.md](4-4-CharactersScreenImportUI.md))
- [x] **Phase 5: Finalize**
  - [x] Tests + Impact Analysis + Docs/Changelog/Memory-Bank ([5-1-TestsAndDocsAndImpact.md](5-1-TestsAndDocsAndImpact.md))

## Cross-cutting rules (apply to every phase)

- **GitNexus impact analysis is mandatory before editing any symbol.** Run
  `gitnexus_impact({ target: "<symbol>", direction: "upstream" })` and report the
  blast radius. Do not proceed on HIGH/CRITICAL without user confirmation.
- **Run `gitnexus_detect_changes()` before committing** to verify scope.
- After each phase: tick its checklist here and in the phase doc, note deviations.
- Codebase mapping consulted (`.planning/codebase/`): **STRUCTURE.md**,
  **CONVENTIONS.md**, **INTEGRATIONS.md**, **TESTING.md**. Consult the relevant
  docs before implementing to stay aligned with project conventions (themed
  components, repository pattern, i18n namespaces, UUID v7 via `generateId`).

## Deviations / decisions (implementation)

- **Phase 2-1 prefill path.** The prefill is applied ONLY in
  `handleProviderSwitch` (the path where the user actually selects Soulbits
  Cloud). The plan's "create-mode `loadConfig` branch" step was not added as
  dead code: in create mode the provider slot starts empty (`values: {}`,
  `provider: ''`), so soulbitscloud's `base_url` can never be selected until
  the user taps the chip → `handleProviderSwitch`. Edit mode is intentionally
  untouched (stored `base_url` wins via `{ ...defaults, ...pConfig }`).
- **Optional hardening (update `PROVIDER_DEFAULTS.soulbitscloud.base_url` to be
  beta-aware) was NOT applied.** The static prod default is only used when
  disconnected / self-hosted, where the soulbitscloud endpoint is irrelevant.
  Kept as-is to avoid changing static default behavior app-wide; the connected
  prefill is the actual fix.
- **Compressed iTXt (zlib) not supported** in the PNG parser — mirrors the Go
  `png_parser.go`, which reads iTXt but does not decompress. `pako` was not
  added. Standard uncompressed `tEXt` (the common case) works.
- **STT vad slot** is not special-cased in `renderInlineProviderFields`:
  `soulbitscloud` is not an STT provider option (STT providers are
  openai/openaicompatible/openrouter/elevenlabs), so the model-dropdown branch
  can never fire for the vad slot.
- **Fallback model ids** (`soul-embed-v1`, `soul-tts-v1`) remain
  placeholders — model ids are DB-seeded on the backend, so they could not be
  confirmed from the code. The live catalog is authoritative; the static list
  is an offline safety net only.
- **Pre-existing eslint errors** in `ModuleConfigEditScreen.tsx`
  (`react-hooks/exhaustive-deps` for `loadConfig`, unused
  `moduleSpecificDefaults`) and `CharactersScreen.tsx` (unused `Nav` type) were
  verified pre-existing in `HEAD` and left untouched (out of scope). The only
  introduced lint error (`SelectPicker` unused `required` prop) was fixed.
  `no-bitwise` warnings in the new binary-parsing code are inherent and do not
  fail CI (`eslint .` has no `--max-warnings`).
- **Build / on-device verification deferred to the user** per workspace rules
  (the build is not run during implementation).
