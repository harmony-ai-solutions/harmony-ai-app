/**
 * Database Loading Screen
 *
 * Glassmorphism-themed loading / error screen displayed during database
 * initialization. Matches the app's design language used in ComingSoonScreen,
 * ProfileSettingsScreen, and other full-screen placeholders.
 */
import React, { useState } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { useDatabase } from '../../contexts/DatabaseContext';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useAppAlert } from '../../contexts/AppAlertContext';
import { ThemedView } from '../themed/ThemedView';
import { ThemedText } from '../themed/ThemedText';
import { ThemedGradient } from '../themed/ThemedGradient';
import { ThemedCard } from '../themed/ThemedCard';
import { ThemedButton } from '../themed/ThemedButton';
import { wipeDatabaseCompletely } from '../../database';

export function DatabaseLoadingScreen() {
  const { isLoading, error, retryInitialization } = useDatabase();
  const { theme } = useAppTheme();
  const { t } = useTranslation('database');
  const { showAlert } = useAppAlert();
  const [isWiping, setIsWiping] = useState(false);

  const handleWipeDatabase = () => {
    showAlert(t('wipeConfirmTitle'), t('wipeConfirmMessage'), [
      { text: t('common:cancel'), style: 'cancel' },
      {
        text: t('wipeReinit'),
        style: 'destructive',
        onPress: async () => {
          setIsWiping(true);
          try {
            await wipeDatabaseCompletely();
            showAlert(t('wipeSuccess'), t('wipeSuccessMessage'), [
              {
                text: t('common:ok'),
                onPress: () => {
                  setIsWiping(false);
                  retryInitialization();
                },
              },
            ]);
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            showAlert(t('common:error'), t('wipeFailed', { message: errorMessage }), [
              {
                text: t('common:ok'),
                onPress: () => setIsWiping(false),
              },
            ]);
          }
        },
      },
    ]);
  };

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
                <Icon name="database-off" size={48} color={theme.colors.status?.error ?? '#ff5252'} />
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
            <View style={styles.errorList}>
              {[t('errorStorage'), t('errorCorruption'), t('errorPermissions')].map((item, i) => (
                <View key={i} style={styles.errorItem}>
                  <Icon name="alert-circle-outline" size={14} color={theme.colors.status?.error ?? '#ff5252'} />
                  <ThemedText variant="secondary" size={13}>{item}</ThemedText>
                </View>
              ))}
            </View>
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
              disabled={isWiping}
              style={styles.button}
            />
            <ThemedButton
              label={isWiping ? t('wiping') : t('wipeReinit')}
              variant="outline"
              icon="delete-sweep"
              onPress={handleWipeDatabase}
              disabled={isWiping}
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
          {t('initializing')}
        </ThemedText>

        <ThemedText
          variant="secondary"
          size={14}
          hierarchy="subtext"
          style={styles.description}
        >
          {t('settingUp')}
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
  errorList: {
    gap: 8,
  },
  errorItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
