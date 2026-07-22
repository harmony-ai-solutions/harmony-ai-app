/**
 * DiscoverScreen — Explore public AI personas
 *
 * Glass-immersive screen for browsing featured AI characters, trending
 * personas, and community-curated character showcases. Serves as the
 * "Explore" entry point for discovering new content within the Harmony ecosystem.
 */

import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../contexts/ThemeContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ThemedGradient } from '../components/themed/ThemedGradient';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { TAB_BAR_CONTENT_PAD } from '../components/navigation/GlassTabBar';

export const DiscoverScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const { top: safeTop } = useSafeAreaInsets();

  if (!theme) return null;

  return (
    <ThemedView variant="base" style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: safeTop + 12, paddingBottom: TAB_BAR_CONTENT_PAD },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Page header — gradient stripe + title + subtitle */}
        <ScreenHeader
          title="Discover"
          subtitle="Explore AI personas, trending characters, and community showcases"
          style={{ paddingTop: 0 }}
        />

        {/* Placeholder cards */}
        <View style={styles.grid}>
          {[1, 2, 3, 4].map(i => (
            <ThemedView key={i} variant="surface" style={styles.card}>
              <ThemedGradient
                gradient="primary"
                style={styles.cardGradientPlaceholder}
              />
              <ThemedText variant="secondary" size={13} weight="medium" style={styles.cardLabel}>
                Featured Persona {i}
              </ThemedText>
              <ThemedText variant="muted" size={11} style={styles.cardDesc}>
                Coming soon — community-curated AI characters
              </ThemedText>
            </ThemedView>
          ))}
        </View>

      </ScrollView>
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  card: {
    width: '47%',
    borderRadius: 16,
    padding: 14,
    gap: 8,
    minHeight: 120,
  },
  cardGradientPlaceholder: {
    height: 48,
    borderRadius: 10,
    opacity: 0.5,
  },
  cardLabel: {
    marginTop: 4,
  },
  cardDesc: {
    lineHeight: 15,
  },
});

export default DiscoverScreen;
