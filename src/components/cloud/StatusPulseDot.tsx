/**
 * StatusPulseDot — animated / static status indicator.
 *
 * Extracted from ConnectionSetupScreen.tsx (Phase 9) into a shared component.
 * Supports reduced-motion via AccessibilityInfo.isReduceMotionEnabled().
 *
 * RadarState is used by both the self-hosted status form and the cloud
 * provisioning card.
 */

import React, { useRef, useEffect, useMemo, useState } from 'react';
import {
  View,
  Animated,
  Easing,
  StyleSheet,
  AccessibilityInfo,
} from 'react-native';

export type RadarState = 'idle' | 'connecting' | 'waiting' | 'connected' | 'error';

interface StatusPulseDotProps {
  radarState: RadarState;
  accentColor: string;
  size?: number;
  glowSize?: number;
}

export const StatusPulseDot: React.FC<StatusPulseDotProps> = ({
  radarState,
  accentColor,
  size = 10,
  glowSize = 16,
}) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowOpacity = useRef(new Animated.Value(0.35)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  // ── Reduced-motion detection ──────────────────────────────────────────
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged' as any,
      setReduceMotion as any,
    );
    return () => {
      subscription.remove();
    };
    // AccessibilityInfo.addEventListener API: RN 0.76+ returns { remove }
    // For older RN, the eventEmitter-based addEventListener returns a
    // `remove`-able subscription either way.
  }, []);

  // ── Pulse animation ───────────────────────────────────────────────────
  useEffect(() => {
    if (reduceMotion || radarState === 'error') {
      pulseAnim.setValue(1);
      glowOpacity.setValue(radarState === 'error' ? 0.45 : 0.35);
      return;
    }

    let cycleMs: number;
    switch (radarState) {
      case 'connecting':
        cycleMs = 600;
        break;
      case 'connected':
        cycleMs = 2000;
        break;
      default:
        cycleMs = 1500;
        break;
    }

    const half = cycleMs / 2;

    const anim = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.3,
            duration: half,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: half,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(glowOpacity, {
            toValue: 0.15,
            duration: half,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(glowOpacity, {
            toValue: 0.35,
            duration: half,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
      ]),
    );

    anim.start();
    return () => anim.stop();
  }, [radarState, pulseAnim, glowOpacity, reduceMotion]);

  // ── Dot color ─────────────────────────────────────────────────────────
  const dotColor = useMemo(() => {
    switch (radarState) {
      case 'connected':
        return '#4CAF50';
      case 'error':
        return '#F44336';
      case 'waiting':
        return '#F0A23B';
      case 'connecting':
        return accentColor;
      default:
        return accentColor;
    }
  }, [radarState, accentColor]);

  const halfGlow = glowSize / 2;

  return (
    <View
      style={[styles.statusDotOuter, { width: glowSize, height: glowSize }]}
      accessibilityRole="image"
      accessibilityLabel={
        radarState === 'connected' ? 'Connected' :
        radarState === 'error' ? 'Error' :
        radarState === 'connecting' ? 'Connecting' :
        radarState === 'waiting' ? 'Waiting' : 'Idle'
      }
    >
      {reduceMotion ? (
        // Static dot when reduced motion is enabled — no animation, no glow
        <View
          style={[
            styles.statusDotCore,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: dotColor,
            },
          ]}
        />
      ) : (
        <>
          <Animated.View
            style={[
              styles.statusDotGlow,
              {
                width: glowSize,
                height: glowSize,
                borderRadius: halfGlow,
                backgroundColor: dotColor,
                opacity: glowOpacity,
              },
            ]}
          />
          <Animated.View
            style={[
              styles.statusDotCore,
              {
                width: size,
                height: size,
                borderRadius: size / 2,
                backgroundColor: dotColor,
                transform: [{ scale: pulseAnim }],
              },
            ]}
          />
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  statusDotOuter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusDotGlow: {
    position: 'absolute',
  },
  statusDotCore: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 3,
  },
});
