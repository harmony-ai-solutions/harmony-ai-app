import React, { memo, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Theme } from '../../theme/types';
import { EmojiSet } from '../../types/emoji';
import EmojiText from '../emoji/EmojiText';
import EmojiService from '../../services/EmojiService';
import { hexToRgba } from '../../utils/colorUtils';

interface EmojiStyleCardProps {
  emojiSet: EmojiSet;
  label: string;
  description: string;
  sampleEmojis: string[];   // native emoji characters
  isActive: boolean;
  onPress: () => void;
  theme: Theme;
}

/**
 * Emoji style selector card — Obsidian Glass styling.
 * Follows the same glassmorphism token system as ThemedCard:
 *   1. Ambient glow shadow (accent color)
 *   2. 1dp hairline gradient border (specular → muted accent)
 *   3. Translucent glass body (elevated background at cardOpacity)
 *   4. Diagonal specular sweep for surface realism
 * Active state uses accent gradient border for visual prominence.
 */
export const EmojiStyleCard: React.FC<EmojiStyleCardProps> = memo(({
  emojiSet,
  label,
  description,
  sampleEmojis,
  isActive,
  onPress,
  theme,
}) => {
  // Look up EmojiEntry for each sample emoji so sprite sheets can render
  const entries = useMemo(() => {
    return sampleEmojis.map(native => {
      const entry = EmojiService.getEmojiByNative(native);
      return { native, entry };
    });
  }, [sampleEmojis]);

  const { cardOpacity, glowOpacity, glowRadius } = theme.colors.glass;

  // Glass body — translucent elevated fill
  const glassFill = hexToRgba(theme.colors.background.elevated, cardOpacity);

  // Hairline gradient border — silver specular → faint accent
  const borderStart = 'rgba(255, 255, 255, 0.20)';
  const borderEnd = hexToRgba(theme.colors.accent.secondary, 0.10);

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        styles.shadowHost,
        {
          shadowColor: theme.colors.accent.primary,
          shadowOpacity: isActive ? glowOpacity * 2 : glowOpacity,
          shadowRadius: glowRadius,
        },
        // Android elevation — colored shadows not supported, fallback to dark
        Platform.select({
          android: {
            elevation: isActive ? 10 : 6,
          },
          ios: {
            shadowOffset: { width: 0, height: 4 },
          },
        }),
      ]}
    >
      {/* 1dp hairline gradient border */}
      <LinearGradient
        colors={
          isActive
            ? [theme.colors.accent.primary, theme.colors.accent.secondary]
            : [borderStart, borderEnd]
        }
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={styles.borderOuter}
      >
        {/* Obsidian Glass translucent canvas */}
        <View style={[styles.cardInner, { backgroundColor: glassFill }]}>
          {/* Diagonal specular sweep — faint light refraction */}
          <LinearGradient
            colors={['rgba(255, 255, 255, 0.08)', 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.7, y: 1 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />

          {/* Active check badge — subtle top-right */}
          {isActive && (
            <View style={[styles.activeBadge, { backgroundColor: theme.colors.accent.primary }]}>
              <Icon name="check" size={12} color="#fff" />
            </View>
          )}

          {/* Emoji preview row */}
          <View style={styles.previewRow}>
            {entries.map(({ native, entry }, index) => (
              <View key={index} style={styles.emojiSlot}>
                <EmojiText
                  native={native}
                  size={24}
                  emojiEntry={entry}
                  emojiSet={emojiSet}
                />
              </View>
            ))}
          </View>

          {/* Labels */}
          <Text style={[styles.label, { color: theme.colors.text.primary }]}>
            {label}
          </Text>
          <Text
            style={[
              styles.description,
              {
                color: theme.colors.text.secondary,
                opacity: theme.colors.typography.subtextOpacity,
              },
            ]}
          >
            {description}
          </Text>
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  shadowHost: {
    marginBottom: 12,
  },
  borderOuter: {
    borderRadius: 14,
    // 1dp hairline gradient border
    padding: StyleSheet.hairlineWidth,
  },
  cardInner: {
    borderRadius: 13,
    overflow: 'hidden',
    padding: 16,
  },
  activeBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  previewRow: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 12,
  },
  emojiSlot: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 3,
  },
  description: {
    fontSize: 12,
    lineHeight: 16,
  },
});

export default EmojiStyleCard;
