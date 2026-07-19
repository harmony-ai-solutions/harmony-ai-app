/**
 * GlassTabBar — Floating Obsidian Glass Navigation Bar
 *
 * A premium pill-shaped bottom navigation bar with:
 *  - Semi-transparent dark glass background (50% opacity)
 *  - Animated neon magenta/indigo top accent indicator
 *  - Glowing active icon with ambient light cast
 *  - Dimmed silver-grey inactive icons
 *  - Spring-animated indicator slide between tabs
 *  - Floating detachment from screen edges
 */

import React, { useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';
import { useAppTheme } from '../../contexts/ThemeContext';
import { hexToRgba } from '../../utils/colorUtils';

// ── Layout constants ────────────────────────────────────────────────────────
const TAB_BAR_MARGIN_H = 20;
const TAB_BAR_MARGIN_BOTTOM = 32;
const TAB_BAR_RADIUS = 28;
const TAB_BAR_HEIGHT = 72;
const INDICATOR_HEIGHT = 3;
const INDICATOR_WIDTH = 28;
const INDICATOR_RADIUS = 2;
const ICON_SIZE = 24;
const LABEL_SIZE = 10;

// ── Tab icon mapping (Material Community Icons) ─────────────────────────────
const TAB_ICONS: Record<string, { default: string; focused: string }> = {
  Discover: { default: 'compass-outline', focused: 'compass' },
  Search: { default: 'magnify', focused: 'magnify' },
  Chat: { default: 'chat-processing-outline', focused: 'chat-processing' },
  Characters: { default: 'account-group-outline', focused: 'account-group' },
  Settings: { default: 'cog-outline', focused: 'cog' },
};

// ── Fallback labels (overridable via navigator options.tabBarLabel) ─────────
const FALLBACK_LABELS: Record<string, string> = {
  Discover: 'Discover',
  Search: 'Search',
  Chat: 'Chat',
  Characters: 'Characters',
  Settings: 'Settings',
};

// ── Component ───────────────────────────────────────────────────────────────
export const GlassTabBar: React.FC<BottomTabBarProps> = ({
  state,
  descriptors,
  navigation,
}) => {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const screenWidth = Dimensions.get('window').width;

  /** Computed pill width accounting for horizontal margins */
  const pillWidth = screenWidth - TAB_BAR_MARGIN_H * 2;
  /** Width of each individual tab column */
  const tabWidth = pillWidth / Math.max(state.routes.length, 1);

  // ── Animated values ────────────────────────────────────────────────────
  const translateX = useRef(new Animated.Value(0)).current;
  const scalePulse = useRef(new Animated.Value(1)).current;

  // ── Early exit if theme not loaded ─────────────────────────────────────
  if (!theme) return null;

  // ── Derived colors from theme ──────────────────────────────────────────
  const baseHex = theme.colors.background.base;
  const accentPrimary = theme.colors.accent.primary;
  const accentSecondary = theme.colors.accent.secondary;
  const textPrimary = theme.colors.text.primary;
  const textMuted = theme.colors.text.muted;

  /** Glass background: deep gothic charcoal at ~50% opacity */
  const glassBg = hexToRgba(baseHex, 0.50);

  // ── Animate indicator on active-tab change ─────────────────────────────
  useEffect(() => {
    const activeIndex = state.index;
    // Center the indicator within its tab column
    const targetX = tabWidth * activeIndex + (tabWidth - INDICATOR_WIDTH) / 2;

    Animated.spring(translateX, {
      toValue: targetX,
      useNativeDriver: true,
      tension: 80,
      friction: 10,
    }).start();

    // Quick scale pulse for tactile feedback
    Animated.sequence([
      Animated.timing(scalePulse, {
        toValue: 1.35,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.spring(scalePulse, {
        toValue: 1,
        useNativeDriver: true,
        tension: 180,
        friction: 8,
      }),
    ]).start();
  }, [state.index, tabWidth]);

  // ── Tab press handler ──────────────────────────────────────────────────
  const handlePress = useCallback(
    (routeKey: string, routeName: string, isFocused: boolean) => {
      const event = navigation.emit({
        type: 'tabPress',
        target: routeKey,
        canPreventDefault: true,
      });

      if (!isFocused && !event.defaultPrevented) {
        navigation.navigate(routeName);
      }
    },
    [navigation],
  );

  /** Distance from bottom screen edge including safe-area inset */
  const bottom = TAB_BAR_MARGIN_BOTTOM + insets.bottom;

  return (
    <View
      style={[
        styles.wrapper,
        {
          bottom,
          left: TAB_BAR_MARGIN_H,
          right: TAB_BAR_MARGIN_H,
          height: TAB_BAR_HEIGHT,
        },
      ]}
      pointerEvents="box-none"
    >
      {/* ── Ambient glow aura behind the pill ──────────────────────────── */}
      <View
        style={[
          styles.glowAura,
          {
            backgroundColor: hexToRgba(accentPrimary, 0.06),
            shadowColor: accentPrimary,
          },
        ]}
      />

      {/* ── Main pill container ────────────────────────────────────────── */}
      <View
        style={[
          styles.pill,
          {
            backgroundColor: glassBg,
            borderRadius: TAB_BAR_RADIUS,
            borderColor: hexToRgba(accentSecondary, 0.15),
          },
        ]}
      >
        {/* ── Active indicator glow layer (wide, soft) ───────────────── */}
        <Animated.View
          style={[
            styles.indicatorGlow,
            {
              left: 0,
              width: INDICATOR_WIDTH,
              transform: [{ translateX }],
            },
          ]}
        >
          <LinearGradient
            colors={[
              hexToRgba(accentPrimary, 0.35),
              hexToRgba(accentSecondary, 0.15),
              'transparent',
            ]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        {/* ── Active indicator line (crisp, neon gradient) ────────────── */}
        <Animated.View
          style={[
            styles.indicatorLine,
            {
              left: 0,
              width: INDICATOR_WIDTH,
              transform: [{ translateX }, { scaleX: scalePulse }],
            },
          ]}
        >
          <LinearGradient
            colors={[accentPrimary, accentSecondary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        {/* ── Tab buttons row ─────────────────────────────────────────── */}
        <View style={styles.tabsRow}>
          {state.routes.map((route, index) => {
            const { options } = descriptors[route.key];
            const isFocused = state.index === index;

            const iconSet = TAB_ICONS[route.name] ?? TAB_ICONS.Discover;
            const iconName = isFocused ? iconSet.focused : iconSet.default;
            const iconColor = isFocused ? textPrimary : textMuted;

            const label =
              (typeof options.tabBarLabel === 'string'
                ? options.tabBarLabel
                : undefined) ??
              options.title ??
              FALLBACK_LABELS[route.name] ??
              route.name;

            return (
              <TouchableOpacity
                key={route.key}
                accessibilityRole="button"
                accessibilityState={isFocused ? { selected: true } : {}}
                accessibilityLabel={options.tabBarAccessibilityLabel}
                testID={options.tabBarButtonTestID}
                onPress={() => handlePress(route.key, route.name, isFocused)}
                activeOpacity={0.7}
                style={styles.tabItem}
              >
                {/* Ambient glow dot behind active icon */}
                {isFocused && (
                  <View
                    style={[
                      styles.activeIconGlow,
                      {
                        backgroundColor: hexToRgba(accentPrimary, 0.22),
                      },
                    ]}
                  />
                )}

                <MaterialCommunityIcons
                  name={iconName}
                  size={ICON_SIZE}
                  color={iconColor}
                  style={styles.icon}
                />

                {/* Label — always visible, dimmed when inactive */}
                <Animated.Text
                  style={[
                    styles.label,
                    {
                      color: isFocused ? textPrimary : textMuted,
                      opacity: isFocused ? 1 : 0.5,
                    },
                  ]}
                  numberOfLines={1}
                >
                  {label}
                </Animated.Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
};

// ── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  /** Absolutely-positioned wrapper that floats the pill above the bottom edge */
  wrapper: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    // Slight elevation for Android shadow
    elevation: 12,
  },
  /** Ambient glow aura — a blurred halo behind the pill for luminous depth */
  glowAura: {
    position: 'absolute',
    top: -8,
    left: 10,
    right: 10,
    bottom: -8,
    borderRadius: TAB_BAR_RADIUS + 8,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 16,
    elevation: 8,
  },
  /** The main pill container with glass background and border */
  pill: {
    flex: 1,
    width: '100%',
    flexDirection: 'column',
    overflow: 'visible',
    borderWidth: 1,
    // Shadow for iOS
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  /** Row of tab touch targets filling the pill horizontally */
  tabsRow: {
    flex: 1,
    flexDirection: 'row',
  },
  /** Individual tab touch target — equal-width column */
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 6,
  },
  /** Icon wrapper — consistent sizing */
  icon: {
    marginBottom: 2,
  },
  /** Icon glow dot — a soft radial highlight behind the active icon */
  activeIconGlow: {
    position: 'absolute',
    top: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    // Shadow for the glow effect
    shadowColor: '#b84fd0',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 4,
  },
  /** Tab label text below the icon */
  label: {
    fontSize: LABEL_SIZE,
    fontWeight: '600',
    letterSpacing: 0.3,
    textAlign: 'center',
    marginTop: 1,
  },
  /** Active indicator line — positioned at top edge of pill, slides via translateX */
  indicatorLine: {
    position: 'absolute',
    top: 0,
    height: INDICATOR_HEIGHT,
    borderRadius: INDICATOR_RADIUS,
    overflow: 'hidden',
    zIndex: 10,
  },
  /** Indicator glow layer — wider + taller soft gradient that bleeds below the line */
  indicatorGlow: {
    position: 'absolute',
    top: -2,
    height: 20,
    borderRadius: INDICATOR_RADIUS,
    overflow: 'hidden',
    zIndex: 5,
  },
});

export default GlassTabBar;
