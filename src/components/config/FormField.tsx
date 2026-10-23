import React, { useState } from 'react';
import {
  View,
  TextInput,
  Switch,
  TouchableOpacity,
  Pressable,
  StyleSheet,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { FieldDefinition } from '../../constants/providerFieldSchemas';
import { clampToField, isCompleteNumber } from '../../utils/numericField';
import { hapticLightPress } from '../../utils/haptics';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { SelectPicker } from './SelectPicker';

interface FormFieldProps {
  field: FieldDefinition;
  value: any;
  onChange: (key: string, value: any) => void;
  /**
   * Render the field as read-only. For password fields this also hides the
   * reveal-eye and disables selection/copy so the value cannot be exposed.
   */
  readOnly?: boolean;
  /** Optional testID forwarded to the field's input (text/number/comma-list). */
  testID?: string;
}

export const FormField: React.FC<FormFieldProps> = ({ field, value, onChange, readOnly = false, testID }) => {
  const { theme } = useAppTheme();
  const [showPassword, setShowPassword] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);
  // Raw text being typed into a number field (null = not focused). The draft
  // exists so intermediate states ('', '0.', '-', '1e') never hit parseFloat:
  // per-keystroke parseFloat over a controlled input ate decimal separators
  // ('0' + '.' + '7' became 7) and bricked fields on NaN.
  const [draft, setDraft] = useState<string | null>(null);

  if (!theme) return null;

  /** Commit a parsed, clamped number for a COMPLETE numeric draft. */
  const commitNumber = (text: string) => {
    if (isCompleteNumber(text)) {
      onChange(field.key, clampToField(parseFloat(text), field));
    }
  };

  /**
   * Number typing: update the draft; commit only complete numbers (clamped to
   * the field's declared min/max/step). Clearing commits the sentinel
   * (unlimited/random/auto) or null. Partial/garbage drafts keep the last
   * committed value until blur reverts or completes them.
   */
  const handleNumberChange = (text: string) => {
    setDraft(text);
    if (text === '') {
      onChange(field.key, field.disabledValue !== undefined ? field.disabledValue : null);
    } else {
      commitNumber(text);
    }
  };

  /** Blur: finalize the draft — complete commits, partial/garbage reverts. */
  const finalizeNumber = () => {
    if (draft === null) return;
    const text = draft;
    setDraft(null);
    if (text.trim() !== '') commitNumber(text);
  };

  const handleChange = (text: string) => {
    if (field.type === 'number') {
      handleNumberChange(text);
      return;
    }
    onChange(field.key, text);
  };

  /** Numeric display value, hiding the sentinel so the placeholder shows. */
  const numericDisplayValue = (): string => {
    if (draft !== null) return draft;
    if (value === null || value === undefined || value === '') return '';
    if (field.disabledValue !== undefined && Number(value) === field.disabledValue) {
      return '';
    }
    return value.toString();
  };

  // ── Bounded numeric slider (TTS / VAD acoustic & prosody sliders in File 3) ──
  const SLIDER_FIELD_KEYS: ReadonlySet<string> = new Set([
    'speed',
    'pitch',
    'energy',
    'exaggeration',
    'cfg_weight',
    'stability',
    'similarity_boost',
    'style',
    'threshold',
  ]);
  const isBoundedSlider =
    field.type === 'number' &&
    SLIDER_FIELD_KEYS.has(field.key) &&
    field.min !== undefined &&
    field.max !== undefined &&
    field.step !== undefined;

  if (isBoundedSlider) {
    const min = field.min as number;
    const max = field.max as number;
    const step = field.step as number;
    const range = max - min;
    const raw = Number(value);
    const hasValue =
      value !== null &&
      value !== undefined &&
      value !== '' &&
      Number.isFinite(raw) &&
      !(field.disabledValue !== undefined && raw === field.disabledValue);
    const placeholderNum = field.placeholder ? parseFloat(field.placeholder) : NaN;
    const defaultVal = Number.isFinite(placeholderNum) ? placeholderNum : (min + max) / 2;
    const numVal = hasValue ? raw : defaultVal;
    const pct = range === 0 ? 0 : Math.max(0, Math.min(100, ((numVal - min) / range) * 100));
    const precision = (() => {
      const text = String(step);
      if (text.includes('e-')) {
        return Math.max(0, -Math.floor(Math.log10(step)));
      }
      return (text.split('.')[1] ?? '').length;
    })();
    const round = (next: number): number => {
      const clamped = Math.min(max, Math.max(min, next));
      return Number(clamped.toFixed(precision));
    };
    const updateFromLocationX = (locationX: number) => {
      if (readOnly || trackWidth <= 0) return;
      const ratio = Math.max(0, Math.min(1, locationX / trackWidth));
      onChange(field.key, round(min + ratio * range));
    };

    return (
      <View style={styles.sliderBox} testID={testID ? `${testID}-box` : undefined}>
        <View style={styles.sliderTop}>
          <ThemedText size={11} numberOfLines={1} style={styles.sliderLabel}>
            {field.label}
          </ThemedText>
          <TextInput
            style={styles.sliderValueInput}
            value={numericDisplayValue()}
            onChangeText={handleChange}
            onBlur={finalizeNumber}
            placeholder={field.placeholder}
            keyboardType="decimal-pad"
            editable={!readOnly}
            placeholderTextColor="#E879F9"
            testID={testID}
          />
        </View>
        <Pressable
          style={styles.sliderTrackPress}
          onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
          onPress={(event) => {
            hapticLightPress();
            updateFromLocationX(event.nativeEvent.locationX);
          }}
          accessibilityRole="adjustable"
          accessibilityLabel={field.label}
          testID={testID ? `${testID}-track` : undefined}
        >
          <View style={styles.sliderTrack}>
            <LinearGradient
              colors={['#A855F7', '#E879F9']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.sliderFill, { width: `${pct}%` }]}
            />
          </View>
        </Pressable>
      </View>
    );
  }

  // ── Boolean / numeric toggle row (label left, Switch right) ──
  if (field.type === 'toggle') {
    const numeric = field.toggleValueType === 'numeric';
    const isOn = numeric ? Boolean(Number(value)) : value === true;
    return (
      <View style={styles.toggleRow} testID={testID ? `${testID}-row` : undefined}>
        <View style={styles.toggleLabelWrap}>
          <View style={styles.labelRow}>
            <ThemedText size={13} variant="secondary" style={styles.label}>
              {field.label}
            </ThemedText>
            {field.required && (
              <ThemedText size={13} style={{ color: theme.colors.status.error }}>
                *
              </ThemedText>
            )}
          </View>
          {field.tooltip && (
            <ThemedText variant="muted" size={11} style={styles.toggleTooltip}>
              {field.tooltip}
            </ThemedText>
          )}
        </View>
        <Switch
          value={isOn}
          disabled={readOnly}
          onValueChange={(val) => onChange(field.key, numeric ? (val ? 1 : 0) : val)}
          trackColor={{ false: theme.colors.border.default, true: theme.colors.accent.primary }}
          testID={testID}
        />
      </View>
    );
  }

  const renderInput = () => {
    switch (field.type) {
      case 'password':
        if (readOnly) {
          // Managed credential (e.g. injected cloud PASETO) — mask, lock, and
          // block selection so the value can't be copied or edited.
          return (
            <TextInput
              style={[
                styles.input,
                {
                  color: theme.colors.text.muted,
                  borderColor: theme.colors.border.default,
                  backgroundColor: theme.colors.background.base,
                },
              ]}
              value={value?.toString() || ''}
              editable={false}
              selectTextOnFocus={false}
              secureTextEntry
              contextMenuHidden
              placeholder={field.placeholder}
              placeholderTextColor={theme.colors.text.muted}
              testID={testID}
            />
          );
        }
        return (
          <View style={styles.passwordContainer}>
            <TextInput
              style={[
                styles.input,
                styles.passwordInput,
                {
                  color: theme.colors.text.primary,
                  borderColor: theme.colors.border.default,
                  backgroundColor: theme.colors.background.base,
                },
              ]}
              value={value?.toString() || ''}
              onChangeText={handleChange}
              placeholder={field.placeholder}
              secureTextEntry={!showPassword}
              placeholderTextColor={theme.colors.text.muted}
              testID={testID}
            />
            <TouchableOpacity
              style={styles.eyeButton}
              onPress={() => {
                hapticLightPress();
                setShowPassword(!showPassword);
              }}
            >
              <Icon
                name={showPassword ? 'eye-off' : 'eye'}
                size={18}
                color={theme.colors.text.muted}
              />
            </TouchableOpacity>
          </View>
        );
      
      case 'number':
        return (
          <TextInput
            style={[
              styles.input,
              {
                color: theme.colors.text.primary,
                borderColor: theme.colors.border.default,
                backgroundColor: theme.colors.background.base,
              },
            ]}
            value={numericDisplayValue()}
            onChangeText={handleChange}
            onBlur={finalizeNumber}
            placeholder={field.placeholder}
            keyboardType="decimal-pad"
            editable={!readOnly}
            placeholderTextColor={theme.colors.text.muted}
            testID={testID}
          />
        );
      
      case 'chips':
        return (
          <View style={styles.chipRow} testID={testID}>
            {(field.options ?? []).map((option) => {
              const selected = String(value ?? '') === option.id;
              return (
                <TouchableOpacity
                  key={`${field.key}-${option.id || 'default'}`}
                  style={[
                    styles.chip,
                    {
                      borderColor: selected
                        ? theme.colors.accent.primary
                        : theme.colors.border.default,
                      backgroundColor: selected
                        ? theme.colors.accent.primary + '1A'
                        : theme.colors.background.base,
                    },
                  ]}
                  onPress={() => {
                    if (readOnly) return;
                    hapticLightPress();
                    onChange(field.key, option.id);
                  }}
                  disabled={readOnly}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <ThemedText size={12} variant={selected ? 'accent' : 'secondary'}>
                    {option.name}
                  </ThemedText>
                </TouchableOpacity>
              );
            })}
          </View>
        );

      case 'checkbox':
        return (
          <Switch
            value={value === true}
            disabled={readOnly}
            onValueChange={(val) => onChange(field.key, val)}
            trackColor={{ false: theme.colors.border.default, true: theme.colors.accent.primary }}
          />
        );
      
      case 'comma-list': {
        const rawListVal = value?.toString() || '';
        const listDisplayVal = rawListVal === '{}' ? '' : rawListVal;
        return (
          <TextInput
            style={[
              styles.input,
              {
                color: theme.colors.text.primary,
                borderColor: theme.colors.border.default,
                backgroundColor: theme.colors.background.base,
              },
            ]}
            value={listDisplayVal}
            onChangeText={(text) => onChange(field.key, text)}
            placeholder={field.placeholder}
            editable={!readOnly}
            placeholderTextColor={theme.colors.text.muted}
            testID={testID}
          />
        );
      }
      
      case 'select':
        return (
          <SelectPicker
            label={field.label}
            value={value?.toString() ?? ''}
            options={field.options ?? []}
            onChange={(v) => onChange(field.key, v)}
            placeholder={field.placeholder}
          />
        );
      
      default:
        return (
          <TextInput
            style={[
              styles.input,
              {
                color: theme.colors.text.primary,
                borderColor: theme.colors.border.default,
                backgroundColor: theme.colors.background.base,
              },
            ]}
            value={value?.toString() || ''}
            onChangeText={handleChange}
            placeholder={field.placeholder}
            editable={!readOnly}
            placeholderTextColor={theme.colors.text.muted}
            testID={testID}
          />
        );
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        <ThemedText size={12} variant="secondary" style={styles.label}>
          {field.label}
        </ThemedText>
        {field.required && !field.label.trim().endsWith('*') && (
          <ThemedText size={12} style={{ color: theme.colors.status.error }}>
            *
          </ThemedText>
        )}
      </View>
      {field.tooltip && (
        <ThemedText variant="muted" size={11} style={styles.tooltip}>
          {field.tooltip}
        </ThemedText>
      )}
      {renderInput()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 8,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  label: {
    marginRight: 4,
  },
  tooltip: {
    marginBottom: 4,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 12,
  },
  toggleLabelWrap: {
    flex: 1,
  },
  toggleTooltip: {
    marginTop: -2,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 11,
    paddingVertical: 8,
    fontSize: 13.5,
    minHeight: 38,
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  passwordInput: {
    flex: 1,
    paddingRight: 44,
  },
  eyeButton: {
    position: 'absolute',
    right: 12,
    padding: 4,
  },

  // ── Bounded numeric slider box (File 3 `slider-box`) ──
  sliderBox: {
    backgroundColor: '#070B14',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.16)',
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 7,
    gap: 5,
  },
  sliderTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sliderLabel: {
    color: '#CBD5E1',
    fontWeight: '600',
    flexShrink: 1,
  },
  sliderValueInput: {
    color: '#E879F9',
    fontFamily: 'monospace',
    fontSize: 11.5,
    fontWeight: '700',
    padding: 0,
    minWidth: 36,
    textAlign: 'right',
  },
  sliderControlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  sliderStepButton: {
    width: 22,
    height: 20,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(148, 163, 184, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.16)',
  },
  sliderStepText: {
    color: '#CBD5E1',
    fontWeight: '700',
    lineHeight: 14,
  },
  sliderTrackPress: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 3,
  },
  sliderTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(148, 163, 184, 0.2)',
    overflow: 'hidden',
    width: '100%',
  },
  sliderFill: {
    height: '100%',
    borderRadius: 999,
  },
});
