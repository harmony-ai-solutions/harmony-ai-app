/**
 * ConstellationBackground — Rich Cosmic Starfields with Nebula Glows
 *
 * Renders a lush starfield with 80+ individually twinkling stars organized
 * into "constellation nodes." 12 density-based star clusters are scattered
 * across the viewport, each containing:
 *   - A soft radial nebula glow in theme colors
 *   - 5-12 stars of varying sizes (1-7px) with staggered twinkle rhythms
 *   - Delicate connection lines between adjacent stars within each cluster
 *   - Slow, majestic drift of entire clusters
 *
 * Additionally, 2-3 "shooting stars" streak across the screen occasionally.
 * A subtle galactic dust band passes behind everything for depth.
 *
 * Design: Cosmic, majestic, interconnected — a true celestial star chart.
 */

import React, { useEffect, useRef, useMemo } from 'react';
import {
  View,
  Animated,
  Dimensions,
  StyleSheet,
  Platform,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useAppTheme } from '../../contexts/ThemeContext';

const { width: W, height: H } = Dimensions.get('window');

// ── Star within a cluster ────────────────────────────────────────
interface Star {
  id: number;
  relX: number;           // -1 to 1 relative to cluster center
  relY: number;
  size: number;           // 1-7px
  twinkleMs: number;      // full twinkle cycle
  twinklePhase: number;   // random phase offset
  color: string;          // bare 7-char hex
}

// ── Cluster config ───────────────────────────────────────────────
interface ClusterCfg {
  id: number;
  cx: number;             // absolute screen position
  cy: number;
  radius: number;         // visual extent
  glowColor: string;      // nebula glow (bare 7-char hex)
  stars: Star[];
  cycleMs: number;        // drift cycle
  driftX: number;
  driftY: number;
  opacity: number;
  glowOpacity: number;
}

// ── Shooting star ────────────────────────────────────────────────
interface ShootingStarCfg {
  id: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  duration: number;       // travel time
  delay: number;          // wait before firing
  color: string;          // bare 7-char hex
  size: number;
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
  const colors = [primary, secondary]; // bare hex, no pre-applied alpha

  for (let c = 0; c < 12; c++) {
    const color = colors[c % 2];
    const radius = 35 + rng() * 75;                // 35-110px
    const starCount = 5 + Math.floor(rng() * 8);   // 5-12 stars per cluster
    const stars: Star[] = [];

    for (let s = 0; s < starCount; s++) {
      stars.push({
        id: s,
        relX: rng() * 2 - 1,
        relY: rng() * 2 - 1,
        size: 1.5 + rng() * 5.5,                   // 1.5-7px
        twinkleMs: 1000 + rng() * 4000,             // 1-5s
        twinklePhase: rng() * Math.PI * 2,
        color: colors[Math.floor(rng() * colors.length)],
      });
    }

    clusters.push({
      id: c,
      cx: rng() * W * 0.85 + W * 0.075,
      cy: rng() * H * 0.85 + H * 0.075,
      radius,
      glowColor: color,
      stars,
      cycleMs: 25000 + rng() * 45000,              // 25-70s
      driftX: (rng() - 0.5) * W * 0.12,
      driftY: (rng() - 0.5) * H * 0.10,
      opacity: 0.55 + rng() * 0.35,                 // 0.55-0.90
      glowOpacity: 0.08 + rng() * 0.12,             // 0.08-0.20
    });
  }
  return clusters;
}

function buildShootingStars(primary: string, secondary: string): ShootingStarCfg[] {
  const rng = mulberry32(991);
  const colors = [primary, secondary, '#FFFFFF'];
  const stars: ShootingStarCfg[] = [];

  for (let i = 0; i < 3; i++) {
    const startX = rng() * W * 1.2 - W * 0.1;
    const startY = rng() * H * 0.5;
    const dx = (rng() - 0.3) * W * 0.8;
    const dy = rng() * H * 0.6 + H * 0.1;
    stars.push({
      id: i,
      startX, startY,
      endX: startX + dx,
      endY: startY + dy,
      duration: 800 + rng() * 1200,                 // 0.8-2s streak
      delay: rng() * 15000 + i * 8000,              // staggered
      color: colors[Math.floor(rng() * 3)],
      size: 2 + rng() * 3,
    });
  }
  return stars;
}

