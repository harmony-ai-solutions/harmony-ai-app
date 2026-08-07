/**
 * AppearanceSettingsScreen — settings sub-menu for appearance & display.
 *
 * Consolidates the rows that previously lived on the main Settings screen
 * (Appearance & Display) into a single dedicated screen, keeping the
 * top-level Settings tab compact. Theme is a real feature (ThemeSettings);
 * the remaining rows use the existing ComingSoon placeholder.
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

export const AppearanceSettingsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { theme } = useAppTheme();
  const { t } = useTranslation('settings');

  if (!theme) return null;

  const navigateToComingSoon = (titleKey: string, icon: string, descriptionKey: string) => {
    navigation.navigate('ComingSoon', { titleKey, icon, descriptionKey });
  };

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('appearance')} onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Appearance & Display ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
          <SectionHeader title={t('appearance')} style={styles.sectionHeader} />
          <SettingsLinkRow
            icon="palette"
            label={t('appearanceTheme')}
            onPress={() => navigation.navigate('ThemeSettings')}
            theme={theme}
          />
          <SettingsLinkRow
            icon="translate"
            label={t('switchLanguage')}
            onPress={() => navigateToComingSoon('switchLanguage', 'translate', 'comingSoonSwitchLanguage')}
            theme={theme}
            showSeparator
          />
          <SettingsLinkRow
            icon="format-size"
            label={t('fontSize')}
            onPress={() => navigateToComingSoon('fontSize', 'format-size', 'comingSoonFontSize')}
            theme={theme}
            showSeparator
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

export default AppearanceSettingsScreen;
