/**
 * AuthGate — the store-variant launch identity gate (plan 7-14 V2).
 *
 * The distribution-variant axis (7-14) reintroduces a launch gate for STORE
 * builds only. This component sits at the ROOT of the navigator (it wraps the
 * `NavigationContainer` inside {@link AppNavigator}) and, for a store build
 * with no session, renders a full-screen NON-DISMISSIBLE sign-in wall INSTEAD
 * of the tab experience:
 *
 *   - **full variant** → renders its children byte-for-byte (a true no-op):
 *     today's behavior, including the parity plan's deliberate "no forced
 *     gate" decision.
 *   - **store variant** →
 *       `status === 'loading'`            → branded splash (no flash of wall)
 *       `status === 'authenticated'`      → children (normal post-auth flow)
 *       `status === 'unauthenticated'`    → the sign-in wall
 *
 * ── PORTAL IS THE SIGN-IN (Option B, owner-ruled 2026-10-17) ──────────────
 * The wall's CTA starts the portal connect-session flow (`signInViaPortal`),
 * which opens the portal in the system browser. Because the wall lives OUTSIDE
 * the navigator it cannot push {@link PendingApprovalScreen}, so it renders its
 * own inline waiting state (spinner + TTL countdown + cancel) driven by the
 * shared `pendingSignIn` state. The retired silent Google attempt and the
 * native Google/Apple buttons are gone: portal sign-in covers both.
 *
 * Sign-out: the gate is driven purely by `status`, so `AuthService.invalidate`
 * / `AuthContext.logout` flipping `status` back to `unauthenticated` lands the
 * user straight back on the wall.
 */

import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useAppTheme } from '../../contexts/ThemeContext';
import { isStoreVariant } from '../../config/appVariant';
import { ThemedView } from '../themed/ThemedView';
import { ThemedText } from '../themed/ThemedText';
import { ThemedButton } from '../themed/ThemedButton';

// ── Component ─────────────────────────────────────────────────────────────

interface AuthGateProps {
  children: React.ReactNode;
}

export const AuthGate: React.FC<AuthGateProps> = ({ children }) => {
  const { status, signInViaPortal, cancelSignIn, pendingSignIn } = useAuth();
  const { theme } = useAppTheme();
  const { t } = useTranslation('auth');

  // Variant is a build-time value; read it per render (test seam friendly).
  const store = isStoreVariant();

  // ── Gating ────────────────────────────────────────────────────────────
  // Full variant: byte-for-byte today's behavior (the gate is a no-op).
  if (!store) {
    return <>{children}</>;
  }

  if (status === 'authenticated') {
    return <>{children}</>;
  }

  if (status === 'loading') {
    return <GateSplash theme={theme} label={t('storeGate_checking')} />;
  }

  const waiting = pendingSignIn !== null && pendingSignIn.status === 'pending';
  const terminal = pendingSignIn !== null && pendingSignIn.status !== 'pending';

  return (
    <ThemedView style={styles.wall} testID="auth-gate-wall">
      <View style={styles.brandBlock}>
        <ThemedText weight="bold" size={34} hierarchy="header" style={styles.brand}>
          {t('storeGate_brand')}
        </ThemedText>
        <ThemedText weight="medium" size={18} variant="primary" style={styles.welcomeTitle}>
          {t('storeGate_welcomeTitle')}
        </ThemedText>
        <ThemedText variant="secondary" size={14} style={styles.welcomeBody}>
          {t('storeGate_welcomeBody')}
        </ThemedText>
      </View>

      <View style={styles.actions}>
        {terminal ? (
          <ThemedText variant="accent" size={13} style={styles.error} testID="auth-gate-error">
            {t('pending_error')}
          </ThemedText>
        ) : null}

        {waiting ? (
          <>
            <ActivityIndicator
              color={theme?.colors.accent.primary ?? '#8f3ba7'}
              testID="auth-gate-waiting-spinner"
            />
            <ThemedText variant="secondary" size={14} style={styles.waitingText} testID="auth-gate-waiting">
              {t('pending_subtitle')}
            </ThemedText>
            {pendingSignIn!.remainingSeconds > 0 ? (
              <ThemedText variant="muted" size={13} style={styles.waitingText}>
                {t('pending_timeLeft', { seconds: pendingSignIn!.remainingSeconds })}
              </ThemedText>
            ) : null}
            <ThemedButton
              label={t('pending_cancel')}
              onPress={cancelSignIn}
              variant="ghost"
              testID="auth-gate-cancel"
            />
          </>
        ) : (
          <ThemedButton
            label={t('signIn_withSoulbits')}
            onPress={() => void signInViaPortal()}
            testID="auth-gate-sign-in"
          />
        )}
      </View>
    </ThemedView>
  );
};

// ── Splash ────────────────────────────────────────────────────────────────

interface GateSplashProps {
  theme: ReturnType<typeof useAppTheme>['theme'];
  label: string;
}

const GateSplash: React.FC<GateSplashProps> = ({ theme, label }) => (
  <ThemedView style={styles.splash} testID="auth-gate-splash">
    <ThemedText weight="bold" size={30} hierarchy="header" style={styles.splashBrand}>
      Soulbits
    </ThemedText>
    <ActivityIndicator
      color={theme?.colors.accent.primary ?? '#8f3ba7'}
      testID="auth-gate-splash-spinner"
    />
    <ThemedText variant="secondary" size={14} style={styles.splashLabel}>
      {label}
    </ThemedText>
  </ThemedView>
);

const styles = StyleSheet.create({
  wall: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  brandBlock: {
    alignItems: 'center',
    marginBottom: 40,
  },
  brand: {
    letterSpacing: 1,
    marginBottom: 12,
  },
  welcomeTitle: {
    textAlign: 'center',
    marginBottom: 8,
  },
  welcomeBody: {
    textAlign: 'center',
    lineHeight: 20,
    opacity: 0.8,
  },
  actions: {
    width: '100%',
    maxWidth: 420,
    gap: 12,
    alignItems: 'center',
  },
  error: {
    textAlign: 'center',
    marginBottom: 4,
  },
  waitingText: {
    textAlign: 'center',
  },
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  splashBrand: {
    letterSpacing: 1,
  },
  splashLabel: {
    textAlign: 'center',
  },
});

export default AuthGate;
