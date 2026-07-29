/**
 * GeodesicBackground — Floating Rotating Crystalline Diamond Shapes
 *
 * Renders 8 diamond/rhombus shapes that float and rotate slowly across
 * the screen. Each diamond uses a rotated square with a gradient fill,
 * resembling crystalline facets drifting through space. The diamonds
 * are 60-120px, scattered across the viewport, and rotate at different
 * speeds while drifting horizontally and vertically.
 *
 * Design: Angular, geometric, clean — inspired by quartz crystals.
 */

import React, { useEffect, useRef, useMemo } from 'react';
import {
  View,
  Animated,
  Dimensions,
  StyleSheet,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useAppTheme } from '../../contexts/ThemeContext';

const { width: W, height: H } = Dimensions.get('window');

// ── Diamond config ──────────────────────────────────────────────
interface DiamondCfg {
  id: number;
  size: number;          // side length of the square (before rotation)
  left: number;
  top: number;
  colorA: string;
  colorB: string;
  opacity: number;
  cycleMs: number;       // full animation cycle
  driftX: number;
  driftY: number;
  rotationDeg: number;   // total rotation over cycle
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

function buildDiamonds(primary: string, secondary: string): DiamondCfg[] {
  const rng = mulberry32(271);
  const diamonds: DiamondCfg[] = [];
  for (let i = 0; i < 8; i++) {
    const isPrimary = rng() > 0.5;
    diamonds.push({
      id: i,
      size: 50 + rng() * 70,                       // 50-120px
      left: rng() * W * 1.1 - W * 0.1,
      top: rng() * H * 1.1 - H * 0.1,
      colorA: isPrimary ? primary + 'DD' : secondary + 'DD',
      colorB: isPrimary ? secondary + '55' : primary + '55',
      opacity: 0.15 + rng() * 0.25,                 // 0.15-0.40
      cycleMs: 12000 + rng() * 20000,               // 12-32s
      driftX: (rng() - 0.5) * W * 0.3,
      driftY: (rng() - 0.5) * H * 0.25,
      rotationDeg: (rng() > 0.5 ? 1 : -1) * (60 + rng() * 180), // 60-240deg total
    });
  }
  return diamonds;
}

// ── Diamond widget ──────────────────────────────────────────────
const DiamondWidget: React.FC<{ cfg: DiamondCfg }> = ({ cfg }) => {
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const op = useRef(new Animated.Value(cfg.opacity)).current;
  const rot = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const half = cfg.cycleMs / 2;

    const composite = Animated.parallel([
      Animated.loop(
        Animated.sequence([
          Animated.timing(tx, { toValue: cfg.driftX, duration: half, useNativeDriver: true }),
          Animated.timing(tx, { toValue: -cfg.driftX, duration: half, useNativeDriver: true }),
        ]),
      ),
      Animated.loop(
        Animated.sequence([
          Animated.timing(ty, { toValue: cfg.driftY, duration: half * 0.85, useNativeDriver: true }),
          Animated.timing(ty, { toValue: -cfg.driftY, duration: half * 1.15, useNativeDriver: true }),
        ]),
      ),
      Animated.loop(
        Animated.sequence([
          Animated.timing(op, { toValue: cfg.opacity * 0.5, duration: half * 0.6, useNativeDriver: true }),
          Animated.timing(op, { toValue: cfg.opacity * 1.5, duration: half * 1.4, useNativeDriver: true }),
        ]),
      ),
      Animated.loop(
        Animated.sequence([
          Animated.timing(rot, { toValue: cfg.rotationDeg, duration: half, useNativeDriver: true }),
          Animated.timing(rot, { toValue: 0, duration: half, useNativeDriver: true }),
        ]),
      ),
    ]);

    composite.start();

    return () => composite.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rotate = rot.interpolate({
    inputRange: [Math.min(0, cfg.rotationDeg), Math.max(0, cfg.rotationDeg)],
    outputRange: [`${Math.min(0, cfg.rotationDeg)}deg`, `${Math.max(0, cfg.rotationDeg)}deg`],
    extrapolate: 'extend',
  });

  return (
    <Animated.View
      style={[
        styles.diamond,
        {
          width: cfg.size,
          height: cfg.size,
          left: cfg.left,
          top: cfg.top,
          opacity: op,
          transform: [
            { translateX: tx },
            { translateY: ty },
            { rotate },
          ],
        },
      ]}
      pointerEvents="none"
    >
      <LinearGradient
        colors={[cfg.colorA, cfg.colorB]}
        start={{ x: 0.2, y: 0.2 }}
        end={{ x: 0.8, y: 0.8 }}
        style={styles.diamondFill}
      />
    </Animated.View>
  );
};

// ── Public component ────────────────────────────────────────────
interface GeodesicBackgroundProps {
  enabled?: boolean;
}

export const GeodesicBackground: React.FC<GeodesicBackgroundProps> = React.memo(
  ({ enabled = true }) => {
    const { theme } = useAppTheme();
    const primary = theme?.colors.accent.primary || '#8f3ba7';
    const secondary = theme?.colors.accent.secondary || '#22318e';
    const base = theme?.colors.background.base || '#0b0f19';

    const diamonds = useMemo(() => buildDiamonds(primary, secondary), [primary, secondary]);

    if (!enabled) {
      return (
        <View style={styles.root} pointerEvents="none">
          <View style={[StyleSheet.absoluteFill, { backgroundColor: base }]} />
        </View>
      );
    }

    return (
      <View style={styles.root} pointerEvents="none">
        <View style={[StyleSheet.absoluteFill, { backgroundColor: base }]} />
        {diamonds.map((d) => (
          <DiamondWidget key={d.id} cfg={d} />
        ))}
      </View>
    );
  },
);

GeodesicBackground.displayName = 'GeodesicBackground';

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
  },
  diamond: {
    position: 'absolute',
    overflow: 'hidden',
  },
  diamondFill: {
    flex: 1,
    transform: [{ rotate: '45deg' }, { scale: 0.7 }],
  },
});

export default GeodesicBackground;
