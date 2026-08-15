/**
 * DeviceAuthModal — 6-digit email auth-code entry for device authorization
 * (D-DEV-01).
 *
 * Shown when POST /v1/session/connect returns 403
 * {"error":"device_authorization_required"}: the broker refuses to provision a
 * session for an unknown/unauthorized device until the user proves ownership
 * via a 6-digit code emailed by SES. Flow:
 *
 *   1. requestCode()  → the auth-service mails the code (202)
 *   2. user enters the 6 digits — OR approves on the portal; the 5 s
 *      auto-resolve poll (getStatus) detects it and closes the modal via
 *      onVerified() without manual entry.
 *   3. verifyCode()   → 200: onVerified() (the caller retries /connect)
 *                       401: "invalid code"
 *                       429: "too many attempts, try later"
 *
 * Poll errors are non-fatal (network blips): only 404/400 (unknown device /
 * bad request) surface as the existing error UI; transient 5xx/429 are
 * ignored so the poll keeps running until the 10-min secret TTL expires.
 * Manual code entry + resend stay fully functional as the fallback path.
 *
 * Matches the app's existing VerifyPrompt resend-cooldown pattern and the
 * themed design system (no new UI framework).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, View, StyleSheet, TextInput } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { ThemedView } from '../themed/ThemedView';
import { ThemedButton } from '../themed/ThemedButton';
import DeviceAuthService, { DeviceAuthError } from '../../services/cloud/DeviceAuthService';
import { createLogger } from '../../utils/logger';

const log = createLogger('[DeviceAuthModal]');

/** Auto-resolve poll interval (ms) while the modal is visible. */
const POLL_INTERVAL_MS = 5000;

interface DeviceAuthModalProps {
  visible: boolean;
  /** Called after a successful code verification — the caller retries /connect. */
  onVerified: () => void;
  /** Called when the user dismisses the modal without authorizing. */
  onDismiss: () => void;
}

