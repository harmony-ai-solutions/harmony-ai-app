/**
 * LifecycleConfigEditor — RN port of the Wails
 * `frontend/src/components/settings/LifecycleConfigEditor.jsx`.
 *
 * Edits the `lifecycle_config` JSON column on a character profile (the
 * defaults inherited by AI characters/entities created from it). Five
 * sections mirror the desktop editor 1:1: Beat Schedule, Sleep &
 * Exhaustion, Emotion Decay, Crystallization, Memory.
 *
 * All strings come from the `characters` namespace under `lifecycle.*`
 * (52 keys) so labels/hints/tooltips render identically to the web UI.
 *
 * Section info uses a mobile-native collapsible card (tap the ⓘ icon) —
 * the Wails portal/tooltip trick isn't needed here because the card
 * expands inline within the scroll view (no overflow-clipping ancestor).
 */

import React, { useState } from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';

export interface LifecycleConfig {
  autonomy_level?: number;
  beat_interval?: number;
  beat_type_weights?: {
    self_reflection?: number;
    curiosity?: number;
    relationship?: number;
    outreach?: number;
  };
  sleep_threshold?: number;
  wake_threshold?: number;
  exhaustion_accumulation_per_beat?: number;
  exhaustion_decay_per_tick?: number;
  emotion_decay_tau?: number;
  emotion_high_threshold?: number;
  emotion_low_threshold?: number;
  emotion_crystallize_intensity?: number;
  emotion_crystallize_min_hours?: number;
  core_memories_k?: number;
}

export interface LifecycleConfigEditorProps {
  config: LifecycleConfig;
  onChange: (next: LifecycleConfig) => void;
}

const BEAT_TYPES = ['self_reflection', 'curiosity', 'relationship', 'outreach'] as const;
const DEFAULT_WEIGHTS: Record<string, number> = {
  self_reflection: 0.35,
  curiosity: 0.3,
  relationship: 0.25,
  outreach: 0.1,
};
const AUTONOMY_LEVELS = [0, 1, 2, 3] as const;
const AUTONOMY_KEYS: Record<number, string> = {
  0: 'observe',
  1: 'reflect',
  2: 'reachOut',
  3: 'act',
};

/**
 * Section header with a collapsible info card (mobile-native tooltip
 * equivalent of the desktop SettingsTooltip). Tapping the ⓘ icon
 * expands the descriptive text in a bordered card below the header.
 */
const LifecycleSection: React.FC<{
  iconName: string;
  titleKey: string;
  tooltipKey: string;
  testId: string;
  children: React.ReactNode;
}> = ({ iconName, titleKey, tooltipKey, testId, children }) => {
  const { t } = useTranslation('characters');
  const { theme } = useAppTheme();
  const [open, setOpen] = useState(false);

  if (!theme) return null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeaderRow}>
        <Icon name={iconName} size={15} color={theme.colors.accent.primary} />
        <ThemedText
          size={13}
          weight="bold"
          variant="accent"
          style={styles.sectionTitle}>
          {t(titleKey)}
        </ThemedText>
        <TouchableOpacity
          onPress={() => setOpen(v => !v)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="More information"
          testID={testId}>
          <Icon
            name="information-outline"
            size={16}
            color={open ? theme.colors.accent.primary : theme.colors.text.muted}
          />
        </TouchableOpacity>
      </View>
      {open && (
        <View
          style={[
            styles.tooltipCard,
            {
              borderColor: theme.colors.border.default,
              backgroundColor: theme.colors.background.surface,
            },
          ]}>
          <ThemedText variant="secondary" size={12} style={styles.tooltipText}>
            {t(tooltipKey)}
          </ThemedText>
        </View>
      )}
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
};

/** Numeric field with label / unit badge / detailed hint. */
const NumberField: React.FC<{
  labelKey: string;
  unitKey: string;
  hintKey: string;
  value: number;
  onChange: (text: string) => void;
  testId: string;
}> = ({ labelKey, unitKey, hintKey, value, onChange, testId }) => {
  const { t } = useTranslation('characters');
  const { theme } = useAppTheme();
  if (!theme) return null;

  const inputStyle = {
    backgroundColor: theme.colors.background.base,
    borderColor: theme.colors.border.default,
    color: theme.colors.text.primary,
  };

  return (
    <View style={styles.field}>
      <View style={styles.fieldLabelRow}>
        <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
          {t(labelKey)}
        </ThemedText>
        <ThemedText size={11} variant="muted" style={styles.fieldUnit}>
          {t(unitKey)}
        </ThemedText>
      </View>
      <TextInput
        value={String(value)}
        onChangeText={onChange}
        keyboardType="numeric"
        style={[styles.numInput, inputStyle]}
        testID={testId}
      />
      <ThemedText variant="muted" size={11} style={styles.fieldHint}>
        {t(hintKey)}
      </ThemedText>
    </View>
  );
};

