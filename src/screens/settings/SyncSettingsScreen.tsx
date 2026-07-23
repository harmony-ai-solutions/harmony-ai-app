import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Easing,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useAppAlert } from '../../contexts/AppAlertContext';
import { useSyncConnection } from '../../contexts/SyncConnectionContext';
import { ThemedText } from '../../components/themed/ThemedText';
import { ThemedView } from '../../components/themed/ThemedView';
import { ScreenHeader } from '../../components/themed/ScreenHeader';
import { ThemedButton } from '../../components/themed/ThemedButton';
import { ThemedCard } from '../../components/themed/ThemedCard';
import { SyncProgressVisualizer } from '../../components/sync/SyncProgressVisualizer';
import SyncService, { SyncSession } from '../../services/SyncService';
import ConnectionStateManager from '../../services/ConnectionStateManager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createLogger } from '../../utils/logger';
import { hexToRgba } from '../../utils/colorUtils';
import type { RootStackParamList } from '../../navigation/AppNavigator';

const log = createLogger('[SyncSettingsScreen]');

/**
 * Data Synchronization screen — premium animated redesign.
 *
 * Features:
 *  - Large animated neon orb indicating live connection status
 *  - Glassmorphism status card with security mode & last sync timestamp
 *  - Animated SyncProgressVisualizer with data-flow particles and counters
 *  - Themed primary/outline action buttons
 *  - Preserves all existing SyncSettingsScreen functionality
 */
