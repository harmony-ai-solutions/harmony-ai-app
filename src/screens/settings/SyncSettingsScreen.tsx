import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Easing,
  RefreshControl,
  ActivityIndicator,
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
import {
  cloudSessionService,
  type PurgeProgress,
  type PurgeTerminalPayload,
} from '../../services/cloud/CloudSessionService';
import { createLogger } from '../../utils/logger';
import { hexToRgba } from '../../utils/colorUtils';
import type { RootStackParamList } from '../../navigation/AppNavigator';

const log = createLogger('[SyncSettingsScreen]');

// ── Async cloud purge card (cloud-data-deletion.md §7 UX) ──────────────────

/** Local card sub-state — mirrors CloudSessionService's purge run state.
 *  'succeeded' = deletion done, forced re-sync running; PERSISTENT (survives
 *  the size-estimate prompt that used to clobber the one-shot success alert)
 *  until the user acknowledges it or the forced re-sync completes. */
type PurgeCardState = 'idle' | 'initiating' | 'in_progress' | 'failed' | 'deadline' | 'succeeded';

/** Server purge phase → stepper row. start|kill = row 0, routing/s3/beats/dek
 *  = row 1, done = row 2 (absent phase = initiating → row 0). */
function purgeStepIndexForPhase(phase: string | undefined): number {
  if (!phase || phase === 'start' || phase === 'kill') return 0;
  if (phase === 'routing' || phase === 's3' || phase === 'beats' || phase === 'dek') return 1;
  return 2; // 'done'
}

const PURGE_STEP_KEYS = ['purgeStepStopping', 'purgeStepDeleting', 'purgeStepFinishing'] as const;

/**
 * 3-step purge progress stepper (SyncProgressVisualizer idioms: theme accent
 * colors, completed → check, active → spinner, upcoming → hollow dot).
 */
