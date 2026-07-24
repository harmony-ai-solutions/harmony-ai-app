/**
 * ProfileSettingsScreen — Coming Soon
 *
 * Professional placeholder for the User Profile settings feature.
 * Renders a centered "Coming Soon" slate with themed gradient accents,
 * iconography, and the app's glassmorphism aesthetic.
 * Consistent with the DiscoverScreen placeholder.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedView } from '../../components/themed/ThemedView';
import { ThemedText } from '../../components/themed/ThemedText';
import { ThemedGradient } from '../../components/themed/ThemedGradient';
import { ScreenHeader } from '../../components/themed/ScreenHeader';

export const ProfileSettingsScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const navigation = useNavigation();
  const { t } = useTranslation('profile');

  if (!theme) return null;

  return (
    <ThemedView variant="base" style={styles.container}>
      <ScreenHeader
        title={t('title')}
        onBack={() => navigation.goBack()}
      />

      {/* ── Coming Soon Body ── */}
      <View style={styles.body}>
        {/* Gradient-ringed icon circle */}
        <View style={styles.iconWrapper}>
          <ThemedGradient gradient="primary" style={styles.iconRing}>
            <ThemedView variant="elevated" style={styles.iconInner}>
              <Icon
                name="account-circle-outline"
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
          Coming Soon
        </ThemedText>

        {/* Description */}
        <ThemedText
          variant="secondary"
          size={14}
          hierarchy="subtext"
          style={styles.description}
        >
          Your profile settings are being crafted.{'\n'}
          Soon you'll be able to customize your display name,{'\n'}
          bio, avatar, and personal preferences.
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

export default ProfileSettingsScreen;
