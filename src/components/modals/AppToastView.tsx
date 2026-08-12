/**
 * AppToastView — Themed toast pill.
 *
 * A small obsidian-glass pill that fades in near the bottom of the screen,
 * matching the app's design language instead of the OS-native Toast.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';

interface AppToastViewProps {
  message: string | null;
  visible: boolean;
  onHide: () => void;
}

const TOAST_DURATION_MS = 2200;

export const AppToastView: React.FC<AppToastViewProps> = ({
  message,
  visible,
  onHide,
}) => {
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible && message) {
      // Clear any pending hide timer
      if (hideTimer.current) clearTimeout(hideTimer.current);

      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();

      hideTimer.current = setTimeout(() => {
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 0,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(translateY, {
            toValue: 16,
            duration: 200,
            useNativeDriver: true,
          }),
        ]).start(() => onHide());
      }, TOAST_DURATION_MS);
    }
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [visible, message, opacity, translateY, onHide]);

  if (!theme || !message) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrapper,
        {
          opacity,
          transform: [{ translateY }],
          bottom: Math.max(safeBottom, 16) + 8,
        },
      ]}
    >
      <LinearGradient
        colors={[
          theme.colors.background.elevated,
          theme.colors.background.surface,
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          styles.pill,
          {
            borderColor: theme.colors.accent.primary + '44',
            shadowColor: '#000',
          },
        ]}
      >
        <View style={[styles.accentDot, { backgroundColor: theme.colors.accent.primary }]} />
        <ThemedText size={13} weight="medium" numberOfLines={2} style={styles.text}>
          {message}
        </ThemedText>
        <Icon name="check-circle" size={18} color={theme.colors.accent.primary} />
      </LinearGradient>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 24,
    right: 24,
    zIndex: 999,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
    maxWidth: '100%',
  },
  accentDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 10,
  },
  text: {
    flex: 1,
    marginRight: 8,
  },
});
