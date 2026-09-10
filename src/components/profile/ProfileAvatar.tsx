/**
 * ProfileAvatar — shared gradient-ring avatar.
 *
 * Renders a premium avatar used on the My Profile screen and persona rows:
 *   - Outer ThemedGradient ring (primary gradient) with a small gap
 *   - Elevated inner circle (theme surface) that either shows the image
 *     (data URL / remote URI) or the display name's initials on a subtle
 *     gradient fallback.
 *
 * Sizes are driven by a single `size` prop (default 96) so the same
 * component scales from the profile hero (96) down to persona rows (48).
 */

import React from 'react';
import { View, StyleSheet, Image } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedGradient } from '../themed/ThemedGradient';
import { ThemedText } from '../themed/ThemedText';

interface ProfileAvatarProps {
  /** Display name used to derive initials on the fallback */
  name: string;
  /** Data URL or remote URI of the avatar image, or null/undefined */
  uri?: string | null;
  /** Total outer diameter in dp (default 96) */
  size?: number;
  /** Show the outer gradient ring (default true) */
  showRing?: boolean;
  /** testID for E2E / tests */
  testID?: string;
}

export const ProfileAvatar: React.FC<ProfileAvatarProps> = ({
  name,
  uri,
  size = 96,
  showRing = true,
  testID,
}) => {
  const { theme } = useAppTheme();

  if (!theme) return null;

  const ringSize = size;
  const innerSize = Math.round(size * 0.9); // 90% — ring gap
  const radius = ringSize / 2;
  const innerRadius = innerSize / 2;

  const initials = (name || '?')
    .trim()
    .split(/\s+/)
    .map(part => part.charAt(0))
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const ring = (
    <ThemedGradient
      gradient="primary"
      style={[
        styles.ring,
        {
          width: ringSize,
          height: ringSize,
          borderRadius: radius,
        },
      ]}
    >
      <View
        style={[
          styles.inner,
          {
            width: innerSize,
            height: innerSize,
            borderRadius: innerRadius,
            backgroundColor: theme.colors.background.elevated,
          },
        ]}
      >
        {uri ? (
          <Image
            source={{ uri }}
            style={styles.image}
            resizeMode="cover"
          />
        ) : (
          <LinearGradient
            colors={[
              theme.colors.accent.primary + '33',
              theme.colors.background.elevated,
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          >
            <View style={styles.initialsWrap}>
              <ThemedText
                size={Math.max(14, Math.round(size * 0.3))}
                weight="bold"
                style={{ color: theme.colors.accent.primary }}
              >
                {initials}
              </ThemedText>
            </View>
          </LinearGradient>
        )}
      </View>
    </ThemedGradient>
  );

  if (!showRing) {
    // Bare image circle without the outer ring (compact contexts)
    return (
      <View
        testID={testID}
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          overflow: 'hidden',
          backgroundColor: theme.colors.background.elevated,
        }}
      >
        {uri ? (
          <Image source={{ uri }} style={styles.image} resizeMode="cover" />
        ) : (
          <LinearGradient
            colors={[
              theme.colors.accent.primary + '33',
              theme.colors.background.elevated,
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          >
            <View style={styles.initialsWrap}>
              <ThemedText
                size={Math.max(12, Math.round(size * 0.3))}
                weight="bold"
                style={{ color: theme.colors.accent.primary }}
              >
                {initials}
              </ThemedText>
            </View>
          </LinearGradient>
        )}
      </View>
    );
  }

  return (
    <View testID={testID} style={styles.wrapper}>
      {ring}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  initialsWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default ProfileAvatar;
