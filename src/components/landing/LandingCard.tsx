import React from 'react';
import { TouchableOpacity, View, StyleSheet, ViewStyle } from 'react-native';
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

  const isHero = variant === 'hero';

  return (
    <TouchableOpacity
      style={[
        styles.card,
        isHero ? styles.heroCard : styles.secondaryCard,
        {
          backgroundColor: theme?.colors.background.elevated,
          borderColor: theme?.colors.border.default,
        },
        style,
      ]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      {/* Icon */}
      <View
        style={[
          styles.iconContainer,
          { backgroundColor: (theme?.colors.accent.primary ?? '#000') + '22' },
        ]}
      >
        <Icon
          name={icon}
          size={isHero ? 36 : 28}
          color={theme?.colors.accent.primary ?? '#000'}
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

      {/* Arrow */}
      <View style={styles.arrowContainer}>
        <Icon
          name="chevron-right"
          size={20}
          color={theme?.colors.text.muted ?? '#888'}
        />
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  heroCard: {
    width: '100%',
    minHeight: 100,
  },
  secondaryCard: {
    flex: 1,
    minHeight: 120,
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  iconContainer: {
    width: 52,
    height: 52,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
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
    alignSelf: 'flex-end',
  },
});
