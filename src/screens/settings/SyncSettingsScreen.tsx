import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Easing,
  RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
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
import { SelectPicker } from '../../components/config/SelectPicker';
import { SyncProgressVisualizer } from '../../components/sync/SyncProgressVisualizer';
import SyncService, { SyncSession } from '../../services/SyncService';
import ConnectionStateManager from '../../services/ConnectionStateManager';
import { cloudSessionService, type CloudSessionStatus } from '../../services/cloud/CloudSessionService';
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
  const { t } = useTranslation('syncSettings');

  const { theme } = useAppTheme();
  const { showAlert } = useAppAlert();
  const { isConnected, isPaired, isReconnecting, reconnectAttempt, nextReconnectIn, showToast, canUseChat, connectionStatus, serverUpdateRequired } =
    useSyncConnection();

  // ── Existing state (preserved from original) ────────────────────────────────
  const [currentSession, setCurrentSession] = useState<SyncSession | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string>('Never');
  const [securityMode, setSecurityMode] = useState<string>('');
  const [estimateLimit, setEstimateLimit] = useState<string>('5');
  const [countdown, setCountdown] = useState<number>(0);
  const [refreshing, setRefreshing] = useState(false);

  // Phase 6: whether the user-initiated cloud data purge is currently running.
  const [isPurging, setIsPurging] = useState(cloudSessionService.isPurging());

  const loadSettings = useCallback(async () => {
    // Read the per-source sync watermark (legacy global key was removed).
    const source = await ConnectionStateManager.getCurrentSource();
    const timestamp = await ConnectionStateManager.getLastSync(source);
    if (timestamp) {
      const date = new Date(timestamp * 1000);
      setLastSyncTime(date.toLocaleString());
    }

    const mode = await ConnectionStateManager.getSecurityMode();
    if (mode) {
      setSecurityMode(mode);
    } else {
      setSecurityMode('secure');
    }

    // Sync confirmation limit (1 / 5 / 10 / 20 / 50 / 100 / Unlimited).
    const limit = await ConnectionStateManager.getSyncEstimateLimitMB();
    setEstimateLimit(limit === null ? 'unlimited' : String(limit));
  }, []);

  const handleEstimateLimitChange = async (value: string) => {
    setEstimateLimit(value);
    try {
      await ConnectionStateManager.setSyncEstimateLimitMB(
        value === 'unlimited' ? null : parseInt(value, 10),
      );
    } catch (err: any) {
      log.error('Failed to save sync estimate limit:', err?.message || err);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadSettings();
    setRefreshing(false);
  }, [loadSettings]);

  // ── Existing effects (preserved from original) ─────────────────────────────
  useEffect(() => {
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

    // Sync was aborted because the connection was lost/replaced mid-session
    // (e.g. ws→wss upgrade). Reset the spinner so the UI doesn't stay stuck
    // in a perpetual "syncing…" state; the next settled connection will
    // auto-sync again.
    const abortedListener = (_reason: string) => {
      setCurrentSession(null);
      setIsSyncing(false);
    };

    // SYNC_REJECT from Harmony Link (e.g. device_unauthorized,
    // clock_drift_exceeded). Without this listener, initiateSync() resolves
    // immediately after the WS send and isSyncing never resets (no
    // SYNC_ACCEPT / sync:error arrives after a reject), leaving the spinner
    // stuck with no feedback. Mirrors sync:rejected handling in
    // SyncConnectionContext (defense-in-depth).
    const rejectedListener = (payload: any) => {
      setIsSyncing(false);
      setCurrentSession(null);
      const message = payload?.message || payload?.reason || t('syncError');
      showToast(t('syncRejected', { message }));
    };

    SyncService.on('sync:progress', progressListener);
    SyncService.on('sync:completed', completedListener);
    SyncService.on('sync:error', errorListener);
    SyncService.on('sync:rejected', rejectedListener);
    SyncService.on('sync:aborted', abortedListener);

    return () => {
      SyncService.removeListener('sync:progress', progressListener);
      SyncService.removeListener('sync:completed', completedListener);
      SyncService.removeListener('sync:error', errorListener);
      SyncService.removeListener('sync:rejected', rejectedListener);
      SyncService.removeListener('sync:aborted', abortedListener);
    };
  }, [loadSettings]);

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

  // ── Purge state tracking (Phase 6) ────────────────────────────────────────
  // Mirrors the CloudSessionService purge lifecycle so the destructive card can
  // disable its button + show progress while a purge is in flight, then surface
  // a success alert or failure toast when it settles. This effect also listens
  // for the `status` event so a purge started from another screen keeps this
  // screen's button state in sync.
  useEffect(() => {
    const onStatus = (s: CloudSessionStatus) => {
      setIsPurging(s === 'purging');
    };
    const onPurgeDone = () => {
      setIsPurging(false);
      showAlert(t('resetCloudDataSuccessTitle'), t('resetCloudDataSuccessMessage'));
    };
    const onPurgeFailed = (reason: string) => {
      setIsPurging(false);
      showToast(t('resetCloudDataFailed', { message: reason }));
    };
    cloudSessionService.on('status', onStatus);
    cloudSessionService.on('purge:done', onPurgeDone);
    cloudSessionService.on('purge:failed', onPurgeFailed);
    return () => {
      cloudSessionService.off('status', onStatus);
      cloudSessionService.off('purge:done', onPurgeDone);
      cloudSessionService.off('purge:failed', onPurgeFailed);
    };
  }, []);

  // ── Handlers (preserved from original) ─────────────────────────────────────
  const handleSyncNow = async () => {
    if (!isConnected) {
      showAlert(t('notConnectedTitle'), t('notConnectedMessage'));
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
        showToast(t('connectionLostReconnecting'));
      } else {
        showToast(t('syncFailed', { message: errorMsg }));
        showAlert(t('syncError'), t('syncFailed', { message: errorMsg }));
      }
    }
  };

  const handleForceFullSync = () => {
    if (!isConnected) {
      showAlert(t('notConnectedTitle'), t('notConnectedMessage'));
      return;
    }

    showAlert(
      t('forceFullResync'),
      t('forceFullResyncMessage'),
      [
        { text: t('common:cancel'), style: 'cancel' },
        {
          text: t('resyncEverything'),
          style: 'destructive',
          onPress: async () => {
            try {
              setIsSyncing(true);
              await SyncService.forceFullSync();
            } catch (err: any) {
              setIsSyncing(false);
              const errorMsg = err?.message || 'Unknown error';
              log.error('Force full sync initiation failed:', errorMsg);
              showToast(t('failedToStartFullResync', { message: errorMsg }));
            }
          },
        },
      ],
    );
  };

  // ── Phase 6: Reset Cloud Data (user-initiated purge) ─────────────────────
  // Destructive, cloud-mode-only action. Confirms the scope, then delegates to
  // CloudSessionService.purgeCloudData() (which disconnects, POSTs the delete
  // with bounded retries, and emits purge:done / purge:failed). This screen
  // reacts to those events (progress / success alert / failure toast) via the
  // effect above.
  const handleResetCloudData = () => {
    showAlert(
      t('resetCloudDataTitle'),
      t('resetCloudDataMessage'),
      [
        { text: t('common:cancel'), style: 'cancel' },
        {
          text: t('resetCloudDataConfirm'),
          style: 'destructive',
          onPress: () => {
            cloudSessionService.purgeCloudData().catch((err: any) => {
              // purgeCloudData resolves normally and emits purge:failed on
              // retry-exhaustion; a rejection here is an unexpected internal
              // error the service didn't swallow.
              log.error('PurgeCloudData threw:', err?.message || err);
              setIsPurging(false);
              showToast(t('resetCloudDataFailed', { message: err?.message || 'Unknown error' }));
            });
          },
        },
      ],
    );
  };

  // ── Helpers (preserved from original) ──────────────────────────────────────
  const getConnectionStatusText = () => {
    // Use shared connectionStatus for standard labels; override the
    // reconnecting-retries detail locally (syncSettings namespace has the
    // richer reconnectingRetries key).
    if (connectionStatus.textKey === 'reconnecting') {
      if (reconnectAttempt === 0) return t('reconnecting');
      const retryText = countdown > 0 ? ` in ${countdown}s` : '...';
      return t('reconnectingRetries', { attempts: reconnectAttempt, countdown: retryText });
    }
    // All other textKeys map 1:1 to syncSettings i18n keys
    return t(connectionStatus.textKey);
  };

  const getConnectionStatusColor = (): string => {
    // Use the shared connectionStatus color; prefer themed colors by variant
    // when available for visual consistency.
    if (connectionStatus.variant === 'success') return theme?.colors.status.success ?? connectionStatus.color;
    if (connectionStatus.variant === 'error') return theme?.colors.status.error ?? connectionStatus.color;
    if (connectionStatus.variant === 'warning') return theme?.colors.accent.secondary ?? connectionStatus.color;
    return theme?.colors.text.muted ?? connectionStatus.color;
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
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[theme!.colors.accent.primary]}
            tintColor={theme!.colors.accent.primary}
            progressBackgroundColor={theme!.colors.background.surface}
          />
        }
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
            {connectionStatus.textKey === 'serverUpdateRequired'
              ? t('heroSubtextServerUpdateRequired')
              : connectionStatus.mode === 'cloud'
              ? connectionStatus.textKey === 'connected'
                ? t('heroSubtextCloudConnected')
                : connectionStatus.textKey === 'preparing'
                ? t('heroSubtextCloudPreparing')
                : connectionStatus.textKey === 'connecting'
                ? t('heroSubtextCloudConnecting')
                : t('heroSubtextCloudOffline')
              : isConnected
              ? t('heroSubtextConnected')
              : isReconnecting
              ? t('heroSubtextReconnecting')
              : isPaired
              ? t('heroSubtextPaired')
              : t('heroSubtextNotPaired')}
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

            {connectionStatus.mode === 'selfhosted' && isPaired && (
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

        {/* ── Sync Confirmation Limit ──────────────────────────────────── */}

        <ThemedCard style={styles.infoCard}>
          <View style={styles.cardHeader}>
            <Icon name="download-lock-outline" size={18} color={accentPrimary} />
            <ThemedText weight="medium" size={15} style={styles.cardTitle}>
              {t('estimateConfirmLimit')}
            </ThemedText>
          </View>
          <ThemedText variant="muted" size={12} style={styles.estimateLimitHint}>
            {t('estimateConfirmLimitHint')}
          </ThemedText>
          <SelectPicker
            label={t('estimateConfirmLimit')}
            value={estimateLimit}
            options={[
              { id: '1', name: '1 MB' },
              { id: '5', name: '5 MB' },
              { id: '10', name: '10 MB' },
              { id: '20', name: '20 MB' },
              { id: '50', name: '50 MB' },
              { id: '100', name: '100 MB' },
              { id: 'unlimited', name: t('unlimited') },
            ]}
            onChange={handleEstimateLimitChange}
          />
        </ThemedCard>

        {/* ── Action Buttons ────────────────────────────────────────────── */}

        <ThemedButton
          label={isSyncing ? 'Syncing...' : 'Sync Now'}
          icon={isSyncing ? 'sync' : 'cloud-sync-outline'}
          onPress={handleSyncNow}
          disabled={isSyncing || !isConnected || serverUpdateRequired}
          variant="primary"
          style={styles.actionButton}
          testID="sync-now-button"
          accessibilityLabel={isSyncing ? 'Sync in progress' : 'Sync now'}
        />

        <ThemedButton
          label={t('forceFullResync')}
          icon="database-sync-outline"
          onPress={handleForceFullSync}
          disabled={isSyncing || !isConnected || serverUpdateRequired}
          variant="outline"
          style={styles.actionButton}
          testID="force-resync-button"
          accessibilityLabel="Force full re-sync"
        />

        {/* ── Reset Cloud Data (destructive, cloud-mode only) ───────────── */}

        {connectionStatus.mode === 'cloud' && (
          <ThemedCard style={styles.resetCloudDataCard}>
            <View style={styles.cardHeader}>
              <Icon name="cloud-remove-outline" size={18} color={theme.colors.status.error} />
              <ThemedText weight="medium" size={15} style={styles.cardTitle}>
                {t('resetCloudDataTitle')}
              </ThemedText>
            </View>

            <ThemedText variant="secondary" size={13} style={styles.resetCloudDataDescription}>
              {t('resetCloudDataCardDescription')}
            </ThemedText>

            <ThemedButton
              label={isPurging ? t('resetCloudDataInProgress') : t('resetCloudDataConfirm')}
              icon="cloud-remove-outline"
              onPress={handleResetCloudData}
              disabled={isPurging}
              variant="outline"
              iconColor={theme.colors.status.error}
              style={styles.resetCloudDataButton}
              testID="reset-cloud-data-button"
              accessibilityLabel="Reset cloud data"
            />

            {isPurging && (
              <ThemedText variant="muted" size={12} style={styles.resetCloudDataHint}>
                {t('resetCloudDataProgressHint')}
              </ThemedText>
            )}
          </ThemedCard>
        )}

        {/* ── Warning / Info messages ───────────────────────────────────── */}

        {/* 3-3/D57: sticky Harmony Link version gate. Shown first — while
            sticky it overrides every other status (checked before the mode
            branch in computeConnectionStatus). Explains the fix + that the
            app reconnects automatically once the engine is updated (the
            ~10-min background re-probe). */}
        {serverUpdateRequired && (
          <ThemedCard style={styles.warningCard} testID="server-update-required-card">
            <View style={styles.warningRow}>
              <Icon name="alert-circle-outline" size={18} color={accentPrimary} />
              <ThemedText variant="secondary" size={13} style={styles.warningText}>
                {t('serverUpdateRequiredWarning')}
              </ThemedText>
            </View>
          </ThemedCard>
        )}

        {connectionStatus.mode === 'cloud' && !canUseChat && (
          <ThemedCard style={styles.warningCard}>
            <View style={styles.warningRow}>
              <Icon name="cloud-sync-outline" size={18} color={accentPrimary} />
              <ThemedText variant="secondary" size={13} style={styles.warningText}>
                {t('cloudSessionNotActive')}
              </ThemedText>
            </View>
          </ThemedCard>
        )}

        {connectionStatus.mode === 'selfhosted' && !isPaired && (
          <ThemedCard style={styles.warningCard}>
            <View style={styles.warningRow}>
              <Icon name="alert-circle-outline" size={18} color={accentPrimary} />
              <ThemedText variant="secondary" size={13} style={styles.warningText}>
                {t('notPairedWarning')}
              </ThemedText>
            </View>
          </ThemedCard>
        )}

        {connectionStatus.mode === 'selfhosted' && isPaired && !isConnected && !isReconnecting && (
          <ThemedCard style={styles.warningCard}>
            <View style={styles.warningRow}>
              <Icon name="lan-disconnect" size={18} color={accentPrimary} />
              <ThemedText variant="secondary" size={13} style={styles.warningText}>
                {t('disconnectedWarning')}
              </ThemedText>
            </View>
          </ThemedCard>
        )}

        {connectionStatus.mode === 'cloud' && connectionStatus.textKey === 'offline' && (
          <ThemedCard style={styles.warningCard}>
            <View style={styles.warningRow}>
              <Icon name="lan-disconnect" size={18} color={accentPrimary} />
              <ThemedText variant="secondary" size={13} style={styles.warningText}>
                {t('cloudDisconnectedWarning')}
              </ThemedText>
            </View>
          </ThemedCard>
        )}

        {isReconnecting && (
          <ThemedCard style={styles.infoCard}>
            <View style={styles.warningRow}>
              <Icon name="cloud-refresh" size={18} color={accentSecondary} />
              <ThemedText variant="secondary" size={13} style={styles.warningText}>
                {connectionStatus.mode === 'cloud'
                  ? t('cloudReconnectingInfo')
                  : t('reconnectingInfo')}
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
  estimateLimitHint: {
    marginBottom: 12,
    lineHeight: 18,
  },

  // ── Buttons ─────────────────────────────────────────────────────────────────
  actionButton: {
    marginBottom: 12,
  },

  // ── Reset Cloud Data card ───────────────────────────────────────────────────
  resetCloudDataCard: {
    marginBottom: 12,
  },
  resetCloudDataDescription: {
    lineHeight: 18,
    marginBottom: 14,
  },
  resetCloudDataButton: {
    marginBottom: 4,
  },
  resetCloudDataHint: {
    textAlign: 'center',
    marginTop: 6,
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
