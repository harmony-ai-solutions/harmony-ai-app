/**
 * RegisterScreen
 *
 * Email/password/display_name registration for Soulbits Cloud.
 * On success (backend returns 202 → verification email sent) navigates to
 * a "check your inbox" confirmation state.
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Appbar } from 'react-native-paper';
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
import { ThemedAppbar } from '../../components/themed/ThemedAppbar';
import { AuthError } from '../../services/auth/AuthService';
import type { RootStackParamList } from '../../navigation/AppNavigator';

const log = createLogger('[RegisterScreen]');

export const RegisterScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { t } = useTranslation('auth');
  const { register } = useAuth();

  // ── Form state ─────────────────────────────────────────────────────────
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── Feedback state ─────────────────────────────────────────────────────
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);

  // ── Field refs for "next" focus ────────────────────────────────────────
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const displayNameRef = useRef<TextInput>(null);

  // ── Register handler ───────────────────────────────────────────────────
  const handleRegister = useCallback(async () => {
    if (!email.trim() || !password || !displayName.trim()) {
      setError(t('registerErrorGeneric'));
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await register(email.trim(), password, displayName.trim());
      // Backend returns 202 — verification email sent. Show confirmation.
      setRegistered(true);
      log.info('Registration successful for:', email.trim());
    } catch (err: unknown) {
      // Branch on the HTTP status carried by AuthError (409 = email taken).
      if (err instanceof AuthError && err.status === 409) {
        setError(t('registerErrorEmailTaken'));
      } else {
        log.error('Registration failed:', err);
        setError(t('registerErrorGeneric'));
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [email, password, displayName, register, t]);

  // ── Render guard ───────────────────────────────────────────────────────
  if (!theme) return null;

  // ── Derived styles ─────────────────────────────────────────────────────
  const inputStyle = {
    color: theme.colors.text.primary,
    borderColor: theme.colors.border.default,
    backgroundColor: theme.colors.background.base,
  };

  // ── "Check your inbox" confirmation state ──────────────────────────────
  if (registered) {
    return (
      <ThemedView style={styles.container}>
        <ThemedAppbar style={styles.header}>
          <Appbar.BackAction
            color={theme.colors.text.primary}
            onPress={() => navigation.goBack()}
          />
          <Appbar.Content
            title={t('register_title')}
            titleStyle={{
              color: theme.colors.text.primary,
              fontWeight: 'bold',
            }}
          />
        </ThemedAppbar>

        <View style={styles.confirmationContainer}>
          <ThemedText weight="bold" variant="accent" style={styles.confirmationTitle}>
            {t('registerSuccessCheckInbox')}
          </ThemedText>

          <ThemedText variant="secondary" style={styles.confirmationMessage}>
            {t('registerSuccessMessage', { email: email.trim() })}
          </ThemedText>

          <ThemedButton
            label={t('login_title')}
            onPress={() => navigation.navigate('Login')}
            style={styles.confirmationButton}
          />
        </View>
      </ThemedView>
    );
  }

  // ── Registration form ──────────────────────────────────────────────────
  return (
    <ThemedView style={styles.container}>
      {/* ── Header ── */}
      <ThemedAppbar style={styles.header}>
        <Appbar.BackAction
          color={theme.colors.text.primary}
          onPress={() => navigation.goBack()}
        />
        <Appbar.Content
          title={t('register_title')}
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
              {t('register_subtitle')}
            </ThemedText>
          </View>

          {/* ── Display Name field ── */}
          <View style={styles.fieldGroup}>
            <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
              {t('displayNameLabel')}
            </ThemedText>
            <TextInput
              ref={displayNameRef}
              style={[styles.input, inputStyle]}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder={t('displayNamePlaceholder')}
              placeholderTextColor={theme.colors.text.muted}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="next"
              onSubmitEditing={() => emailRef.current?.focus()}
              editable={!isSubmitting}
            />
          </View>

          {/* ── Email field ── */}
          <View style={styles.fieldGroup}>
            <ThemedText size={13} variant="secondary" style={styles.fieldLabel}>
              {t('emailLabel')}
            </ThemedText>
            <TextInput
              ref={emailRef}
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
              autoComplete="new-password"
              returnKeyType="go"
              onSubmitEditing={handleRegister}
              editable={!isSubmitting}
            />
          </View>

          {/* ── Error message ── */}
          {error && (
            <ThemedText variant="accent" style={styles.errorText}>
              {error}
            </ThemedText>
          )}

          {/* ── Register button ── */}
          <ThemedButton
            label={
              isSubmitting ? t('registerLoading') : t('registerButton')
            }
            onPress={handleRegister}
            disabled={isSubmitting}
            style={styles.primaryButton}
          />

          {/* ── Link to Login ── */}
          <View style={styles.footerSection}>
            <ThemedText variant="secondary" size={13}>
              {t('registerLinkLogin')}
            </ThemedText>
            <ThemedButton
              label={t('login_title')}
              onPress={() => navigation.navigate('Login')}
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
  footerSection: {
    marginTop: 32,
    alignItems: 'center',
    gap: 4,
  },
  // ── Confirmation state ──
  confirmationContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 12,
  },
  confirmationTitle: {
    fontSize: 20,
    textAlign: 'center',
  },
  confirmationMessage: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    opacity: 0.8,
  },
  confirmationButton: {
    marginTop: 16,
    minWidth: 200,
  },
});
