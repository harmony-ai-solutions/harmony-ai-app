/**
 * StardustParticles — Visible drifting light particles overlay.
 *
 * Renders 25 clearly-visible glowing dots that float slowly across
 * the screen. Particles are 4-8px with a soft glow (shadow), pulsate
 * in brightness, and drift with meaningful amplitude. Scattered
 * across the full viewport.
 *
 * Uses theme accent colors for the glow tint.
 */

import React, { useEffect, useRef, useMemo } from 'react';
import {
  Animated,
  Dimensions,
  StyleSheet,
  Platform,
} from 'react-native';
import { useAppTheme } from '../../contexts/ThemeContext';

const { width: W, height: H } = Dimensions.get('window');

interface Dot {
  id: number;
  x: number;
  y: number;
  size: number;
  baseOpacity: number;
  cycleMs: number;
  driftX: number;
  driftY: number;
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildDots(count: number): Dot[] {
  const rng = mulberry32(137);
  const dots: Dot[] = [];
  for (let i = 0; i < count; i++) {
    dots.push({
      id: i,
      x: rng() * W,
      y: rng() * H,
      size: 3 + rng() * 5,                       // 3-8px
      baseOpacity: 0.25 + rng() * 0.55,           // 0.25-0.80
      cycleMs: 5000 + rng() * 15000,              // 5-20s
      driftX: (rng() - 0.5) * W * 0.25,           // up to 25% of screen width
      driftY: (rng() - 0.5) * H * 0.20,           // up to 20% of screen height
    });
  }
  return dots;
}

const DotWidget: React.FC<{ dot: Dot; color: string }> = ({ dot, color }) => {
  const op = useRef(new Animated.Value(dot.baseOpacity)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const half = dot.cycleMs / 2;

    Animated.parallel([
      Animated.loop(Animated.sequence([
        Animated.timing(op, { toValue: dot.baseOpacity * 1.6, duration: half * 0.7, useNativeDriver: true }),
        Animated.timing(op, { toValue: dot.baseOpacity * 0.4, duration: half * 1.3, useNativeDriver: true }),
      ])),
      Animated.loop(Animated.sequence([
        Animated.timing(tx, { toValue: dot.driftX, duration: half, useNativeDriver: true }),
        Animated.timing(tx, { toValue: -dot.driftX, duration: half, useNativeDriver: true }),
      ])),
      Animated.loop(Animated.sequence([
        Animated.timing(ty, { toValue: dot.driftY, duration: half * 0.85, useNativeDriver: true }),
        Animated.timing(ty, { toValue: -dot.driftY, duration: half * 1.15, useNativeDriver: true }),
      ])),
    ]).start();
  }, [dot, op, tx, ty]);

  return (
    <Animated.View
      style={[
        styles.dot,
        {
          left: dot.x,
          top: dot.y,
          width: dot.size,
          height: dot.size,
          borderRadius: dot.size / 2,
          backgroundColor: color,
          opacity: op,
          transform: [{ translateX: tx }, { translateY: ty }],
          shadowColor: color,
        },
      ]}
      pointerEvents="none"
    />
  );
};

interface StardustParticlesProps {
  enabled?: boolean;
}

export const StardustParticles: React.FC<StardustParticlesProps> = React.memo(
  ({ enabled = true }) => {
    const { theme } = useAppTheme();
    const color = theme?.colors.accent.primary || '#8f3ba7';
    const dots = useMemo(() => buildDots(25), []);

    // When disabled, render nothing — no particle animations at all
    if (!enabled) {
      return null;
    }

    return (
      <Animated.View style={styles.root} pointerEvents="none">
        {dots.map((d) => (
          <DotWidget key={d.id} dot={d} color={color} />
        ))}
      </Animated.View>
    );
  },
);

StardustParticles.displayName = 'StardustParticles';

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
  },
  dot: {
    position: 'absolute',
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.6,
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
    }),
  },
});

export default StardustParticles;
