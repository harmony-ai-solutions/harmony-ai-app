/**
 * SoulEchoesBackground — Ripple Echoes of Ethereal Light
 *
 * Renders concentric ripple rings that emanate from 5-7 "soul sources"
 * scattered across the screen. Each source periodically sends out
 * expanding rings of light — like sonar pings, water ripples, or
 * ghostly echoes of energy. Rings fade as they expand, creating
 * overlapping interference patterns.
 *
 * Visual layers:
 *   1. Soul source cores: small bright dots with radial glow
 *   2. Echo ripples: expanding ring waves with 3-5 semi-transparent
 *      concentric rings per pulse
 *   3. Echo trails: lingering faint afterimages of previous rings
 *   4. Interference: where rings overlap, brightness compounds
 *
 * Sources pulse at staggered, irrational intervals so the pattern
 * never exactly repeats — creating a meditative, organic ebb and flow.
 *
 * Mood: Deep, introspective, resonant — like watching ripples in a
 * dark pond after dropping a stone.
 */

import React, { useEffect, useRef, useMemo } from 'react';
import {
  View,
  Animated,
  Dimensions,
  StyleSheet,
  Platform,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useAppTheme } from '../../contexts/ThemeContext';

const { width: W, height: H } = Dimensions.get('window');

// ── Soul Source config ──────────────────────────────────────────
interface SoulSourceCfg {
  id: number;
  x: number;
  y: number;
  color: string;
  coreSize: number;         // the bright center dot
  glowRadius: number;       // radial glow
  pulseIntervalMs: number;  // time between echo pulses
  rippleCount: number;      // rings per pulse
  maxRippleRadius: number;  // how far rings expand
  rippleSpeed: number;      // ms for a ring to reach max radius
}

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildSoulSources(primary: string, secondary: string): SoulSourceCfg[] {
  const rng = mulberry32(777);
  const colors = [
    primary, secondary, primary + 'EE', secondary + 'EE',
    primary + 'CC', secondary + 'CC',
  ];
  const sources: SoulSourceCfg[] = [];

  for (let i = 0; i < 7; i++) {
    sources.push({
      id: i,
      x: 0.08 + rng() * 0.84 * W,
      y: 0.08 + rng() * 0.84 * H,
      color: colors[Math.floor(rng() * colors.length)],
      coreSize: 3 + rng() * 6,                         // 3-9px
      glowRadius: 18 + rng() * 35,                      // 18-53px
      pulseIntervalMs: 2500 + rng() * 4500,             // 2.5-7s between pulses
      rippleCount: 3 + Math.floor(rng() * 3),           // 3-5 ripples per pulse
      maxRippleRadius: 80 + rng() * 120,                // 80-200px max expansion
      rippleSpeed: 1500 + rng() * 2500,                 // 1.5-4s to full expansion
    });
  }
  return sources;
}

// ── Echo Ripple Set (multiple concentric rings from one pulse) ──
interface RingAnimState {
  progress: Animated.Value;     // 0→1 expansion
  opacity: Animated.Value;
}

const EchoRippleSet: React.FC<{
  source: SoulSourceCfg;
  rippleId: number;
  startDelay: number;
}> = ({ source, rippleId, startDelay }) => {
  // Create ring animation state once
  const ringCount = source.rippleCount;
  const ringState = useRef<RingAnimState[]>(
    Array.from({ length: ringCount }, () => ({
      progress: new Animated.Value(0),
      opacity: new Animated.Value(0),
    })),
  ).current;

  useEffect(() => {
    const staggerMs = 180; // 180ms between each ring in a set

    const sequences: Animated.CompositeAnimation[] = [];

    for (let r = 0; r < ringCount; r++) {
      sequences.push(
        Animated.sequence([
          // Wait for overall delay + per-ring stagger
          Animated.delay(startDelay + r * staggerMs),
          // Fade in
          Animated.timing(ringState[r].opacity, {
            toValue: 0.65, duration: 150, useNativeDriver: true,
          }),
          // Expand + fade out simultaneously
          Animated.parallel([
            Animated.timing(ringState[r].progress, {
              toValue: 1, duration: source.rippleSpeed, useNativeDriver: true,
            }),
            Animated.sequence([
              // Hold at peak for 60% of travel
              Animated.delay(source.rippleSpeed * 0.55),
              // Fade out in last 45%
              Animated.timing(ringState[r].opacity, {
                toValue: 0, duration: source.rippleSpeed * 0.45, useNativeDriver: true,
              }),
            ]),
          ]),
        ]),
      );
    }

    // All rings fire, then pause before next pulse set
    const loopAnim = Animated.loop(
      Animated.sequence([
        Animated.parallel(sequences),
        Animated.delay(source.pulseIntervalMs),
      ]),
    );

    loopAnim.start();
    return () => loopAnim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {ringState.map((rs, r) => {
        const ringRadius = rs.progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, source.maxRippleRadius],
        });
        const ringDiam = Animated.multiply(ringRadius, 2);

        return (
          <Animated.View
            key={`ripple-${rippleId}-${r}`}
            style={[
              styles.ripple,
              {
                left: source.x,
                top: source.y,
                width: ringDiam,
                height: ringDiam,
                borderRadius: ringRadius,
                borderWidth: 1.0,
                borderColor: source.color,
                opacity: rs.opacity,
                transform: [
                  { translateX: Animated.multiply(ringRadius, -1) },
                  { translateY: Animated.multiply(ringRadius, -1) },
                ],
              },
            ]}
            pointerEvents="none"
          />
        );
      })}
    </>
  );
};

