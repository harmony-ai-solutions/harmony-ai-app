/**
 * ContextSizeSelect — the LLM "Context window" control.
 *
 * Sits in the Backend / Cognition / Movement capability cards, directly under
 * the model picker + its chips, and is visible in BOTH Simple and Advanced
 * mode (it is an essential choice, not a deep technical knob).
 *
 * Behaviour:
 *  - Five pills (Small 8K · Medium 16K · Large 32K · X-Large 64K · Custom).
 *    Small is the DEFAULT applied to an untouched slot and carries a mini
 *    badge. The selected pill draws an accent-gradient ring + soft fill.
 *  - Feasibility comes from the selected model's catalog `context` (the
 *    catalog "never invents" limits): a preset above a KNOWN max is dimmed,
 *    its value struck through and NOT tappable. An unknown max blocks nothing
 *    and the header badge says "model max unknown".
 *  - Custom shows a numeric input (mono figures, "tokens" suffix) with quick
 *    chips (16K · 128K · Model max when known). Validation messages appear
 *    below and the value clamps on BLUR, never on keystroke.
 *  - A model switch that shrinks the max below the current value auto-clamps
 *    to the largest feasible preset and raises a dismissible warning chip
 *    ("Adjusted 64K → 32K — model max is 32K") — the same never-drop-silently
 *    philosophy as CatalogModelSelect's stale marker.
 *
 * The component is COMMIT-ONLY: it calls `onChange(tokens)`; the parent slot
 * decides how that maps into the capability overlay (the module form omits the
 * key when the value is the default, see `CONTEXT_WINDOW_CAPABILITY_KEY`).
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { hapticLightPress } from '../../utils/haptics';
import {
  formatTokenCount,
  CONTEXT_SIZE_PRESETS,
  CONTEXT_SIZE_QUICK_CHIPS,
  clampCustomContext,
  compactionThreshold,
  knownModelMax,
  resolveContextSize,
  validateCustomContext,
  type ContextSizePreset,
  type ContextSizePresetId,
} from '../../utils/contextSize';

/** The module types the control applies to (LLM chat slots with a window). */
export type ContextSizeModuleType = 'backend' | 'cognition' | 'movement';

/** False for every slot that must not render the control (STT, TTS, RAG, …). */
export function isContextSizeModuleType(moduleType: string): moduleType is ContextSizeModuleType {
  return moduleType === 'backend' || moduleType === 'cognition' || moduleType === 'movement';
}

/** testIDs (the pill ids are shared with the preset table). */
export const CONTEXT_SIZE_CUSTOM_INPUT_TESTID = 'context-size-custom-input';
export const CONTEXT_SIZE_MAX_BADGE_TESTID = 'context-size-max-badge';
export const CONTEXT_SIZE_ADJUSTED_WARNING_TESTID = 'context-size-adjusted-warning';
export const CONTEXT_SIZE_ADJUSTED_DISMISS_TESTID = 'context-size-adjusted-dismiss';
export const CONTEXT_SIZE_HINT_TESTID = 'context-size-hint';
export const CONTEXT_SIZE_USE_MAX_TESTID = 'context-size-use-max';

/** `context-size-pill-small` … `context-size-pill-custom`. */
export function contextSizePillTestId(id: ContextSizePresetId): string {
  return `context-size-pill-${id}`;
}

interface ContextSizeSelectProps {
  moduleType: ContextSizeModuleType;
  /** Persisted window (tokens); absent = the Small default. */
  value?: number;
  /** Commit a new window (tokens). */
  onChange: (tokens: number) => void;
  /** The selected model's max context, when the catalog knows it. */
  modelMax?: number;
  /** Human label of the selected model (used by the adjustment warning). */
  modelLabel?: string;
}

