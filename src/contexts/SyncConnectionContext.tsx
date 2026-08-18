import React, { createContext, useContext, useState, useEffect, useMemo, useRef, ReactNode } from 'react';
import ConnectionStateManager, { type SyncSource } from '../services/ConnectionStateManager';
import ConnectionManager from '../services/connection/ConnectionManager';
import SyncService, { SyncService as SyncServiceClass } from '../services/SyncService';
import { cloudSessionService, type CloudSessionStatus, type CloudSessionInfo } from '../services/cloud/CloudSessionService';
import { PurgeInProgressError } from '@harmony-ai-solutions/soulbits-api-client';
import AuthService from '../services/auth/AuthService';
import DeviceAuthService from '../services/cloud/DeviceAuthService';
import { parseDeviceDeepLink } from '../services/cloud/deviceDeepLink';
import { DeviceAuthModal } from '../components/cloud/DeviceAuthModal';
import { ToastAndroid, Platform, Alert, Linking } from 'react-native';
import { createLogger } from '../utils/logger';
import { CLOUD_HOSTS, WS_PATHS } from '../config/cloud';
import i18n from './I18nContext';
import { useAppAlert } from './AppAlertContext';
import { shouldPromptForSyncEstimate } from './syncEstimateHelper';
import {
  computeConnectionStatus,
  canUseChatForMode,
  type ConnectionStatusInfo,
} from './connectionStatusHelper';
import {
  isSyncTransportSettled,
  shouldShowConnectionErrorToastForConnection,
} from './syncSettlementHelper';

const log = createLogger('[SyncConnectionContext]');

/**
 * Whether the app should maintain a sync WebSocket connection.
 *
 * Cloud mode has no device-pairing handshake, so ConnectionStateManager's
 * `isPaired` flag is always false there (it tracks the self-hosted ws://
 * handshake + JWT pair). Cloud connections are maintained whenever the broker
 * session is 'ready'. Self-hosted mode continues to use `isPaired` as before.
 *
 * Used in place of `ConnectionStateManager.getIsPaired()` by the disconnect /
 * error handlers so cloud-mode connections auto-reconnect instead of dying
 * silently on the first WS drop.
 */
const shouldMaintainConnection = (): boolean => {
  if (cloudSessionService.getStatus() === 'ready') {
    return true;
  }
  return ConnectionStateManager.getIsPaired();
};

interface SyncConnectionContextType {
  // Pairing state
  isPaired: boolean;
  
  // Sync connection state
  isConnected: boolean;
  isConnecting: boolean;
  isReconnecting: boolean;
  reconnectAttempt: number;
  nextReconnectIn: number;
  
  // Actions
  connect: () => Promise<void>;
  disconnect: () => void;
  reconnect: () => Promise<void>;
  
  // UI helpers
  showToast: (message: string) => void;

  // ── Phase 10: mode-aware chat usability & connection status ────────────
  /** True when the app can show/send chat in the current mode.
   *  - cloud:  cloudSessionService.getStatus() === 'ready'
   *  - self-hosted: isPaired */
  canUseChat: boolean;
  /** Human-readable connection status derived from current mode + state.
   *  Includes textKey for i18n, colour, semantic variant, and mode. */
  connectionStatus: ConnectionStatusInfo;
}

const SyncConnectionContext = createContext<SyncConnectionContextType | undefined>(undefined);

interface SyncConnectionProviderProps {
  children: ReactNode;
}

