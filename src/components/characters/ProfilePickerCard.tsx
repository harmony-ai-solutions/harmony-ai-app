import React, { useRef } from 'react';
import {
  Animated,
  Image,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { hexToRgba } from '../../utils/colorUtils';

/** Fixed card width + horizontal gap so the carousel can snap & scrollToIndex. */
export const PICKER_CARD_WIDTH = 146;
export const PICKER_CARD_GAP = 12;

interface ProfilePickerCardProps {
  /** Card title — profile name or "Create new profile". */
  title: string;
  /** One/two-line description shown under the title. */
  subtitle?: string | null;
  /** Primary avatar URI (data URL) or null for the placeholder. */
  imageUri: string | null;
  /** Render the "create new profile" variant (＋ icon placeholder). */
  isNew?: boolean;
  /** Highlighted with an accent ring + check badge when selected. */
  isSelected: boolean;
  onPress: () => void;
}

/**
 * Compact character card used in the horizontal picker carousel on the
 * Create AI screen. Deliberately mirrors the Obsidian Glass anatomy of
 * `CharacterProfileCard` (Character Profile Management screen) so picking
 * an existing profile feels like choosing a character, not a DB row:
 *
 *   1. Ambient neon glow shadow — intensified when selected.
 *   2. 1dp hairline gradient border — swapped for a 2px accent ring when selected.
 *   3. Translucent Obsidian Glass body (theme-governed card opacity).
 *   4. 3:4 portrait image area with a dark fade overlay.
 *   5. Selected check badge (top-right of the image).
 *   6. Text area: name + description snippet.
 *   7. Left accent stripe (primary → secondary) full card height.
 */
export const ProfilePickerCard: React.FC<ProfilePickerCardProps> = ({
  title,
  subtitle,
  imageUri,
  isNew = false,
  isSelected,
  onPress,
}) => {
  const { theme } = useAppTheme();
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.95,
      useNativeDriver: true,
      speed: 24,
      bounciness: 4,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 24,
      bounciness: 4,
    }).start();
  };

  if (!theme) return null;

  const glass = theme.colors.glass;
  const accent = theme.colors.accent;
  const bgHex = theme.colors.background.elevated;
  const glassFill = hexToRgba(bgHex, glass.cardOpacity);
  const textFill = hexToRgba(theme.colors.background.surface, glass.cardOpacity + 0.08);
  const accentSecondary = accent.secondary ?? accent.primaryHover;

  // Selected cards trade the hairline silver border for a 2px accent ring.
  const borderColors = isSelected
    ? [accent.primary, accentSecondary]
    : [glass.borderGradientStart, glass.borderGradientEnd];
  const borderPad = isSelected ? 2 : StyleSheet.hairlineWidth;

  return (
    <Animated.View
      style={[
        styles.wrapper,
        { transform: [{ scale: scaleAnim }] },
        isSelected ? styles.glowSelected : styles.glow,
        { shadowColor: accent.primary },
      ]}
    >
      <TouchableOpacity
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
        accessibilityRole="button"
        accessibilityLabel={`${title}${isSelected ? ', selected' : ''}`}
        accessibilityState={{ selected: isSelected }}
      >
        {/* ── Gradient border (accent ring when selected) ── */}
        <LinearGradient
          colors={borderColors}
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.85, y: 1 }}
          style={[styles.border, { padding: borderPad }]}
        >
          {/* ── Obsidian Glass body ── */}
          <View style={[styles.body, { backgroundColor: glassFill }]}>
            {/* ── Image area (3:4 portrait) ── */}
            <View
              style={[
                styles.imageContainer,
                { backgroundColor: theme.colors.background.base },
              ]}
            >
              {imageUri ? (
                <Image
                  source={{ uri: imageUri }}
                  style={styles.image}
                  resizeMode="cover"
                />
              ) : (
                <View
                  style={[
                    styles.placeholder,
                    isNew && { backgroundColor: hexToRgba(accent.primary, 0.10) },
                  ]}
                >
                  <Icon
                    name={isNew ? 'account-plus-outline' : 'account'}
                    size={isNew ? 34 : 40}
                    color={
                      isNew
                        ? accent.primary
                        : theme.colors.text.disabled ?? theme.colors.text.muted
                    }
                  />
                </View>
              )}

              {/* Dark fade overlay — blends image into glass text area */}
              <LinearGradient
                colors={['transparent', 'rgba(0,0,0,0.50)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={styles.imageOverlay}
                pointerEvents="none"
              />

              {/* Selected check badge */}
              {isSelected && (
                <View
                  style={[styles.checkBadge, { backgroundColor: accent.primary }]}
                >
                  <Icon name="check" size={12} color="#fff" />
                </View>
              )}
            </View>

            {/* ── Text area ── */}
            <View style={[styles.textContainer, { backgroundColor: textFill }]}>
              <ThemedText
                weight="bold"
                size={13}
                numberOfLines={1}
                style={[styles.title, isSelected ? { color: accent.primary } : undefined]}
              >
                {title}
              </ThemedText>
              {!!subtitle && (
                <ThemedText
                  variant="muted"
                  size={11}
                  numberOfLines={2}
                  style={styles.subtitle}
                >
                  {subtitle}
                </ThemedText>
              )}
            </View>

            {/* ── Left accent stripe ── */}
            <LinearGradient
              colors={[accent.primary, accentSecondary]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={styles.accentStripe}
              pointerEvents="none"
            />
          </View>
        </LinearGradient>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    width: PICKER_CARD_WIDTH,
    marginRight: PICKER_CARD_GAP,
  },
  // Ambient neon glow — subtle by default, intensified when selected
  glow: {
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 6,
  },
  glowSelected: {
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 10,
  },
  border: {
    borderRadius: 14,
  },
  body: {
    borderRadius: 13,
    overflow: 'hidden',
  },
  imageContainer: {
    aspectRatio: 3 / 4,
    width: '100%',
    borderTopLeftRadius: 13,
    borderTopRightRadius: 13,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 40,
  },
  checkBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.4)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },
  textContainer: {
    padding: 10,
    gap: 2,
  },
  title: {
    letterSpacing: 0.2,
  },
  subtitle: {
    lineHeight: 14,
  },
  accentStripe: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: 3,
    borderTopLeftRadius: 13,
    borderBottomLeftRadius: 13,
  },
});
