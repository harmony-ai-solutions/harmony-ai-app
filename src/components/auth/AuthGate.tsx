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
 *       silent attempt in flight          → branded splash
 *       `status === 'authenticated'`      → children (normal post-auth flow)
 *       `status === 'unauthenticated'`    → the sign-in wall
 *
 * Silent attempt (ruling 1: silent → forced wall): at the FIRST auth state in
 * which bootstrap has settled, if it is `unauthenticated` (a cold start without
 * a session) we make ONE silent sign-in attempt via
 * {@link attemptSilentSignIn} (Android Google `signInSilently`; iOS wall-only —
 * see that module). The credential is handed to the EXISTING
 * `AuthContext.loginWithGoogle`, so the post-auth flow is reused untouched —
 * the gate forks nothing.
 *
 * Sign-out: the gate is driven purely by `status`, so `AuthService.invalidate`
 * / `AuthContext.logout` flipping `status` back to `unauthenticated` lands the
 * user straight back on the wall. The silent attempt is a COLD-START-ONLY
 * decision (guarded by a ref): a session present at launch means no attempt
 * ever this session, so a later sign-out can never be silently undone.
 *
 * The wall is the reliable floor: it works on both platforms regardless of the
 * silent path's outcome.
 */

import React, { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AppleButton } from '@invertase/react-native-apple-authentication';
import { useAuth } from '../../contexts/AuthContext';
import { useAppTheme } from '../../contexts/ThemeContext';
import { isStoreVariant } from '../../config/appVariant';
import { ThemedView } from '../themed/ThemedView';
import { ThemedText } from '../themed/ThemedText';
import { ThemedButton } from '../themed/ThemedButton';
import { createLogger } from '../../utils/logger';
import {
  signInWithGoogle,
  GoogleSignInError,
  GoogleSignInErrorType,
} from '../../services/auth/googleSignIn';
import {
  signInWithApple,
  AppleSignInError,
  AppleSignInErrorType,
} from '../../services/auth/appleSignIn';
import { attemptSilentSignIn } from '../../services/auth/silentSignIn';
import { AuthError } from '../../services/auth/AuthService';

const log = createLogger('[AuthGate]');

// ── Error → wall copy ─────────────────────────────────────────────────────

/**
 * Map a Google sign-in failure to wall copy. Returns `null` when the flow was
 * cancelled — cancellation is not an error and must not surface any message
 * (the buttons simply stay tappable = retryable).
 */
function googleErrorMessage(err: unknown, t: TFunction): string | null {
  if (err instanceof GoogleSignInError) {
    switch (err.type) {
      case GoogleSignInErrorType.CANCELLED:
        return null;
      case GoogleSignInErrorType.PLAY_SERVICES:
        return t('googleErrorPlayServices');
      case GoogleSignInErrorType.DEVELOPER_ERROR:
        return t('googleErrorDeveloperError');
      case GoogleSignInErrorType.UNKNOWN:
      default:
        return t('googleErrorGeneric');
    }
  }

  if (err instanceof AuthError) {
    if (err.status === 403) return t('loginErrorEmailNotVerified');
    if (err.status === 409) return t('googleErrorEmailConflict');
    if (err.status === 401) return t('loginErrorInvalidCredentials');
    return t('googleErrorGeneric');
  }

  return t('googleErrorGeneric');
}

/**
 * Map an Apple sign-in failure to wall copy. Returns `null` when the user
 * cancelled (retryable, no message).
 */
function appleErrorMessage(err: unknown, t: TFunction): string | null {
  if (err instanceof AppleSignInError) {
    switch (err.type) {
      case AppleSignInErrorType.CANCELLED:
        return null;
      case AppleSignInErrorType.NOT_CONFIGURED:
        return t('appleErrorNotConfigured');
      case AppleSignInErrorType.UNKNOWN:
      default:
        return t('appleErrorGeneric');
    }
  }

  if (err instanceof AuthError) {
    if (err.status === 409) return t('appleErrorEmailConflict');
    if (err.status === 403) return t('loginErrorEmailNotVerified');
    return t('appleErrorGeneric');
  }

  return t('appleErrorGeneric');
}

// ── Component ─────────────────────────────────────────────────────────────

