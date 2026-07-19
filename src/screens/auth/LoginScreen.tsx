/**
 * LoginScreen
 *
 * Email/password login screen for Soulbits Cloud authentication.
 * Handles:
 *  - 401 "invalid credentials" → inline error
 *  - 403 "email not verified" → inline VerifyPrompt with resend cooldown
 *  - Google Sign-In via native SDK → `loginWithGoogle(idToken)` (Phase 5-4)
 *  - Apple Sign-In (iOS-only) via native `<AppleButton>` → `loginWithApple(identityToken)` (Phase 5-5)
 *  - Navigation link to RegisterScreen
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Appbar } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppleButton } from '@invertase/react-native-apple-authentication';
import { createLogger } from '../../utils/logger';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { ThemedView } from '../../components/themed/ThemedView';
import { ThemedText } from '../../components/themed/ThemedText';
import { ThemedButton } from '../../components/themed/ThemedButton';
import { ThemedAppbar } from '../../components/themed/ThemedAppbar';
import { VerifyPrompt } from './VerifyPrompt';
import type { RootStackParamList } from '../../navigation/AppNavigator';
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
import { AuthError } from '../../services/auth/AuthService';

const log = createLogger('[LoginScreen]');

export const LoginScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { t } = useTranslation('auth');
  const { login, loginWithGoogle, loginWithApple, status } = useAuth();

  // ── Form state ─────────────────────────────────────────────────────────
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── Error state ────────────────────────────────────────────────────────
  const [loginError, setLoginError] = useState<string | null>(null);
  const [showVerify, setShowVerify] = useState(false);

  // ── Password field ref for "next" focus ────────────────────────────────
  const passwordRef = useRef<TextInput>(null);

  // ── Login handler ──────────────────────────────────────────────────────
  const handleLogin = useCallback(async () => {
    if (!email.trim() || !password) {
      setLoginError(t('loginErrorInvalidCredentials'));
      return;
    }

    setIsSubmitting(true);
    setLoginError(null);
    setShowVerify(false);

    try {
      await login(email.trim(), password);
      // AuthContext flips to authenticated → navigation to cloud flow (Phase 6-2)
      log.info('Login successful for:', email.trim());
    } catch (err: unknown) {
      // Branch on the HTTP status carried by AuthError. The backend 403/401
      // bodies carry their own error strings (not the codes), so substring
      // matching on the message is brittle.
      if (err instanceof AuthError) {
        if (err.status === 403) {
          log.info('Email not verified — showing VerifyPrompt');
          setShowVerify(true);
          setLoginError(t('loginErrorEmailNotVerified'));
        } else if (err.status === 401) {
          setLoginError(t('loginErrorInvalidCredentials'));
        } else {
          log.error('Login failed:', err);
          setLoginError(t('loginErrorGeneric'));
        }
      } else {
        log.error('Login failed:', err);
        setLoginError(t('loginErrorGeneric'));
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [email, password, login, t]);

  // ── Google Sign-In ───────────────────────────────────────────────────

  const handleGoogle = useCallback(async () => {
    setLoginError(null);
    setShowVerify(false);
    setIsSubmitting(true);

    try {
      const idToken = await signInWithGoogle();
      await loginWithGoogle(idToken);
      // AuthContext flips to authenticated → navigation to cloud flow (Phase 6-2)
      log.info('Google Sign-In successful');
    } catch (err: unknown) {
      if (err instanceof GoogleSignInError) {
        switch (err.type) {
          case GoogleSignInErrorType.CANCELLED:
            // Silently dismiss — no error toast
            log.info('Google Sign-In cancelled by user');
            return;

          case GoogleSignInErrorType.PLAY_SERVICES:
            log.warn('Google Sign-In — Play Services unavailable');
            setLoginError(t('googleErrorPlayServices'));
            return;

          case GoogleSignInErrorType.DEVELOPER_ERROR:
            log.warn('Google Sign-In — developer error (SHA-1 / OAuth config)');
            setLoginError(t('googleErrorDeveloperError'));
            return;

          case GoogleSignInErrorType.UNKNOWN:
            log.error('Google Sign-In unknown error:', err.message);
            setLoginError(t('googleErrorGeneric'));
            return;
        }
      }

      // Handle backend 409 conflict (email already registered with another
      // sign-in method). Branch on AuthError.status — the 409 body carries an
      // "already exists" error string (not the status code), so a substring
      // match on "409" would never hit.
      if (err instanceof AuthError && err.status === 409) {
        log.warn('Google Sign-In — email collision (409)');
        setLoginError(t('googleErrorEmailConflict'));
        return;
      }

      // Generic fallback
      log.error('Google Sign-In failed:', err);
      setLoginError(t('googleErrorGeneric'));
    } finally {
      setIsSubmitting(false);
    }
  }, [loginWithGoogle, t]);

  // ── Apple Sign-In (iOS-only) ─────────────────────────────────────────

  const handleApple = useCallback(async () => {
    setLoginError(null);
    setShowVerify(false);
    setIsSubmitting(true);

    try {
      const identityToken = await signInWithApple();
      await loginWithApple(identityToken);
      // AuthContext flips to authenticated → navigation to cloud flow (Phase 6-2)
      log.info('Apple Sign-In successful');
    } catch (err: unknown) {
      if (err instanceof AppleSignInError) {
        switch (err.type) {
          case AppleSignInErrorType.CANCELLED:
            // Silently dismiss — no error toast
            log.info('Apple Sign-In cancelled by user');
            return;

          case AppleSignInErrorType.NOT_CONFIGURED:
            log.warn('Apple Sign-In — not configured or not available');
            setLoginError(t('appleErrorNotConfigured'));
            return;

          case AppleSignInErrorType.UNKNOWN:
            log.error('Apple Sign-In unknown error:', err.message);
            setLoginError(t('appleErrorGeneric'));
            return;
        }
      }

      // Handle backend 409 conflict (email already registered with another
      // sign-in method). Branch on AuthError.status — the 409 body carries an
      // "already exists" error string (not the status code), so a substring
      // match on "409" would never hit.
      if (err instanceof AuthError && err.status === 409) {
        log.warn('Apple Sign-In — email collision (409)');
        setLoginError(t('appleErrorEmailConflict'));
        return;
      }

      // Generic fallback
      log.error('Apple Sign-In failed:', err);
      setLoginError(t('appleErrorGeneric'));
    } finally {
      setIsSubmitting(false);
    }
  }, [loginWithApple, t]);

  // ── Render guard ───────────────────────────────────────────────────────
  if (!theme) return null;

  // ── Derived styles ─────────────────────────────────────────────────────
  const inputStyle = {
    color: theme.colors.text.primary,
    borderColor: theme.colors.border.default,
    backgroundColor: theme.colors.background.base,
  };

  return (
    <ThemedView style={styles.container}>
      {/* ── Header ── */}
      <ThemedAppbar style={styles.header}>
        <Appbar.BackAction
          color={theme.colors.text.primary}
          onPress={() => navigation.goBack()}
        />
        <Appbar.Content
          title={t('login_title')}
          titleStyle={{
            color: theme.colors.text.primary,
            fontWeight: 'bold',
          }}
        />
      </ThemedAppbar>

      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: 40 + safeBottom },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Title / Subtitle ── */}
          <View style={styles.headerSection}>
            <ThemedText variant="secondary" style={styles.subtitle}>
              {t('login_subtitle')}
            </ThemedText>
          </View>

          {/* ── Email field ── */}
          <View style={styles.fieldGroup}>
            <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
              {t('emailLabel')}
            </ThemedText>
            <TextInput
              style={[styles.input, inputStyle]}
              value={email}
              onChangeText={setEmail}
              placeholder={t('emailPlaceholder')}
              placeholderTextColor={theme.colors.text.muted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              editable={!isSubmitting}
            />
          </View>

          {/* ── Password field ── */}
          <View style={styles.fieldGroup}>
            <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
              {t('passwordLabel')}
            </ThemedText>
            <TextInput
              ref={passwordRef}
              style={[styles.input, inputStyle]}
              value={password}
              onChangeText={setPassword}
              placeholder={t('passwordPlaceholder')}
              placeholderTextColor={theme.colors.text.muted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="password"
              returnKeyType="go"
              onSubmitEditing={handleLogin}
              editable={!isSubmitting}
            />
          </View>

          {/* ── Error message ── */}
          {loginError && !showVerify && (
            <ThemedText variant="accent" style={styles.errorText}>
              {loginError}
            </ThemedText>
          )}

          {/* ── Sign In button ── */}
          <ThemedButton
            label={
              isSubmitting ? t('loginLoading') : t('loginButton')
            }
            onPress={handleLogin}
            disabled={isSubmitting || status === 'loading'}
            style={styles.primaryButton}
          />

          {/* ── VerifyPrompt (shown on 403 "email not verified") ── */}
          {showVerify && (
            <VerifyPrompt email={email.trim()} />
          )}

          {/* ── Social login section ── */}
          <View style={styles.socialSection}>
            <View style={styles.dividerRow}>
              <View
                style={[
                  styles.divider,
                  { backgroundColor: theme.colors.border.default },
                ]}
              />
              <ThemedText
                size={12}
                variant="muted"
                style={styles.dividerText}
              >
                {t('login_orDivider')}
              </ThemedText>
              <View
                style={[
                  styles.divider,
                  { backgroundColor: theme.colors.border.default },
                ]}
              />
            </View>

            <ThemedButton
              label={t('googleButtonLabel')}
              onPress={handleGoogle}
              variant="outline"
              disabled={isSubmitting || status === 'loading'}
              style={styles.socialButton}
            />

            {/* Apple Sign-In — iOS only, uses native <AppleButton> */}
            {Platform.OS === 'ios' && !isSubmitting && (
              <AppleButton
                buttonType={AppleButton.Type.SIGN_IN}
                buttonStyle={AppleButton.Style.BLACK}
                style={styles.appleButton}
                onPress={handleApple}
              />
            )}
          </View>

          {/* ── Link to Register ── */}
          <View style={styles.footerSection}>
            <ThemedText variant="secondary" size={13}>
              {t('loginLinkRegister')}
            </ThemedText>
            <ThemedButton
              label={t('register_title')}
              onPress={() => navigation.navigate('Register')}
              variant="ghost"
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    elevation: 0,
  },
  keyboardAvoid: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
  },
  headerSection: {
    marginBottom: 24,
    alignItems: 'center',
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    opacity: 0.8,
  },
  fieldGroup: {
    marginBottom: 16,
  },
  fieldLabel: {
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 44,
  },
  errorText: {
    fontSize: 13,
    marginBottom: 12,
    textAlign: 'center',
  },
  primaryButton: {
    marginTop: 8,
  },
  socialSection: {
    marginTop: 24,
    gap: 12,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  divider: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  dividerText: {
    marginHorizontal: 12,
    opacity: 0.6,
  },
  socialButton: {
    opacity: 0.6,
  },
  appleButton: {
    width: '100%',
    height: 44,
  },
  footerSection: {
    marginTop: 32,
    alignItems: 'center',
    gap: 4,
  },
});
