# Phase 5-1 — Test Suites, Documentation & Dev-Channel Release

**Repo:** `harmony-ai-app` · **Depends on:** 1-1..1-3, 2-1..2-3, 3-1..3-8, 4-1..4-3  
**Codebase Mapping Refs:** `.planning/codebase/TESTING.md`, `docs/TESTING.md`, `docs/DEV-RELEASE.md`, `.roo/rules/workspace-rules.md`

## Objective

Run the full verification gate across all touched unit and component test suites, update `CHANGELOG.md` and `memory-bank/` (`.toon` first per `workspace-rules.md`), and ship the app update to the **dev channel** (`docs/DEV-RELEASE.md`) once the owner gives the go-ahead.

---

## Detailed Implementation Steps

### 1. Unit & Component Test Coverage
Ensure all new and updated suites pass:
- `src/contexts/__tests__/SyncConnectionContext.test.tsx` (or `connectionStatusHelper.test.ts`): embedded-engine `isPaired` preservation across `ConnectionStateManager` `'state:changed'` events.
- `src/constants/__tests__/modelCapabilities.test.ts`: `supportedParams()` only reads `param_support` (never `capabilities`), `partitionFieldsBySupport()` splits supported vs. unsupported fields.
- `src/utils/__tests__/presetYaml.test.ts`: `buildPresetYamlFromCapability` serializes standard + extended samplers into TextGen WebUI YAML and skips unset/sentinel values; `validatePresetName` rejects invalid names.
- `src/components/config/__tests__/SamplingPresetSelect.test.tsx`: persistent `SelectPicker`, `Save as…` modal pre-fill + `POST /api/presets` call, preset deletion, and override chip annotations.
- `src/components/config/__tests__/AccountPicker.test.tsx` & `src/screens/settings/__tests__/ProvidersScreen.test.tsx`: managed-account (`soulbitscloud`) hides `+ Add account…` and Edit/Delete actions.
- `src/screens/config/__tests__/ModuleConfigEditScreen.test.tsx`: all 8 module types (`backend`, `cognition`, `movement`, `rag`, `tts`, `stt`, `vision`, `imagination`) verify per-module field scoping, 2-column numeric rows, `toggle` switches, and STT segmented `Transcription | VAD` tab switching.
- `src/screens/__tests__/CreateAIScreen.test.tsx`: `characters` namespace translations, consolidated `Character Card Sections` accordion + summary count pills, header `Export` button, and full-width `EntityModuleSelectorWithActions` with `provider · model` subtitles.

### 2. Verification Gates (PowerShell, app root)
```powershell
npx.cmd tsc --noEmit
npx.cmd eslint src/
npm.cmd test
```

### 3. Documentation, Changelog & Memory Bank Updates
1. **`CHANGELOG.md` (`harmony-ai-app`):**
   - Add user-level entries under `### Under the Hood` → `#### Changed` / `#### Fixed` (no internal constant/file names per `workspace-rules.md`):
     - Fixed the Chats screen showing "Not connected" while the local AI engine is running.
     - Reworked the Module Configuration screens across all 8 module types with per-module field scoping, a TextGen WebUI YAML preset switcher with "Save as Preset", and a single-card Transcription/VAD switcher for Speech-to-Text.
     - Reworked the Edit AI Partner screen with a consolidated Character Card sections card, live content badges, header Card Export action, and provider/model subtitles in module selectors.
2. **Memory Bank (`memory-bank/activeContext.toon` & `memory-bank/progress.toon`):**
   - Record the completed rework and test baseline.
3. **Plan Tracking (`.current_work/config-and-partner-ux-rework/summary.md`):**
   - Tick all `[x]` checkboxes in `summary.md` and each sub-phase file.

### 4. Dev-Channel App Release (`docs/DEV-RELEASE.md` — upon owner confirmation)
- Since the engine `/api/presets` and `/api/providers/*` endpoints require zero engine changes (`ENGINE_SIDECAR_VERSION` stays `v0.4.5-dev`), only an app version bump (`0.4.7` → `0.4.8` in `android/app/build.gradle` and `ios/HarmonyAIChat.xcodeproj/project.pbxproj`) and `build-release.yml` dispatch (`version=v0.4.8`, `publish_latest=true`, `build_ios=false`, `engine_version=v0.4.5-dev`) are required.

---

## Files to Modify

- `CHANGELOG.md`
- `memory-bank/activeContext.toon`
- `memory-bank/progress.toon`
- `.current_work/config-and-partner-ux-rework/summary.md`

---

## Progress Checklist

- [ ] All unit and component test suites green (`npm.cmd test`)
- [ ] `npx.cmd tsc --noEmit` exits with 0 errors
- [ ] `CHANGELOG.md` updated with user-facing entries
- [ ] `memory-bank/activeContext.toon` and `memory-bank/progress.toon` updated
- [ ] Dev-channel release (`v0.4.8`) dispatched and verified on `https://download.soulbits.app/app/dev/latest.json` (when authorized by owner)
