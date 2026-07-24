import React from 'react';
import { View, StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from './ThemedText';
import { ThemedGradient } from './ThemedGradient';

interface ScreenHeaderProps {
  /** Page title displayed in 24px bold */
  title: string;
  /** Optional muted subtitle below the title */
  subtitle?: string;
  /** If provided, renders a back arrow that calls this on press */
  onBack?: () => void;
  /** Optional element(s) rendered left of the title (e.g. avatar) */
  left?: React.ReactNode;
  /** Optional element(s) rendered inline immediately after the title text */
  titleRight?: React.ReactNode;
  /** Optional element(s) rendered to the right of the title row */
  right?: React.ReactNode;
  /** Optional element(s) rendered between the subtitle and content (e.g. search bar) */
  children?: React.ReactNode;
  /** Additional style for the outermost wrapper */
  style?: ViewStyle;
  /** Additional style for the inner content area (below accent stripe) */
  contentStyle?: ViewStyle;
}

/**
 * ScreenHeader — Discover/Search inspired page header.
 *
 * Renders a gradient accent stripe, a large bold title, an optional
 * muted subtitle, and optional back/right controls. Designed to replace
 * the heavier ThemedAppbar with a cleaner, content-first aesthetic.
 *
 * Safe-area top inset is applied automatically so the header can be
 * used as a fixed top bar or as the first element in a ScrollView
 * (set `applySafeTop={false}` via style override in that case).
 */
export const ScreenHeader: React.FC<ScreenHeaderProps> = ({
  title,
  subtitle,
  onBack,
  left,
  titleRight,
  right,
  children,
  style,
  contentStyle,
}) => {
  const { theme } = useAppTheme();
  const { top: safeTop } = useSafeAreaInsets();

  if (!theme) return null;

  return (
    <View style={[styles.wrapper, { paddingTop: safeTop + 12 }, style]}>
      {/* ── Gradient accent stripe ── */}
      <ThemedGradient gradient="primary" style={styles.accentStripe} />

      <View style={[styles.content, contentStyle]}>
        {/* ── Title row ── */}
        <View style={styles.titleRow}>
          {onBack && (
            <TouchableOpacity
              onPress={onBack}
              style={styles.backButton}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Go back"
              accessibilityRole="button"
            >
              <Icon
                name="arrow-left"
                size={24}
                color={theme.colors.text.primary}
              />
            </TouchableOpacity>
          )}

          {left && <View style={styles.leftSlot}>{left}</View>}

          <View style={styles.titleGroup}>
            <ThemedText
              variant="primary"
              size={24}
              weight="bold"
              hierarchy="header"
            >
              {title}
            </ThemedText>
            {titleRight && <View style={styles.titleRightSlot}>{titleRight}</View>}
          </View>

          <View style={styles.spacer} />

          {right && <View style={styles.rightSlot}>{right}</View>}
        </View>

        {/* ── Subtitle ── */}
        {subtitle && (
          <ThemedText
            variant="muted"
            size={13}
            hierarchy="subtext"
            style={styles.subtitle}
          >
            {subtitle}
          </ThemedText>
        )}

        {/* ── Injected children (e.g. search bar, extra controls) ── */}
        {children}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  accentStripe: {
    height: 3,
    borderRadius: 2,
    marginBottom: 16,
    width: 40,
  },
  content: {
    // Spacer for inner content
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    marginRight: 12,
    paddingVertical: 2,
  },
  titleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  spacer: {
    flex: 1,
  },
  titleRightSlot: {
    flexShrink: 0,
  },
  subtitle: {
    marginTop: 4,
    marginBottom: 12,
  },
  leftSlot: {
    marginRight: 10,
    flexShrink: 0,
  },
  rightSlot: {
    marginLeft: 12,
    flexShrink: 0,
  },
});

export default ScreenHeader;
