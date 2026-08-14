/**
 * AccountSettingsScreen — settings sub-menu for account, security and billing.
 *
 * Consolidates the rows that previously lived on the main Settings screen
 * (Account & Security + Billing & Purchases) into a single dedicated screen,
 * keeping the top-level Settings tab compact.
 */
import React from 'react';
import { StyleSheet, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedView } from '../../components/themed/ThemedView';
import { ThemedCard } from '../../components/themed/ThemedCard';
import { SectionHeader } from '../../components/themed/SectionHeader';
import { ScreenHeader } from '../../components/themed/ScreenHeader';
import { SettingsLinkRow } from '../../components/settings/SettingsRows';

export const AccountSettingsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { theme } = useAppTheme();
  const { t } = useTranslation('settings');

  if (!theme) return null;

  const navigateToComingSoon = (titleKey: string, icon: string, descriptionKey: string) => {
    navigation.navigate('ComingSoon', { titleKey, icon, descriptionKey });
  };

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('account')} onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Account & Security ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
          <SectionHeader title={t('security')} style={styles.sectionHeader} />
          <SettingsLinkRow
            icon="fingerprint"
            label={t('biometricLock')}
            onPress={() => navigation.navigate('BiometricLockSettings')}
            theme={theme}
            showSeparator
          />
          <SettingsLinkRow
            icon="lock-reset"
            label={t('resetPassword')}
            onPress={() => navigateToComingSoon('resetPassword', 'lock-reset', 'comingSoonResetPassword')}
            theme={theme}
            showSeparator
          />
          <SettingsLinkRow
            icon="devices"
            label={t('activeSessions')}
            onPress={() => navigateToComingSoon('activeSessions', 'devices', 'comingSoonActiveSessions')}
            theme={theme}
            showSeparator
          />
          <SettingsLinkRow
            icon="delete-forever"
            label={t('deleteAccount')}
            onPress={() => navigateToComingSoon('deleteAccount', 'delete-forever', 'comingSoonDeleteAccount')}
            theme={theme}
            showSeparator
          />
          <SettingsLinkRow
            icon="account-cancel"
            label={t('blockedAIsTitle')}
            onPress={() => navigation.navigate('BlockedAIs')}
            theme={theme}
            showSeparator
          />
        </ThemedCard>

        {/* ── Billing & Purchases ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
          <SectionHeader title={t('billing')} style={styles.sectionHeader} />
          <SettingsLinkRow
            icon="credit-card"
            label={t('manageSubscription')}
            onPress={() => navigateToComingSoon('manageSubscription', 'credit-card', 'comingSoonManageSubscription')}
            theme={theme}
          />
        </ThemedCard>
      </ScrollView>
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
    gap: 16,
  },
  card: {
    gap: 12,
    padding: 0,
    overflow: 'hidden',
  },
  sectionHeader: {
    marginTop: 0,
  },
});

export default AccountSettingsScreen;
