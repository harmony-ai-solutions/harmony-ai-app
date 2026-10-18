/**
 * CatalogModelSelect — catalog-backed model picker with a "Custom…" escape hatch.
 *
 * Provider-registry 2-1. Renders the `model` field of a provider config form as
 * a dropdown fed by the interim app-side catalog (`providerModelCatalog.ts`,
 * tier-2 until the engine registry lands in 5-2). Behaviour:
 *
 *  - Entries exist for (provider, module) → a `SelectPicker` of the catalog
 *    entries plus a trailing "Custom…" option. Selecting "Custom…" reveals a
 *    free-text input so an arbitrary model id can still be entered.
 *  - No entries (live-authoritative provider, unknown module, or the STT VAD
 *    slot) → a plain free-text input, i.e. today's behaviour, unchanged.
 *  - A saved value that is not in the catalog is kept selectable as an extra
 *    option (matching `SoulbitsModelSelect`), so a manual choice round-trips on
 *    reload rather than snapping to the picker's first entry.
 *  - When the selected model has a known context window, a note chip is shown
 *    next to it with the provenance label `catalog`.
 *
 * Pure helper `formatContextWindow` is exported for unit testing.
 */

import React, { useState } from 'react';
import { View, TextInput, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { SelectPicker } from './SelectPicker';
import { getModelsForModule } from '../../constants/providerModelCatalog';

/** Sentinel option id for the "Custom…" row (never a real model id). */
export const CUSTOM_MODEL_OPTION_ID = '__custom__';

/** Test id for the free-text fallback input. */
export const CUSTOM_MODEL_INPUT_TESTID = 'catalog-model-custom-input';

/**
 * Format a context-window token count for the note chip, e.g. 128000 → "128K",
 * 1050000 → "1.05M", 8192 → "8.2K".
 */
export function formatContextWindow(context: number): string {
  if (context >= 1_000_000) {
    return `${(context / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`;
  }
  if (context >= 1_000) {
    return `${(context / 1_000).toFixed(1).replace(/\.?0+$/, '')}K`;
  }
  return String(context);
}

interface CatalogModelSelectProps {
  providerType: string;
  /** The module whose models should be offered (STT uses 'stt' / 'vad'). */
  moduleType: string;
  value: string;
  onChange: (model: string) => void;
  /** Field label (falls back to the generic "Model" translation). */
  label?: string;
}

export const CatalogModelSelect: React.FC<CatalogModelSelectProps> = ({
  providerType,
  moduleType,
  value,
  onChange,
  label,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('moduleConfig');

  const entries = getModelsForModule(providerType, moduleType);
  const selectedEntry = entries.find(e => e.id === value);

  // "Custom…" tapped this session (value may still hold a catalog id).
  const [customRequested, setCustomRequested] = useState(false);

  if (!theme) return null;

  // A picker is shown whenever the (provider, module) pair has catalog entries
  // (phase 2-1 step 3); free text is the fallback for live-authoritative
  // providers / unknown modules, and the "Custom…" escape hatch. A saved value
  // that is not in the catalog is kept selectable as an extra option (matching
  // SoulbitsModelSelect), so a manual choice survives a reload.
  const showFreeText = entries.length === 0 || customRequested;

  const renderContextChip = () => {
    if (!selectedEntry || selectedEntry.context === undefined) return null;
    return (
      <View
        style={[
          styles.chip,
          {
            borderColor: theme.colors.border.default,
            backgroundColor: theme.colors.background.surface,
          },
        ]}
      >
        <ThemedText variant="muted" size={11}>
          {t('modelContextChip', {
            context: formatContextWindow(selectedEntry.context),
          })}
        </ThemedText>
      </View>
    );
  };

  // ── Free-text (no catalog, or "Custom…" chosen) ──
  if (showFreeText) {
    return (
      <View>
        <TextInput
          style={[
            styles.input,
            {
              color: theme.colors.text.primary,
              borderColor: theme.colors.border.default,
              backgroundColor: theme.colors.background.base,
            },
          ]}
          value={value}
          onChangeText={(text) => {
            // Clearing the field while a catalog exists returns to the picker.
            if (text === '' && entries.length > 0) setCustomRequested(false);
            onChange(text);
          }}
          placeholder={t('modelCustom')}
          placeholderTextColor={theme.colors.text.muted}
          testID={CUSTOM_MODEL_INPUT_TESTID}
        />
        {entries.length === 0 && (
          <ThemedText variant="muted" size={11} style={styles.hint}>
            {t('modelNoModels')}
          </ThemedText>
        )}
        {renderContextChip()}
      </View>
    );
  }

  // ── Catalog available → SelectPicker ──
  const options = entries.map(e => ({ id: e.id, name: e.label }));
  // Keep a saved-but-uncataloged value selectable ("remember manual choice per
  // config" — the persisted value round-trips on reload).
  if (value && !options.find(o => o.id === value)) {
    options.push({ id: value, name: value });
  }
  options.push({ id: CUSTOM_MODEL_OPTION_ID, name: t('modelCustom') });

  const handleChange = (id: string) => {
    if (id === CUSTOM_MODEL_OPTION_ID) {
      setCustomRequested(true);
      return;
    }
    onChange(id);
  };

  return (
    <View>
      <SelectPicker
        label={label ?? t('model')}
        value={value}
        options={options}
        onChange={handleChange}
        placeholder={t('modelSelectPlaceholder')}
      />
      {renderContextChip()}
    </View>
  );
};

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 44,
  },
  hint: {
    marginTop: 4,
  },
  chip: {
    alignSelf: 'flex-start',
    marginTop: 6,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
});
