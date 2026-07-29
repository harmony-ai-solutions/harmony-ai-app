/**
 * GeodesicBackground — Rotating Geodesic Dome Wireframes
 *
 * Renders 3 geodesic dome wireframes (icosahedron subdivided once → 120 edges
 * each) that slowly rotate in 3D perspective. The triangular lattice structure
 * is the defining visual of geodesic domes — interconnected triangles forming
 * a spherical shell. Edges glow with theme accent colors and vertices are
 * marked by small luminous dots.
 *
 * Each dome rotates around its Y-axis at a different speed, with the central
 * dome being the largest and most prominent. A soft radial glow emanates from
 * the center of each dome, giving depth.
 *
 * Design: Mathematical, crystalline, architectural — true geodesic geometry.
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

// ── 3D Vector ───────────────────────────────────────────────────
interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface GeoEdge {
  a: number;
  b: number;
}

// ── Icosahedron generation ──────────────────────────────────────
function icoVertices(): Vec3[] {
  const phi = (1 + Math.sqrt(5)) / 2;
  const raw: [number, number, number][] = [
    [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
    [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
    [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
  ];
  return raw.map(([x, y, z]) => {
    const len = Math.sqrt(x * x + y * y + z * z);
    return { x: x / len, y: y / len, z: z / len };
  });
}

function icoFaces(): [number, number, number][] {
  // 20 triangular faces of a regular icosahedron (CCW winding)
  return [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
}

function vecMid(a: Vec3, b: Vec3): Vec3 {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const mz = (a.z + b.z) / 2;
  const ml = Math.sqrt(mx * mx + my * my + mz * mz);
  if (ml < 0.0001) return { x: mx, y: my, z: mz };
  return { x: mx / ml, y: my / ml, z: mz / ml };
}

/**
 * Build a geodesic sphere: icosahedron → 1 subdivision → 42 vertices, 120 edges.
 */
