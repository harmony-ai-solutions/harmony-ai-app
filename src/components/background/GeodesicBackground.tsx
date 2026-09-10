/**
 * GeodesicBackground — Floating Luminous Shapes
 *
 * Renders several geometric shapes (circles, diamonds, rounded squares) that
 * drift slowly across the screen with organic Lissajous-like motion. Each shape
 * features a luminous outer glow, a semi-transparent body with edge highlight,
 * and a bright inner core — creating a dreamlike, shimmering atmosphere.
 *
 * Shapes move at independent speeds and depths, producing a layered parallax
 * effect. Drift, rotation, breathing, and glow-pulse animations run on the
 * native driver for smooth 60 fps performance.
 *
 * Colors are derived from the active theme's accent palette.
 *
 * Design: Ethereal, luminous, dreamlike — floating glowing lightforms.
 */

import React, { useEffect, useRef, useMemo } from 'react';
import {
  View,
  Animated,
  Dimensions,
  StyleSheet,
  Platform,
} from 'react-native';
import { useAppTheme } from '../../contexts/ThemeContext';

const { width: W, height: H } = Dimensions.get('window');

// ── Shape types ─────────────────────────────────────────────────
type ShapeType = 'circle' | 'diamond' | 'roundedSquare';

interface ShapeCfg {
  id: number;
  type: ShapeType;
  size: number;
  x: number;
  y: number;
  color: string;
  baseOpacity: number;
  driftRadiusX: number;
  driftRadiusY: number;
  driftPeriodX: number; // ms for full X oscillation
  driftPeriodY: number; // ms for full Y oscillation
  rotatePeriod: number; // ms for full rotation
  breathePeriod: number; // ms for full breathe cycle
  breatheMin: number;
  breatheMax: number;
  glowOpacity: number;
}

// ── Seeded PRNG ──────────────────────────────────────────────────
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SHAPE_TYPES: ShapeType[] = ['circle', 'diamond', 'roundedSquare'];

function buildShapes(primary: string, secondary: string): ShapeCfg[] {
  const rng = mulberry32(42);
  const colors = [primary, secondary];
  const shapes: ShapeCfg[] = [];

  for (let i = 0; i < 12; i++) {
    const type = SHAPE_TYPES[Math.floor(rng() * SHAPE_TYPES.length)];
    const size = 50 + rng() * 100; // 50–150
    shapes.push({
      id: i,
      type,
      size,
      x: rng() * W,
      y: rng() * H,
      color: colors[i % 2],
      baseOpacity: 0.20 + rng() * 0.25,        // 0.20–0.45
      driftRadiusX: 60 + rng() * 250,          // 60–310 — traverse large screen area
      driftRadiusY: 50 + rng() * 230,          // 50–280
      driftPeriodX: 4000 + rng() * 6000,       // 4–10 s
      driftPeriodY: 4500 + rng() * 7000,       // 4.5–11.5 s
      rotatePeriod: 6000 + rng() * 12000,      // 6–18 s
      breathePeriod: 1200 + rng() * 2000,      // 1.2–3.2 s — faster fading
      breatheMin: 0.50 + rng() * 0.20,
      breatheMax: 1.00 + rng() * 0.20,
      glowOpacity: 0.30 + rng() * 0.45,        // 0.30–0.75
    });
  }

  return shapes;
}

// ── Shape geometry helper ────────────────────────────────────────
function shapeMetrics(type: ShapeType, size: number) {
  switch (type) {
    case 'circle':
      return { width: size, height: size, borderRadius: size / 2 };
    case 'diamond':
      return { width: size * 0.7, height: size * 0.7, borderRadius: 4 };
    case 'roundedSquare':
      return { width: size, height: size, borderRadius: size * 0.2 };
  }
}

// ── Single Floating Shape ───────────────────────────────────────
interface FloatingShapeProps {
  shape: ShapeCfg;
}

