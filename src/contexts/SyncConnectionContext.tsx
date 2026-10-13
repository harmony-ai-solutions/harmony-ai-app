import React, { createContext, useContext, useState, useEffect, useMemo, useRef, useCallback, ReactNode } from 'react';
import ConnectionStateManager, { type SyncSource } from '../services/ConnectionStateManager';
import ConnectionManager from '../services/connection/ConnectionManager';
import { getEngineConnection, onEngineConnectionChange } from '../services/engine/EngineService';
import { createLogger } from '../utils/logger';
import i18n from './I18nContext';
import { useToast } from './AppToastContext';
import {
  computeConnectionStatus,
  canUseChatForMode,
  type ConnectionStatusInfo,
} from './connectionStatusHelper';

const log = createLogger('[SyncConnectionContext]');

/**
 * Engine-connection status context (task 3-4).
 *
 * After the TS sync/cloud stack deletion the app talks to a single peer: the
 * EMBEDDED engine (loopback WS + local management API). This provider owns only
 * the engine WebSocket connection lifecycle + status; the former cloud-session,
 * purge, size-estimate, name-clash and sync-protocol machinery is gone.
 *
 * The embedded engine's readiness (`EngineService`) is the "paired" signal; the
 * engine's loopback WS URL is the dial target when available, falling back to
 * the persisted ConnectionStateManager URL (E2E / legacy pairing).
 */

interface SyncConnectionContextType {
  /** Whether the engine connection is available (embedded engine ready, or a
   *  persisted pairing exists). */
  isPaired: boolean;

  // Engine connection state
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

  /** True when the app can show/send chat (engine connection available). */
  canUseChat: boolean;
  /** Human-readable connection status (textKey for i18n, colour, variant, mode). */
  connectionStatus: ConnectionStatusInfo;
}

const SyncConnectionContext = createContext<SyncConnectionContextType | undefined>(undefined);

interface SyncConnectionProviderProps {
  children: ReactNode;
  /**
   * Read-only mode: reflects shared connection state ONLY — never initializes,
   * connects, reconnects, or toasts. Used by second React roots (e.g. the
   * floating chat overlay) so they observe the main app's connection without
   * tearing it down.
   */
  readOnly?: boolean;
}

