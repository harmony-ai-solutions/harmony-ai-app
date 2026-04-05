import React from 'react';
import { TouchableOpacity, View, StyleSheet, ViewStyle } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';

interface LandingCardProps {
  icon: string; // MaterialCommunityIcons name
  title: string;
  description: string;
  onPress: () => void;
  variant?: 'hero' | 'secondary'; // hero = full-width prominent, secondary = half-width
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

  return (
    <TouchableOpacity
      style={[isHero ? styles.heroCard : styles.secondaryCard, style]}
      onPress={onPress}
      activeOpacity={0.82}
    >
      <LinearGradient
        colors={[theme.colors.background.elevated, theme.colors.background.surface]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.gradient, isHero ? styles.heroInner : styles.secondaryInner]}
      >
        {/* Prismatic tint overlay */}
        <LinearGradient
          colors={[theme.colors.accent.primary + '14', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
          pointerEvents="none"
        />

        {/* Left accent stripe — shown on hero */}
        {isHero && (
          <LinearGradient
            colors={[theme.colors.accent.primary, theme.colors.accent.secondary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={styles.accentStripe}
            pointerEvents="none"
          />
        )}

        {/* Icon badge with gradient */}
        <LinearGradient
          colors={[theme.colors.accent.primary + '33', theme.colors.accent.secondary + '1A']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.iconContainer, isHero ? styles.iconContainerHero : styles.iconContainerSecondary]}
        >
          <Icon
            name={icon}
            size={isHero ? 36 : 28}
            color={theme.colors.accent.primary}
          />
        </LinearGradient>

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

        {/* Arrow — only on hero card (horizontal layout) */}
        {isHero && (
          <View style={styles.arrowContainer}>
            <Icon
              name="chevron-right"
              size={20}
              color={theme.colors.text.muted}
            />
          </View>
        )}
      </LinearGradient>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  heroCard: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 6,
  },
  secondaryCard: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 4,
  },
  gradient: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
    overflow: 'hidden',
  },
  heroInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 20,
    paddingVertical: 20,
    minHeight: 100,
  },
  secondaryInner: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    padding: 20,
    minHeight: 120,
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
    marginLeft: 4, // account for stripe
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