const FloatingShape: React.FC<FloatingShapeProps> = React.memo(({ shape }) => {
  const driftX = useRef(new Animated.Value(0)).current;
  const driftY = useRef(new Animated.Value(0)).current;
  const rotate = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(1)).current;
  const glowPulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const halfX = shape.driftPeriodX / 2;
    const halfY = shape.driftPeriodY / 2;
    const halfB = shape.breathePeriod / 2;

    const composite = Animated.parallel([
      // Horizontal drift (oscillate between -1 and 1)
      Animated.loop(
        Animated.sequence([
          Animated.timing(driftX, { toValue: 1, duration: halfX, useNativeDriver: true }),
          Animated.timing(driftX, { toValue: -1, duration: halfX, useNativeDriver: true }),
        ]),
      ),
      // Vertical drift (oscillate between -1 and 1, different period for Lissajous motion)
      Animated.loop(
        Animated.sequence([
          Animated.timing(driftY, { toValue: 1, duration: halfY, useNativeDriver: true }),
          Animated.timing(driftY, { toValue: -1, duration: halfY, useNativeDriver: true }),
        ]),
      ),
      // Slow continuous rotation
      Animated.loop(
        Animated.timing(rotate, {
          toValue: 360,
          duration: shape.rotatePeriod,
          useNativeDriver: true,
        }),
      ),
      // Breathing scale
      Animated.loop(
        Animated.sequence([
          Animated.timing(breathe, { toValue: shape.breatheMax, duration: halfB, useNativeDriver: true }),
          Animated.timing(breathe, { toValue: shape.breatheMin, duration: halfB, useNativeDriver: true }),
        ]),
      ),
      // Asymmetric glow pulse
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowPulse, { toValue: 1.35, duration: halfB * 1.2, useNativeDriver: true }),
          Animated.timing(glowPulse, { toValue: 0.70, duration: halfB * 0.8, useNativeDriver: true }),
        ]),
      ),
    ]);

    composite.start();
    return () => composite.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Interpolations
  const translateX = driftX.interpolate({
    inputRange: [-1, 1],
    outputRange: [-shape.driftRadiusX, shape.driftRadiusX],
  });
  const translateY = driftY.interpolate({
    inputRange: [-1, 1],
    outputRange: [-shape.driftRadiusY, shape.driftRadiusY],
  });
  const rotateDeg = rotate.interpolate({
    inputRange: [0, 360],
    outputRange: shape.type === 'diamond' ? ['45deg', '405deg'] : ['0deg', '360deg'],
  });

  const metrics = shapeMetrics(shape.type, shape.size);
  const wrapperSize = shape.size * 2.8;
  const wrapperHalf = wrapperSize / 2;

  // Pre-compute child offsets for centered absolute positioning
  const outerGlowSize = wrapperSize;
  const midGlowSize = shape.size * 1.6;
  const midGlowOffset = (wrapperSize - midGlowSize) / 2;
  const shapeW = metrics.width;
  const shapeH = metrics.height;
  const shapeLeft = (wrapperSize - shapeW) / 2;
  const shapeTop = (wrapperSize - shapeH) / 2;
  const coreSize = shape.size * 0.28;
  const coreOffset = (wrapperSize - coreSize) / 2;

  return (
    <Animated.View
      style={[
        styles.shapeWrapper,
        {
          left: shape.x - wrapperHalf,
          top: shape.y - wrapperHalf,
          width: wrapperSize,
          height: wrapperSize,
          opacity: Animated.multiply(breathe, shape.baseOpacity),
          transform: [
            { translateX },
            { translateY },
            { rotate: rotateDeg },
            { scale: breathe },
          ],
        },
      ]}
      pointerEvents="none"
    >
      {/* Outer glow halo — fills entire wrapper */}
      <View
        style={[
          styles.absFill,
          {
            width: outerGlowSize,
            height: outerGlowSize,
            borderRadius: outerGlowSize / 2,
            backgroundColor: shape.color + '08',
          },
        ]}
        pointerEvents="none"
      />

      {/* Mid glow ring */}
      <View
        style={[
          styles.absCenter,
          {
            left: midGlowOffset,
            top: midGlowOffset,
            width: midGlowSize,
            height: midGlowSize,
            borderRadius: midGlowSize / 2,
            backgroundColor: shape.color + '12',
          },
        ]}
        pointerEvents="none"
      />

      {/* Shape body with edge highlight */}
      <View
        style={[
          styles.absCenter,
          {
            left: shapeLeft,
            top: shapeTop,
            width: shapeW,
            height: shapeH,
            borderRadius: metrics.borderRadius,
            backgroundColor: shape.color + '30',
            borderWidth: 1,
            borderColor: shape.color + '45',
            ...Platform.select({
              ios: {
                shadowColor: shape.color,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.55,
                shadowRadius: shape.size * 0.4,
              },
              android: {
                elevation: 4,
              },
            }),
          },
        ]}
        pointerEvents="none"
      />

      {/* Bright inner core — gives the "shining" effect */}
      <Animated.View
        style={[
          styles.absCenter,
          {
            left: coreOffset,
            top: coreOffset,
            width: coreSize,
            height: coreSize,
            borderRadius: coreSize / 2,
            backgroundColor: shape.color + '85',
            opacity: glowPulse,
            ...Platform.select({
              ios: {
                shadowColor: shape.color,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.9,
                shadowRadius: shape.size * 0.2,
              },
              android: {
                elevation: 6,
              },
            }),
          },
        ]}
        pointerEvents="none"
      />
    </Animated.View>
  );
});

FloatingShape.displayName = 'FloatingShape';

// ── Static fallback ─────────────────────────────────────────────
const StaticFallback: React.FC<{ base: string }> = React.memo(
  ({ base }) => (
    <View style={styles.root} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: base }]} />
    </View>
  ),
);
StaticFallback.displayName = 'GeodesicStaticFallback';

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

    const shapes = useMemo(() => buildShapes(primary, secondary), [primary, secondary]);

    if (!enabled) {
      return <StaticFallback base={base} />;
    }

    return (
      <View style={styles.root} pointerEvents="none">
        {/* Solid base */}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: base }]} />

        {/* Floating shapes */}
        {shapes.map((s) => (
          <FloatingShape key={s.id} shape={s} />
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
  shapeWrapper: {
    position: 'absolute',
    overflow: 'visible',
  },
  absFill: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  absCenter: {
    position: 'absolute',
  },
});

export default GeodesicBackground;
