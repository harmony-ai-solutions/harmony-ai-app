import React, { useState, useCallback } from 'react';
import { View, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useAppTheme } from '../contexts/ThemeContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { LandingCard } from '../components/landing/LandingCard';
import { ConnectionStatusBadge } from '../components/settings/ConnectionStatusBadge';
import { ThemedGradient } from '../components/themed/ThemedGradient';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { getAppVersion } from '../utils/version';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export const LandingScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const { t } = useTranslation('landing');
  const [refreshing, setRefreshing] = useState(false);

  if (!theme) return null;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  return (
    <ThemedView style={styles.container}>
      {/* Header */}
      <ScreenHeader
        title={t('title')}
        right={<ConnectionStatusBadge />}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[theme!.colors.accent.primary]}
            tintColor={theme!.colors.accent.primary}
            progressBackgroundColor={theme!.colors.background.surface}
          />
        }
      >
        {/* SoulBits hero gradient accent stripe */}
        <ThemedGradient gradient="primary" style={styles.gradientAccent} />

        {/* Hero subtitle / eyebrow */}
        <ThemedText variant="muted" size={11} style={styles.sectionEyebrow}>
          {t('welcomeEyebrow')}
        </ThemedText>

        {/* Hero: AI Chat card */}
        <LandingCard
          icon="chat-processing"
          title={t('aiChat.title')}
          description={t('aiChat.description')}
          variant="hero"
          onPress={() => navigation.navigate('ChatList')}
          style={styles.heroCard}
        />

        {/* Secondary row: Characters + Settings */}
        <View style={styles.secondaryRow}>
          <LandingCard
            icon="account-group"
            title={t('characters.title')}
            description={t('characters.description')}
            variant="secondary"
            onPress={() => navigation.navigate('Characters')}
          />
          <LandingCard
            icon="tune"
            title={t('settings.title')}
            description={t('settings.description')}
            variant="secondary"
            onPress={() => navigation.navigate('Settings')}
          />
        </View>

        {/* Footer — glass separator + version */}
        <View style={[styles.footer, { paddingBottom: 24 + safeBottom }]}>
          <View style={[styles.footerSeparator, { backgroundColor: theme.colors.accent.primary + '1F' }]} />
          <ThemedText variant="muted" size={11}>
            {t('common:version', { version: getAppVersion() })}
          </ThemedText>
        </View>
      </ScrollView>
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    elevation: 0,
  },
  scrollContent: {
    padding: 16,
    gap: 16,
    flexGrow: 1,
  },
  gradientAccent: {
    height: 4,
    borderRadius: 2,
    marginBottom: 0,
  },
  sectionEyebrow: {
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: -4,
  },
  heroCard: {
    marginBottom: 4,
  },
  secondaryRow: {
    flexDirection: 'row',
    gap: 12,
  },
  footer: {
    marginTop: 'auto',
    paddingTop: 24,
    paddingBottom: 16,
    alignItems: 'center',
  },
  footerSeparator: {
    width: 40,
    height: 2,
    borderRadius: 1,
    marginBottom: 12,
  },
});
