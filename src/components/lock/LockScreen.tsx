/**
 * LockScreen
 *
 * Full-screen overlay displayed when the app is locked via biometric/PIN.
 * Shows a branded unlock prompt with biometric button or PIN entry.
 */
import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useBiometricLock } from '../../contexts/BiometricLockContext';
import { ThemedView } from '../themed/ThemedView';
import { ThemedText } from '../themed/ThemedText';
import { ThemedGradient } from '../themed/ThemedGradient';
import { ThemedButton } from '../themed/ThemedButton';
import { hexToRgba } from '../../utils/colorUtils';
import { hapticLightPress } from '../../utils/haptics';

export const LockScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const { lockMode, unlock } = useBiometricLock();
  const { t } = useTranslation('settings');
  const insets = useSafeAreaInsets();

  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [showPinEntry, setShowPinEntry] = useState(false);
  const [biometricAttempted, setBiometricAttempted] = useState(false);

  // Auto-trigger biometric on mount (when biometric mode)
  useEffect(() => {
    if (lockMode === 'biometric' && !biometricAttempted && !showPinEntry) {
      setBiometricAttempted(true);
      handleBiometricUnlock();
    }
  }, [lockMode, biometricAttempted, showPinEntry]);

  const handleBiometricUnlock = useCallback(async () => {
    setIsAuthenticating(true);
    const success = await unlock();
    if (!success) {
      // User cancelled or biometric failed — they can use PIN fallback
    }
    setIsAuthenticating(false);
  }, [unlock]);

  const handleUsePinFallback = useCallback(() => {
    setShowPinEntry(true);
  }, []);

  const handlePinSubmit = useCallback(async () => {
    if (pin.length < 4) return;
    setIsAuthenticating(true);
    const success = await unlock(pin);
    if (!success) {
      setPinError(true);
      setPin('');
    }
    setIsAuthenticating(false);
  }, [pin, unlock]);

  const handlePinChange = useCallback((value: string) => {
    const filtered = value.replace(/[^0-9]/g, '').slice(0, 6);
    setPin(filtered);
    setPinError(false);
  }, []);

  if (!theme) return null;

  return (
    <View style={styles.overlay}>
      {/* Background gradient */}
      <LinearGradient
        colors={[theme.colors.background.base, theme.colors.background.elevated]}
        style={StyleSheet.absoluteFill}
      />

      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={[styles.content, { paddingTop: insets.top + 60 }]}>
          {/* Icon */}
          <View style={styles.iconWrapper}>
            <ThemedGradient gradient="primary" style={styles.iconRing}>
              <ThemedView variant="elevated" style={styles.iconInner}>
                <Icon
                  name={lockMode === 'biometric' ? 'fingerprint' : 'lock'}
                  size={48}
                  color={theme.colors.accent.primary}
                />
              </ThemedView>
            </ThemedGradient>
          </View>

          {/* Title */}
          <ThemedText
            variant="primary"
            size={24}
            weight="bold"
            hierarchy="header"
            style={styles.title}
          >
            {t('biometricLockTitle')}
          </ThemedText>

          <ThemedText
            variant="secondary"
            size={14}
            hierarchy="subtext"
            style={styles.subtitle}
          >
            {t('biometricLockSubtitle')}
          </ThemedText>

          {/* Action area */}
          <View style={styles.actionArea}>
            {lockMode === 'biometric' && !showPinEntry ? (
              <>
                {/* Biometric unlock — ThemedButton secondary (glass outline) */}
                <ThemedButton
                  label={isAuthenticating ? t('authenticating') : t('biometricUnlock')}
                  variant="secondary"
                  icon="fingerprint"
                  onPress={handleBiometricUnlock}
                  disabled={isAuthenticating}
                  style={styles.biometricButton}
                />

                {/* PIN fallback — ghost style */}
                <TouchableOpacity
                  style={styles.ghostFallbackButton}
                  onPress={() => {
                    hapticLightPress();
                    handleUsePinFallback();
                  }}
                  activeOpacity={0.7}
                >
                  <ThemedText variant="muted" size={14}>
                    {t('usePinInstead')}
                  </ThemedText>
                </TouchableOpacity>
              </>
            ) : (
              /* PIN entry */
              <View style={styles.pinSection}>
                <View style={styles.pinInputRow}>
                  <TextInput
                    style={[
                      styles.pinInput,
                      {
                        color: theme.colors.text.primary,
                        borderColor: pinError
                          ? theme.colors.status?.error ?? '#f44336'
                          : theme.colors.border.default,
                        backgroundColor: theme.colors.background.base,
                      },
                    ]}
                    value={pin}
                    onChangeText={handlePinChange}
                    placeholder={t('enterPin')}
                    placeholderTextColor={theme.colors.text.muted}
                    keyboardType="number-pad"
                    maxLength={6}
                    secureTextEntry
                    autoFocus
                  />
                  {/* PIN submit — solid accent button */}
                  <TouchableOpacity
                    onPress={() => {
                      hapticLightPress();
                      handlePinSubmit();
                    }}
                    disabled={pin.length < 4 || isAuthenticating}
                    activeOpacity={0.8}
                    style={[
                      styles.pinSubmitButton,
                      {
                        backgroundColor:
                          pin.length >= 4
                            ? theme.colors.accent.primary
                            : theme.colors.text.muted,
                        shadowColor: pin.length >= 4 ? theme.colors.accent.primary : 'transparent',
                      },
                    ]}
                  >
                    <Icon name="arrow-right" size={22} color="#fff" />
                  </TouchableOpacity>
                </View>
                {pinError && (
                  <ThemedText
                    variant="primary"
                    size={13}
                    style={[styles.pinError, { color: theme.colors.status?.error ?? '#f44336' }]}
                  >
                    {t('incorrectPin')}
                  </ThemedText>
                )}
                {lockMode === 'biometric' && (
                  <TouchableOpacity
                    style={styles.ghostFallbackButton}
                    onPress={() => {
                      hapticLightPress();
                      setShowPinEntry(false);
                      setPin('');
                      setPinError(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <Icon name="fingerprint" size={16} color={theme.colors.accent.primary} />
                    <ThemedText variant="accent" size={14}>
                      {t('useFingerprint')}
                    </ThemedText>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 9999,
  },
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: 'center',
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
  title: {
    textAlign: 'center',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  subtitle: {
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 40,
  },
  actionArea: {
    width: '100%',
    alignItems: 'center',
  },
  // ── Biometric button ────────────────────────────────────────────
  biometricButton: {
    maxWidth: 260,
    alignSelf: 'center',
  },
  // ── Ghost fallback button (PIN / fingerprint switch) ────────────
  ghostFallbackButton: {
    marginTop: 24,
    paddingVertical: 10,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
  },
  // ── PIN entry ───────────────────────────────────────────────────
  pinSection: {
    width: '100%',
    alignItems: 'center',
    gap: 12,
  },
  pinInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    maxWidth: 280,
  },
  pinInput: {
    flex: 1,
    height: 52,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 20,
    textAlign: 'center',
    letterSpacing: 8,
  },
  pinSubmitButton: {
    width: 52,
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  pinError: {
    textAlign: 'center',
  },
});

export default LockScreen;
