/**
 * LightPillarsBackground — Volumetric Light Beams Rising from Below
 *
 * Renders 18-22 dramatic volumetric light pillars that rise from the bottom
 * edge of the screen. Each pillar has a bright core with soft translucent
 * edges — like real atmospheric light pillars seen in arctic skies.
 *
 * Pillars are rendered in 3 passes:
 *   1. A wide, low-opacity outer glow (the "atmospheric scatter")
 *   2. A medium-width mid-core with moderate brightness
 *   3. A narrow inner core with the highest intensity
 *
 * This triple-pass approach creates true volumetric light column depth.
 * Pillars sway gently, breathe in brightness, and their tips flicker
 * independently for an organic, living-light effect.
 *
 * Design: Dramatic, ethereal, vertical majestic presence.
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
  left: number;             // horizontal center
  coreWidth: number;        // inner bright core width
  midWidth: number;         // mid glow width
  outerWidth: number;       // outer atmospheric scatter
  height: number;           // as fraction of screen height
  colorA: string;           // bright core color
  colorB: string;           // feathered edge color
  baseOpacity: number;
  cycleMs: number;          // full sway+breath cycle
  swayX: number;            // horizontal sway amplitude
  opacityMin: number;
  opacityMax: number;
  tipFlickerMs: number;     // tip flicker cycle (faster)
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
  const colors = [primary, secondary];
  for (let i = 0; i < 20; i++) {
    const col = colors[Math.floor(rng() * colors.length)];
    const h = 0.35 + rng() * 0.6; // 35-95% of screen height
    pillars.push({
      id: i,
      left: rng() * W,
      coreWidth: 4 + rng() * 10,                         // 4-14px core
      midWidth: 12 + rng() * 28,                          // 12-40px mid
      outerWidth: 40 + rng() * 60,                        // 40-100px outer
      height: h,
      colorA: col,
      colorB: col,
      baseOpacity: 0.10 + rng() * 0.22,                   // 0.10-0.32
      cycleMs: 10000 + rng() * 20000,                     // 10-30s
      swayX: (rng() - 0.5) * 60,                          // ±0-30px sway
      opacityMin: 0.06 + rng() * 0.08,
      opacityMax: 0.22 + rng() * 0.28,
      tipFlickerMs: 2000 + rng() * 4000,                  // 2-6s tip flicker
    });
  }
  return pillars;
}

// ── Single Pillar (3-pass volumetric) ────────────────────────────
const VolumetricPillar: React.FC<{ cfg: PillarCfg }> = ({ cfg }) => {
  const swayX = useRef(new Animated.Value(0)).current;
  const op = useRef(new Animated.Value(cfg.baseOpacity)).current;
  const tipOp = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const half = cfg.cycleMs / 2;
    const tipHalf = cfg.tipFlickerMs / 2;

    const composite = Animated.parallel([
      // Sway
      Animated.loop(
        Animated.sequence([
          Animated.timing(swayX, { toValue: cfg.swayX, duration: half, useNativeDriver: true }),
          Animated.timing(swayX, { toValue: -cfg.swayX, duration: half, useNativeDriver: true }),
        ]),
      ),
      // Global breathe
      Animated.loop(
        Animated.sequence([
          Animated.timing(op, { toValue: cfg.opacityMin * 0.5, duration: half * 0.7, useNativeDriver: true }),
          Animated.timing(op, { toValue: cfg.opacityMax, duration: half * 1.3, useNativeDriver: true }),
        ]),
      ),
      // Independent tip flicker
      Animated.loop(
        Animated.sequence([
          Animated.timing(tipOp, { toValue: 0.4, duration: tipHalf * 0.4, useNativeDriver: true }),
          Animated.timing(tipOp, { toValue: 1.0, duration: tipHalf * 1.1, useNativeDriver: true }),
          Animated.timing(tipOp, { toValue: 0.6, duration: tipHalf * 0.5, useNativeDriver: true }),
        ]),
      ),
    ]);

    composite.start();
    return () => composite.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pillarH = H * cfg.height;

  return (
    <Animated.View
      style={[
        styles.pillarRoot,
        {
          left: cfg.left,
          bottom: 0,
          transform: [{ translateX: swayX }],
        },
      ]}
      pointerEvents="none"
    >
      {/* Layer 3: Wide atmospheric outer glow */}
      <Animated.View
        style={[
          styles.pillarLayer,
          {
            width: cfg.outerWidth,
            height: pillarH,
            marginLeft: -cfg.outerWidth / 2,
            opacity: Animated.multiply(op, 0.35),
          },
        ]}
        pointerEvents="none"
      >
        <LinearGradient
          colors={[cfg.colorA + '08', cfg.colorA + '03', cfg.colorB + '00']}
          start={{ x: 0.5, y: 1 }}
          end={{ x: 0.5, y: 0 }}
          style={styles.pillarFill}
        />
      </Animated.View>

      {/* Layer 2: Mid-width glow */}
      <Animated.View
        style={[
          styles.pillarLayer,
          {
            width: cfg.midWidth,
            height: pillarH,
            marginLeft: -cfg.midWidth / 2,
            opacity: Animated.multiply(op, 0.65),
          },
        ]}
        pointerEvents="none"
      >
        <LinearGradient
          colors={[cfg.colorA + '33', cfg.colorA + '0D', cfg.colorB + '00']}
          start={{ x: 0.5, y: 1 }}
          end={{ x: 0.5, y: 0 }}
          style={styles.pillarFill}
        />
      </Animated.View>

      {/* Layer 1: Narrow intense core */}
      <Animated.View
        style={[
          styles.pillarLayer,
          {
            width: cfg.coreWidth,
            height: pillarH * 1.02, // slightly taller than mid for tip highlight
            marginLeft: -cfg.coreWidth / 2,
            opacity: Animated.multiply(op, 1.0),
          },
        ]}
        pointerEvents="none"
      >
        <LinearGradient
          colors={[cfg.colorA + 'BB', cfg.colorA + '33', cfg.colorB + '00']}
          start={{ x: 0.5, y: 1 }}
          end={{ x: 0.5, y: 0 }}
          style={styles.pillarFill}
        />
      </Animated.View>

      {/* Tip highlight: bright dot at the very top with independent flicker */}
      <Animated.View
        style={[
          styles.tipDot,
          {
            bottom: pillarH - 2,
            left: -cfg.coreWidth * 0.6,
            width: cfg.coreWidth * 1.2,
            height: cfg.coreWidth * 0.5,
            borderRadius: cfg.coreWidth * 0.25,
            backgroundColor: cfg.colorA + 'DD',
            opacity: Animated.multiply(Animated.multiply(op, tipOp), 0.7),
          },
        ]}
        pointerEvents="none"
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
        {/* Subtle ground-level glow where pillars originate */}
        <View
          style={[
            styles.groundGlow,
            {
              backgroundColor: primary + '0A',
              height: H * 0.08,
            },
          ]}
          pointerEvents="none"
        />
        {pillars.map((p) => (
          <VolumetricPillar key={p.id} cfg={p} />
        ))}
        {/* Vignette to anchor screen edges */}
        <LinearGradient
          colors={[base + '00', base + '22', base + '55']}
          start={{ x: 0.5, y: 0.2 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
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
  pillarRoot: {
    position: 'absolute',
    alignItems: 'center',
  },
  pillarLayer: {
    position: 'absolute',
    bottom: 0,
  },
  pillarFill: {
    flex: 1,
  },
  tipDot: {
    position: 'absolute',
  },
  groundGlow: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
});

export default LightPillarsBackground;
