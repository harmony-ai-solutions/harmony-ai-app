/**
 * PinSetupModal
 *
 * Shown when the user enables biometric lock but biometric auth is unavailable.
 * Prompts the user to set a 4-6 digit PIN that will be used for lock/unlock.
 */
import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedView } from '../themed/ThemedView';
import { ThemedText } from '../themed/ThemedText';
import { ThemedGradient } from '../themed/ThemedGradient';
import { ThemedButton } from '../themed/ThemedButton';

interface PinSetupModalProps {
  visible: boolean;
  onPinSet: (pin: string) => void;
  onCancel: () => void;
}

export const PinSetupModal: React.FC<PinSetupModalProps> = ({
  visible,
  onPinSet,
  onCancel,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('settings');
  const insets = useSafeAreaInsets();

  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [step, setStep] = useState<'enter' | 'confirm'>('enter');
  const [error, setError] = useState('');

  const handlePinChange = useCallback((value: string) => {
    const filtered = value.replace(/[^0-9]/g, '').slice(0, 6);
    setPin(filtered);
    setError('');
  }, []);

  const handleConfirmPinChange = useCallback((value: string) => {
    const filtered = value.replace(/[^0-9]/g, '').slice(0, 6);
    setConfirmPin(filtered);
    setError('');
  }, []);

  const handleNextStep = useCallback(() => {
    if (pin.length < 4) {
      setError(t('pinMinLength'));
      return;
    }
    setError('');
    setStep('confirm');
  }, [pin, t]);

  const handleConfirm = useCallback(() => {
    if (confirmPin !== pin) {
      setError(t('pinMismatch'));
      setConfirmPin('');
      return;
    }
    if (confirmPin.length < 4) {
      setError(t('pinMinLength'));
      return;
    }
    onPinSet(pin);
    reset();
  }, [pin, confirmPin, onPinSet, t]);

  const handleCancel = useCallback(() => {
    reset();
    onCancel();
  }, [onCancel]);

  const handleBack = useCallback(() => {
    setStep('enter');
    setConfirmPin('');
    setError('');
  }, []);

  const reset = () => {
    setPin('');
    setConfirmPin('');
    setStep('enter');
    setError('');
  };

  if (!theme) return null;

  const primaryActive = step === 'enter' ? pin.length >= 4 : confirmPin.length >= 4;
  const primaryOnPress = step === 'enter' ? handleNextStep : handleConfirm;
  const secondaryOnPress = step === 'enter' ? handleCancel : handleBack;
  const secondaryLabel = step === 'enter' ? t('cancel') : t('back');
  const primaryLabel = step === 'enter' ? t('next') : t('confirm');

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      statusBarTranslucent
      onRequestClose={handleCancel}
    >
      <View style={styles.backdrop}>
        <ThemedView
          variant="elevated"
          style={[styles.modal, { paddingBottom: insets.bottom + 20 }]}
        >
          {/* Icon */}
          <View style={styles.iconWrapper}>
            <ThemedGradient gradient="primary" style={styles.iconRing}>
              <ThemedView variant="elevated" style={styles.iconInner}>
                <Icon name="lock" size={40} color={theme.colors.accent.primary} />
              </ThemedView>
            </ThemedGradient>
          </View>

          {/* Title */}
          <ThemedText
            variant="primary"
            size={20}
            weight="bold"
            hierarchy="header"
            style={styles.title}
          >
            {step === 'enter' ? t('pinSetupTitle') : t('pinConfirmTitle')}
          </ThemedText>

          <ThemedText
            variant="secondary"
            size={13}
            hierarchy="subtext"
            style={styles.subtitle}
          >
            {step === 'enter'
              ? t('pinSetupSubtitle')
              : t('pinConfirmSubtitle')}
          </ThemedText>

          {/* Input */}
          {step === 'enter' ? (
            <View style={styles.inputSection}>
              <TextInput
                style={[
                  styles.pinInput,
                  {
                    color: theme.colors.text.primary,
                    borderColor: error
                      ? theme.colors.status?.error ?? '#f44336'
                      : theme.colors.border.default,
                    backgroundColor: theme.colors.background.base,
                  },
                ]}
                value={pin}
                onChangeText={handlePinChange}
                placeholder="····"
                placeholderTextColor={theme.colors.text.muted}
                keyboardType="number-pad"
                maxLength={6}
                secureTextEntry
                autoFocus
              />
              {error ? (
                <ThemedText
                  size={12}
                  style={[styles.errorText, { color: theme.colors.status?.error ?? '#f44336' }]}
                >
                  {error}
                </ThemedText>
              ) : null}
            </View>
          ) : (
            <View style={styles.inputSection}>
              <TextInput
                style={[
                  styles.pinInput,
                  {
                    color: theme.colors.text.primary,
                    borderColor: error
                      ? theme.colors.status?.error ?? '#f44336'
                      : theme.colors.border.default,
                    backgroundColor: theme.colors.background.base,
                  },
                ]}
                value={confirmPin}
                onChangeText={handleConfirmPinChange}
                placeholder="····"
                placeholderTextColor={theme.colors.text.muted}
                keyboardType="number-pad"
                maxLength={6}
                secureTextEntry
                autoFocus
              />
              {error ? (
                <ThemedText
                  size={12}
                  style={[styles.errorText, { color: theme.colors.status?.error ?? '#f44336' }]}
                >
                  {error}
                </ThemedText>
              ) : null}
            </View>
          )}

          {/* Buttons — using ThemedButton for consistent design + haptics */}
          <View style={styles.buttonRow}>
            <ThemedButton
              label={secondaryLabel}
              variant="outline"
              onPress={secondaryOnPress}
              style={styles.modalButton}
            />
            <ThemedButton
              label={primaryLabel}
              variant="primary"
              onPress={primaryOnPress}
              disabled={!primaryActive}
              style={styles.modalButton}
            />
          </View>
        </ThemedView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  modal: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
  },
  iconWrapper: {
    marginBottom: 20,
  },
  iconRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconInner: {
    width: 70,
    height: 70,
    borderRadius: 35,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 18,
  },
  inputSection: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 20,
  },
  pinInput: {
    width: '100%',
    height: 54,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: 24,
    textAlign: 'center',
    letterSpacing: 10,
  },
  errorText: {
    marginTop: 8,
    textAlign: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  modalButton: {
    flex: 1,
  },
});

export default PinSetupModal;
