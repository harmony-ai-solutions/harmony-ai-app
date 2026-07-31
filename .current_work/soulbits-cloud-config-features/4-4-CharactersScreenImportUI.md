# Phase 4-4: CharactersScreen Import UI + i18n

## Objective

Surface the card-import feature on the Characters screen: an **"Import Card"**
action that opens the document picker (PNG or JSON), runs the import service
(4-3), and refreshes the list with a success/error toast. Add the i18n strings.

## Background / References

- Screen: [`CharactersScreen.tsx`](../../src/screens/CharactersScreen.tsx) —
  currently has a create FAB (`handleCreateNew`) and long-press delete. No
  header actions today; the `ScreenHeader` accepts children (used for the search
  bar) and a `right` slot pattern is used elsewhere (e.g. ModuleConfigEditScreen).
- Alerts/toasts: [`useAppAlert()`](../../src/contexts/AppAlertContext.tsx)
  (`showAlert`) and the toast pattern used across screens.
- List reload: `loadProfiles()` already re-runs on focus
  ([`useFocusEffect`](../../src/screens/CharactersScreen.tsx)).
- i18n: `useTranslation('characters')`; locale at
  `src/i18n/locales/en/characters.json`.

## Files to modify

- `src/screens/CharactersScreen.tsx` — add the import action + handler.
- `src/i18n/locales/en/characters.json` — add strings.

## UI placement (pick one with user)

- **Option A — header overflow menu:** add a trailing `Menu` (MaterialCommunity
  `dots-vertical`) in the header with "Import Card". Clean, scalable.
- **Option B — split FAB:** convert the single `+` FAB into a speed-dial with
  "New" and "Import". More discoverable but heavier.

Recommend **Option A** for minimal disruption; confirm during implementation.

## New i18n keys

```json
{
  "importCard": "Import Card",
  "importCardPrompt": "Choose a character card (PNG or JSON)",
  "importSuccess": "Imported {{name}}",
  "importFailed": "Import failed",
  "importUnsupportedType": "Unsupported file type — use PNG or JSON",
  "importParseFailed": "Could not read this character card",
  "importNameRequired": "The card must have a name",
  "importReadFailed": "Could not read the file"
}
```

## Implementation steps

1. **Impact analysis** on `CharactersScreen` before editing.
2. Add the picker + handler:
   ```ts
   const handleImport = async () => {
     try {
       const [doc] = await pick({ type: ['image/png', 'application/json'] });
       if (!doc) return;
       const result = await importCharacterCardFromFile(doc.uri, doc.type ?? '');
       showToast(t('importSuccess', { name: result.name }));
       await loadProfiles(); // refresh grid
     } catch (e) {
       const code = e?.code ?? 'unknown';
       showAlert(t('importFailed'), t(importMessageKey(code)));
     }
   };
   ```
   (Map reason codes from 4-3 to the i18n keys above.)
3. Render the header overflow `Menu` (Option A) or speed-dial (Option B) calling
   `handleImport`.
4. Reuse existing `loadProfiles()` for the refresh (it already loads primary
   images + counts).
5. Manual test matrix:
   - Import a raw V2 JSON card → profile appears with fields populated.
   - Import a PNG Tavern Card (V2/V3) → profile + avatar appears.
   - Import a V1 JSON card → coerced correctly.
   - Import a malformed file → friendly error toast, no crash.

## Progress checklist

- [ ] Impact analysis run on `CharactersScreen`
- [ ] Import action rendered (header menu or FAB) and wired to the service
- [ ] Success → list refresh + toast; failure → localized alert/toast
- [ ] i18n keys added to `characters.json`
- [ ] Manual test matrix (JSON V1/V2/V3 + PNG) passes