export const SyncConnectionProvider: React.FC<SyncConnectionProviderProps> = ({ children, readOnly = false }) => {
  const [isPaired, setIsPaired] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [nextReconnectIn, setNextReconnectIn] = useState(0);
  const [currentSource, setCurrentSource] = useState<SyncSource>('selfhosted');

  // Themed toast (AppToastProvider is mounted ABOVE this provider in App.tsx).
  // Captured in a ref because connection event listeners are registered with
  // `[]` deps and must never close over a stale showToast.
  const { showToast: showThemedToast } = useToast();
  const showToastRef = useRef(showThemedToast);
  useEffect(() => {
    showToastRef.current = showThemedToast;
  }, [showThemedToast]);

  const hasInitialized = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const connectionManager = ConnectionManager;

  // Refs mirror state so `[]`-deps closures read current values.
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isConnectingRef = useRef(false);
  const isReconnectingRef = useRef(false);
  const isPairedRef = useRef(false);
  const isConnectedRef = useRef(false);
  // True while a cert-verification decision is pending (the cert modal is the
  // intended UX) — suppresses connection-error toasts during TLS/cert churn.
  const isCertFlowActiveRef = useRef(false);

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

  /** The engine is "available" when its embedded connection is published. */
  const engineAvailable = (): boolean => getEngineConnection() !== null;

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
      reconnectAttemptsRef.current = attemptNumber;
      setReconnectAttempts(attemptNumber);
      setNextReconnectIn(0);
      reconnectTimeoutRef.current = null;
      try {
        await connect();
      } catch (error) {
        log.error('Auto-reconnect failed:', error);
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
    const handleSyncConnected = () => {
      log.info('Engine connection established');
      ConnectionStateManager.markConnected();
      setIsConnectedSync(true);
      setIsConnectingSync(false);
      setIsReconnectingSync(false);
      reconnectAttemptsRef.current = 0;
      setReconnectAttempts(0);
      setNextReconnectIn(0);
      isCertFlowActiveRef.current = false;
      showToast(i18n.t('syncConnection:connectedToast'));
    };

    const handleSyncDisconnected = () => {
      log.info('Engine connection lost');
      ConnectionStateManager.markDisconnected();
      setIsConnectedSync(false);
      if ((isPairedRef.current || engineAvailable()) && !isReconnectingRef.current && !isConnectingRef.current) {
        scheduleReconnect();
      }
      setIsConnectingSync(false);
    };

    const handleSyncError = (error: any) => {
      log.error('Engine connection error:', error);
      const errorMessage = error?.message || error?.toString?.() || 'Connection error';
      ConnectionStateManager.markDisconnected();
      setIsConnectedSync(false);
      setIsConnectingSync(false);
      // Suppress toasts while a reconnect is in flight or a cert decision is
      // pending (the cert modal is the intended UX).
      if (!isReconnectingRef.current && !isCertFlowActiveRef.current) {
        showToast(i18n.t('syncConnection:connectionError', { message: errorMessage }));
      }
      if ((isPairedRef.current || engineAvailable()) && !isReconnectingRef.current && !isConnectingRef.current) {
        scheduleReconnect();
      }
    };

    const handleCertVerificationFailed = (_error: any) => {
      log.info('Certificate verification failed');
      isCertFlowActiveRef.current = true;
      cancelReconnect();
      setIsReconnectingSync(false);
      setNextReconnectIn(0);
    };

    const handleStateChange = (state: any) => {
      setIsPairedSync(state.isPaired || false);
      setIsConnectedSync(state.isConnected || false);
    };

    // ── Read-only mode (second React root, e.g. floating chat overlay) ──
    // Observe the shared singletons; never mutate the connection.
    if (readOnly) {
      const onConnected = () => setIsConnectedSync(true);
      const onDisconnected = () => setIsConnectedSync(false);
      const offEngine = onEngineConnectionChange(conn => setIsPairedSync(conn !== null));
      connectionManager.on('connected:sync', onConnected);
      connectionManager.on('disconnected:sync', onDisconnected);
      ConnectionStateManager.on('state:changed', handleStateChange);
      const summary = ConnectionStateManager.getConnectionSummary();
      setIsPairedSync(summary.isPaired || engineAvailable());
      setIsConnectedSync(summary.isConnected || false);
      return () => {
        offEngine();
        connectionManager.off('connected:sync', onConnected);
        connectionManager.off('disconnected:sync', onDisconnected);
        ConnectionStateManager.off('state:changed', handleStateChange);
      };
    }

    connectionManager.on('connected:sync', handleSyncConnected);
    connectionManager.on('disconnected:sync', handleSyncDisconnected);
    connectionManager.on('error:sync', handleSyncError);
    connectionManager.on('cert:verification_failed', handleCertVerificationFailed);
    ConnectionStateManager.on('state:changed', handleStateChange);

    if (!hasInitialized.current) {
      hasInitialized.current = true;
      initializeConnection();
    }

    return () => {
      connectionManager.off('connected:sync', handleSyncConnected);
      connectionManager.off('disconnected:sync', handleSyncDisconnected);
      connectionManager.off('error:sync', handleSyncError);
      connectionManager.off('cert:verification_failed', handleCertVerificationFailed);
      ConnectionStateManager.off('state:changed', handleStateChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track the current source for status derivation.
  useEffect(() => {
    ConnectionStateManager.getCurrentSource().then(setCurrentSource);
    const handler = (_state: any) => {
      ConnectionStateManager.getCurrentSource().then(setCurrentSource);
    };
    ConnectionStateManager.on('state:changed', handler);
    return () => { ConnectionStateManager.off('state:changed', handler); };
  }, []);

  // The embedded engine's readiness IS the pairing signal — reflect it and dial
  // the connection when the engine becomes available.
  useEffect(() => {
    if (readOnly) return;
    const off = onEngineConnectionChange(conn => {
      const available = conn !== null;
      setIsPairedSync(available || ConnectionStateManager.getIsPaired());
      if (available && !isConnectedRef.current && !isConnectingRef.current && !isReconnectingRef.current) {
        connect().catch(err => {
          log.warn('Engine-ready auto-connect failed:', err instanceof Error ? err.message : String(err));
          scheduleReconnect();
        });
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      log.info('Connecting to the engine...');

      let url: string;
      let mode: string;
      const engine = getEngineConnection();
      if (engine) {
        // Prefer the embedded engine's loopback endpoint.
        mode = engine.wssBaseUrl ? 'insecure-ssl' : 'unencrypted';
        url = engine.wssBaseUrl || engine.wsBaseUrl;
      } else {
        mode = (await ConnectionStateManager.getSecurityMode()) || 'secure';
        url = mode === 'unencrypted'
          ? (await ConnectionStateManager.getWSUrl()) ?? ''
          : (await ConnectionStateManager.getWSSUrl()) ?? '';
      }

      if (!url) {
        throw new Error('No engine URL configured');
      }

      // A secure (TLS) dial may legitimately fail on cert verification — mark
      // the cert flow active so expected TLS errors don't surface as toasts.
      if (mode === 'secure' || mode === 'insecure-ssl') {
        isCertFlowActiveRef.current = true;
      }

      await connectionManager.createConnection('sync', 'sync', url, mode as any);
      log.info('Engine connection established');
    } catch (error: any) {
      log.error('Connect failed:', error);
      setIsConnectingSync(false);
      setIsConnectedSync(false);
      if (!isReconnectingRef.current && !isCertFlowActiveRef.current) {
        showToast(i18n.t('syncConnection:failedToConnect'));
      }
      throw error;
    }
  };

  const initializeConnection = async () => {
    try {
      await ConnectionStateManager.initialize();
      const summary = ConnectionStateManager.getConnectionSummary();
      const paired = summary.isPaired || engineAvailable();
      setIsPairedSync(paired);
      setIsConnectedSync(summary.isConnected);

      log.info('Initialized:', { ...summary, engineAvailable: engineAvailable() });

      if (paired) {
        try {
          await connect();
        } catch {
          log.info('Scheduling reconnect after initialization failure');
          scheduleReconnect();
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

  const showToast = useCallback((message: string) => {
    log.info('Toast:', message);
    showToastRef.current(message);
  }, []);

  // ── Derived values (memoized so consumers only re-render on real changes) ──
  const canUseChat = useMemo(
    () => canUseChatForMode(currentSource, isPaired),
    [currentSource, isPaired],
  );
  const connectionStatus = useMemo(
    () => computeConnectionStatus(currentSource, isPaired, isConnected, isReconnecting),
    [currentSource, isPaired, isConnected, isReconnecting],
  );

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
    reconnectAttempts, nextReconnectIn, canUseChat, connectionStatus, showToast,
  ]);

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
