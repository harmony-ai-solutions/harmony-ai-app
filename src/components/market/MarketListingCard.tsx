/**
 * MarketListingCard — AI character listing card for the Market screen.
 *
 * Obsidian-glass card mirroring the Discover grid: 3:4 portrait with a dark
 * fade overlay, creator/price metadata, and a "Chat" chat button. Tapping the
 * card opens the character's public AI profile (viewing is always free); the
 * chat button runs the purchase gate (paywall for marketplace items).
 */

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
import { hapticLightPress } from '../../utils/haptics';
import { SoulIcon } from './SoulIcon';
import { CharacterProfile } from '../../database/models';

interface MarketListingCardProps {
  profile: CharacterProfile;
  imageUri: string | null; // base64 data URL or null for placeholder
  priceSouls: number;
  /** True when the local user already purchased this character (or owns it). */
  canChat: boolean;
  onPress: () => void;          // open the AI profile (view, always free)
  onChatPress: () => void;      // chat — may trigger the purchase gate
}

export const MarketListingCard: React.FC<MarketListingCardProps> = ({
  profile,
  imageUri,
  priceSouls,
  canChat,
  onPress,
  onChatPress,
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
  const accentSecondary = accent.secondary ?? accent.primaryHover;

  const priceText = Number.isInteger(priceSouls)
    ? String(priceSouls)
    : priceSouls.toFixed(2);

  return (
    <Animated.View
      style={[
        styles.wrapper,
        {
          transform: [{ scale: scaleAnim }],
          shadowColor: accent.primary,
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: glass.glowOpacity,
          shadowRadius: glass.glowRadius,
          elevation: 8,
        },
      ]}
    >
      <TouchableOpacity
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={onPress}
        onLongPress={onPress}
        activeOpacity={0.9}
        style={styles.card}
      >
        <LinearGradient
          colors={[accent.primary, accentSecondary]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.borderGradient}
        >
          <View style={[styles.body, { backgroundColor: glassFill }]}>
            {/* ── Portrait image / placeholder ── */}
            <View style={styles.imageWrap}>
              {imageUri ? (
                <Image
                  source={{ uri: imageUri }}
                  style={styles.image}
                  resizeMode="cover"
                />
              ) : (
                <View style={[styles.placeholder, { backgroundColor: hexToRgba(bgHex, 0.6) }]}>
                  <Icon name="account-outline" size={40} color={hexToRgba(accent.primary, 0.7)} />
                </View>
              )}
              <LinearGradient
                colors={['transparent', 'rgba(0,0,0,0.72)']}
                style={styles.imageFade}
              />

              {/* ── Price badge (bottom-left over the image) ── */}
              <View style={styles.priceBadge}>
                <SoulIcon size={14} />
                <ThemedText size={13} weight="bold" style={styles.priceText}>
                  {priceText}
                </ThemedText>
              </View>

              {/* ── Chat button (bottom-right over the image) ── */}
              <TouchableOpacity
                onPress={e => {
                  e.stopPropagation();
                  hapticLightPress();
                  onChatPress();
                }}
                activeOpacity={0.85}
                style={styles.chatButton}
                testID={`market-listing-chat-${profile.id}`}
                accessibilityRole="button"
                accessibilityLabel="Chat"
              >
                <LinearGradient
                  colors={[accent.primary, accentSecondary]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.chatButtonGradient}
                >
                  <Icon
                    name={canChat ? 'chat-processing' : 'lock-clock'}
                    size={14}
                    color="#fff"
                  />
                </LinearGradient>
              </TouchableOpacity>
            </View>

            {/* ── Text area ── */}
            <View style={styles.textArea}>
              <ThemedText
                size={14}
                weight="bold"
                variant="primary"
                numberOfLines={2}
                style={styles.name}
              >
                {profile.name}
              </ThemedText>
              <ThemedText
                size={11}
                variant="muted"
                numberOfLines={2}
                style={styles.desc}
              >
                {profile.description || ' '}
              </ThemedText>
            </View>
          </View>
        </LinearGradient>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    width: '48%',
    marginBottom: 12,
  },
  card: {
    borderRadius: 16,
  },
  borderGradient: {
    borderRadius: 16,
    padding: 1,
  },
  body: {
    borderRadius: 15,
    overflow: 'hidden',
  },
  imageWrap: {
    width: '100%',
    aspectRatio: 3 / 4,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '55%',
  },
  priceBadge: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  priceText: {
    color: '#ffffff',
  },
  chatButton: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  chatButtonGradient: {
    flex: 1,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textArea: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  name: {
    lineHeight: 18,
  },
  desc: {
    lineHeight: 15,
  },
});