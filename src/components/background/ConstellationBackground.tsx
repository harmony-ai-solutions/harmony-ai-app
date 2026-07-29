/**
 * ConstellationBackground — Clustered Star Groups with Nebula Glows
 *
 * Renders 6-8 "constellation clusters" — groups of 4-8 small glowing dots
 * connected by faint lines, each cluster surrounded by a soft radial
 * gradient glow. The clusters drift very slowly, giving a majestic
 * cosmic feel. Individual stars within each cluster twinkle at
 * staggered rhythms.
 *
 * Design: Cosmic, connected, serene — inspired by star charts.
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

// ── Point & Cluster configs ─────────────────────────────────────
interface Point {
  id: number;
  relX: number;          // relative to cluster center (0-1 fraction of cluster radius)
  relY: number;
  size: number;          // 2-6px
  twinkleMs: number;     // individual twinkle cycle
}

interface ClusterCfg {
  id: number;
  cx: number;            // absolute center x
  cy: number;            // absolute center y
  radius: number;        // cluster radius
  glowColor: string;
  points: Point[];
  cycleMs: number;       // drift cycle
  driftX: number;
  driftY: number;
  opacity: number;
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

function buildClusters(primary: string, secondary: string): ClusterCfg[] {
  const rng = mulberry32(581);
  const clusters: ClusterCfg[] = [];
  const colors = [primary, secondary];

  for (let c = 0; c < 8; c++) {
    const color = colors[c % 2];
    const radius = 30 + rng() * 60;                // 30-90px cluster radius
    const pointCount = 4 + Math.floor(rng() * 5);  // 4-8 points per cluster
    const points: Point[] = [];

    for (let p = 0; p < pointCount; p++) {
      points.push({
        id: p,
        relX: rng() * 2 - 1,                       // -1 to 1
        relY: rng() * 2 - 1,
        size: 2 + rng() * 4,                       // 2-6px
        twinkleMs: 1500 + rng() * 3500,            // 1.5-5s
      });
    }

    clusters.push({
      id: c,
      cx: rng() * W * 0.9 + W * 0.05,
      cy: rng() * H * 0.9 + H * 0.05,
      radius,
      glowColor: color,
      points,
      cycleMs: 20000 + rng() * 30000,              // 20-50s
      driftX: (rng() - 0.5) * W * 0.15,
      driftY: (rng() - 0.5) * H * 0.12,
      opacity: 0.22 + rng() * 0.28,                // 0.22-0.50
    });
  }
  return clusters;
}

// ── Cluster widget ──────────────────────────────────────────────
const ConstellationCluster: React.FC<{ cfg: ClusterCfg }> = ({ cfg }) => {
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const op = useRef(new Animated.Value(cfg.opacity)).current;

  const pointAnims = useRef(
    cfg.points.map((pt) => ({
      id: pt.id,
      anim: new Animated.Value(1),
    })),
  ).current;

  useEffect(() => {
    const half = cfg.cycleMs / 2;

    const pointLoops = pointAnims.map((pa, idx) => {
      const pt = cfg.points[idx];
      const ph = pt.twinkleMs / 2;
      return Animated.loop(
        Animated.sequence([
          Animated.timing(pa.anim, { toValue: 0.3, duration: ph * 0.5, useNativeDriver: true }),
          Animated.timing(pa.anim, { toValue: 1.0, duration: ph * 1.5, useNativeDriver: true }),
        ]),
      );
    });

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
          Animated.timing(op, { toValue: cfg.opacity * 0.55, duration: half * 0.7, useNativeDriver: true }),
          Animated.timing(op, { toValue: cfg.opacity * 1.3, duration: half * 1.3, useNativeDriver: true }),
        ]),
      ),
      ...pointLoops,
    ]);

    composite.start();

    return () => composite.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      style={[
        styles.cluster,
        {
          left: cfg.cx - cfg.radius,
          top: cfg.cy - cfg.radius,
          width: cfg.radius * 2,
          height: cfg.radius * 2,
          opacity: op,
          transform: [{ translateX: tx }, { translateY: ty }],
        },
      ]}
      pointerEvents="none"
    >
      {/* Soft radial glow behind the cluster */}
      <View
        style={[
          styles.glow,
          {
            width: cfg.radius * 2,
            height: cfg.radius * 2,
            borderRadius: cfg.radius,
            backgroundColor: cfg.glowColor + '18',
          },
        ]}
        pointerEvents="none"
      />

      {/* Connection lines between adjacent points */}
      {cfg.points.slice(0, -1).map((pt, idx) => {
        const next = cfg.points[idx + 1];
        const x1 = cfg.radius + pt.relX * cfg.radius;
        const y1 = cfg.radius + pt.relY * cfg.radius;
        const x2 = cfg.radius + next.relX * cfg.radius;
        const y2 = cfg.radius + next.relY * cfg.radius;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);

        return (
          <View
            key={`line-${cfg.id}-${idx}`}
            style={[
              styles.connector,
              {
                left: x1,
                top: y1,
                width: len,
                height: 1,
                backgroundColor: cfg.glowColor + '33',
                transform: [{ rotate: `${angle}deg` }, { translateX: len / 2 - len / 2 }],
              },
            ]}
            pointerEvents="none"
          />
        );
      })}

      {/* Individual stars */}
      {pointAnims.map((pa, idx) => {
        const pt = cfg.points[idx];
        const posX = cfg.radius + pt.relX * cfg.radius;
        const posY = cfg.radius + pt.relY * cfg.radius;

        return (
          <Animated.View
            key={`star-${cfg.id}-${pa.id}`}
            style={[
              styles.star,
              {
                left: posX - pt.size / 2,
                top: posY - pt.size / 2,
                width: pt.size,
                height: pt.size,
                borderRadius: pt.size / 2,
                backgroundColor: cfg.glowColor,
                opacity: pa.anim,
                shadowColor: cfg.glowColor,
              },
            ]}
            pointerEvents="none"
          />
        );
      })}
    </Animated.View>
  );
};

// ── Public component ────────────────────────────────────────────
interface ConstellationBackgroundProps {
  enabled?: boolean;
}

export const ConstellationBackground: React.FC<ConstellationBackgroundProps> = React.memo(
  ({ enabled = true }) => {
    const { theme } = useAppTheme();
    const primary = theme?.colors.accent.primary || '#8f3ba7';
    const secondary = theme?.colors.accent.secondary || '#22318e';
    const base = theme?.colors.background.base || '#0b0f19';

    const clusters = useMemo(() => buildClusters(primary, secondary), [primary, secondary]);

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
        {clusters.map((c) => (
          <ConstellationCluster key={c.id} cfg={c} />
        ))}
      </View>
    );
  },
);

ConstellationBackground.displayName = 'ConstellationBackground';

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
  },
  cluster: {
    position: 'absolute',
  },
  glow: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  connector: {
    position: 'absolute',
  },
  star: {
    position: 'absolute',
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.7,
        shadowRadius: 3,
      },
      android: {
        elevation: 2,
      },
    }),
  },
});

export default ConstellationBackground;
