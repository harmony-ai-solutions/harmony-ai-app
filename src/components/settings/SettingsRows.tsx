/**
 * SettingsRows — shared row components for settings screens.
 *
 * Extracted from SettingsScreen.tsx so that the top-level Settings tab and
 * the settings sub-menus (Account, Appearance, AI & Conversation, Help &
 * Support) share one visual language: icon pill + label + optional trailing
 * element, wrapped in a glassmorphism ThemedCard.
 *
 * ## Trailing-value pattern
 *
 * Link rows may surface a short CURRENT VALUE via `value` (e.g. the active STT
 * model, a persona count, a sync authority). It renders as muted 12px text,
 * right-aligned, single-line, capped at ~45% of the row width, and always sits
 * before the optional badge and the chevron. A short expectation/hint can be
 * surfaced as a muted second line under the label via `subtitle`.
 * `SettingsDetailRow` uses the same read-only label/value language (without the
 * chevron) for non-navigating detail lines.
 */
import React from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Switch } from 'react-native-paper';
import { ThemedText } from '../themed/ThemedText';
import { hexToRgba } from '../../utils/colorUtils';
import { hapticLightPress } from '../../utils/haptics';

/** Shared icon pill — used by all settings rows for visual consistency. */
export const SettingsIconPill: React.FC<{
  name: string;
  color: string;
  size?: number;
}> = ({ name, color, size = 16 }) => (
  <View style={[styles.iconPill, { backgroundColor: hexToRgba(color, 0.12) }]}>
    <Icon name={name} size={size} color={color} />
  </View>
);

export interface SettingsRowProps {
  icon: string;
  label: string;
  /** Optional short current value shown muted/right-aligned before the chevron. */
  value?: string;
  /** Optional second line under the label (a short hint/expectation, muted). */
  subtitle?: string;
  onPress?: () => void;
  theme: any;
  badge?: string;
  showSeparator?: boolean;
  /** Dim the row and ignore presses (e.g. while the action is already running). */
  disabled?: boolean;
  /** Show a small spinner in the trailing slot instead of the chevron. */
  loading?: boolean;
  testID?: string;
}

/** Tappable row with chevron — used for navigation links. */
export const SettingsLinkRow: React.FC<SettingsRowProps> = ({
  icon,
  label,
  value,
  subtitle,
  onPress,
  theme,
  badge,
  showSeparator,
  disabled,
  loading,
  testID,
}) => (
  <View>
    {showSeparator && (
      <View
        style={[styles.linkSeparator, { backgroundColor: hexToRgba(theme.colors.border.default, 0.3) }]}
      />
    )}
    <TouchableOpacity
      style={[styles.linkRow, disabled && styles.linkRowDisabled]}
      onPress={() => {
        if (disabled) return;
        hapticLightPress();
        onPress?.();
      }}
      activeOpacity={0.7}
      disabled={disabled}
      accessibilityState={disabled ? { disabled: true } : undefined}
      testID={testID}
    >
      <SettingsIconPill name={icon} color={theme.colors.accent.primary} size={18} />
      {subtitle ? (
        <View style={styles.linkLabelBlock}>
          <ThemedText style={styles.linkLabelBare}>{label}</ThemedText>
          <ThemedText variant="muted" size={12}>
            {subtitle}
          </ThemedText>
        </View>
      ) : (
        <ThemedText style={styles.linkLabel}>{label}</ThemedText>
      )}
      {value ? (
        <ThemedText
          variant="muted"
          size={12}
          numberOfLines={1}
          style={styles.linkValue}
        >
          {value}
        </ThemedText>
      ) : null}
      {badge && (
        <View style={[styles.badgeChip, { backgroundColor: hexToRgba(theme.colors.accent.primary, 0.15) }]}>
          <ThemedText variant="accent" size={11} weight="medium">
            {badge}
          </ThemedText>
        </View>
      )}
      {loading ? (
        <ActivityIndicator size="small" color={theme.colors.text.muted} />
      ) : (
        <Icon name="chevron-right" size={18} color={theme.colors.text.muted} />
      )}
    </TouchableOpacity>
  </View>
);

export interface SettingsToggleRowProps {
  icon: string;
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  theme: any;
  showSeparator?: boolean;
}

/** Row with a Switch — for boolean preferences. */
export const SettingsToggleRow: React.FC<SettingsToggleRowProps> = ({
  icon,
  label,
  value,
  onValueChange,
  theme,
  showSeparator,
}) => (
  <View>
    {showSeparator && (
      <View
        style={[styles.linkSeparator, { backgroundColor: hexToRgba(theme.colors.border.default, 0.3) }]}
      />
    )}
    <View style={styles.toggleRow}>
      <SettingsIconPill name={icon} color={theme.colors.accent.primary} size={18} />
      <ThemedText style={styles.linkLabel}>{label}</ThemedText>
      <Switch value={value} onValueChange={onValueChange} color={theme.colors.accent.primary} />
    </View>
  </View>
);

export interface SettingsDetailRowProps {
  icon: string;
  label: string;
  /** Right-aligned current value — the read-only twin of SettingsLinkRow's
   *  muted 12px trailing-value pattern (no chevron/badge). */
  value?: string;
  valueComponent?: React.ReactNode;
  theme: any;
}

/** Read-only detail row (label on left, value on right). */
export const SettingsDetailRow: React.FC<SettingsDetailRowProps> = ({
  icon,
  label,
  value,
  valueComponent,
  theme,
}) => (
  <View style={styles.detailRow}>
    <View style={styles.detailLabel}>
      <SettingsIconPill name={icon} color={theme.colors.accent.primary} size={16} />
      <ThemedText variant="secondary" size={13}>
        {label}
      </ThemedText>
    </View>
    {valueComponent ? (
      valueComponent
    ) : (
      <ThemedText weight="medium" size={14}>
        {value ?? '—'}
      </ThemedText>
    )}
  </View>
);

const styles = StyleSheet.create({
  /* Icon pill — shared container for all settings icons */
  iconPill: {
    width: 30,
    height: 30,
    borderRadius: 7,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  detailLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  linkRowDisabled: {
    opacity: 0.45,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  linkSeparator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
  },
  linkLabel: {
    flex: 1,
    fontSize: 14,
  },
  linkLabelBlock: {
    flex: 1,
    gap: 2,
  },
  linkLabelBare: {
    fontSize: 14,
  },
  linkValue: {
    flexShrink: 1,
    maxWidth: '45%',
    marginLeft: 8,
    textAlign: 'right',
  },
  badgeChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginRight: 8,
  },
});
