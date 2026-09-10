import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { ThemedCard } from '../themed/ThemedCard';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useReducedMotion } from '../../hooks/useReducedMotion';

/**
 * GreetingShimmer — skeleton for an in-flight greeting (P2 `preparing` state).
 *
 * Animated shimmer (pulse opacity) by default; renders a static skeleton when
 * the OS "reduce motion" accessibility setting is enabled.
 */
export const GreetingShimmer: React.FC = () => {
  const reduceMotion = useReducedMotion();
  const { theme } = useAppTheme();
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    if (reduceMotion) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.9,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.4,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [reduceMotion, pulse]);

  const barColor = theme?.colors.background.elevated ?? '#2b2b3c';
  const bar = { backgroundColor: barColor };

  return (
    <ThemedCard elevated style={styles.card}>
      {reduceMotion ? (
        // Static skeleton — no animation, no opacity wrapper.
        <View testID="greeting-shimmer-static">
          <View style={[styles.line, styles.lineTitle, bar]} />
          <View style={[styles.line, bar]} />
          <View style={[styles.line, styles.lineShort, bar]} />
        </View>
      ) : (
        <Animated.View
          testID="greeting-shimmer-animated"
          style={{ opacity: pulse }}
        >
          <View style={[styles.line, styles.lineTitle, bar]} />
          <View style={[styles.line, bar]} />
          <View style={[styles.line, styles.lineShort, bar]} />
        </Animated.View>
      )}
    </ThemedCard>
  );
};

const styles = StyleSheet.create({
  card: {
    // Matches ChatBubble's bubble footprint so the skeleton→greeting swap
    // does not cause a jarring layout jump.
    alignSelf: 'flex-start',
    maxWidth: '82%',
  },
  line: {
    height: 12,
    borderRadius: 6,
    marginVertical: 6,
    opacity: 0.6,
  },
  lineTitle: {
    width: '55%',
    height: 14,
  },
  lineShort: {
    width: '35%',
  },
});