// ── Single Source Component ──────────────────────────────────────
const SoulSource: React.FC<{ source: SoulSourceCfg }> = ({ source }) => {
  const coreBreathe = useRef(new Animated.Value(1)).current;
  const glowBreathe = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const half = source.pulseIntervalMs / 2;
    const composite = Animated.parallel([
      Animated.loop(
        Animated.sequence([
          Animated.timing(coreBreathe, {
            toValue: 2.0, duration: half * 0.3, useNativeDriver: true,
          }),
          Animated.timing(coreBreathe, {
            toValue: 0.7, duration: half * 1.7, useNativeDriver: true,
          }),
        ]),
      ),
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowBreathe, {
            toValue: 1.4, duration: half * 0.5, useNativeDriver: true,
          }),
          Animated.timing(glowBreathe, {
            toValue: 0.8, duration: half * 1.5, useNativeDriver: true,
          }),
        ]),
      ),
    ]);
    composite.start();
    return () => composite.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {/* Radial glow */}
      <Animated.View
        style={[
          styles.sourceGlow,
          {
            left: source.x - source.glowRadius,
            top: source.y - source.glowRadius,
            width: source.glowRadius * 2,
            height: source.glowRadius * 2,
            borderRadius: source.glowRadius,
            backgroundColor: source.color + '14',
            opacity: Animated.multiply(glowBreathe, 0.6),
            transform: [{ scale: glowBreathe }],
          },
        ]}
        pointerEvents="none"
      />

      {/* Echo ripples — 3 staggered perpetual pulse sets per source */}
      <EchoRippleSet source={source} rippleId={source.id * 3 + 0} startDelay={0} />
      <EchoRippleSet
        source={source}
        rippleId={source.id * 3 + 1}
        startDelay={source.pulseIntervalMs * 0.33}
      />
      <EchoRippleSet
        source={source}
        rippleId={source.id * 3 + 2}
        startDelay={source.pulseIntervalMs * 0.66}
      />

      {/* Core dot */}
      <Animated.View
        style={[
          styles.sourceCore,
          {
            left: source.x - source.coreSize,
            top: source.y - source.coreSize,
            width: source.coreSize * 2,
            height: source.coreSize * 2,
            borderRadius: source.coreSize,
            backgroundColor: source.color,
            opacity: coreBreathe,
            shadowColor: source.color,
          },
        ]}
        pointerEvents="none"
      />
    </>
  );
};

// ── Public component ────────────────────────────────────────────
interface SoulEchoesBackgroundProps {
  enabled?: boolean;
}

export const SoulEchoesBackground: React.FC<SoulEchoesBackgroundProps> = React.memo(
  ({ enabled = true }) => {
    const { theme } = useAppTheme();
    const primary = theme?.colors.accent.primary || '#8f3ba7';
    const secondary = theme?.colors.accent.secondary || '#5e1a6e';
    const base = theme?.colors.background.base || '#0b0f19';

    const sources = useMemo(
      () => buildSoulSources(primary, secondary),
      [primary, secondary],
    );

    if (!enabled) {
      return (
        <View style={styles.root} pointerEvents="none">
          <View style={[StyleSheet.absoluteFill, { backgroundColor: base }]} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: primary + '08' }]} />
        </View>
      );
    }

    return (
      <View style={styles.root} pointerEvents="none">
        {/* Deep obsidian base */}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: base }]} />

        {/* Very faint background texture — like the "fabric" of a dark pond */}
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: primary + '04' }]}
          pointerEvents="none"
        />

        {/* Soul sources with their echo ripples */}
        {sources.map((s) => (
          <SoulSource key={`source-${s.id}`} source={s} />
        ))}

        {/* Vignette to deepen edges */}
        <LinearGradient
          colors={[base + '00', base + '33', base + '55']}
          start={{ x: 0.5, y: 0.5 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <LinearGradient
          colors={[base + '00', base + '33', base + '55']}
          start={{ x: 0.5, y: 0.5 }}
          end={{ x: 0, y: 0 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      </View>
    );
  },
);

SoulEchoesBackground.displayName = 'SoulEchoesBackground';

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
  },
  sourceGlow: {
    position: 'absolute',
  },
  sourceCore: {
    position: 'absolute',
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.9,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  ripple: {
    position: 'absolute',
    borderStyle: 'solid',
  },
});

export default SoulEchoesBackground;
