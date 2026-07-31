# Phase 3-3: SoulbitsModelSelect Component + Screen Wiring

## Objective

For the **Soulbits Cloud** provider, replace the static free-text `model` field
with a module-aware **model dropdown** that:
- loads valid models for the current module type from the catalog service (3-2),
- falls back to the static list,
- and keeps a **free-text override** for manual/advanced entry.

The selected value is persisted into the provider form's `model` field exactly as
before, so no storage/migration/sync changes are required.

## Background / References

- Screen: [`ModuleConfigEditScreen.tsx`](../../src/screens/config/ModuleConfigEditScreen.tsx).
  - `renderInlineProviderFields(slot, providerType)` (~line 585) maps over
    `schema.fields` and renders `<FormField>` for each, skipping `name`.
  - Provider form values live in `providerForms[slot].values` (`model` among
    them); written via `handleProviderFieldChange(slot, key, value)`.
  - `moduleType` is available from route params.
- The `model` field is defined in the soulbitscloud schema
  ([`providerFieldSchemas.ts`](../../src/constants/providerFieldSchemas.ts)).
- Catalog service from 3-2; mapping/fallback from 3-1.
- The generic `SelectPicker` (1-1) can be reused for the dropdown chrome.

## Files to create / modify

- (New) `src/components/config/SoulbitsModelSelect.tsx`.
- (Modify) `src/screens/config/ModuleConfigEditScreen.tsx` — render
  `SoulbitsModelSelect` instead of the generic `FormField` for the `model` field
  when `providerType === 'soulbitscloud'`.

## Component contract

```tsx
interface SoulbitsModelSelectProps {
  moduleType: string;
  value: string;                              // current model
  onChange: (model: string) => void;          // writes providerForms[slot].values.model
}
```

Behavior:
- On mount (and when `moduleType` changes), call `fetchModelsForModule(moduleType)`
  → set `models` + `source` + `loading`.
- Render a dropdown (reuse `SelectPicker`-style chrome) whose options are the
  fetched models plus the current `value` (so a saved-but-uncataloged model still
  shows). Add an explicit **"Custom…"** option that reveals a free-text input
  (the existing text field UX).
- Empty/loading states: show a spinner while loading; if `models.length === 0`
  and not loading, show just the free-text input with a hint (i18n 3-4).
- Persist selection via `onChange(selectedId)`; custom text via `onChange(text)`.

## Screen wiring steps

1. **Impact analysis** on `renderInlineProviderFields` before editing.
2. In `renderInlineProviderFields`, when `providerType === 'soulbitscloud'`,
   split the field loop so the `model` key renders `<SoulbitsModelSelect>` and
   all other non-`name` fields render `<FormField>` as today. Example:
   ```tsx
   const fields = schema.fields.filter(f => f.key !== 'name');
   const isSoulbits = providerType === 'soulbitscloud';
   return (
     <View style={styles.providerFieldsContainer}>
       {fields.map((field) =>
         isSoulbits && field.key === 'model' ? (
           <SoulbitsModelSelect
             key="model"
             moduleType={moduleType}
             value={form.values.model ?? ''}
             onChange={(m) => handleProviderFieldChange(slot, 'model', m)}
           />
         ) : (
           <FormField key={field.key} field={field} value={form.values[field.key]}
             onChange={(k, v) => handleProviderFieldChange(slot, k, v)} />
         )
       )}
       {/* AdvancedSamplingParams unchanged */}
     </View>
   );
   ```
3. STT dual-slot note: both `transcription` and `vad` slots render through this
   function, so `moduleType` is `'stt'` for both. The transcription slot uses
   stt models; the vad slot should render the generic text field (VAD isn't a
   model-class catalog entry). Decide: keep `SoulbitsModelSelect` for
   transcription only. Since the function doesn't know the slot name, thread
   `slot` into the render or special-case by slot where called.

## Code sketch (component)

```tsx
export const SoulbitsModelSelect = ({ moduleType, value, onChange }) => {
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [custom, setCustom] = useState(false);

  useEffect(() => {
    let alive = true; setLoading(true);
    fetchModelsForModule(moduleType)
      .then(r => { if (alive) { setModels(r.models); setLoading(false); } })
      .catch(() => { if (alive) { setModels([]); setLoading(false); } });
    return () => { alive = false; };
  }, [moduleType]);

  if (loading) return <InlineSpinner />;
  if (!models.length || custom)
    return <FreeTextInput value={value} onChange={onChange} />;

  const options = uniqBy([...models, value ? { id: value } : null].filter(Boolean), 'id');
  return <SelectPicker label="Model" value={value}
    options={options.map(m => ({ id: m.id, name: m.name ?? m.id }))}
    onChange={onChange} />;
};
```

## Progress checklist

- [ ] Impact analysis run on `renderInlineProviderFields`
- [ ] `SoulbitsModelSelect.tsx` created (load / fallback / custom override)
- [ ] Screen renders it for soulbitscloud `model`; other fields untouched
- [ ] STT transcription vs vad slot handled
- [ ] Selected model persists into `model` (no schema/storage changes)
