# Phase 3-4: Model Selector i18n

## Objective

Add user-facing strings for the Soulbits model selector (loading, empty/no
models, custom entry, fallback indicator) to the `moduleConfig` locale, matching
the app's i18n conventions.

## Background / References

- The module config screen uses `useTranslation('moduleConfig')`
  ([`ModuleConfigEditScreen.tsx`](../../src/screens/config/ModuleConfigEditScreen.tsx)).
- Locale files live in `src/i18n/locales/en/` (single English dir per the
  memory-bank note — `en/` only). Namespace registration is in
  [`I18nContext`](../../src/contexts/I18nContext.tsx).
- Existing `moduleConfig.json` already holds keys like `configNameRequired`,
  `providerRequired`, `saveFailed` — follow that casing/style.

## Files to modify

- `src/i18n/locales/en/moduleConfig.json` — add new keys.

## New keys (proposed)

```json
{
  "modelLoading": "Loading available models…",
  "modelNoModels": "No models available — enter manually",
  "modelCustom": "Custom model…",
  "modelFallbackHint": "Showing offline defaults (catalog unreachable)",
  "modelSelectPlaceholder": "Select a model"
}
```

## Implementation steps

1. Append the keys above (adjust wording to match existing tone) to
   `moduleConfig.json`.
2. Use them in `SoulbitsModelSelect.tsx` (3-3): loading spinner accessibility
   label, empty-state hint, the "Custom…" option label, and an optional small
   caption when `source === 'fallback'`.
3. Because `SoulbitsModelSelect` is a component (not the screen), thread
   `useTranslation('moduleConfig')` inside it (or accept translated strings via
   props — preferred if the component stays locale-agnostic). Decide during
   implementation; either is acceptable per project conventions.

## Progress checklist

- [ ] Keys added to `moduleConfig.json`
- [ ] `SoulbitsModelSelect` consumes the strings
- [ ] No hardcoded English in the component beyond fallback defaults
