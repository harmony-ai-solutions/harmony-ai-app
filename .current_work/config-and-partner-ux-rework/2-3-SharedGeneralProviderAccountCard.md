# Phase 2-3 — Unified General + Provider + Account Card & Capability Mode Switch

**Repo:** `harmony-ai-app` · **Depends on:** 1-2, 1-3 · **Blocks:** 3-1..3-8  
**Codebase Mapping Refs:** `.planning/codebase/ARCHITECTURE.md` (Presentation / Screens & Config Components), `.planning/codebase/CONVENTIONS.md`

## Objective

Streamline the top half of `ModuleConfigEditScreen.tsx` and `ProviderSlotSection.tsx` across all module types:
1. Merge **General (`Config Name *`) + Provider Type + Account** into a single cohesive top card (for single-slot modules), eliminating 2 redundant cards and ~140dp of vertical chrome.
2. Move the **`Simple | Advanced` segmented switch** out of its standalone card and place it directly in the `right` slot of the **Capability** card's `<SectionHeader>`, right where the fields expand.
3. Fix the **Managed Account (`Soulbits Cloud`) UX trap** in `AccountPicker.tsx` and `ProvidersScreen.tsx`: hide `+ Add account…` when `isAccountManaged(providerType)` is `true` so users can never open the dead-end read-only modal with no Save button, and render single-account state as a compact inline status bar (`🔑 Account: Soulbits Cloud (system-managed) · Active`).
4. Unify model metadata badges across `SoulbitsModelSelect` and `CatalogModelSelect` so context window (`128k ctx`), modality (`Vision`), and embedding dimensions (`1024 dims`) appear cleanly on the `Model` label row.

---

## Detailed Implementation Steps

### 1. Guard Managed Accounts in `AccountPicker.tsx` & `ProvidersScreen.tsx`
**Files:** `src/components/config/AccountPicker.tsx`, `src/screens/settings/ProvidersScreen.tsx`

1. Add `providerType: string` to `AccountPickerProps` and compute `const managed = isAccountManaged(providerType);` (`from '../../constants/accountFieldSchemas'`).
2. When `managed` is `true`:
   - Do **not** render `addButton` (`+ Add account…`).
   - Render a compact single-line status bar (`styles.managedBar`):
     - Left: key icon + `Account: ${only?.name || 'Soulbits Cloud'}` + muted `(system-managed)`
     - Right: green status pill `Active` (when `only?.api_key` is non-empty) or muted `Sign in required`.
3. When `!managed` and `accounts.length === 1`:
   - Render a compact single-row bar with `Account: ${only.name}` (`keyLine(only)`) on the left and a subtle inline `+ Add account…` link button on the right (instead of stacking a full box + a second button row underneath).
4. In `src/screens/settings/ProvidersScreen.tsx:191-194`, filter `availableTypes` for the "Add account" type picker modal so managed types (`!isAccountManaged(type)`) cannot be manually created from the `+` button:
   ```ts
   const availableTypes = useMemo(
     () => PROVIDER_TYPE_ORDER.filter(type => isProviderAvailable(type) && !isAccountManaged(type)),
     [],
   );
   ```
   Also hide the Delete (`trash-can-outline`) and Edit (`pencil-outline`) icon buttons on `soulbitscloud` rows in `ProvidersScreen.tsx` (keeping the `Test key` button so users can still verify their cloud token on demand).

### 2. Move `Simple | Advanced` Segmented Toggle into `SectionHeader`
**Files:** `src/screens/config/ModuleConfigEditScreen.tsx`, `src/components/config/ProviderSlotSection.tsx`

1. Extract a reusable `<ModeSegmentedSwitch value={showAdvanced} onChange={setShowAdvanced} />` component (or render helper).
2. Remove the standalone `View (Simple | Advanced)` `<ThemedCard>` from `ModuleConfigEditScreen.tsx` (lines 741–814).
3. Pass `showAdvanced` and `onToggleAdvanced={setShowAdvanced}` into `ProviderSlotSection`, which renders `<ModeSegmentedSwitch />` in the `right` prop of the **Capability** card's `<SectionHeader>` (and for STT, in the top card's `<SectionHeader>`).

### 3. Combine `General & Provider` for Single-Slot Modules
**Files:** `src/screens/config/ModuleConfigEditScreen.tsx`, `src/components/config/ProviderSlotSection.tsx`

For single-slot modules (`!isSTT`):
- Pass `configName={formValues.name}` and `onConfigNameChange={(text) => handleModuleFieldChange('name', text)}` into `ProviderSlotSection` so the top card renders:
  - `<SectionHeader title={t('generalAndProvider')} />`
  - `Config Name *` input
  - `Provider Type *` chips
  - Inline `AccountPicker` bar (once a provider type is selected)
- This reduces a single-slot module screen in Simple mode from **5 separate cards** down to **2 clean cards**:
  1. **General & Provider** (Name + Provider Chips + inline Account bar)
  2. **Capability** (`Simple | Advanced` switch in header + Model picker + Module-scoped Simple fields)

---

## Files to Create / Modify

- `src/components/config/AccountPicker.tsx`
- `src/components/config/__tests__/AccountPicker.test.tsx`
- `src/components/config/ProviderSlotSection.tsx`
- `src/screens/config/ModuleConfigEditScreen.tsx`
- `src/screens/settings/ProvidersScreen.tsx`
- `src/screens/settings/__tests__/ProvidersScreen.test.tsx`
- `src/i18n/locales/en/moduleConfig.json`

---

## Progress Checklist

- [ ] Update `AccountPicker.tsx` to accept `providerType`, hide `+ Add account…` when `isAccountManaged(providerType)` is true, and render a compact single-row account bar
- [ ] Filter `isAccountManaged(type)` out of `ProvidersScreen.tsx`'s "Add account" type picker and hide Edit/Delete icons on managed accounts
- [ ] Move the `Simple | Advanced` segmented switch into the `Capability` card's `SectionHeader` (`right` slot)
- [ ] Merge `Config Name *` into the `General & Provider` card for single-slot modules
- [ ] Update `AccountPicker` and `ProvidersScreen` unit tests
