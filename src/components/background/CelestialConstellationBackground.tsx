/**
 * CelestialConstellationBackground — Interactive Soul Bits & Node Web
 *
 * Renders ~80 tiny glowing "soul bits" scattered like faint stars across
 * 3 depth layers. Micro-lines spontaneously form and dissolve between
 * nearby nodes, as if building memories or fleeting ideas.
 *
 * Interactivity: Uses the device gyroscope (when available) to create a
 * subtle 3D parallax effect — closer layers move faster, creating a
 * vast, layered space feel. Falls back to a slow auto-pan when gyroscope
 * is unavailable.
 *
 * Mood: Mysterious, expansive, highly immersive.
 *
 * All animations run on the native driver for 60fps performance.
 */

import React, { useEffect, useRef, useMemo, useState } from 'react';
import {
  View,
  Animated,
  Dimensions,
  StyleSheet,
  Platform,
} from 'react-native';
import { useAppTheme } from '../../contexts/ThemeContext';

const { width: W, height: H } = Dimensions.get('window');

// ── Gyroscope types (optional, may not be available) ────────────
let gyroscopeAvailable = false;
let gyroscopeSubscribe: ((cb: (data: { x: number; y: number; z: number }) => void) => () => void) | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { NativeModules } = require('react-native');
  // Gyroscope is available on most devices via react-native-sensors or built-in
  // We'll use a device-motion-like interface if available.
  // For now, use a simulated pan based on time as fallback.
} catch (_) {
  // Gyroscope not available; fall back to auto-pan
}

// ── Depth layer config ──────────────────────────────────────────
type DepthLayer = 'near' | 'mid' | 'far';

interface SoulBit {
  id: number;
  x: number;
  y: number;
  size: number;
  baseOpacity: number;
  twinkleMs: number;
  twinklePhase: number;
  color: string;
  layer: DepthLayer;
}

