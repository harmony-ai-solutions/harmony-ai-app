/**
 * PendingApprovalScreen — the phone-app analog of the desktop W2 waiting
 * state for the portal connect-session sign-in (Option B, owner-ruled
 * 2026-10-17).
 *
 * After the user taps "Sign in with Soulbits", the app opens the portal in the
 * system browser and pushes this screen. It shows "Finish signing in in your
 * browser" with a spinner + a TTL countdown, an "Open browser again" action
 * (re-opens the same connect URL), and a cancel/back to sign-in.
 *
 * The `soulbits://connect-return` deep link foregrounds the app here; the
 * connect-session service polls immediately on that event and on AppState→
 * active, so approval resolves without the user doing anything in the app. On
 * redeem the `status` flips to `authenticated` and this screen shows a brief
 * success state, then pops back (Login was REPLACED by this screen, so the pop
 * returns to whatever pushed Login).
 */

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { ThemedView } from '../../components/themed/ThemedView';
import { ThemedText } from '../../components/themed/ThemedText';
import { ThemedButton } from '../../components/themed/ThemedButton';
import { ScreenHeader } from '../../components/themed/ScreenHeader';
import type { RootStackParamList } from '../../navigation/AppNavigator';

export const PendingApprovalScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { t } = useTranslation('auth');
  const { status, pendingSignIn, signInViaPortal, cancelSignIn } = useAuth();

  const [showSuccess, setShowSuccess] = useState(false);

  // On redeem → brief success → pop back. Login was replaced by this screen, so
  // the pop returns to whatever pushed Login (typically ConnectionSetup).
  useEffect(() => {
    if (status !== 'authenticated') return;
    setShowSuccess(true);
    const timer = setTimeout(() => navigation.goBack(), 900);
    return () => clearTimeout(timer);
  }, [status, navigation]);

  const handleBack = () => {
    cancelSignIn();
    navigation.goBack();
  };

  const handleOpenBrowser = () => {
    const url = pendingSignIn?.connectUrl;
    if (url) {
      void Linking.openURL(url).catch(() => undefined);
    }
  };

  const handleRetry = () => {
    void signInViaPortal();
  };

  if (!theme) return null;

  const terminal =
    pendingSignIn !== null &&
    (pendingSignIn.status === 'expired' ||
      pendingSignIn.status === 'consumed' ||
      pendingSignIn.status === 'errored');

  // ── Success (post-redeem) ──────────────────────────────────────────────
  if (showSuccess || status === 'authenticated') {
    return (
      <ThemedView style={styles.container} testID="pending-approval-success">
        <ScreenHeader title={t('pending_title')} onBack={handleBack} />
        <View style={styles.center}>
          <ThemedText weight="bold" variant="accent" size={20} style={styles.successText}>
            {t('pending_success')}
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  // ── Terminal (expired / consumed / errored) ────────────────────────────
  if (terminal) {
    const messageKey =
      pendingSignIn!.status === 'expired'
        ? 'pending_expired'
        : pendingSignIn!.status === 'consumed'
          ? 'pending_consumed'
          : 'pending_error';
    return (
      <ThemedView style={styles.container} testID="pending-approval-terminal">
        <ScreenHeader title={t('pending_title')} onBack={handleBack} />
        <View style={styles.center}>
          <ThemedText variant="secondary" style={styles.message}>
            {t(messageKey)}
          </ThemedText>
          <ThemedButton
            label={t('pending_retry')}
            onPress={handleRetry}
            style={styles.action}
            testID="pending-approval-retry"
          />
          <ThemedButton
            label={t('pending_cancel')}
            onPress={handleBack}
            variant="ghost"
            testID="pending-approval-cancel-terminal"
          />
        </View>
      </ThemedView>
    );
  }

  // ── Pending (waiting for the browser approval) ─────────────────────────
  return (
    <ThemedView style={styles.container} testID="pending-approval-pending">
      <ScreenHeader title={t('pending_title')} onBack={handleBack} />
      <View style={[styles.center, { paddingBottom: 40 + safeBottom }]}>
        <ActivityIndicator
          size="large"
          color={theme.colors.accent.primary}
          testID="pending-approval-spinner"
        />
        <ThemedText variant="secondary" style={styles.message}>
          {t('pending_subtitle')}
        </ThemedText>
        {pendingSignIn?.status === 'pending' && pendingSignIn.remainingSeconds > 0 && (
          <ThemedText variant="muted" size={13} testID="pending-approval-countdown">
            {t('pending_timeLeft', { seconds: pendingSignIn.remainingSeconds })}
          </ThemedText>
        )}
        <ThemedButton
          label={t('pending_openBrowser')}
          onPress={handleOpenBrowser}
          variant="outline"
          disabled={!pendingSignIn?.connectUrl}
          style={styles.action}
          testID="pending-approval-open-browser"
        />
        <ThemedButton
          label={t('pending_cancel')}
          onPress={handleBack}
          variant="ghost"
          testID="pending-approval-cancel"
        />
      </View>
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 16,
  },
  message: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    opacity: 0.85,
  },
  successText: {
    textAlign: 'center',
  },
  action: {
    minWidth: 220,
  },
});
