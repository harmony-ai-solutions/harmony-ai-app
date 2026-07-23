/**
 * ComingSoonScreen — Generic placeholder for settings features in development.
 *
 * Accepts route params to customize the title, icon, and description,
 * maintaining the glassmorphism "Coming Soon" aesthetic consistent with
 * ProfileSettingsScreen and DiscoverScreen.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedView } from '../../components/themed/ThemedView';
import { ThemedText } from '../../components/themed/ThemedText';
import { ThemedGradient } from '../../components/themed/ThemedGradient';
import { ScreenHeader } from '../../components/themed/ScreenHeader';
import { RootStackParamList } from '../../navigation/AppNavigator';

type ComingSoonRouteProp = RouteProp<RootStackParamList, 'ComingSoon'>;

export const ComingSoonScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const navigation = useNavigation();
  const route = useRoute<ComingSoonRouteProp>();
  const { t } = useTranslation('settings');

  const { titleKey, icon, descriptionKey } = route.params;

  if (!theme) return null;

  return (
    <ThemedView variant="base" style={styles.container}>
      <ScreenHeader
        title={t(titleKey)}
        onBack={() => navigation.goBack()}
      />

      {/* ── Coming Soon Body ── */}
      <View style={styles.body}>
        {/* Gradient-ringed icon circle */}
        <View style={styles.iconWrapper}>
          <ThemedGradient gradient="primary" style={styles.iconRing}>
            <ThemedView variant="elevated" style={styles.iconInner}>
              <Icon
                name={icon}
                size={56}
                color={theme.colors.accent.primary}
              />
            </ThemedView>
          </ThemedGradient>
        </View>

        {/* Pulse dot below the icon */}
        <View style={styles.pulseRow}>
          <ThemedGradient gradient="primary" style={styles.pulseDot} />
        </View>

        {/* Headline */}
        <ThemedText
          variant="primary"
          size={26}
          weight="bold"
          hierarchy="header"
          style={styles.headline}
        >
          {t('comingSoonTitle')}
        </ThemedText>

        {/* Description */}
        <ThemedText
          variant="secondary"
          size={14}
          hierarchy="subtext"
          style={styles.description}
        >
          {t(descriptionKey)}
        </ThemedText>

        {/* Decorative bottom accent bar */}
        <ThemedGradient gradient="primary" style={styles.bottomAccent} />
      </View>
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    marginTop: -40,
  },
  iconWrapper: {
    marginBottom: 24,
  },
  iconRing: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconInner: {
    width: 108,
    height: 108,
    borderRadius: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRow: {
    marginBottom: 32,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    opacity: 0.7,
  },
  headline: {
    textAlign: 'center',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  description: {
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 40,
  },
  bottomAccent: {
    width: 48,
    height: 3,
    borderRadius: 2,
    opacity: 0.6,
  },
});

export default ComingSoonScreen;