export const LifecycleConfigEditor: React.FC<LifecycleConfigEditorProps> = ({
  config,
  onChange,
}) => {
  const { t } = useTranslation('characters');
  const { theme } = useAppTheme();

  const setField = (field: keyof LifecycleConfig, raw: string) => {
    const num = parseFloat(raw);
    onChange({ ...config, [field]: isNaN(num) ? raw : num } as LifecycleConfig);
  };

  const setWeight = (type: string, raw: string) => {
    const num = parseFloat(raw);
    onChange({
      ...config,
      beat_type_weights: {
        ...config.beat_type_weights,
        [type]: isNaN(num) ? raw : num,
      },
    });
  };

  if (!theme) return null;

  const accent = theme.colors.accent.primary;

  return (
    <View style={styles.container}>
      {/* ── Beat Schedule ── */}
      <LifecycleSection
        iconName="clock-outline"
        titleKey="lifecycle.beatSchedule.title"
        tooltipKey="lifecycle.beatSchedule.tooltip"
        testId="lifecycle-beat-info">
        <View style={styles.field}>
          <View style={styles.fieldLabelRow}>
            <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
              {t('lifecycle.beatSchedule.autonomyLevel.label')}
            </ThemedText>
            <ThemedText size={11} variant="muted" style={styles.fieldUnit}>
              {t('lifecycle.beatSchedule.autonomyLevel.unit')}
            </ThemedText>
          </View>
          <View style={styles.chipRow}>
            {AUTONOMY_LEVELS.map(lvl => {
              const selected = (config.autonomy_level ?? 1) === lvl;
              return (
                <TouchableOpacity
                  key={lvl}
                  onPress={() => onChange({ ...config, autonomy_level: lvl })}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={[
                    styles.chip,
                    {
                      borderColor: selected ? accent : theme.colors.border.default,
                      backgroundColor: selected ? accent + '1A' : 'transparent',
                    },
                  ]}
                  testID={`lifecycle-autonomy-${lvl}`}>
                  <ThemedText
                    size={12}
                    variant={selected ? 'accent' : 'primary'}
                    numberOfLines={1}>
                    {t(`lifecycle.beatSchedule.autonomyLevels.${AUTONOMY_KEYS[lvl]}`)}
                  </ThemedText>
                </TouchableOpacity>
              );
            })}
          </View>
          <ThemedText variant="muted" size={11} style={styles.fieldHint}>
            {t('lifecycle.beatSchedule.autonomyLevel.hint')}
          </ThemedText>
        </View>

        <NumberField
          labelKey="lifecycle.beatSchedule.beatInterval.label"
          unitKey="lifecycle.beatSchedule.beatInterval.unit"
          hintKey="lifecycle.beatSchedule.beatInterval.hint"
          value={config.beat_interval ?? 1800}
          onChange={v => setField('beat_interval', v)}
          testId="lifecycle-beat-interval"
        />

        <View style={styles.field}>
          <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
            {t('lifecycle.beatSchedule.beatTypeWeights.label')}
          </ThemedText>
          <View style={styles.weightsGrid}>
            {BEAT_TYPES.map(type => (
              <View key={type} style={styles.weightCell}>
                <ThemedText size={11} variant="muted" numberOfLines={1}>
                  {t(`lifecycle.beatSchedule.beatTypes.${type}`)}
                </ThemedText>
                <TextInput
                  value={String(config.beat_type_weights?.[type] ?? DEFAULT_WEIGHTS[type])}
                  onChangeText={v => setWeight(type, v)}
                  keyboardType="numeric"
                  style={[
                    styles.weightInput,
                    {
                      backgroundColor: theme.colors.background.base,
                      borderColor: theme.colors.border.default,
                      color: theme.colors.text.primary,
                    },
                  ]}
                  testID={`lifecycle-weight-${type}`}
                />
              </View>
            ))}
          </View>
          <ThemedText variant="muted" size={11} style={styles.fieldHint}>
            {t('lifecycle.beatSchedule.beatTypeWeights.hint')}
          </ThemedText>
        </View>
      </LifecycleSection>

      {/* ── Sleep & Exhaustion ── */}
      <LifecycleSection
        iconName="moon-waning-crescent"
        titleKey="lifecycle.sleepExhaustion.title"
        tooltipKey="lifecycle.sleepExhaustion.tooltip"
        testId="lifecycle-sleep-info">
        <NumberField
          labelKey="lifecycle.sleepExhaustion.sleepThreshold.label"
          unitKey="lifecycle.sleepExhaustion.sleepThreshold.unit"
          hintKey="lifecycle.sleepExhaustion.sleepThreshold.hint"
          value={config.sleep_threshold ?? 0.8}
          onChange={v => setField('sleep_threshold', v)}
          testId="lifecycle-sleep-threshold"
        />
        <NumberField
          labelKey="lifecycle.sleepExhaustion.wakeThreshold.label"
          unitKey="lifecycle.sleepExhaustion.wakeThreshold.unit"
          hintKey="lifecycle.sleepExhaustion.wakeThreshold.hint"
          value={config.wake_threshold ?? 0.2}
          onChange={v => setField('wake_threshold', v)}
          testId="lifecycle-wake-threshold"
        />
        <NumberField
          labelKey="lifecycle.sleepExhaustion.exhaustionAccumulation.label"
          unitKey="lifecycle.sleepExhaustion.exhaustionAccumulation.unit"
          hintKey="lifecycle.sleepExhaustion.exhaustionAccumulation.hint"
          value={config.exhaustion_accumulation_per_beat ?? 0.1}
          onChange={v => setField('exhaustion_accumulation_per_beat', v)}
          testId="lifecycle-exhaustion-accumulation"
        />
        <NumberField
          labelKey="lifecycle.sleepExhaustion.exhaustionDecay.label"
          unitKey="lifecycle.sleepExhaustion.exhaustionDecay.unit"
          hintKey="lifecycle.sleepExhaustion.exhaustionDecay.hint"
          value={config.exhaustion_decay_per_tick ?? 0.02}
          onChange={v => setField('exhaustion_decay_per_tick', v)}
          testId="lifecycle-exhaustion-decay"
        />
      </LifecycleSection>

      {/* ── Emotion Decay ── */}
      <LifecycleSection
        iconName="emoticon-outline"
        titleKey="lifecycle.emotionDecay.title"
        tooltipKey="lifecycle.emotionDecay.tooltip"
        testId="lifecycle-emotion-info">
        <NumberField
          labelKey="lifecycle.emotionDecay.decayTau.label"
          unitKey="lifecycle.emotionDecay.decayTau.unit"
          hintKey="lifecycle.emotionDecay.decayTau.hint"
          value={config.emotion_decay_tau ?? 3600}
          onChange={v => setField('emotion_decay_tau', v)}
          testId="lifecycle-decay-tau"
        />
        <NumberField
          labelKey="lifecycle.emotionDecay.highThreshold.label"
          unitKey="lifecycle.emotionDecay.highThreshold.unit"
          hintKey="lifecycle.emotionDecay.highThreshold.hint"
          value={config.emotion_high_threshold ?? 6.0}
          onChange={v => setField('emotion_high_threshold', v)}
          testId="lifecycle-emotion-high"
        />
        <NumberField
          labelKey="lifecycle.emotionDecay.lowThreshold.label"
          unitKey="lifecycle.emotionDecay.lowThreshold.unit"
          hintKey="lifecycle.emotionDecay.lowThreshold.hint"
          value={config.emotion_low_threshold ?? 1.0}
          onChange={v => setField('emotion_low_threshold', v)}
          testId="lifecycle-emotion-low"
        />
      </LifecycleSection>

      {/* ── Crystallization ── */}
      <LifecycleSection
        iconName="diamond-stone"
        titleKey="lifecycle.crystallization.title"
        tooltipKey="lifecycle.crystallization.tooltip"
        testId="lifecycle-crystal-info">
        <NumberField
          labelKey="lifecycle.crystallization.intensity.label"
          unitKey="lifecycle.crystallization.intensity.unit"
          hintKey="lifecycle.crystallization.intensity.hint"
          value={config.emotion_crystallize_intensity ?? 7.0}
          onChange={v => setField('emotion_crystallize_intensity', v)}
          testId="lifecycle-crystal-intensity"
        />
        <NumberField
          labelKey="lifecycle.crystallization.minHours.label"
          unitKey="lifecycle.crystallization.minHours.unit"
          hintKey="lifecycle.crystallization.minHours.hint"
          value={config.emotion_crystallize_min_hours ?? 2.0}
          onChange={v => setField('emotion_crystallize_min_hours', v)}
          testId="lifecycle-crystal-min-hours"
        />
      </LifecycleSection>

      {/* ── Memory ── */}
      <LifecycleSection
        iconName="book-multiple"
        titleKey="lifecycle.memory.title"
        tooltipKey="lifecycle.memory.tooltip"
        testId="lifecycle-memory-info">
        <NumberField
          labelKey="lifecycle.memory.coreMemoriesK.label"
          unitKey="lifecycle.memory.coreMemoriesK.unit"
          hintKey="lifecycle.memory.coreMemoriesK.hint"
          value={config.core_memories_k ?? 10}
          onChange={v => setField('core_memories_k', v)}
          testId="lifecycle-core-memories"
        />
      </LifecycleSection>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 16,
  },
  section: {
    gap: 8,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionTitle: {
    flex: 1,
    letterSpacing: 0.3,
  },
  tooltipCard: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  tooltipText: {
    lineHeight: 18,
  },
  sectionBody: {
    gap: 14,
    paddingTop: 2,
  },
  field: {
    gap: 5,
  },
  fieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  fieldLabel: {
    flex: 1,
  },
  fieldUnit: {
    fontVariant: ['tabular-nums'],
  },
  numInput: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    fontSize: 15,
  },
  fieldHint: {
    lineHeight: 16,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 14,
    borderWidth: 1,
  },
  weightsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  weightCell: {
    flexGrow: 1,
    flexBasis: '44%',
    gap: 4,
  },
  weightInput: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 40,
    fontSize: 14,
  },
});