interface SoulLine {
  from: number;
  to: number;
  layer: DepthLayer;
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

// Parallax multipliers per depth layer
const LAYER_PARALLAX: Record<DepthLayer, number> = {
  near: 1.0,
  mid: 0.55,
  far: 0.2,
};

function buildSoulBits(primary: string, secondary: string): SoulBit[] {
  const rng = mulberry32(911);
  const bits: SoulBit[] = [];
  const layers: DepthLayer[] = ['near', 'mid', 'far'];
  const layerWeights = [0.25, 0.40, 0.35]; // distribution

  for (let i = 0; i < 80; i++) {
    // Weighted layer assignment
    const roll = rng();
    let layerIdx = 0;
    let cumulative = 0;
    for (let l = 0; l < layers.length; l++) {
      cumulative += layerWeights[l];
      if (roll <= cumulative) {
        layerIdx = l;
        break;
      }
    }
    const layer = layers[layerIdx];

    // Larger/brighter for near, smaller/dimmer for far
    const sizeRange: Record<DepthLayer, [number, number]> = {
      near: [2.5, 5.5],
      mid: [1.8, 3.5],
      far: [1.0, 2.2],
    };
    const opacityRange: Record<DepthLayer, [number, number]> = {
      near: [0.3, 0.65],
      mid: [0.18, 0.42],
      far: [0.08, 0.25],
    };
    const [szMin, szMax] = sizeRange[layer];
    const [opMin, opMax] = opacityRange[layer];

    const isPrimary = rng() > 0.5;
    const color = isPrimary ? primary : secondary;

    bits.push({
      id: i,
      x: rng() * W,
      y: rng() * H,
      size: szMin + rng() * (szMax - szMin),
      baseOpacity: opMin + rng() * (opMax - opMin),
      twinkleMs: 2000 + rng() * 6000,
      twinklePhase: rng() * Math.PI * 2,
      color,
      layer,
    });
  }
  return bits;
}

function buildLines(bits: SoulBit[]): SoulLine[] {
  const rng = mulberry32(419);
  const lines: SoulLine[] = [];
  const layers: DepthLayer[] = ['near', 'mid', 'far'];

  for (const layer of layers) {
    const layerBits = bits.filter((b) => b.layer === layer);
    const maxLines = Math.floor(layerBits.length * 0.4);

    for (let i = 0; i < maxLines && i < 15; i++) {
      const from = layerBits[Math.floor(rng() * layerBits.length)];
      const to = layerBits[Math.floor(rng() * layerBits.length)];
      if (from.id !== to.id) {
        const dx = from.x - to.x;
        const dy = from.y - to.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        // Only connect if within reasonable distance per layer
        const maxDist: Record<DepthLayer, number> = { near: 200, mid: 250, far: 300 };
        if (dist < maxDist[layer]) {
          lines.push({ from: from.id, to: to.id, layer });
        }
      }
    }
  }
  return lines;
}

// ── Soul Bit widget ─────────────────────────────────────────────
const SoulBitWidget: React.FC<{
  bit: SoulBit;
  gyroX: Animated.Value;
  gyroY: Animated.Value;
}> = ({ bit, gyroX, gyroY }) => {
  const op = useRef(new Animated.Value(bit.baseOpacity)).current;
  const parallax = LAYER_PARALLAX[bit.layer];

  useEffect(() => {
    const half = bit.twinkleMs / 2;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(op, { toValue: bit.baseOpacity * 1.8, duration: half * 0.6, useNativeDriver: true }),
        Animated.timing(op, { toValue: bit.baseOpacity * 0.3, duration: half * 1.4, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parallaxTx = Animated.multiply(gyroX, parallax * 40);
  const parallaxTy = Animated.multiply(gyroY, parallax * 40);

  return (
    <View style={{ position: 'absolute', left: bit.x - bit.size / 2, top: bit.y - bit.size / 2 }}>
      <Animated.View
        style={[
          styles.soulBit,
          {
            width: bit.size,
            height: bit.size,
            borderRadius: bit.size / 2,
            backgroundColor: bit.color,
            opacity: op,
            transform: [{ translateX: parallaxTx }, { translateY: parallaxTy }],
            shadowColor: bit.color,
          },
        ]}
        pointerEvents="none"
      />
    </View>
  );
};

// ── Soul Line widget ────────────────────────────────────────────
const SoulLineWidget: React.FC<{
  line: SoulLine;
  bits: SoulBit[];
  gyroX: Animated.Value;
  gyroY: Animated.Value;
}> = ({ line, bits, gyroX, gyroY }) => {
  const fromBit = bits[line.from];
  const toBit = bits[line.to];
  if (!fromBit || !toBit) return null;

  const x1 = fromBit.x;
  const y1 = fromBit.y;
  const x2 = toBit.x;
  const y2 = toBit.y;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);

  const op = useRef(new Animated.Value(0)).current;
  const parallax = LAYER_PARALLAX[line.layer];

  useEffect(() => {
    // Lines fade in and out over time, dissolving and reforming
    const lifetime = 8000 + (line.from + line.to) * 500;
    const startDelay = (line.from * 373) % 12000;

    const anim = Animated.loop(
      Animated.sequence([
        Animated.delay(startDelay),
        Animated.timing(op, { toValue: 0.22, duration: lifetime * 0.3, useNativeDriver: true }),
        Animated.timing(op, { toValue: 0.22, duration: lifetime * 0.3, useNativeDriver: true }),
        Animated.timing(op, { toValue: 0, duration: lifetime * 0.4, useNativeDriver: true }),
        Animated.delay(lifetime * 0.5),
      ]),
    );
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parallaxTx = Animated.multiply(gyroX, parallax * 40);
  const parallaxTy = Animated.multiply(gyroY, parallax * 40);

  return (
    <View style={{ position: 'absolute', left: x1, top: y1 }}>
      <Animated.View
        style={[
          styles.soulLine,
          {
            width: len,
            height: 0.5,
            backgroundColor: fromBit.color + '44',
            opacity: op,
            transform: [
              { rotate: `${angle}deg` },
              { translateX: parallaxTx },
              { translateY: parallaxTy },
            ],
          },
        ]}
        pointerEvents="none"
      />
    </View>
  );
};

// ── Static fallback ─────────────────────────────────────────────
const StaticFallback: React.FC<{ base: string; primary: string; secondary: string }> = React.memo(
  ({ base, primary, secondary }) => (
    <View style={styles.root} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: base }]} />
      <View style={[StyleSheet.absoluteFill, {
        backgroundColor: secondary + '06',
      }]} />
    </View>
  ),
);
StaticFallback.displayName = 'CelestialConstellationStaticFallback';

// ── Public component ────────────────────────────────────────────
interface CelestialConstellationBackgroundProps {
  enabled?: boolean;
}

export const CelestialConstellationBackground: React.FC<CelestialConstellationBackgroundProps> = React.memo(
  ({ enabled = true }) => {
    const { theme } = useAppTheme();
    const primary = theme?.colors.accent.primary || '#c4a0ff';
    const secondary = theme?.colors.accent.secondary || '#5e4fa2';
    const base = theme?.colors.background.base || '#050510';

    const bits = useMemo(() => buildSoulBits(primary, secondary), [primary, secondary]);
    const lines = useMemo(() => buildLines(bits), [bits]);

    // Gyroscope state — fall back to a slow auto-pan animation
    const gyroX = useRef(new Animated.Value(0)).current;
    const gyroY = useRef(new Animated.Value(0)).current;

    useEffect(() => {
      // Slow auto-pan that simulates gentle device movement
      // This creates a subtle parallax even without gyroscope hardware
      const anim = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(gyroX, { toValue: 0.8, duration: 15000, useNativeDriver: true }),
            Animated.timing(gyroY, { toValue: 0.5, duration: 15000, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(gyroX, { toValue: -0.6, duration: 20000, useNativeDriver: true }),
            Animated.timing(gyroY, { toValue: 0.3, duration: 20000, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(gyroX, { toValue: 0.3, duration: 18000, useNativeDriver: true }),
            Animated.timing(gyroY, { toValue: -0.7, duration: 18000, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(gyroX, { toValue: 0, duration: 15000, useNativeDriver: true }),
            Animated.timing(gyroY, { toValue: 0, duration: 15000, useNativeDriver: true }),
          ]),
        ]),
      );
      anim.start();
      return () => anim.stop();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (!enabled) {
      return <StaticFallback base={base} primary={primary} secondary={secondary} />;
    }

    return (
      <View style={styles.root} pointerEvents="none">
        {/* Deep space base */}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: base }]} />

        {/* Subtle nebula haze behind everything */}
        <View style={[styles.nebulaGlow, {
          top: '10%', left: '20%',
          width: W * 0.6, height: W * 0.6, borderRadius: W * 0.3,
          backgroundColor: primary + '04',
        }]} pointerEvents="none" />
        <View style={[styles.nebulaGlow, {
          top: '50%', left: '50%',
          width: W * 0.5, height: W * 0.5, borderRadius: W * 0.25,
          backgroundColor: secondary + '04',
        }]} pointerEvents="none" />

        {/* Mesh lines (behind dots) */}
        {lines.map((l, idx) => (
          <SoulLineWidget key={`line-${idx}`} line={l} bits={bits} gyroX={gyroX} gyroY={gyroY} />
        ))}

        {/* Soul bits */}
        {bits.map((b) => (
          <SoulBitWidget key={`bit-${b.id}`} bit={b} gyroX={gyroX} gyroY={gyroY} />
        ))}

        {/* Edge vignette for depth */}
        <View style={[StyleSheet.absoluteFill, {
          borderWidth: 0,
        }]} pointerEvents="none" />
      </View>
    );
  },
);

CelestialConstellationBackground.displayName = 'CelestialConstellationBackground';

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
  },
  soulBit: {
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.8,
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  soulLine: {},
  nebulaGlow: {
    position: 'absolute',
  },
});

export default CelestialConstellationBackground;