export const SyncConnectionProvider: React.FC<SyncConnectionProviderProps> = ({ children }) => {
  const [isPaired, setIsPaired] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [nextReconnectIn, setNextReconnectIn] = useState(0);
  
  // ── Phase 10: cloud status + source tracking ───────────────────────────
  const [cloudStatus, setCloudStatus] = useState<CloudSessionStatus>(cloudSessionService.getStatus());
  const [currentSource, setCurrentSource] = useState<SyncSource>('selfhosted');

  // Themed alert dialog (AppAlertProvider is mounted ABOVE this provider in
  // App.tsx). Captured in a ref because handleSyncEstimate is registered in a
  // `[]`-deps effect and must never close over a stale showAlert.
  const { showAlert } = useAppAlert();
  const showAlertRef = useRef(showAlert);
  useEffect(() => {
    showAlertRef.current = showAlert;
  }, [showAlert]);
  
  const hasInitialized = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const connectionManager = ConnectionManager;
  
  // use refs for values that are read inside event-handler closures.
  // React state is only safe to read in the render cycle; closures captured inside
  // useEffect see whatever value the state had when the effect last ran.  Using refs
  // gives the handlers the latest value without needing them as effect dependencies.
  const reconnectTimeoutRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isConnectingRef        = useRef(false);
  const isReconnectingRef      = useRef(false);
  const isPairedRef            = useRef(false);
  const isConnectedRef         = useRef(false);
  // True while a cert-verification decision is pending/in-progress (the cert
  // modal is the intended UX). Suppresses connection-error toasts during the
  // expected TLS/cert churn of the pairing flow. Cleared once the transport
  // settles successfully.
  const isCertFlowActiveRef    = useRef(false);

  // Keep refs in sync with state so both UI renders (state) and closures (refs) are accurate.
  const setIsConnectingSync = (value: boolean) => {
    isConnectingRef.current = value;
    setIsConnecting(value);
  };
  const setIsReconnectingSync = (value: boolean) => {
    isReconnectingRef.current = value;
    setIsReconnecting(value);
  };
  const setIsPairedSync = (value: boolean) => {
    isPairedRef.current = value;
    setIsPaired(value);
  };
  const setIsConnectedSync = (value: boolean) => {
    isConnectedRef.current = value;
    setIsConnected(value);
  };

  const RECONNECT_INTERVALS = [1000, 2000, 4000, 8000, 16000, 30000];

  // ── WS consecutive-failure counter (Phase 8) ────────────────────────────
  // When RN WebSocket dials fail repeatedly (connect-time rejections), the
  // HTTP status code is lost (RN surfaces all upgrade failures as generic
  // `onerror`).  After `MAX_WS_FAILURES_BEFORE_REPROVISION` consecutive
  // failures in cloud mode we re-provision the broker session.
  const MAX_WS_FAILURES_BEFORE_REPROVISION = 5;
  const wsFailureCountRef = useRef(0);

  // ---------------------------------------------------------------------------
  // Reconnect scheduling (uses refs – never stale)
  // ---------------------------------------------------------------------------
  const scheduleReconnect = () => {
    if (reconnectTimeoutRef.current !== null) {
      log.info('Reconnect already scheduled');
      return;
    }
    
    const currentAttempt = reconnectAttemptsRef.current;
    const delay = RECONNECT_INTERVALS[Math.min(currentAttempt, RECONNECT_INTERVALS.length - 1)];
    const attemptNumber = currentAttempt + 1;
    
    log.info(`Scheduling reconnect attempt ${attemptNumber} in ${delay}ms`);
    
    setIsReconnectingSync(true);
    setNextReconnectIn(delay);
    
    reconnectTimeoutRef.current = setTimeout(async () => {
      log.info(`Executing reconnect attempt ${attemptNumber}`);
      
      reconnectAttemptsRef.current = attemptNumber;
      setReconnectAttempts(attemptNumber);
      setNextReconnectIn(0);
      reconnectTimeoutRef.current = null;
      
      try {
        const source = await ConnectionStateManager.getCurrentSource();

        if (source === 'cloud') {
          // ── Cloud: token-expiry pre-check before WS dial ──────────────
          if (AuthService.isTokenExpired()) {
            log.info('Cloud token expired, refreshing before reconnect');
            const ok = await AuthService.refresh();
            if (!ok) {
              log.warn('Cloud token refresh failed — auth expired, cannot reconnect');
              setIsConnectingSync(false);
              return;
            }
          }

          // ── Cloud: consecutive WS failure → re-provision broker session ─
          const { shouldReprovision, nextCount } = shouldReprovisionAfterWsFailure(
            wsFailureCountRef.current,
            MAX_WS_FAILURES_BEFORE_REPROVISION,
          );
          wsFailureCountRef.current = nextCount;
          if (shouldReprovision) {
            log.info('Max cloud WS failures reached — re-provisioning broker session');
            // force: true bypasses CloudSessionService's cached `ready` state.
            // Without this, the call would no-op on the stale cached status and
            // the app would keep dialing WS against the same broken session.
            // Forcing a fresh broker round-trip lets the server reconcile state
            // (grace recovery, fresh session, etc.) and return a routable endpoint.
            await cloudSessionService.connect({ force: true });
          }

          await connect();
        } else {
          // ── Self-hosted ───────────────────────────────────────────────
          if (ConnectionStateManager.getIsTokenExpired()) {
            log.info('Token expired, performing handshake to refresh...');
            await connectWithRefresh();
          } else {
            log.info('Token valid, connecting normally...');
            await connect();
          }
        }
      } catch (error) {
        log.error('Auto-reconnect failed:', error);
        log.info('Scheduling next reconnect after failed attempt');
        scheduleReconnect();
      }
    }, delay);
  };

  const cancelReconnect = () => {
    if (reconnectTimeoutRef.current !== null) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  };

  // ---------------------------------------------------------------------------
  // Connection event handlers
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const handleSyncConnected = async () => {
      log.info('Sync connected');
      ConnectionStateManager.markConnected();
      setIsConnectedSync(true);
      setIsConnectingSync(false);
      setIsReconnectingSync(false);
      reconnectAttemptsRef.current = 0;
      wsFailureCountRef.current = 0; // reset WS failure counter on successful connection
      setReconnectAttempts(0);
      setNextReconnectIn(0);
      showToast(i18n.t('syncConnection:connectedToast'));

      // ── Settled-transport gate ────────────────────────────────────────────
      // During pairing the app first connects over plaintext ws:// to perform
      // the handshake and learn the server's WSS upgrade details. Auto-syncing
      // on that provisional connection is wrong:
      //   1. Sensitive sync data (characters, entities, messages) would cross
      //      the wire unencrypted before the TLS decision is made.
      //   2. The subsequent ws→wss upgrade tears the connection down mid-sync,
      //      orphaning the SyncService session (the "sync already in progress"
      //      stuck-state bug).
      // So only auto-sync once the transport is settled: a TLS connection, or
      // plaintext ws:// only if the user explicitly persisted 'unencrypted'.
      const conn = connectionManager.getSyncConnection();
      const persistedMode = await ConnectionStateManager.getSecurityMode();
      const settled = isSyncTransportSettled(conn?.mode, persistedMode);

      // A successfully settled connection resolves any pending cert decision —
      // connection errors on the settled transport may toast again.
      if (settled) {
        isCertFlowActiveRef.current = false;
      }

      if (!settled) {
        log.info('Sync connected on provisional connection — deferring sync until transport settles');
        return;
      }

      // Trigger background sync to pick up any messages generated while disconnected
      SyncServiceClass.getInstance().initiateSync().catch((err: any) => {
        log.warn('Auto-sync on connect failed (non-critical):', err);
      });
    };

    const handleSyncDisconnected = () => {
      log.info('Sync disconnected');
      ConnectionStateManager.markDisconnected();
      setIsConnectedSync(false);
      
      // Use ConnectionStateManager.getIsPaired() instead of isPairedRef.current
      // to avoid stale-value races when clearSelfHostedCredentials() +
      // disconnectConnection() are called in sequence (mode switch).
      // ConnectionStateManager sets isPaired=false synchronously before its
      // await barrier, so it is always current when this fires.
      if (shouldMaintainConnection() && !isReconnectingRef.current && !isConnectingRef.current) {
        log.info('Connection lost. Scheduling auto-reconnect...');
        scheduleReconnect();
      } else if (isConnectingRef.current) {
        log.info('Disconnect during connection attempt – catch block will handle reconnect');
      }
      
      setIsConnectingSync(false);
    };

    const handleSyncError = async (error: any) => {
      log.error('Sync connection error:', error);
      const errorMessage = error?.message || error?.toString?.() || 'Connection error';

      const isHeartbeatTimeout = error?.code === 'HEARTBEAT_TIMEOUT' ||
                                 errorMessage?.includes('heartbeat timeout');

      if (isHeartbeatTimeout) {
        log.warn('Heartbeat timeout detected – connection is dead');
        
        ConnectionStateManager.markDisconnected();
        setIsConnectedSync(false);
        setIsConnectingSync(false);
        
        // shouldMaintainConnection() covers both cloud (session ready) and
        // self-hosted (isPaired) — getIsPaired() alone is false in cloud mode.
        if (shouldMaintainConnection() && !isReconnectingRef.current) {
          log.info('Scheduling reconnect after heartbeat timeout');
          scheduleReconnect();
        }
      } else {
        // ── Toast gate ────────────────────────────────────────────────────
        // During pairing the app deliberately connects over plaintext ws://
        // (provisional), then upgrades to wss:// and verifies the cert. TLS/
        // cert/connection errors in that window are EXPECTED byproducts — the
        // cert modal is the intended UX, not a toast. Also never toast while
        // a reconnect is in flight (backoff loop) or a cert decision is
        // pending. Only the very first failure on a settled transport may toast.
        const shouldToast = await shouldShowConnectionErrorToastForConnection({
          getConnectionInfo: () => connectionManager.getSyncConnection(),
          getSecurityMode: () => ConnectionStateManager.getSecurityMode(),
          isReconnecting: isReconnectingRef.current,
          reconnectAttempt: reconnectAttemptsRef.current,
          isCertFlowActive: isCertFlowActiveRef.current,
        });
        if (shouldToast) {
          showToast(i18n.t('syncConnection:connectionError', { message: errorMessage }));
        }
        
        // shouldMaintainConnection() covers both cloud (session ready) and
        // self-hosted (isPaired) — getIsPaired() alone is false in cloud mode.
        if (shouldMaintainConnection() && !isReconnectingRef.current && !isConnectingRef.current) {
          log.info('Connection error detected, scheduling reconnect...');
          ConnectionStateManager.markDisconnected();
          setIsConnectedSync(false);
          scheduleReconnect();
        }
      }
    };

    const handleCertVerificationFailed = (_error: any) => {
      log.info('Certificate verification failed');
      // A cert-verification decision is now pending — the cert modal is the
      // intended UX for TLS failures, so suppress connection-error toasts
      // until the transport settles (cleared in handleSyncConnected).
      isCertFlowActiveRef.current = true;
      cancelReconnect();
      setIsReconnectingSync(false);
      setNextReconnectIn(0);
    };

    const handleStateChange = (state: any) => {
      log.info('State changed:', state);
      setIsPairedSync(state.isPaired || false);
      setIsConnectedSync(state.isConnected || false);
    };

    const handleSyncCompleted = (session: any) => {
      log.info('Sync completed:', session);
      showToast(i18n.t('syncConnection:syncComplete', { sent: session.recordsSent, received: session.recordsReceived }));
    };

    const handleSyncErrorEvent = (error: string) => {
      log.error('Sync service error:', error);
      showToast(i18n.t('syncConnection:syncFailed', { error }));
    };

    // Defense-in-depth: ensure a SYNC_REJECT resets state + notifies the user
    // from any screen (e.g. auto-sync on connect), not just SyncSettingsScreen.
    const handleSyncRejected = (payload: any) => {
      log.warn('Sync rejected:', payload);
      const message = payload?.message || payload?.reason || '';
      showToast(i18n.t('syncConnection:syncRejected', { message }));
    };

    // The engine sends a SYNC_DATA_SIZE_ESTIMATE before pushing data and
    // blocks until we confirm. Surface it to the user when:
    //  - this is the INITIAL sync (no last-sync watermark yet → new install,
    //    force_full_sync pull) — ALWAYS prompt for any non-empty estimate, or
    //  - the estimated download exceeds the configured threshold (default 5 MB).
    // Anything at or below the limit — and empty estimates — auto-confirm
    // silently so the engine unblocks and the sync proceeds without interruption.
    const handleSyncEstimate = async (payload: any) => {
      log.info('Size estimate received:', payload);
      // The engine serializes the estimate with snake_case JSON tags
      // (SyncDataSizeEstimatePayload in eventserver/synchronization.go) —
      // read total_records / image_count / estimated_download_mb.
      const records = Number(payload?.total_records ?? 0);
      const images = Number(payload?.image_count ?? 0);
      const mb = Number(payload?.estimated_download_mb ?? 0);

      // Initial sync = no persisted last-sync watermark (initiateSync escalates
      // to force_full_sync when getLastSync() returns 0). The estimate arrives
      // BEFORE the watermark is written (SYNC_FINALIZE), so a 0 watermark here
      // reliably identifies the very first sync on a fresh install.
      const source = await ConnectionStateManager.getCurrentSource();
      const lastSync = await ConnectionStateManager.getLastSync(source);
      const isInitialSync = lastSync === 0;

      const limitMB = await ConnectionStateManager.getSyncEstimateLimitMB();
      if (!shouldPromptForSyncEstimate({ totalRecords: records, imageCount: images, estimatedDownloadMB: mb, limitMB, isInitialSync })) {
        log.info(
          isInitialSync
            ? 'Initial sync with empty estimate — auto-confirming'
            : `Size estimate within limit (${mb} MB, limit ${limitMB === null ? 'Unlimited' : `${limitMB} MB`}) or empty — auto-confirming`,
        );
        SyncService.confirmSizeEstimate(true).catch((err: any) => {
          log.warn('Auto-confirm of size estimate failed:', err);
        });
        return;
      }

      log.info(
        isInitialSync
          ? `Initial sync (no watermark) — prompting for size estimate confirmation (${mb} MB, ${records} records)`
          : `Size estimate exceeds limit (${mb} MB > ${limitMB} MB) — prompting for confirmation`,
      );

      // Format the estimate for display only (up to two decimal places) — the
      // decision above compared the RAW float so threshold checks stay exact.
      const mbDisplay = Number(mb.toFixed(2));
      const message =
        images > 0
          ? i18n.t('syncConnection:sizeEstimateConfirmImages', { records, mb: mbDisplay, images })
          : i18n.t('syncConnection:sizeEstimateConfirm', { records, mb: mbDisplay });

      // Themed dialog via AppAlertContext (AppAlertProvider is now mounted
      // ABOVE SyncConnectionProvider in App.tsx). Use the ref-mirrored
      // showAlertRef so this []-deps listener never closes over a stale one.
      showAlertRef.current(
        i18n.t('syncConnection:alertTitle'),
        message,
        [
          {
            text: i18n.t('common:cancel'),
            style: 'cancel',
            onPress: () => {
              SyncService.confirmSizeEstimate(false).catch((err: any) => {
                log.warn('Reject size estimate failed:', err);
              });
            },
          },
          {
            text: i18n.t('common:confirm'),
            onPress: () => {
              SyncService.confirmSizeEstimate(true).catch((err: any) => {
                log.warn('Confirm size estimate failed:', err);
              });
            },
          },
        ],
        { icon: 'cloud-download-outline', blockBackdropDismiss: true },
      );
    };

    // A name clash during sync apply: an incoming server record's unique
    // `name` collides with a DIFFERENT local row (e.g. two instances seeded
    // the same default config with different UUIDs). The sync is PAUSED until
    // the user picks a resolution. "Apply to all" memorizes the decision for
    // every other clash in this sync session only.
    const handleSyncNameClash = (clash: any) => {
      log.warn('Sync name clash detected:', clash);
      const name = clash?.name || '';
      const table = clash?.table || '';
      const resolve = (resolution: 'overwrite' | 'keep' | 'rename') => (
        applyToAll?: boolean,
      ) => {
        SyncService.resolveNameClash(resolution, !!applyToAll).catch((err: any) => {
          log.warn(`Resolve name clash (${resolution}) failed:`, err);
        });
      };

      showAlertRef.current(
        i18n.t('syncConnection:nameClashTitle'),
        i18n.t('syncConnection:nameClashMessage', { name, table }),
        [
          {
            text: i18n.t('syncConnection:nameClashOverwrite'),
            onPress: resolve('overwrite'),
          },
          {
            text: i18n.t('syncConnection:nameClashKeep'),
            onPress: resolve('keep'),
          },
          {
            text: i18n.t('syncConnection:nameClashRename'),
            onPress: resolve('rename'),
          },
        ],
        {
          icon: 'swap-horizontal',
          blockBackdropDismiss: true,
          checkbox: { label: i18n.t('syncConnection:nameClashApplyToAll') },
        },
      );
    };

    connectionManager.on('connected:sync',            handleSyncConnected);
    connectionManager.on('disconnected:sync',         handleSyncDisconnected);
    connectionManager.on('error:sync',                handleSyncError);
    connectionManager.on('cert:verification_failed',  handleCertVerificationFailed);
    ConnectionStateManager.on('state:changed',        handleStateChange);
    SyncService.on('sync:completed',                  handleSyncCompleted);
    SyncService.on('sync:error',                      handleSyncErrorEvent);
    SyncService.on('sync:rejected',                   handleSyncRejected);
    SyncService.on('sync:estimate',                   handleSyncEstimate);
    SyncService.on('sync:nameclash',                  handleSyncNameClash);

    if (!hasInitialized.current) {
      hasInitialized.current = true;
      initializeConnection();
    }

    return () => {
      connectionManager.off('connected:sync',            handleSyncConnected);
      connectionManager.off('disconnected:sync',         handleSyncDisconnected);
      connectionManager.off('error:sync',                handleSyncError);
      connectionManager.off('cert:verification_failed',  handleCertVerificationFailed);
      ConnectionStateManager.off('state:changed',        handleStateChange);
      SyncService.off('sync:completed',                  handleSyncCompleted);
      SyncService.off('sync:error',                      handleSyncErrorEvent);
      SyncService.off('sync:rejected',                   handleSyncRejected);
      SyncService.off('sync:estimate',                   handleSyncEstimate);
      SyncService.off('sync:nameclash',                  handleSyncNameClash);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Cloud-mode auto-connect
  // ---------------------------------------------------------------------------
  // Self-hosted mode connects on app boot via initializeConnection() (gated on
  // isPaired). Cloud mode has no pairing handshake, so isPaired is always false
  // and initializeConnection() never calls connect(). The broker session
  // becoming 'ready' is the cloud equivalent of "paired + ready to dial" — this
  // listener bridges that gap: when the session transitions to 'ready' in cloud
  // mode and no WS is already up/pending, open one. Without it the UI shows
  // "Cloud Session ready" but the conduct-proxy never receives a WS upgrade.
  // ── Track current source ─────────────────────────────────────────────────
  useEffect(() => {
    ConnectionStateManager.getCurrentSource().then(setCurrentSource);
    const handler = (_state: any) => {
      ConnectionStateManager.getCurrentSource().then(setCurrentSource);
    };
    ConnectionStateManager.on('state:changed', handler);
    return () => { ConnectionStateManager.off('state:changed', handler); };
  }, []);

  // ── Phase 10: cloud-status tracking re-render ──────────────────────────
  // Separate from the auto-connect effect below so status-driven re-renders
  // (canUseChat / connectionStatus) are not coupled to WS dial logic.
  useEffect(() => {
    const onStatus = (s: CloudSessionStatus) => { setCloudStatus(s); };
    cloudSessionService.on('status', onStatus);
    return () => { cloudSessionService.off('status', onStatus); };
  }, []);

  // ── D-DEV-01: device-authorization gate ─────────────────────────────────
  // connect() 403 device_authorization_required → show the 6-digit email-code
  // modal. Driven solely by the 'deviceAuthRequired' status — the service sets
  // it atomically in its catch block (single source of truth; the legacy
  // service event was removed with the connect bypass).
  const [showDeviceAuth, setShowDeviceAuth] = useState(false);
  useEffect(() => {
    const onStatus = (s: CloudSessionStatus) => {
      if (s === 'deviceAuthRequired') {
        setShowDeviceAuth(true);
      }
    };
    cloudSessionService.on('status', onStatus);
    return () => {
      cloudSessionService.off('status', onStatus);
    };
  }, []);

  // ── After the code is verified: re-provision the broker session. The
  // device is now authorized; the 'ready' status handler auto-dials the WS.
  // Plain function (file convention for closures over refs — no hook deps).
  const handleDeviceAuthVerified = async () => {
    setShowDeviceAuth(false);
    try {
      await cloudSessionService.connect({ force: true });
    } catch (e) {
      log.warn('Reconnect after device auth failed:', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      scheduleReconnect();
    }
  };

  // ── D-DEV-01 deep link (Phase 4-1): soulbits://device-auth?code=<6-digit> ──
  // Fired from the portal device-approve page's "Open in the app" button.
  // Two sources, both registered ONCE (this effect has [] deps):
  //   - cold start:  Linking.getInitialURL() — app launched via the link
  //   - warm:        Linking.addEventListener('url') — app already running
  // The listener is active regardless of modal visibility, but ONLY acts when a
  // device-auth flow is pending (status 'deviceAuthRequired' or modal visible).
  // A valid link verifies the code through the shared DeviceAuthService and then
  // reuses handleDeviceAuthVerified() (the same path as the modal's onVerified)
  // — the modal's verify logic is NOT duplicated here. Stale links (no pending
  // flow) are a no-op.
  const showDeviceAuthRef = useRef(showDeviceAuth);
  useEffect(() => {
    showDeviceAuthRef.current = showDeviceAuth;
  }, [showDeviceAuth]);
  const handleDeviceAuthVerifiedRef = useRef(handleDeviceAuthVerified);
  useEffect(() => {
    handleDeviceAuthVerifiedRef.current = handleDeviceAuthVerified;
  }, [handleDeviceAuthVerified]);

  useEffect(() => {
    const handleDeepLink = async (url: string | null) => {
      if (!url) {
        return;
      }
      const parsed = parseDeviceDeepLink(url);
      if (!parsed) {
        log.info('Ignoring non device-auth deep link:', url);
        return;
      }
      // Gate on a pending flow: the 403 status is the service's single source
      // of truth; the modal ref covers the brief window where the status event
      // has not re-emitted after a prior dismiss/re-show.
      const flowPending =
        cloudSessionService.getStatus() === 'deviceAuthRequired' ||
        showDeviceAuthRef.current;
      if (!flowPending) {
        log.info('Device-auth deep link received but no flow pending — ignoring (stale link):', url);
        return;
      }
      log.info('Device-auth deep link received — verifying code');
      try {
        await DeviceAuthService.verifyCode(parsed.code);
        await handleDeviceAuthVerifiedRef.current();
      } catch (e) {
        log.warn(
          'Device-auth deep link verify failed:',
          e instanceof Error ? `${e.name}: ${e.message}` : String(e),
        );
      }
    };

    // Cold start — a link that launched the app.
    Linking.getInitialURL()
      .then(url => handleDeepLink(url))
      .catch(err => {
        log.warn('getInitialURL failed:', err);
      });

    // Warm — link received while the app is foregrounded.
    const subscription = Linking.addEventListener('url', event => {
      handleDeepLink(event.url);
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const onCloudStatus = async (s: CloudSessionStatus, info?: CloudSessionInfo) => {
      const source = await ConnectionStateManager.getCurrentSource();
      if (source !== 'cloud') return;

      if (s === 'ready') {
        // Re-entrancy guard: connect() itself can drive a ready transition
        // (it awaits cloudSessionService.connect() which emits 'ready'); skip
        // if a WS is already up or a connect is already in flight.
        if (isConnectedRef.current || isConnectingRef.current) {
          log.info('Cloud session ready but WS already up/pending — skipping auto-connect');
          return;
        }
        log.info('Cloud session ready — opening sync WebSocket to conduct proxy');
        try {
          await connect();
        } catch (e) {
          log.warn('Auto-connect after cloud ready failed:', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
          scheduleReconnect();
        }
      } else if (s === 'failed') {
        log.warn(`Cloud session failed: ${info?.failureReason ?? 'unknown'}`);
        cancelReconnect();
        setIsReconnectingSync(false);
        setIsConnectingSync(false);
        setNextReconnectIn(0);
        // Do NOT auto-reconnect in a tight loop — the broker already failed.
        // Phase 9 offers a manual retry via cloudSessionService.disconnect()
        // then connect().
      }
    };
    cloudSessionService.on('status', onCloudStatus);
    return () => { cloudSessionService.off('status', onCloudStatus); };
  }, []);

  // ── Purge re-evaluation (Phase 6) ──────────────────────────────────────
  // When a user-initiated cloud purge finishes (success OR failure), clear any
  // in-flight reconnect scheduling so the UI isn't left ticking a reconnect
  // timer against a session that no longer exists. We deliberately do NOT
  // auto-connect here — the success dialog explicitly guides the user to
  // reconnect and Force full re-sync afterwards.
  useEffect(() => {
    const reEvaluateAfterPurge = () => {
      log.info('Cloud data purge settled — resetting reconnect state (no auto-connect)');
      cancelReconnect();
      setIsReconnectingSync(false);
      setIsConnectingSync(false);
      setNextReconnectIn(0);
    };
    cloudSessionService.on('purge:done', reEvaluateAfterPurge);
    cloudSessionService.on('purge:failed', reEvaluateAfterPurge);
    return () => {
      cloudSessionService.off('purge:done', reEvaluateAfterPurge);
      cloudSessionService.off('purge:failed', reEvaluateAfterPurge);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Connection actions
  // ---------------------------------------------------------------------------
  const connect = async (): Promise<void> => {
    if (isConnectingRef.current) {
      log.info('Already connecting');
      return;
    }

    // Suppress every auto-connect / reconnect / foreground / WS-failure
    // re-provision entry while a user-initiated cloud purge is in flight.
    // The broker 409s connects mid-purge anyway; this guard keeps the app from
    // dialing a WS (and toasting connection errors) during the purge window.
    if (cloudSessionService.isPurging()) {
      log.info('Cloud data purge in progress — skipping connect');
      return;
    }

    try {
      setIsConnectingSync(true);
      log.info('Connecting to sync...');
      
      const source = await ConnectionStateManager.getCurrentSource();
      let url: string;
      let mode: string;
      if (source === 'cloud') {
        // Phase 7/8: async provisioning → poll until ready, no stale-session
        // heuristic (the broker owns readiness via its connect-timeout).
        const st = cloudSessionService.getStatus();
        if (st !== 'ready') {
          log.info(`Cloud session status: ${st}, waiting for ready...`);
          await cloudSessionService.connect();
        }

        // Token-expiry pre-check before WS dial — prevents expired-PASETO
        // reconnect loop (RN's WebSocket surfaces 401 upgrade rejections as
        // generic onerror with no status code).
        if (AuthService.isTokenExpired()) {
          log.info('Cloud token expired, refreshing before WS dial');
          const ok = await AuthService.refresh();
          if (!ok) {
            log.warn('Token refresh failed — auth expired, cannot open WS');
            setIsConnectingSync(false);
            return;
          }
        }

        url = `${CLOUD_HOSTS.conductProxyWs}${WS_PATHS.sync}`;
        mode = 'cloud';
      } else {
        mode = (await ConnectionStateManager.getSecurityMode()) || 'secure';
        url = mode === 'unencrypted'
          ? (await ConnectionStateManager.getWSUrl()) ?? ''
          : (await ConnectionStateManager.getWSSUrl()) ?? '';
      }

      if (!url) {
        throw new Error('No server URL configured');
      }

      // A secure (TLS) dial during pairing may legitimately fail on cert
      // verification — mark the cert flow active so expected TLS errors in
      // this window don't surface as toasts. Cleared on a settled connect
      // (handleSyncConnected) or when the transport otherwise resolves.
      if (mode === 'secure' || mode === 'insecure-ssl') {
        isCertFlowActiveRef.current = true;
      }

      await connectionManager.createConnection('sync', 'sync', url, mode as any);
      
      log.info('Sync connection established');
    } catch (error: any) {
      // A 409 purge_in_progress from connectPoll means ANOTHER device is
      // currently resetting its cloud data. This is expected — do NOT treat it
      // as a connection failure or schedule a reconnect (the reconnect loop
      // would spin uselessly until the other purge finishes). Drop to a
      // non-reconnecting state and toast so the user knows to wait.
      if (error instanceof PurgeInProgressError) {
        log.info('Cloud connect blocked: purge in progress on another device');
        cancelReconnect();
        setIsReconnectingSync(false);
        setIsConnectingSync(false);
        setIsConnectedSync(false);
        setNextReconnectIn(0);
        showToast(i18n.t('syncSettings:purgeInProgressOtherDevice'));
        return;
      }

      log.error('Connect failed:', error);
      setIsConnectingSync(false);
      setIsConnectedSync(false);
      
      // Same toast gate as handleSyncError: suppress failedToConnect when this
      // failure is an expected byproduct of the pairing/cert flow or a
      // reconnect attempt (only the very first failure on a settled transport
      // may toast).
      const shouldToast = await shouldShowConnectionErrorToastForConnection({
        getConnectionInfo: () => connectionManager.getSyncConnection(),
        getSecurityMode: () => ConnectionStateManager.getSecurityMode(),
        isReconnecting: isReconnectingRef.current,
        reconnectAttempt: reconnectAttemptsRef.current,
        isCertFlowActive: isCertFlowActiveRef.current,
      });
      if (shouldToast) {
        showToast(i18n.t('syncConnection:failedToConnect'));
      }
      
      throw error;
    }
  };

  const connectWithRefresh = async (): Promise<void> => {
    if (isConnectingRef.current) return;

    // Check if we're in cloud mode — cloud connections don't use self-hosted
    // handshake-refresh; they use PASETO refresh via AuthService.refresh() instead.
    const source = await ConnectionStateManager.getCurrentSource();
    if (source === 'cloud') {
      log.info('Cloud mode — skipping self-hosted handshake refresh, calling connect()');
      try {
        await connect();
      } catch (e) {
        log.error('Cloud connect after refresh check failed:', e);
        setIsConnectingSync(false);
        setIsConnectedSync(false);
        scheduleReconnect();
      }
      return;
    }

    try {
      setIsConnectingSync(true);
      log.info('Attempting to refresh self-hosted token...');
      
      const wsUrl = await ConnectionStateManager.getWSUrl();
      if (!wsUrl) throw new Error('No WS URL available');
      
      const connectionPromise = connectionManager.createConnection('sync', 'sync', wsUrl, 'unencrypted');
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error(i18n.t('syncConnection:handshakeTimeout'))), 10000)
      );
      
      await Promise.race([connectionPromise, timeoutPromise]);
      
      log.info('Connection established, waiting for handshake response...');
      await SyncService.requestHandshakeWithWait(15000);
      
      log.info('Token refresh successful, switching to encrypted connection...');
      
      connectionManager.disconnectConnection('sync');
      
      setIsConnectingSync(false);
      
      await connect();
    } catch (error: any) {
      log.error('Token refresh failed:', error);
      
      connectionManager.disconnectConnection('sync');
      setIsConnectingSync(false);
      setIsConnectedSync(false);

      const currentSummary = ConnectionStateManager.getConnectionSummary();
      log.info('Handshake failed, isPaired:', currentSummary.isPaired);
      
      if (currentSummary.isPaired) {
        log.info('Scheduling reconnect after handshake failure');
        scheduleReconnect();
      }
    }
  };

  const initializeConnection = async () => {
    try {
      await ConnectionStateManager.initialize();
      const summary = ConnectionStateManager.getConnectionSummary();
      
      setIsPairedSync(summary.isPaired);
      setIsConnectedSync(summary.isConnected);
      
      log.info('Initialized:', summary);
      
      // Check the current mode first — cloud mode should never attempt a
      // self-hosted handshake even when stale pairing credentials exist.
      const source = await ConnectionStateManager.getCurrentSource();

      if (summary.isPaired && !summary.isTokenExpired) {
        log.info('Auto-connecting...');
        try {
          await connect();
        } catch {
          log.info('Scheduling reconnect after initialization failure');
          scheduleReconnect();
        }
      } else if (summary.isPaired && summary.requiresRepair) {
        if (source === 'cloud') {
          // Cloud mode with expired PASETO — just call connect() which will
          // trigger CloudWebSocketConnection → onclose 1008/4401 → auth refresh
          // inline. No self-hosted handshake needed.
          log.info('Cloud mode with expired token — connecting (inline refresh will fire)');
          try {
            await connect();
          } catch {
            log.info('Cloud connect with expired token failed, scheduling reconnect');
            scheduleReconnect();
          }
        } else {
          log.info('Self-hosted token expired, attempting re-handshake...');
          await connectWithRefresh();
        }
      }
    } catch (error) {
      log.error('Initialization error:', error);
    }
  };

  const reconnect = async (): Promise<void> => {
    log.info('Manual reconnect triggered');
    
    cancelReconnect();
    
    reconnectAttemptsRef.current = 0;
    setReconnectAttempts(0);
    setIsReconnectingSync(false);
    setNextReconnectIn(0);
    
    connectionManager.disconnectConnection('sync');
    await ConnectionStateManager.markDisconnected();
    setIsConnectedSync(false);
    
    await connect();
  };

  const disconnect = () => {
    log.info('Manual disconnect');
    
    cancelReconnect();
    
    setIsReconnectingSync(false);
    setReconnectAttempts(0);
    setNextReconnectIn(0);
    
    connectionManager.disconnectConnection('sync');
    ConnectionStateManager.markDisconnected();
    setIsConnectedSync(false);
  };

  const showToast = (message: string) => {
    log.info('Toast:', message);
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.SHORT);
    } else {
      Alert.alert(i18n.t('syncConnection:alertTitle'), message);
    }
  };

  // ── Phase 10: derived values ───────────────────────────────────────────
  // Memoized so the context value (and its consumers) only updates when the
  // underlying inputs actually change — otherwise these recomputed objects
  // would force a new context value (and a re-render of every consumer) on
  // every provider render (e.g. during connection churn).
  const canUseChat = useMemo(
    () => canUseChatForMode(currentSource, cloudStatus, isPaired),
    [currentSource, cloudStatus, isPaired],
  );
  const connectionStatus = useMemo(
    () => computeConnectionStatus(currentSource, cloudStatus, isPaired, isConnected, isReconnecting),
    [currentSource, cloudStatus, isPaired, isConnected, isReconnecting],
  );

  // Memoize the context value over the exposed state + derived values. The
  // callbacks (connect/disconnect/reconnect/showToast) read live state through
  // refs / external services / setters rather than closure-captured React state,
  // so memoized instances stay correct between recomputations (same pattern as
  // EntitySessionContext).
  const value: SyncConnectionContextType = useMemo(() => ({
    isPaired,
    isConnected,
    isConnecting,
    isReconnecting,
    reconnectAttempt: reconnectAttempts,
    nextReconnectIn,
    connect,
    disconnect,
    reconnect,
    showToast,
    canUseChat,
    connectionStatus,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [
    isPaired, isConnected, isConnecting, isReconnecting,
    reconnectAttempts, nextReconnectIn, canUseChat, connectionStatus,
  ]);

  return (
    <SyncConnectionContext.Provider value={value}>
      {children}
      {/* D-DEV-01: shown when the broker refuses connect until the device is
          authorized via the emailed 6-digit code. */}
      <DeviceAuthModal
        visible={showDeviceAuth}
        onVerified={handleDeviceAuthVerified}
        onDismiss={() => setShowDeviceAuth(false)}
      />
    </SyncConnectionContext.Provider>
  );
};

export const useSyncConnection = (): SyncConnectionContextType => {
  const context = useContext(SyncConnectionContext);
  if (!context) {
    throw new Error('useSyncConnection must be used within SyncConnectionProvider');
  }
  return context;
};

// ── Pure helper extracted for testability ──────────────────────────────

/**
 * Increment the WS failure counter and check whether the broker session
 * should be re-provisioned.
 *
 * Pure function — no side effects.  Returns the decision + next count
 * so callers can apply them atomically.
 *
 * @param currentCount  The current failure count before this increment.
 * @param maxFailures   Threshold at which re-provision triggers (default 5).
 */
export function shouldReprovisionAfterWsFailure(
  currentCount: number,
  maxFailures: number = 5,
): { shouldReprovision: boolean; nextCount: number } {
  const nextCount = currentCount + 1;
  if (nextCount >= maxFailures) {
    return { shouldReprovision: true, nextCount: 0 };
  }
  return { shouldReprovision: false, nextCount };
}
