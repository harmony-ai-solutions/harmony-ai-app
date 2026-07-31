# Phase 1-1: FormField Select Dropdown

## Objective

Make `FormField` render `type: 'select'` fields as a **real themed dropdown
picker** instead of the current read-only `TextInput` (`editable={false}`). This
is shared infrastructure required by Feature 2's model selector and also fixes
existing `select` fields (`reasoning_effort`, `aspect_ratio`, etc.) that are
currently non-interactive.

## Background / References

- Component: [`FormField.tsx`](../../src/components/config/FormField.tsx) — the
  `case 'select':` branch (around line 113) renders a disabled `TextInput`.
- Type: [`FieldDefinition`](../../src/constants/providerFieldSchemas.ts) declares
  `type: 'select'` with `options: Array<{ id: string; name: string }>`.
- Existing `select` fields in `PROVIDER_SCHEMAS`: `openai.reasoning_effort`,
  `xai.reasoning_effort`, `xai.image_aspect_ratio`, `google.aspect_ratio`.
- UI conventions: app uses **React Native Paper (MD3)** + a glassmorphism theme
  via [`useAppTheme()`](../../src/contexts/ThemeContext.tsx). Prefer a themed
  modal/bottom-sheet picker (consistent with other modals in the app, e.g.
  `EmojiActionEditModal`). Avoid native `<select>`/`Picker` styling drift.

## Files to modify

- `src/components/config/FormField.tsx` — replace the `select` case.
- (New) `src/components/config/SelectPicker.tsx` — reusable themed picker
  (modal/FlatList of options). Keep it generic: props `{ label, value, options,
  onChange, placeholder? }`.

## Implementation steps

1. **Run impact analysis** on `FormField` before editing:
   `gitnexus_impact({ target: "FormField", direction: "upstream" })`.
2. Create `SelectPicker.tsx`:
   - Renders a tappable "field row" (label + current option name + chevron icon)
     themed like the existing `TextInput` rows (border, radius 8, minHeight 44,
     background `theme.colors.background.base`).
   - On press, opens a themed modal (or Paper `Menu`) listing
     `options.map(o => ({ id, name }))`; selecting calls `onChange(field.key, o.id)`.
   - Support a clear/empty option when the schema's first option has `id: ''`
     (used as "Default" today).
   - Respect dark/glass theme; reuse `ThemedText`, `ThemedView`, `useAppTheme`.
3. Update `FormField` `case 'select':` to render `<SelectPicker .../>` instead of
   the disabled `TextInput`. Pass `field.options`, current `value`, and
   `onChange`.
4. Verify existing select fields still render their current value label
   (resolve `id` → `name` from `options`).
5. Manual check: open a provider config with a select field (e.g. OpenAI
   `reasoning_effort`, Google `aspect_ratio`) and confirm the picker opens and
   writes the selected `id` back.

## Code sketch

```tsx
// SelectPicker.tsx (abbreviated)
export const SelectPicker = ({ label, value, options, onChange, placeholder }) => {
  const { theme } = useAppTheme();
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.id === value);
  return (
    <View>
      <ThemedText size={13} variant="secondary">{label}</ThemedText>
      <TouchableOpacity style={[rowStyle, { borderColor: theme.colors.border.default }]} onPress={() => setOpen(true)}>
        <ThemedText>{selected?.name ?? placeholder ?? 'Select…'}</ThemedText>
        <Icon name="chevron-down" />
      </TouchableOpacity>
      <ThemedModal visible={open} onDismiss={() => setOpen(false)}>
        <FlatList data={options} keyExtractor={o => o.id}
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => { onChange(item.id); setOpen(false); }}>
              <ThemedText>{item.name}</ThemedText>
            </TouchableOpacity>
          )} />
      </ThemedModal>
    </View>
  );
};
```

## Progress checklist

- [ ] Impact analysis run on `FormField`
- [ ] `SelectPicker.tsx` created (themed, accessible)
- [ ] `FormField` `select` case renders `SelectPicker`
- [ ] Existing select fields (reasoning_effort, aspect_ratio) verified
- [ ] No regressions in provider config screens
