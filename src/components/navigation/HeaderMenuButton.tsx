import React, { useCallback } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { useAppTheme } from '../../contexts/ThemeContext';
import { hexToRgba } from '../../utils/colorUtils';
import { hapticLightPress } from '../../utils/haptics';

/**
 * HeaderMenuButton — "three lines" (☰) hamburger menu button.
 *
 * Renders a compact obsidian-glass circular button containing three
 * horizontal accent lines. Tapping it opens the full Settings screen
 * (pushed over the tabs from the root stack).
 *
 * Intended for the header of every top-level tab screen now that the
 * Settings entry has been moved out of the bottom tab bar.
 */
export const HeaderMenuButton: React.FC = () => {
  const { theme } = useAppTheme();
  const navigation = useNavigation<any>();

  const handlePress = useCallback(() => {
    hapticLightPress();
    navigation.navigate('Settings');
  }, [navigation]);

  if (!theme) return null;

  const accentPrimary = theme.colors.accent.primary;
  const baseHex = theme.colors.background.base;

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.7}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityLabel="Settings"
      accessibilityRole="button"
      testID="header-menu-button"
      style={[styles.button, { backgroundColor: hexToRgba(baseHex, 0.75) }]}
    >
      {/* Prismatic glass tint (same style as ChatList header actions) */}
      <LinearGradient
        colors={[accentPrimary + '18', 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* ── Three lines ── */}
      <View style={styles.lines}>
        <View style={[styles.line, { backgroundColor: accentPrimary }]} />
        <View style={[styles.line, { backgroundColor: accentPrimary }]} />
        <View style={[styles.line, { backgroundColor: accentPrimary }]} />
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
  },
  lines: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  line: {
    width: 16,
    height: 2,
    borderRadius: 1,
  },
});

export default HeaderMenuButton;
