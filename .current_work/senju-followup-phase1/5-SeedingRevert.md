# Phase 5 — B4 Seeding Revert (`f45540a`): engine becomes the single default-config source

> Track B4. Senju's `SoulbitsDefaultConfigService` reimplemented engine-originating behavior app-side: the engine already seeds "Default SoulbitsCloud" provider + module configs that sync DOWN; her service creates a parallel set in engine-synced tables, un-gated by connection mode → duplicate rows, LWW churn, broken standalone mode (00-Research §8).

## Changes

### 1. `src/screens/CreateAIScreen.tsx`

- Remove the auto-fill `useEffect` calling `ensureSoulbitsDefaultConfigs()` (~line 351 region: the effect that fills empty module slots with defaults, incl. `configSelectionsRef` machinery that exists solely for it).
- Remove the save-time fallback call (~line 1127 region: `if !anySelected → ensureSoulbitsDefaultConfigs()`).
- Unset slots save as unset (no module mapping entry) — the engine/user fills later.

### 2. `src/components/entities/EntityModuleSelector.tsx`

- Restore the **Disabled** option: `{ id: -1, name: 'Disabled', value: '' }` in the sheet + the `?? 'Disabled'` label fallback (replaces the current `?? 'Select config'`).
- The '' (no-config) state is a legitimate, selectable end state again.

### 3. Engine-synced default auto-select (optional UX, default OFF)

If product wants "always show a default": auto-select the **engine-synced `"Default SoulbitsCloud"` row** (it arrives via normal sync; the name-clash machinery already dedupes engine-seeded defaults cross-device) — NEVER create parallel rows. Default decision for this pass: **plain Disabled option, no auto-select** (simplest, engine-first). Note the alternative in the record doc.

### 4. Delete the service

- `src/services/SoulbitsDefaultConfigService.ts` + its tests + the `DEFAULT_CONFIG_NAME` export usages (`CreateAIScreen` imports it — remove).
- Check `src/constants/moduleDefaults.ts` / moduleConfiguration for references to the service's created-row name — engine-seeded rows must remain the only source.

## Guard rails

- Engine-seeded defaults still appear in pickers after sync — verify a cloud-connected device shows "Default SoulbitsCloud" (or the engine's current seed name) in module pickers WITHOUT the app service.
- Dev devices with her locally-created "Soulbits Cloud (default)" rows: the existing `syncNameClash` machinery absorbs the clash on next sync (verified behavior) — no extra work.

## Verification

- [ ] `grep -rn "SoulbitsDefaultConfigService\|ensureSoulbitsDefaultConfigs\|DEFAULT_CONFIG_NAME" src/` → zero
- [ ] `npx tsc --noEmit` 0 errors; `npm test` green
- [ ] Manual smoke: create a partner with no module selection → saves cleanly; picker shows Disabled; after cloud sync engine defaults appear
- [ ] `gitnexus_detect_changes()`; commit: `revert: remove app-side soulbits default config seeding, engine is single source (B4)`
