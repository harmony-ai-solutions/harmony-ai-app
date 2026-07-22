/**
 * DiscoverScreen — Coming Soon
 *
 * Professional placeholder for the Explore / Discover feature.
 * Renders a centered "Coming Soon" slate with themed gradient accents,
 * iconography, and the app's glassmorphism aesthetic.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
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
      {/* ── Header ── */}
      <View style={{ paddingTop: safeTop + 12 }}>
        <ScreenHeader
          title="Discover"
          subtitle="Explore AI personas, trending characters, and community showcases"
          style={{ paddingTop: 0 }}
        />
      </View>

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
          Coming Soon
        </ThemedText>

        {/* Description */}
        <ThemedText
          variant="secondary"
          size={14}
          hierarchy="subtext"
          style={styles.description}
        >
          We're curating an immersive discovery experience{'\n'}
          filled with AI personas, trending characters,{'\n'}
          and community showcases.
        </ThemedText>

        {/* Decorative bottom accent bar */}
        <ThemedGradient gradient="primary" style={styles.bottomAccent} />
      </View>
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
