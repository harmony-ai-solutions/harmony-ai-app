# 2-1 — App: "Voice Input" Settings Screen

> Repo: `harmony-ai-app` (branch `senju-design-updates-rebase`). Windows: `npx.cmd`/`npm.cmd` only. Protocol: impact → edit → detect_changes → commit, TDD. Consult `.planning/codebase/` docs.

## Objective

A single global surface to configure the shared persona STT ("Voice input"), reachable from Settings and PersonaEdit. Mental model in copy: *"used whenever you chat as any persona"* — never per-persona editing.

## CRITICAL constraint — LWW hazard

The engine seeder creates the canonical `user` mapping row (with STT). The app must **never** ensure-create it blindly: a locally-inserted NULL row would win row-LWW sync and destroy the engine's STT wiring. Therefore:

- **Read path:** mapping row missing OR `stt_config_id` NULL OR stt config provider = `"disabled"` → state = OFF.
- **Write path:** rows are created/linked ONLY on deliberate user save (legitimate LWW win).
- No bootstrap/ensure logic anywhere. Document this in code.

## Implementation steps (TDD)

1. **Pure resolution helper** (new, e.g. `src/services/voiceInput/resolveVoiceInputState.ts`): input = `{ mapping?: EntityModuleMapping | null, sttConfig?: STTConfigRow | null }` → output = `{ enabled: boolean, providerType: string | null, configId: number | null }` with the semantics above. Tests FIRST (missing mapping / null id / provider `"disabled"` / live provider). Note: engine sentinel is exactly `"disabled"` (`config.ProviderDisabled`).
2. **Screen `VoiceInputSettingsScreen`** (new, `src/screens/settings/`):
   - Header copy: shared-across-personas explanation (i18n).
   - On/off switch wired to the resolution helper; OFF persists by writing provider `"disabled"` into the stt config; ON opens provider selection + config editing.
   - Config editing: **reuse `ModuleConfigEditScreen` pinned to `moduleType='stt'`** — decide between (a) a thin wrapper screen embedding its content with the entity-`user` context or (b) routing into it with pinned params (study how CreateAIScreen / `EntityModuleSelectorWithActions` wire configs: create stt_configs row → link `mapping.stt_config_id` for entity `user`). First-save provisioning = create config + update mapping in one save path. Document the choice in this file.
   - Renders the STT/VAD test block from phase 2-2 (build 2-2's component first if executing together).
   - Graceful pre-sync state: `user` entity/mapping not present locally yet (fresh install before first sync) → informative empty state "Connect to Harmony Link to configure voice input" — still no ensure-create.
3. **Entry points:**
   - `SettingsScreen`: new row "Voice input" (icon `microphone-outline`) in the appropriate group, following existing row conventions.
   - `PersonaEditScreen`: read-only info row — *"Voice input is shared across all personas" + Manage →* navigates to the screen. Explicitly NOT per-persona editing.
4. **Navigation:** register the route in the root stack; type it in `RootStackParamList`.
5. **i18n:** en keys following file conventions (settings.json / persona.json namespaces as appropriate).

## Files

- `src/services/voiceInput/resolveVoiceInputState.ts` (+ tests)
- `src/screens/settings/VoiceInputSettingsScreen.tsx` (+ tests where the MyProfileScreen-style mock harness fits)
- `src/screens/SettingsScreen.tsx`, `src/screens/PersonaEditScreen.tsx` (entries), navigation types
- i18n locale files

## Gates

- `npx.cmd tsc --noEmit` = 0 · targeted jest suites green · full `npm.cmd test` green (known flake: `nodeSide.test.ts` parallel-only — verify isolated 23/23 if it trips)
- Commit: `feat(settings): Voice input - shared persona STT config, first-save provisioning, sentinel switch (persona modules 2-1)`

## Checklist

- [x] RED resolution-helper tests
- [x] Screen + switch + pinned editor integration (choice documented)
- [x] LWW-safe read/write semantics documented in code
- [x] Settings + PersonaEdit entries, route registered, i18n
- [x] Gates green, committed, phase doc + summary.md updated

## Editor integration choice (documented)

**Chosen: (b-variant) route into `ModuleConfigEditScreen` pinned to `moduleType='stt'` via navigation; the mapping link (`user` → `stt_config_id`) is owned by `VoiceInputSettingsScreen`.**

- The generic `ModuleConfigEditScreen` already implements the full provider/config editing (STT dual-slot transcription+VAD, provider chips, save/create). Wrapping or embedding its content (option a) would duplicate ~1200 lines of config-editing logic for a single one-field data concern.
- This mirrors the existing wiring pattern exactly: `EntityModuleSelectorWithActions` routes into `ModuleConfigEditScreen` for config create/edit, and the *parent* owns the selector + mapping write (`CreateAIScreen` creates the config row, then `createOrUpdateEntityModuleMapping` links `entity_id → stt_config_id`).
- Flow: the screen lists existing stt configs via a selector (`EntityModuleSelectorWithActions`); "Create new config…" and the pencil edit route into `ModuleConfigEditScreen` (stt). When the user deliberately selects a config, the screen writes `createOrUpdateEntityModuleMapping({ entity_id: 'user', stt_config_id })` — the only place the app writes that mapping. **No ensure-create in the read path.**
- `first-save provisioning` = the user creates the config in the pinned editor (row persisted), then the screen writes the mapping on selection — one deliberate save path, matching how CreateAIScreen wires configs.

## Deviations

- **STT/VAD test-panel render deferred to 2-2.** The doc says the screen "renders the STT/VAD test block from phase 2-2" and to "build 2-2's component first if executing together". To keep the 2-1 commit self-contained and `tsc`-valid (the panel is a 2-2 deliverable and its `moduleTestClient` would otherwise be embedded in the 2-1 tree), `VoiceInputSettingsScreen` currently renders a clearly-marked `<SttTestPanel />` mount point (test-section card) that phase 2-2 wires with the actual panel. The enabled/disabled/pre-sync states and the LWW-safe read/write semantics are all fully implemented and tested in 2-1; only the panel JSX is added in 2-2.
- **Config selector surfaces `EntityModuleSelectorWithActions`** whose "Disabled" option writes `stt_config_id = null` (clearing the link → OFF). This complements the switch's sentinel write; both are deliberate user saves and both yield OFF. Documented in the screen module comment.