export const DeviceAuthModal: React.FC<DeviceAuthModalProps> = ({
  visible,
  onVerified,
  onDismiss,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('auth');

  const [code, setCode] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codeSent, setCodeSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Resend cooldown countdown (VerifyPrompt pattern) ────────────────────
  const startCooldown = useCallback((seconds: number) => {
    setCooldown(seconds);
    if (timerRef.current) clearInterval(timerRef.current);
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

  // ── Request the code on first show ───────────────────────────────────────
  const requestCode = useCallback(async () => {
    if (isSending) return;
    setIsSending(true);
    setError(null);
    try {
      await DeviceAuthService.requestCode();
      setCodeSent(true);
      startCooldown(60); // per-email request limit — resend cooldown
      log.info('Device auth code requested');
    } catch (err: unknown) {
      log.error('Failed to request device auth code:', err);
      if (err instanceof DeviceAuthError && err.status === 429) {
        setError(t('deviceAuth_rateLimited'));
      } else {
        setError(t('deviceAuth_requestError'));
      }
    } finally {
      setIsSending(false);
    }
  }, [isSending, startCooldown, t]);

  // Auto-request the code the first time the modal is shown.
  useEffect(() => {
    if (visible && !codeSent && !isSending) {
      requestCode();
    }
  }, [visible, codeSent, isSending, requestCode]);

  // ── Auto-resolve polling (Phase 4-2) ──────────────────────────────────
  // While the modal is visible, poll the backend every 5 s for the device's
  // authorization state. When the user approves on the portal (email button →
  // "Open in the app", or directly on the portal page), `authorized` flips
  // true and the modal closes itself via onVerified() — no manual code entry
  // needed. Poll errors are NON-fatal: transient 5xx/429 keep the loop going;
  // only 404/400 (unknown device / bad request) surface the existing error UI.
  // Bounded implicitly by the backend's 10-min secret TTL, after which the
  // resend button restarts the flow.
  useEffect(() => {
    if (!visible) return;
    const interval = setInterval(async () => {
      try {
        const s = await DeviceAuthService.getStatus();
        if (s.authorized) {
          clearInterval(interval);
          log.info('Device authorized via portal — auto-resolving');
          onVerified();
        }
      } catch (err: unknown) {
        if (err instanceof DeviceAuthError && (err.status === 404 || err.status === 400)) {
          log.error('Device auth status poll failed:', err);
          setError(t('deviceAuth_requestError'));
        } else {
          log.debug('Device auth status poll transient error — keeping polling:', err);
        }
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [visible, onVerified, t]);

  // Cleanup the cooldown timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  // Reset state when the modal is dismissed.
  useEffect(() => {
    if (!visible) {
      setCode('');
      setError(null);
      setCodeSent(false);
    }
  }, [visible]);

  // ── Verify handler ──────────────────────────────────────────────────────
  const handleVerify = useCallback(async () => {
    if (isVerifying || code.trim().length !== 6) return;
    setIsVerifying(true);
    setError(null);
    try {
      await DeviceAuthService.verifyCode(code);
      log.info('Device authorized — retrying connect');
      onVerified();
    } catch (err: unknown) {
      if (err instanceof DeviceAuthError) {
        if (err.status === 401) {
          setError(t('deviceAuth_invalidCode'));
          setCode('');
        } else if (err.status === 429) {
          setError(t('deviceAuth_tooManyAttempts'));
        } else {
          setError(t('deviceAuth_verifyError'));
        }
      } else {
        setError(t('deviceAuth_verifyError'));
      }
    } finally {
      setIsVerifying(false);
    }
  }, [code, isVerifying, onVerified, t]);

  if (!theme) return null;

  const inputStyle = {
    color: theme.colors.text.primary,
    borderColor: theme.colors.border.default,
    backgroundColor: theme.colors.background.base,
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <View style={styles.overlay}>
        <ThemedView style={styles.modal}>
          <ThemedText size={20} weight="bold" style={styles.title}>
            {t('deviceAuth_title')}
          </ThemedText>

          <ThemedText variant="secondary" style={styles.description}>
            {t('deviceAuth_message')}
          </ThemedText>

          {/* ── 6-digit code input ── */}
          <TextInput
            style={[styles.codeInput, inputStyle]}
            value={code}
            onChangeText={text => {
              setError(null);
              setCode(text.replace(/[^0-9]/g, '').slice(0, 6));
            }}
            placeholder="••••••"
            placeholderTextColor={theme.colors.text.muted}
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
            editable={!isVerifying}
            textAlign="center"
          />

          {error && (
            <ThemedText variant="accent" style={styles.errorText}>
              {error}
            </ThemedText>
          )}

          {codeSent && (
            <ThemedText variant="secondary" size={12} style={styles.hint}>
              {t('deviceAuth_codeSentHint')}
            </ThemedText>
          )}

          {/* Auto-resolve hint (Phase 4-2): shown while the 5 s status poll
              is active so the user knows the modal closes by itself once the
              device is authorized on the portal. */}
          {visible && codeSent && (
            <ThemedText variant="secondary" size={12} style={styles.hint}>
              {t('deviceAuth_waitingHint')}
            </ThemedText>
          )}

          {/* ── Verify + resend ── */}
          <View style={styles.buttonContainer}>
            <ThemedButton
              label={
                isVerifying ? t('deviceAuth_verifying') : t('deviceAuth_submit')
              }
              onPress={handleVerify}
              disabled={isVerifying || code.trim().length !== 6}
              style={styles.submitButton}
            />
            <ThemedButton
              label={
                cooldown > 0
                  ? t('deviceAuth_resendCooldown', { seconds: cooldown })
                  : isSending
                    ? t('deviceAuth_resendSending')
                    : t('deviceAuth_resend')
              }
              onPress={requestCode}
              variant="outline"
              disabled={cooldown > 0 || isSending}
              style={styles.resendButton}
            />
            <ThemedButton
              label={t('deviceAuth_cancel')}
              onPress={onDismiss}
              variant="ghost"
            />
          </View>
        </ThemedView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modal: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 16,
    padding: 20,
    gap: 10,
  },
  title: {
    fontSize: 20,
    textAlign: 'center',
  },
  description: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  codeInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    fontSize: 22,
    fontWeight: '600',
    minHeight: 52,
    marginTop: 4,
    letterSpacing: 14,
  },
  errorText: {
    fontSize: 13,
    textAlign: 'center',
  },
  hint: {
    fontSize: 12,
    textAlign: 'center',
    opacity: 0.8,
  },
  buttonContainer: {
    gap: 8,
    marginTop: 6,
  },
  submitButton: {
    marginTop: 4,
  },
  resendButton: {
    marginTop: 2,
  },
});