function buildGeodesicSphere(): { vertices: Vec3[]; edges: GeoEdge[] } {
  const verts = icoVertices();
  const faces = icoFaces();
  const midCache = new Map<string, number>();

  function getMid(i: number, j: number): number {
    const key = i < j ? `${i},${j}` : `${j},${i}`;
    const cached = midCache.get(key);
    if (cached !== undefined) return cached;
    const m = vecMid(verts[i], verts[j]);
    const idx = verts.length;
    verts.push(m);
    midCache.set(key, idx);
    return idx;
  }

  // Subdivide each face into 4
  const subFaces: [number, number, number][] = [];
  for (const [a, b, c] of faces) {
    const ab = getMid(a, b);
    const bc = getMid(b, c);
    const ca = getMid(c, a);
    subFaces.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
  }

  // Extract unique edges from subdivided faces
  const edgeSet = new Set<string>();
  const edges: GeoEdge[] = [];
  for (const [v1, v2, v3] of subFaces) {
    for (const [p, q] of [[v1, v2], [v2, v3], [v3, v1]]) {
      const key = p < q ? `${p},${q}` : `${q},${p}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({ a: p, b: q });
      }
    }
  }

  return { vertices: verts, edges };
}

// ── 3D → 2D Projection ──────────────────────────────────────────
function project(v: Vec3, scale: number, cx: number, cy: number): { x: number; y: number; z: number } {
  // Simple perspective: depth affects position and foreshortening
  const depth = 3.0; // camera distance
  const f = depth / (depth + v.z);
  return {
    x: cx + v.x * scale * f,
    y: cy - v.y * scale * f, // invert Y for screen space
    z: v.z,
  };
}

// ── Dome config ──────────────────────────────────────────────────
interface DomeCfg {
  id: number;
  cx: number;
  cy: number;
  radius: number;      // base scale for projection
  color: string;
  opacity: number;
  cycleMs: number;     // full rotation cycle
  glowOpacity: number;
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

function buildDomes(primary: string, secondary: string): DomeCfg[] {
  const rng = mulberry32(199);
  return [
    {
      id: 0, cx: W / 2, cy: H * 0.45, radius: Math.min(W, H) * 0.42,
      color: primary, opacity: 0.55, cycleMs: 28000, glowOpacity: 0.18,
    },
    {
      id: 1, cx: W * 0.18, cy: H * 0.7, radius: Math.min(W, H) * 0.22,
      color: secondary, opacity: 0.35, cycleMs: 22000 + rng() * 8000, glowOpacity: 0.10,
    },
    {
      id: 2, cx: W * 0.82, cy: H * 0.25, radius: Math.min(W, H) * 0.18,
      color: primary, opacity: 0.30, cycleMs: 18000 + rng() * 10000, glowOpacity: 0.08,
    },
  ];
}

// ── Single Dome ─────────────────────────────────────────────────
const GeodesicDome: React.FC<{ cfg: DomeCfg }> = ({ cfg }) => {
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const breatheAnim = useRef(new Animated.Value(1)).current;

  const geoData = useMemo(() => buildGeodesicSphere(), []);

  useEffect(() => {
    const half = cfg.cycleMs / 2;
    const composite = Animated.parallel([
      Animated.loop(
        Animated.sequence([
          Animated.timing(rotateAnim, {
            toValue: 360, duration: cfg.cycleMs,
            useNativeDriver: true,
          }),
        ]),
      ),
      Animated.loop(
        Animated.sequence([
          Animated.timing(breatheAnim, {
            toValue: 0.85, duration: half * 0.7,
            useNativeDriver: true,
          }),
          Animated.timing(breatheAnim, {
            toValue: 1.12, duration: half * 1.3,
            useNativeDriver: true,
          }),
        ]),
      ),
    ]);
    composite.start();
    return () => composite.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rotateY = rotateAnim.interpolate({
    inputRange: [0, 360],
    outputRange: ['0deg', '360deg'],
  });

  // Project all vertices to 2D
  const projected = useMemo(() => {
    return geoData.vertices.map((v) => project(v, cfg.radius, cfg.cx, cfg.cy));
  }, [geoData.vertices, cfg.radius, cfg.cx, cfg.cy]);

  return (
    <Animated.View
      style={[
        styles.domeContainer,
        {
          left: 0, top: 0,
          width: W, height: H,
          opacity: Animated.multiply(breatheAnim, cfg.opacity),
          transform: [
            { perspective: 1000 },
            { rotateY },
          ],
        },
      ]}
      pointerEvents="none"
    >
      {/* Radial glow behind the dome */}
      <View
        style={[
          styles.glow,
          {
            left: cfg.cx - cfg.radius * 1.3,
            top: cfg.cy - cfg.radius * 1.3,
            width: cfg.radius * 2.6,
            height: cfg.radius * 2.6,
            borderRadius: cfg.radius * 1.3,
            backgroundColor: cfg.color + '15',
          },
        ]}
        pointerEvents="none"
      />

      {/* Edges: render each as a thin rotated line */}
      {geoData.edges.map((edge, idx) => {
        const p1 = projected[edge.a];
        const p2 = projected[edge.b];
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.5) return null; // skip degenerate edges
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);

        // Edge opacity varies with Z (front edges brighter)
        const zMid = (p1.z + p2.z) / 2;
        const edgeAlpha = 0.15 + (zMid + 1) * 0.15; // 0.15-0.45 based on depth

        return (
          <View
            key={`edge-${cfg.id}-${idx}`}
            style={[
              styles.edge,
              {
                left: p1.x,
                top: p1.y,
                width: len,
                height: 1.2,
                backgroundColor: cfg.color,
                opacity: edgeAlpha,
                transform: [{ rotate: `${angle}deg` }],
              },
            ]}
            pointerEvents="none"
          />
        );
      })}

      {/* Vertices: small glowing dots */}
      {projected.map((pt, idx) => {
        const size = 2.5 + (pt.z + 1) * 1.5; // 2.5-4px based on depth
        const dotAlpha = 0.25 + (pt.z + 1) * 0.15;
        return (
          <View
            key={`vert-${cfg.id}-${idx}`}
            style={[
              styles.vertex,
              {
                left: pt.x - size / 2,
                top: pt.y - size / 2,
                width: size,
                height: size,
                borderRadius: size / 2,
                backgroundColor: cfg.color,
                opacity: dotAlpha,
                shadowColor: cfg.color,
              },
            ]}
            pointerEvents="none"
          />
        );
      })}
    </Animated.View>
  );
};

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

    const domes = useMemo(() => buildDomes(primary, secondary), [primary, secondary]);

    if (!enabled) {
      return <StaticFallback base={base} />;
    }

    return (
      <View style={styles.root} pointerEvents="none">
        {/* Solid base */}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: base }]} />

        {/* Domes rendered back-to-front for proper overlap */}
        {domes.map((d) => (
          <GeodesicDome key={d.id} cfg={d} />
        ))}

        {/* Subtle vignette */}
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              // radial vignette via layered gradients (empty gradient, handled by individual elements)
            },
          ]}
          pointerEvents="none"
        />
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
  domeContainer: {
    position: 'absolute',
    overflow: 'visible',
  },
  glow: {
    position: 'absolute',
  },
  edge: {
    position: 'absolute',
  },
  vertex: {
    position: 'absolute',
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.8,
        shadowRadius: 3,
      },
      android: {
        elevation: 2,
      },
    }),
  },
});

export default GeodesicBackground;
