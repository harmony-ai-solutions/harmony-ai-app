import React, { useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Animated,
  Easing,
} from 'react-native';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { ThemedCard } from '../themed/ThemedCard';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

/**
 * Phase labels for the sync protocol (displayed sequentially).
 */
const PHASE_LABELS: Record<string, string> = {
  IDLE: 'Ready',
  SERVER_SENDING: 'Receiving from Server',
  CLIENT_SENDING: 'Sending Local Changes',
  FINALIZING: 'Finalizing',
};

/**
 * Animated sync progress visualizer.
 *
 * Features:
 *  - Pulsating neon orb indicating connection / sync activity
 *  - Animated data-flow particles (device ↔ server ping-pong)
 *  - Rolling-number counters for records sent / received
 *  - Phase transition label with fade animation
 *  - Progress bar that fills as records flow
 *
 * All animations use the native driver for 60fps performance and
 * respect the active theme's glass / accent palette.
 */
export interface SyncProgressVisualizerProps {
  /** Current sync phase */
  phase: string;
  /** Total records sent (confirmed by server) */
  recordsSent: number;
  /** Total records received (buffered + applied) */
  recordsReceived: number;
  /** Estimated total records (server-side hint, optional) */
  totalExpected?: number;
  /** Whether a sync is actively running */
  active: boolean;
  /** Whether connected to the harmony backend */
  connected: boolean;
}

