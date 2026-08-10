/**
 * MyProfileScreen — My Profile tab
 *
 * Placeholder screen for the "My Profile" tab. The body is intentionally
 * empty for now — content will be added here later.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../contexts/ThemeContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { HeaderMenuButton } from '../components/navigation/HeaderMenuButton';
import { TAB_BAR_CONTENT_PAD } from '../components/navigation/GlassTabBar';

export const MyProfileScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();

  if (!theme) return null;

  return (
    <ThemedView variant="base" style={styles.container}>
      {/* ── Header (title + hamburger menu) ── */}
      <ScreenHeader
        title="My Profile"
        right={<HeaderMenuButton />}
      />

      {/* ── Body (empty placeholder) ── */}
      <View
        style={[
          styles.body,
          { paddingBottom: TAB_BAR_CONTENT_PAD + safeBottom },
        ]}
      />
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  body: {
    flex: 1,
  },
});

export default MyProfileScreen;
