/**
 * SoulbitsModelSelect — module-aware model dropdown for the Soulbits Cloud provider.
 *
 * Shows a SelectPicker populated from the live catalog (or static fallbacks when
 * offline).  When no models are available (or the user taps "Custom…") it switches
 * to a free-text TextInput for entering an arbitrary model id.
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  TextInput,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { SelectPicker } from './SelectPicker';
import {
  fetchModelsForModule,
  type CatalogModel,
} from '../../services/cloud/soulbitsModelsCatalog';

interface SoulbitsModelSelectProps {
  moduleType: string;
  value: string;
  onChange: (model: string) => void;
}

export const SoulbitsModelSelect: React.FC<SoulbitsModelSelectProps> = ({
  moduleType,
  value,
  onChange,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('moduleConfig');

  // ── State ────────────────────────────────────────────────────────────
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [source, setSource] = useState<'live' | 'fallback'>('fallback');
  const [custom, setCustom] = useState<boolean>(false);

  // ── Fetch on moduleType change ──────────────────────────────────────
  useEffect(() => {
    let alive = true;
    setLoading(true);

    fetchModelsForModule(moduleType)
      .then(result => {
        if (!alive) return;
        setModels(result.models);
        setSource(result.source);
        setLoading(false);
      })
      .catch(() => {
        // Shouldn't happen (service never throws), but be safe
        if (!alive) return;
        setModels([]);
        setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [moduleType]);

  // ── Guard: no theme → render nothing ────────────────────────────────
  if (!theme) return null;

  // ── Loading state ───────────────────────────────────────────────────
  if (loading) {
    return (
      <View
        style={[
          styles.loadingRow,
          {
            borderColor: theme.colors.border.default,
            backgroundColor: theme.colors.background.base,
          },
        ]}
      >
        <ActivityIndicator size="small" color={theme.colors.accent.primary} />
        <ThemedText variant="muted" style={styles.loadingText}>
          {t('modelLoading')}
        </ThemedText>
      </View>
    );
  }

  // ── Empty / custom → free-text input ────────────────────────────────
  if (models.length === 0 || custom) {
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
          onChangeText={onChange}
          placeholder={t('modelCustom')}
          placeholderTextColor={theme.colors.text.muted}
        />
        {models.length === 0 && (
          <ThemedText variant="muted" size={11} style={styles.hint}>
            {t('modelNoModels')}
          </ThemedText>
        )}
        {source === 'fallback' && (
          <ThemedText variant="muted" size={11} style={styles.hint}>
            {t('modelFallbackHint')}
          </ThemedText>
        )}
      </View>
    );
  }

  // ── Models available → SelectPicker ─────────────────────────────────
  const options = models.map(m => ({ id: m.id, name: m.name ?? m.id }));

  // Ensure current value is present (saved-but-uncataloged model)
  if (value && !options.find(o => o.id === value)) {
    options.push({ id: value, name: value });
  }

  // Append "Custom…" option
  options.push({ id: '__custom__', name: t('modelCustom') });

  const handleChange = (id: string) => {
    if (id === '__custom__') {
      setCustom(true);
      // Don't change value — user will type manually
    } else {
      onChange(id);
    }
  };

  return (
    <View>
      <SelectPicker
        label={t('model')}
        value={value}
        options={options}
        onChange={handleChange}
        placeholder={t('modelSelectPlaceholder')}
      />
      {source === 'fallback' && (
        <ThemedText variant="muted" size={11} style={styles.hint}>
          {t('modelFallbackHint')}
        </ThemedText>
      )}
    </View>
  );
};

// ── Styles ──────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    gap: 10,
  },
  loadingText: {
    flex: 1,
  },
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
});
