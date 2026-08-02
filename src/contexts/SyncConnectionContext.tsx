import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import ConnectionStateManager, { type SyncSource } from '../services/ConnectionStateManager';
import ConnectionManager from '../services/connection/ConnectionManager';
import SyncService, { SyncService as SyncServiceClass } from '../services/SyncService';
import { cloudSessionService, type CloudSessionStatus, type CloudSessionInfo } from '../services/cloud/CloudSessionService';
import AuthService from '../services/auth/AuthService';
import { ToastAndroid, Platform, Alert } from 'react-native';
import { createLogger } from '../utils/logger';
import { CLOUD_HOSTS, WS_PATHS } from '../config/cloud';
import i18n from './I18nContext';
import {
  computeConnectionStatus,
  canUseChatForMode,
  type ConnectionStatusInfo,
} from './connectionStatusHelper';
import { isSyncTransportSettled } from './syncSettlementHelper';

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

    const handleSyncError = (error: any) => {
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
        if (reconnectAttemptsRef.current === 0 && !isReconnectingRef.current) {
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

    connectionManager.on('connected:sync',            handleSyncConnected);
    connectionManager.on('disconnected:sync',         handleSyncDisconnected);
    connectionManager.on('error:sync',                handleSyncError);
    connectionManager.on('cert:verification_failed',  handleCertVerificationFailed);
    ConnectionStateManager.on('state:changed',        handleStateChange);
    SyncService.on('sync:completed',                  handleSyncCompleted);
    SyncService.on('sync:error',                      handleSyncErrorEvent);
    SyncService.on('sync:rejected',                   handleSyncRejected);

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

  // ---------------------------------------------------------------------------
  // Connection actions
  // ---------------------------------------------------------------------------
  const connect = async (): Promise<void> => {
    if (isConnectingRef.current) {
      log.info('Already connecting');
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

      await connectionManager.createConnection('sync', 'sync', url, mode as any);
      
      log.info('Sync connection established');
    } catch (error: any) {
      log.error('Connect failed:', error);
      setIsConnectingSync(false);
      setIsConnectedSync(false);
      
      if (reconnectAttemptsRef.current === 0) {
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
  const canUseChat = canUseChatForMode(currentSource, cloudStatus, isPaired);
  const connectionStatus = computeConnectionStatus(
    currentSource, cloudStatus, isPaired, isConnected, isReconnecting,
  );

  const value: SyncConnectionContextType = {
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
  };

  return (
    <SyncConnectionContext.Provider value={value}>
      {children}
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
