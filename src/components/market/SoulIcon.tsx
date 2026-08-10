/**
 * SoulIcon — Professional glowing "S" currency monogram.
 *
 * A dependency-free, professional currency mark for the "Soul" currency,
 * rendered with pure React Native primitives (no react-native-svg):
 *  - A round, softly glowing gradient orb in the theme accent color
 *  - A crisp white "S" letterform centered in the orb (clean monogram style)
 *  - A subtle glossy specular highlight + ambient glow halo
 *
 * The monogram keeps the brand recognizable at any size — from the tiny
 * balance badge (18 dp) to hero cards (64 dp+).
 */

import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { useAppTheme } from '../../contexts/ThemeContext';
import { hexToRgba } from '../../utils/colorUtils';

interface SoulIconProps {
  /** Diameter of the icon in dp (default 24) */
  size?: number;
  /** Optional style overrides for the outer wrapper */
  style?: ViewStyle;
  /** Tint override — defaults to the theme accent primary */
  color?: string;
}

export const SoulIcon: React.FC<SoulIconProps> = ({
  size = 24,
  style,
  color,
}) => {
  const { theme } = useAppTheme();
  const accent = color ?? theme?.colors.accent.primary ?? '#8f3ba7';

  // ── Derived shapes (fractions of the icon size) ───────────────────────
  const bodySize = size * 0.84;
  const highlightSize = size * 0.30;
  const highlightOffset = -size * 0.22;
  const highlightLeft = (bodySize - highlightSize) / 2;

  return (
    <View
      style={[
        styles.wrapper,
        { width: size, height: size },
        style,
      ]}
      accessibilityLabel="Soul"
      accessibilityRole="image"
    >
      {/* ── Ambient glow halo ── */}
      <View
        style={[
          styles.glow,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: hexToRgba(accent, 0.30),
            transform: [{ scale: 1.15 }],
          },
        ]}
      />

      {/* ── Orb body ── */}
      <View
        style={[
          styles.body,
          {
            width: bodySize,
            height: bodySize,
            borderRadius: bodySize / 2,
            backgroundColor: accent,
          },
        ]}
      >
        {/* ── Top specular highlight (gloss) ── */}
        <View
          style={[
            styles.highlight,
            {
              width: highlightSize,
              height: highlightSize * 0.45,
              borderRadius: highlightSize / 2,
              left: highlightLeft,
              top: highlightOffset,
            },
          ]}
        />

        {/* ── "S" letterform ── */}
        <Text
          style={[
            styles.letter,
            {
              fontSize: size * 0.48,
              lineHeight: size * 0.52,
            },
          ]}
          allowFontScaling={false}
        >
          S
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
  },
  body: {
    alignItems: 'center',
    justifyContent: 'center',
    // Soft shadow for the orb
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 4,
  },
  highlight: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
  },
  letter: {
    color: '#ffffff',
    fontWeight: '800',
    fontFamily: 'System',
    letterSpacing: -1,
    includeFontPadding: false,
  },
});

export default SoulIcon;