// ── Shooting Star component ──────────────────────────────────────
const ShootingStar: React.FC<{ cfg: ShootingStarCfg }> = ({ cfg }) => {
  const posX = useRef(new Animated.Value(0)).current;
  const posY = useRef(new Animated.Value(0)).current;
  const trailOp = useRef(new Animated.Value(1)).current;
  const starOp = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = () => {
      starOp.setValue(0);
      trailOp.setValue(1);
      posX.setValue(0);
      posY.setValue(0);

      const anims: Animated.CompositeAnimation[] = [
        Animated.sequence([
          Animated.delay(cfg.delay),
          Animated.timing(starOp, {
            toValue: 1, duration: 100, useNativeDriver: true,
          }),
          Animated.timing(posX, {
            toValue: 1, duration: cfg.duration, useNativeDriver: true,
          }),
          Animated.timing(posY, {
            toValue: 1, duration: cfg.duration, useNativeDriver: true,
          }),
          Animated.timing(trailOp, {
            toValue: 0, duration: 400, useNativeDriver: true,
          }),
        ]),
      ];

      const sequence = Animated.sequence(anims);
      sequence.start(({ finished }) => {
        if (finished) loop();
      });
    };
    loop();
    return () => {
      starOp.stopAnimation();
      posX.stopAnimation();
      posY.stopAnimation();
      trailOp.stopAnimation();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const curX = posX.interpolate({
    inputRange: [0, 1],
    outputRange: [cfg.startX, cfg.endX],
  });
  const curY = posY.interpolate({
    inputRange: [0, 1],
    outputRange: [cfg.startY, cfg.endY],
  });

  const dx = cfg.endX - cfg.startX;
  const dy = cfg.endY - cfg.startY;
  const trailLen = Math.sqrt(dx * dx + dy * dy) * 0.25;
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);

  return (
    <>
      {/* Trail */}
      <Animated.View
        style={[
          styles.shootingStarTrail,
          {
            left: curX,
            top: curY,
            width: trailLen,
            height: 1.5,
            opacity: trailOp,
            backgroundColor: cfg.color + '88',
            transform: [
              { translateX: -trailLen },
              { rotate: `${angle}deg` },
            ],
          },
        ]}
        pointerEvents="none"
      />
      {/* Head */}
      <Animated.View
        style={[
          styles.shootingStarHead,
          {
            left: curX,
            top: curY,
            width: cfg.size * 2,
            height: cfg.size * 2,
            borderRadius: cfg.size,
            backgroundColor: cfg.color + 'FF',
            opacity: starOp,
            shadowColor: cfg.color,
          },
        ]}
        pointerEvents="none"
      />
    </>
  );
};