export const SyncProgressVisualizer: React.FC<SyncProgressVisualizerProps> = ({
  phase,
  recordsSent,
  recordsReceived,
  totalExpected = 0,
  active,
  connected,
}) => {
  const { theme } = useAppTheme();

  // ── Animated values ────────────────────────────────────────────────────────
  const orbPulse = useRef(new Animated.Value(1)).current;
  const orbGlow = useRef(new Animated.Value(0.6)).current;
  const particle1Progress = useRef(new Animated.Value(0)).current;
  const particle2Progress = useRef(new Animated.Value(0)).current;
  const particle3Progress = useRef(new Animated.Value(0)).current;
  const phaseFade = useRef(new Animated.Value(1)).current;
  const counterSentScale = useRef(new Animated.Value(1)).current;
  const counterRecvScale = useRef(new Animated.Value(1)).current;
  const barWidth = useRef(new Animated.Value(0)).current;

  const prevSent = useRef(recordsSent);
  const prevPhase = useRef(phase);

  // ── Theme-derived colors ───────────────────────────────────────────────────
  const accent = theme?.colors.accent.primary ?? '#b84fd0';
  const accentSecondary = theme?.colors.accent.secondary ?? '#4a5fcf';
  const successColor = theme?.colors.status.success ?? '#4caf82';
  const white = theme?.colors.text.primary ?? '#f0edf6';

  // ── Orb pulse (always runs, different intensities) ─────────────────────────
  useEffect(() => {
    if (active) {
      // Fast, dramatic pulse while syncing
      Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(orbPulse, {
              toValue: 1.25,
              duration: 600,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(orbGlow, {
              toValue: 1,
              duration: 600,
              useNativeDriver: true,
            }),
          ]),
          Animated.parallel([
            Animated.timing(orbPulse, {
              toValue: 0.9,
              duration: 700,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(orbGlow, {
              toValue: 0.4,
              duration: 700,
              useNativeDriver: true,
            }),
          ]),
        ]),
      ).start();
    } else if (connected) {
      // Slow, gentle breathing while idle but connected
      orbPulse.setValue(1);
      orbGlow.setValue(0.5);
      Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(orbPulse, {
              toValue: 1.12,
              duration: 2000,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(orbGlow, {
              toValue: 0.7,
              duration: 2000,
              useNativeDriver: true,
            }),
          ]),
          Animated.parallel([
            Animated.timing(orbPulse, {
              toValue: 0.92,
              duration: 2200,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(orbGlow, {
              toValue: 0.35,
              duration: 2200,
              useNativeDriver: true,
            }),
          ]),
        ]),
      ).start();
    } else {
      // No animation when disconnected — orbPulse stays at 0.85 with dim glow
      orbPulse.setValue(0.85);
      orbGlow.setValue(0.15);
    }

    return () => {
      orbPulse.stopAnimation();
      orbGlow.stopAnimation();
    };
  }, [active, connected, orbPulse, orbGlow]);

  // ── Data-flow particles (visible only when active) ────────────────────────
  useEffect(() => {
    if (!active) {
      particle1Progress.setValue(0);
      particle2Progress.setValue(0);
      particle3Progress.setValue(0);
      return;
    }

    const createParticleLoop = (anim: Animated.Value, delay: number, duration: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, {
            toValue: 1,
            duration,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0,
            duration: 100, // quick reset
            useNativeDriver: true,
          }),
        ]),
      );

    const loop1 = createParticleLoop(particle1Progress, 0, 1400);
    const loop2 = createParticleLoop(particle2Progress, 500, 1600);
    const loop3 = createParticleLoop(particle3Progress, 900, 1200);

    loop1.start();
    loop2.start();
    loop3.start();

    return () => {
      loop1.stop();
      loop2.stop();
      loop3.stop();
    };
  }, [active, particle1Progress, particle2Progress, particle3Progress]);

  // ── Phase transition fade ──────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== prevPhase.current) {
      Animated.sequence([
        Animated.timing(phaseFade, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(phaseFade, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
      prevPhase.current = phase;
    }
  }, [phase, phaseFade]);

  // ── Counter pop animation on change ────────────────────────────────────────
  useEffect(() => {
    if (recordsSent !== prevSent.current && active) {
      Animated.sequence([
        Animated.timing(counterSentScale, {
          toValue: 1.4,
          duration: 120,
          useNativeDriver: true,
        }),
        Animated.spring(counterSentScale, {
          toValue: 1,
          friction: 3,
          useNativeDriver: true,
        }),
      ]).start();
      prevSent.current = recordsSent;
    }
  }, [recordsSent, active, counterSentScale]);

  // Same for received counter
  useEffect(() => {
    if (recordsReceived !== prevSent.current && active) {
      Animated.sequence([
        Animated.timing(counterRecvScale, {
          toValue: 1.4,
          duration: 120,
          useNativeDriver: true,
        }),
        Animated.spring(counterRecvScale, {
          toValue: 1,
          friction: 3,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [recordsReceived, active, counterRecvScale]);

  // ── Progress bar ───────────────────────────────────────────────────────────
  useEffect(() => {
    const total = Math.max(recordsSent + recordsReceived, 1);
    const maxDisplay = totalExpected > 0 ? totalExpected : Math.max(total, 20);
    const ratio = Math.min(total / maxDisplay, 1);

    Animated.timing(barWidth, {
      toValue: ratio,
      duration: 400,
      easing: Easing.out(Easing.ease),
      useNativeDriver: false, // width animation requires JS driver
    }).start();
  }, [recordsSent, recordsReceived, totalExpected, barWidth]);

  // ── Orb color ──────────────────────────────────────────────────────────────
  const orbColor = active ? accent : connected ? successColor : '#555';

  // ── Data-flow particle helper ──────────────────────────────────────────────
  const renderParticle = (anim: Animated.Value, color: string) => {
    const translateX = anim.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 180],
    });
    const opacity = anim.interpolate({
      inputRange: [0, 0.2, 0.8, 1],
      outputRange: [0, 1, 1, 0],
    });
    const scale = anim.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: [0.6, 1.3, 0.4],
    });

    return (
      <Animated.View
        style={[
          styles.particle,
          {
            backgroundColor: color,
            transform: [{ translateX }, { scale }],
            opacity,
          },
        ]}
      />
    );
  };

  // ── Progress bar ───────────────────────────────────────────────────────────
  const barWidthPercent = barWidth.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });

  const displayPhase = PHASE_LABELS[phase] || phase;

  return (
    <ThemedCard accentStripe accentTint style={styles.container}>
      {/* ── Header row: Orb + Status ─────────────────────────────────── */}
      <View style={styles.headerRow}>
        {/* Pulsating neon orb */}
        <View style={styles.orbContainer}>
          {/* Outer glow ring */}
          <Animated.View
            style={[
              styles.orbGlow,
              {
                borderColor: orbColor,
                opacity: orbGlow,
                transform: [{ scale: Animated.multiply(orbPulse, 1.35) }],
              },
            ]}
          />
          {/* Inner solid orb */}
          <Animated.View
            style={[
              styles.orbCore,
              {
                backgroundColor: orbColor,
                transform: [{ scale: orbPulse }],
                shadowColor: orbColor,
              },
            ]}
          />
          {/* Center highlight dot */}
          <View
            style={[
              styles.orbHighlight,
              { backgroundColor: connected || active ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.3)' },
            ]}
          />
        </View>

        {/* Status text block */}
        <View style={styles.statusBlock}>
          <ThemedText weight="medium" size={16}>
            {active ? 'Syncing in Progress' : connected ? 'Connected' : 'Disconnected'}
          </ThemedText>
          <Animated.View style={{ opacity: phaseFade }}>
            <ThemedText variant="secondary" size={13}>
              {displayPhase}
            </ThemedText>
          </Animated.View>
        </View>
      </View>

      {/* ── Data-flow track ──────────────────────────────────────────── */}
      {active && (
        <View style={styles.dataTrack}>
          {/* Left label: Device */}
          <View style={styles.trackEndpoint}>
            <Icon name="cellphone" size={14} color={accent} />
            <ThemedText variant="muted" size={10}>
              Device
            </ThemedText>
          </View>

          {/* Particle track */}
          <View style={styles.trackMiddle}>
            <View style={styles.trackLine} />
            {renderParticle(particle1Progress, accent)}
            {renderParticle(particle2Progress, accentSecondary)}
            {renderParticle(particle3Progress, accent)}
          </View>

          {/* Right label: Server */}
          <View style={styles.trackEndpoint}>
            <Icon name="server" size={14} color={accentSecondary} />
            <ThemedText variant="muted" size={10}>
              Server
            </ThemedText>
          </View>
        </View>
      )}

      {/* ── Counters ─────────────────────────────────────────────────── */}
      <View style={styles.countersRow}>
        {/* Sent counter */}
        <View style={styles.counterBox}>
          <Animated.View style={{ transform: [{ scale: counterSentScale }] }}>
            <ThemedText
              weight="bold"
              size={28}
              style={{ color: active ? accent : white, fontVariant: ['tabular-nums'] as any }}
            >
              {recordsSent}
            </ThemedText>
          </Animated.View>
          <ThemedText variant="secondary" size={11}>
            Records Sent
          </ThemedText>
          <Icon name="arrow-up-circle-outline" size={14} color={accent} style={styles.counterIcon} />
        </View>

        {/* Center divider */}
        <View style={styles.counterDivider} />

        {/* Received counter */}
        <View style={styles.counterBox}>
          <Animated.View style={{ transform: [{ scale: counterRecvScale }] }}>
            <ThemedText
              weight="bold"
              size={28}
              style={{ color: active ? accentSecondary : white, fontVariant: ['tabular-nums'] as any }}
            >
              {recordsReceived}
            </ThemedText>
          </Animated.View>
          <ThemedText variant="secondary" size={11}>
            Records Received
          </ThemedText>
          <Icon name="arrow-down-circle-outline" size={14} color={accentSecondary} style={styles.counterIcon} />
        </View>
      </View>

      {/* ── Progress bar ──────────────────────────────────────────────── */}
      {active && (
        <View style={styles.barTrack}>
          <Animated.View
            style={[
              styles.barFill,
              {
                width: barWidthPercent,
                backgroundColor: accent,
              } as any,
            ]}
          />
          {/* Glow edge on the bar's leading tip */}
          <View
            style={[
              styles.barGlowEdge,
              {
                backgroundColor: accent,
                shadowColor: accent,
              },
            ]}
          />
        </View>
      )}
    </ThemedCard>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 20,
    minHeight: 160,
  },
  // ── Orb ────────────────────────────────────────────────────────────────────
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
  },
  orbContainer: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  orbGlow: {
    position: 'absolute',
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2.5,
  },
  orbCore: {
    width: 18,
    height: 18,
    borderRadius: 9,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 12,
    elevation: 8,
  },
  orbHighlight: {
    position: 'absolute',
    width: 7,
    height: 7,
    borderRadius: 3.5,
    top: 8,
    left: 13,
  },
  statusBlock: {
    flex: 1,
  },
  // ── Data-flow track ────────────────────────────────────────────────────────
  dataTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    height: 36,
  },
  trackEndpoint: {
    alignItems: 'center',
    width: 44,
  },
  trackMiddle: {
    flex: 1,
    height: 20,
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  trackLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: 1,
    marginTop: -0.5,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  particle: {
    position: 'absolute',
    width: 5,
    height: 5,
    borderRadius: 2.5,
    top: '50%',
    marginTop: -2.5,
    left: 0,
    shadowColor: '#fff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 3,
  },
  // ── Counters ───────────────────────────────────────────────────────────────
  countersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  counterBox: {
    flex: 1,
    alignItems: 'center',
    position: 'relative',
  },
  counterIcon: {
    marginTop: 2,
  },
  counterDivider: {
    width: 1,
    height: 30,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginHorizontal: 12,
  },
  // ── Progress bar ───────────────────────────────────────────────────────────
  barTrack: {
    height: 3,
    borderRadius: 1.5,
    backgroundColor: 'rgba(255,255,255,0.06)',
    overflow: 'visible',
    position: 'relative',
  },
  barFill: {
    height: '100%',
    borderRadius: 1.5,
    position: 'absolute',
    left: 0,
    top: 0,
  },
  barGlowEdge: {
    position: 'absolute',
    right: -4,
    top: -4,
    width: 11,
    height: 11,
    borderRadius: 5.5,
    opacity: 0.5,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
    elevation: 5,
  },
});