interface AuthGateProps {
  children: ReactNode;
}

export const AuthGate: React.FC<AuthGateProps> = ({ children }) => {
  const { status, loginWithGoogle, loginWithApple } = useAuth();
  const { theme } = useAppTheme();
  const { t } = useTranslation('auth');

  // Variant is a build-time value; read it per render (test seam friendly).
  const store = isStoreVariant();

  const [launchPhase, setLaunchPhase] = useState<'pending' | 'checking' | 'settled'>('pending');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The launch decision is made ONCE per app session, at the first render in
  // which auth bootstrap has settled. This is what prevents a deliberate
  // sign-out from being silently undone by a later silent attempt.
  const launchDecidedRef = useRef(false);

  // ── Silent attempt (store only, cold start without a session) ─────────
  useEffect(() => {
    if (!store) return;
    if (status === 'loading') return; // wait for auth bootstrap to settle
    if (launchDecidedRef.current) return; // launch decision already made
    launchDecidedRef.current = true;

    // A session was restored at cold start → no silent attempt, ever this
    // session (a later sign-out must land on the wall, not re-auth).
    if (status !== 'unauthenticated') {
      setLaunchPhase('settled');
      return;
    }

    // Cold start with no session → ONE silent restore attempt. Stay on the
    // splash until it settles so the wall never flashes before a restore that
    // is about to succeed.
    setLaunchPhase('checking');
    (async () => {
      let idToken: string | null = null;
      try {
        idToken = await attemptSilentSignIn();
      } catch {
        idToken = null; // defensive — attemptSilentSignIn already never throws
      }
      if (idToken) {
        try {
          // EXISTING auth path — no parallel token handling.
          await loginWithGoogle(idToken);
        } catch (err) {
          log.warn(
            'Silent sign-in credential was rejected — showing the wall:',
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      setLaunchPhase('settled');
    })();
  }, [store, status, loginWithGoogle]);

  // ── Wall action handlers ──────────────────────────────────────────────
  const handleGoogle = useCallback(async () => {
    setError(null);
    setSubmitting(true);
    try {
      const idToken = await signInWithGoogle();
      await loginWithGoogle(idToken);
    } catch (err) {
      setError(googleErrorMessage(err, t));
    } finally {
      setSubmitting(false);
    }
  }, [loginWithGoogle, t]);

  const handleApple = useCallback(async () => {
    setError(null);
    setSubmitting(true);
    try {
      const identityToken = await signInWithApple();
      await loginWithApple(identityToken);
    } catch (err) {
      setError(appleErrorMessage(err, t));
    } finally {
      setSubmitting(false);
    }
  }, [loginWithApple, t]);

  // ── Gating ────────────────────────────────────────────────────────────
  // Full variant: byte-for-byte today's behavior (the gate is a no-op).
  if (!store) {
    return <>{children}</>;
  }

  if (status === 'authenticated') {
    return <>{children}</>;
  }

  // 'loading' (bootstrap) and a not-yet-settled launch decision (pending or a
  // silent attempt in flight) both show the branded splash — never a
  // premature flash of the wall.
  if (status === 'loading' || launchPhase !== 'settled') {
    return <GateSplash theme={theme} label={t('storeGate_checking')} />;
  }

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
        {error ? (
          <ThemedText variant="accent" size={13} style={styles.error} testID="auth-gate-error">
            {error}
          </ThemedText>
        ) : null}

        <ThemedButton
          label={submitting ? t('storeGate_signingIn') : t('googleButtonLabel')}
          onPress={handleGoogle}
          disabled={submitting}
          testID="auth-gate-google"
        />

        {/* Apple Sign-In — iOS only, matching AuthService availability. */}
        {Platform.OS === 'ios' && !submitting ? (
          <View testID="auth-gate-apple" style={styles.appleWrap}>
            <AppleButton
              buttonType={AppleButton.Type.SIGN_IN}
              buttonStyle={AppleButton.Style.BLACK}
              style={styles.appleButton}
              onPress={handleApple}
            />
          </View>
        ) : null}
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
  },
  error: {
    textAlign: 'center',
    marginBottom: 4,
  },
  appleWrap: {
    width: '100%',
  },
  appleButton: {
    width: '100%',
    height: 44,
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
