# 5-1 — App: Entity-Context Threading for Config Screens

> Repo: `harmony-ai-app` (branch `senju-design-updates-rebase`). Protocol: impact → edit → detect_changes → commit, TDD where harness permits. `npx.cmd`/`npm.cmd` only.

## Objective (user ruling 2026-09-02)

The TTS test panel stays **disabled in Create-AI create-mode** (entity doesn't exist yet — accepted technical limitation) but must be **ENABLED wherever an entity context exists**. Audit found: the only config-editor entry paths are `EntityModuleSelectorWithActions` (from `CreateAIScreen` — create AND edit mode; edit mode HAS an entity) and `VoiceInputSettingsScreen` (STT-pinned, persona context resolved internally — unaffected). So the one needed tweak: thread the entity id from CreateAIScreen **edit mode**.

## Implementation steps

1. `CreateAIScreen`: in edit mode (`editProfileId` set) resolve the linked entity (pattern: `getEntityByCharacterProfileId`) and pass `entityId` down to `EntityModuleSelectorWithActions` → its `navigation.navigate('ModuleConfigEdit', { …, entityId })`.
2. `ModuleConfigEditScreen`: accept optional route param `entityId`; pass to `TtsTestPanel` (already has the reserved `entityId` prop) and `SttTestPanel` (as explicit context override when present — otherwise persona resolution as today).
3. Panel enable logic + hint copy: create-mode (no entityId) → disabled, hint "Available once the AI has been created" (i18n); edit-mode with entityId → enabled.
4. Tests: extend existing panel tests (entityId prop enables/disables) + route-param wiring predicate test if extractable.

## Gates

tsc = 0 · targeted jest green · full `npm.cmd test` green.
Commit: `feat(config): thread entity context from AI edit mode - enable TTS test where entity exists (persona modules 5-1)`

## Checklist

- [x] entityId threaded (edit mode only) + panels honor it
- [x] Hint copy differentiated (create vs edit)
- [x] Gates green, committed, docs ticked
