/**
 * HelpSupportSettingsScreen — settings sub-menu for support & legal.
 *
 * Consolidates the rows that previously lived on the main Settings screen
 * (Support & Legal) into a single dedicated screen, keeping the top-level
 * Settings tab compact. The app version footer is preserved here too.
 */
import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedView } from '../../components/themed/ThemedView';
import { ThemedText } from '../../components/themed/ThemedText';
import { ThemedCard } from '../../components/themed/ThemedCard';
import { SectionHeader } from '../../components/themed/SectionHeader';
import { ScreenHeader } from '../../components/themed/ScreenHeader';
import {
  SettingsLinkRow,
  SettingsIconPill,
} from '../../components/settings/SettingsRows';

const APP_VERSION = '0.0.1';

export const HelpSupportSettingsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { theme } = useAppTheme();
  const { t } = useTranslation('settings');

  if (!theme) return null;

  const navigateToComingSoon = (titleKey: string, icon: string, descriptionKey: string) => {
    navigation.navigate('ComingSoon', { titleKey, icon, descriptionKey });
  };

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('support')} onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Support & Legal ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
          <SectionHeader title={t('support')} style={styles.sectionHeader} />
          <SettingsLinkRow
            icon="help-circle"
            label={t('helpCenter')}
            onPress={() => navigateToComingSoon('helpCenter', 'help-circle', 'comingSoonHelpCenter')}
            theme={theme}
          />
          <SettingsLinkRow
            icon="bug"
            label={t('reportBug')}
            onPress={() => navigateToComingSoon('reportBug', 'bug', 'comingSoonReportBug')}
            theme={theme}
            showSeparator
          />
          <SettingsLinkRow
            icon="file-document"
            label={t('termsOfService')}
            onPress={() => navigateToComingSoon('termsOfService', 'file-document', 'comingSoonTermsOfService')}
            theme={theme}
            showSeparator
          />
          <SettingsLinkRow
            icon="shield-account"
            label={t('privacyPolicy')}
            onPress={() => navigateToComingSoon('privacyPolicy', 'shield-account', 'comingSoonPrivacyPolicy')}
            theme={theme}
            showSeparator
          />
          <View>
            <View style={styles.toggleRow}>
              <SettingsIconPill name="information" color={theme.colors.accent.primary} size={20} />
              <ThemedText style={styles.linkLabel}>{t('appVersion')}</ThemedText>
              <ThemedText style={styles.linkLabel} variant="secondary">{`Harmony AI Chat v${APP_VERSION}`}</ThemedText>
            </View>
          </View>
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
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  linkLabel: {
    flex: 1,
    fontSize: 15,
  },
});

export default HelpSupportSettingsScreen;
