import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import ConnectionStateManager from '../services/ConnectionStateManager';
import ConnectionManager from '../services/connection/ConnectionManager';
import SyncService, { SyncService as SyncServiceClass } from '../services/SyncService';
import { cloudSessionService, type CloudSessionStatus } from '../services/cloud/CloudSessionService';
import { ToastAndroid, Platform, Alert } from 'react-native';
import { createLogger } from '../utils/logger';
import { CLOUD_HOSTS, WS_PATHS } from '../config/cloud';
import i18n from './I18nContext';

const log = createLogger('[SyncConnectionContext]');

/**
 * Broker connect-timeout window. The session broker (soulbits-cloud-backend
 * ScheduleConnectTimeout) auto-transitions a session to grace_period if no
 * WebSocket connects within this many ms. The conduct proxy cancels the timer
 * via POST /v1/session/connected once a WS upgrade succeeds. Used to detect a
 * "ready" session that has outlived its window and is therefore likely torn
 * down (the broker pushes no termination notification to the app).
 */
const BROKER_CONNECT_TIMEOUT_MS = 30_000;

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
  const [lastConnectionError, setLastConnectionError] = useState<string>('');
  
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
        const isTokenExpired = ConnectionStateManager.getIsTokenExpired();
        
        if (isTokenExpired) {
          log.info('Token expired, performing handshake to refresh...');
          await connectWithRefresh();
        } else {
          log.info('Token valid, connecting normally...');
          await connect();
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
    const handleSyncConnected = () => {
      log.info('Sync connected');
      ConnectionStateManager.markConnected();
      setIsConnectedSync(true);
      setIsConnectingSync(false);
      setIsReconnectingSync(false);
      reconnectAttemptsRef.current = 0;
      setReconnectAttempts(0);
      setNextReconnectIn(0);
      setLastConnectionError('');
      showToast(i18n.t('syncConnection:connectedToast'));

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
      if (ConnectionStateManager.getIsPaired() && !isReconnectingRef.current && !isConnectingRef.current) {
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
      setLastConnectionError(errorMessage);

      const isHeartbeatTimeout = error?.code === 'HEARTBEAT_TIMEOUT' ||
                                 errorMessage?.includes('heartbeat timeout');

      if (isHeartbeatTimeout) {
        log.warn('Heartbeat timeout detected – connection is dead');
        
        ConnectionStateManager.markDisconnected();
        setIsConnectedSync(false);
        setIsConnectingSync(false);
        
        // Use ConnectionStateManager.getIsPaired() for race safety
        if (ConnectionStateManager.getIsPaired() && !isReconnectingRef.current) {
          log.info('Scheduling reconnect after heartbeat timeout');
          scheduleReconnect();
        }
      } else {
        if (reconnectAttemptsRef.current === 0 && !isReconnectingRef.current) {
          showToast(i18n.t('syncConnection:connectionError', { message: errorMessage }));
        }
        
        // Use ConnectionStateManager for race-safe paired/connected checks
        if (ConnectionStateManager.getIsPaired() && !isReconnectingRef.current && !isConnectingRef.current) {
          log.info('Connection error detected, scheduling reconnect...');
          ConnectionStateManager.markDisconnected();
          setIsConnectedSync(false);
          scheduleReconnect();
        }
      }
    };

    const handleCertVerificationFailed = (error: any) => {
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

    connectionManager.on('connected:sync',            handleSyncConnected);
    connectionManager.on('disconnected:sync',         handleSyncDisconnected);
    connectionManager.on('error:sync',                handleSyncError);
    connectionManager.on('cert:verification_failed',  handleCertVerificationFailed);
    ConnectionStateManager.on('state:changed',        handleStateChange);
    SyncService.on('sync:completed',                  handleSyncCompleted);
    SyncService.on('sync:error',                      handleSyncErrorEvent);

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

    try {
      setIsConnectingSync(true);
      log.info('Connecting to sync...');
      
      const source = await ConnectionStateManager.getCurrentSource();
      let url: string;
      let mode: string;
      if (source === 'cloud') {
        // Ensure the cloud session is ready before attempting a WS connection.
        // The session broker spawns a Soulbits Engine container (30-35s warm
        // pool, longer for cold start).  The WS upgrade will be rejected until
        // the container is live.
        const sessionStatus = cloudSessionService.getStatus();
        const readyAt = cloudSessionService.getReadyAt();
        const sessionAgeMs = readyAt != null ? Date.now() - readyAt : 0;

        if (sessionStatus !== 'ready') {
          log.info(`Cloud session status: ${sessionStatus}, waiting for ready...`);
          await cloudSessionService.connect();
          // connect() is idempotent — returns immediately if already ready,
          // otherwise waits for the broker to respond and emits 'ready'.
        } else if (sessionAgeMs > BROKER_CONNECT_TIMEOUT_MS) {
          // The broker tears down a session if no WebSocket connects within
          // its connect-timeout window (ScheduleConnectTimeout, 30s). If our
          // session is older than that window it has almost certainly been
          // terminated → every WS upgrade will 404 and we would loop forever
          // (status stays 'ready' because the broker pushes no termination
          // notification). Force a fresh broker session to open a new window.
          // The broker Connect handler is idempotent: it recovers a
          // grace_period session or spawns a fresh one, so this is safe.
          log.info(
            `Cloud session is ${Math.round(sessionAgeMs / 1000)}s old (past the ` +
            `${BROKER_CONNECT_TIMEOUT_MS / 1000}s broker deadline) — forcing fresh session`
          );
          await cloudSessionService.disconnect();
          await cloudSessionService.connect();
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
      const errorMessage = error?.message || 'Unknown error';
      setLastConnectionError(errorMessage);
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
      
      const errorMessage = error?.message || 'Unknown error';
      setLastConnectionError(errorMessage);
      
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
        } catch (connectError: any) {
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
          } catch (connectError: any) {
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
