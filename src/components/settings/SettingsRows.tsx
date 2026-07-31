/**
 * SettingsRows — shared row components for settings screens.
 *
 * Extracted from SettingsScreen.tsx so that the top-level Settings tab and
 * the settings sub-menus (Account, Appearance, AI & Conversation, Help &
 * Support) share one visual language: icon pill + label + optional trailing
 * element, wrapped in a glassmorphism ThemedCard.
 */
import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Switch } from 'react-native-paper';
import { ThemedText } from '../themed/ThemedText';
import { hexToRgba } from '../../utils/colorUtils';

/** Shared icon pill — used by all settings rows for visual consistency. */
export const SettingsIconPill: React.FC<{
  name: string;
  color: string;
  size?: number;
}> = ({ name, color, size = 18 }) => (
  <View style={[styles.iconPill, { backgroundColor: hexToRgba(color, 0.12) }]}>
    <Icon name={name} size={size} color={color} />
  </View>
);

export interface SettingsRowProps {
  icon: string;
  label: string;
  onPress?: () => void;
  theme: any;
  badge?: string;
  showSeparator?: boolean;
}

/** Tappable row with chevron — used for navigation links. */
export const SettingsLinkRow: React.FC<SettingsRowProps> = ({
  icon,
  label,
  onPress,
  theme,
  badge,
  showSeparator,
}) => (
  <View>
    {showSeparator && (
      <View
        style={[styles.linkSeparator, { backgroundColor: hexToRgba(theme.colors.border.default, 0.3) }]}
      />
    )}
    <TouchableOpacity style={styles.linkRow} onPress={onPress} activeOpacity={0.7}>
      <SettingsIconPill name={icon} color={theme.colors.accent.primary} size={20} />
      <ThemedText style={styles.linkLabel}>{label}</ThemedText>
      {badge && (
        <View style={[styles.badgeChip, { backgroundColor: hexToRgba(theme.colors.accent.primary, 0.15) }]}>
          <ThemedText variant="accent" size={11} weight="medium">
            {badge}
          </ThemedText>
        </View>
      )}
      <Icon name="chevron-right" size={20} color={theme.colors.text.muted} />
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
      <SettingsIconPill name={icon} color={theme.colors.accent.primary} size={20} />
      <ThemedText style={styles.linkLabel}>{label}</ThemedText>
      <Switch value={value} onValueChange={onValueChange} color={theme.colors.accent.primary} />
    </View>
  </View>
);

export interface SettingsDetailRowProps {
  icon: string;
  label: string;
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
    width: 34,
    height: 34,
    borderRadius: 8,
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
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  linkSeparator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
  },
  linkLabel: {
    flex: 1,
    fontSize: 15,
  },
  badgeChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginRight: 8,
  },
});
