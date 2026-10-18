/**
 * SamplingPresetSelect — engine-backed sampling-preset dropdown (2-2).
 *
 * Replaces the blind `sampling_preset_name` text input. The list is fed by the
 * engine's existing `GET /api/presets` (via `usePresets`); selecting a preset
 * fetches its `params` (`GET /api/presets/:name`) and renders preview chips
 * describing the values it supplies.
 *
 * Preset semantics (plan §11 A3, engine truth `providers/openai.go:129-193`):
 * **a preset supplies DEFAULTS; explicit local values override it.** So the
 * local sampling inputs are NEVER disabled or rewritten by this control — the
 * chips merely show "preset sets temperature=0.7" and, when the user has
 * explicitly set a value for a param the preset also sets, annotate it with
 * "your explicit value (0.9) wins".
 *
 * Fallbacks:
 *  - No presets reachable (empty list / error) → keep the original free-text
 *    input so a preset name can still be typed (mirrors `CatalogModelSelect`).
 *  - A saved value that is no longer in the list stays selectable, so a
 *    deleted preset round-trips on reload instead of silently snapping.
 */

import React, { useEffect, useState } from 'react';
import { View, TextInput, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { SelectPicker } from './SelectPicker';
import { usePresets } from '../../hooks/usePresets';
import { engineApiClient } from '../../services/engine/EngineApiClient';
import type { PresetDetailResponseDto } from '../../services/engine/EngineApiClient';

/** Option id for the "Manual" (no preset) choice — matches the empty value. */
export const MANUAL_PRESET_OPTION_ID = '';

/** Test id for the free-text fallback input (no presets reachable). */
export const PRESET_FREE_TEXT_TESTID = 'sampling-preset-free-text';

/** Test id for a preset preview chip. */
export function presetChipTestId(key: string): string {
  return `preset-chip-${key}`;
}

/** Test id for the "your explicit value wins" marker inside a chip. */
export function presetOverrideTestId(key: string): string {
  return `preset-chip-override-${key}`;
}

interface SamplingPresetSelectProps {
  /** Selected preset name; `''` = Manual (no preset). */
  value: string;
  onChange: (name: string) => void;
  /** The slot's current local form values (to annotate overrides). */
  localValues: Record<string, any>;
  /** Field keys the user has explicitly set for this slot. */
  explicitKeys: Record<string, boolean>;
  /** Field label — used as the picker's accessibility label + modal title. */
  label: string;
}

export const SamplingPresetSelect: React.FC<SamplingPresetSelectProps> = ({
  value,
  onChange,
  localValues,
  explicitKeys,
  label,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('moduleConfig');
  const { presets, loading, error } = usePresets();

  const [detail, setDetail] = useState<PresetDetailResponseDto | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Fetch the selected preset's params for the preview chips.
  useEffect(() => {
    let alive = true;
    if (!value) {
      setDetail(null);
      setDetailError(null);
      return () => {
        alive = false;
      };
    }
    setDetailError(null);
    engineApiClient
      .getPreset(value)
      .then((d) => {
        if (alive) setDetail(d);
      })
      .catch((e) => {
        if (alive) {
          setDetail(null);
          setDetailError((e as Error)?.message ?? 'Failed to load preset');
        }
      });
    return () => {
      alive = false;
    };
  }, [value]);

  if (!theme) return null;

  // No presets reachable → keep the original free-text behaviour.
  const showFreeText = !loading && presets.length === 0;

  const renderChips = () => {
    if (!value || !detail?.params) return null;
    const entries = Object.entries(detail.params);
    if (entries.length === 0) return null;
    return (
      <View style={styles.chips}>
        {entries.map(([key, presetValue]) => {
          const localValue = localValues[key];
          const hasLocal =
            localValue !== undefined && localValue !== null && localValue !== '';
          const overridden = hasLocal && explicitKeys[key] === true;
          return (
            <View
              key={key}
              testID={presetChipTestId(key)}
              style={[
                styles.chip,
                {
                  borderColor: theme.colors.border.default,
                  backgroundColor: theme.colors.background.surface,
                },
              ]}
            >
              <ThemedText variant="muted" size={11}>
                {`${t('presetSets')} ${key}=${String(presetValue)}`}
              </ThemedText>
              {overridden && (
                <ThemedText
                  variant="accent"
                  size={11}
                  testID={presetOverrideTestId(key)}
                >
                  {` — ${t('presetLocalWins', { value: String(localValue) })}`}
                </ThemedText>
              )}
            </View>
          );
        })}
      </View>
    );
  };

  // ── Free-text fallback (no presets reachable) ──
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
          onChangeText={onChange}
          placeholder={t('presetCustom')}
          placeholderTextColor={theme.colors.text.muted}
          testID={PRESET_FREE_TEXT_TESTID}
        />
        <ThemedText variant="muted" size={11} style={styles.hint}>
          {error ? t('presetError', { message: error }) : t('presetNone')}
        </ThemedText>
        {renderChips()}
      </View>
    );
  }

  // ── Preset dropdown ──
  const options = [
    { id: MANUAL_PRESET_OPTION_ID, name: t('presetManual') },
    ...presets.map((p) => ({ id: p.name, name: p.name })),
  ];
  // Keep a saved-but-unlisted preset selectable (deleted preset round-trips).
  if (value && !options.find((o) => o.id === value)) {
    options.push({ id: value, name: value });
  }

  return (
    <View>
      <SelectPicker
        label={label}
        value={value}
        options={options}
        onChange={onChange}
        placeholder={t('presetSelectPlaceholder')}
      />
      {loading && (
        <ThemedText variant="muted" size={11} style={styles.hint}>
          {t('presetLoading')}
        </ThemedText>
      )}
      {!loading && error && (
        <ThemedText variant="muted" size={11} style={styles.hint}>
          {t('presetError', { message: error })}
        </ThemedText>
      )}
      {detailError && (
        <ThemedText variant="muted" size={11} style={styles.hint}>
          {t('presetError', { message: detailError })}
        </ThemedText>
      )}
      <ThemedText variant="muted" size={11} style={styles.hint}>
        {t('presetHint')}
      </ThemedText>
      {renderChips()}
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
  chips: {
    marginTop: 6,
    gap: 4,
  },
  chip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
});