// ── Constellation Cluster ────────────────────────────────────────
const ConstellationCluster: React.FC<{ cfg: ClusterCfg }> = ({ cfg }) => {
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const op = useRef(new Animated.Value(cfg.opacity)).current;
  const glowOp = useRef(new Animated.Value(cfg.glowOpacity)).current;

  const starAnims = useRef(
    cfg.stars.map((st) => ({
      id: st.id,
      anim: new Animated.Value(1),
    })),
  ).current;

  useEffect(() => {
    const half = cfg.cycleMs / 2;

    const starLoops = starAnims.map((sa, idx) => {
      const st = cfg.stars[idx];
      const halfT = st.twinkleMs / 2;
      return Animated.loop(
        Animated.sequence([
          Animated.timing(sa.anim, {
            toValue: 0.2, duration: halfT * 0.4, useNativeDriver: true,
          }),
          Animated.timing(sa.anim, {
            toValue: 1.0, duration: halfT * 1.6, useNativeDriver: true,
          }),
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
          Animated.timing(op, {
            toValue: cfg.opacity * 0.7, duration: half * 0.7, useNativeDriver: true,
          }),
          Animated.timing(op, {
            toValue: cfg.opacity * 1.25, duration: half * 1.3, useNativeDriver: true,
          }),
        ]),
      ),
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowOp, {
            toValue: cfg.glowOpacity * 0.5, duration: half * 0.6, useNativeDriver: true,
          }),
          Animated.timing(glowOp, {
            toValue: cfg.glowOpacity * 1.8, duration: half * 1.4, useNativeDriver: true,
          }),
        ]),
      ),
      ...starLoops,
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
      {/* Nebula glow */}
      <Animated.View
        style={[
          styles.nebulaGlow,
          {
            left: 0, top: 0,
            width: cfg.radius * 2,
            height: cfg.radius * 2,
            borderRadius: cfg.radius,
            opacity: glowOp,
          },
        ]}
        pointerEvents="none"
      >
        <LinearGradient
          colors={[cfg.glowColor + '22', cfg.glowColor + '08', cfg.glowColor + '00']}
          start={{ x: 0.3, y: 0.3 }}
          end={{ x: 0.7, y: 0.7 }}
          style={styles.nebulaFill}
        />
      </Animated.View>

      {/* Connection lines: all stars in order form a path */}
      {cfg.stars.slice(0, -1).map((st, idx) => {
        const next = cfg.stars[idx + 1];
        const pad = 12;
        const x1 = pad + cfg.radius + st.relX * (cfg.radius - pad);
        const y1 = pad + cfg.radius + st.relY * (cfg.radius - pad);
        const x2 = pad + cfg.radius + next.relX * (cfg.radius - pad);
        const y2 = pad + cfg.radius + next.relY * (cfg.radius - pad);
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);

        return (
          <View
            key={`conn-${cfg.id}-${idx}`}
            style={[
              styles.connector,
              {
                left: x1,
                top: y1,
                width: len,
                height: 0.6,
                backgroundColor: cfg.glowColor + '40',
                transform: [{ rotate: `${angle}deg` }],
              },
            ]}
            pointerEvents="none"
          />
        );
      })}

      {/* Individual twinkling stars */}
      {starAnims.map((sa, idx) => {
        const st = cfg.stars[idx];
        const pad = 12;
        const posX = pad + cfg.radius + st.relX * (cfg.radius - pad);
        const posY = pad + cfg.radius + st.relY * (cfg.radius - pad);

        return (
          <Animated.View
            key={`star-${cfg.id}-${sa.id}`}
            style={[
              styles.star,
              {
                left: posX - st.size / 2,
                top: posY - st.size / 2,
                width: st.size,
                height: st.size,
                borderRadius: st.size / 2,
                backgroundColor: st.color + 'FF',
                opacity: sa.anim,
                shadowColor: st.color,
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
    const shootingStars = useMemo(() => buildShootingStars(primary, secondary), [primary, secondary]);

    if (!enabled) {
      return (
        <View style={styles.root} pointerEvents="none">
          <View style={[StyleSheet.absoluteFill, { backgroundColor: base }]} />
        </View>
      );
    }

    return (
      <View style={styles.root} pointerEvents="none">
        {/* Deep space base */}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: base }]} />

        {/* Galactic dust band */}
        <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]} pointerEvents="none">
          <View
            style={{
              position: 'absolute',
              top: -H * 0.3,
              left: -W * 0.5,
              width: W * 2,
              height: H * 1.6,
              transform: [{ rotate: '25deg' }],
            }}
            pointerEvents="none"
          >
            <LinearGradient
              colors={[primary + '04', secondary + '06', base + '00', secondary + '03', primary + '04']}
              locations={[0, 0.3, 0.5, 0.7, 1]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={{ flex: 1 }}
              pointerEvents="none"
            />
          </View>
        </View>

        {/* Constellation clusters */}
        {clusters.map((c) => (
          <ConstellationCluster key={c.id} cfg={c} />
        ))}

        {/* Shooting stars */}
        {shootingStars.map((ss) => (
          <ShootingStar key={`ss-${ss.id}`} cfg={ss} />
        ))}

        {/* Ambient scatter stars */}
        <View style={styles.scatterContainer} pointerEvents="none">
          {Array.from({ length: 40 }).map((_, i) => {
            const rng = mulberry32(1400 + i);
            const x = rng() * W;
            const y = rng() * H;
            const s = 1 + rng() * 2;
            const alpha = 0.1 + rng() * 0.25;
            const col = rng() > 0.5 ? primary : secondary;
            return (
              <View
                key={`scatter-${i}`}
                style={{
                  position: 'absolute',
                  left: x,
                  top: y,
                  width: s,
                  height: s,
                  borderRadius: s / 2,
                  backgroundColor: col,
                  opacity: alpha,
                }}
                pointerEvents="none"
              />
            );
          })}
        </View>

        {/* Vignette */}
        <LinearGradient
          colors={[base + '00', base + '33', base + '66']}
          start={{ x: 0.5, y: 0.5 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <LinearGradient
          colors={[base + '00', base + '33', base + '66']}
          start={{ x: 0.5, y: 0.5 }}
          end={{ x: 0, y: 0 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
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
    overflow: 'visible',
  },
  nebulaGlow: {
    position: 'absolute',
  },
  nebulaFill: {
    flex: 1,
  },
  connector: {
    position: 'absolute',
  },
  star: {
    position: 'absolute',
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
  shootingStarTrail: {
    position: 'absolute',
  },
  shootingStarHead: {
    position: 'absolute',
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1.0,
        shadowRadius: 6,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  scatterContainer: {
    ...StyleSheet.absoluteFill,
  },
});

export default ConstellationBackground;
