/**
 * ThemedEmptyState — app-wide "nothing here yet" / 0-results state.
 *
 * Mirrors the Market screen's premium empty-state design:
 *   - Gradient icon ring (primary gradient) with an elevated inner circle
 *   - Bold title + muted hint subtext
 *   - Optional action node (e.g. a ThemedButton) rendered below the text
 *
 * Used everywhere a list/search can come up empty so the whole app shares
 * one consistent, polished empty state.
 */

import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedView } from './ThemedView';
import { ThemedText } from './ThemedText';
import { ThemedGradient } from './ThemedGradient';

interface ThemedEmptyStateProps {
  /** MaterialCommunityIcons name shown inside the gradient ring */
  icon: string;
  /** Primary title text */
  title: string;
  /** Optional muted hint/subtext below the title */
  subtitle?: string;
  /** Optional action rendered below the subtitle (e.g. ThemedButton) */
  action?: React.ReactNode;
  /** Extra styles applied to the outer container */
  style?: ViewStyle;
  /** Render smaller — used in compact/inline contexts (e.g. emoji picker) */
  compact?: boolean;
  /** Forwarded to the outer View for E2E/test queries */
  testID?: string;
  /** Forwarded to the outer View for screen readers */
  accessibilityLabel?: string;
}

export const ThemedEmptyState: React.FC<ThemedEmptyStateProps> = ({
  icon,
  title,
  subtitle,
  action,
  style,
  compact = false,
  testID,
  accessibilityLabel,
}) => {
  const { theme } = useAppTheme();

  if (!theme) return null;

  const iconSize = compact ? 28 : 40;
  const ringSize = compact ? 60 : 84;
  const innerSize = compact ? 54 : 76;
  const radius = ringSize / 2;

  return (
    <View
      style={[styles.container, compact && styles.containerCompact, style]}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
    >
      <View style={[styles.iconWrap, compact && styles.iconWrapCompact]}>
        <ThemedGradient gradient="primary" style={[styles.iconRing, { width: ringSize, height: ringSize, borderRadius: radius }]}>
          <ThemedView variant="elevated" style={[styles.iconInner, { width: innerSize, height: innerSize, borderRadius: innerSize / 2 }]}>
            <Icon name={icon} size={iconSize} color={theme.colors.accent.primary} />
          </ThemedView>
        </ThemedGradient>
      </View>
      <ThemedText
        variant="primary"
        size={compact ? 16 : 18}
        weight="bold"
        hierarchy="header"
        style={styles.title}
      >
        {title}
      </ThemedText>
      {subtitle ? (
        <ThemedText
          variant="muted"
          size={compact ? 13 : 14}
          hierarchy="subtext"
          style={[styles.subtext, compact && styles.subtextCompact]}
        >
          {subtitle}
        </ThemedText>
      ) : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 64,
    paddingHorizontal: 24,
    gap: 8,
  },
  containerCompact: {
    paddingTop: 32,
    paddingHorizontal: 16,
  },
  iconWrap: { marginBottom: 8 },
  iconWrapCompact: { marginBottom: 6 },
  iconRing: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconInner: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { textAlign: 'center' },
  subtext: { textAlign: 'center', lineHeight: 20 },
  subtextCompact: { lineHeight: 18 },
  action: {
    marginTop: 8,
    alignSelf: 'stretch',
  },
});

export default ThemedEmptyState;
