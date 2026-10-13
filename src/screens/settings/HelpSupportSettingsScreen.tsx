/**
 * HelpSupportSettingsScreen — settings sub-menu for support & legal.
 *
 * Consolidates the rows that previously lived on the main Settings screen
 * (Support & Legal) into a single dedicated screen, keeping the top-level
 * Settings tab compact. The About block (plan 7-10 §4) shows the app version
 * (`DeviceInfo.getVersion()`), the RUNNING Soulbits Engine version (from the
 * runtime canary) and the management-contract version the app is pinned to.
 */
import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import DeviceInfo from 'react-native-device-info';
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
import { ENGINE_CONTRACT_VERSION } from '../../services/engine/engineContract';
import {
  getEngineVersionState,
  onEngineVersionStateChange,
} from '../../services/engine/EngineService';
import type { EngineVersionState } from '../../services/engine/EngineService';

/** App version, or a dash when the native module is unavailable (tests/web). */
function safeAppVersion(): string {
  try {
    return DeviceInfo.getVersion();
  } catch {
    return '—';
  }
}

export const HelpSupportSettingsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { theme } = useAppTheme();
  const { t } = useTranslation('settings');
  const [engineState, setEngineState] = useState<EngineVersionState>(() =>
    getEngineVersionState(),
  );

  // Track the runtime canary so the Engine row fills in once host readiness
  // resolves (and clears when the engine stops).
  useEffect(() => onEngineVersionStateChange(setEngineState), []);

  if (!theme) return null;

  const navigateToComingSoon = (titleKey: string, icon: string, descriptionKey: string) => {
    navigation.navigate('ComingSoon', { titleKey, icon, descriptionKey });
  };

  const appVersion = safeAppVersion();
  const engineVersion = engineState.engineVersion ?? t('updates:about.unknown');

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
        </ThemedCard>

        {/* ── About (plan 7-10 §4) ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
          <SectionHeader title={t('updates:about.title')} style={styles.sectionHeader} />
          <AboutRow
            icon="information"
            label={t('updates:about.appVersion')}
            value={appVersion}
            theme={theme}
            testID="about-app-version"
          />
          <AboutRow
            icon="engine-outline"
            label={t('updates:about.engineVersion')}
            value={engineVersion}
            theme={theme}
            testID="about-engine-version"
          />
          <AboutRow
            icon="file-code-outline"
            label={t('updates:about.contractVersion')}
            value={ENGINE_CONTRACT_VERSION}
            theme={theme}
            testID="about-contract-version"
          />
          {/* Plan 7-11: the engine log viewer / diagnostics export entry. */}
          <SettingsLinkRow
            icon="text-box-search-outline"
            label={t('engineLogs')}
            onPress={() => navigation.navigate('EngineLog')}
            theme={theme}
            showSeparator
          />
        </ThemedCard>
      </ScrollView>
    </ThemedView>
  );
};

/** One label/value row in the About block. */
const AboutRow: React.FC<{
  icon: string;
  label: string;
  value: string;
  theme: any;
  testID?: string;
}> = ({ icon, label, value, theme, testID }) => (
  <View style={styles.toggleRow}>
    <SettingsIconPill name={icon} color={theme.colors.accent.primary} size={20} />
    <ThemedText style={styles.linkLabel}>{label}</ThemedText>
    <ThemedText style={styles.linkLabel} variant="secondary" testID={testID}>
      {value}
    </ThemedText>
  </View>
);

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
