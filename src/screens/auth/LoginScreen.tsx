/**
 * LoginScreen — the single Soulbits Cloud sign-in screen (Option B,
 * owner-ruled 2026-10-17).
 *
 * The portal IS the sign-in: there is no email/password form and no native
 * Google/Apple buttons here. Both CTAs — the primary "Sign in with Soulbits"
 * and the secondary "Create account" — start the portal connect-session flow
 * (`signInViaPortal`), which opens the portal in the system browser (the same
 * page serves sign-in AND sign-up, so a first-time user creates their account
 * mid-flow). The app then pushes {@link PendingApprovalScreen} and waits for
 * the poll to redeem the token pair.
 */

import React, { useCallback, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createLogger } from '../../utils/logger';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { ThemedView } from '../../components/themed/ThemedView';
import { ThemedText } from '../../components/themed/ThemedText';
import { ThemedButton } from '../../components/themed/ThemedButton';
import { ScreenHeader } from '../../components/themed/ScreenHeader';
import type { RootStackParamList } from '../../navigation/AppNavigator';

const log = createLogger('[LoginScreen]');

export const LoginScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { t } = useTranslation('auth');
  const { signInViaPortal, status } = useAuth();

  // Safety net: if the user lands here already authenticated (e.g. a persisted
  // token completed between render and press), pop back to the caller. The
  // normal path replaces this screen with PendingApproval.
  useEffect(() => {
    if (status === 'authenticated') {
      navigation.goBack();
    }
  }, [status, navigation]);

  const handleSignIn = useCallback(() => {
    // Kick off the portal flow, then show the waiting screen. Login is
    // REPLACED so the waiting screen's pop returns to whatever pushed Login.
    log.info('Starting portal sign-in');
    void signInViaPortal();
    navigation.replace('PendingApproval');
  }, [signInViaPortal, navigation]);

  if (!theme) return null;

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader
        title={t('signIn_title')}
        onBack={() => navigation.goBack()}
      />

      <View style={[styles.content, { paddingBottom: 40 + safeBottom }]}>
        <View style={styles.headerSection}>
          <ThemedText variant="secondary" style={styles.subtitle}>
            {t('signIn_subtitle')}
          </ThemedText>
        </View>

        <ThemedButton
          label={t('signIn_withSoulbits')}
          onPress={handleSignIn}
          disabled={status === 'loading'}
          style={styles.primaryButton}
          testID="login-sign-in-soulbits"
        />

        <ThemedButton
          label={t('signIn_createAccount')}
          onPress={handleSignIn}
          variant="outline"
          disabled={status === 'loading'}
          style={styles.secondaryButton}
          testID="login-create-account"
        />

        <ThemedText variant="muted" size={13} style={styles.hint}>
          {t('signIn_browserHint')}
        </ThemedText>
      </View>
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 12,
  },
  headerSection: {
    marginBottom: 12,
    alignItems: 'center',
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    opacity: 0.8,
  },
  primaryButton: {
    marginTop: 4,
  },
  secondaryButton: {
    marginTop: 4,
  },
  hint: {
    marginTop: 12,
    textAlign: 'center',
    opacity: 0.7,
    lineHeight: 18,
  },
});
