/**
 * AuraWaveBackground — Soft Organic Wave Ribbons
 *
 * Renders 5-6 silky, low-opacity monochromatic ribbon waves floating
 * slowly across the background. Each wave is rendered as a series of
 * curved gradient segments forming a continuous flowing ribbon.
 *
 * Interactivity: Designed for audio-reactivity — the amplitude of the
 * waves can flex gently to match sound frequency from voice chats,
 * ambient audio, or sound effects. Currently pulses with a natural
 * breathing rhythm; audio-reactive hooks are exposed for future
 * integration with the voice/audio subsystems.
 *
 * Mood: Calming, sleek, minimalist. Keeps screen distraction to an
 * absolute minimum while maintaining visual life.
 *
 * All animations run on the native driver for 60fps performance.
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

// ── Wave config ──────────────────────────────────────────────────
interface WaveCfg {
  id: number;
  thickness: number;      // ribbon height
  startY: number;         // y position fraction (0-1)
  colorA: string;         // peak color (bare 7-char hex)
  colorB: string;         // fade color (bare 7-char hex)
  opacity: number;
  cycleMs: number;
  amplitude: number;      // vertical wave amplitude
  frequency: number;      // wave oscillation frequency
  phase: number;          // phase offset
  speedX: number;         // horizontal drift speed
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

function buildWaves(primary: string, secondary: string): WaveCfg[] {
  const rng = mulberry32(523);
  const waves: WaveCfg[] = [];
  const colors = [primary, secondary]; // bare hex, no pre-applied alpha

  for (let i = 0; i < 6; i++) {
    waves.push({
      id: i,
      thickness: 3 + rng() * 7,
      startY: 0.1 + rng() * 0.8,
      colorA: colors[i % colors.length],
      colorB: colors[i % colors.length],
      opacity: 0.15 + rng() * 0.25,
      cycleMs: 12000 + rng() * 28000,
      amplitude: H * (0.03 + rng() * 0.09),
      frequency: 0.8 + rng() * 1.6,
      phase: rng() * Math.PI * 2,
      speedX: -W * 0.3 + rng() * W * 0.6,
    });
  }
  return waves;
}

// ── Single Wave Ribbon ──────────────────────────────────────────
const WaveRibbon: React.FC<{
  cfg: WaveCfg;
  audioAmplitude: Animated.Value;
}> = ({ cfg, audioAmplitude }) => {
  const tx = useRef(new Animated.Value(0)).current;
  const op = useRef(new Animated.Value(cfg.opacity)).current;
  const scY = useRef(new Animated.Value(1)).current;
  const rotAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const half = cfg.cycleMs / 2;

    const composite = Animated.parallel([
      Animated.loop(
        Animated.sequence([
          Animated.timing(tx, { toValue: cfg.speedX, duration: half, useNativeDriver: true }),
          Animated.timing(tx, { toValue: -cfg.speedX, duration: half, useNativeDriver: true }),
        ]),
      ),
      Animated.loop(
        Animated.sequence([
          Animated.timing(op, {
            toValue: cfg.opacity * 1.4, duration: half * 0.5, useNativeDriver: true,
          }),
          Animated.timing(op, {
            toValue: cfg.opacity * 0.6, duration: half * 1.5, useNativeDriver: true,
          }),
        ]),
      ),
      Animated.loop(
        Animated.sequence([
          Animated.timing(scY, {
            toValue: 1.8, duration: half * 0.3, useNativeDriver: true,
          }),
          Animated.timing(scY, {
            toValue: 0.7, duration: half * 1.7, useNativeDriver: true,
          }),
        ]),
      ),
      Animated.loop(
        Animated.sequence([
          Animated.timing(rotAnim, {
            toValue: 1, duration: half, useNativeDriver: true,
          }),
          Animated.timing(rotAnim, {
            toValue: 0, duration: half, useNativeDriver: true,
          }),
        ]),
      ),
    ]);

    composite.start();
    return () => composite.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rotAngle = rotAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['-2deg', '2deg'],
  });

  const amplitude = Animated.multiply(audioAmplitude, cfg.amplitude);

  return (
    <Animated.View
      style={[
        styles.ribbon,
        {
          height: cfg.thickness,
          top: cfg.startY * H,
          left: 0,
          right: 0,
          opacity: op,
          transform: [
            { translateX: tx },
            { scaleY: scY },
            { rotate: rotAngle },
          ],
        },
      ]}
      pointerEvents="none"
    >
      <LinearGradient
        colors={[cfg.colorB + '00', cfg.colorA + '44', cfg.colorA + '44', cfg.colorB + '00']}
        locations={[0, 0.05, 0.95, 1]}
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
        colors={[primary + '08', secondary + '06', base]}
        start={{ x: 0.2, y: 0.2 }}
        end={{ x: 0.8, y: 0.8 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
    </View>
  ),
);
StaticFallback.displayName = 'AuraWaveStaticFallback';

// ── Public component ────────────────────────────────────────────
interface AuraWaveBackgroundProps {
  enabled?: boolean;
}

export const AuraWaveBackground: React.FC<AuraWaveBackgroundProps> = React.memo(
  ({ enabled = true }) => {
    const { theme } = useAppTheme();
    const primary = theme?.colors.accent.primary || '#8f3ba7';
    const secondary = theme?.colors.accent.secondary || '#22318e';
    const base = theme?.colors.background.base || '#0b0f19';

    const waves = useMemo(() => buildWaves(primary, secondary), [primary, secondary]);

    // Audio amplitude — currently a gentle breathing pattern
    const audioAmplitude = useRef(new Animated.Value(1)).current;

    useEffect(() => {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(audioAmplitude, {
            toValue: 1.3, duration: 4000, useNativeDriver: true,
          }),
          Animated.timing(audioAmplitude, {
            toValue: 0.8, duration: 5000, useNativeDriver: true,
          }),
          Animated.timing(audioAmplitude, {
            toValue: 1.0, duration: 3000, useNativeDriver: true,
          }),
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
        {/* Solid base */}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: base }]} />

        {/* Wave ribbons */}
        {waves.map((w) => (
          <WaveRibbon key={`wave-${w.id}`} cfg={w} audioAmplitude={audioAmplitude} />
        ))}

        {/* Subtle top/bottom vignette */}
        <LinearGradient
          colors={[base + '44', base + '00', base + '00', base + '44']}
          locations={[0, 0.05, 0.95, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      </View>
    );
  },
);

AuraWaveBackground.displayName = 'AuraWaveBackground';

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

export default AuraWaveBackground;