const PurgeStepper: React.FC<{ phase: string | undefined }> = ({ phase }) => {
  const { t } = useTranslation('syncSettings');
  const { theme } = useAppTheme();
  const current = purgeStepIndexForPhase(phase);
  const accent = theme?.colors.accent.primary ?? '#b84fd0';
  const success = theme?.colors.status.success ?? '#4caf82';
  const muted = theme?.colors.text.muted ?? '#aaaaaa';

  return (
    <View style={styles.stepper}>
      {PURGE_STEP_KEYS.map((key, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : 'pending';
        return (
          <View style={styles.stepperRow} key={key}>
            {state === 'done' ? (
              <Icon name="check-circle" size={18} color={success} style={styles.stepperIcon} />
            ) : state === 'active' ? (
              <ActivityIndicator size="small" color={accent} style={styles.stepperIcon} />
            ) : (
              <Icon name="circle-outline" size={18} color={muted} style={styles.stepperIcon} />
            )}
            <ThemedText
              size={13}
              variant={state === 'pending' ? 'muted' : 'primary'}
              weight={state === 'active' ? 'medium' : 'normal'}
            >
              {t(key)}
            </ThemedText>
          </View>
        );
      })}
    </View>
  );
};

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
  const { isConnected, isPaired, isReconnecting, reconnectAttempt, nextReconnectIn, showToast, canUseChat, connectionStatus, serverUpdateRequired, purgeBlocking, purgeResultPending, dismissPurgeResult } =
    useSyncConnection();

  // ── Existing state (preserved from original) ────────────────────────────────
  const [currentSession, setCurrentSession] = useState<SyncSession | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string>('Never');
  const [securityMode, setSecurityMode] = useState<string>('');
  const [estimateLimit, setEstimateLimit] = useState<string>('5');
  const [countdown, setCountdown] = useState<number>(0);
  const [refreshing, setRefreshing] = useState(false);

  // ── Async cloud purge card state ───────────────────────────────────────────
  // Initial value from the service snapshot covers re-mounts mid-purge; the
  // mount-time attachToRunningPurge() below covers cold-start adoption.
  const [purgeCard, setPurgeCard] = useState<PurgeCardState>(() => {
    switch (cloudSessionService.getPurgeRunState()) {
      case 'initiating': return 'initiating';
      case 'polling': return 'in_progress';
      case 'failed': return 'failed';
      case 'deadline': return 'deadline';
      default:
        // A successful purge whose result the user has NOT acknowledged yet
        // (the provider-level post-purge gate) → re-render the persistent
        // success card, so the ack surface survives navigation/remounts and
        // the deferred size-estimate prompt can always be released.
        return purgeResultPending ? 'succeeded' : 'idle';
    }
  });
  const [purgeProgress, setPurgeProgress] = useState<PurgeProgress | null>(null);
  // Elapsed-minutes ticker while the card is busy (initiating/in_progress).
  const [purgeElapsedMin, setPurgeElapsedMin] = useState(0);
  const purgeStartedAtRef = useRef<number | null>(null);

  // Kick off (or retry) the async purge. Resolves normally — contract-level
  // outcomes arrive as purge:progress / purge:terminal events (handled in the
  // effect below); a REJECTION is an unexpected internal error.
  const beginPurge = useCallback(() => {
    setPurgeCard('initiating'); // optimistic; the first purge:progress confirms
    cloudSessionService.purgeCloudData().catch((err: any) => {
      log.error('PurgeCloudData threw:', err?.message || err);
      setPurgeCard('failed');
      showToast(t('resetCloudDataFailedUnknown'));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Ref so the []-deps event listener never closes over a stale handler.
  const beginPurgeRef = useRef(beginPurge);
  useEffect(() => {
    beginPurgeRef.current = beginPurge;
  }, [beginPurge]);

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

    const completedListener = (session: SyncSession) => {
      setCurrentSession(null);
      setIsSyncing(false);
      setLastSyncTime(new Date().toLocaleString());
      // The post-purge FORCED re-sync completed — the "re-syncing your data
      // now" success card has served its purpose. (Between purge:done and the
      // first SYNC_FINALIZE the watermark is 0, so ANY completed sync is the
      // forced one; the flag check keeps other sessions from clearing it.)
      if ((session as any)?.forceFullSync) {
        setPurgeCard(prev => (prev === 'succeeded' ? 'idle' : prev));
      }
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

  // ── Purge event tracking (async contract) ─────────────────────────────────
  // purge:progress drives the busy card (initiating → in_progress + stepper
  // phase); purge:terminal settles it (success alert / failed card + retry
  // alert / deadline info state). The legacy purge:done / purge:failed
  // events are intentionally NOT re-listened here — the service always emits
  // purge:terminal right after them, and handling both would double-fire.
  useEffect(() => {
    const onProgress = (p: PurgeProgress) => {
      setPurgeProgress(p);
      setPurgeCard(p.runState === 'initiating' ? 'initiating' : 'in_progress');
    };
    const onCleared = () => {
      // A deadline-latched run was reconciled away (server reports none) —
      // the card returns to the idle confirm state.
      setPurgeProgress(null);
      setPurgeCard('idle');
    };
    const onTerminal = (payload: PurgeTerminalPayload) => {
      if (payload.outcome === 'deleted') {
        setPurgeProgress(null);
        // PERSISTENT success state (not idle): renders the "re-syncing your
        // data now" card until the user acknowledges it or the forced
        // re-sync completes — the one-shot alert below alone can be clobbered
        // by the re-sync's size-estimate prompt (single-slot alert context).
        setPurgeCard('succeeded');
        // The app already auto-reconnects + runs a FORCED full re-sync after a
        // successful purge (SyncConnectionContext marks full-resync-required on
        // purge:done — the cleared watermark escalates the on-connect
        // auto-sync). This dialog's action gives the user an immediate,
        // in-place start; after the purge the watermark is 0, so any sync it
        // triggers is a forced full re-sync anyway. Either button
        // acknowledges the result, which releases any deferred estimate
        // prompt AFTER the user has seen the success message.
        showAlert(
          t('resetCloudDataSuccessTitle'),
          t('resetCloudDataSuccessMessage'),
          [
            {
              text: t('common:cancel'),
              style: 'cancel',
              onPress: () => dismissPurgeResult(),
            },
            {
              text: t('resetCloudDataSyncNow'),
              onPress: () => {
                dismissPurgeResult();
                SyncService.forceFullSync().catch((err: any) => {
                  log.error('Force full re-sync from purge success dialog failed:', err?.message || err);
                  showToast(t('failedToStartFullResync', { message: err?.message || 'Unknown error' }));
                });
              },
            },
          ],
          { icon: 'cloud-sync-outline' },
        );
      } else if (payload.outcome === 'failed') {
        setPurgeProgress(null);
        setPurgeCard('failed');
        showAlert(
          t('resetCloudDataFailedTitle'),
          t('resetCloudDataFailedUnknown'),
          [
            { text: t('common:cancel'), style: 'cancel' },
            {
              text: t('resetCloudDataFailedRetry'),
              style: 'destructive',
              // Ref: this []-deps listener must never close over a stale handler.
              onPress: () => beginPurgeRef.current(),
            },
          ],
        );
      } else {
        // deadline — connecting stays paused; card goes non-interactive.
        setPurgeCard('deadline');
      }
    };
    cloudSessionService.on('purge:progress', onProgress);
    cloudSessionService.on('purge:terminal', onTerminal);
    cloudSessionService.on('purge:cleared', onCleared);
    return () => {
      cloudSessionService.off('purge:progress', onProgress);
      cloudSessionService.off('purge:terminal', onTerminal);
      cloudSessionService.off('purge:cleared', onCleared);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Post-purge success card actions ────────────────────────────────────────
  // The persistent success card's "Full re-sync now" — same forced start as
  // the success dialog's action. After the purge the watermark is 0, so the
  // in-flight auto-sync (if any) is already forced and this resolves onto it.
  const handlePurgeSuccessResync = () => {
    SyncService.forceFullSync().catch((err: any) => {
      log.error('Force full re-sync from purge success card failed:', err?.message || err);
      showToast(t('failedToStartFullResync', { message: err?.message || 'Unknown error' }));
    });
  };
  // "Got it" — acknowledge the purge result. Clears the card AND the
  // provider-level gate, which immediately presents any size-estimate prompt
  // that was deferred while the result was pending.
  const handlePurgeSuccessDismiss = () => {
    setPurgeCard(prev => (prev === 'succeeded' ? 'idle' : prev));
    dismissPurgeResult();
  };

  // ── Cold-start attach ──────────────────────────────────────────────────────
  // Covers: app killed mid-purge + relaunch, a purge started on ANOTHER
  // device, AND a deadline latch from a previous app session — attach is now
  // a real re-probe in every non-active state (never a replay for deadline).
  useEffect(() => {
    let cancelled = false;
    cloudSessionService.attachToRunningPurge()
      .then(result => {
        if (cancelled) return;
        if (result.kind === 'adopted') {
          setPurgeProgress(result.progress);
          setPurgeCard(result.progress.runState === 'initiating' ? 'initiating' : 'in_progress');
        } else if (result.kind === 'terminal') {
          if (result.terminal.outcome === 'failed') setPurgeCard('failed');
          else if (result.terminal.outcome === 'deadline') setPurgeCard('deadline');
        } else if (!cloudSessionService.isPurging()) {
          // Server reports no run AND the service isn't holding a deadline
          // latch (a FAILED re-probe GET also resolves `none` while keeping
          // the latch — that must not reset the card out of its deadline
          // state). Also self-heals a stale deadline render: the service has
          // already cleared itself (purge:cleared) by the time we see none.
          // A pending post-purge SUCCESS surface (unacknowledged result) is
          // NOT stale — it must survive the attach probe so the ack button
          // (and any deferred estimate prompt) stays reachable.
          setPurgeProgress(null);
          setPurgeCard(prev => (prev === 'succeeded' ? prev : 'idle'));
        }
      })
      .catch((err: any) => {
        log.warn('attachToRunningPurge failed:', err?.message || err);
      });
    return () => { cancelled = true; };
  }, []);

  // ── Elapsed-minutes ticker (busy card) ─────────────────────────────────────
  useEffect(() => {
    if (purgeCard !== 'initiating' && purgeCard !== 'in_progress') {
      setPurgeElapsedMin(0);
      purgeStartedAtRef.current = null;
      return;
    }
    // Derive the wall-clock start from the newest progress payload so the
    // ticker keeps true time across re-renders/adopted runs.
    if (purgeProgress) {
      const base = Date.now() - purgeProgress.elapsedMs;
      if (
        purgeStartedAtRef.current === null ||
        Math.abs(base - purgeStartedAtRef.current) > 5_000
      ) {
        purgeStartedAtRef.current = base;
      }
    }
    const tick = () => {
      const start = purgeStartedAtRef.current ?? Date.now();
      setPurgeElapsedMin(Math.floor((Date.now() - start) / 60_000));
    };
    tick();
    const interval = setInterval(tick, 1_000);
    return () => clearInterval(interval);
  }, [purgeCard, purgeProgress]);

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

  // ── Reset Cloud Data (user-initiated async purge) ────────────────────────
  // Destructive, cloud-mode-only action. Confirms the scope (updated copy —
  // device data survives; cloud deletion is irreversible and unstoppable),
  // then delegates to CloudSessionService.purgeCloudData(). Progress, success
  // and failure all arrive via purge:progress / purge:terminal events handled
  // in the effect above — including a full "Retry deletion" path.
  const handleResetCloudData = () => {
    showAlert(
      t('resetCloudDataTitle'),
      t('resetCloudDataMessage'),
      [
        { text: t('common:cancel'), style: 'cancel' },
        {
          text: t('resetCloudDataConfirm'),
          style: 'destructive',
          onPress: () => beginPurge(),
        },
      ],
    );
  };

  // ── Helpers (preserved from original) ──────────────────────────────────────
  const getConnectionStatusText = () => {
    // Cloud data purge blocking — overrides disconnected/reconnecting: the
    // WS drops during a purge are EXPECTED (the session is killed by design),
    // so the status reads the purge state instead of an error state.
    if (purgeBlocking) return t('purgeBlockingStatus');
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
        {/* Stateful card: idle → confirm → initiating → in_progress →
            deleted | failed | deadline. deleted settles back to idle with a
            success alert; failed keeps a Retry-deletion card; deadline is
            non-interactive info (connecting stays paused server-side). */}

        {connectionStatus.mode === 'cloud' && (
          <ThemedCard style={styles.resetCloudDataCard}>
            <View style={styles.cardHeader}>
              <Icon name="cloud-remove-outline" size={18} color={theme.colors.status.error} />
              <ThemedText weight="medium" size={15} style={styles.cardTitle}>
                {t('resetCloudDataTitle')}
              </ThemedText>
            </View>

            {purgeCard === 'idle' && (
              <>
                <ThemedText variant="secondary" size={13} style={styles.resetCloudDataDescription}>
                  {t('resetCloudDataCardDescription')}
                </ThemedText>
                <ThemedButton
                  label={t('resetCloudDataConfirm')}
                  icon="cloud-remove-outline"
                  onPress={handleResetCloudData}
                  variant="outline"
                  iconColor={theme.colors.status.error}
                  style={styles.resetCloudDataButton}
                  testID="reset-cloud-data-button"
                  accessibilityLabel="Reset cloud data"
                />
              </>
            )}

            {purgeCard === 'initiating' && (
              <View style={styles.purgeBusyBlock} testID="purge-initiating-block">
                <View style={styles.purgeBusyRow}>
                  <ActivityIndicator size="small" color={accentPrimary} />
                  <ThemedText variant="secondary" size={13}>
                    {t('purgeInitiating')}
                  </ThemedText>
                </View>
                <ThemedText variant="muted" size={12} style={styles.resetCloudDataHint}>
                  {t('resetCloudDataProgressHint')}
                </ThemedText>
              </View>
            )}

            {purgeCard === 'in_progress' && (
              <View style={styles.purgeBusyBlock} testID="purge-progress-block">
                <PurgeStepper phase={purgeProgress?.phase} />
                <ThemedText variant="secondary" size={12} style={styles.purgeElapsed}>
                  {t('purgeElapsed', { minutes: purgeElapsedMin })}
                </ThemedText>
                <ThemedText variant="muted" size={12} style={styles.resetCloudDataHint}>
                  {t('resetCloudDataProgressHint')}
                </ThemedText>
              </View>
            )}

            {purgeCard === 'failed' && (
              <>
                <ThemedText
                  variant="secondary"
                  size={13}
                  style={styles.resetCloudDataDescription}
                  testID="purge-failed-text"
                >
                  {t('resetCloudDataFailedUnknown')}
                </ThemedText>
                <ThemedButton
                  label={t('resetCloudDataFailedRetry')}
                  icon="cloud-refresh"
                  onPress={beginPurge}
                  variant="outline"
                  iconColor={theme.colors.status.error}
                  style={styles.resetCloudDataButton}
                  testID="retry-purge-button"
                  accessibilityLabel={t('resetCloudDataFailedRetry')}
                />
              </>
            )}

            {purgeCard === 'deadline' && (
              <ThemedText
                variant="secondary"
                size={13}
                style={styles.resetCloudDataDescription}
                testID="purge-deadline-text"
              >
                {t('resetCloudDataDeadline')}
              </ThemedText>
            )}

            {purgeCard === 'succeeded' && (
              <>
                <View style={styles.purgeBusyBlock} testID="purge-success-block">
                  <View style={styles.purgeBusyRow}>
                    <Icon name="cloud-check-outline" size={18} color={theme.colors.status.success} />
                    <ThemedText variant="secondary" size={13}>
                      {t('purgeSuccessResyncing')}
                    </ThemedText>
                  </View>
                  <ThemedText variant="muted" size={12} style={styles.resetCloudDataHint}>
                    {t('resetCloudDataProgressHint')}
                  </ThemedText>
                </View>
                <ThemedButton
                  label={t('resetCloudDataSyncNow')}
                  icon="cloud-sync-outline"
                  onPress={handlePurgeSuccessResync}
                  variant="outline"
                  iconColor={theme.colors.status.success}
                  style={styles.resetCloudDataButton}
                  testID="purge-success-resync-button"
                  accessibilityLabel={t('resetCloudDataSyncNow')}
                />
                <ThemedButton
                  label={t('purgeSuccessDismiss')}
                  icon="check"
                  onPress={handlePurgeSuccessDismiss}
                  variant="outline"
                  testID="purge-success-dismiss-button"
                  accessibilityLabel={t('purgeSuccessDismiss')}
                />
              </>
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
  purgeBusyBlock: {
    alignItems: 'stretch',
  },
  purgeBusyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  purgeElapsed: {
    textAlign: 'center',
    marginTop: 8,
    fontVariant: ['tabular-nums'] as any,
  },
  stepper: {
    gap: 8,
    paddingVertical: 4,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepperIcon: {
    width: 22,
    alignItems: 'center',
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
