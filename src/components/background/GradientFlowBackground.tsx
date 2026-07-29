/**
 * GradientFlowBackground — Multi-Layered Flowing Gradient Ribbons
 *
 * Renders 14+ flowing gradient ribbons in 3 distinct depth layers:
 *   1. BACKGROUND (4-5 ribbons): Broad, very faint, slow-moving bands
 *      that create deep atmospheric texture
 *   2. MIDGROUND (5-6 ribbons): Medium-width bands with moderate opacity,
 *      flowing in gentle diagonal sweeps — the main "aurora" feel
 *   3. FOREGROUND (4 ribbons): Thin, bright accent streaks that catch
 *      the eye and add dynamic energy
 *
 * Ribbons use smooth sine-wave motion paths (via multi-segment keyframe
 * sequences) rather than simple linear back-and-forth. Each ribbon has
 * a soft gradient that fades to transparent on both ends via 4-stop
 * color arrays, creating true flowing-silk edges.
 *
 * Design: Fluid, sweeping, modern — a living gradient canvas.
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
type RibbonLayer = 'background' | 'midground' | 'foreground';

interface RibbonCfg {
  id: number;
  layer: RibbonLayer;
  thickness: number;     // as fraction of screen height
  angle: number;         // degrees
  startX: number;        // initial X fraction
  startY: number;        // initial Y fraction
  colorA: string;        // peak color (with alpha)
  colorB: string;        // edge fade color
  opacity: number;
  cycleMs: number;       // full drift cycle
  // Multi-segment path for organic motion
  pathX: number[];
  pathY: number[];
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

// Build organic multi-point path for a ribbon
function buildOrganicPath(
  rng: () => number,
  amplitudeX: number,
  amplitudeY: number,
  segments: number,
): number[] {
  const path: number[] = [0];
  for (let i = 0; i < segments; i++) {
    const sign = i % 2 === 0 ? 1 : -1;
    path.push(sign * amplitudeX * (0.3 + rng() * 0.7));
    path.push(-sign * amplitudeX * (0.4 + rng() * 0.6));
  }
  return path;
}

function buildRibbons(primary: string, secondary: string): RibbonCfg[] {
  const rng = mulberry32(739);
  const ribbons: RibbonCfg[] = [];

  // ── Background layer: broad, slow, very faint ─────────────────
  for (let i = 0; i < 5; i++) {
    const isPrimary = rng() > 0.5;
    const color = isPrimary ? primary : secondary;
    ribbons.push({
      id: i,
      layer: 'background',
      thickness: 0.12 + rng() * 0.16,                  // 12-28% of screen
      angle: -35 + rng() * 70,                          // -35 to +35 degrees
      startX: rng() * 1.2 - 0.2,
      startY: rng() * 1.2 - 0.2,
      colorA: color + '0D',
      colorB: color + '00',
      opacity: 0.10 + rng() * 0.12,                     // 0.10-0.22
      cycleMs: 35000 + rng() * 35000,                   // 35-70s (very slow)
      pathX: buildOrganicPath(rng, W * 0.3, H * 0.2, 3),
      pathY: buildOrganicPath(rng, W * 0.2, H * 0.3, 3),
    });
  }

  // ── Midground layer: medium width, moderate opacity ───────────
  for (let i = 5; i < 11; i++) {
    const isPrimary = rng() > 0.4;
    const color = isPrimary ? primary : secondary;
    ribbons.push({
      id: i,
      layer: 'midground',
      thickness: 0.05 + rng() * 0.10,                   // 5-15% of screen
      angle: -25 + rng() * 50,                          // -25 to +25 degrees
      startX: rng() * 1.3 - 0.25,
      startY: rng() * 1.3 - 0.25,
      colorA: color + '44',
      colorB: color + '00',
      opacity: 0.18 + rng() * 0.20,                     // 0.18-0.38
      cycleMs: 18000 + rng() * 24000,                   // 18-42s
      pathX: buildOrganicPath(rng, W * 0.35, H * 0.25, 4),
      pathY: buildOrganicPath(rng, W * 0.25, H * 0.35, 4),
    });
  }

  // ── Foreground layer: thin, bright accent streaks ─────────────
  for (let i = 11; i < 15; i++) {
    const isPrimary = rng() > 0.35;
    const color = isPrimary ? primary : secondary;
    ribbons.push({
      id: i,
      layer: 'foreground',
      thickness: 0.015 + rng() * 0.03,                  // 1.5-4.5% of screen (thin)
      angle: -15 + rng() * 30,                          // -15 to +15 degrees
      startX: rng() * 1.1 - 0.15,
      startY: rng() * 1.1 - 0.15,
      colorA: color + '99',
      colorB: color + '00',
      opacity: 0.25 + rng() * 0.30,                     // 0.25-0.55
      cycleMs: 12000 + rng() * 16000,                   // 12-28s (faster)
      pathX: buildOrganicPath(rng, W * 0.45, H * 0.2, 5),
      pathY: buildOrganicPath(rng, W * 0.2, H * 0.35, 5),
    });
  }

  return ribbons;
}

// ── Ribbon Widget (organic multi-segment path) ──────────────────
const FlowRibbon: React.FC<{ cfg: RibbonCfg }> = ({ cfg }) => {
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const op = useRef(new Animated.Value(cfg.opacity)).current;
  const sc = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const totalPathX = cfg.pathX;
    const totalPathY = cfg.pathY;
    const segCount = Math.max(totalPathX.length, totalPathY.length);
    const segDur = cfg.cycleMs / segCount;

    // Build X keyframe sequence
    const xSeq: Animated.CompositeAnimation[] = [];
    for (const val of totalPathX) {
      xSeq.push(Animated.timing(tx, {
        toValue: val, duration: segDur, useNativeDriver: true,
      }));
    }

    // Build Y keyframe sequence
    const ySeq: Animated.CompositeAnimation[] = [];
    for (const val of totalPathY) {
      ySeq.push(Animated.timing(ty, {
        toValue: val, duration: segDur, useNativeDriver: true,
      }));
    }

    // Opacity breathe
    const opSeq: Animated.CompositeAnimation[] = [];
    for (let i = 0; i < segCount; i++) {
      const targetOp = i % 2 === 0 ? cfg.opacity * 1.35 : cfg.opacity * 0.55;
      opSeq.push(Animated.timing(op, {
        toValue: targetOp, duration: segDur, useNativeDriver: true,
      }));
    }

    // Subtle scale pulse (foreground ribbons get more pronounced pulsing)
    const scPulse = cfg.layer === 'foreground' ? 0.04 : 0.015;
    const scSeq: Animated.CompositeAnimation[] = [];
    for (let i = 0; i < segCount; i++) {
      const targetSc = i % 2 === 0 ? 1 + scPulse : 1 - scPulse * 0.7;
      scSeq.push(Animated.timing(sc, {
        toValue: targetSc, duration: segDur, useNativeDriver: true,
      }));
    }

    const composite = Animated.parallel([
      Animated.loop(Animated.sequence(xSeq)),
      Animated.loop(Animated.sequence(ySeq)),
      Animated.loop(Animated.sequence(opSeq)),
      Animated.loop(Animated.sequence(scSeq)),
    ]);

    composite.start();
    return () => composite.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ribbonWidth = H * cfg.thickness;
  const halfDiag = DIAG * 0.75;

  return (
    <Animated.View
      style={[
        styles.ribbon,
        {
          width: DIAG * 1.5,
          height: ribbonWidth,
          left: W * cfg.startX - halfDiag,
          top: H * cfg.startY - ribbonWidth / 2,
          opacity: op,
          transform: [
            { translateX: tx },
            { translateY: ty },
            { rotate: `${cfg.angle}deg` },
            { scale: sc },
          ],
        },
      ]}
      pointerEvents="none"
    >
      <LinearGradient
        colors={[cfg.colorB, cfg.colorA, cfg.colorA, cfg.colorB]}
        locations={[0, 0.18, 0.82, 1]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={styles.ribbonFill}
      />
    </Animated.View>
  );
};

// ── Static fallback ─────────────────────────────────────────────
const StaticFallback: React.FC<{ base: string; primary: string; secondary: string }> = React.memo(
  ({ base, primary, secondary }) => (
    <View style={styles.root} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: base }]} />
      <LinearGradient
        colors={[primary + '11', secondary + '0C', base]}
        start={{ x: 0.2, y: 0.1 }}
        end={{ x: 0.8, y: 0.9 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
    </View>
  ),
);
StaticFallback.displayName = 'GradientFlowStaticFallback';

// ── Public component ────────────────────────────────────────────
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
      return <StaticFallback base={base} primary={primary} secondary={secondary} />;
    }

    // Order by layer: background first, then midground, then foreground
    const sorted = [...ribbons].sort((a, b) => {
      const order = { background: 0, midground: 1, foreground: 2 };
      return order[a.layer] - order[b.layer];
    });

    return (
      <View style={styles.root} pointerEvents="none">
        {/* Solid base */}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: base }]} />

        {/* All ribbons, layered */}
        {sorted.map((r) => (
          <FlowRibbon key={r.id} cfg={r} />
        ))}

        {/* Soft vignette at edges */}
        <LinearGradient
          colors={[base + '00', base + '22', base + '55']}
          start={{ x: 0.5, y: 0.5 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <LinearGradient
          colors={[base + '00', base + '22', base + '55']}
          start={{ x: 0.5, y: 0.5 }}
          end={{ x: 0, y: 0 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
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
