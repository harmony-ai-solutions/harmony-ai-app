/**
 * BiometricLockSettingsScreen
 *
 * Dedicated settings page for biometric lock / PIN configuration.
 * Provides: enable/disable toggle, PIN setup/change, biometric info.
 */
import React, { useState, useCallback } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Switch } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useBiometricLock } from '../../contexts/BiometricLockContext';
import { ScreenHeader } from '../../components/themed/ScreenHeader';
import { ThemedView } from '../../components/themed/ThemedView';
import { ThemedCard } from '../../components/themed/ThemedCard';
import { ThemedText } from '../../components/themed/ThemedText';
import { SectionHeader } from '../../components/themed/SectionHeader';
import { ThemedButton } from '../../components/themed/ThemedButton';
import { PinSetupModal } from '../../components/lock/PinSetupModal';

export const BiometricLockSettingsScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const navigation = useNavigation();
  const { t } = useTranslation('settings');
  const {
    isEnabled,
    isPinSet,
    lockMode,
    setEnabled,
    setupPin,
    lock,
  } = useBiometricLock();

  const [showPinSetup, setShowPinSetup] = useState(false);

  const handleToggle = useCallback(async (value: boolean) => {
    if (value) {
      // Enabling — persist immediately, then prompt for PIN
      await setEnabled(true);
      setShowPinSetup(true);
    } else {
      // Disabling
      await setEnabled(false);
    }
  }, [setEnabled]);

  const handlePinSet = useCallback(async (pin: string) => {
    await setupPin(pin);
    setShowPinSetup(false);
  }, [setupPin]);

  const handlePinSetupCancel = useCallback(() => {
    setShowPinSetup(false);
    if (!isPinSet) {
      // User cancelled initial setup — revert enable
      setEnabled(false);
    }
  }, [isPinSet, setEnabled]);

  const handleChangePin = useCallback(() => {
    setShowPinSetup(true);
  }, []);

  const handleTestLock = useCallback(() => {
    lock();
    navigation.goBack();
  }, [lock, navigation]);

  if (!theme) return null;

  const biometryLabel = lockMode === 'biometric' ? t('biometricAvailable') : t('biometricUnavailable');

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader
        title={t('biometricLock')}
        onBack={() => navigation.goBack()}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Toggle Card ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
          <SectionHeader title={t('biometricLock')} />
          <View style={styles.toggleRow}>
            <Icon name="fingerprint" size={24} color={theme.colors.accent.primary} />
            <View style={styles.toggleLabelGroup}>
              <ThemedText size={15} weight="medium">{t('biometricLock')}</ThemedText>
              <ThemedText variant="secondary" size={13}>
                {isEnabled ? t('biometricLockEnabledDesc') : t('biometricLockDisabledDesc')}
              </ThemedText>
            </View>
            <Switch
              value={isEnabled}
              onValueChange={handleToggle}
              color={theme.colors.accent.primary}
            />
          </View>
        </ThemedCard>

        {/* ── PIN Management (only when enabled & PIN is set) ── */}
        {isEnabled && isPinSet && (
          <ThemedCard elevated accentStripe style={styles.card}>
            <SectionHeader title={t('pinManagement')} />
            <View style={styles.infoRow}>
              <ThemedText variant="secondary" size={13}>{t('pinIsSet')}</ThemedText>
              <Icon name="check-circle" size={18} color={theme.colors.status?.success ?? '#4caf50'} />
            </View>
            <View style={styles.buttonGroup}>
              <ThemedButton
                label={t('changePin')}
                variant="primary"
                onPress={handleChangePin}
                style={styles.button}
              />
              <ThemedButton
                label={t('testLock')}
                variant="primary"
                onPress={handleTestLock}
                style={styles.button}
              />
            </View>
          </ThemedCard>
        )}

        {/* ── Biometric Status Card ── */}
        {isEnabled && (
          <ThemedCard elevated accentStripe style={styles.card}>
            <SectionHeader title={t('biometricStatus')} />
            <View style={styles.infoRow}>
              <Icon
                name={lockMode === 'biometric' ? 'fingerprint' : 'cellphone-lock'}
                size={20}
                color={lockMode === 'biometric'
                  ? theme.colors.status?.success ?? '#4caf50'
                  : theme.colors.text.muted}
              />
              <ThemedText size={14}>{biometryLabel}</ThemedText>
            </View>
            <ThemedText variant="muted" size={12} style={styles.hintText}>
              {lockMode === 'biometric'
                ? t('biometricAvailableHint')
                : t('biometricUnavailableHint')}
            </ThemedText>
          </ThemedCard>
        )}
      </ScrollView>

      {/* ── PIN Setup Modal ── */}
      <PinSetupModal
        visible={showPinSetup}
        onPinSet={handlePinSet}
        onCancel={handlePinSetupCancel}
      />
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: {
    padding: 16,
    gap: 16,
  },
  card: {
    gap: 12,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  toggleLabelGroup: {
    flex: 1,
    gap: 2,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 10,
  },
  hintText: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    lineHeight: 18,
  },
  buttonGroup: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 10,
  },
  button: {
    width: '100%',
  },
});

export default BiometricLockSettingsScreen;