export const ContextSizeSelect: React.FC<ContextSizeSelectProps> = ({
  moduleType,
  value,
  onChange,
  modelMax,
  modelLabel,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('moduleConfig');

  const max = knownModelMax(modelMax);
  const storedValue =
    typeof value === 'number' && Number.isFinite(value) && value > 0
      ? Math.floor(value)
      : undefined;
  const resolved = resolveContextSize(storedValue, max);

  // "Custom" tapped this session (the stored value may still be a preset).
  const [customOpen, setCustomOpen] = useState(false);
  const showCustom = customOpen || resolved.presetId === 'custom';

  // Text draft for the custom input (never used to drive the store while the
  // text is not a valid window — validation is shown instead).
  const [customText, setCustomText] = useState(String(resolved.tokens));
  const editingRef = useRef(false);

  // Keep the draft in step with external changes (load, preset press, clamp)
  // unless the user is actively typing in it.
  useEffect(() => {
    if (!editingRef.current) setCustomText(String(resolved.tokens));
  }, [resolved.tokens]);

  // ── Model-switch clamp + warning (never drop the value silently) ──
  const [adjusted, setAdjusted] = useState<{
    from: number;
    to: number;
    max: number;
  } | null>(null);
  const prevMaxRef = useRef<number | undefined>(max);

  useEffect(() => {
    const next = knownModelMax(modelMax);
    const prev = prevMaxRef.current;
    prevMaxRef.current = next;
    if (next === undefined || next === prev) return;
    if (storedValue === undefined || storedValue <= next) return;
    const clamped = resolveContextSize(storedValue, next);
    setAdjusted({ from: storedValue, to: clamped.tokens, max: next });
    setCustomOpen(clamped.presetId === 'custom');
    setCustomText(String(clamped.tokens));
    onChange(clamped.tokens);
  }, [modelMax, storedValue, onChange]);

  if (!theme) return null;

  const accent = theme.colors.accent.primary;

  // ── Custom draft handling ──────────────────────────────────────────────
  const parsedCustom = Number(customText);
  // An empty draft is "not typed yet", not an error.
  const customError =
    customText.trim() === '' ? null : validateCustomContext(parsedCustom, max);

  const handleCustomText = (text: string) => {
    const digits = text.replace(/[^0-9]/g, '');
    setCustomText(digits);
    if (digits === '') return;
    const tokens = Number(digits);
    // Never clamp on keystroke: only a value that already validates commits.
    if (validateCustomContext(tokens, max) === null) onChange(tokens);
  };

  /** Commit a discrete value (chip / "Use max"): clamped, always valid. */
  const applyCustom = (tokens: number) => {
    const clamped = clampCustomContext(tokens, max);
    setCustomText(String(clamped));
    if (validateCustomContext(clamped, max) === null) onChange(clamped);
  };

  const handleCustomBlur = () => {
    editingRef.current = false;
    const clamped = clampCustomContext(parsedCustom, max);
    setCustomText(String(clamped));
    onChange(clamped);
  };

  const selectPreset = (preset: ContextSizePreset) => {
    hapticLightPress();
    setCustomOpen(false);
    setAdjusted(null);
    onChange(preset.tokens);
  };

  const selectedPresetId: ContextSizePresetId = showCustom ? 'custom' : resolved.presetId;

  // ── Pills ──────────────────────────────────────────────────────────────
  const renderPill = (
    id: ContextSizePresetId,
    label: string,
    valueText: string,
    onPress: () => void,
    options: { infeasible?: boolean; defaultValue?: boolean; a11yLabel: string },
  ) => {
    const isSelected = selectedPresetId === id;
    const infeasible = options.infeasible === true;
    return (
      <View key={id} style={styles.pillSlot}>
        {options.defaultValue && (
          <View
            testID="context-size-default-badge"
            style={[
              styles.defaultBadge,
              { borderColor: accent + '66', backgroundColor: accent + '1A' },
            ]}
          >
            <ThemedText size={8.5} weight="bold" style={{ color: accent }}>
              {t('contextSizeDefault')}
            </ThemedText>
          </View>
        )}
        <TouchableOpacity
          testID={contextSizePillTestId(id)}
          accessibilityRole="button"
          accessibilityLabel={options.a11yLabel}
          accessibilityState={{ selected: isSelected, disabled: infeasible }}
          disabled={infeasible}
          onPress={onPress}
          activeOpacity={0.75}
          style={[
            styles.pill,
            {
              borderColor: theme.colors.border.default,
              backgroundColor: theme.colors.background.base,
            },
            isSelected && styles.pillSelected,
            infeasible && styles.pillInfeasible,
          ]}
        >
          {isSelected && (
            <LinearGradient
              colors={[theme.colors.accent.primary, theme.colors.accent.secondary]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
          )}
          <View
            style={[
              styles.pillContent,
              isSelected && styles.pillContentSelected,
              isSelected && { backgroundColor: accent + '1F' },
            ]}
          >
            <ThemedText
              size={10.5}
              variant={isSelected ? 'accent' : 'muted'}
              numberOfLines={1}
            >
              {label}
            </ThemedText>
            <ThemedText
              size={13}
              weight={isSelected ? 'bold' : 'medium'}
              variant={isSelected ? 'primary' : 'secondary'}
              numberOfLines={1}
              style={infeasible ? styles.strikethrough : undefined}
            >
              {valueText}
            </ThemedText>
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  const renderPresetPills = () =>
    CONTEXT_SIZE_PRESETS.map((preset) => {
      const label = t(preset.labelKey);
      const valueText = formatTokenCount(preset.tokens);
      return renderPill(
        preset.id,
        label,
        valueText,
        () => selectPreset(preset),
        {
          defaultValue: preset.id === 'small',
          infeasible: resolved.disabledPresets.includes(preset.id),
          a11yLabel: t('contextSizePillA11y', { label, value: valueText }),
        },
      );
    });

  const renderCustomPill = () => {
    const label = t('contextSizePresetCustom');
    const valueText = showCustom ? formatTokenCount(resolved.tokens) : t('contextSizeAny');
    return renderPill(
      'custom',
      label,
      valueText,
      () => {
        hapticLightPress();
        setCustomOpen(true);
        setCustomText(String(resolved.tokens));
      },
      { a11yLabel: t('contextSizePillA11y', { label, value: valueText }) },
    );
  };

  // ── Adjustment warning (dismissible) ───────────────────────────────────
  const renderAdjustedWarning = () => {
    if (!adjusted) return null;
    const from = formatTokenCount(adjusted.from);
    const to = formatTokenCount(adjusted.to);
    const maxLabel = formatTokenCount(adjusted.max);
    return (
      <View
        testID={CONTEXT_SIZE_ADJUSTED_WARNING_TESTID}
        accessibilityRole="alert"
        style={[
          styles.adjustedChip,
          {
            borderColor: theme.colors.status.warning,
            backgroundColor: theme.colors.status.warning + '14',
          },
        ]}
      >
        <Icon name="alert-outline" size={13} color={theme.colors.status.warning} />
        <ThemedText
          size={11}
          style={[styles.adjustedText, { color: theme.colors.status.warning }]}
        >
          {modelLabel
            ? t('contextSizeAdjusted', { from, to, model: modelLabel, max: maxLabel })
            : t('contextSizeAdjustedGeneric', { from, to, max: maxLabel })}
        </ThemedText>
        <TouchableOpacity
          testID={CONTEXT_SIZE_ADJUSTED_DISMISS_TESTID}
          accessibilityRole="button"
          accessibilityLabel={t('contextSizeAdjustedDismiss')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => setAdjusted(null)}
          style={styles.adjustedDismiss}
        >
          <Icon name="close" size={13} color={theme.colors.status.warning} />
        </TouchableOpacity>
      </View>
    );
  };

  // ── Custom editor ──────────────────────────────────────────────────────
  const renderCustomEditor = () => {
    if (!showCustom) return null;
    const hasError = customError !== null;
    return (
      <View style={styles.customBlock}>
        <View style={styles.customRow}>
          <TextInput
            testID={CONTEXT_SIZE_CUSTOM_INPUT_TESTID}
            accessibilityLabel={t('contextSizeCustomA11y')}
            style={[
              styles.customInput,
              {
                color: theme.colors.text.primary,
                borderColor: hasError ? theme.colors.status.error : theme.colors.border.default,
                backgroundColor: theme.colors.background.base,
              },
            ]}
            value={customText}
            onChangeText={handleCustomText}
            onFocus={() => {
              editingRef.current = true;
            }}
            onBlur={handleCustomBlur}
            keyboardType="number-pad"
            placeholder={t('contextSizeCustomPlaceholder')}
            placeholderTextColor={theme.colors.text.muted}
          />
          <ThemedText size={11} variant="muted">
            {t('contextSizeTokens')}
          </ThemedText>
        </View>

        {customError && (
          <View style={styles.errorRow}>
            <Icon name="alert-circle-outline" size={12} color={theme.colors.status.error} />
            <ThemedText size={11} style={[styles.errorText, { color: theme.colors.status.error }]}>
              {t(customError, {
                max: max === undefined ? '' : formatTokenCount(max),
              })}
            </ThemedText>
            {customError === 'contextSizeErrorAboveMax' && max !== undefined && (
              <TouchableOpacity
                testID={CONTEXT_SIZE_USE_MAX_TESTID}
                accessibilityRole="button"
                accessibilityLabel={t('contextSizeUseMax', { max: formatTokenCount(max) })}
                onPress={() => applyCustom(max)}
              >
                <ThemedText size={11} weight="medium" variant="accent">
                  {t('contextSizeUseMax', { max: formatTokenCount(max) })}
                </ThemedText>
              </TouchableOpacity>
            )}
          </View>
        )}

        <View style={styles.quickChips}>
          {CONTEXT_SIZE_QUICK_CHIPS.map((tokens) => {
            const label = formatTokenCount(tokens);
            const disabled =
              (max !== undefined && tokens > max) || customText === String(tokens);
            return (
              <TouchableOpacity
                key={tokens}
                testID={`context-size-quick-${tokens}`}
                accessibilityRole="button"
                accessibilityLabel={t('contextSizeQuickChipA11y', { value: label })}
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={() => {
                  hapticLightPress();
                  applyCustom(tokens);
                }}
                style={[
                  styles.quickChip,
                  {
                    borderColor: theme.colors.border.default,
                    backgroundColor: theme.colors.background.base,
                  },
                  disabled && styles.quickChipDisabled,
                ]}
              >
                <ThemedText size={11} variant="secondary">
                  {label}
                </ThemedText>
              </TouchableOpacity>
            );
          })}
          {max !== undefined && (
            <TouchableOpacity
              testID="context-size-quick-model-max"
              accessibilityRole="button"
              accessibilityLabel={t('contextSizeQuickModelMaxA11y', {
                value: formatTokenCount(max),
              })}
              accessibilityState={{ disabled: customText === String(max) }}
              disabled={customText === String(max)}
              onPress={() => {
                hapticLightPress();
                applyCustom(max);
              }}
              style={[
                styles.quickChip,
                {
                  borderColor: accent + '55',
                  backgroundColor: accent + '14',
                },
                customText === String(max) && styles.quickChipDisabled,
              ]}
            >
              <ThemedText size={11} variant="accent" weight="medium">
                {t('contextSizeQuickModelMax', { value: formatTokenCount(max) })}
              </ThemedText>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  // ── Module-specific hint (compaction point computed from the selection) ──
  const compaction = formatTokenCount(compactionThreshold(resolved.tokens));
  const hintKey =
    moduleType === 'cognition'
      ? 'contextSizeHintCognition'
      : moduleType === 'movement'
        ? 'contextSizeHintMovement'
        : 'contextSizeHintBackend';

  return (
    <View style={styles.wrap} testID="context-size-select">
      <View style={styles.headerRow}>
        <ThemedText size={13} variant="secondary" style={styles.label}>
          {t('contextSizeLabel')}
        </ThemedText>
        <View
          testID={CONTEXT_SIZE_MAX_BADGE_TESTID}
          style={[styles.maxBadge, { borderColor: theme.colors.border.default }]}
        >
          <ThemedText size={10} variant={max === undefined ? 'muted' : 'secondary'}>
            {max === undefined
              ? t('contextSizeModelMaxUnknown')
              : t('contextSizeModelMax', { value: formatTokenCount(max) })}
          </ThemedText>
        </View>
      </View>

      {renderAdjustedWarning()}

      <View style={styles.pills}>
        {renderPresetPills()}
        {renderCustomPill()}
      </View>

      {renderCustomEditor()}

      <ThemedText
        testID={CONTEXT_SIZE_HINT_TESTID}
        variant="muted"
        size={11}
        style={styles.hint}
      >
        {t(hintKey, { compaction })}
      </ThemedText>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { gap: 8, marginTop: 2 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 2,
  },
  label: { flexShrink: 1 },
  maxBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  // Pills wrap 2–3 per row on a 360 dp screen; 30 % basis + 96 dp min keeps
  // five pills readable without horizontal scrolling.
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pillSlot: {
    flexBasis: '30%',
    flexGrow: 1,
    minWidth: 96,
    minHeight: 58,
    justifyContent: 'flex-end',
  },
  defaultBadge: {
    position: 'absolute',
    top: 0,
    left: 6,
    zIndex: 1,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  pill: {
    borderRadius: 9,
    borderWidth: 1,
    overflow: 'hidden',
  },
  pillSelected: { borderWidth: 0 },
  pillInfeasible: { opacity: 0.45 },
  pillContent: {
    paddingHorizontal: 9,
    paddingVertical: 7,
    margin: 1,
    gap: 1,
  },
  pillContentSelected: { borderRadius: 8 },
  strikethrough: { textDecorationLine: 'line-through' },
  adjustedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  adjustedText: { flex: 1 },
  adjustedDismiss: { padding: 2 },
  customBlock: { gap: 6 },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  customInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 44,
    fontFamily: 'monospace',
    fontVariant: ['tabular-nums'],
  },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  errorText: { flexShrink: 1 },
  quickChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  quickChip: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  quickChipDisabled: { opacity: 0.45 },
  hint: { lineHeight: 15 },
});
