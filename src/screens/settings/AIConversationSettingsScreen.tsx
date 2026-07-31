/**
 * AIConversationSettingsScreen — settings sub-menu for AI & conversation.
 *
 * Consolidates the AI & Conversation rows that previously lived on the main
 * Settings screen into a dedicated screen, keeping the top-level Settings
 * tab compact. Future AI-related preferences (streaming, personality, etc.)
 * can be added here.
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

export const AIConversationSettingsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { theme } = useAppTheme();
  const { t } = useTranslation('settings');

  if (!theme) return null;

  const navigateToComingSoon = (titleKey: string, icon: string, descriptionKey: string) => {
    navigation.navigate('ComingSoon', { titleKey, icon, descriptionKey });
  };

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('aiConversation')} onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── AI & Conversation ── */}
        <ThemedCard elevated accentStripe style={styles.card}>
          <SectionHeader title={t('aiConversation')} style={styles.sectionHeader} />
          <SettingsLinkRow
            icon="swap-horizontal-bold"
            label={t('streamingResponses')}
            onPress={() => navigateToComingSoon('streamingResponses', 'swap-horizontal-bold', 'comingSoonStreamingResponses')}
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

export default AIConversationSettingsScreen;
