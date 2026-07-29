/**
 * GradientFlowBackground — Flowing Diagonal Gradient Ribbons
 *
 * Renders 6-8 wide diagonal gradient strips that slowly flow across
 * the screen at varying speeds and angles. Each strip is a full-width
 * LinearGradient that fades to transparent on both edges, creating a
 * layered, fluid motion effect like aurora ribbons or flowing silk.
 *
 * Design: Fluid, sweeping, modern — inspired by gradient mesh art.
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
const DIAG = Math.sqrt(W * W + H * H);

// ── Ribbon config ───────────────────────────────────────────────
interface RibbonCfg {
  id: number;
  thickness: number;     // ribbon width (fraction of screen height)
  angle: number;         // degrees from horizontal
  startX: number;        // initial horizontal position fraction
  startY: number;        // initial vertical position fraction
  colorA: string;
  colorB: string;
  opacity: number;
  cycleMs: number;
  driftX: number;
  driftY: number;
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

function buildRibbons(primary: string, secondary: string): RibbonCfg[] {
  const rng = mulberry32(739);
  const ribbons: RibbonCfg[] = [];
  for (let i = 0; i < 8; i++) {
    const isPrimary = rng() > 0.45;
    ribbons.push({
      id: i,
      thickness: 0.06 + rng() * 0.18,                // 6-24% of screen height
      angle: -30 + rng() * 60,                       // -30 to +30 degrees
      startX: rng() * 1.2 - 0.2,
      startY: rng() * 1.2 - 0.2,
      colorA: isPrimary ? primary + 'AA' : secondary + 'AA',
      colorB: 'transparent',
      opacity: 0.15 + rng() * 0.25,                  // 0.15-0.40
      cycleMs: 15000 + rng() * 25000,                // 15-40s
      driftX: (rng() - 0.5) * W * 0.5,
      driftY: (rng() - 0.5) * H * 0.4,
    });
  }
  return ribbons;
}

// ── Ribbon widget ───────────────────────────────────────────────
const RibbonWidget: React.FC<{ cfg: RibbonCfg }> = ({ cfg }) => {
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const op = useRef(new Animated.Value(cfg.opacity)).current;

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
          Animated.timing(op, { toValue: cfg.opacity * 0.45, duration: half * 0.6, useNativeDriver: true }),
          Animated.timing(op, { toValue: cfg.opacity * 1.5, duration: half * 1.4, useNativeDriver: true }),
        ]),
      ),
    ]);

    composite.start();

    return () => composite.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const angleRad = (cfg.angle * Math.PI) / 180;
  const ribbonWidth = H * cfg.thickness;

  return (
    <Animated.View
      style={[
        styles.ribbon,
        {
          width: DIAG * 1.5,
          height: ribbonWidth,
          left: W * cfg.startX - (DIAG * 1.5) / 2,
          top: H * cfg.startY - ribbonWidth / 2,
          opacity: op,
          transform: [
            { translateX: tx },
            { translateY: ty },
            { rotate: `${cfg.angle}deg` },
          ],
        },
      ]}
      pointerEvents="none"
    >
      <LinearGradient
        colors={[cfg.colorB, cfg.colorA, cfg.colorA, cfg.colorB]}
        locations={[0, 0.15, 0.85, 1]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={styles.ribbonFill}
      />
    </Animated.View>
  );
};

// ── Public component ───────────────────────────────────────────
interface GradientFlowBackgroundProps {
  enabled?: boolean;
}

export const GradientFlowBackground: React.FC<GradientFlowBackgroundProps> = React.memo(
  ({ enabled = true }) => {
    const { theme } = useAppTheme();
    const primary = theme?.colors.accent.primary || '#8f3ba7';
    const secondary = theme?.colors.accent.secondary || '#22318e';
    const base = theme?.colors.background.base || '#0b0f19';

    const ribbons = useMemo(() => buildRibbons(primary, secondary), [primary, secondary]);

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
        {ribbons.map((r) => (
          <RibbonWidget key={r.id} cfg={r} />
        ))}
      </View>
    );
  },
);

GradientFlowBackground.displayName = 'GradientFlowBackground';

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
  },
  ribbon: {
    position: 'absolute',
    overflow: 'visible',
  },
  ribbonFill: {
    flex: 1,
  },
});

export default GradientFlowBackground;
