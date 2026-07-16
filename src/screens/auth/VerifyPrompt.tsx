/**
 * VerifyPrompt
 *
 * Inline email-verification prompt shown when the backend returns 403
 * "email not verified" on login.  Provides a resend button that honours
 * the 429 `retry_after` cooldown.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { createLogger } from '../../utils/logger';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../../components/themed/ThemedText';
import { ThemedView } from '../../components/themed/ThemedView';
import { ThemedButton } from '../../components/themed/ThemedButton';
import AuthService from '../../services/auth/AuthService';

const log = createLogger('[VerifyPrompt]');

interface VerifyPromptProps {
  /** The email address to resend the verification to. */
  email: string;
}

export const VerifyPrompt: React.FC<VerifyPromptProps> = ({ email }) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('auth');

  // ── Resend cooldown state ──────────────────────────────────────────────
  const [cooldown, setCooldown] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Cleanup timer on unmount ───────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  // ── Start countdown ────────────────────────────────────────────────────
  const startCooldown = useCallback((seconds: number) => {
    setCooldown(seconds);

    timerRef.current = setInterval(() => {
      setCooldown(prev => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  // ── Resend handler ─────────────────────────────────────────────────────
  const handleResend = useCallback(async () => {
    if (isSending || cooldown > 0) return;

    setIsSending(true);
    setError(null);
    setSuccess(false);

    try {
      const result = await AuthService.resendVerification(email);
      if (result.retryAfter) {
        startCooldown(result.retryAfter);
      } else {
        startCooldown(60); // Default cooldown if 429 wasn't returned
      }
      setSuccess(true);
      log.info('Verification email resent to:', email);
    } catch (err: unknown) {
      log.error('Failed to resend verification:', err);
      setError(t('verify_resendError'));
    } finally {
      setIsSending(false);
    }
  }, [email, isSending, cooldown, startCooldown, t]);

  if (!theme) return null;

  return (
    <ThemedView variant="surface" style={styles.container}>
      <ThemedText weight="bold" variant="accent" style={styles.title}>
        {t('verify_title')}
      </ThemedText>

      <ThemedText variant="secondary" style={styles.message}>
        {t('verify_message')}
      </ThemedText>

      {success && (
        <ThemedText variant="success" style={styles.successText}>
          {t('verify_resendSuccess')}
        </ThemedText>
      )}

      {error && (
        <ThemedText variant="accent" style={styles.errorText}>
          {error}
        </ThemedText>
      )}

      <ThemedButton
        label={
          cooldown > 0
            ? t('verify_resendCooldown', { seconds: cooldown })
            : isSending
              ? t('verify_resendSending')
              : t('verify_resendButton')
        }
        onPress={handleResend}
        variant="outline"
        disabled={cooldown > 0 || isSending}
        style={styles.resendButton}
      />
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    borderRadius: 12,
    marginTop: 16,
    gap: 8,
  },
  title: {
    fontSize: 15,
    marginBottom: 4,
  },
  message: {
    fontSize: 13,
    lineHeight: 18,
  },
  successText: {
    fontSize: 13,
  },
  errorText: {
    fontSize: 13,
  },
  resendButton: {
    marginTop: 8,
  },
});
