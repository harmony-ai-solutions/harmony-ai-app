/**
 * LightPillarsBackground — Vertical Light Beams Rising from Below
 *
 * Renders 10-12 vertical light pillars that rise from the bottom edge
 * of the screen with soft glowing gradients and subtle horizontal sway.
 * Each pillar varies in width, height, color, and opacity, creating
 * an ethereal "light column" effect reminiscent of arctic light pillars
 * or stage lighting.
 *
 * Design: Elegant, atmospheric, vertical emphasis.
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

// ── Pillar config ───────────────────────────────────────────────
interface PillarCfg {
  id: number;
  left: number;          // horizontal position
  width: number;         // pillar width
  height: number;        // pillar height (as fraction of screen)
  colorA: string;
  colorB: string;
  opacity: number;
  cycleMs: number;
  swayX: number;         // max horizontal sway
  opacityMin: number;    // min opacity during breathing
  opacityMax: number;    // max opacity during breathing
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

function buildPillars(primary: string, secondary: string): PillarCfg[] {
  const rng = mulberry32(419);
  const pillars: PillarCfg[] = [];
  for (let i = 0; i < 10; i++) {
    const isPrimary = rng() > 0.5;
    const baseColor = isPrimary ? primary : secondary;
    pillars.push({
      id: i,
      left: rng() * W,
      width: 15 + rng() * 55,                         // 15-70px wide
      height: 0.3 + rng() * 0.7,                      // 30-100% of screen height
      colorA: baseColor + '99',
      colorB: baseColor + '00',                        // fade to transparent at top
      opacity: 0.18 + rng() * 0.28,                    // 0.18-0.46
      cycleMs: 8000 + rng() * 16000,                   // 8-24s
      swayX: (rng() - 0.5) * 40,                       // ±0-20px sway
      opacityMin: 0.12 + rng() * 0.12,
      opacityMax: 0.28 + rng() * 0.24,
    });
  }
  return pillars;
}

// ── Pillar widget ───────────────────────────────────────────────
const PillarWidget: React.FC<{ cfg: PillarCfg }> = ({ cfg }) => {
  const tx = useRef(new Animated.Value(0)).current;
  const op = useRef(new Animated.Value(cfg.opacity)).current;

  useEffect(() => {
    const half = cfg.cycleMs / 2;

    const composite = Animated.parallel([
      Animated.loop(
        Animated.sequence([
          Animated.timing(tx, { toValue: cfg.swayX, duration: half, useNativeDriver: true }),
          Animated.timing(tx, { toValue: -cfg.swayX, duration: half, useNativeDriver: true }),
        ]),
      ),
      Animated.loop(
        Animated.sequence([
          Animated.timing(op, { toValue: cfg.opacityMin, duration: half * 0.7, useNativeDriver: true }),
          Animated.timing(op, { toValue: cfg.opacityMax, duration: half * 1.3, useNativeDriver: true }),
        ]),
      ),
    ]);

    composite.start();

    return () => composite.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      style={[
        styles.pillar,
        {
          left: cfg.left - cfg.width / 2,
          bottom: 0,
          width: cfg.width,
          height: H * cfg.height,
          opacity: op,
          transform: [{ translateX: tx }],
        },
      ]}
      pointerEvents="none"
    >
      <LinearGradient
        colors={[cfg.colorA, cfg.colorB]}
        start={{ x: 0.5, y: 1 }}
        end={{ x: 0.5, y: 0 }}
        style={styles.pillarFill}
      />
    </Animated.View>
  );
};

// ── Public component ────────────────────────────────────────────
interface LightPillarsBackgroundProps {
  enabled?: boolean;
}

export const LightPillarsBackground: React.FC<LightPillarsBackgroundProps> = React.memo(
  ({ enabled = true }) => {
    const { theme } = useAppTheme();
    const primary = theme?.colors.accent.primary || '#8f3ba7';
    const secondary = theme?.colors.accent.secondary || '#22318e';
    const base = theme?.colors.background.base || '#0b0f19';

    const pillars = useMemo(() => buildPillars(primary, secondary), [primary, secondary]);

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
        {pillars.map((p) => (
          <PillarWidget key={p.id} cfg={p} />
        ))}
      </View>
    );
  },
);

LightPillarsBackground.displayName = 'LightPillarsBackground';

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
  },
  pillar: {
    position: 'absolute',
  },
  pillarFill: {
    flex: 1,
  },
});

export default LightPillarsBackground;
