/**
 * NeuralPulseBackground — Living Synaptic Network Visualization
 *
 * Renders a biomimetic neural network with:
 *   - 8-10 "neuron" clusters distributed across the screen
 *   - Each neuron has a central soma (bright pulsing core) with dendrite
 *     branches reaching toward neighboring neurons
 *   - Traveling "action potential" pulses (small bright dots) race along
 *     the connections between neurons at staggered intervals
 *   - Soft radial field around each neuron representing local potentials
 *
 * Deep obsidian background with neon accent pulses. All animations run on
 * the native driver.
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

// ── Neuron config ────────────────────────────────────────────────
interface NeuronCfg {
  id: number;
  x: number;              // soma center
  y: number;
  somaRadius: number;     // core size
  fieldRadius: number;    // local potential field
  color: string;          // bare 7-char hex, alpha applied at render
  baseOpacity: number;
  pulseCycleMs: number;   // soma breathing cycle
  connections: number[];  // IDs of connected neurons
}

// ── Dendrite connection ──────────────────────────────────────────
interface DendriteEdge {
  from: number;
  to: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
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

function buildNeuralNetwork(primary: string, secondary: string): {
  neurons: NeuronCfg[];
  edges: DendriteEdge[];
} {
  const rng = mulberry32(313);
  const neuronCount = 10;
  const colors = [primary, secondary]; // bare hex, no pre-applied alpha

  // Place neurons avoiding edges
  const neurons: NeuronCfg[] = [];
  for (let i = 0; i < neuronCount; i++) {
    const x = 0.06 + rng() * 0.88; // 6-94% of width
    const y = 0.06 + rng() * 0.88;
    neurons.push({
      id: i,
      x: x * W,
      y: y * H,
      somaRadius: 5 + rng() * 9,                         // 5-14px
      fieldRadius: 35 + rng() * 55,                       // 35-90px
      color: colors[Math.floor(rng() * colors.length)],
      baseOpacity: 0.25 + rng() * 0.35,
      pulseCycleMs: 3000 + rng() * 7000,                  // 3-10s
      connections: [],
    });
  }

  // Build connections: each neuron connects to 2-4 nearest neighbors
  const edges: DendriteEdge[] = [];
  const edgeSet = new Set<string>();

  for (let i = 0; i < neuronCount; i++) {
    const n1 = neurons[i];
    const neighbors: { id: number; dist: number }[] = [];
    for (let j = 0; j < neuronCount; j++) {
      if (i === j) continue;
      const n2 = neurons[j];
      const dx = n1.x - n2.x;
      const dy = n1.y - n2.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      neighbors.push({ id: j, dist });
    }
    neighbors.sort((a, b) => a.dist - b.dist);
    const connectCount = 2 + Math.floor(rng() * 3); // 2-4 connections
    const toConnect = neighbors.slice(0, Math.min(connectCount, neighbors.length));

    for (const n of toConnect) {
      const key = i < n.id ? `${i},${n.id}` : `${n.id},${i}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        n1.connections.push(n.id);
        edges.push({
          from: i, to: n.id,
          fromX: n1.x, fromY: n1.y,
          toX: neurons[n.id].x, toY: neurons[n.id].y,
        });
      }
    }
  }

  return { neurons, edges };
}

// ── Local Field Gradient (radial glow around soma) ──────────────
const NeuronField: React.FC<{ neuron: NeuronCfg; pulseValue: Animated.AnimatedMultiplication<number> }> =
  ({ neuron, pulseValue }) => {
    return (
      <Animated.View
        style={[
          styles.field,
          {
            left: neuron.x - neuron.fieldRadius,
            top: neuron.y - neuron.fieldRadius,
            width: neuron.fieldRadius * 2,
            height: neuron.fieldRadius * 2,
            borderRadius: neuron.fieldRadius,
            opacity: pulseValue,
          },
        ]}
        pointerEvents="none"
      >
        <LinearGradient
          colors={[neuron.color + '18', neuron.color + '04', neuron.color + '00']}
          start={{ x: 0.5, y: 0.5 }}
          end={{ x: 1, y: 1 }}
          style={styles.fieldFill}
        />
      </Animated.View>
    );
  };

// ── Soma (neuron core) ──────────────────────────────────────────
const SomaDot: React.FC<{
  neuron: NeuronCfg;
  pulseValue: Animated.Value;
}> = ({ neuron, pulseValue }) => {
  const ownPulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const half = neuron.pulseCycleMs / 2;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(ownPulse, {
          toValue: 1.5, duration: half * 0.5, useNativeDriver: true,
        }),
        Animated.timing(ownPulse, {
          toValue: 0.6, duration: half * 1.5, useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const combinedOp = Animated.multiply(ownPulse, pulseValue);

  return (
    <Animated.View
      style={[
        styles.soma,
        {
          left: neuron.x - neuron.somaRadius,
          top: neuron.y - neuron.somaRadius,
          width: neuron.somaRadius * 2,
          height: neuron.somaRadius * 2,
          borderRadius: neuron.somaRadius,
          backgroundColor: neuron.color + 'FF',
          opacity: combinedOp,
          shadowColor: neuron.color,
        },
      ]}
      pointerEvents="none"
    />
  );
};

// ── Dendrite Branch ─────────────────────────────────────────────
const DendriteBranch: React.FC<{
  edge: DendriteEdge;
  color: string;
  pulseValue: Animated.Value;
}> = ({ edge, color, pulseValue }) => {
  const dx = edge.toX - edge.fromX;
  const dy = edge.toY - edge.fromY;
  const len = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);

  const branchOp = useRef(new Animated.Value(0.12)).current;

  useEffect(() => {
    const cycle = 5000 + ((edge.from + edge.to) % 5) * 2000;
    const half = cycle / 2;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(branchOp, {
          toValue: 0.22, duration: half * 0.5, useNativeDriver: true,
        }),
        Animated.timing(branchOp, {
          toValue: 0.07, duration: half * 1.5, useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const combinedOp = Animated.multiply(branchOp, pulseValue);

  return (
    <Animated.View
      style={[
        styles.dendrite,
        {
          left: edge.fromX,
          top: edge.fromY,
          width: len,
          height: 1.2,
          backgroundColor: color + '88',
          opacity: combinedOp,
          transform: [{ rotate: `${angle}deg` }],
        },
      ]}
      pointerEvents="none"
    />
  );
};

// ── Action Potential (traveling pulse along dendrite) ───────────
const ActionPotential: React.FC<{
  edge: DendriteEdge;
  color: string;
  delayOffset: number;
}> = ({ edge, color, delayOffset }) => {
  const progress = useRef(new Animated.Value(0)).current;
  const op = useRef(new Animated.Value(0)).current;

  const dx = edge.toX - edge.fromX;
  const dy = edge.toY - edge.fromY;
  const len = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx);

  useEffect(() => {
    const travelDuration = 1500 + ((edge.from + edge.to) % 7) * 500; // 1.5-4.5s
    const pauseDuration = 3000 + delayOffset * 2000; // 3-11s pause

    const loop = () => {
      progress.setValue(0);
      op.setValue(0);

      const seq = Animated.sequence([
        Animated.delay(pauseDuration),
        // Flash in
        Animated.timing(op, {
          toValue: 1, duration: 100, useNativeDriver: true,
        }),
        // Travel
        Animated.parallel([
          Animated.timing(progress, {
            toValue: 1, duration: travelDuration, useNativeDriver: true,
          }),
          // Fade near end
          Animated.sequence([
            Animated.delay(travelDuration * 0.7),
            Animated.timing(op, {
              toValue: 0, duration: travelDuration * 0.3, useNativeDriver: true,
            }),
          ]),
        ]),
      ]);

      seq.start(({ finished }) => {
        if (finished) loop();
      });
    };

    loop();
    return () => {
      progress.stopAnimation();
      op.stopAnimation();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const curX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [edge.fromX, edge.toX],
  });
  const curY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [edge.fromY, edge.toY],
  });

  const pulseSize = 4;

  return (
    <Animated.View
      style={[
        styles.actionPotential,
        {
          left: curX,
          top: curY,
          width: pulseSize * 2,
          height: pulseSize * 2,
          borderRadius: pulseSize,
          backgroundColor: color + 'FF',
          opacity: op,
          shadowColor: color,
          transform: [
            { translateX: -pulseSize },
            { translateY: -pulseSize },
          ],
        },
      ]}
      pointerEvents="none"
    />
  );
};

// ── Public component ────────────────────────────────────────────
interface NeuralPulseBackgroundProps {
  enabled?: boolean;
}

export const NeuralPulseBackground: React.FC<NeuralPulseBackgroundProps> = React.memo(
  ({ enabled = true }) => {
    const { theme } = useAppTheme();
    const primary = theme?.colors.accent.primary || '#7b4fbf';
    const secondary = theme?.colors.accent.secondary || '#3a2e6e';
    const base = theme?.colors.background.base || '#0b0f19';

    const { neurons, edges } = useMemo(
      () => buildNeuralNetwork(primary, secondary),
      [primary, secondary],
    );

    // Global network pulse
    const networkPulse = useRef(new Animated.Value(1)).current;

    useEffect(() => {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(networkPulse, {
            toValue: 1.2, duration: 5000, useNativeDriver: true,
          }),
          Animated.timing(networkPulse, {
            toValue: 0.85, duration: 6000, useNativeDriver: true,
          }),
          Animated.timing(networkPulse, {
            toValue: 1.0, duration: 4000, useNativeDriver: true,
          }),
        ]),
      );
      anim.start();
      return () => anim.stop();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (!enabled) {
      return (
        <View style={styles.root} pointerEvents="none">
          <View style={[StyleSheet.absoluteFill, { backgroundColor: base }]} />
          <LinearGradient
            colors={[primary + '0A', secondary + '06', base]}
            start={{ x: 0.2, y: 0.2 }}
            end={{ x: 0.8, y: 0.8 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        </View>
      );
    }

    return (
      <View style={styles.root} pointerEvents="none">
        {/* Solid base */}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: base }]} />

        {/* Local field gradients under everything */}
        {neurons.map((n) => {
          const fieldPulse = Animated.multiply(networkPulse, n.baseOpacity * 0.5);
          return (
            <NeuronField key={`field-${n.id}`} neuron={n} pulseValue={fieldPulse} />
          );
        })}

        {/* Dendrite branches */}
        {edges.map((e, idx) => {
          const fromNeuron = neurons[e.from];
          const toNeuron = neurons[e.to];
          const color = fromNeuron ? fromNeuron.color : primary;
          return (
            <DendriteBranch
              key={`branch-${idx}`}
              edge={e}
              color={color}
              pulseValue={networkPulse}
            />
          );
        })}

        {/* Action potentials traveling along dendrites */}
        {edges.map((e, idx) => {
          const fromNeuron = neurons[e.from];
          const color = fromNeuron ? fromNeuron.color : primary;
          return (
            <ActionPotential
              key={`ap-${idx}`}
              edge={e}
              color={color}
              delayOffset={idx}
            />
          );
        })}

        {/* Soma (neuron cores) — rendered last so they're on top */}
        {neurons.map((n) => (
          <SomaDot key={`soma-${n.id}`} neuron={n} pulseValue={networkPulse} />
        ))}

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

NeuralPulseBackground.displayName = 'NeuralPulseBackground';

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
  },
  field: {
    position: 'absolute',
    overflow: 'hidden',
  },
  fieldFill: {
    flex: 1,
  },
  soma: {
    position: 'absolute',
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.9,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  dendrite: {
    position: 'absolute',
  },
  actionPotential: {
    position: 'absolute',
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1.0,
        shadowRadius: 5,
      },
      android: {
        elevation: 3,
      },
    }),
  },
});

export default NeuralPulseBackground;
