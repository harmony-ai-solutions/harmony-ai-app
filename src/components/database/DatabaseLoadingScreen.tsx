/**
 * Boot Gate Screen
 *
 * Full-screen gate shown while the app boots — the theme is resolving and the
 * engine feature flags are being hydrated from storage (see DatabaseContext).
 * Despite the component/file name this is NOT a database screen: there is no
 * app-local database, the embedded engine owns all data, and the gate never
 * waits on the engine. Matches the app's design language used in
 * ComingSoonScreen, ProfileSettingsScreen, and other full-screen placeholders.
 */
import React from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { useDatabase } from '../../contexts/DatabaseContext';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedView } from '../themed/ThemedView';
import { ThemedText } from '../themed/ThemedText';
import { ThemedGradient } from '../themed/ThemedGradient';
import { ThemedCard } from '../themed/ThemedCard';
import { ThemedButton } from '../themed/ThemedButton';

export function DatabaseLoadingScreen() {
  const { error, retryInitialization } = useDatabase();
  const { theme } = useAppTheme();
  const { t } = useTranslation('database');

  if (!theme) return null;

  /* ── Error state ────────────────────────────────────────────────────────── */
  if (error) {
    return (
      <ThemedView variant="base" style={styles.container}>
        <View style={styles.body}>
          {/* Gradient-ringed icon circle */}
          <View style={styles.iconWrapper}>
            <ThemedGradient gradient="primary" style={styles.iconRing}>
              <ThemedView variant="elevated" style={styles.iconInner}>
                <Icon name="alert-circle-outline" size={48} color={theme.colors.status?.error ?? '#ff5252'} />
              </ThemedView>
            </ThemedGradient>
          </View>

          <ThemedText
            variant="primary"
            size={24}
            weight="bold"
            hierarchy="header"
            style={styles.headline}
          >
            {t('errorTitle')}
          </ThemedText>

          <ThemedText
            variant="secondary"
            size={14}
            hierarchy="subtext"
            style={styles.description}
          >
            {t('errorDescription')}
          </ThemedText>

          <ThemedCard elevated accentStripe accentTint style={styles.errorCard}>
            <ThemedText
              variant="muted"
              size={11}
              style={styles.errorDetails}
            >
              {t('errorPrefix')}{error}
            </ThemedText>
          </ThemedCard>

          <View style={styles.buttonGroup}>
            <ThemedButton
              label={t('retryInit')}
              variant="primary"
              icon="refresh"
              onPress={retryInitialization}
              style={styles.button}
            />
          </View>
        </View>
      </ThemedView>
    );
  }

  /* ── Loading state ──────────────────────────────────────────────────────── */
  return (
    <ThemedView variant="base" style={styles.container}>
      <View style={styles.body}>
        {/* Gradient-ringed icon circle */}
        <View style={styles.iconWrapper}>
          <ThemedGradient gradient="primary" style={styles.iconRing}>
            <ThemedView variant="elevated" style={styles.iconInner}>
              <ActivityIndicator size="large" color={theme.colors.accent.primary} />
            </ThemedView>
          </ThemedGradient>
        </View>

        {/* Pulse dot */}
        <View style={styles.pulseRow}>
          <ThemedGradient gradient="primary" style={styles.pulseDot} />
        </View>

        <ThemedText
          variant="primary"
          size={24}
          weight="bold"
          hierarchy="header"
          style={styles.headline}
        >
          {t('startingTitle')}
        </ThemedText>

        <ThemedText
          variant="secondary"
          size={14}
          hierarchy="subtext"
          style={styles.description}
        >
          {t('startingDescription')}
        </ThemedText>

        {/* Decorative bottom accent bar */}
        <ThemedGradient gradient="primary" style={styles.bottomAccent} />
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  iconWrapper: {
    marginBottom: 24,
  },
  iconRing: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconInner: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRow: {
    marginBottom: 28,
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
    marginBottom: 10,
  },
  description: {
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  errorCard: {
    width: '100%',
    padding: 16,
    gap: 12,
    marginBottom: 24,
  },
  errorDetails: {
    fontFamily: 'monospace',
    lineHeight: 16,
  },
  buttonGroup: {
    width: '100%',
    gap: 12,
  },
  button: {
    width: '100%',
  },
  bottomAccent: {
    width: 48,
    height: 3,
    borderRadius: 2,
    opacity: 0.6,
    marginTop: 32,
  },
});
