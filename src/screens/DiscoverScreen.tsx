/**
 * DiscoverScreen — Coming Soon
 *
 * Professional placeholder for the Explore / Discover feature.
 * Renders a centered "Coming Soon" slate with themed gradient accents,
 * iconography, and the app's glassmorphism aesthetic.
 */
import React, { useState, useCallback } from 'react';
import { View, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../contexts/ThemeContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ThemedGradient } from '../components/themed/ThemedGradient';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { TAB_BAR_CONTENT_PAD } from '../components/navigation/GlassTabBar';

export const DiscoverScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('discover');
  const { top: safeTop } = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  if (!theme) return null;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  return (
    <ThemedView variant="base" style={styles.container}>
      {/* ── Header ── */}
      <View style={{ paddingTop: safeTop + 12 }}>
        <ScreenHeader
          title={t('title')}
          subtitle={t('subtitle')}
          style={{ paddingTop: 0 }}
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
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
      {/* ── Coming Soon Body ── */}
      <View style={styles.body}>
        {/* Gradient-ringed icon circle */}
        <View style={styles.iconWrapper}>
          <ThemedGradient gradient="primary" style={styles.iconRing}>
            <ThemedView variant="elevated" style={styles.iconInner}>
              <Icon
                name="compass-outline"
                size={56}
                color={theme.colors.accent.primary}
              />
            </ThemedView>
          </ThemedGradient>
        </View>

        {/* Pulse dot below the icon */}
        <View style={styles.pulseRow}>
          <ThemedGradient gradient="primary" style={styles.pulseDot} />
        </View>

        {/* Headline */}
        <ThemedText
          variant="primary"
          size={26}
          weight="bold"
          hierarchy="header"
          style={styles.headline}
        >
          {t('comingSoon')}
        </ThemedText>

        {/* Description */}
        <ThemedText
          variant="secondary"
          size={14}
          hierarchy="subtext"
          style={styles.description}
        >
          {t('description')}
        </ThemedText>

        {/* Decorative bottom accent bar */}
        <ThemedGradient gradient="primary" style={styles.bottomAccent} />
      </View>
      </ScrollView>
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: TAB_BAR_CONTENT_PAD,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    // Shift center up slightly so tab bar doesn't crowd
    marginTop: -40,
  },
  iconWrapper: {
    marginBottom: 24,
  },
  iconRing: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconInner: {
    width: 108,
    height: 108,
    borderRadius: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRow: {
    marginBottom: 32,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    opacity: 0.7,
  },
  headline: {
    textAlign: 'center',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  description: {
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 40,
  },
  bottomAccent: {
    width: 48,
    height: 3,
    borderRadius: 2,
    opacity: 0.6,
  },
});

export default DiscoverScreen;
