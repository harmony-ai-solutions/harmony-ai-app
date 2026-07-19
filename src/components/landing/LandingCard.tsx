import React from 'react';
import { TouchableOpacity, View, StyleSheet, ViewStyle, Platform } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { hexToRgba } from '../../utils/colorUtils';

interface LandingCardProps {
  icon: string;
  title: string;
  description: string;
  onPress: () => void;
  variant?: 'hero' | 'secondary';
  style?: ViewStyle;
}

export const LandingCard: React.FC<LandingCardProps> = ({
  icon,
  title,
  description,
  onPress,
  variant = 'secondary',
  style,
}) => {
  const { theme } = useAppTheme();

  if (!theme) return null;

  const isHero = variant === 'hero';
  const CARD_RADIUS = 20;

  // Single uniform glass color — flat translucent layer, no gradient
  const glassBg = hexToRgba(theme.colors.background.elevated, theme.colors.glass.cardOpacity);

  return (
    <TouchableOpacity
      style={[
        isHero ? styles.heroCard : styles.secondaryCard,
        {
          backgroundColor: glassBg,
          shadowColor: theme.colors.accent.primary,
          shadowOpacity: theme.colors.glass.glowOpacity,
          shadowRadius: theme.colors.glass.glowRadius,
        },
        style,
      ]}
      onPress={onPress}
      activeOpacity={0.82}
    >
      {/* Left accent stripe — shown on hero */}
      {isHero && (
        <View
          style={[styles.accentStripe, { backgroundColor: theme.colors.accent.primary }]}
          pointerEvents="none"
        />
      )}

      {/* Icon badge */}
      <View
        style={[
          styles.iconContainer,
          isHero ? styles.iconContainerHero : styles.iconContainerSecondary,
          { backgroundColor: theme.colors.accent.primary + '1A' },
        ]}
      >
        <Icon
          name={icon}
          size={isHero ? 36 : 28}
          color={theme.colors.accent.primary}
        />
      </View>

      {/* Text */}
      <View style={styles.textContainer}>
        <ThemedText weight="bold" size={isHero ? 20 : 16} style={styles.title}>
          {title}
        </ThemedText>
        <ThemedText
          variant="secondary"
          size={isHero ? 14 : 12}
          style={styles.description}
        >
          {description}
        </ThemedText>
      </View>

      {/* Arrow — only on hero card */}
      {isHero && (
        <View style={styles.arrowContainer}>
          <Icon
            name="chevron-right"
            size={20}
            color={theme.colors.text.muted}
          />
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  heroCard: {
    width: '100%',
    borderRadius: 20,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 20,
    paddingVertical: 20,
    minHeight: 100,
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.2,
        shadowRadius: 18,
      },
    }),
  },
  secondaryCard: {
    flex: 1,
    borderRadius: 20,
    overflow: 'hidden',
    flexDirection: 'column',
    alignItems: 'flex-start',
    padding: 20,
    minHeight: 120,
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 14,
      },
    }),
  },
  accentStripe: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
  },
  iconContainer: {
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  iconContainerHero: {
    width: 56,
    height: 56,
    marginLeft: 4,
  },
  iconContainerSecondary: {
    width: 52,
    height: 52,
    marginBottom: 12,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    marginBottom: 4,
  },
  description: {
    lineHeight: 18,
  },
  arrowContainer: {
    alignSelf: 'center',
    flexShrink: 0,
  },
});
