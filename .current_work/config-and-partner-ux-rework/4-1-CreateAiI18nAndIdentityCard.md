# Phase 4-1 — CreateAIScreen: i18n Namespace Fix, Identity Card & Header Export Action

**Repo:** `harmony-ai-app` · **Depends on:** 1-3 · **Blocks:** 4-2, 4-3, 5-1  
**Codebase Mapping Refs:** `.planning/codebase/ARCHITECTURE.md` (Presentation / Screens & i18n), `.planning/codebase/CONVENTIONS.md`

## Objective

Implement the first third of the 1:1 **Edit AI Partner (`CreateAIScreen.tsx`)** rework:
1. Fix the i18n namespace resolution bug so `greetingSection`, `lorebookSection`, `lifecycleSection`, `attributionSection`, `exportCard`, `tags`, `postHistoryInstructions`, `postHistoryHint`, `nickname`, and `nicknamePlaceholder` resolve from the `characters` namespace instead of rendering as raw keys (`GREETINGSECTION`, `LOREBOOKSECTION`, `nicknamePlaceholder`, etc.).
2. Rework Card 1 (**Identity**) so `Name *` and `Nickname` sit in a clean 2-column row (in edit mode), and fix the Android multiline `Description` top-line clipping bug (`multilineShell` / `multilineInput`).
3. Move the **Export Card** action out of its giant mid-screen card (`EXPORTCARD`) and into `ScreenHeader`'s `right` slot (`📤 Export` button + export sheet in edit mode).

---

## Root Cause Analysis

1. **Raw untranslated V3/RP keys (`src/screens/CreateAIScreen.tsx:154-156`):**
   - `CreateAIScreen` calls `const { t } = useTranslation(['createAI', 'characters']);` and invokes `t('greetingSection')`, `t('lorebookSection')`, `t('nickname')`, `t('nicknamePlaceholder')` without a `characters:` prefix.
   - Because `src/i18n/index.ts` does not set `fallbackNS`, `i18next` only checks the first namespace (`'createAI'`). When a key is missing in `createAI.json`, `t('greetingSection')` returns the raw key string `'greetingSection'`, which `SectionHeader` uppercases to `'GREETINGSECTION'`.
2. **Top-line clipping in `Description` (`src/screens/CreateAIScreen.tsx:2184-2199`):**
   - `multilineShell` sets `paddingTop: 13`, while `styles.input` also applies `paddingVertical: 10` inside a `minHeight: 88` container, causing Android's multiline `TextInput` viewport to clip the top half of the first line when text wraps across 3+ lines.
   - Placing a leading icon (`text-box-outline`) inside a multi-paragraph textarea also wastes 30dp of horizontal space on every line.

---

## Detailed Implementation Steps

### 1. Fix `useTranslation` Namespace Fallback in `CreateAIScreen.tsx`
**File:** `src/screens/CreateAIScreen.tsx`

Configure `fallbackNS: 'characters'` (and explicit `characters:` prefixes for V3 keys as belt-and-suspenders) in `CreateAIScreen.tsx`:

```ts
const { t } = useTranslation(['createAI', 'characters'], {
  nsMode: 'fallback',
});
```
Verify both `nsMode: 'fallback'` and explicit `t('characters:greetingSection')`, `t('characters:lorebookSection')`, `t('characters:lifecycleSection')`, `t('characters:attributionSection')`, `t('characters:exportCard')`, `t('characters:tags')`, `t('characters:nickname')`, `t('characters:nicknamePlaceholder')`, `t('characters:postHistoryInstructions')`, `t('characters:postHistoryHint')` so every single key resolves deterministically in production and in Jest mocks.

### 2. Rework Card 1 (`IDENTITY`) & Fix Multiline `TextInput` Clipping
**File:** `src/screens/CreateAIScreen.tsx`

1. Rename the top card header to `t('characters:identity', 'Identity')` (without outer `ThemedCard` `accentStripe` so only `SectionHeader`'s accent pip renders).
2. In Edit mode (`editProfileId`), render `Name *` (`flex: 1.2`) and `Nickname` (`flex: 1`, placeholder `'Alias (optional)'`) side-by-side in a 2-column row (`styles.identityNameRow`: `flexDirection: 'row', gap: 12`). In Create mode, `Name *` spans full width.
3. Fix `multilineShell` and `multilineInput` styles (lines 2184–2199):
   - Remove the leading icon inside multiline textareas (`multiline === true` in `renderField`) so the full width is available for prose.
   - Set `multilineShell: { alignItems: 'stretch', paddingVertical: 10, paddingHorizontal: 14 }` and `multilineInput: { minHeight: 84, paddingVertical: 0, textAlignVertical: 'top', lineHeight: 20 }`, completely eliminating the top-line clipping on Android and iOS.

### 3. Move `Export` into `ScreenHeader` (`right` Slot)
**Files:** `src/screens/CreateAIScreen.tsx`, `src/components/character-card/editor-sections/ExportSection.tsx`

1. Remove the standalone `EXPORTCARD` `<ThemedCard>` (`lines 1914–1922`) from the scroll body of `CreateAIScreen.tsx`.
2. Add a compact `headerExport` mode (or `<ExportHeaderButton onExport={handleExport} disabled={!name.trim()} />` inside `ExportSection.tsx`) rendered in `<ScreenHeader right={editProfileId ? <ExportSection compact onExport={handleExport} disabled={!name.trim()} /> : undefined} />`:
   - Renders a sleek outline pill button (`icon="export-variant"`, label `t('characters:exportAction', 'Export')`, `height: 34, paddingHorizontal: 12, borderRadius: 10`) that opens the existing `SheetModal` (`Export as JSON (.json)` / `Export as PNG (.png)`).

---

## Files to Modify

- `src/screens/CreateAIScreen.tsx`
- `src/components/character-card/editor-sections/ExportSection.tsx`
- `src/i18n/locales/en/createAI.json`
- `src/i18n/locales/en/characters.json`
- `src/screens/__tests__/CreateAIScreen.test.tsx`

---

## Progress Checklist

- [ ] Fix `characters` namespace lookup in `CreateAIScreen.tsx` so zero raw keys (`GREETINGSECTION`, `nicknamePlaceholder`, etc.) ever render
- [ ] Place `Name *` and `Nickname` in a 2-column row in Edit mode inside the **Identity** card
- [ ] Fix `multilineShell` / `multilineInput` padding and remove leading icon on multiline textareas so `Description` never clips
- [ ] Move the `Export` trigger into `ScreenHeader`'s `right` slot and remove the mid-form `EXPORTCARD` card
- [ ] Update `CreateAIScreen.test.tsx` to verify translated section titles and header export trigger
