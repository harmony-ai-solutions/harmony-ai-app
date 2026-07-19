/**
 * DynamicAtmosphericBackground — Aurora/Nebula Animated Background
 *
 * Renders 7 huge overlapping gradient orbs that slowly drift, pulse,
 * and shift across the screen using the Haute Goth theme palette.
 * Each orb is 1.5-2.5× the screen size with higher opacity for a
 * bold, living "nebula" feel. All animations run on the native
 * driver for 60fps performance.
 *
 * Palette: Deep Goth Blue-Black (#0b0f19), Neon Magenta (#8f3ba7), Indigo (#22318e)
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

// ── Blob config ────────────────────────────────────────────────
interface BlobCfg {
  id: number;
  size: number;          // diameter
  left: number;          // initial left offset
  top: number;           // initial top offset
  colorA: string;        // gradient start
  colorB: string;        // gradient end
  opacity: number;       // base opacity
  cycleMs: number;       // full animation cycle
  moveX: number;         // horizontal drift amplitude
  moveY: number;         // vertical drift amplitude
}

function buildConfigs(primary: string, secondary: string): BlobCfg[] {
  return [
    {
      id: 1, size: DIAG * 2.1, left: -W * 0.5, top: -H * 0.6,
      colorA: primary + 'DD', colorB: 'transparent',
      opacity: 0.35, cycleMs: 18000, moveX: W * 0.35, moveY: H * 0.25,
    },
    {
      id: 2, size: DIAG * 1.8, left: W * 0.3, top: -H * 0.4,
      colorA: secondary + 'DD', colorB: 'transparent',
      opacity: 0.30, cycleMs: 22000, moveX: -W * 0.30, moveY: H * 0.30,
    },
    {
      id: 3, size: DIAG * 2.4, left: -W * 0.2, top: H * 0.3,
      colorA: primary + 'CC', colorB: secondary + '88',
      opacity: 0.25, cycleMs: 25000, moveX: W * 0.20, moveY: -H * 0.35,
    },
    {
      id: 4, size: DIAG * 1.6, left: W * 0.4, top: H * 0.2,
      colorA: secondary + 'CC', colorB: primary + '66',
      opacity: 0.28, cycleMs: 16000, moveX: -W * 0.40, moveY: -H * 0.20,
    },
    {
      id: 5, size: DIAG * 2.0, left: -W * 0.35, top: H * 0.45,
      colorA: primary + 'BB', colorB: 'transparent',
      opacity: 0.22, cycleMs: 20000, moveX: W * 0.25, moveY: -H * 0.15,
    },
    {
      id: 6, size: DIAG * 1.4, left: W * 0.5, top: -H * 0.5,
      colorA: secondary + 'CC', colorB: 'transparent',
      opacity: 0.26, cycleMs: 14000, moveX: -W * 0.20, moveY: H * 0.20,
    },
    {
      id: 7, size: DIAG * 1.9, left: -W * 0.1, top: -H * 0.15,
      colorA: primary + '99', colorB: secondary + '99',
      opacity: 0.20, cycleMs: 19000, moveX: W * 0.15, moveY: H * 0.25,
    },
  ];
}

// ── AuroraBlob ─────────────────────────────────────────────────
const AuroraBlob: React.FC<{ cfg: BlobCfg }> = ({ cfg }) => {
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const op = useRef(new Animated.Value(cfg.opacity)).current;
  const sc = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Each blob oscillates in a smooth back-and-forth with scale pulsing
    const halfC = cfg.cycleMs / 2;

    // Translation — sinusoidal drift
    const loopX = Animated.loop(
      Animated.sequence([
        Animated.timing(tx, { toValue: cfg.moveX, duration: halfC, useNativeDriver: true }),
        Animated.timing(tx, { toValue: -cfg.moveX, duration: halfC, useNativeDriver: true }),
      ]),
    );
    const loopY = Animated.loop(
      Animated.sequence([
        Animated.timing(ty, { toValue: cfg.moveY, duration: halfC * 0.8, useNativeDriver: true }),
        Animated.timing(ty, { toValue: -cfg.moveY, duration: halfC * 1.2, useNativeDriver: true }),
      ]),
    );
    // Opacity breathing
    const loopOp = Animated.loop(
      Animated.sequence([
        Animated.timing(op, { toValue: cfg.opacity * 0.6, duration: halfC * 0.6, useNativeDriver: true }),
        Animated.timing(op, { toValue: cfg.opacity * 1.2, duration: halfC * 1.4, useNativeDriver: true }),
      ]),
    );
    // Scale pulsing
    const loopSc = Animated.loop(
      Animated.sequence([
        Animated.timing(sc, { toValue: 1.08, duration: halfC * 0.7, useNativeDriver: true }),
        Animated.timing(sc, { toValue: 0.94, duration: halfC * 1.3, useNativeDriver: true }),
      ]),
    );

    Animated.parallel([loopX, loopY, loopOp, loopSc]).start();
  }, [cfg, tx, ty, op, sc]);

  const r = cfg.size / 2;

  return (
    <Animated.View
      style={[
        styles.blob,
        {
          width: cfg.size,
          height: cfg.size,
          borderRadius: r,
          left: cfg.left,
          top: cfg.top,
          opacity: op,
          transform: [{ translateX: tx }, { translateY: ty }, { scale: sc }],
        },
      ]}
      pointerEvents="none"
    >
      <LinearGradient
        colors={[cfg.colorA, cfg.colorB]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.blobFill, { borderRadius: r }]}
      />
    </Animated.View>
  );
};

<<<<<<< HEAD
// ── Static gradient background (rendered when dynamic effects are disabled) ──
interface StaticGradientBackgroundProps {
  base: string;
  primary: string;
  secondary: string;
}

const StaticGradientBackground: React.FC<StaticGradientBackgroundProps> = React.memo(
  ({ base, primary, secondary }) => {
    return (
      <View style={styles.root} pointerEvents="none">
        {/* Solid base fill */}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: base }]} />

        {/* Static gradient layering — Deep Blue-Black, Magenta, Indigo */}
        <LinearGradient
          colors={[primary + '44', secondary + '33', base]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <LinearGradient
          colors={[secondary + '33', primary + '33']}
          start={{ x: 0.3, y: 0.2 }}
          end={{ x: 0.8, y: 0.7 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <LinearGradient
          colors={[base + '00', base + '33', base + '88']}
          start={{ x: 0.5, y: 0.5 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <LinearGradient
          colors={[base + '00', base + '33', base + '88']}
          start={{ x: 0.5, y: 0.5 }}
          end={{ x: 0, y: 0 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      </View>
    );
  },
);

StaticGradientBackground.displayName = 'StaticGradientBackground';

// ── Public component ───────────────────────────────────────────
interface DynamicAtmosphericBackgroundProps {
  enabled?: boolean;
}

export const DynamicAtmosphericBackground: React.FC<DynamicAtmosphericBackgroundProps> = React.memo(
  ({ enabled = true }) => {
    const { theme } = useAppTheme();
    const primary = theme?.colors.accent.primary || '#8f3ba7';
    const secondary = theme?.colors.accent.secondary || '#22318e';
    const base = theme?.colors.background.base || '#0b0f19';

    const configs = useMemo(() => buildConfigs(primary, secondary), [primary, secondary]);

    // When disabled, render a static gradient without any animations
    if (!enabled) {
      return <StaticGradientBackground base={base} primary={primary} secondary={secondary} />;
    }

    return (
      <View style={styles.root} pointerEvents="none">
        {/* Solid base fill */}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: base }]} />

        {/* Animated nebula orbs */}
        {configs.map((c) => (
          <AuroraBlob key={c.id} cfg={c} />
        ))}

        {/* Very light vignette — just enough to keep corners anchored but let light through */}
        <LinearGradient
          colors={[base + '00', base + '33', base + '77']}
          start={{ x: 0.5, y: 0.5 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <LinearGradient
          colors={[base + '00', base + '33', base + '77']}
          start={{ x: 0.5, y: 0.5 }}
          end={{ x: 0, y: 0 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      </View>
    );
  },
);
=======
// ── Public component ───────────────────────────────────────────
export const DynamicAtmosphericBackground: React.FC = React.memo(() => {
  const { theme } = useAppTheme();
  const primary = theme?.colors.accent.primary || '#8f3ba7';
  const secondary = theme?.colors.accent.secondary || '#22318e';
  const base = theme?.colors.background.base || '#0b0f19';

  const configs = useMemo(() => buildConfigs(primary, secondary), [primary, secondary]);

  return (
    <View style={styles.root} pointerEvents="none">
      {/* Solid base fill */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: base }]} />

      {/* Animated nebula orbs */}
      {configs.map((c) => (
        <AuroraBlob key={c.id} cfg={c} />
      ))}

      {/* Very light vignette — just enough to keep corners anchored but let light through */}
      <LinearGradient
        colors={[base + '00', base + '33', base + '77']}
        start={{ x: 0.5, y: 0.5 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <LinearGradient
        colors={[base + '00', base + '33', base + '77']}
        start={{ x: 0.5, y: 0.5 }}
        end={{ x: 0, y: 0 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
    </View>
  );
});
>>>>>>> 89108f84f460425ac7ff9b682d305132b728be3a

DynamicAtmosphericBackground.displayName = 'DynamicAtmosphericBackground';

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
  },
  blob: {
    position: 'absolute',
    overflow: 'hidden',
  },
  blobFill: {
    flex: 1,
  },
});

export default DynamicAtmosphericBackground;