export const SyncSettingsScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const { theme } = useAppTheme();
  const { showAlert } = useAppAlert();
  const { isConnected, isPaired, isReconnecting, reconnectAttempt, nextReconnectIn, showToast } =
    useSyncConnection();

  // ── Existing state (preserved from original) ────────────────────────────────
  const [currentSession, setCurrentSession] = useState<SyncSession | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string>('Never');
  const [securityMode, setSecurityMode] = useState<string>('');
  const [countdown, setCountdown] = useState<number>(0);

  // ── Existing effects (preserved from original) ─────────────────────────────
  useEffect(() => {
    const loadSettings = async () => {
      const timestamp = await AsyncStorage.getItem('last_sync_timestamp');
      if (timestamp) {
        const date = new Date(parseInt(timestamp) * 1000);
        setLastSyncTime(date.toLocaleString());
      }

      const mode = await ConnectionStateManager.getSecurityMode();
      if (mode) {
        setSecurityMode(mode);
      } else {
        setSecurityMode('secure');
      }
    };
    loadSettings();

    const progressListener = (session: SyncSession) => {
      setCurrentSession({ ...session });
      setIsSyncing(session.status === 'in_progress' || session.status === 'pending');
    };

    const completedListener = (_session: SyncSession) => {
      setCurrentSession(null);
      setIsSyncing(false);
      setLastSyncTime(new Date().toLocaleString());
    };

    const errorListener = (_error: string) => {
      setIsSyncing(false);
    };

    SyncService.on('sync:progress', progressListener);
    SyncService.on('sync:completed', completedListener);
    SyncService.on('sync:error', errorListener);

    return () => {
      SyncService.removeListener('sync:progress', progressListener);
      SyncService.removeListener('sync:completed', completedListener);
      SyncService.removeListener('sync:error', errorListener);
    };
  }, []);

  // Dynamic countdown timer for reconnection
  useEffect(() => {
    if (!isReconnecting || nextReconnectIn <= 0) {
      setCountdown(0);
      return;
    }

    setCountdown(Math.ceil(nextReconnectIn / 1000));

    const interval = setInterval(() => {
      setCountdown((prev) => {
        const next = prev - 1;
        return next > 0 ? next : 0;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isReconnecting, nextReconnectIn]);

  // ── Handlers (preserved from original) ─────────────────────────────────────
  const handleSyncNow = async () => {
    if (!isConnected) {
      showAlert('Not Connected', 'Please connect to Harmony Link first from the Connection Setup screen.');
      return;
    }

    try {
      setIsSyncing(true);
      await SyncService.initiateSync();
    } catch (err: any) {
      setIsSyncing(false);

      const errorMsg = err?.message || 'Unknown error';
      log.error('Sync initiation failed:', errorMsg);

      const isConnectionError =
        errorMsg.includes('not connected') ||
        errorMsg.includes('connection') ||
        err?.code === 'SEND_FAILED' ||
        err?.code === 'NOT_CONNECTED';

      if (isConnectionError) {
        showToast('Connection lost - reconnecting...');
      } else {
        showToast('Failed to start sync: ' + errorMsg);
        showAlert('Sync Error', 'Failed to start sync: ' + errorMsg);
      }
    }
  };

  const handleForceFullSync = () => {
    if (!isConnected) {
      showAlert('Not Connected', 'Please connect to Harmony Link first from the Connection Setup screen.');
      return;
    }

    showAlert(
      'Force Full Re-Sync',
      'This will re-sync ALL data between this device and Harmony Link. This can take a while and may use significant bandwidth.\n\nUse this only if you suspect data is out of sync.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Re-Sync Everything',
          style: 'destructive',
          onPress: async () => {
            try {
              setIsSyncing(true);
              await SyncService.forceFullSync();
            } catch (err: any) {
              setIsSyncing(false);
              const errorMsg = err?.message || 'Unknown error';
              log.error('Force full sync initiation failed:', errorMsg);
              showToast('Failed to start full re-sync: ' + errorMsg);
            }
          },
        },
      ],
    );
  };

  // ── Helpers (preserved from original) ──────────────────────────────────────
  const getConnectionStatusText = () => {
    if (!isPaired) return 'Not Paired';
    if (isConnected) return 'Connected';
    if (isReconnecting) {
      if (reconnectAttempt === 0) return 'Reconnecting...';
      const retryText = countdown > 0 ? ` in ${countdown}s` : '...';
      return `Reconnecting (${reconnectAttempt} retries)${retryText}`;
    }
    return 'Disconnected';
  };

  const getConnectionStatusColor = (): string => {
    if (!isPaired) return theme?.colors.accent.primary ?? '#b84fd0';
    if (isConnected) return theme?.colors.status.success ?? '#4CAF50';
    if (isReconnecting) return theme?.colors.accent.secondary ?? '#4a5fcf';
    return theme?.colors.text.muted ?? '#9692b0';
  };

  const getSecurityModeDisplay = () => {
    switch (securityMode) {
      case 'secure':
        return '🔒 Secure (Verified SSL)';
      case 'insecure-ssl':
        return '🔓 Trusted Certificate (Self-Signed)';
      case 'unencrypted':
        return '⚠️ Unencrypted (No SSL)';
      default:
        return 'Not configured';
    }
  };

  // ── Animated values ─────────────────────────────────────────────────────────
  const fadeIn = useRef(new Animated.Value(0)).current;
  const slideUp = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeIn, {
        toValue: 1,
        duration: 500,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(slideUp, {
        toValue: 0,
        duration: 500,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeIn, slideUp]);

  if (!theme) return null;

  // ── Render ──────────────────────────────────────────────────────────────────
  const statusColor = getConnectionStatusColor();
  const accentPrimary = theme.colors.accent.primary;
  const accentSecondary = theme.colors.accent.secondary;

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title="Data Synchronization" onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero Orb: Large animated connection status orb ─────────────── */}

        <Animated.View
          style={[
            styles.heroOrbContainer,
            {
              opacity: fadeIn,
              transform: [{ translateY: slideUp }],
            },
          ]}
        >
          {/* Outer glow ring */}
          <View style={[styles.heroGlowRing, { borderColor: hexToRgba(statusColor, 0.25) }]}>
            {/* Mid glow */}
            <View style={[styles.heroGlowMid, { borderColor: hexToRgba(statusColor, 0.4) }]}>
              {/* Solid orb */}
              <LinearGradient
                colors={[statusColor, hexToRgba(statusColor, 0.5)]}
                style={styles.heroOrb}
                start={{ x: 0.3, y: 0.1 }}
                end={{ x: 0.7, y: 0.9 }}
              >
                {/* Specular highlight */}
                <View style={styles.heroOrbHighlight} />
                {/* Icon */}
                <Icon
                  name={isConnected ? 'cloud-check' : isReconnecting ? 'cloud-refresh' : 'cloud-off-outline'}
                  size={36}
                  color="#fff"
                />
              </LinearGradient>
            </View>
          </View>

          {/* Status label under the orb */}
          <ThemedText weight="bold" size={20} style={styles.heroStatusText}>
            {getConnectionStatusText()}
          </ThemedText>
          <ThemedText variant="secondary" size={13} style={styles.heroSubtext}>
            {isConnected
              ? 'Your data is in sync with Harmony Link'
              : isReconnecting
              ? 'Attempting to restore connection...'
              : isPaired
              ? 'Tap to view connection details'
              : 'Pair your device to get started'}
          </ThemedText>
        </Animated.View>

        {/* ── Sync Progress Visualizer ──────────────────────────────────── */}

        <SyncProgressVisualizer
          phase={currentSession?.status === 'in_progress' ? 'CLIENT_SENDING' : 'IDLE'}
          recordsSent={currentSession?.recordsSent ?? 0}
          recordsReceived={currentSession?.recordsReceived ?? 0}
          active={isSyncing && !!currentSession}
          connected={isConnected}
        />

        {/* ── Status Card ───────────────────────────────────────────────── */}

        <TouchableOpacity
          onPress={() => navigation.navigate('ConnectionSetup')}
          activeOpacity={0.7}
        >
          <ThemedCard accentStripe style={styles.statusCard}>
            <View style={styles.cardHeader}>
              <Icon name="information-outline" size={18} color={accentPrimary} />
              <ThemedText weight="medium" size={15} style={styles.cardTitle}>
                Connection Details
              </ThemedText>
            </View>

            <View style={styles.detailRow}>
              <View style={styles.detailLabel}>
                <Icon name="clock-outline" size={14} color={theme.colors.text.muted} />
                <ThemedText variant="muted" size={13}>Last Sync</ThemedText>
              </View>
              <ThemedText size={13}>{lastSyncTime}</ThemedText>
            </View>

            <View style={styles.detailDivider} />

            <View style={styles.detailRow}>
              <View style={styles.detailLabel}>
                <View style={[styles.dot, { backgroundColor: statusColor }]} />
                <ThemedText variant="muted" size={13}>Status</ThemedText>
              </View>
              <ThemedText size={13} style={{ color: statusColor }}>
                {getConnectionStatusText()}
              </ThemedText>
            </View>

            {isPaired && (
              <>
                <View style={styles.detailDivider} />
                <View style={styles.detailRow}>
                  <View style={styles.detailLabel}>
                    <Icon name="shield-key-outline" size={14} color={theme.colors.text.muted} />
                    <ThemedText variant="muted" size={13}>Security</ThemedText>
                  </View>
                  <ThemedText size={12}>{getSecurityModeDisplay()}</ThemedText>
                </View>
              </>
            )}

            <View style={styles.tapHint}>
              <ThemedText variant="muted" size={11}>
                Tap to manage connection →
              </ThemedText>
            </View>
          </ThemedCard>
        </TouchableOpacity>

        {/* ── Action Buttons ────────────────────────────────────────────── */}

        <ThemedButton
          label={isSyncing ? 'Syncing...' : 'Sync Now'}
          icon={isSyncing ? 'sync' : 'cloud-sync-outline'}
          onPress={handleSyncNow}
          disabled={isSyncing || !isConnected}
          variant="primary"
          style={styles.actionButton}
          testID="sync-now-button"
          accessibilityLabel={isSyncing ? 'Sync in progress' : 'Sync now'}
        />

        <ThemedButton
          label="Force Full Re-Sync"
          icon="database-sync-outline"
          onPress={handleForceFullSync}
          disabled={isSyncing || !isConnected}
          variant="outline"
          style={styles.actionButton}
          testID="force-resync-button"
          accessibilityLabel="Force full re-sync"
        />

        {/* ── Warning / Info messages ───────────────────────────────────── */}

        {!isPaired && (
          <ThemedCard style={styles.warningCard}>
            <View style={styles.warningRow}>
              <Icon name="alert-circle-outline" size={18} color={accentPrimary} />
              <ThemedText variant="secondary" size={13} style={styles.warningText}>
                Not paired with Harmony Link. Go to Connection Setup to pair your device.
              </ThemedText>
            </View>
          </ThemedCard>
        )}

        {isPaired && !isConnected && !isReconnecting && (
          <ThemedCard style={styles.warningCard}>
            <View style={styles.warningRow}>
              <Icon name="lan-disconnect" size={18} color={accentPrimary} />
              <ThemedText variant="secondary" size={13} style={styles.warningText}>
                Not connected. Attempting to reconnect...
              </ThemedText>
            </View>
          </ThemedCard>
        )}

        {isPaired && isReconnecting && (
          <ThemedCard style={styles.infoCard}>
            <View style={styles.warningRow}>
              <Icon name="cloud-refresh" size={18} color={accentSecondary} />
              <ThemedText variant="secondary" size={13} style={styles.warningText}>
                Auto-reconnect in progress. The connection will be restored automatically.
              </ThemedText>
            </View>
          </ThemedCard>
        )}

        <ThemedText variant="muted" size={12} style={styles.footerText}>
          Synchronization updates your characters, messages, and settings with the latest changes from Harmony Link.
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────

const ORB_SIZE = 90;
const GLOW_RING_1 = ORB_SIZE + 28;
const GLOW_RING_2 = ORB_SIZE + 12;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },

  // ── Hero Orb ────────────────────────────────────────────────────────────────
  heroOrbContainer: {
    alignItems: 'center',
    marginBottom: 24,
    marginTop: 8,
  },
  heroGlowRing: {
    width: GLOW_RING_1,
    height: GLOW_RING_1,
    borderRadius: GLOW_RING_1 / 2,
    borderWidth: 3,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  heroGlowMid: {
    width: GLOW_RING_2,
    height: GLOW_RING_2,
    borderRadius: GLOW_RING_2 / 2,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroOrb: {
    width: ORB_SIZE,
    height: ORB_SIZE,
    borderRadius: ORB_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 24,
    elevation: 12,
  },
  heroOrbHighlight: {
    position: 'absolute',
    top: 16,
    left: 19,
    width: 28,
    height: 18,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.25)',
    transform: [{ rotate: '-30deg' }],
  },
  heroStatusText: {
    marginBottom: 4,
  },
  heroSubtext: {
    textAlign: 'center',
    paddingHorizontal: 30,
  },

  // ── Status Card ─────────────────────────────────────────────────────────────
  statusCard: {
    marginBottom: 20,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    gap: 8,
  },
  cardTitle: {
    flex: 1,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  detailLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  detailDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginVertical: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  tapHint: {
    marginTop: 12,
    alignItems: 'flex-end',
  },

  // ── Buttons ─────────────────────────────────────────────────────────────────
  actionButton: {
    marginBottom: 12,
  },

  // ── Warning / Info Cards ────────────────────────────────────────────────────
  warningCard: {
    marginBottom: 12,
  },
  infoCard: {
    marginBottom: 12,
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  warningText: {
    flex: 1,
    lineHeight: 18,
  },

  // ── Footer ──────────────────────────────────────────────────────────────────
  footerText: {
    textAlign: 'center',
    paddingHorizontal: 16,
    marginTop: 6,
  },
});
