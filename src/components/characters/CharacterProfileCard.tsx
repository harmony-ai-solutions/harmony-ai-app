import React, { useRef } from 'react';
import {
  TouchableOpacity,
  View,
  StyleSheet,
  Image,
  Animated,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { hexToRgba } from '../../utils/colorUtils';
import { CharacterProfile } from '../../database/models';

interface CharacterProfileCardProps {
  profile: CharacterProfile;
  imageUri: string | null; // base64 data URL or null for placeholder
  imageCount?: number;     // total images this profile has
  onPress: () => void;
  onLongPress: () => void;
}

/**
 * Obsidian Glass Character Card.
 *
 * Anatomy (outside → in):
 *   1. Ambient neon glow shadow — accent-colored radiant halo that floats
 *      the card above the aurora background.
 *   2. 1dp hairline gradient border — polished silver top-left catching
 *      the light, fading into muted accent purple at bottom-right.
 *   3. Deep Obsidian Glass body — rich translucent fill at theme-governed
 *      opacity, dark enough for crisp text while the aurora bleeds through.
 *   4. Image area — 3:4 portrait clipped to the card's top rounded corners,
 *      with a dark fade overlay blending into the glass text area below.
 *   5. Specular sweep — diagonal white light refraction across the text
 *      area for a premium glass-surface feel.
 *   6. Prismatic accent tint — accent primary at ~5 % opacity from top-left.
 *   7. Left accent stripe — 3px vertical gradient (primary → secondary)
 *      running the full card height.
 *   8. Spring-scale press animation — 0.95 shrink with gentle bounce-back.
 */
export const CharacterProfileCard: React.FC<CharacterProfileCardProps> = ({
  profile,
  imageUri,
  imageCount = 0,
  onPress,
  onLongPress,
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

  return (
    <Animated.View
      style={[
        styles.wrapper,
        { transform: [{ scale: scaleAnim }] },
        {
          // ── Ambient neon glow shadow ──
          shadowColor: accent.primary,
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: glass.glowOpacity,
          shadowRadius: glass.glowRadius,
          elevation: 8,
        },
      ]}
    >
      <TouchableOpacity
        onPress={onPress}
        onLongPress={onLongPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
        delayLongPress={400}
        testID="character-profile-card"
        accessibilityLabel={`Character profile: ${profile.name}`}
      >
        {/* ── 1dp hairline gradient border ── */}
        <LinearGradient
          colors={[glass.borderGradientStart, glass.borderGradientEnd]}
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.85, y: 1 }}
          style={styles.border}
        >
          {/* ── Deep Obsidian Glass body ── */}
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
                <View style={styles.placeholder}>
                  <Icon
                    name="account"
                    size={44}
                    color={theme.colors.text.disabled ?? theme.colors.text.muted}
                  />
                </View>
              )}

              {/* Image count badge — glass pill */}
              {imageCount > 1 && (
                <View style={styles.imageBadge}>
                  <Icon name="image-multiple-outline" size={10} color="#fff" />
                  <ThemedText
                    size={10}
                    weight="medium"
                    style={styles.imageBadgeText}
                  >
                    {imageCount}
                  </ThemedText>
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
            </View>

            {/* ── Text area (surface-tinted glass) ── */}
            <View style={[styles.textContainer, { backgroundColor: textFill }]}>
              {/* Specular sweep — diagonal light refraction */}
              <LinearGradient
                colors={['rgba(255,255,255,0.10)', 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 0.7, y: 1 }}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />

              {/* Prismatic accent tint — subtle color bleed from top-left */}
              <LinearGradient
                colors={[accent.primary + '0D', 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />

              <ThemedText
                weight="bold"
                size={13}
                numberOfLines={1}
                style={[styles.name, { color: accent.primary }]}
              >
                {profile.name}
              </ThemedText>
              <ThemedText
                variant="muted"
                size={11}
                numberOfLines={2}
                style={styles.description}
              >
                {profile.description || 'No description provided.'}
              </ThemedText>
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
    flex: 1, // fills one column in FlatList numColumns={2}
    maxWidth: '50%',
  },
  // ── 1dp hairline gradient border (outer shell) ──
  border: {
    borderRadius: 16,
    padding: StyleSheet.hairlineWidth,
  },
  // ── Glass body (inner content area) ──
  body: {
    borderRadius: 15,
    overflow: 'hidden',
  },
  // ── Image area ──
  imageContainer: {
    aspectRatio: 3 / 4,
    width: '100%',
    borderTopLeftRadius: 15,
    borderTopRightRadius: 15,
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
  // ── Bottom fade overlay on image ──
  imageOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 48,
  },
  // ── Image count badge ──
  imageBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 3,
    gap: 3,
  },
  imageBadgeText: {
    color: '#fff',
  },
  // ── Text area ──
  textContainer: {
    padding: 12,
    gap: 3,
  },
  name: {
    letterSpacing: 0.2,
  },
  description: {
    lineHeight: 15,
    minHeight: 30, // reserve space for 2 lines
  },
  // ── Left accent stripe ──
  accentStripe: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: 3,
    borderTopLeftRadius: 15,
    borderBottomLeftRadius: 15,
  },
});
